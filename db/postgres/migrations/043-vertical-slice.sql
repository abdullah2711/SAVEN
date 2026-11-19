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
