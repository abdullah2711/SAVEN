-- PIVOT-014 — narrow runtime interface for the authenticated journal lifecycle.
--
-- Purpose: the accepted terminal-void primitive (042) and the two accepted ledger
-- projections (042) exist but were never granted to the tenant runtime role, so no
-- application request could use them without an administrator connection. This
-- migration grants exactly three runtime capabilities and nothing else.
--
-- Boundaries:
--   * No table ownership, no schema CREATE, no role attribute change, no BYPASSRLS.
--   * No new cross-tenant authority: every granted object is already tenant-filtered by
--     RLS or by the primitive's own verified-context checks.
--   * No payload bytes are rewritten; 040/041/042 and the base files are untouched.
--   * Offline/administrator application only (member of saven_migrator). Autonomous:
--     owns BEGIN/COMMIT so a statement-by-statement runner cannot leave it half-applied.
--   * Idempotent: a second application is a verified no-op.

BEGIN;

DO $preflight$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_owner oid;
  v_expected_owner oid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 043-vertical-slice.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER')
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run 043-vertical-slice.sql as a member of saven_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_customer_app') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 043-vertical-slice.sql';
  END IF;
  IF to_regprocedure('tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)') IS NULL THEN
    v_missing := v_missing || 'tenant_data.void_posted_entry(uuid,text,text,text,text,text,text)';
  END IF;
  IF to_regclass('tenant_data.active_general_ledger') IS NULL THEN
    v_missing := v_missing || 'tenant_data.active_general_ledger';
  END IF;
  IF to_regclass('tenant_data.voided_entries') IS NULL THEN
    v_missing := v_missing || 'tenant_data.voided_entries';
  END IF;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION '042-entry-voiding.sql must be applied first; missing: %', array_to_string(v_missing, ', ');
  END IF;

  -- Refuse a hijacked primitive: the void function must still be owned by the dedicated
  -- non-login definer, and the runtime must not be that owner.
  SELECT p.proowner INTO v_owner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'tenant_data' AND p.proname = 'void_posted_entry';
  SELECT oid INTO v_expected_owner FROM pg_roles WHERE rolname = 'saven_void_definer';
  IF v_expected_owner IS NULL OR v_owner IS DISTINCT FROM v_expected_owner THEN
    RAISE EXCEPTION '043 refuses: tenant_data.void_posted_entry is not owned by saven_void_definer';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname = 'saven_customer_app'
      AND (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolcanlogin)
  ) THEN
    RAISE EXCEPTION '043 refuses: saven_customer_app has privileged attributes';
  END IF;
END
$preflight$;

DO $apply$
BEGIN
  -- The accepted primitive performs its own verified-context, actor and policy checks.
  EXECUTE 'GRANT EXECUTE ON FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, text) TO saven_customer_app';
  -- The projections are security_invoker views; the runtime still needs SELECT on them
  -- and RLS on the underlying tables continues to apply.
  EXECUTE 'GRANT SELECT ON tenant_data.active_general_ledger TO saven_customer_app';
  EXECUTE 'GRANT SELECT ON tenant_data.voided_entries TO saven_customer_app';
END
$apply$;

DO $ledger$
BEGIN
  IF to_regclass('operator.pg_schema_migrations') IS NOT NULL THEN
    INSERT INTO operator.pg_schema_migrations (version, description, checksum)
    VALUES (43, 'PIVOT-014 narrow runtime grants: terminal void + ledger projections',
            'pivot-014-vertical-slice-v1')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END
$ledger$;

COMMIT;

BEGIN;

-- =====================================================================
-- PIVOT-014 Amendment B — immutable allocation receipt (consumed identity)
--
-- Binds a permanent document-number identity to the verified actor, tenant scope and
-- accepted request digest at the moment it is consumed. Consequences that matter:
--   * only the identical original request may recover the receipt;
--   * a different actor or content receives a conflict instead of someone else's number;
--   * the row outlives a failed business transaction, so a consumed identity leaves
--     permanent evidence and is never reissued (gaps are permitted, never back-filled).
--
-- Tenant-leading, forced RLS, append-only, narrow SELECT/INSERT for the runtime.
-- No accepted payload byte, fingerprinted table or existing grant is touched.
-- =====================================================================

DO $alloc_preflight$
BEGIN
  IF to_regclass('tenant_data.document_numbers') IS NULL THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql before 043-vertical-slice.sql';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname IN ('document_allocations') AND NOT t.tgisinternal
      AND t.tgname <> 'document_allocations_no_change'
  ) THEN
    RAISE EXCEPTION '043 refuses a pre-existing conflicting trigger on document_allocations';
  END IF;
END
$alloc_preflight$;

