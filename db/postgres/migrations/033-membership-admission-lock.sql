-- AUTH-006-R3 authority gate (ENGINEER R2 AMENDMENT, 17 November 2026).
--
-- One fixed transaction-scoped advisory gate serializes authority mutations against
-- admitted business work:
--
--   * admission takes the gate SHARED on the auth transaction before reading or locking
--     any authority, and keeps it until the business transaction completes;
--   * every INSERT/UPDATE/DELETE on auth.tenant_membership or auth.roles takes the same
--     gate EXCLUSIVELY through BEFORE STATEMENT triggers, before row writes.
--
-- Concurrent admissions share the gate; authority writes (membership inserts/activations/
-- revocations/epochs and assurance-role requirement/effectiveness changes) contend
-- globally and wait for admitted business work to finish. This deliberately trades rare
-- authority-write concurrency for a single deterministic order: gate -> users -> factor
-- -> session -> membership/role reads -> business client/transaction.
--
-- The gate is infrastructure, not a configurable business rule or role domain. Future
-- writers combining authority changes with principal/session/factor updates must take the
-- same gate first. Arbitrary administrative SQL that violates the ordering can still
-- deadlock; the runtime must fail closed and destroy its client on gate acquisition or
-- cleanup failure rather than bypass or silently retry.
--
-- Additive only: no table/column change, no RLS change, no runtime EXECUTE/UPDATE grant,
-- no SECURITY DEFINER, no BYPASSRLS, no dynamic SQL, no business data mutation.

DO $guard$
DECLARE
  conflicting text;
BEGIN
  SELECT string_agg(format('%s.%s', c.relname, t.tgname), ', ' ORDER BY c.relname, t.tgname)
    INTO conflicting
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'auth'
    AND c.relname IN ('tenant_membership', 'roles')
    AND NOT t.tgisinternal
    AND t.tgname LIKE '%authority_gate%';
  IF conflicting IS NOT NULL THEN
    RAISE EXCEPTION 'AUTH-006 033 refuses pre-existing authority-gate triggers: %', conflicting;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'lock_authority_gate'
  ) THEN
    RAISE EXCEPTION 'AUTH-006 033 refuses pre-existing function auth.lock_authority_gate()';
  END IF;
END
$guard$;

CREATE FUNCTION auth.lock_authority_gate() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('saven.auth.authority_gate', 0));
  RETURN NULL;
END;
$fn$;

ALTER FUNCTION auth.lock_authority_gate() OWNER TO saven_migrator;
REVOKE ALL ON FUNCTION auth.lock_authority_gate() FROM PUBLIC;

COMMENT ON FUNCTION auth.lock_authority_gate() IS
  'AUTH-006-R3: BEFORE STATEMENT authority writer gate. Takes the exclusive transaction-scoped key saven.auth.authority_gate; admission holds it shared until business completion.';

CREATE TRIGGER tenant_membership_authority_gate_insert
  BEFORE INSERT ON auth.tenant_membership
  FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();
CREATE TRIGGER tenant_membership_authority_gate_update
  BEFORE UPDATE ON auth.tenant_membership
  FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();
CREATE TRIGGER tenant_membership_authority_gate_delete
  BEFORE DELETE ON auth.tenant_membership
  FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();

CREATE TRIGGER roles_authority_gate_insert
  BEFORE INSERT ON auth.roles
  FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();
CREATE TRIGGER roles_authority_gate_update
  BEFORE UPDATE ON auth.roles
  FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();
CREATE TRIGGER roles_authority_gate_delete
  BEFORE DELETE ON auth.roles
  FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();

COMMENT ON TRIGGER tenant_membership_authority_gate_insert ON auth.tenant_membership IS
  'AUTH-006-R3: new membership associations serialize against admitted business work.';
COMMENT ON TRIGGER tenant_membership_authority_gate_update ON auth.tenant_membership IS
  'AUTH-006-R3: membership status/role/epoch changes serialize against admitted business work.';
COMMENT ON TRIGGER tenant_membership_authority_gate_delete ON auth.tenant_membership IS
  'AUTH-006-R3: membership removal serializes against admitted business work.';
COMMENT ON TRIGGER roles_authority_gate_insert ON auth.roles IS
  'AUTH-006-R3: new assurance-role definitions serialize against admitted business work.';
COMMENT ON TRIGGER roles_authority_gate_update ON auth.roles IS
  'AUTH-006-R3: requires_mfa/is_active/effective-date changes serialize against admitted business work.';
COMMENT ON TRIGGER roles_authority_gate_delete ON auth.roles IS
  'AUTH-006-R3: role removal serializes against admitted business work.';
