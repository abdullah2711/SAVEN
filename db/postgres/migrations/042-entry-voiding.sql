-- PIVOT-005: terminal soft deletion of posted entries (entry voiding), D-013/D-014, ADR04.
--
-- Applied by the SEPARATE OFFLINE ADMINISTRATOR (superuser) because it provisions one
-- narrow NOLOGIN owner for the void primitive and transfers that single function to it.
-- Everything else is created as saven_migrator.
--
-- Role-agnostic by owner direction (D-014): this file contains NO business role names,
-- NO eligibility classes and NO void-specific read restriction. Voided entries are
-- readable at the database level by anyone with normal module access, within the
-- existing tenant/company/branch scope. Fine-grained visibility is future application
-- RBAC / User Access Settings work, not a database rule.
--
-- Model:
--   * A posted entry is retained byte-for-byte. Nothing is moved, copied or deleted.
--   * tenant_data.entry_voids is the append-only, tenant-scoped void record; its unique
--     (tenant_id, entry_id) makes exactly one terminal void possible per entry.
--   * A void has its own durable command receipt (command_inbox state VOIDED), audit
--     row, audit_event row and outbox row, all committed in one transaction.
--   * tenant_data.active_general_ledger and tenant_data.voided_entries are the canonical
--     effective projections. Consumers use the same inclusion rule; a voided journal is
--     excluded as a whole, never line by line.
--   * Read and delete authority are separate mechanisms: read is normal module access;
--     execution of tenant_data.void_posted_entry() requires the action permission
--     `accounting.entry.void` on a business role (reference action key, never a role
--     name in this file) or protected owner authority.
--
-- Installed 040 bytes are untouched. Its payload keeps the retained-source protection
-- and remains attached through the dispatcher; 042 adds its own payload version.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 042-entry-voiding.sql';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '042-entry-voiding.sql provisions a role and transfers function ownership: run it as the separate offline administrator (superuser)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_data') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql before 042-entry-voiding.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tenant_data' AND p.proname = 'immutability_040_command_guard'
  ) THEN
    RAISE EXCEPTION 'Run migrations/040-posted-immutability.sql before 042-entry-voiding.sql';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data' AND c.relname = 'entry_voids'
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: 042-entry-voiding.sql is already applied';
  END IF;
END $$;

-- =====================================================================
-- 1. Narrow, non-login owner for the void primitive only
-- =====================================================================

DO $$
DECLARE
  incompatible boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_void_definer') THEN
    SELECT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication
      INTO incompatible
    FROM pg_roles WHERE rolname = 'saven_void_definer';
    IF incompatible THEN
      RAISE EXCEPTION 'PIVOT-005: refused incompatible pre-existing role saven_void_definer; it must be NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION';
    END IF;
  ELSE
    EXECUTE 'CREATE ROLE saven_void_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION';
  END IF;
END $$;

COMMENT ON ROLE saven_void_definer IS
  'PIVOT-005: NOLOGIN owner of tenant_data.void_posted_entry() only. Fixed search_path, restricted EXECUTE, no DDL, no ownership beyond that one function, no superuser/BYPASSRLS.';

SET LOCAL ROLE saven_migrator;

-- =====================================================================
-- 2. Append-only void record and denial log
-- =====================================================================

