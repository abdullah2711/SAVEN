-- PIVOT-002: constrained SAVEN PostgreSQL roles.
-- Run with a private migration/admin connection, never as a SAVEN runtime role.
-- This file creates no login credentials, passwords, connection strings or DSNs.
-- Runtime services authenticate outside these roles and use SET ROLE only after
-- their own server-side authentication and authorization checks.

DO $$
DECLARE
  role_name text;
  target_roles text[] := ARRAY[
    'saven_customer_app',
    'saven_auth_service',
    'saven_operator_read',
    'saven_operator_admin',
    'saven_migrator',
    'saven_operator_definer',
    'saven_auth_definer'
  ];
  incompatible text[] := ARRAY[]::text[];
BEGIN
  -- Validate every existing target role before creating anything. A pre-existing
  -- role is never ALTERed: if its definition differs from the constrained target,
  -- the whole bootstrap refuses before mutation.
  FOREACH role_name IN ARRAY target_roles LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = role_name
        AND (
          rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR
          rolinherit OR rolbypassrls OR rolreplication
        )
    ) THEN
      incompatible := incompatible || role_name;
    END IF;
  END LOOP;

  IF cardinality(incompatible) > 0 THEN
    RAISE EXCEPTION
      'SAVEN bootstrap refused incompatible pre-existing role(s): %',
      array_to_string(incompatible, ', ');
  END IF;

  -- Create only missing roles. Compatible existing roles are a no-op, and
  -- memberships/grants are never changed by this bootstrap.
  FOREACH role_name IN ARRAY target_roles LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION',
        role_name
      );
    END IF;
  END LOOP;
END $$;

-- Purpose and least-privilege intent:
--   saven_customer_app      tenant application role; no operator.* privileges.
--   saven_auth_service      narrow shared-auth service role, separate from operator.
--   saven_operator_read     read-only operator application role; no tenant_data
--                           access outside future audited SECURITY DEFINER functions.
--   saven_operator_admin    operator write role; no DDL and no tenant_data reads
--                           outside future audited SECURITY DEFINER functions.
--   saven_migrator          offline DDL role; no login, no superuser, no BYPASSRLS.
--   saven_operator_definer  non-login owner for operator SECURITY DEFINER functions.
--   saven_auth_definer      non-login owner for auth SECURITY DEFINER functions.
--
-- Role membership for a deployment login is granted separately by the deployment
-- administrator. This file deliberately creates no login principal.
