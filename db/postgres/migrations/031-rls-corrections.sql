-- PIVOT-004-R1: additive correction after 30-rls-policies.sql.
--
-- Applied by the SEPARATE OFFLINE ADMINISTRATOR, not by a runtime principal and not
-- by the ordinary migration login: it provisions one new NOLOGIN role and transfers
-- one function's ownership, which the ordinary saven_migrator membership cannot do.
-- Everything else (policies, constraints, indexes, grants) is created as
-- saven_migrator so object ownership stays with the offline DDL role.
--
-- It corrects four review findings without editing any delivered file:
--   1. auth.tenant_membership had no isolation. It now has ENABLE + FORCE RLS with
--      two narrow, principal-bound policies: a preselection read for the auth
--      service bound to the verified user in transaction context, and a single-pair
--      admission lookup for the dedicated admission owner. No policy is TO PUBLIC
--      and no policy is a blanket `USING (true)`.
--   2. The admission function was SECURITY DEFINER-owned by saven_migrator, the role
--      that owns every schema and all DDL. Ownership moves to the new
--      saven_tenant_admission_definer, which holds only the exact column reads the
--      helper needs. The helper also binds its arguments to verified transaction
--      context, so it is not an arbitrary-principal membership oracle.
--   3. Scoped references were incomplete: journals, periods, journal_drafts,
--      document_registry, trade_controls and trade_parties now constrain their
--      company to tenant_data.company_profiles. Payload-only and branch-only
--      relationships are inventoried in db/postgres/README.md as application-level.
--   4. Runtime sequence access is no longer blanket: the customer runtime keeps only
--      the identity sequence it actually inserts through, and the trigger-only
--      audit_event sequence is withheld.
--
-- Rollback of this file is a normal transaction rollback; no delivered bytes are
-- rewritten, no data is repaired or deleted, and every constraint is added NOT VALID
-- and then VALIDATED so incompatible pre-existing rows fail loudly instead of being
-- silently repaired.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 031-rls-corrections.sql';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '031-rls-corrections.sql provisions a role and transfers function ownership: run it as the separate offline administrator (superuser), not as a runtime or migration principal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_data')
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE EXCEPTION 'Run 05-auth-schema.sql and 20-tenant-schema.sql before 031-rls-corrections.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tenant_data' AND p.proname = 'session_admitted'
  ) THEN
    RAISE EXCEPTION 'Run 30-rls-policies.sql before 031-rls-corrections.sql';
  END IF;
  -- Refuse a second application rather than partially re-doing a correction. One
  -- deterministic marker per corrected area is checked.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data' AND c.relname = 'journals' AND con.conname = 'journals_company_fkey'
  ) OR EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership' AND p.polname = 'tenant_membership_preselect'
  ) THEN
    RAISE EXCEPTION 'PIVOT-004-R1: 031-rls-corrections.sql is already applied';
  END IF;
END $$;

-- =====================================================================
-- 1. Provision the dedicated, least-privileged admission owner
--
-- Created only if absent; an existing role is validated and never altered. The
-- definition is the same constrained shape as every SAVEN role.
-- =====================================================================

DO $$
DECLARE
  incompatible boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_tenant_admission_definer') THEN
    SELECT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication
      INTO incompatible
    FROM pg_roles WHERE rolname = 'saven_tenant_admission_definer';
    IF incompatible THEN
      RAISE EXCEPTION 'PIVOT-004-R1: refused incompatible pre-existing role saven_tenant_admission_definer; it must be NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION';
    END IF;
  ELSE
    EXECUTE 'CREATE ROLE saven_tenant_admission_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION';
  END IF;
END $$;

COMMENT ON ROLE saven_tenant_admission_definer IS
  'PIVOT-004-R1: NOLOGIN owner of tenant_data.session_admitted() only. Holds column-level reads on the canonical membership/identity rows and the tenant principal projection; no table ownership, no DDL, no superuser, no BYPASSRLS, no runtime membership.';

SET LOCAL ROLE saven_migrator;

-- =====================================================================
-- 2. Bind the admission helper to verified transaction context
--
-- The arguments must equal the verified transaction context, so a runtime that can
-- call the helper cannot use it to probe arbitrary (tenant, user) membership pairs.
-- The body still reads only status/active columns and returns a boolean.
-- =====================================================================