CREATE TABLE tenant_data.entry_voids (
  tenant_id uuid NOT NULL,
  void_command_id text NOT NULL,
  entry_id text NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  actor_uuid uuid NOT NULL,
  original_state text NOT NULL,
  effective_state text NOT NULL,
  source_digest text NOT NULL,
  source_version bigint NOT NULL,
  source_line_count integer NOT NULL,
  request_digest text NOT NULL,
  idempotency_key text NOT NULL,
  correlation_id text,
  policy_version bigint,
  approval_version bigint,
  period_locked boolean NOT NULL,
  voided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_voids_pkey PRIMARY KEY (tenant_id, void_command_id),
  CONSTRAINT entry_voids_entry_key UNIQUE (tenant_id, entry_id),
  CONSTRAINT entry_voids_idempotency_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT entry_voids_entry_fkey FOREIGN KEY (tenant_id, entry_id)
    REFERENCES tenant_data.journals (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT entry_voids_command_fkey FOREIGN KEY (tenant_id, void_command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT entry_voids_actor_fkey FOREIGN KEY (actor_uuid, actor)
    REFERENCES auth.users (id, legacy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT entry_voids_transition CHECK (original_state = 'POSTED' AND effective_state = 'VOIDED'),
  CONSTRAINT entry_voids_reason_not_blank CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  CONSTRAINT entry_voids_actor_not_blank CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  CONSTRAINT entry_voids_key_not_blank CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT entry_voids_digest_not_blank CHECK (length(btrim(source_digest)) BETWEEN 1 AND 200),
  CONSTRAINT entry_voids_request_not_blank CHECK (length(btrim(request_digest)) BETWEEN 1 AND 200),
  CONSTRAINT entry_voids_version_positive CHECK (source_version > 0),
  CONSTRAINT entry_voids_lines_balanced CHECK (source_line_count >= 2)
);

COMMENT ON TABLE tenant_data.entry_voids IS
  'PIVOT-005: append-only terminal void record. One row per voided entry; the source journal, lines, command receipt, evidence and numbers remain physically retained and immutable.';
COMMENT ON COLUMN tenant_data.entry_voids.effective_state IS
  'Structural effective lifecycle of the retained source: VOIDED. The source itself stays historically POSTED.';
COMMENT ON COLUMN tenant_data.entry_voids.source_version IS
  'Accepted command receipt version (command_inbox.updated_at in epoch milliseconds) captured at void time.';
COMMENT ON COLUMN tenant_data.entry_voids.request_digest IS
  'Deterministic digest of the void request (entry, actor, reason, idempotency key) used to replay the same request without a second mutation.';
COMMENT ON COLUMN tenant_data.entry_voids.period_locked IS
  'Snapshot of the posting-period lock evaluated by the application policy at void time; voiding does not rewrite historical data.';

CREATE TABLE tenant_data.void_denials (
  tenant_id uuid NOT NULL,
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  entry_id text,
  actor text NOT NULL,
  actor_uuid uuid,
  attempt_key text,
  reason_code text NOT NULL,
  detail text NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT void_denials_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT void_denials_actor_not_blank CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  CONSTRAINT void_denials_reason_not_blank CHECK (length(btrim(reason_code)) BETWEEN 1 AND 120)
);

COMMENT ON TABLE tenant_data.void_denials IS
  'PIVOT-005: append-only durable denial log. A denied void raises and therefore cannot write its own audit row; the application/kernel records the refusal here in a separate transaction so failed attempts remain independently auditable.';

CREATE INDEX entry_voids_entry_idx ON tenant_data.entry_voids (tenant_id, entry_id);
CREATE INDEX void_denials_attempt_idx ON tenant_data.void_denials (tenant_id, attempted_at DESC);

-- =====================================================================
-- 3. Canonical effective projections (role-agnostic)
-- =====================================================================

CREATE VIEW tenant_data.active_general_ledger
WITH (security_invoker = true) AS
SELECT l.tenant_id,
       l.journal_id,
       l.line_no,
       j.company,
       j.branch,
       j.posting_date,
       j.narrative,
       l.account,
       l.debit,
       l.credit,
       j.created_at AS posted_at
FROM tenant_data.journal_lines l
JOIN tenant_data.journals j ON j.tenant_id = l.tenant_id AND j.id = l.journal_id
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_data.entry_voids v
  WHERE v.tenant_id = l.tenant_id AND v.entry_id = l.journal_id
);

COMMENT ON VIEW tenant_data.active_general_ledger IS
  'PIVOT-005: canonical active General Ledger projection. Excludes every line of a voided journal as a whole; the single inclusion rule for balances, trial balance, reports, exports, search and downstream consumers.';

CREATE VIEW tenant_data.voided_entries
WITH (security_invoker = true) AS
SELECT v.tenant_id,
       v.entry_id,
       v.void_command_id,
       v.reason,
       v.actor,
       v.actor_uuid,
       v.original_state,
       v.effective_state,
       v.source_digest,
       v.source_version,
       v.source_line_count,
       v.period_locked,
       v.policy_version,
       v.approval_version,
       v.correlation_id,
       v.voided_at,
       j.company,
       j.branch,
       j.posting_date,
       j.narrative,
       l.line_no,
       l.account,
       l.debit,
       l.credit
FROM tenant_data.entry_voids v
JOIN tenant_data.journals j ON j.tenant_id = v.tenant_id AND j.id = v.entry_id
LEFT JOIN tenant_data.journal_lines l ON l.tenant_id = j.tenant_id AND l.journal_id = j.id;

COMMENT ON VIEW tenant_data.voided_entries IS
  'PIVOT-005: canonical Deleted/Voided Entries projection. Retains the original posting data plus the void record and void time. Visibility is normal module access; fine-grained business visibility is deferred to future application RBAC (D-014).';

-- =====================================================================
-- 4. Forced RLS and atomic policies for the new tenant tables
--    (the established tenant-data policy shape; no void-specific policy)
-- =====================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['entry_voids', 'void_denials'] LOOP
    EXECUTE format('ALTER TABLE tenant_data.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant_data.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON tenant_data.%I AS PERMISSIVE FOR ALL TO PUBLIC '
      'USING (tenant_id = tenant_data.current_tenant_id()) '
      'WITH CHECK (tenant_id = tenant_data.current_tenant_id())',
      t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON tenant_data.%I AS RESTRICTIVE FOR ALL TO PUBLIC '
      'USING (tenant_id = tenant_data.current_tenant_id()) '
      'WITH CHECK (tenant_id = tenant_data.current_tenant_id())',
      t || '_tenant_scope', t);
    EXECUTE format(
      'CREATE POLICY %I ON tenant_data.%I AS RESTRICTIVE FOR ALL TO %I '
      'USING (tenant_id = tenant_data.current_tenant_id() '
      'AND tenant_data.session_admitted(tenant_data.current_tenant_id(), tenant_data.current_user_id())) '
      'WITH CHECK (tenant_id = tenant_data.current_tenant_id() '
      'AND tenant_data.session_admitted(tenant_data.current_tenant_id(), tenant_data.current_user_id()))',
      t || '_runtime_admission', t, 'saven_customer_app');
  END LOOP;
END $$;

-- =====================================================================
-- 5. The atomic void primitive
-- =====================================================================

CREATE FUNCTION tenant_data.void_posted_entry(
  p_tenant uuid,
  p_entry text,
  p_actor text,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id text DEFAULT NULL,
  p_policy_version bigint DEFAULT NULL,
  p_approval_version bigint DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_now_ms bigint;
  v_request_digest text;
  v_existing_entry text;
  v_existing_digest text;
  v_command_state text;
  v_source_digest text;
  v_source_version bigint;
  v_line_count integer;
  v_debit numeric;
  v_credit numeric;
  v_period_locked boolean;
  v_actor text;
  v_allowed boolean;
  v_void_command text;
  v_payload jsonb;
BEGIN
  -- Context and identity: verified transaction-local tenant/user only.
  IF p_tenant IS NULL OR p_entry IS NULL OR p_actor IS NULL OR p_reason IS NULL
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'VOID_ARGUMENTS_REQUIRED';
  END IF;
  IF p_tenant IS DISTINCT FROM tenant_data.current_tenant_id() THEN
    RAISE EXCEPTION 'VOID_TENANT_CONTEXT_MISMATCH';
  END IF;
  IF NOT tenant_data.session_admitted(p_tenant, tenant_data.current_user_id()) THEN
    RAISE EXCEPTION 'VOID_CONTEXT_REQUIRED';
  END IF;
  IF length(btrim(p_reason)) = 0 OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'VOID_ARGUMENTS_REQUIRED';
  END IF;

  SELECT m.user_id INTO v_actor
  FROM tenant_data.members m
  WHERE m.tenant_id = p_tenant AND m.user_uuid = tenant_data.current_user_id() AND m.active;
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'VOID_ACTOR_MISMATCH';
  END IF;

  v_request_digest := encode(sha256(convert_to(
    concat_ws('|', p_entry, p_actor, p_reason, p_idempotency_key), 'UTF8')), 'hex');

  -- Idempotent replay: the same key returns the original result, never a second event.
  SELECT v.void_command_id, v.request_digest INTO v_existing_entry, v_existing_digest
  FROM tenant_data.entry_voids v
  WHERE v.tenant_id = p_tenant AND v.idempotency_key = p_idempotency_key;
  IF v_existing_entry IS NOT NULL THEN
    IF v_existing_digest = v_request_digest THEN
      RETURN v_existing_entry;
    END IF;
    RAISE EXCEPTION 'VOID_IDEMPOTENCY_CONFLICT';
  END IF;

  -- Serialize concurrent voids on the same entry without taking an UPDATE lock on
  -- the retained source: the journal row stays physically immutable, and the unique
  -- (tenant_id, entry_id) key is the final exactly-once guard.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_entry, 0));
  PERFORM 1 FROM tenant_data.journals j WHERE j.tenant_id = p_tenant AND j.id = p_entry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOID_ENTRY_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tenant_data.entry_voids v
    WHERE v.tenant_id = p_tenant AND v.entry_id = p_entry
  ) THEN
    RAISE EXCEPTION 'ENTRY_ALREADY_VOIDED';
  END IF;

  SELECT c.state, c.digest, c.updated_at INTO v_command_state, v_source_digest, v_source_version
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = p_tenant AND c.id = p_entry;
  IF v_command_state IS NULL THEN
    RAISE EXCEPTION 'VOID_ENTRY_NOT_FOUND';
  END IF;
  IF v_command_state IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'VOID_ENTRY_NOT_POSTED';
  END IF;

  -- Independently verified action authority. The action key is reference data owned by
  -- the tenant role configuration; no business role name is hardcoded here.
  SELECT EXISTS (
    SELECT 1
    FROM tenant_data.members m
    JOIN tenant_data.assignments a ON a.tenant_id = m.tenant_id AND a.user_id = m.user_id
    JOIN tenant_data.roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
    WHERE m.tenant_id = p_tenant AND m.user_uuid = tenant_data.current_user_id() AND m.active
      AND (
        r.protected
        OR (r.permissions IS JSON
            AND jsonb_typeof(r.permissions::jsonb -> 'accounting.entry.void') = 'boolean'
            AND (r.permissions::jsonb ->> 'accounting.entry.void')::boolean)
      )
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'VOID_ACTION_REQUIRED';
  END IF;

  -- Supported dependency graph: a plain journal. Linked operational or correction
  -- dependencies are refused explicitly and never partially voided.
  IF EXISTS (SELECT 1 FROM tenant_data.trade_operations WHERE tenant_id = p_tenant AND command_id = p_entry)
     OR EXISTS (SELECT 1 FROM tenant_data.stock_operations WHERE tenant_id = p_tenant AND command_id = p_entry) THEN
    RAISE EXCEPTION 'VOID_DEPENDENCY_UNSUPPORTED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tenant_data.journal_corrections
    WHERE tenant_id = p_tenant AND (original_id = p_entry OR command_id = p_entry)
  ) OR EXISTS (
    SELECT 1 FROM tenant_data.trade_credits WHERE tenant_id = p_tenant AND original_id = p_entry
  ) THEN
    RAISE EXCEPTION 'VOID_LINKED_CORRECTION';
  END IF;

  -- Balanced retained source; a void never removes a partial journal.
  SELECT count(*), coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
    INTO v_line_count, v_debit, v_credit
  FROM tenant_data.journal_lines l
  WHERE l.tenant_id = p_tenant AND l.journal_id = p_entry;
  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'VOID_SOURCE_INCOMPLETE';
  END IF;
  IF v_debit <> v_credit OR v_debit <= 0 THEN
    RAISE EXCEPTION 'VOID_SOURCE_UNBALANCED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM tenant_data.periods p
    JOIN tenant_data.journals j ON j.tenant_id = p.tenant_id AND j.company = p.company
    WHERE j.tenant_id = p_tenant AND j.id = p_entry
      AND p.start_date <= j.posting_date AND p.end_date >= j.posting_date AND p.locked
  ) INTO v_period_locked;

  v_now_ms := (extract(epoch FROM now()) * 1000)::bigint;
  v_void_command := gen_random_uuid()::text;

  -- Atomic effect bundle: receipt, native audit, change audit, outbox, void record.
  INSERT INTO tenant_data.command_inbox
    (tenant_id, id, actor, digest, payload, state, created_at, updated_at)
  VALUES (p_tenant, v_void_command, p_actor, v_request_digest,
          jsonb_build_object(
            'kind', 'ENTRY_VOID',
            'entry', p_entry,
            'reason', p_reason,
            'requestDigest', v_request_digest,
            'correlationId', p_correlation_id,
            'policyVersion', p_policy_version,
            'approvalVersion', p_approval_version
          )::text,
          'VOIDED', v_now_ms, v_now_ms);

  INSERT INTO tenant_data.audit
    (tenant_id, command_id, actor, event, detail, happened_at)
  VALUES (p_tenant, v_void_command, p_actor, 'ENTRY_VOIDED',
          jsonb_build_object(
            'entry', p_entry,
            'before', jsonb_build_object('included', true, 'state', 'POSTED'),
            'after', jsonb_build_object('included', false, 'state', 'VOIDED'),
            'effect', 'remove_all_lines_from_active_ledger',
            'lines', v_line_count,
            'debit', v_debit,
            'credit', v_credit,
            'reason', p_reason,
            'requestDigest', v_request_digest
          )::text,
          v_now_ms);

  INSERT INTO tenant_data.audit_event
    (tenant_id, actor_id, event, entity_type, entity_id, detail_jsonb, origin_type, origin_user_id, request_id)
  VALUES (p_tenant, p_actor, 'ENTRY_VOIDED', 'journal', p_entry,
          jsonb_build_object(
            'before', jsonb_build_object('included', true, 'state', 'POSTED'),
            'after', jsonb_build_object('included', false, 'state', 'VOIDED'),
            'reason', p_reason,
            'lines', v_line_count,
            'debit', v_debit,
            'credit', v_credit,
            'periodLocked', v_period_locked,
            'requestDigest', v_request_digest
          ),
          'human', p_actor, p_correlation_id);

  INSERT INTO tenant_data.outbox (tenant_id, id, event, state, attempts)
  VALUES (p_tenant, v_void_command, 'ENTRY_VOIDED', 'READY', 0);

  INSERT INTO tenant_data.entry_voids
    (tenant_id, void_command_id, entry_id, reason, actor, actor_uuid,
     original_state, effective_state, source_digest, source_version, source_line_count,
     request_digest, idempotency_key, correlation_id, policy_version, approval_version, period_locked)
  VALUES (p_tenant, v_void_command, p_entry, p_reason, p_actor, tenant_data.current_user_id(),
          'POSTED', 'VOIDED', v_source_digest, v_source_version, v_line_count,
          v_request_digest, p_idempotency_key, p_correlation_id, p_policy_version,
          p_approval_version, v_period_locked);

  RETURN v_void_command;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, bigint, bigint) IS
  'PIVOT-005: single audited atomic terminal-void primitive. Verifies verified context, actor mapping, action authority, posted state and the supported dependency graph; writes receipt, native audit, change audit, outbox and the append-only void record in one transaction. Role-agnostic visibility per D-014.';

