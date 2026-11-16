-- PIVOT-004: forced tenant isolation, atomic runtime grants and the constrained
-- canonical-principal projection for the tenant_data schema.
-- Run after 00-roles.sql, 05-auth-schema.sql (AUTH-001), 10-operator-schema.sql,
-- 20-tenant-schema.sql (PIVOT-003) and migrations/021-tenant-schema-corrections.sql,
-- with a connection that is a member of saven_migrator. DDL objects are owned by
-- saven_migrator. This file contains no credentials, passwords, DSNs or data.
--
-- This migration is one transaction on purpose: ENABLE/FORCE RLS, the isolation
-- policies and the per-table saven_customer_app grants land together. There is no
-- committed intermediate state in which tenant rows are readable without policies.
--
-- Scope of this file, and what it deliberately does not do:
--   * tenant_data only. auth.* and operator.* receive no RLS, no policy and no
--     privilege change here. Forced auth.tenant_membership isolation needs the
--     auth-service session/selection semantics owned by AUTH-002/006, and enabling
--     FORCE RLS on it now would break the canonical membership lookup used below
--     (see "Remaining auth isolation" at the end of this file).
--   * No triggers. Posted-source immutability is PIVOT-005 and business audit is
--     PIVOT-006; grants here already withhold UPDATE/DELETE from append-only rows.
--   * No BYPASSRLS, no superuser, no session-level tenant context, no client-supplied
--     tenant id. Context is read from transaction-local GUCs that AUTH-006 sets from
--     a verified server-side session.
--
-- Invariants preserved:
--   * tenant_id stays uuid NOT NULL and every key is tenant-leading (PIVOT-003).
--   * Native text ids stay text; the canonical UUID identity is an additive,
--     constrained projection with exact composite foreign keys, never a second
--     identity registry.
--   * Money, posting and audit semantics are unchanged by this file.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 30-rls-policies.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'Run 30-rls-policies.sql as a member of saven_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_data') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql before 30-rls-policies.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE EXCEPTION 'Run 05-auth-schema.sql before 30-rls-policies.sql';
  END IF;
  -- Catalog-only check: the guard runs before SET ROLE, so it must not resolve a
  -- schema-qualified name as the migration login (which has no tenant_data USAGE).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data' AND c.relname = 'stock_balances'
      AND con.conname = 'stock_balances_quantity_value_chk'
  ) THEN
    RAISE EXCEPTION 'Run migrations/021-tenant-schema-corrections.sql before 30-rls-policies.sql';
  END IF;
END $$;

SET LOCAL ROLE saven_migrator;

-- =====================================================================
-- 1. Constrained canonical-principal projection
--
-- tenant_data.members.user_id keeps the native text id. The canonical UUID
-- principal is projected additively, exactly as ruled: a stored, constrained
-- projection, never a second independently editable identity registry.
-- =====================================================================

ALTER TABLE tenant_data.members ADD COLUMN user_uuid uuid;

-- Fail closed rather than invent a mapping. Phase 1 carries no tenant data, so an
-- existing unmapped member row means an unauthorized/unreviewed import.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant_data.members WHERE user_uuid IS NULL) THEN
    RAISE EXCEPTION 'PIVOT-004: existing tenant_data.members rows have no user_uuid mapping; resolve the canonical principal before enabling isolation';
  END IF;
END $$;

ALTER TABLE tenant_data.members ALTER COLUMN user_uuid SET NOT NULL;

ALTER TABLE tenant_data.members
  ADD CONSTRAINT members_tenant_user_uuid_key UNIQUE (tenant_id, user_uuid);

COMMENT ON COLUMN tenant_data.members.user_uuid IS
  'Constrained projection of the canonical auth.users UUID. Never independently editable identity: exact composite FKs below bind it to auth.tenant_membership and to the auth.users (id, legacy_id) pair.';

-- Exact referenced key for the text/UUID pair. auth.users.id is already unique; this
-- pair key exists so a single FK can reject a mismatched legacy/UUID combination.
ALTER TABLE auth.users
  ADD CONSTRAINT users_id_legacy_key UNIQUE (id, legacy_id);

COMMENT ON CONSTRAINT users_id_legacy_key ON auth.users IS
  'PIVOT-004: referenced key for tenant_data.members (user_uuid, user_id) so text and UUID identity cannot diverge.';

