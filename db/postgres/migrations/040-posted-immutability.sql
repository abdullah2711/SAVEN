-- PIVOT-005: immutable posted-source, numbering and draft/review payload (version 040).
--
-- This file is a VERSIONED, IMMUTABLE payload. It defines the trigger functions only:
-- it attaches no trigger, changes no row and grants no privilege. The stable dispatcher
-- `db/postgres/40-triggers.sql` attaches them and picks the newest payload present, so a
-- later payload (for example 041 for audit) adds new functions and is dispatched without
-- editing this file's bytes.
--
-- Apply after 00, 05, 10, 20, 021, 30 (and the R1/R2 corrections) with a connection that
-- is a member of saven_migrator. Functions are SECURITY INVOKER with a fixed search_path:
-- they are evaluated with the caller's privileges and therefore under PIVOT-004 forced
-- RLS, never as a privileged owner.
--
-- What is protected, mapped to the real accepted tables (see db/postgres/README.md):
--   * command_inbox: accepted bytes (id, actor, digest, payload, created_at) are
--     immutable; only lifecycle/lease columns may change; POSTED is final; a reviewed
--     command is final; entering POSTED requires a balanced journal, audit, outbox and
--     refuses every operational trade/stock shape that is not exactly reconciled.
--   * journals, journal_lines: posted sources are append-only; a posted command cannot
--     receive a late journal or line.
--   * trade_operations/documents/lines/allocations/credits/credit_lines,
--     stock_operations/movements, command_files (evidence), command_decisions (review):
--     append-only children of a command; no insert after the command is POSTED.
--   * approval_requests: the decided digest and policy snapshot are immutable; state is
--     PENDING -> APPROVED only, and no approval may be deleted.
--   * journal_drafts: identity is immutable and only a DRAFT may be edited; drafts are
--     retained (no delete). Pending revisions stay editable; accepted bytes do not.
--   * document_numbers: permanent numbers are immutable and retained.
--   * document_sequences: the high-water mark may only increase and may never be deleted.
--   * document_revisions: submission revisions are append-only; the registry projection
--     stays mutable.
--
-- Audit tables are deliberately NOT handled here: `tenant_data.audit` and
-- `tenant_data.audit_event` are the PIVOT-006 audit payload (041), which will be
-- dispatched by the same dispatcher without touching this payload.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 040-posted-immutability.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER')
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run 040-posted-immutability.sql as a member of saven_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_data') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql before 040-posted-immutability.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data'
  ) THEN
    RAISE EXCEPTION 'Run 30-rls-policies.sql before 040-posted-immutability.sql';
  END IF;
  -- Immutable payload: refuse a second application instead of silently replacing it.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tenant_data' AND p.proname LIKE 'immutability\_040\_%'
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: 040-posted-immutability.sql is already applied and is immutable; add a new payload version instead of reapplying it';
  END IF;
END $$;

SET LOCAL ROLE saven_migrator;

