-- PIVOT-004-R2: additive hardening after 031-rls-corrections.sql.
--
-- Applied by the SEPARATE OFFLINE ADMINISTRATOR (superuser), exactly like 031, because
-- it re-validates a privileged NOLOGIN owner. It changes no delivered file.
--
-- What it corrects:
--   1. Membership isolation could be widened by an extra PERMISSIVE policy. The auth
--      service and the admission owner each get an independent RESTRICTIVE guard in
--      addition to their permissive policy, so a later permissive policy (including a
--      mistaken `USING (true)`) cannot OR past the principal/pair predicate.
--      This supersedes the earlier permissive-only expectation; it does not edit the
--      applied 031 bytes, whose validator ran before these policies existed.
--   2. The dedicated admission owner's authority was only checked at the flag level.
--      Before any hardening is applied, this file validates the full authority surface
--      of the existing role: flags, direct and transitive memberships, object
--      ownership, schema privileges, table/column ACLs, sequence ACLs, function ACLs,
--      default ACLs, database and tablespace ownership. Anything outside the exact
--      allowed set REFUSES the migration and rolls back; unrelated grants are never
--      stripped or "repaired".
--   3. The same validation runs again after the policies are added, so the committed
--      stack is proven fail-closed.
--
-- Rollback is a normal transaction rollback. No data is read beyond catalogs, no
-- business row is touched, no privilege is broadened, and no applied bytes change.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 032-rls-hardening.sql';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '032-rls-hardening.sql validates a privileged owner and adds isolation guards: run it as the separate offline administrator (superuser), not as a runtime or migration principal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_tenant_admission_definer') THEN
    RAISE EXCEPTION 'Run 031-rls-corrections.sql before 032-rls-hardening.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'tenant_data' AND p.proname = 'session_admitted'
      AND r.rolname = 'saven_tenant_admission_definer'
  ) THEN
    RAISE EXCEPTION 'Run 031-rls-corrections.sql before 032-rls-hardening.sql (admission owner not in place)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'
      AND p.polname = 'tenant_membership_preselect_scope'
  ) THEN
    RAISE EXCEPTION 'PIVOT-004-R2: 032-rls-hardening.sql is already applied';
  END IF;
END $$;

-- =====================================================================
-- 1. Full-authority validator for the dedicated admission owner
--
-- Everything below is an exact allow-list. A violation refuses the whole
-- migration; nothing is revoked, repaired or silently widened.
-- =====================================================================

CREATE FUNCTION pg_temp.saven_assert_admission_owner() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_owner oid;
  v_fn oid;
  allowed_schemas text[];
  allowed_columns text[];
  allowed_functions text[];
  actual text[];
  bad text;