ALTER TABLE tenant_data.members
  ADD CONSTRAINT members_canonical_membership_fkey
  FOREIGN KEY (tenant_id, user_uuid)
  REFERENCES auth.tenant_membership (tenant_id, user_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE tenant_data.members
  ADD CONSTRAINT members_canonical_identity_fkey
  FOREIGN KEY (user_uuid, user_id)
  REFERENCES auth.users (id, legacy_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

-- Deprecated duplicate mapping path: two members rows may not claim the same native
-- text id for different UUIDs inside a tenant. (tenant_id, user_id) is already the PK,
-- so a duplicate text id cannot exist; the pair FK above blocks a mismatched UUID.
COMMENT ON CONSTRAINT members_canonical_membership_fkey ON tenant_data.members IS
  'PIVOT-004: FK existence does not establish active admission; session_admitted() below also requires active membership and an active business principal.';

-- Scoped index for role lookups inside a tenant (role_id is not a PK prefix).
CREATE INDEX assignments_role_idx ON tenant_data.assignments (tenant_id, role_id);

-- =====================================================================
-- 2. Transaction-local context helpers
--
-- Invoker functions (no elevated privilege). They return NULL for an absent,
-- empty or malformed context, so every policy fails closed instead of raising.
-- =====================================================================

CREATE FUNCTION tenant_data.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE WHEN pg_input_is_valid(v, 'uuid') THEN v::uuid END
  FROM (SELECT nullif(current_setting('app.current_tenant_id', true), '') AS v) s
$fn$;

CREATE FUNCTION tenant_data.current_user_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE WHEN pg_input_is_valid(v, 'uuid') THEN v::uuid END
  FROM (SELECT nullif(current_setting('app.current_user_id', true), '') AS v) s
$fn$;

-- =====================================================================
-- 3. Runtime admission guard
--
-- SECURITY DEFINER is required because the customer runtime has no auth.*
-- privileges and must not get them just to satisfy a policy. It reads only auth
-- status columns plus the tenant-local principal projection, returns a boolean
-- only, has a fixed search_path, takes no dynamic SQL and cannot read documents.
-- =====================================================================

CREATE FUNCTION tenant_data.session_admitted(p_tenant uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, auth, tenant_data
AS $fn$
  SELECT p_tenant IS NOT NULL
     AND p_user IS NOT NULL
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

-- Ownership note: target roles are mutually non-member by accepted design
-- (00-roles.sql, asserted by the PIVOT-002 gate), so the migration principal cannot
-- transfer ownership to saven_auth_definer here. The function is therefore owned by
-- the offline DDL role; its body is fixed, has no dynamic SQL and is the only code it
-- can execute. A later contract may transfer ownership once dedicated definer
-- membership provisioning is reviewed.
COMMENT ON FUNCTION tenant_data.session_admitted(uuid, uuid) IS
  'PIVOT-004: true only for an active canonical membership with an active tenant-local principal. Boolean only; no document, credential or session data is exposed.';

-- =====================================================================
-- 4. Forced RLS and policies for every tenant table
--
-- Three policies per table:
--   * <table>_tenant_isolation  PERMISSIVE  all roles: row tenant = transaction context
--   * <table>_tenant_scope      RESTRICTIVE all roles: same predicate, so a later
--                               permissive policy cannot widen visibility or writes
--   * <table>_runtime_admission RESTRICTIVE customer runtime: tenant match AND an
--                               active membership/business principal for the caller
--
-- The duplicate tenant predicate in a restrictive policy is intentional: permissive
-- policies are OR-ed, restrictive policies are AND-ed, so an extra permissive policy
-- (including a mistaken one) cannot expose another tenant.
-- =====================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'account_profiles','accounts','approval_policy','approval_requests','assignments',
    'audit','audit_event','business','business_rule','command_decisions','command_files',
    'command_inbox','company_profiles','company_settings','denials','document_numbers',
    'document_registry','document_revisions','document_sequences','inventory_controls',
    'journal_corrections','journal_drafts','journal_lines','journals','members','outbox',
    'periods','posting_constraint','reference_values','roles','source_store_migrations',
    'stock_balances','stock_items','stock_movements','stock_operations','support_grants',
    'tax_profile','trade_allocations','trade_controls','trade_credit_lines','trade_credits',
    'trade_documents','trade_lines','trade_operations','trade_parties','verified_entitlement',
    'warehouses'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('tenant_data.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'PIVOT-004: expected tenant table % is missing', t;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'tenant_data' AND c.relname = t
    ) THEN
      RAISE EXCEPTION 'PIVOT-004: table % already has policies; this migration must not overwrite an applied isolation policy', t;
    END IF;

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

COMMENT ON TABLE tenant_data.members IS
  'Native tenant.members. Tenant-local active principal projection; auth.tenant_membership is the sole admission authority. user_id keeps the native text id and user_uuid is the constrained canonical UUID projection.';

-- =====================================================================
-- 5. Least-privilege runtime grants for saven_customer_app
--
-- Atomic with the policies above. saven_customer_app is the only direct tenant
-- runtime grantee: auth and operator roles get nothing, PUBLIC gets nothing, and
-- no table-owner or schema-CREATE authority is granted.
-- =====================================================================

GRANT USAGE ON SCHEMA tenant_data TO saven_customer_app;
REVOKE CREATE ON SCHEMA tenant_data FROM saven_customer_app;

-- Accepted/immutable sources: append and read only. No UPDATE or DELETE grant.
GRANT SELECT, INSERT ON
  tenant_data.journals,
  tenant_data.journal_lines,
  tenant_data.trade_operations,
  tenant_data.trade_documents,
  tenant_data.trade_lines,
  tenant_data.trade_allocations,
  tenant_data.trade_credits,
  tenant_data.trade_credit_lines,
  tenant_data.stock_operations,
  tenant_data.stock_movements,
  tenant_data.command_decisions,
  tenant_data.command_files,
  tenant_data.document_numbers,
  tenant_data.document_revisions,
  tenant_data.journal_corrections
TO saven_customer_app;

-- Command-linked native audit: the kernel appends command events.
GRANT SELECT, INSERT ON tenant_data.audit TO saven_customer_app;

-- Change-event audit is trigger-only (PIVOT-006). The runtime may read it and must
-- never be able to forge an evidence row.
GRANT SELECT ON tenant_data.audit_event TO saven_customer_app;

-- Imported native provenance is read-only for the runtime.
GRANT SELECT ON tenant_data.source_store_migrations TO saven_customer_app;

-- Mutable business state and configuration. No DELETE: retention is explicit.
GRANT SELECT, INSERT, UPDATE ON
  tenant_data.business,
  tenant_data.members,
  tenant_data.accounts,
  tenant_data.account_profiles,
  tenant_data.periods,
  tenant_data.approval_requests,
  tenant_data.outbox,
  tenant_data.journal_drafts,
  tenant_data.company_profiles,
  tenant_data.company_settings,
  tenant_data.warehouses,
  tenant_data.stock_items,
  tenant_data.stock_balances,
  tenant_data.trade_parties,
  tenant_data.reference_values,
  tenant_data.business_rule,
  tenant_data.approval_policy,
  tenant_data.posting_constraint,
  tenant_data.tax_profile,
  tenant_data.support_grants,
  tenant_data.verified_entitlement,
  tenant_data.document_registry,
  tenant_data.document_sequences
TO saven_customer_app;

-- Administration rows that an authorized business administrator may remove.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenant_data.roles,
  tenant_data.assignments,
  tenant_data.denials,
  tenant_data.inventory_controls,
  tenant_data.trade_controls
TO saven_customer_app;

-- Accepted command receipt: insert/read the immutable bytes, update only the
-- lifecycle/lease columns. payload, digest, actor and created_at stay unwritable.
GRANT SELECT, INSERT ON tenant_data.command_inbox TO saven_customer_app;
GRANT UPDATE (state, lease_token, lease_until, error, approved_by, updated_at, updated_by)
  ON tenant_data.command_inbox TO saven_customer_app;

-- Identity sequences are needed for inserts into identity-backed tenant tables.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tenant_data TO saven_customer_app;

-- No direct tenant access for auth, operator or PUBLIC. These are re-asserted even
-- though PIVOT-003 revoked them, so this file alone fails a privilege-drift review.
REVOKE ALL ON SCHEMA tenant_data FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant_data FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tenant_data FROM PUBLIC;

REVOKE ALL ON SCHEMA tenant_data FROM saven_auth_service, saven_auth_definer;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM saven_auth_service, saven_auth_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant_data FROM saven_auth_service, saven_auth_definer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tenant_data FROM saven_auth_service, saven_auth_definer;

REVOKE ALL ON SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin, saven_operator_definer;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin, saven_operator_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin, saven_operator_definer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin, saven_operator_definer;

-- Context and admission helpers: executable by the customer runtime only.
REVOKE ALL ON FUNCTION tenant_data.current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.session_admitted(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_data.current_tenant_id() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.current_user_id() TO saven_customer_app;
GRANT EXECUTE ON FUNCTION tenant_data.session_admitted(uuid, uuid) TO saven_customer_app;

-- =====================================================================
-- 6. Fail-closed validation: no tenant table may escape this migration
-- =====================================================================

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'tenant_data' AND c.relkind = 'r'
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-004: tenant tables without forced RLS: %', missing;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'tenant_data' AND c.relkind = 'r'
    AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive) < 1;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-004: tenant tables without a permissive isolation policy: %', missing;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'tenant_data' AND c.relkind = 'r'
    AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive) < 2;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-004: tenant tables without restrictive scope/admission policies: %', missing;
  END IF;

  -- No policy may target an auth or operator role: those roles must not gain a
  -- tenant path through a policy, and they already hold no tenant privilege.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'tenant_data' AND c.relkind = 'r'
    AND EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = c.oid
        AND p.polroles && (
          SELECT coalesce(array_agg(r.oid), ARRAY[]::oid[]) FROM pg_roles r
          WHERE r.rolname IN (
            'saven_auth_service','saven_auth_definer',
            'saven_operator_read','saven_operator_admin','saven_operator_definer'
          )
        )
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-004: tenant policies must not address auth or operator roles: %', missing;
  END IF;
END $$;

-- =====================================================================
-- Remaining auth isolation (not delivered by this file)
--
-- Forced RLS on auth.tenant_membership/auth.sessions/auth.users remains mandatory
-- but is owned by AUTH-002/006: those contracts own the authentication and
-- tenant-selection paths, and enabling FORCE RLS here would either break the
-- canonical membership lookup used by session_admitted() or require a
-- migration-wide bypass policy that would defeat the isolation. The customer
-- runtime has no auth.* privilege at all, so no auth data is reachable through
-- this file. Do not describe auth-side isolation as delivered.
-- =====================================================================

COMMIT;
