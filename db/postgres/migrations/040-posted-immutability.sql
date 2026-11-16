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
--     command is final; entering POSTED requires balanced, reconciled effects.
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

-- Verify that a command entering POSTED has the accepted effects. Mirrors the native
-- kernel contract: balanced journal with at least two lines, an audit row for the
-- posting event, an outbox row, and reconciled trade/stock effects when present.
CREATE FUNCTION tenant_data.immutability_040_assert_posted_effects(p_tenant uuid, p_command text)
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_lines integer;
  v_debit numeric;
  v_credit numeric;
  v_total numeric;
  v_sum numeric;
  v_posted integer;
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

  -- Trade documents must reconcile with their lines and allocations.
  FOR v_total IN
    SELECT d.total FROM tenant_data.trade_documents d
    WHERE d.tenant_id = p_tenant AND d.command_id = p_command
  LOOP
    SELECT coalesce(sum(l.amount), 0) INTO v_sum
    FROM tenant_data.trade_lines l
    WHERE l.tenant_id = p_tenant AND l.command_id = p_command;
    IF v_sum <> v_total THEN
      RAISE EXCEPTION 'TRADE_UNRECONCILED: command % total % differs from its lines %', p_command, v_total, v_sum;
    END IF;
    SELECT coalesce(sum(a.amount), 0) INTO v_sum
    FROM tenant_data.trade_allocations a
    WHERE a.tenant_id = p_tenant AND a.document_id = p_command;
    IF v_sum > v_total THEN
      RAISE EXCEPTION 'TRADE_OVERALLOCATED: command % allocates % against a total of %', p_command, v_sum, v_total;
    END IF;
  END LOOP;

  -- Credits must reconcile with their lines.
  FOR v_total IN
    SELECT c.total FROM tenant_data.trade_credits c
    WHERE c.tenant_id = p_tenant AND c.command_id = p_command
  LOOP
    SELECT coalesce(sum(l.amount), 0) INTO v_sum
    FROM tenant_data.trade_credit_lines l
    WHERE l.tenant_id = p_tenant AND l.command_id = p_command;
    IF v_sum <> v_total THEN
      RAISE EXCEPTION 'TRADE_CREDIT_UNRECONCILED: command % total % differs from its credit lines %', p_command, v_total, v_sum;
    END IF;
  END LOOP;

  -- A stock command must carry its movements.
  IF EXISTS (
    SELECT 1 FROM tenant_data.stock_operations s
    WHERE s.tenant_id = p_tenant AND s.command_id = p_command
  ) AND NOT EXISTS (
    SELECT 1 FROM tenant_data.stock_movements m
    WHERE m.tenant_id = p_tenant AND m.command_id = p_command
  ) THEN
    RAISE EXCEPTION 'STOCK_REQUIRES_MOVEMENTS: command % has a stock operation without movements', p_command;
  END IF;

  SELECT count(*) INTO v_posted FROM tenant_data.command_inbox c
  WHERE c.tenant_id = p_tenant AND c.id = p_command;
  IF v_posted <> 1 THEN
    RAISE EXCEPTION 'POSTED_REQUIRES_COMMAND: command % is not visible in the current scope', p_command;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_040_assert_posted_effects(uuid, text) IS
  'PIVOT-005 payload 040: balanced journal, audit, outbox and reconciled trade/stock effects required before a command may enter POSTED. Invoker, RLS-scoped.';

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
  v_voided boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'CORRECTION_IMMUTABLE: correction links are immutable and retained';
  END IF;

  -- Serialize against posting and voiding of the original entry.
  PERFORM pg_advisory_xact_lock(tenant_data.immutability_040_lock_key(NEW.tenant_id, NEW.original_id));

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
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_040_correction_guard() IS
  'PIVOT-005 payload 040: correction links take the shared command lock, need a posted original, reject a voided original and are immutable.';
COMMENT ON FUNCTION tenant_data.immutability_040_correction_committed() IS
  'PIVOT-005 payload 040: deferred commit-time re-check of both ends of a correction reference.';

-- =====================================================================
-- approval_requests: decided digest and policy snapshot are immutable
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_040_approval_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_allowed text[] := ARRAY['state', 'decided_by', 'updated_at', 'updated_by'];
  v_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPROVAL_RETAINED: approval requests are retained';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT ci.state INTO v_state FROM tenant_data.command_inbox ci
    WHERE ci.tenant_id = NEW.tenant_id AND ci.id = NEW.command_id;
    IF v_state IN ('POSTED', 'VOIDED') THEN
      RAISE EXCEPTION 'POSTED_SOURCE_LATE_APPROVAL: command % is already final', NEW.command_id;
    END IF;
    IF btrim(NEW.state) = '' THEN
      RAISE EXCEPTION 'APPROVAL_STATE_REQUIRED: an approval request requires a state';
    END IF;
    IF NEW.state = 'APPROVED' AND NEW.decided_by IS NULL THEN
      RAISE EXCEPTION 'APPROVAL_DECIDER_REQUIRED: an approved request must record its approver';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    RAISE EXCEPTION 'APPROVAL_BINDING_IMMUTABLE: the decided digest and policy snapshot are immutable';
  END IF;
  IF OLD.state = 'APPROVED' AND NEW.state IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'APPROVAL_STATE_FINAL: an approved request is final';
  END IF;
  IF btrim(NEW.state) = '' THEN
    RAISE EXCEPTION 'APPROVAL_STATE_REQUIRED: an approval request requires a state';
  END IF;
  -- Only the structural approval outcome is named here; other values are reference
  -- data and are validated by the application, not by a growing CHECK list.
  IF NEW.state = 'APPROVED' AND NEW.decided_by IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_DECIDER_REQUIRED: an approved request must record its approver';
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