CREATE OR REPLACE FUNCTION tenant_data.session_admitted(p_tenant uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, auth, tenant_data
AS $fn$
  SELECT p_tenant IS NOT NULL
     AND p_user IS NOT NULL
     AND p_tenant = tenant_data.current_tenant_id()
     AND p_user = tenant_data.current_user_id()
     AND EXISTS (
       SELECT 1 FROM tenant_data.members m
       WHERE m.tenant_id = p_tenant AND m.user_uuid = p_user AND m.active
     )
     AND EXISTS (
       SELECT 1 FROM auth.tenant_membership tm
       WHERE tm.tenant_id = p_tenant AND tm.user_id = p_user
         AND tm.status = 'active'
         AND tm.revoked_at IS NULL
         AND tm.suspended_at IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM auth.users u
       WHERE u.id = p_user AND u.status = 'active'
     )
$fn$;

COMMENT ON FUNCTION tenant_data.session_admitted(uuid, uuid) IS
  'PIVOT-004-R1: true only when the arguments equal the verified transaction context AND that tenant/user pair has an active canonical membership, an active tenant principal and an active identity. Boolean only; arbitrary-principal probing returns false.';

-- =====================================================================
-- 3. Forced membership isolation on auth.tenant_membership
--
-- Only tenant_membership is tenant-scoped identity data. auth.users and
-- auth.sessions are global principal/service records: they keep their own service
-- authority and are deliberately NOT given blanket tenant policies here.
--
-- The two policies are principal-bound and scoped:
--   * preselection: the auth service reads the memberships of the verified user in
--     transaction context, to list that user's businesses before a tenant is chosen.
--   * admission lookup: the dedicated owner reads exactly the one (tenant, user)
--     pair in transaction context. Nothing else is visible to it.
-- No policy targets PUBLIC, the migration role, the customer runtime or an operator
-- role, so default-deny applies to every other caller.
-- =====================================================================

ALTER TABLE auth.tenant_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.tenant_membership FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_membership_preselect ON auth.tenant_membership
  AS PERMISSIVE FOR SELECT TO saven_auth_service
  USING (
    user_id = CASE
      WHEN pg_input_is_valid(nullif(current_setting('app.current_user_id', true), ''), 'uuid')
      THEN nullif(current_setting('app.current_user_id', true), '')::uuid
    END
  );

CREATE POLICY tenant_membership_admission_lookup ON auth.tenant_membership
  AS PERMISSIVE FOR SELECT TO saven_tenant_admission_definer
  USING (
    tenant_id = CASE
      WHEN pg_input_is_valid(nullif(current_setting('app.current_tenant_id', true), ''), 'uuid')
      THEN nullif(current_setting('app.current_tenant_id', true), '')::uuid
    END
    AND user_id = CASE
      WHEN pg_input_is_valid(nullif(current_setting('app.current_user_id', true), ''), 'uuid')
      THEN nullif(current_setting('app.current_user_id', true), '')::uuid
    END
  );

COMMENT ON POLICY tenant_membership_preselect ON auth.tenant_membership IS
  'PIVOT-004-R1: principal-bound preselection. The auth service sees only memberships of the verified user in transaction context, including that user memberships in several tenants; it never sees another principal rows.';
COMMENT ON POLICY tenant_membership_admission_lookup ON auth.tenant_membership IS
  'PIVOT-004-R1: single-pair admission lookup for the dedicated admission owner. No blanket truth, no PUBLIC, no recursion: the predicate uses only transaction context, never a tenant_data policy helper.';

-- =====================================================================
-- 4. Exact privileges for the admission owner
--
-- Column-level reads only, on exactly what the helper functions and the policy
-- predicate need. No INSERT/UPDATE/DELETE, no ownership, no tenant table access
-- beyond the members projection, and never granted to a runtime principal.
-- =====================================================================

-- Start from zero on both schemas: a compatible pre-existing role must not keep
-- privileges from an earlier, unrelated grant.
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM saven_tenant_admission_definer;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM saven_tenant_admission_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth FROM saven_tenant_admission_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant_data FROM saven_tenant_admission_definer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM saven_tenant_admission_definer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tenant_data FROM saven_tenant_admission_definer;

GRANT USAGE ON SCHEMA auth TO saven_tenant_admission_definer;
GRANT USAGE ON SCHEMA tenant_data TO saven_tenant_admission_definer;

GRANT SELECT (tenant_id, user_id, status, suspended_at, revoked_at)
  ON auth.tenant_membership TO saven_tenant_admission_definer;
GRANT SELECT (id, status)
  ON auth.users TO saven_tenant_admission_definer;
GRANT SELECT (tenant_id, user_uuid, active)
  ON tenant_data.members TO saven_tenant_admission_definer;

GRANT EXECUTE ON FUNCTION tenant_data.current_tenant_id() TO saven_tenant_admission_definer;
GRANT EXECUTE ON FUNCTION tenant_data.current_user_id() TO saven_tenant_admission_definer;

REVOKE ALL ON FUNCTION tenant_data.session_admitted(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_data.session_admitted(uuid, uuid) TO saven_customer_app;

-- =====================================================================
-- 5. Complete the represented scoped references
--
-- A valid tenant GUC does not establish a valid company. These foreign keys bind
-- every represented company column to the tenant company master. They are added
-- NOT VALID and then validated, so incompatible pre-existing rows fail loudly.
-- Payload-only company/branch data inside JSON and every branch string (there is no
-- branch master table in the accepted schema) stay application-level and are
-- inventoried in db/postgres/README.md.
-- =====================================================================

ALTER TABLE tenant_data.journals
  ADD CONSTRAINT journals_company_fkey FOREIGN KEY (tenant_id, company)
  REFERENCES tenant_data.company_profiles (tenant_id, id)
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;

ALTER TABLE tenant_data.periods
  ADD CONSTRAINT periods_company_fkey FOREIGN KEY (tenant_id, company)
  REFERENCES tenant_data.company_profiles (tenant_id, id)
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;

ALTER TABLE tenant_data.journal_drafts
  ADD CONSTRAINT journal_drafts_company_fkey FOREIGN KEY (tenant_id, company)
  REFERENCES tenant_data.company_profiles (tenant_id, id)
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;

ALTER TABLE tenant_data.document_registry
  ADD CONSTRAINT document_registry_company_fkey FOREIGN KEY (tenant_id, company)
  REFERENCES tenant_data.company_profiles (tenant_id, id)
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;

ALTER TABLE tenant_data.trade_controls
  ADD CONSTRAINT trade_controls_company_fkey FOREIGN KEY (tenant_id, company)
  REFERENCES tenant_data.company_profiles (tenant_id, id)
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;

ALTER TABLE tenant_data.trade_parties
  ADD CONSTRAINT trade_parties_company_fkey FOREIGN KEY (tenant_id, company)
  REFERENCES tenant_data.company_profiles (tenant_id, id)
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;

ALTER TABLE tenant_data.journals VALIDATE CONSTRAINT journals_company_fkey;
ALTER TABLE tenant_data.periods VALIDATE CONSTRAINT periods_company_fkey;
ALTER TABLE tenant_data.journal_drafts VALIDATE CONSTRAINT journal_drafts_company_fkey;
ALTER TABLE tenant_data.document_registry VALIDATE CONSTRAINT document_registry_company_fkey;
ALTER TABLE tenant_data.trade_controls VALIDATE CONSTRAINT trade_controls_company_fkey;
ALTER TABLE tenant_data.trade_parties VALIDATE CONSTRAINT trade_parties_company_fkey;

-- Lookup indexes for the new parent references.
CREATE INDEX journals_company_idx ON tenant_data.journals (tenant_id, company);
CREATE INDEX journal_drafts_company_idx ON tenant_data.journal_drafts (tenant_id, company);
CREATE INDEX document_registry_company_idx ON tenant_data.document_registry (tenant_id, company);

-- =====================================================================
-- 6. Non-blanket sequence privilege
--
-- 30 granted USAGE, SELECT on every existing tenant sequence. The runtime only
-- inserts through the native command-audit identity; the trigger-only audit_event
-- sequence is not a customer-controlled evidence path.
-- =====================================================================

REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant_data FROM saven_customer_app;

GRANT USAGE, SELECT ON SEQUENCE tenant_data.audit_id_seq TO saven_customer_app;

-- =====================================================================
-- 7. Fail-closed validation of the corrected authority boundary
-- =====================================================================

DO $$
DECLARE
  bad text;
BEGIN
  -- Membership isolation must be forced, and its two policies must be role-scoped,
  -- non-PUBLIC and non-blanket.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'PIVOT-004-R1: auth.tenant_membership must have ENABLE and FORCE RLS';
  END IF;

  SELECT string_agg(p.polname, ', ') INTO bad
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'
    AND (p.polroles = ARRAY[0::oid] OR pg_get_expr(p.polqual, p.polrelid) = 'true' OR NOT p.polpermissive);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-004-R1: membership policies must be permissive, role-scoped and non-blanket: %', bad;
  END IF;

  -- Every tenant relation (ordinary or partitioned) must still be forced and covered.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'tenant_data' AND c.relkind IN ('r', 'p')
    AND (
      NOT c.relrowsecurity OR NOT c.relforcerowsecurity
      OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive) < 1
      OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive) < 2
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-004-R1: tenant relations lost forced RLS or policy coverage: %', bad;
  END IF;

  -- The admission helper must still be SECURITY DEFINER with a fixed search_path;
  -- ownership is transferred and re-verified in section 8.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'tenant_data.session_admitted(uuid, uuid)'::regprocedure
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=pg_catalog, auth, tenant_data']
  ) THEN
    RAISE EXCEPTION 'PIVOT-004-R1: session_admitted must remain SECURITY DEFINER with a fixed search_path';
  END IF;
END $$;

-- =====================================================================
-- 8. Transfer only the admission function to its dedicated owner
-- =====================================================================

RESET ROLE;

ALTER FUNCTION tenant_data.session_admitted(uuid, uuid) OWNER TO saven_tenant_admission_definer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = 'tenant_data.session_admitted(uuid, uuid)'::regprocedure
      AND r.rolname = 'saven_tenant_admission_definer'
  ) THEN
    RAISE EXCEPTION 'PIVOT-004-R1: admission function ownership transfer to saven_tenant_admission_definer failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    JOIN pg_roles granted ON granted.oid = m.roleid
    WHERE granted.rolname = 'saven_tenant_admission_definer'
      AND member.rolname IN ('saven_customer_app', 'saven_auth_service', 'saven_operator_read', 'saven_operator_admin')
  ) THEN
    RAISE EXCEPTION 'PIVOT-004-R1: a runtime role must not be a member of the admission definer';
  END IF;
END $$;

COMMIT;
