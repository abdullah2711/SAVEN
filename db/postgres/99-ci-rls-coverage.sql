-- PIVOT-008: target PostgreSQL RLS and privilege coverage gate.
--
-- Read-only. Every returned row is a coverage violation. An empty result is a pass;
-- a non-empty result must be translated into a nonzero process exit by the caller
-- (scripts/verify-pg-rls.mjs). This file performs no DDL, DML, GRANT or REVOKE and
-- never repairs anything: an operator investigates a violation instead of masking it.
--
-- The gate covers the accepted PIVOT-004/005/006/007 and AUTH-006/007 surface:
--   * tenant_data tables (ordinary and partitioned) must ENABLE and FORCE RLS, carry a
--     permissive isolation policy and a restrictive scope policy, and must not carry a
--     restrictive policy whose predicate is constantly true;
--   * auth.tenant_membership, the only tenant-scoped auth table, must do the same;
--   * partitions, inheritance children, views and materialized views must not create a
--     path around the parent policy or expose stored tenant rows;
--   * SECURITY DEFINER functions must have a constrained non-login, non-bypass owner, a
--     fixed pg_catalog-first search_path, no PUBLIC EXECUTE and no membership path that
--     lets a runtime role assume the owner;
--   * no SAVEN principal may hold SUPERUSER or BYPASSRLS, own covered objects, hold
--     schema CREATE or cross a tenant/auth/operator privilege boundary;
--   * PUBLIC holds no table, column, sequence or SECURITY DEFINER privilege.
--
-- Role classes are resolved by the stable `saven_` prefix plus the role suffix used by
-- the bootstrap (customer_app, auth_service, operator_read, operator_admin, definer).
-- A new runtime class is added to the bootstrap and to this classification together;
-- the gate does not enumerate business roles or tenant data.
--
-- Run after the full stack (see db/postgres/README.md). Connection identity: the
-- offline administrator; this query reads catalogs only and needs no table data.