-- =====================================================================
-- 6. Payload 042: immutable void record, receipt and denial log
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_042_void_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_receipt_state text;
  v_receipt_digest text;
  v_posted text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VOID_RETAINED: void records are append-only and cannot be removed';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'VOIDED_IMMUTABLE: a void record cannot be edited, unvoided or repeated';
  END IF;

  SELECT c.state, (c.payload::jsonb) #>> '{requestDigest}' INTO v_receipt_state, v_receipt_digest
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.void_command_id;
  IF v_receipt_state IS DISTINCT FROM 'VOIDED' OR v_receipt_digest IS DISTINCT FROM NEW.request_digest THEN
    RAISE EXCEPTION 'VOID_RECEIPT_INVALID: the void record must match its VOIDED command receipt';
  END IF;

  SELECT c.state INTO v_posted
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.entry_id;
  IF v_posted IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'VOID_ENTRY_NOT_POSTED: only a posted entry can be voided';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_data.audit a
    WHERE a.tenant_id = NEW.tenant_id AND a.command_id = NEW.void_command_id AND a.event = 'ENTRY_VOIDED'
  ) THEN
    RAISE EXCEPTION 'VOID_REQUIRES_AUDIT: the void audit row must be written in the same transaction';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_data.outbox o
    WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.void_command_id
  ) THEN
    RAISE EXCEPTION 'VOID_REQUIRES_OUTBOX: the void outbox row must be written in the same transaction';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_042_receipt_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VOID_RECEIPT_RETAINED: terminal receipts are retained';
  END IF;
  IF OLD.state = 'VOIDED' THEN
    RAISE EXCEPTION 'VOID_RECEIPT_IMMUTABLE: a VOIDED receipt is final';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_042_denial_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'VOID_DENIAL_RETAINED: denial records are append-only';
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_042_void_audit_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  IF OLD.event = 'ENTRY_VOIDED' THEN
    RAISE EXCEPTION 'VOID_AUDIT_IMMUTABLE: void audit rows are retained and immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION tenant_data.immutability_042_void_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_042_receipt_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_042_denial_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_042_void_audit_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_042_void_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_042_receipt_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_042_denial_guard() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_042_void_audit_guard() TO saven_customer_app;