-- =====================================================================
-- Shared helpers (versioned with the payload)
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_040_command_state(p_tenant uuid, p_command text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, tenant_data
AS $fn$
  SELECT state FROM tenant_data.command_inbox
  WHERE tenant_id = p_tenant AND id = p_command
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_040_command_state(uuid, text) IS
  'PIVOT-005 payload 040: current command state for a tenant-scoped command id. Invoker, RLS-scoped, no dynamic SQL.';

-- Shared serialization key for every writer of one command/entry: posting, child and
-- evidence inserts, corrections and terminal voids must all take it so that a guard
-- check cannot be invalidated by a concurrent commit.
CREATE FUNCTION tenant_data.immutability_040_lock_key(p_tenant uuid, p_command text)
RETURNS bigint
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT hashtextextended(p_tenant::text || ':' || p_command, 0)
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_040_lock_key(uuid, text) IS
  'PIVOT-005 payload 040: deterministic advisory-lock key for one tenant-scoped command/entry. Shared by posting, children, corrections and voids.';

-- Verify that a command entering POSTED has the accepted plain-journal effects.
-- Mirrors the native kernel contract for the supported shape: balanced journal with at
-- least two lines, an audit row for the posting event and an outbox row. Any
-- operational trade/stock row on the command is refused, because this boundary does
-- not reconcile those effects exactly; a shallow existence check would be wrong.
CREATE FUNCTION tenant_data.immutability_040_assert_posted_effects(p_tenant uuid, p_command text)
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_lines integer;
  v_debit numeric;
  v_credit numeric;
  v_posted integer;
  v_operational text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_data.journals j
    WHERE j.tenant_id = p_tenant AND j.id = p_command
  ) THEN
    RAISE EXCEPTION 'POSTED_REQUIRES_JOURNAL: command % has no journal', p_command;
  END IF;

  SELECT count(*), coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
    INTO v_lines, v_debit, v_credit
  FROM tenant_data.journal_lines l
  WHERE l.tenant_id = p_tenant AND l.journal_id = p_command;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'POSTED_REQUIRES_LINES: command % has % journal line(s), at least two are required', p_command, v_lines;
  END IF;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'POSTED_UNBALANCED: command % debits % and credits % differ', p_command, v_debit, v_credit;
  END IF;
  IF v_debit <= 0 THEN
    RAISE EXCEPTION 'POSTED_REQUIRES_VALUE: command % journal total must be positive', p_command;
  END IF;
  IF v_debit > 999999999999 THEN
    RAISE EXCEPTION 'POSTED_BOUND_EXCEEDED: command % exceeds the exact minor-unit bound', p_command;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_data.audit a
    WHERE a.tenant_id = p_tenant AND a.command_id = p_command AND a.event = 'JOURNAL_POSTED'
  ) THEN
    RAISE EXCEPTION 'POSTED_REQUIRES_AUDIT: command % has no JOURNAL_POSTED audit row', p_command;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_data.outbox o
    WHERE o.tenant_id = p_tenant AND o.id = p_command
  ) THEN
    RAISE EXCEPTION 'POSTED_REQUIRES_OUTBOX: command % has no outbox row', p_command;
  END IF;

  -- Operational trade/stock shapes are NOT reconciled by this payload. Accepting an
  -- arbitrary movement next to an unrelated balanced journal would be a shallow check,
  -- not financial parity, so every unsupported shape is refused before POSTED. The
  -- supported posting boundary is the plain balanced journal; PIVOT-013 owns the
  -- reviewed operational adapter/reconciliation workflow. This is fail-closed, not a
  -- silent broadening of the plain-journal void scope.
  SELECT string_agg(t, ', ' ORDER BY t) INTO v_operational
  FROM (
    SELECT 'trade_operations' AS t WHERE EXISTS (
      SELECT 1 FROM tenant_data.trade_operations x WHERE x.tenant_id = p_tenant AND x.command_id = p_command)
    UNION ALL
    SELECT 'trade_documents' WHERE EXISTS (
      SELECT 1 FROM tenant_data.trade_documents x WHERE x.tenant_id = p_tenant AND x.command_id = p_command)
    UNION ALL
    SELECT 'trade_lines' WHERE EXISTS (
      SELECT 1 FROM tenant_data.trade_lines x WHERE x.tenant_id = p_tenant AND x.command_id = p_command)
    UNION ALL
    SELECT 'trade_allocations' WHERE EXISTS (
      SELECT 1 FROM tenant_data.trade_allocations x WHERE x.tenant_id = p_tenant AND x.command_id = p_command)
    UNION ALL
    SELECT 'trade_credits' WHERE EXISTS (
      SELECT 1 FROM tenant_data.trade_credits x WHERE x.tenant_id = p_tenant AND x.command_id = p_command)
    UNION ALL
    SELECT 'trade_credit_lines' WHERE EXISTS (
      SELECT 1 FROM tenant_data.trade_credit_lines x WHERE x.tenant_id = p_tenant AND x.command_id = p_command)
    UNION ALL
    SELECT 'stock_operations' WHERE EXISTS (
      SELECT 1 FROM tenant_data.stock_operations x WHERE x.tenant_id = p_tenant AND x.command_id = p_command)
    UNION ALL
    SELECT 'stock_movements' WHERE EXISTS (
      SELECT 1 FROM tenant_data.stock_movements x WHERE x.tenant_id = p_tenant AND x.command_id = p_command)
  ) shapes;
  IF v_operational IS NOT NULL THEN
    RAISE EXCEPTION 'POSTED_OPERATION_UNSUPPORTED: command % carries operational effects (%), and this PostgreSQL posting boundary supports only a plain balanced journal', p_command, v_operational;
  END IF;

  SELECT count(*) INTO v_posted FROM tenant_data.command_inbox c
  WHERE c.tenant_id = p_tenant AND c.id = p_command;
  IF v_posted <> 1 THEN
    RAISE EXCEPTION 'POSTED_REQUIRES_COMMAND: command % is not visible in the current scope', p_command;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_040_assert_posted_effects(uuid, text) IS
  'PIVOT-005 payload 040: plain balanced journal, audit and outbox required before a command may enter POSTED; unsupported operational trade/stock shapes fail closed. Invoker, RLS-scoped.';