BEGIN
  SELECT oid INTO v_owner FROM pg_roles WHERE rolname = 'saven_tenant_admission_definer';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner role is missing';
  END IF;
  SELECT p.oid INTO v_fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'tenant_data' AND p.proname = 'session_admitted'
    AND p.proowner = v_owner;
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission helper is missing or not owned by the dedicated owner';
  END IF;

  -- 1.1 Role definition: constrained, non-login, no escape flags.
  SELECT string_agg(flag, ', ') INTO bad
  FROM pg_roles r,
  LATERAL (VALUES
    ('LOGIN', r.rolcanlogin), ('SUPERUSER', r.rolsuper), ('CREATEDB', r.rolcreatedb),
    ('CREATEROLE', r.rolcreaterole), ('INHERIT', r.rolinherit),
    ('BYPASSRLS', r.rolbypassrls), ('REPLICATION', r.rolreplication)
  ) v(flag, present)
  WHERE r.oid = v_owner AND v.present;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner has forbidden role attributes: %', bad;
  END IF;

  -- 1.2 No direct or transitive outbound membership (it must not be able to SET ROLE
  -- into anything), and no inbound path from a SAVEN principal. Superusers are
  -- excluded from the inbound test because pg_has_role always answers true for them;
  -- they are the offline administrator, not a runtime path.
  SELECT string_agg(format('%s -> %s', m.rolname, g.rolname), ', ') INTO bad
  FROM pg_auth_members am
  JOIN pg_roles m ON m.oid = am.member
  JOIN pg_roles g ON g.oid = am.roleid
  WHERE m.oid = v_owner OR g.oid = v_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner has direct role memberships: %', bad;
  END IF;

  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO bad
  FROM pg_roles r
  WHERE r.oid <> v_owner AND r.rolname NOT LIKE 'pg\_%'
    AND pg_has_role(v_owner, r.oid, 'MEMBER');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner transitively holds privileges of: %', bad;
  END IF;

  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO bad
  FROM pg_roles r
  WHERE r.oid <> v_owner AND r.rolname LIKE 'saven\_%' AND NOT r.rolsuper
    AND pg_has_role(r.oid, v_owner, 'MEMBER');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: a SAVEN principal can assume the admission owner: %', bad;
  END IF;

  -- 1.3 Ownership: only the one helper function.
  SELECT string_agg(n.nspname || '.' || c.relname, ', ' ORDER BY c.relname) INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relowner = v_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner owns relations: %', bad;
  END IF;

  SELECT string_agg(n.nspname, ', ') INTO bad
  FROM pg_namespace n WHERE n.nspowner = v_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner owns schemas: %', bad;
  END IF;

  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY p.proname) INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proowner = v_owner AND p.oid <> v_fn;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner owns other functions: %', bad;
  END IF;

  SELECT string_agg(datname, ', ') INTO bad FROM pg_database WHERE datdba = v_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner owns databases: %', bad;
  END IF;

  SELECT string_agg(spcname, ', ') INTO bad FROM pg_tablespace WHERE spcowner = v_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner owns tablespaces: %', bad;
  END IF;

  -- 1.4 Schema ACL: exactly USAGE on auth and tenant_data, no CREATE anywhere.
  allowed_schemas := ARRAY['auth:USAGE', 'tenant_data:USAGE'];
  SELECT coalesce(array_agg(n.nspname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[]) INTO actual
  FROM pg_namespace n CROSS JOIN aclexplode(n.nspacl) x
  WHERE x.grantee = v_owner
    AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema';
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(allowed_schemas) v) THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner schema privileges differ from the allow-list; found %', actual;
  END IF;

  SELECT string_agg(n.nspname, ', ') INTO bad
  FROM pg_namespace n
  WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
    AND has_schema_privilege(v_owner, n.oid, 'CREATE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner may CREATE in schema(s): %', bad;
  END IF;

  IF has_schema_privilege(v_owner, 'operator', 'USAGE') THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner may USAGE the operator schema';
  END IF;

  -- 1.5 Table and sequence ACLs must be empty (table-level rights are too broad).
  SELECT string_agg(n.nspname || '.' || c.relname || ':' || x.privilege_type, ', ') INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN aclexplode(c.relacl) x
  WHERE x.grantee = v_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner holds table/sequence-level privileges: %', bad;
  END IF;

  -- 1.6 Column ACLs: exactly the ten reviewed SELECT columns.
  SELECT coalesce(array_agg(n.nspname || '.' || c.relname || '.' || a.attname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[])
    INTO actual
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN aclexplode(a.attacl) x
  WHERE x.grantee = v_owner AND a.attnum > 0;
  allowed_columns := ARRAY[
    'auth.tenant_membership.tenant_id:SELECT',
    'auth.tenant_membership.user_id:SELECT',
    'auth.tenant_membership.status:SELECT',
    'auth.tenant_membership.suspended_at:SELECT',
    'auth.tenant_membership.revoked_at:SELECT',
    'auth.users.id:SELECT',
    'auth.users.status:SELECT',
    'tenant_data.members.tenant_id:SELECT',
    'tenant_data.members.user_uuid:SELECT',
    'tenant_data.members.active:SELECT'
  ];
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(allowed_columns) v) THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner column privileges differ from the allow-list; found %', actual;
  END IF;

  -- 1.7 Function ACLs: exactly the two context helpers.
  -- The owner's own EXECUTE entry on the helper is materialised in the ACL when
  -- ownership is transferred; it confers no authority beyond owning that function.
  allowed_functions := ARRAY[
    'tenant_data.current_tenant_id:EXECUTE',
    'tenant_data.current_user_id:EXECUTE',
    'tenant_data.session_admitted:EXECUTE'
  ];
  SELECT coalesce(array_agg(n.nspname || '.' || p.proname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[])
    INTO actual
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN aclexplode(p.proacl) x
  WHERE x.grantee = v_owner;
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(allowed_functions) v) THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner function privileges differ from the allow-list; found %', actual;
  END IF;

  -- 1.8 No default-privilege path that could grant future rights.
  SELECT string_agg(format('%s:%s', defaclobjtype, x.privilege_type), ', ') INTO bad
  FROM pg_default_acl d CROSS JOIN aclexplode(d.defaclacl) x
  WHERE x.grantee = v_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'R2-AUTHORITY: admission owner is named in default privileges: %', bad;
  END IF;
END;
$fn$;

SET LOCAL ROLE saven_migrator;

-- Validate before touching anything, so a refused run leaves no policy behind.
SELECT pg_temp.saven_assert_admission_owner();

-- =====================================================================
-- 2. Restrictive membership guards (defence against permissive widening)
--
-- Each role with membership access now has one permissive and one restrictive
-- policy carrying the same predicate. Permissive policies are OR-ed and restrictive
-- policies are AND-ed, so an added `PERMISSIVE ... USING (true)` can no longer expose
-- other principals' memberships. Predicates use only transaction context, never a
-- tenant_data helper, so there is no recursion.
-- =====================================================================

CREATE POLICY tenant_membership_preselect_scope ON auth.tenant_membership
  AS RESTRICTIVE FOR ALL TO saven_auth_service
  USING (
    user_id = CASE
      WHEN pg_input_is_valid(nullif(current_setting('app.current_user_id', true), ''), 'uuid')
      THEN nullif(current_setting('app.current_user_id', true), '')::uuid
    END
  )
  WITH CHECK (
    user_id = CASE
      WHEN pg_input_is_valid(nullif(current_setting('app.current_user_id', true), ''), 'uuid')
      THEN nullif(current_setting('app.current_user_id', true), '')::uuid
    END
  );

CREATE POLICY tenant_membership_admission_scope ON auth.tenant_membership
  AS RESTRICTIVE FOR ALL TO saven_tenant_admission_definer
  USING (
    tenant_id = CASE
      WHEN pg_input_is_valid(nullif(current_setting('app.current_tenant_id', true), ''), 'uuid')
      THEN nullif(current_setting('app.current_tenant_id', true), '')::uuid
    END
    AND user_id = CASE
      WHEN pg_input_is_valid(nullif(current_setting('app.current_user_id', true), ''), 'uuid')
      THEN nullif(current_setting('app.current_user_id', true), '')::uuid
    END
  )
  WITH CHECK (
    tenant_id = CASE
      WHEN pg_input_is_valid(nullif(current_setting('app.current_tenant_id', true), ''), 'uuid')
      THEN nullif(current_setting('app.current_tenant_id', true), '')::uuid
    END
    AND user_id = CASE
      WHEN pg_input_is_valid(nullif(current_setting('app.current_user_id', true), ''), 'uuid')
      THEN nullif(current_setting('app.current_user_id', true), '')::uuid
    END
  );

COMMENT ON POLICY tenant_membership_preselect_scope ON auth.tenant_membership IS
  'PIVOT-004-R2: restrictive partner of tenant_membership_preselect. An extra permissive policy targeting the auth service cannot widen preselection past the verified user.';
COMMENT ON POLICY tenant_membership_admission_scope ON auth.tenant_membership IS
  'PIVOT-004-R2: restrictive partner of tenant_membership_admission_lookup. An extra permissive policy cannot widen the admission owner past the verified (tenant, user) pair.';

-- =====================================================================
-- 3. Final fail-closed validation of the committed stack
-- =====================================================================

SELECT pg_temp.saven_assert_admission_owner();

DO $$
DECLARE
  bad text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'PIVOT-004-R2: auth.tenant_membership lost forced RLS';
  END IF;

  -- Each membership role must now have at least one permissive and one restrictive
  -- policy; no membership policy may target PUBLIC or be a blanket truth.
  SELECT string_agg(r.rolname, ', ') INTO bad
  FROM (VALUES ('saven_auth_service'), ('saven_tenant_admission_definer')) AS r(rolname)
  WHERE NOT EXISTS (
      SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles pr ON pr.rolname = r.rolname
      WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'
        AND pr.oid = ANY(p.polroles) AND p.polpermissive
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles pr ON pr.rolname = r.rolname
      WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'
        AND pr.oid = ANY(p.polroles) AND NOT p.polpermissive
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-004-R2: membership role(s) lack a permissive/restrictive pair: %', bad;
  END IF;

  SELECT string_agg(p.polname, ', ') INTO bad
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'
    AND (p.polroles = ARRAY[0::oid] OR pg_get_expr(p.polqual, p.polrelid) = 'true');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-004-R2: membership policies must not be PUBLIC or blanket: %', bad;
  END IF;

  -- Tenant tables keep their forced isolation and three-policy shape, ordinary or
  -- partitioned.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'tenant_data' AND c.relkind IN ('r', 'p')
    AND (
      NOT c.relrowsecurity OR NOT c.relforcerowsecurity
      OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive) < 1
      OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive) < 2
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-004-R2: tenant relations lost forced RLS or policy coverage: %', bad;
  END IF;
END $$;

RESET ROLE;

DROP FUNCTION pg_temp.saven_assert_admission_owner();

COMMIT;