-- =====================================================================
-- 7. Exactly the privileges the primitive needs, and the runtime interface
-- =====================================================================

-- Runtime: read projections and the void record, log denials, execute the primitive.
-- No INSERT/UPDATE/DELETE on entry_voids, so a void cannot bypass the primitive.
GRANT USAGE ON SCHEMA tenant_data TO saven_customer_app;
GRANT SELECT ON tenant_data.entry_voids, tenant_data.void_denials TO saven_customer_app;
GRANT INSERT ON tenant_data.void_denials TO saven_customer_app;
GRANT SELECT ON tenant_data.active_general_ledger, tenant_data.voided_entries TO saven_customer_app;
REVOKE ALL ON FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, bigint, bigint)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, bigint, bigint)
  TO saven_customer_app;

-- Definer: exactly what the primitive body reads and writes.
GRANT USAGE ON SCHEMA tenant_data TO saven_void_definer;
GRANT SELECT ON
  tenant_data.journals,
  tenant_data.journal_lines,
  tenant_data.command_inbox,
  tenant_data.entry_voids,
  tenant_data.members,
  tenant_data.roles,
  tenant_data.assignments,
  tenant_data.periods,
  tenant_data.trade_operations,
  tenant_data.trade_documents,
  tenant_data.trade_credits,
  tenant_data.stock_operations,
  tenant_data.journal_corrections,
  tenant_data.audit,
  tenant_data.outbox