-- =====================================================================
-- command_inbox: accepted bytes immutable, POSTED final, effects required
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_040_command_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_allowed text[] := ARRAY['state', 'lease_token', 'lease_until', 'error', 'approved_by', 'updated_at', 'updated_by'];
  v_context_actor text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'COMMAND_RECEIPT_RETAINED: accepted commands are retained';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF btrim(NEW.state) = '' THEN
      RAISE EXCEPTION 'COMMAND_STATE_REQUIRED: a command must be accepted with a state';
    END IF;
    IF NEW.state = 'POSTED' THEN
      RAISE EXCEPTION 'POSTED_REQUIRES_ACCEPT: a command must be accepted and posted through its guarded transition, not inserted as POSTED';
    END IF;
    -- When verified tenant context is present, the receipt actor is bound to the
    -- canonical member of the current principal. This stops a runtime from
    -- fabricating a receipt in another member's name to manufacture approval
    -- independence or submission provenance. Administrative/bootstrap seeding has
    -- no context and is unaffected.
    IF tenant_data.current_tenant_id() IS NOT NULL AND tenant_data.current_user_id() IS NOT NULL THEN
      SELECT m.user_id INTO v_context_actor
      FROM tenant_data.members m
      WHERE m.tenant_id = NEW.tenant_id AND m.user_uuid = tenant_data.current_user_id() AND m.active;
      IF v_context_actor IS NULL OR v_context_actor IS DISTINCT FROM NEW.actor THEN
        RAISE EXCEPTION 'COMMAND_ACTOR_CONTEXT_MISMATCH: the accepted actor must be the verified member for this transaction';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE/DELETE: serialize against posting, children, corrections and voids.
  PERFORM pg_advisory_xact_lock(tenant_data.immutability_040_lock_key(NEW.tenant_id, NEW.id));

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'COMMAND_IDENTITY_IMMUTABLE: command tenant and id are immutable';
  END IF;

  -- Accepted bytes and any column added later are immutable by default; only the
  -- explicit lifecycle/lease allow-list may change.
  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    RAISE EXCEPTION 'COMMAND_RECEIPT_IMMUTABLE: actor, digest, payload and creation bytes are immutable';
  END IF;

  IF OLD.state IN ('POSTED', 'VOIDED') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'FINAL_STATE_IMMUTABLE: a posted or voided command cannot change state';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
     AND EXISTS (
       SELECT 1 FROM tenant_data.command_decisions d
       WHERE d.tenant_id = NEW.tenant_id AND d.command_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'REVIEWED_COMMAND_FINAL: a rejected or returned command is final';
  END IF;

  IF NEW.state = 'POSTED' AND OLD.state IS DISTINCT FROM 'POSTED' THEN
    PERFORM tenant_data.immutability_040_assert_posted_effects(NEW.tenant_id, NEW.id);
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_040_command_guard() IS
  'PIVOT-005 payload 040: command_inbox lifecycle guard. Accepted bytes immutable, POSTED final, reviewed commands final, effects required on posting.';

-- =====================================================================
-- journals / journal_lines: posted source and children are append-only
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_040_journal_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(tenant_data.immutability_040_lock_key(NEW.tenant_id, NEW.id));
    SELECT ci.state INTO v_state
    FROM tenant_data.command_inbox ci
    WHERE ci.tenant_id = NEW.tenant_id AND ci.id = NEW.id;
    IF v_state IN ('POSTED', 'VOIDED') THEN
      RAISE EXCEPTION 'POSTED_SOURCE_LATE_JOURNAL: command % is already final', NEW.id;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'POSTED_SOURCE_IMMUTABLE: posted journals cannot be changed or removed';
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_040_journal_line_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(tenant_data.immutability_040_lock_key(NEW.tenant_id, NEW.journal_id));
    SELECT ci.state INTO v_state
    FROM tenant_data.journals j
    JOIN tenant_data.command_inbox ci
      ON ci.tenant_id = j.tenant_id AND ci.id = j.id
    WHERE j.tenant_id = NEW.tenant_id AND j.id = NEW.journal_id;
    IF v_state IN ('POSTED', 'VOIDED') THEN
      RAISE EXCEPTION 'POSTED_SOURCE_LATE_LINE: command % is already final and cannot receive more lines', NEW.journal_id;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'POSTED_SOURCE_IMMUTABLE: posted journal lines cannot be changed or removed';
END;
$fn$;

-- =====================================================================
-- Command-linked children: append-only, no insert after POSTED
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_040_command_child_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(tenant_data.immutability_040_lock_key(NEW.tenant_id, NEW.command_id));
    SELECT ci.state INTO v_state
    FROM tenant_data.command_inbox ci
    WHERE ci.tenant_id = NEW.tenant_id AND ci.id = NEW.command_id;
    IF v_state IN ('POSTED', 'VOIDED') THEN
      RAISE EXCEPTION 'POSTED_SOURCE_LATE_CHILD: command % is already final and cannot receive more % rows', NEW.command_id, TG_TABLE_NAME;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'POSTED_SOURCE_IMMUTABLE: % rows of an accepted command are retained and immutable', TG_TABLE_NAME;
END;
$fn$;

-- =====================================================================
-- journal_corrections: linked reversal source, both ends reconciled
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_040_correction_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_original_state text;
  v_reversal_state text;
  v_lock_original bigint;
  v_lock_reversal bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'CORRECTION_IMMUTABLE: correction links are immutable and retained';
  END IF;
  IF NEW.command_id IS NOT DISTINCT FROM NEW.original_id THEN
    RAISE EXCEPTION 'CORRECTION_SELF_REFERENCE: a correction cannot reverse itself';
  END IF;

  -- Serialize against posting and voiding of BOTH ends in one deterministic order, so
  -- a concurrent void of the original and a concurrent void of the reversal cannot
  -- interleave between the two lifecycle checks.
  v_lock_original := tenant_data.immutability_040_lock_key(NEW.tenant_id, NEW.original_id);
  v_lock_reversal := tenant_data.immutability_040_lock_key(NEW.tenant_id, NEW.command_id);
  IF v_lock_original <= v_lock_reversal THEN
    PERFORM pg_advisory_xact_lock(v_lock_original);
    PERFORM pg_advisory_xact_lock(v_lock_reversal);
  ELSE
    PERFORM pg_advisory_xact_lock(v_lock_reversal);
    PERFORM pg_advisory_xact_lock(v_lock_original);
  END IF;

  -- The original must be an active posted source, never a voided one.
  SELECT c.state INTO v_original_state
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.original_id;
  IF v_original_state IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'CORRECTION_REQUIRES_POSTED_ORIGINAL: a correction needs a posted original';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tenant_data.entry_voids v
    WHERE v.tenant_id = NEW.tenant_id AND v.entry_id = NEW.original_id
  ) THEN
    RAISE EXCEPTION 'CORRECTION_ORIGINAL_VOIDED: a voided entry cannot be corrected';
  END IF;

  -- The reversal side is equally protected: a link may only be created before the
  -- reversal is final (the native accept-then-execute flow links while pending) and
  -- never onto an already voided terminal reversal.
  SELECT c.state INTO v_reversal_state
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.command_id;
  IF v_reversal_state IS NULL THEN
    RAISE EXCEPTION 'CORRECTION_REVERSAL_NOT_FOUND: the reversal command must exist';
  END IF;
  IF v_reversal_state IN ('POSTED', 'VOIDED') THEN
    RAISE EXCEPTION 'CORRECTION_REVERSAL_FINAL: a correction link must be created before the reversal posts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tenant_data.entry_voids v
    WHERE v.tenant_id = NEW.tenant_id AND v.entry_id = NEW.command_id
  ) THEN
    RAISE EXCEPTION 'CORRECTION_REVERSAL_VOIDED: a voided reversal cannot become a linked correction';
  END IF;
  RETURN NEW;