WITH RECURSIVE
-- Every principal created by the SAVEN bootstrap, in the deployment or a disposable
-- test namespace.
saven_roles AS (
  SELECT r.oid, r.rolname, r.rolsuper, r.rolbypassrls, r.rolcanlogin,
         r.rolcreatedb, r.rolcreaterole
  FROM pg_roles r
  WHERE r.rolname LIKE 'saven\_%'
),
-- Runtime classes that must never cross a schema or ownership boundary.
runtime_roles AS (
  SELECT r.oid, r.rolname,
         CASE
           WHEN r.rolname ~ '(^|_)customer_app$' THEN 'customer_app'
           WHEN r.rolname ~ '(^|_)auth_service$' THEN 'auth_service'
           WHEN r.rolname ~ '(^|_)operator_read$' THEN 'operator_read'
           WHEN r.rolname ~ '(^|_)operator_admin$' THEN 'operator_admin'
         END AS class
  FROM pg_roles r
  WHERE r.rolname ~ '(^|_)(customer_app|auth_service|operator_read|operator_admin)$'
),
-- Transitive membership closure: (member, granted) means member can SET ROLE granted.
role_closure AS (
  SELECT m.member, m.roleid AS granted FROM pg_auth_members m
  UNION
  SELECT c.member, m.roleid
  FROM role_closure c
  JOIN pg_auth_members m ON m.member = c.granted
),
covered_relations AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relispartition,
         c.relrowsecurity, c.relforcerowsecurity, c.relowner, c.reloptions, c.relacl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('tenant_data', 'auth', 'operator')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
),
tenant_tables AS (
  SELECT * FROM covered_relations
  WHERE nspname = 'tenant_data' AND relkind IN ('r', 'p')
),
tenant_scoped_auth AS (
  SELECT * FROM covered_relations
  WHERE nspname = 'auth' AND relname = 'tenant_membership' AND relkind IN ('r', 'p')
),
policy_facts AS (
  SELECT p.polrelid,
         count(*) FILTER (WHERE p.polpermissive) AS permissive_count,
         count(*) FILTER (WHERE NOT p.polpermissive) AS restrictive_count,
         coalesce(bool_or(
           NOT p.polpermissive AND (
             pg_get_expr(p.polqual, p.polrelid) = 'true'
             OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
           )
         ), false) AS restrictive_true,
         count(*) FILTER (
           WHERE pg_get_expr(p.polqual, p.polrelid) LIKE '%current_setting%'
              OR pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%current_setting%'
         ) AS direct_context
  FROM pg_policy p
  GROUP BY p.polrelid
),
-- Partitions and inheritance children of tenant tables, including children that live
-- outside tenant_data. Direct access to a child does not apply the parent's policies.
tenant_children AS (
  SELECT child.oid, cn.nspname, child.relname, child.relkind,
         child.relrowsecurity, child.relforcerowsecurity,
         parent.relname AS parent_name
  FROM pg_inherits i
  JOIN pg_class child ON child.oid = i.inhrelid
  JOIN pg_namespace cn ON cn.oid = child.relnamespace
  JOIN pg_class parent ON parent.oid = i.inhparent
  JOIN pg_namespace pn ON pn.oid = parent.relnamespace
  WHERE pn.nspname = 'tenant_data' AND parent.relkind IN ('r', 'p')
),
-- Every view or materialized view that reads a tenant_data relation, in any schema.
tenant_views AS (
  SELECT DISTINCT v.oid, vn.nspname, v.relname, v.relkind, v.relowner, v.reloptions
  FROM pg_rewrite rw
  JOIN pg_class v ON v.oid = rw.ev_class
  JOIN pg_namespace vn ON vn.oid = v.relnamespace
  JOIN pg_depend d
    ON d.classid = 'pg_rewrite'::regclass
   AND d.objid = rw.oid
   AND d.refclassid = 'pg_class'::regclass
  JOIN pg_class t ON t.oid = d.refobjid
  JOIN pg_namespace tn ON tn.oid = t.relnamespace
  WHERE tn.nspname = 'tenant_data'
    AND t.relkind IN ('r', 'p', 'v', 'm')
    AND v.oid <> t.oid
    AND v.relkind IN ('v', 'm')
),
definer_functions AS (
  SELECT p.oid, n.nspname, p.proname, p.proowner, p.proconfig, p.proacl,
         owner.rolname AS owner_name, owner.rolsuper, owner.rolbypassrls,
         owner.rolcanlogin,
         (SELECT cfg FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
          WHERE cfg LIKE 'search_path=%' LIMIT 1) AS search_path_config
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles owner ON owner.oid = p.proowner
  WHERE p.prosecdef
    AND (n.nspname IN ('tenant_data', 'auth', 'operator')
         OR owner.rolname LIKE 'saven\_%')
),
function_facts AS (
  SELECT f.*,
         coalesce(
           EXISTS (
             SELECT 1 FROM unnest(coalesce(f.proconfig, ARRAY[]::text[])) cfg
             WHERE cfg = 'row_security=off'
           ), false) AS row_security_off,
         coalesce(
           EXISTS (
             SELECT 1 FROM aclexplode(f.proacl) a
             WHERE f.proacl IS NOT NULL AND a.grantee = 0
           ), false) AS public_execute,
         EXISTS (
           SELECT 1
           FROM runtime_roles rr
           WHERE rr.oid = f.proowner
              OR EXISTS (
                SELECT 1 FROM role_closure rc
                WHERE rc.member = rr.oid AND rc.granted = f.proowner
              )
         ) AS runtime_can_assume_owner,
         CASE
           WHEN f.search_path_config IS NULL THEN true
           ELSE NOT (
             regexp_replace(split_part(f.search_path_config, '=', 2), '^\s+', '') ~ '^pg_catalog(,|$)'
             AND NOT EXISTS (
               SELECT 1
               FROM unnest(regexp_split_to_array(split_part(f.search_path_config, '=', 2), '\s*,\s*')) tok
               WHERE lower(replace(tok, '"', '')) IN ('public', '$user', 'pg_temp')
             )
           )
         END AS unsafe_search_path
  FROM definer_functions f
),
-- A privilege row is materialized per runtime class, relation and privilege, so each
-- forbidden grant is reported once with the exact role and object.
runtime_relation_privileges AS (
  SELECT rr.oid AS role_oid, rr.rolname, rr.class, cr.oid AS relation_oid,
         cr.nspname, cr.relname, cr.relkind, p.privilege
  FROM runtime_roles rr
  CROSS JOIN covered_relations cr
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                      ('REFERENCES'), ('TRIGGER'), ('USAGE')) p(privilege)
  WHERE (cr.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND p.privilege <> 'USAGE'
         AND has_table_privilege(rr.oid, cr.oid, p.privilege))
     OR (cr.relkind = 'S' AND p.privilege IN ('SELECT', 'UPDATE', 'USAGE')
         AND has_sequence_privilege(rr.oid, cr.oid, p.privilege))
),
violations (kind, object, detail) AS (
  -- ---------------------------------------------------------------------------
  -- 1. Tenant table isolation
  -- ---------------------------------------------------------------------------
  SELECT 'MISSING_ENABLE_RLS', 'tenant_data.' || relname,
         'tenant table does not ENABLE ROW LEVEL SECURITY'
  FROM tenant_tables WHERE NOT relrowsecurity
  UNION ALL
  SELECT 'MISSING_FORCE_RLS', 'tenant_data.' || relname,
         'tenant table does not FORCE ROW LEVEL SECURITY'
  FROM tenant_tables WHERE relrowsecurity AND NOT relforcerowsecurity
  UNION ALL
  SELECT 'MISSING_POLICY', 'tenant_data.' || t.relname,
         'tenant table has no row-level security policy'
  FROM tenant_tables t
  LEFT JOIN policy_facts f ON f.polrelid = t.oid
  WHERE coalesce(f.permissive_count, 0) + coalesce(f.restrictive_count, 0) = 0
  UNION ALL
  SELECT 'MISSING_PERMISSIVE_POLICY', 'tenant_data.' || t.relname,
         'tenant table has no permissive isolation policy'
  FROM tenant_tables t
  JOIN policy_facts f ON f.polrelid = t.oid
  WHERE f.permissive_count = 0
  UNION ALL
  SELECT 'MISSING_RESTRICTIVE_POLICY', 'tenant_data.' || t.relname,
         'tenant table has no restrictive scope policy; an added permissive policy could widen access'
  FROM tenant_tables t
  JOIN policy_facts f ON f.polrelid = t.oid
  WHERE f.restrictive_count = 0
  UNION ALL
  SELECT 'UNSAFE_RESTRICTIVE_POLICY', 'tenant_data.' || t.relname,
         'restrictive policy predicate is constantly true'
  FROM tenant_tables t
  JOIN policy_facts f ON f.polrelid = t.oid
  WHERE f.restrictive_true
  UNION ALL
  SELECT 'CLIENT_CONTEXT_IN_TENANT_POLICY', 'tenant_data.' || t.relname,
         'tenant policy reads a client-settable GUC directly instead of the verified context helper'
  FROM tenant_tables t
  JOIN policy_facts f ON f.polrelid = t.oid
  WHERE f.direct_context > 0
  UNION ALL
  -- Policies on tenant tables may target PUBLIC (all roles) or the customer runtime;
  -- no auth or operator or definer role may receive a tenant path through a policy.
  SELECT 'FORBIDDEN_POLICY_ROLE', 'tenant_data.' || t.relname,
         'policy addresses role ' || coalesce(pr.rolname, 'oid ' || polrole::text)
  FROM tenant_tables t
  JOIN pg_policy p ON p.polrelid = t.oid
  CROSS JOIN LATERAL unnest(p.polroles) polrole
  LEFT JOIN pg_roles pr ON pr.oid = polrole
  WHERE polrole <> 0
    AND coalesce(pr.rolname, '') !~ '(^|_)customer_app$'

  -- ---------------------------------------------------------------------------
  -- 2. Tenant-scoped auth membership
  -- ---------------------------------------------------------------------------
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_MISSING_ENABLE_RLS', 'auth.' || relname,
         'tenant-scoped membership table does not ENABLE ROW LEVEL SECURITY'
  FROM tenant_scoped_auth WHERE NOT relrowsecurity
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_MISSING_FORCE_RLS', 'auth.' || relname,
         'tenant-scoped membership table does not FORCE ROW LEVEL SECURITY'
  FROM tenant_scoped_auth WHERE relrowsecurity AND NOT relforcerowsecurity
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_MISSING_POLICY', 'auth.' || t.relname,
         'tenant-scoped membership table has no permissive policy'
  FROM tenant_scoped_auth t
  LEFT JOIN policy_facts f ON f.polrelid = t.oid
  WHERE coalesce(f.permissive_count, 0) = 0
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_MISSING_RESTRICTIVE_POLICY', 'auth.' || t.relname,
         'tenant-scoped membership table has no restrictive policy'
  FROM tenant_scoped_auth t
  LEFT JOIN policy_facts f ON f.polrelid = t.oid
  WHERE coalesce(f.restrictive_count, 0) = 0
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_UNSAFE_POLICY', 'auth.' || t.relname,
         'tenant-scoped membership policy predicate is constantly true'
  FROM tenant_scoped_auth t
  JOIN policy_facts f ON f.polrelid = t.oid
  WHERE f.restrictive_true

  -- ---------------------------------------------------------------------------
  -- 3. Partition, child, view and materialized-view paths
  -- ---------------------------------------------------------------------------
  UNION ALL
  SELECT 'UNSAFE_PARTITION_PATH', cn.nspname || '.' || c.relname,
         'child of tenant_data.' || c.parent_name ||
         ' is directly reachable by a runtime role without its own forced RLS and policy'
  FROM tenant_children c
  JOIN pg_namespace cn ON cn.nspname = c.nspname
  WHERE EXISTS (
          SELECT 1 FROM runtime_roles rr
          WHERE (c.relkind IN ('r', 'p') AND (
                   has_table_privilege(rr.oid, c.oid, 'SELECT')
                   OR has_table_privilege(rr.oid, c.oid, 'INSERT')
                   OR has_table_privilege(rr.oid, c.oid, 'UPDATE')
                   OR has_table_privilege(rr.oid, c.oid, 'DELETE')))
        )
    AND (
      NOT c.relrowsecurity
      OR NOT c.relforcerowsecurity
      OR NOT EXISTS (
        SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polpermissive
      )
    )
  UNION ALL
  SELECT 'UNSAFE_VIEW_OWNER', v.nspname || '.' || v.relname,
         'view over tenant data is runtime-readable and owned by a bypassing principal'
  FROM tenant_views v
  JOIN pg_roles owner ON owner.oid = v.relowner
  WHERE v.relkind = 'v'
    AND (owner.rolsuper OR owner.rolbypassrls)
    AND EXISTS (
      SELECT 1 FROM runtime_roles rr
      WHERE has_table_privilege(rr.oid, v.oid, 'SELECT')
    )
  UNION ALL
  SELECT 'UNSAFE_MATERIALIZED_VIEW', v.nspname || '.' || v.relname,
         'materialized view over tenant data is runtime-readable; stored rows bypass row-level security'
  FROM tenant_views v
  WHERE v.relkind = 'm'
    AND EXISTS (
      SELECT 1 FROM runtime_roles rr
      WHERE has_table_privilege(rr.oid, v.oid, 'SELECT')
    )

  -- ---------------------------------------------------------------------------
  -- 4. SECURITY DEFINER authority paths
  -- ---------------------------------------------------------------------------
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_OWNER', f.nspname || '.' || f.proname,
         'SECURITY DEFINER owner ' || f.owner_name || ' is SUPERUSER or has BYPASSRLS'
  FROM function_facts f
  WHERE f.rolsuper OR f.rolbypassrls
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_OWNER_LOGIN', f.nspname || '.' || f.proname,
         'SECURITY DEFINER owner ' || f.owner_name || ' can log in; use a NOLOGIN definer role'
  FROM function_facts f
  WHERE f.rolcanlogin
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_SEARCH_PATH', f.nspname || '.' || f.proname,
         'SECURITY DEFINER function lacks a fixed pg_catalog-first search_path without public/$user/pg_temp'
  FROM function_facts f
  WHERE f.unsafe_search_path
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_PUBLIC_EXECUTE', f.nspname || '.' || f.proname,
         'PUBLIC can execute a SECURITY DEFINER function'
  FROM function_facts f
  WHERE f.public_execute
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_RUNTIME_ASSUMPTION', f.nspname || '.' || f.proname,
         'a runtime role is the owner or can SET ROLE to the SECURITY DEFINER owner'
  FROM function_facts f
  WHERE f.runtime_can_assume_owner
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_ROW_SECURITY', f.nspname || '.' || f.proname,
         'SECURITY DEFINER function disables row_security'
  FROM function_facts f
  WHERE f.row_security_off

  -- ---------------------------------------------------------------------------
  -- 5. Runtime ownership, role attributes and forbidden grants
  -- ---------------------------------------------------------------------------
  UNION ALL
  SELECT 'SAVEN_BYPASS_OR_SUPER', 'role ' || rolname,
         'SAVEN principal holds SUPERUSER or BYPASSRLS'
  FROM saven_roles WHERE rolsuper OR rolbypassrls
  UNION ALL
  SELECT 'RUNTIME_DDL_ATTRIBUTE', 'role ' || rr.rolname,
         'runtime role holds CREATEDB or CREATEROLE'
  FROM runtime_roles rr JOIN saven_roles sr ON sr.oid = rr.oid
  WHERE sr.rolcreatedb OR sr.rolcreaterole
  UNION ALL
  SELECT 'RUNTIME_ASSUMES_PRIVILEGED_ROLE', 'role ' || rr.rolname || ' -> ' || g.rolname,
         'runtime role can assume a migrator or definer role through membership'
  FROM runtime_roles rr
  JOIN role_closure rc ON rc.member = rr.oid
  JOIN pg_roles g ON g.oid = rc.granted
  WHERE g.rolname ~ '(^|_)(migrator|definer)$'
  UNION ALL
  SELECT 'RUNTIME_OWNS_OBJECT', cr.nspname || '.' || cr.relname,
         'runtime role ' || rr.rolname || ' owns a covered relation'
  FROM runtime_roles rr
  JOIN covered_relations cr ON cr.relowner = rr.oid
  UNION ALL
  SELECT 'RUNTIME_OWNS_FUNCTION', f.nspname || '.' || p.proname,
         'runtime role owns a covered function'
  FROM runtime_roles rr
  JOIN pg_proc p ON p.proowner = rr.oid
  JOIN pg_namespace f ON f.oid = p.pronamespace
  WHERE f.nspname IN ('tenant_data', 'auth', 'operator')
  UNION ALL
  SELECT 'BYPASS_OWNER', cr.nspname || '.' || cr.relname,
         'covered relation is owned by a SUPERUSER or BYPASSRLS principal'
  FROM covered_relations cr
  JOIN pg_roles owner ON owner.oid = cr.relowner
  WHERE owner.rolsuper OR owner.rolbypassrls
  UNION ALL
  SELECT 'RUNTIME_SCHEMA_CREATE', 'role ' || rr.rolname || ' schema ' || s.nspname,
         'runtime role can create objects in a covered schema'
  FROM runtime_roles rr
  CROSS JOIN (VALUES ('tenant_data'), ('auth'), ('operator')) s(nspname)
  WHERE has_schema_privilege(rr.oid, s.nspname, 'CREATE')
  UNION ALL
  SELECT 'PUBLIC_RELATION_PRIVILEGE', cr.nspname || '.' || cr.relname,
         'PUBLIC holds ' || a.privilege_type || ' on a covered relation'
  FROM covered_relations cr
  CROSS JOIN LATERAL aclexplode(cr.relacl) a
  WHERE cr.relacl IS NOT NULL
    AND cr.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND a.grantee = 0
  UNION ALL
  SELECT 'PUBLIC_COLUMN_PRIVILEGE', n.nspname || '.' || c.relname || '.' || att.attname,
         'PUBLIC holds ' || a.privilege_type || ' on a covered column'
  FROM pg_attribute att
  JOIN pg_class c ON c.oid = att.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(att.attacl) a
  WHERE att.attacl IS NOT NULL
    AND n.nspname IN ('tenant_data', 'auth', 'operator') AND a.grantee = 0
  UNION ALL
  SELECT 'FORBIDDEN_RUNTIME_PRIVILEGE', rp.nspname || '.' || rp.relname,
         rp.rolname || ' holds ' || rp.privilege || ' on a tenant relation'
  FROM runtime_relation_privileges rp
  WHERE rp.nspname = 'tenant_data'
    AND rp.privilege IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  UNION ALL
  SELECT 'CUSTOMER_CROSS_SCHEMA_PRIVILEGE', rp.nspname || '.' || rp.relname,
         rp.rolname || ' (customer_app) holds ' || rp.privilege || ' outside tenant_data'
  FROM runtime_relation_privileges rp
  WHERE rp.class = 'customer_app'
    AND rp.nspname IN ('auth', 'operator')
  UNION ALL
  SELECT 'AUTH_SERVICE_TENANT_PRIVILEGE', rp.nspname || '.' || rp.relname,
         rp.rolname || ' (auth_service) holds ' || rp.privilege || ' on tenant_data'
  FROM runtime_relation_privileges rp
  WHERE rp.class = 'auth_service' AND rp.nspname = 'tenant_data'
  UNION ALL
  SELECT 'OPERATOR_TENANT_PRIVILEGE', rp.nspname || '.' || rp.relname,
         rp.rolname || ' (' || rp.class || ') holds ' || rp.privilege || ' on tenant_data'
  FROM runtime_relation_privileges rp
  WHERE rp.class IN ('operator_read', 'operator_admin') AND rp.nspname = 'tenant_data'
  UNION ALL
  SELECT 'CUSTOMER_DEFINER_EXECUTE', f.nspname || '.' || f.proname,
         'customer_app can execute a SECURITY DEFINER function in auth/operator'
  FROM function_facts f
  JOIN runtime_roles rr ON rr.class = 'customer_app'
  WHERE f.nspname IN ('auth', 'operator')
    AND has_function_privilege(rr.oid, f.oid, 'EXECUTE')
)
SELECT kind, object, detail
FROM violations
ORDER BY kind, object;