TO saven_void_definer;
GRANT INSERT ON
  tenant_data.command_inbox,
  tenant_data.entry_voids,
  tenant_data.audit,
  tenant_data.audit_event,
  tenant_data.outbox
TO saven_void_definer;
GRANT EXECUTE ON FUNCTION tenant_data.current_tenant_id() TO saven_void_definer;
GRANT EXECUTE ON FUNCTION tenant_data.current_user_id() TO saven_void_definer;

-- No auth or operator role may reach tenant data, and PUBLIC gets nothing new.
REVOKE ALL ON SCHEMA tenant_data FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM PUBLIC;
REVOKE ALL ON SCHEMA tenant_data FROM saven_auth_service, saven_auth_definer;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM saven_auth_service, saven_auth_definer;
REVOKE ALL ON SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin, saven_operator_definer;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin, saven_operator_definer;

-- =====================================================================
-- 8. Validate the authority boundary of this correction, then hand the
--    primitive to its narrow owner
-- =====================================================================

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'tenant_data' AND c.relname IN ('entry_voids', 'void_denials')
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-005: new tables must be forced and isolated: %', bad;
  END IF;

  -- No business-role name or eligibility artifact is introduced by 042.
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data' AND c.relname LIKE '%eligib%'
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: role-agnostic correction forbids eligibility objects';
  END IF;

  -- The definer owns only the primitive.
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE r.rolname = 'saven_void_definer' AND p.proname <> 'void_posted_entry';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-005: saven_void_definer owns unexpected function(s): %', bad;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO bad
  FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
  WHERE r.rolname = 'saven_void_definer';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-005: saven_void_definer must not own relations: %', bad;
  END IF;

  SELECT string_agg(n.nspname, ', ') INTO bad
  FROM pg_namespace n WHERE n.nspowner = (SELECT oid FROM pg_roles WHERE rolname = 'saven_void_definer');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-005: saven_void_definer must not own schemas: %', bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles g ON g.oid = am.roleid
    WHERE m.rolname = 'saven_void_definer' OR g.rolname = 'saven_void_definer'
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: saven_void_definer must hold no role membership';
  END IF;
END $$;

RESET ROLE;

-- session_admitted() is owned by the admission definer, so only the administrator may
-- grant EXECUTE on it to another principal.
GRANT EXECUTE ON FUNCTION tenant_data.session_admitted(uuid, uuid) TO saven_void_definer;

ALTER FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, bigint, bigint)
  OWNER TO saven_void_definer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = 'tenant_data.void_posted_entry(uuid, text, text, text, text, text, bigint, bigint)'::regprocedure
      AND r.rolname = 'saven_void_definer'
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: void primitive ownership transfer failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'tenant_data.void_posted_entry(uuid, text, text, text, text, text, bigint, bigint)'::regprocedure
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=pg_catalog, tenant_data']
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: void primitive must remain SECURITY DEFINER with a fixed search_path';
  END IF;
END $$;

COMMIT;