END;
$fn$;

-- Commit-time re-check: both ends of the reference must still be valid when the
-- transaction actually commits, so a concurrent void cannot slip between check and
-- commit. Deferred constraint trigger, created by the activation step.
CREATE FUNCTION tenant_data.immutability_040_correction_committed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_original_state text;
  v_reversal_state text;
BEGIN
  SELECT c.state INTO v_original_state
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.original_id;
  IF v_original_state IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'CORRECTION_REQUIRES_POSTED_ORIGINAL: a correction needs a posted original';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tenant_data.entry_voids v
    WHERE v.tenant_id = NEW.tenant_id AND v.entry_id = NEW.original_id
  ) THEN
    RAISE EXCEPTION 'CORRECTION_ORIGINAL_VOIDED: a voided entry cannot be corrected';
  END IF;

  SELECT c.state INTO v_reversal_state
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.command_id;
  IF v_reversal_state IS NULL THEN
    RAISE EXCEPTION 'CORRECTION_REVERSAL_NOT_FOUND: the reversal command must exist';
  END IF;
  IF v_reversal_state = 'VOIDED' THEN
    RAISE EXCEPTION 'CORRECTION_REVERSAL_VOIDED: a voided reversal cannot remain a linked correction';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tenant_data.entry_voids v
    WHERE v.tenant_id = NEW.tenant_id AND v.entry_id = NEW.command_id
  ) THEN
    RAISE EXCEPTION 'CORRECTION_REVERSAL_VOIDED: a voided reversal cannot remain a linked correction';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_040_correction_guard() IS
  'PIVOT-005 payload 040: correction links lock and validate BOTH ends, require a posted non-voided original and a non-final, non-voided reversal, and are immutable.';