CREATE TABLE IF NOT EXISTS tenant_data.document_allocations (
  tenant_id uuid NOT NULL,
  allocation_id text NOT NULL,
  company text NOT NULL,
  kind text NOT NULL,
  sequence integer NOT NULL,
  number text NOT NULL,
  actor text NOT NULL,
  request_digest text NOT NULL,
  state text NOT NULL DEFAULT 'CONSUMED',
  consumed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_allocations_pkey PRIMARY KEY (tenant_id, allocation_id),
  CONSTRAINT document_allocations_scope_key UNIQUE (tenant_id, company, kind, sequence),
  CONSTRAINT document_allocations_id_not_blank CHECK (length(btrim(allocation_id)) BETWEEN 8 AND 200),
  CONSTRAINT document_allocations_actor_not_blank CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  CONSTRAINT document_allocations_digest_not_blank CHECK (length(btrim(request_digest)) BETWEEN 1 AND 200),
  CONSTRAINT document_allocations_sequence_positive CHECK (sequence > 0),
  CONSTRAINT document_allocations_state_consumed CHECK (state = 'CONSUMED')
);

COMMENT ON TABLE tenant_data.document_allocations IS
  'PIVOT-014 Amendment B: immutable consumed-identity receipt. Binds a document number to the verified actor, scope and accepted request digest. Append-only; deletion and rewriting are refused.';

ALTER TABLE tenant_data.document_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data.document_allocations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_allocations_tenant_select ON tenant_data.document_allocations;
CREATE POLICY document_allocations_tenant_select ON tenant_data.document_allocations
  FOR SELECT
  USING (tenant_id = tenant_data.current_tenant_id());

DROP POLICY IF EXISTS document_allocations_tenant_insert ON tenant_data.document_allocations;
CREATE POLICY document_allocations_tenant_insert ON tenant_data.document_allocations
  FOR INSERT
  WITH CHECK (
    tenant_id = tenant_data.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM tenant_data.members m
      WHERE m.tenant_id = tenant_data.current_tenant_id()
        AND m.user_id = document_allocations.actor
        AND m.user_uuid = tenant_data.current_user_id()
        AND m.active
    )
  );

CREATE OR REPLACE FUNCTION tenant_data.immutability_043_allocation_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  RAISE EXCEPTION 'ALLOCATION_RECEIPT_RETAINED: an allocation receipt is immutable and retained';
END;
$fn$;

DROP TRIGGER IF EXISTS document_allocations_no_change ON tenant_data.document_allocations;
CREATE TRIGGER document_allocations_no_change
  BEFORE UPDATE OR DELETE ON tenant_data.document_allocations
  FOR EACH ROW EXECUTE FUNCTION tenant_data.immutability_043_allocation_guard();

REVOKE ALL ON tenant_data.document_allocations FROM PUBLIC;
REVOKE ALL ON tenant_data.document_allocations FROM saven_auth_service, saven_auth_definer,
  saven_operator_read, saven_operator_admin, saven_operator_definer;
GRANT SELECT, INSERT ON tenant_data.document_allocations TO saven_customer_app;

COMMIT;

BEGIN;

-- =====================================================================
-- PIVOT-014 Amendment B — nontransactional consumed identity
--
-- A sequence is the only mechanism whose advance survives a rollback, so an identity
-- consumed by a failed allocation can never be reissued (D-016: gaps stay gaps). The
-- per-scope counter row becomes a monotonic high-water mirror and is no longer the
-- source of the number. Existing profile is validated before activation.
-- =====================================================================

DO $sequence_profile$
DECLARE
  v_owner text;
BEGIN
  IF to_regclass('tenant_data.document_allocations') IS NULL THEN
    RAISE EXCEPTION '043 refuses to activate the consumption sequence without the allocation receipt';
  END IF;
  IF to_regclass('tenant_data.document_number_consumption') IS NOT NULL THEN
    SELECT pg_get_userbyid(relowner) INTO v_owner
    FROM pg_class WHERE oid = to_regclass('tenant_data.document_number_consumption');
    IF v_owner IS DISTINCT FROM 'saven_migrator' THEN
      RAISE EXCEPTION '043 refuses an existing consumption sequence owned by %', v_owner;
    END IF;
  END IF;
END
$sequence_profile$;

CREATE SEQUENCE IF NOT EXISTS tenant_data.document_number_consumption
  AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 999999999 NO CYCLE;
ALTER SEQUENCE tenant_data.document_number_consumption OWNER TO saven_migrator;
REVOKE ALL ON SEQUENCE tenant_data.document_number_consumption FROM PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE tenant_data.document_number_consumption TO saven_customer_app;

COMMENT ON SEQUENCE tenant_data.document_number_consumption IS
  'PIVOT-014 Amendment B: nontransactional consumed-identity source. A rollback can never rewind an allocated value; document_sequences.next_number is retained only as a monotonic high-water mirror.';

COMMIT;