COMMENT ON FUNCTION tenant_data.immutability_040_correction_committed() IS
  'PIVOT-005 payload 040: deferred commit-time re-check of both ends of a correction reference (original active posted, reversal not voided).';

-- =====================================================================
-- approval_requests: decided digest and policy snapshot are immutable
-- =====================================================================

-- Verify that a proposed approver is a current, admitted, independent member with
-- approval/resource authority for this exact command. This is the single canonical
-- authority check used both by the approval transition guard and by the void
-- primitive at execution time, so a revocation or an authority change between
-- approval and execution fails closed. It does not trust decided_by as metadata.
CREATE FUNCTION tenant_data.immutability_040_approver_authority(
  p_tenant uuid,
  p_command text,
  p_approver text
) RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_approver_uuid uuid;
  v_requester text;
  v_requester_uuid uuid;
  v_company text;
  v_branch text;
  v_entry text;
  v_payload jsonb;
  v_role record;
  v_actions jsonb;
  v_companies jsonb;
  v_branches jsonb;
  v_matches integer := 0;
BEGIN
  IF p_approver IS NULL OR length(btrim(p_approver)) = 0 THEN
    RAISE EXCEPTION 'APPROVAL_DECIDER_REQUIRED: an approval must record its approver';
  END IF;

  SELECT m.user_uuid INTO v_approver_uuid
  FROM tenant_data.members m
  WHERE m.tenant_id = p_tenant AND m.user_id = p_approver AND m.active;
  IF v_approver_uuid IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_APPROVER_NOT_ACTIVE: the approver is not a current tenant member';
  END IF;

  SELECT c.actor, c.payload::jsonb INTO v_requester, v_payload
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = p_tenant AND c.id = p_command;
  IF v_requester IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_COMMAND_NOT_FOUND: the approval command is not visible in this scope';
  END IF;
  IF v_requester = p_approver THEN
    RAISE EXCEPTION 'APPROVAL_SELF_FORBIDDEN: an independent approver is required';
  END IF;
  SELECT m.user_uuid INTO v_requester_uuid
  FROM tenant_data.members m
  WHERE m.tenant_id = p_tenant AND m.user_id = v_requester;
  IF v_requester_uuid IS NOT NULL AND v_requester_uuid = v_approver_uuid THEN
    RAISE EXCEPTION 'APPROVAL_SELF_FORBIDDEN: an independent approver is required';
  END IF;

  -- Resource scope comes from the command's own journal, or from the target entry of
  -- a void command. When neither resolves, only the action grant is required; the
  -- void primitive always resolves the target entry before authorising execution.
  SELECT j.company, j.branch INTO v_company, v_branch
  FROM tenant_data.journals j
  WHERE j.tenant_id = p_tenant AND j.id = p_command;
  IF v_company IS NULL AND coalesce(v_payload ->> 'kind', '') = 'ENTRY_VOID' THEN
    v_entry := v_payload ->> 'entry';
    SELECT j.company, j.branch INTO v_company, v_branch
    FROM tenant_data.journals j
    WHERE j.tenant_id = p_tenant AND j.id = v_entry;
  END IF;

  IF EXISTS (
    SELECT 1 FROM tenant_data.denials d
    WHERE d.tenant_id = p_tenant AND d.user_id = p_approver
      AND d.action IN ('journal.approve', '*')
  ) THEN
    RAISE EXCEPTION 'APPROVAL_AUTHORITY_DENIED: the approver has an explicit denial';
  END IF;

  FOR v_role IN
    SELECT r.id, r.protected, r.permissions::jsonb AS p
    FROM tenant_data.assignments a
    JOIN tenant_data.roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
    WHERE a.tenant_id = p_tenant AND a.user_id = p_approver
    ORDER BY r.id
  LOOP
    IF v_role.protected THEN
      v_matches := v_matches + 1;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_role.p) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'APPROVAL_PERMISSION_INVALID: role % has a malformed permission payload', v_role.id;
    END IF;
    v_actions := v_role.p -> 'actions';
    IF jsonb_typeof(v_actions) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'APPROVAL_PERMISSION_INVALID: role % has no canonical actions array', v_role.id;
    END IF;
    IF NOT (jsonb_exists(v_actions, 'journal.approve') OR jsonb_exists(v_actions, '*')) THEN
      CONTINUE;
    END IF;
    v_companies := v_role.p -> 'companies';
    v_branches := v_role.p -> 'branches';
    IF jsonb_typeof(v_companies) IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_branches) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'APPROVAL_PERMISSION_INVALID: role % has malformed scope arrays', v_role.id;
    END IF;
    IF v_company IS NOT NULL AND NOT (jsonb_exists(v_companies, '*') OR jsonb_exists(v_companies, v_company)) THEN
      CONTINUE;
    END IF;
    IF v_branch IS NOT NULL AND NOT (jsonb_exists(v_branches, '*') OR jsonb_exists(v_branches, v_branch)) THEN
      CONTINUE;
    END IF;
    v_matches := v_matches + 1;
  END LOOP;

  IF v_matches = 0 THEN
    RAISE EXCEPTION 'APPROVAL_AUTHORITY_REQUIRED: the approver holds no current approval grant for this command';
  END IF;
  RETURN v_approver_uuid;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_040_approver_authority(uuid, text, text) IS
  'PIVOT-005 payload 040: canonical approver verification. Requires a current active tenant member (not the requester) with an active journal.approve (or protected owner) grant scoped to the command resource, and no explicit denial. The approval transition guard additionally requires the verified session context; the void primitive re-runs this check at execution so a revoked or authority-changed approver fails closed.';

CREATE FUNCTION tenant_data.immutability_040_approval_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_allowed text[] := ARRAY['state', 'decided_by', 'updated_at', 'updated_by'];
  v_state text;
  v_digest text;
  v_context_actor text;
  v_context_uuid uuid;
  v_approver_uuid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPROVAL_RETAINED: approval requests are retained';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT ci.state, ci.digest INTO v_state, v_digest FROM tenant_data.command_inbox ci
    WHERE ci.tenant_id = NEW.tenant_id AND ci.id = NEW.command_id;
    IF v_state IS NULL THEN
      RAISE EXCEPTION 'APPROVAL_COMMAND_NOT_FOUND: an approval must reference a visible command';
    END IF;
    IF v_state IN ('POSTED', 'VOIDED') THEN
      RAISE EXCEPTION 'POSTED_SOURCE_LATE_APPROVAL: command % is already final', NEW.command_id;
    END IF;
    IF btrim(NEW.state) = '' THEN
      RAISE EXCEPTION 'APPROVAL_STATE_REQUIRED: an approval request requires a state';
    END IF;
    -- An approval decision is a transition by the approver, never an insert that
    -- asserts its own outcome. The accepted digest is bound at creation.
    IF NEW.state = 'APPROVED' THEN
      RAISE EXCEPTION 'APPROVAL_TRANSITION_REQUIRED: create the request pending and record the decision as an actor-bound transition';
    END IF;
    IF NEW.decided_by IS NOT NULL THEN
      RAISE EXCEPTION 'APPROVAL_DECIDER_UNEXPECTED: a pending request cannot already name its decider';
    END IF;
    IF NEW.payload_digest IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION 'APPROVAL_DIGEST_MISMATCH: the approval must bind the exact accepted command digest';
    END IF;
    IF jsonb_typeof(NEW.policy_snapshot::jsonb) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'APPROVAL_POLICY_INVALID: the policy snapshot must be a JSON object';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    RAISE EXCEPTION 'APPROVAL_BINDING_IMMUTABLE: the decided digest and policy snapshot are immutable';
  END IF;
  IF OLD.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
    RAISE EXCEPTION 'APPROVAL_DECIDER_IMMUTABLE: the exact recorded approver identity is immutable';
  END IF;
  IF OLD.state = 'APPROVED' AND NEW.state IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'APPROVAL_STATE_FINAL: an approved request is final';
  END IF;
  IF btrim(NEW.state) = '' THEN
    RAISE EXCEPTION 'APPROVAL_STATE_REQUIRED: an approval request requires a state';
  END IF;

  IF NEW.state = 'APPROVED' THEN
    IF OLD.state IS DISTINCT FROM 'PENDING' THEN
      RAISE EXCEPTION 'APPROVAL_TRANSITION_INVALID: only a pending request may be approved';
    END IF;
    IF NEW.decided_by IS NULL THEN
      RAISE EXCEPTION 'APPROVAL_DECIDER_REQUIRED: an approved request must record its approver';
    END IF;
    -- The decision must be made by the verified principal itself, not merely stamped
    -- with an arbitrary member id by the requester.
    v_context_uuid := tenant_data.current_user_id();
    IF tenant_data.current_tenant_id() IS DISTINCT FROM NEW.tenant_id OR v_context_uuid IS NULL THEN
      RAISE EXCEPTION 'APPROVAL_CONTEXT_REQUIRED: an approval decision requires verified tenant context';
    END IF;
    IF NOT tenant_data.session_admitted(NEW.tenant_id, v_context_uuid) THEN
      RAISE EXCEPTION 'APPROVAL_CONTEXT_REQUIRED: the approver has no active admitted session';
    END IF;
    SELECT m.user_id INTO v_context_actor FROM tenant_data.members m
    WHERE m.tenant_id = NEW.tenant_id AND m.user_uuid = v_context_uuid AND m.active;
    IF v_context_actor IS NULL OR v_context_actor IS DISTINCT FROM NEW.decided_by THEN
      RAISE EXCEPTION 'APPROVAL_DECIDER_MISMATCH: the recorded approver must be the verified member taking the decision';
    END IF;
    SELECT ci.digest INTO v_digest FROM tenant_data.command_inbox ci
    WHERE ci.tenant_id = NEW.tenant_id AND ci.id = NEW.command_id;
    IF NEW.payload_digest IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION 'APPROVAL_DIGEST_MISMATCH: the approval must bind the exact accepted command digest';
    END IF;
    v_approver_uuid := tenant_data.immutability_040_approver_authority(
      NEW.tenant_id, NEW.command_id, NEW.decided_by);
  ELSE
    IF NEW.decided_by IS NOT NULL THEN
      RAISE EXCEPTION 'APPROVAL_DECIDER_UNEXPECTED: only an approved request names its decider';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- =====================================================================
-- journal_drafts: identity immutable, only a DRAFT is editable, retained
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_040_draft_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_allowed text[] := ARRAY['payload', 'revision', 'state', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DRAFT_RETAINED: draft history is retained';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.revision < 1 THEN
      RAISE EXCEPTION 'DRAFT_REVISION_INVALID: draft revisions start at 1';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    RAISE EXCEPTION 'DRAFT_IDENTITY_IMMUTABLE: draft identity and ownership are immutable';
  END IF;
  IF OLD.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'DRAFT_STATE_LOCKED: only a DRAFT may be edited; submit a new revision';
  END IF;
  IF NEW.revision < OLD.revision THEN
    RAISE EXCEPTION 'DRAFT_REVISION_REGRESSION: a draft revision may only advance';
  END IF;
  RETURN NEW;
END;
$fn$;

-- =====================================================================
-- document_numbers / document_sequences: permanent numbers, monotonic high-water
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_040_number_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  RAISE EXCEPTION 'DOCUMENT_NUMBER_IMMUTABLE: allocated document numbers are permanent and retained';
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_040_sequence_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DOCUMENT_SEQUENCE_RETAINED: document sequences are retained';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.company IS DISTINCT FROM OLD.company
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'DOCUMENT_SEQUENCE_IDENTITY_IMMUTABLE: a sequence identity is immutable';
  END IF;
  IF NEW.next_number < OLD.next_number THEN
    RAISE EXCEPTION 'DOCUMENT_SEQUENCE_REGRESSION: a document sequence may only advance';
  END IF;
  RETURN NEW;
END;
$fn$;

-- =====================================================================
-- document_revisions: append-only submissions
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_040_revision_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  RAISE EXCEPTION 'DOCUMENT_REVISION_IMMUTABLE: submission revisions are append-only and retained';
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_040_command_child_guard() IS
  'PIVOT-005 payload 040: command-linked children are append-only and cannot be inserted after POSTED. Applies to trade, stock, evidence and review rows.';
COMMENT ON FUNCTION tenant_data.immutability_040_journal_guard() IS
  'PIVOT-005 payload 040: a posted journal is immutable and cannot be added to a posted command.';
COMMENT ON FUNCTION tenant_data.immutability_040_number_guard() IS
  'PIVOT-005 payload 040: document numbers are permanent, immutable and retained.';
COMMENT ON FUNCTION tenant_data.immutability_040_sequence_guard() IS
  'PIVOT-005 payload 040: document sequence high-water may only increase and is retained.';
COMMENT ON FUNCTION tenant_data.immutability_040_revision_guard() IS
  'PIVOT-005 payload 040: pending-document submission revisions are append-only.';

-- Trigger functions run as the invoker under forced RLS. EXECUTE is still narrowed so
-- no PUBLIC path exists to the function entry points.
REVOKE ALL ON FUNCTION tenant_data.immutability_040_command_state(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_assert_posted_effects(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_lock_key(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_approver_authority(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_command_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_journal_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_journal_line_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_command_child_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_approval_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_draft_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_number_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_sequence_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_040_revision_guard() FROM PUBLIC;

-- The runtime trigger bodies call these two helpers directly, so the invoker needs
-- EXECUTE on them; the guard functions themselves are invoked as triggers.
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_assert_posted_effects(uuid, text) TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_lock_key(uuid, text) TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_approver_authority(uuid, text, text) TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_command_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_journal_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_journal_line_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_command_child_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_approval_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_draft_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_number_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_sequence_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_revision_guard() TO saven_customer_app;

COMMIT;
