-- PIVOT-008: target PostgreSQL RLS/privilege coverage gate.
--
-- Read-only. Every returned row is a coverage violation. An empty result is a pass;
-- scripts/verify-pg-rls.mjs turns any row into a nonzero process exit. This file
-- performs no DDL, DML, GRANT, REVOKE or repair. An operator investigates a violation;
-- the gate never silently fixes one.
--
-- The query has four jobs:
--   1. assert the reviewed installed surface exists (schemas, roles, relations,
--      policy/function signatures, prerequisite trigger/protocol bindings, the
--      versioned operator read policy shape);
--   2. evaluate the accepted effective tenant/membership policy contract per command
--      and applicable principal, including USING/WITH CHECK and restrictive partners;
--   3. compare effective relation/column/sequence/function and role-switch authority
--      with the accepted per-runtime profile, including associated login roles;
--   4. traverse views, materialized views and inheritance children transitively, and
--      evaluate the published endpoint, not an intermediate object.
--
-- Role identity is resolved from the reviewed bootstrap prefix. Deployment uses
-- `saven_`; the disposable fixture uses its own `saven_pivot_<suffix>_` prefix derived
-- from the migration owner of the covered schemas. A required class is an explicit
-- reviewed registration, not a loose name suffix, so an unrelated role cannot satisfy
-- it and a new runtime class must be added to both the bootstrap and this manifest.
--
-- Reviewed surface manifests describe the installed release. They are not a growing
-- business-domain enum: new tenant tables are covered automatically by the catalog
-- checks, but must be added to the installed manifest when they become release-
-- required. Role suffixes and schema/function/trigger names are stable protocol
-- identifiers, not business configuration.

WITH RECURSIVE
-- ---------------------------------------------------------------------------
-- 1. Reviewed role registry
-- ---------------------------------------------------------------------------
role_prefixes AS (
  SELECT DISTINCT regexp_replace(owner.rolname, 'migrator$', '') AS prefix
  FROM pg_namespace n
  JOIN pg_roles owner ON owner.oid = n.nspowner
  WHERE n.nspname IN ('tenant_data', 'auth', 'operator')
    AND owner.rolname ~ 'migrator$'
),
effective_prefixes AS (
  SELECT prefix FROM role_prefixes
  UNION
  SELECT 'saven_' WHERE NOT EXISTS (SELECT 1 FROM role_prefixes)
),
required_role_classes(class, suffix, role_kind) AS (
  VALUES
    ('customer_app', 'customer_app', 'runtime'),
    ('auth_service', 'auth_service', 'runtime'),
    ('operator_read', 'operator_read', 'runtime'),
    ('operator_admin', 'operator_admin', 'runtime'),
    ('migrator', 'migrator', 'owner'),
    ('operator_definer', 'operator_definer', 'owner'),
    ('auth_definer', 'auth_definer', 'owner'),
    ('tenant_admission_definer', 'tenant_admission_definer', 'owner'),
    ('void_definer', 'void_definer', 'owner'),
    ('audit_definer', 'audit_definer', 'owner')
),
required_roles AS (
  SELECT m.class, m.role_kind, p.prefix || m.suffix AS expected_name,
         r.oid, r.rolname, r.rolsuper, r.rolbypassrls, r.rolcanlogin,
         r.rolcreatedb, r.rolcreaterole, r.rolinherit
  FROM required_role_classes m
  CROSS JOIN effective_prefixes p
  LEFT JOIN pg_roles r ON r.rolname = p.prefix || m.suffix
),
runtime_roles AS (
  SELECT class AS actor_class, oid, rolname FROM required_roles
  WHERE role_kind = 'runtime' AND oid IS NOT NULL
),
owner_roles AS (
  SELECT class AS actor_class, oid, rolname FROM required_roles
  WHERE role_kind = 'owner' AND oid IS NOT NULL
),
role_closure AS (
  SELECT m.member, m.roleid AS granted FROM pg_auth_members m
  UNION
  SELECT c.member, m.roleid
  FROM role_closure c
  JOIN pg_auth_members m ON m.member = c.granted
),
-- ---------------------------------------------------------------------------
-- 2. Covered catalog objects and effective ACLs (NULL ACL = PostgreSQL default)
-- ---------------------------------------------------------------------------
covered_relations AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relispartition,
         c.relrowsecurity, c.relforcerowsecurity, c.relowner, c.reloptions,
         c.relacl
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
covered_functions AS (
  SELECT p.oid, n.nspname, p.proname,
         p.oid::regprocedure::text AS signature,
         p.proowner, p.prosecdef, p.proacl, p.proconfig, p.prosrc,
         p.prorettype, p.pronargs, p.prolang
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind = 'f'
    AND (
      -- Reviewed application schemas.
      n.nspname IN ('tenant_data', 'auth', 'operator')
      -- Authority/dependency-based coverage: a function owned by a required
      -- principal, executable by one, or a definer executable by PUBLIC must not
      -- disappear by living outside the three schemas.
      OR p.proowner IN (SELECT r.oid FROM required_roles r WHERE r.oid IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM required_roles r
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
        WHERE r.oid IS NOT NULL AND a.grantee = r.oid
      )
      OR (p.prosecdef AND EXISTS (
        SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
        WHERE a.grantee = 0
      ))
    )
),
relation_acls AS (
  SELECT a.grantee, cr.oid AS rel_oid, cr.nspname, cr.relname, cr.relkind,
         a.privilege_type AS privilege
  FROM covered_relations cr
  CROSS JOIN LATERAL aclexplode(
    coalesce(cr.relacl, acldefault((CASE WHEN cr.relkind = 'S' THEN 'S' ELSE 'r' END)::"char", cr.relowner))
  ) a
  WHERE a.grantee <> 0
),
column_acls AS (
  SELECT a.grantee, att.attrelid AS rel_oid, att.attname, a.privilege_type AS privilege
  FROM pg_attribute att
  JOIN covered_relations cr ON cr.oid = att.attrelid
  CROSS JOIN LATERAL aclexplode(att.attacl) a
  WHERE att.attacl IS NOT NULL
    AND att.attnum > 0 AND NOT att.attisdropped
    AND a.grantee <> 0
),
function_acls AS (
  SELECT a.grantee, f.oid AS function_oid, a.privilege_type AS privilege
  FROM covered_functions f
  CROSS JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) a
  WHERE a.grantee <> 0
),
schema_acls AS (
  SELECT n.nspname, n.nspowner, a.grantee, a.privilege_type AS privilege
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) a
  WHERE n.nspname IN ('tenant_data', 'auth', 'operator')
),
schema_privilege_contract(actor_class, nspname, privilege) AS (
  VALUES
    ('customer_app', 'tenant_data', 'USAGE'),
    ('auth_service', 'auth', 'USAGE'),
    ('auth_service', 'operator', 'USAGE'),
    ('operator_read', 'operator', 'USAGE'),
    ('operator_admin', 'operator', 'USAGE'),
    ('operator_definer', 'operator', 'USAGE'),
    ('operator_definer', 'auth', 'USAGE'),
    ('operator_definer', 'tenant_data', 'USAGE'),
    ('auth_definer', 'auth', 'USAGE'),
    ('tenant_admission_definer', 'auth', 'USAGE'),
    ('tenant_admission_definer', 'tenant_data', 'USAGE'),
    ('audit_definer', 'tenant_data', 'USAGE'),
    ('void_definer', 'tenant_data', 'USAGE')
),
public_relation_acls AS (
  SELECT cr.oid AS rel_oid, cr.nspname, cr.relname, cr.relkind, a.privilege_type AS privilege
  FROM covered_relations cr
  CROSS JOIN LATERAL aclexplode(
    coalesce(cr.relacl, acldefault((CASE WHEN cr.relkind = 'S' THEN 'S' ELSE 'r' END)::"char", cr.relowner))
  ) a
  WHERE a.grantee = 0
),
public_column_acls AS (
  SELECT att.attrelid AS rel_oid, att.attname, a.privilege_type AS privilege
  FROM pg_attribute att
  JOIN covered_relations cr ON cr.oid = att.attrelid
  CROSS JOIN LATERAL aclexplode(att.attacl) a
  WHERE att.attacl IS NOT NULL
    AND att.attnum > 0 AND NOT att.attisdropped
    AND a.grantee = 0
),
public_function_acls AS (
  SELECT f.oid AS function_oid, a.privilege_type AS privilege
  FROM covered_functions f
  CROSS JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) a
  WHERE a.grantee = 0
),
-- ---------------------------------------------------------------------------
-- 3. Runtime login principals, associated by membership (never by a name guess)
-- ---------------------------------------------------------------------------
login_membership AS (
  SELECT r.oid, r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
         r.rolcreatedb, r.rolcreaterole, r.rolinherit,
         count(DISTINCT rr.oid) AS runtime_classes,
         count(DISTINCT own.oid) AS owner_classes,
         min(rr.actor_class) AS actor_class
  FROM pg_roles r
  LEFT JOIN role_closure rc ON rc.member = r.oid
  LEFT JOIN runtime_roles rr ON rr.oid = rc.granted
  LEFT JOIN owner_roles own ON own.oid = rc.granted
  WHERE r.rolcanlogin
  GROUP BY r.oid, r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
           r.rolcreatedb, r.rolcreaterole, r.rolinherit
),
runtime_logins AS (
  SELECT * FROM login_membership WHERE runtime_classes > 0
),
membership_principals AS (
  SELECT class AS actor_class, oid FROM required_roles
  WHERE class IN ('auth_service', 'tenant_admission_definer') AND oid IS NOT NULL
),
offline_logins AS (
  SELECT * FROM login_membership WHERE runtime_classes = 0 AND owner_classes > 0
),
actors AS (
  SELECT 'runtime'::text AS actor_kind, actor_class, oid AS actor_oid, rolname AS actor_name
  FROM runtime_roles
  UNION ALL
  SELECT 'login', actor_class, oid, rolname FROM runtime_logins
),
effective_relation_privileges AS (
  SELECT a.actor_kind, a.actor_class, a.actor_oid, a.actor_name,
         ra.rel_oid, ra.nspname, ra.relname, ra.relkind, ra.privilege
  FROM actors a
  JOIN relation_acls ra
    ON ra.grantee = a.actor_oid
    OR EXISTS (SELECT 1 FROM role_closure rc WHERE rc.member = a.actor_oid AND rc.granted = ra.grantee)
),
effective_column_privileges AS (
  SELECT a.actor_kind, a.actor_class, a.actor_oid, a.actor_name,
         cr.oid AS rel_oid, cr.nspname, cr.relname, ca.attname, ca.privilege
  FROM actors a
  JOIN column_acls ca
    ON ca.grantee = a.actor_oid
    OR EXISTS (SELECT 1 FROM role_closure rc WHERE rc.member = a.actor_oid AND rc.granted = ca.grantee)
  JOIN covered_relations cr ON cr.oid = ca.rel_oid
),
direct_login_relation_privileges AS (
  SELECT rl.oid, rl.rolname, ra.nspname, ra.relname, ra.privilege
  FROM runtime_logins rl
  JOIN relation_acls ra ON ra.grantee = rl.oid
),
direct_login_column_privileges AS (
  SELECT rl.oid, rl.rolname, cr.nspname, cr.relname, ca.attname, ca.privilege
  FROM runtime_logins rl
  JOIN column_acls ca ON ca.grantee = rl.oid
  JOIN covered_relations cr ON cr.oid = ca.rel_oid
),
direct_login_function_privileges AS (
  SELECT rl.oid, rl.rolname, f.nspname, f.signature
  FROM runtime_logins rl
  JOIN function_acls fa ON fa.grantee = rl.oid
  JOIN covered_functions f ON f.oid = fa.function_oid
),
direct_login_schema_privileges AS (
  SELECT rl.oid, rl.rolname, sa.nspname, sa.privilege
  FROM runtime_logins rl
  JOIN schema_acls sa ON sa.grantee = rl.oid
),
actor_schema_privileges AS (
  SELECT a.actor_kind, a.actor_class, a.actor_name, sa.nspname, sa.privilege
  FROM actors a
  JOIN schema_acls sa
    ON sa.grantee = a.actor_oid
    OR EXISTS (SELECT 1 FROM role_closure rc WHERE rc.member = a.actor_oid AND rc.granted = sa.grantee)
),
privileged_capability_roles AS (
  SELECT r.oid, r.rolname
  FROM pg_roles r
  WHERE (
      r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole
      OR EXISTS (SELECT 1 FROM covered_relations cr WHERE cr.relowner = r.oid)
      OR EXISTS (SELECT 1 FROM covered_functions f WHERE f.proowner = r.oid)
      OR EXISTS (SELECT 1 FROM relation_acls ra WHERE ra.grantee = r.oid)
      OR EXISTS (SELECT 1 FROM column_acls ca WHERE ca.grantee = r.oid)
      OR EXISTS (SELECT 1 FROM function_acls fa WHERE fa.grantee = r.oid)
      OR EXISTS (SELECT 1 FROM schema_acls sa WHERE sa.grantee = r.oid AND sa.privilege = 'CREATE')
    )
    AND NOT EXISTS (SELECT 1 FROM required_roles rr WHERE rr.oid = r.oid)
    AND NOT EXISTS (SELECT 1 FROM runtime_logins rl WHERE rl.oid = r.oid)
    AND NOT EXISTS (SELECT 1 FROM offline_logins ol WHERE ol.oid = r.oid)
),
-- ---------------------------------------------------------------------------
-- 4. Effective policy contract per command and principal
-- ---------------------------------------------------------------------------
tenant_policy_contract(policy_suffix, is_permissive, polcmd, target_kind, using_hash, check_hash) AS (
  VALUES
    ('_tenant_isolation', true, '*', 'public',
     '4fb3d3ef32001effa43774da702ae9b4', '4fb3d3ef32001effa43774da702ae9b4'),
    ('_tenant_scope', false, '*', 'public',
     '4fb3d3ef32001effa43774da702ae9b4', '4fb3d3ef32001effa43774da702ae9b4'),
    ('_runtime_admission', false, '*', 'customer_app',
     '204940156f611262004e5fcb9fe0c26b', '204940156f611262004e5fcb9fe0c26b')
),
tenant_policy_actual AS (
  SELECT t.oid AS rel_oid, t.relname, p.polname, p.polpermissive, p.polcmd,
         CASE
           WHEN p.polroles = ARRAY[0]::oid[] THEN 'public'
           WHEN p.polroles = ARRAY[rr.oid] THEN 'customer_app'
           ELSE 'other'
         END AS target_kind,
         md5(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '\s+', '', 'g')) AS using_hash,
         md5(regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '\s+', '', 'g')) AS check_hash
  FROM tenant_tables t
  JOIN pg_policy p ON p.polrelid = t.oid
  LEFT JOIN runtime_roles rr ON rr.actor_class = 'customer_app'
),
tenant_policy_status AS (
  SELECT t.oid AS rel_oid, t.relname, c.*,
         EXISTS (
           SELECT 1 FROM tenant_policy_actual a
           WHERE a.rel_oid = t.oid AND a.polname = t.relname || c.policy_suffix
         ) AS policy_exists,
         EXISTS (
           SELECT 1 FROM tenant_policy_actual a
           WHERE a.rel_oid = t.oid AND a.polname = t.relname || c.policy_suffix
             AND a.polpermissive = c.is_permissive AND a.polcmd = c.polcmd
             AND a.target_kind = c.target_kind
             AND a.using_hash = c.using_hash AND a.check_hash = c.check_hash
         ) AS policy_matches
  FROM tenant_tables t
  CROSS JOIN tenant_policy_contract c
),
commands(cmd) AS (VALUES ('r'), ('a'), ('w'), ('d')),
tenant_policy_gaps AS (
  SELECT st.rel_oid, st.relname, cmd, st.policy_suffix, st.is_permissive
  FROM tenant_policy_status st
  CROSS JOIN commands c
  WHERE NOT st.policy_matches
),
tenant_unexpected_policies AS (
  SELECT a.rel_oid, a.relname, a.polname
  FROM tenant_policy_actual a
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant_policy_contract c
    WHERE a.polname = a.relname || c.policy_suffix
  )
),
membership_policy_contract(policy_name, is_permissive, polcmd, role_class, using_hash, check_hash) AS (
  VALUES
    ('tenant_membership_preselect', true, 'r', 'auth_service',
     'dd8036bc91993b08cd413c303db5ce2b', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('tenant_membership_preselect_scope', false, '*', 'auth_service',
     'dd8036bc91993b08cd413c303db5ce2b', 'dd8036bc91993b08cd413c303db5ce2b'),
    ('tenant_membership_admission_lookup', true, 'r', 'tenant_admission_definer',
     'ae5c2646201b4aa7316eaf37d3aac8d0', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('tenant_membership_admission_scope', false, '*', 'tenant_admission_definer',
     'ae5c2646201b4aa7316eaf37d3aac8d0', 'ae5c2646201b4aa7316eaf37d3aac8d0')
),
membership_policy_actual AS (
  SELECT m.oid AS rel_oid, m.relname, p.polname, p.polpermissive, p.polcmd,
         coalesce(
           (SELECT rr.class FROM required_roles rr WHERE rr.oid = ANY(p.polroles) LIMIT 1),
           'other'
         ) AS target_kind,
         md5(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '\s+', '', 'g')) AS using_hash,
         md5(regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '\s+', '', 'g')) AS check_hash
  FROM tenant_scoped_auth m
  JOIN pg_policy p ON p.polrelid = m.oid
),
membership_policy_status AS (
  SELECT m.oid AS rel_oid, m.relname, c.*,
         EXISTS (
           SELECT 1 FROM membership_policy_actual a
           WHERE a.rel_oid = m.oid AND a.polname = c.policy_name
         ) AS policy_exists,
         EXISTS (
           SELECT 1 FROM membership_policy_actual a
           WHERE a.rel_oid = m.oid AND a.polname = c.policy_name
             AND a.polpermissive = c.is_permissive AND a.polcmd = c.polcmd
             AND a.target_kind = c.role_class
             AND a.using_hash = c.using_hash AND a.check_hash = c.check_hash
         ) AS policy_matches
  FROM tenant_scoped_auth m
  CROSS JOIN membership_policy_contract c
),
membership_unexpected_policies AS (
  SELECT a.rel_oid, a.relname, a.polname, a.polpermissive, a.polcmd
  FROM membership_policy_actual a
  WHERE NOT EXISTS (
    SELECT 1 FROM membership_policy_contract c WHERE a.polname = c.policy_name
  )
),
-- ---------------------------------------------------------------------------
-- 5. Transitive reachability: tenant tables -> views/matviews/children
-- ---------------------------------------------------------------------------
reachable(kind, oid, path, tainted) AS (
  SELECT 'table', t.oid, ARRAY[t.oid], false FROM tenant_tables t
  UNION ALL
  SELECT nxt.kind, nxt.oid, r.path || nxt.oid,
         r.tainted OR nxt.owner_tainted
  FROM reachable r
  CROSS JOIN LATERAL (
    SELECT CASE v.relkind WHEN 'm' THEN 'matview' ELSE 'view' END AS kind, v.oid,
           CASE
             WHEN v.relkind = 'm' THEN true
             WHEN coalesce(array_to_string(v.reloptions, ','), '') LIKE '%security_invoker=true%' THEN false
             ELSE coalesce(owner.rolsuper OR owner.rolbypassrls, false)
           END AS owner_tainted
    FROM pg_rewrite rw
    JOIN pg_depend d
      ON d.classid = 'pg_rewrite'::regclass
     AND d.objid = rw.oid
     AND d.refclassid = 'pg_class'::regclass
     AND d.refobjid = r.oid
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
    JOIN pg_roles owner ON owner.oid = v.relowner
    WHERE rw.ev_class <> r.oid
    UNION ALL
    SELECT 'child', ch.oid, false
    FROM pg_inherits i
    JOIN pg_class ch ON ch.oid = i.inhrelid AND ch.relkind IN ('r', 'p')
    WHERE i.inhparent = r.oid
  ) nxt
  WHERE NOT nxt.oid = ANY(r.path)
),
reachable_objects AS (
  SELECT oid, min(kind) AS kind, bool_or(tainted) AS tainted
  FROM reachable
  GROUP BY oid
),
reachable_relation_details AS (
  SELECT ro.oid, ro.kind, c.relname, n.nspname, c.relkind, c.relowner,
         c.relrowsecurity, c.relforcerowsecurity, c.reloptions, c.relacl
  FROM reachable_objects ro
  JOIN pg_class c ON c.oid = ro.oid
  JOIN pg_namespace n ON n.oid = c.relnamespace
),
reachable_relation_acls AS (
  SELECT a.grantee, rd.oid AS rel_oid, a.privilege_type AS privilege
  FROM reachable_relation_details rd
  CROSS JOIN LATERAL aclexplode(coalesce(rd.relacl, acldefault('r'::"char", rd.relowner))) a
  WHERE a.grantee <> 0
),
reachable_column_acls AS (
  SELECT a.grantee, att.attrelid AS rel_oid, a.privilege_type AS privilege
  FROM pg_attribute att
  JOIN reachable_relation_details rd ON rd.oid = att.attrelid
  CROSS JOIN LATERAL aclexplode(att.attacl) a
  WHERE att.attacl IS NOT NULL AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee <> 0
),
runtime_read_endpoints AS (
  SELECT DISTINCT ra.rel_oid
  FROM actors a
  JOIN reachable_relation_acls ra
    ON ra.grantee = a.actor_oid
    OR EXISTS (SELECT 1 FROM role_closure rc WHERE rc.member = a.actor_oid AND rc.granted = ra.grantee)
  WHERE a.actor_kind = 'runtime' AND ra.privilege = 'SELECT'
  UNION
  SELECT DISTINCT ca.rel_oid
  FROM actors a
  JOIN reachable_column_acls ca
    ON ca.grantee = a.actor_oid
    OR EXISTS (SELECT 1 FROM role_closure rc WHERE rc.member = a.actor_oid AND rc.granted = ca.grantee)
  WHERE a.actor_kind = 'runtime' AND ca.privilege = 'SELECT'
),
runtime_write_endpoints AS (
  SELECT ra.rel_oid, ra.privilege AS cmd
  FROM actors a
  JOIN reachable_relation_acls ra
    ON ra.grantee = a.actor_oid
    OR EXISTS (SELECT 1 FROM role_closure rc WHERE rc.member = a.actor_oid AND rc.granted = ra.grantee)
  WHERE a.actor_kind = 'runtime' AND ra.privilege IN ('INSERT', 'UPDATE', 'DELETE')
  UNION
  SELECT ca.rel_oid,
         CASE ca.privilege WHEN 'INSERT' THEN 'INSERT' WHEN 'UPDATE' THEN 'UPDATE' END AS cmd
  FROM actors a
  JOIN reachable_column_acls ca
    ON ca.grantee = a.actor_oid
    OR EXISTS (SELECT 1 FROM role_closure rc WHERE rc.member = a.actor_oid AND rc.granted = ca.grantee)
  WHERE a.actor_kind = 'runtime' AND ca.privilege IN ('INSERT', 'UPDATE')
),
endpoint_ancestors(oid, path) AS (
  SELECT rel_oid AS oid, ARRAY[rel_oid] FROM runtime_read_endpoints
  UNION ALL
  SELECT v.oid, e.path || v.oid
  FROM endpoint_ancestors e
  JOIN pg_rewrite rw ON rw.ev_class <> e.oid
  JOIN pg_depend d
    ON d.classid = 'pg_rewrite'::regclass
   AND d.objid = rw.oid
   AND d.refclassid = 'pg_class'::regclass
   AND d.refobjid = e.oid
  JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
  WHERE NOT v.oid = ANY(e.path)
),
child_policy_rows AS (
  SELECT rd.oid AS rel_oid, rd.relname, p.polcmd, p.polpermissive,
         coalesce(pg_get_expr(p.polqual, p.polrelid), '') AS using_expr,
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS check_expr
  FROM reachable_relation_details rd
  JOIN pg_policy p ON p.polrelid = rd.oid
  WHERE rd.kind = 'child'
),
child_write_gaps AS (
  SELECT rd.oid AS rel_oid, rd.nspname || '.' || rd.relname AS object_name, cmd
  FROM reachable_relation_details rd
  JOIN (SELECT DISTINCT rel_oid, cmd FROM runtime_write_endpoints) w ON w.rel_oid = rd.oid
  WHERE rd.kind = 'child'
    AND (
      NOT rd.relrowsecurity OR NOT rd.relforcerowsecurity
      OR NOT EXISTS (
        SELECT 1 FROM child_policy_rows cp
        WHERE cp.rel_oid = rd.oid AND cp.polpermissive
          AND (cp.polcmd = '*' OR cp.polcmd = w.cmd)
          AND (w.cmd NOT IN ('r', 'w', 'd') OR (cp.using_expr LIKE '%tenant_id%' AND cp.using_expr LIKE '%current_tenant_id%'))
          AND (w.cmd NOT IN ('a', 'w') OR (cp.check_expr LIKE '%tenant_id%' AND cp.check_expr LIKE '%current_tenant_id%'))
      )
      OR NOT EXISTS (
        SELECT 1 FROM child_policy_rows cp
        WHERE cp.rel_oid = rd.oid AND NOT cp.polpermissive
          AND (cp.polcmd = '*' OR cp.polcmd = w.cmd)
          AND (w.cmd NOT IN ('r', 'w', 'd') OR (cp.using_expr LIKE '%tenant_id%' AND cp.using_expr LIKE '%current_tenant_id%'))
          AND (w.cmd NOT IN ('a', 'w') OR (cp.check_expr LIKE '%tenant_id%' AND cp.check_expr LIKE '%current_tenant_id%'))
      )
    )
),
-- ---------------------------------------------------------------------------
-- 6. Function authority
-- ---------------------------------------------------------------------------
definer_base AS (
  SELECT f.*,
         owner.rolname AS owner_name, owner.rolsuper, owner.rolbypassrls, owner.rolcanlogin,
         (SELECT cfg FROM unnest(coalesce(f.proconfig, ARRAY[]::text[])) cfg
          WHERE cfg LIKE 'search_path=%' LIMIT 1) AS search_path_config,
         coalesce(EXISTS (SELECT 1 FROM unnest(coalesce(f.proconfig, ARRAY[]::text[])) cfg
                          WHERE cfg = 'row_security=off'), false) AS row_security_off,
         coalesce(EXISTS (SELECT 1 FROM public_function_acls pfa
                          WHERE pfa.function_oid = f.oid AND pfa.privilege = 'EXECUTE'), false)
           AS public_execute,
         EXISTS (
           SELECT 1 FROM runtime_roles rr
           WHERE rr.oid = f.proowner
              OR EXISTS (SELECT 1 FROM role_closure rc
                         WHERE rc.member = rr.oid AND rc.granted = f.proowner)
         ) AS runtime_can_assume_owner
  FROM covered_functions f
  JOIN pg_roles owner ON owner.oid = f.proowner
  WHERE f.prosecdef
),
definer_functions AS (
  SELECT d.*,
         CASE WHEN d.search_path_config IS NULL THEN true
              ELSE NOT (
                regexp_replace(split_part(d.search_path_config, '=', 2), '^\s+', '') ~ '^pg_catalog(,|$)'
                AND NOT EXISTS (
                  SELECT 1 FROM unnest(regexp_split_to_array(split_part(d.search_path_config, '=', 2), '\s*,\s*')) tok
                  WHERE lower(replace(tok, '"', '')) IN ('public', '$user', 'pg_temp')
                )
              )
         END AS unsafe_search_path
  FROM definer_base d
),
-- ---------------------------------------------------------------------------
-- 7. Reviewed installed-surface and authority manifests
-- ---------------------------------------------------------------------------
required_relations AS (
  SELECT 'tenant_data.' || name AS object_name, 'table' AS object_type
  FROM unnest(string_to_array(
    'account_profiles,accounts,approval_policy,approval_requests,assignments,audit,audit_event,business,business_rule,command_decisions,command_files,command_inbox,company_profiles,company_settings,denials,document_numbers,document_registry,document_revisions,document_sequences,entry_voids,inventory_controls,journal_corrections,journal_drafts,journal_lines,journals,members,outbox,periods,posting_constraint,reference_values,roles,source_store_migrations,stock_balances,stock_items,stock_movements,stock_operations,support_grants,tax_profile,trade_allocations,trade_controls,trade_credit_lines,trade_credits,trade_documents,trade_lines,trade_operations,trade_parties,verified_entitlement,void_denials,warehouses',
    ',')) name
  UNION ALL
  SELECT 'auth.' || name, 'table' FROM unnest(string_to_array(
    'accounts,auth_audit,oauth_state,recovery_codes,reference_value,roles,sessions,tenant_membership,two_factor,users,verification',
    ',')) name
  UNION ALL
  SELECT 'operator.' || name, 'table' FROM unnest(string_to_array(
    'access_exchange,access_identity,access_read_policy,access_session_binding,ai_requests,entitlement,feature_flag,jobs,migration_events,operator_audit,pg_schema_migrations,reference_value,source_store_migrations,tenant,tenant_placement',
    ',')) name
  UNION ALL
  SELECT 'tenant_data.' || name, 'view' FROM unnest(string_to_array('active_general_ledger,voided_entries', ',')) name
),
required_sequences AS (
  SELECT 'tenant_data.' || name AS object_name FROM unnest(string_to_array('audit_event_id_seq,audit_id_seq,void_denials_id_seq', ',')) name
  UNION ALL
  SELECT 'auth.' || name AS object_name FROM unnest(string_to_array('auth_audit_id_seq', ',')) name
  UNION ALL
  SELECT 'operator.' || name AS object_name FROM unnest(string_to_array('access_identity_generation_seq,entitlement_id_seq,feature_flag_id_seq,migration_events_id_seq,operator_audit_id_seq,source_store_migrations_id_seq', ',')) name
),
required_functions AS (
  SELECT unnest(ARRAY[
    'auth.lock_authority_gate()',
    'operator.assert_operator_definer_authority(text,boolean)',
    'operator.assert_read_authority_protocol()',
    'operator.lock_consent_gate()',
    'operator.lock_policy_gate()',
    'operator.log_operator_read_denial(uuid,text,text,text,text,text,text,text)',
    'operator.read_tenant_support(uuid,text,text,text,text,text,text,integer)',
    'tenant_data.current_tenant_id()',
    'tenant_data.current_user_id()',
    'tenant_data.immutability_040_journal_guard()',
    'tenant_data.immutability_041_audit_row()',
    'tenant_data.immutability_042_void_guard()',
    'tenant_data.session_admitted(uuid,uuid)',
    'tenant_data.void_posted_entry(uuid,text,text,text,text,text,text)'
  ]) AS object_name
),
required_installation_bindings(name, expected_md5) AS (
  VALUES
    ('auth.lock_authority_gate()', '2bafa1f4ac34b1f017cecb465c09af0b'),
    ('operator.assert_operator_definer_authority(text,boolean)', '5612f88c09dbfe1b591d7bccfbcfe3ad'),
    ('operator.assert_read_authority_protocol()', '5587acdc973ae6ecdc820a5e6378b918'),
    ('operator.lock_consent_gate()', '6252bab66ee901a1b8962d06de3f9e4e'),
    ('operator.lock_policy_gate()', '412f9d3ebb4226d5c27fbb81ccf3338f'),
    ('operator.log_operator_read_denial(uuid,text,text,text,text,text,text,text)', 'bd077653443e3a15d0e6f2287ff6623c'),
    ('operator.read_tenant_support(uuid,text,text,text,text,text,text,integer)', 'e3d175c512f781376a89286cd8369b78'),
    ('tenant_data.current_tenant_id()', 'c3a5ee441ad8f2eaf2be33529989c791'),
    ('tenant_data.current_user_id()', '4d9a5ad53b10a258a70827a72bea8388'),
    ('tenant_data.immutability_040_journal_guard()', '0030c9c6a6541e796e87b126ae1a70d5'),
    ('tenant_data.immutability_041_audit_row()', 'ffb0966523acc4abe4c7463b8a61dd3a'),
    ('tenant_data.immutability_042_void_guard()', 'ae67263c077a0b6f43aacb44a761e5ba'),
    ('tenant_data.session_admitted(uuid,uuid)', '883da8f0713216fea3917c7307508f4f'),
    ('tenant_data.void_posted_entry(uuid,text,text,text,text,text,text)', 'd439adf267946f92b94e82b7ce37dd38')
),
required_triggers(schema_name, table_name, trigger_name, expected_type, function_schema, function_name) AS (
  VALUES
    ('auth', 'tenant_membership', 'tenant_membership_authority_gate_insert', 6, 'auth', 'lock_authority_gate'),
    ('auth', 'tenant_membership', 'tenant_membership_authority_gate_update', 18, 'auth', 'lock_authority_gate'),
    ('auth', 'tenant_membership', 'tenant_membership_authority_gate_delete', 10, 'auth', 'lock_authority_gate'),
    ('auth', 'roles', 'roles_authority_gate_insert', 6, 'auth', 'lock_authority_gate'),
    ('auth', 'roles', 'roles_authority_gate_update', 18, 'auth', 'lock_authority_gate'),
    ('auth', 'roles', 'roles_authority_gate_delete', 10, 'auth', 'lock_authority_gate'),
    ('operator', 'access_identity', 'access_identity_authority_gate_insert', 6, 'auth', 'lock_authority_gate'),
    ('operator', 'access_identity', 'access_identity_authority_gate_update', 18, 'auth', 'lock_authority_gate'),
    ('operator', 'access_identity', 'access_identity_authority_gate_delete', 10, 'auth', 'lock_authority_gate'),
    ('tenant_data', 'support_grants', 'support_grants_consent_gate_insert', 6, 'operator', 'lock_consent_gate'),
    ('tenant_data', 'support_grants', 'support_grants_consent_gate_update', 18, 'operator', 'lock_consent_gate'),
    ('tenant_data', 'support_grants', 'support_grants_consent_gate_delete', 10, 'operator', 'lock_consent_gate'),
    ('tenant_data', 'members', 'members_consent_gate_insert', 6, 'operator', 'lock_consent_gate'),
    ('tenant_data', 'members', 'members_consent_gate_update', 18, 'operator', 'lock_consent_gate'),
    ('tenant_data', 'members', 'members_consent_gate_delete', 10, 'operator', 'lock_consent_gate'),
    ('operator', 'access_read_policy', 'access_read_policy_policy_gate_insert', 6, 'operator', 'lock_policy_gate'),
    ('operator', 'access_read_policy', 'access_read_policy_policy_gate_update', 18, 'operator', 'lock_policy_gate'),
    ('operator', 'access_read_policy', 'access_read_policy_policy_gate_delete', 10, 'operator', 'lock_policy_gate'),
    ('tenant_data', 'journals', 'saven_p005_journals', 31, 'tenant_data', 'immutability_040_journal_guard'),
    ('tenant_data', 'audit_event', 'saven_p006_audit_event_append', 27, 'tenant_data', 'immutability_041_audit_append_guard'),
    ('tenant_data', 'entry_voids', 'saven_p005_entry_voids', 31, 'tenant_data', 'immutability_042_void_guard')
),
allowed_execute(actor_class, signature) AS (
  VALUES
    ('customer_app', 'tenant_data.current_tenant_id()'),
    ('customer_app', 'tenant_data.current_user_id()'),
    ('customer_app', 'tenant_data.session_admitted(uuid,uuid)'),
    ('customer_app', 'tenant_data.void_posted_entry(uuid,text,text,text,text,text,text)'),
    ('customer_app', 'tenant_data.immutability_040_approval_guard()'),
    ('customer_app', 'tenant_data.immutability_040_approval_resource(uuid,text)'),
    ('customer_app', 'tenant_data.immutability_040_approver_authority(uuid,text,text)'),
    ('customer_app', 'tenant_data.immutability_040_assert_posted_effects(uuid,text)'),
    ('customer_app', 'tenant_data.immutability_040_command_child_guard()'),
    ('customer_app', 'tenant_data.immutability_040_command_guard()'),
    ('customer_app', 'tenant_data.immutability_040_draft_guard()'),
    ('customer_app', 'tenant_data.immutability_040_journal_guard()'),
    ('customer_app', 'tenant_data.immutability_040_journal_line_guard()'),
    ('customer_app', 'tenant_data.immutability_040_lock_key(uuid,text)'),
    ('customer_app', 'tenant_data.immutability_040_number_guard()'),
    ('customer_app', 'tenant_data.immutability_040_revision_guard()'),
    ('customer_app', 'tenant_data.immutability_040_sequence_guard()'),
    ('operator_read', 'operator.log_operator_read_denial(uuid,text,text,text,text,text,text,text)'),
    ('operator_read', 'operator.read_tenant_support(uuid,text,text,text,text,text,text,integer)')
),
owner_allowed_execute(actor_class, signature) AS (
  VALUES
    ('operator_definer', 'tenant_data.current_tenant_id()'),
    ('operator_definer', 'tenant_data.current_user_id()'),
    ('tenant_admission_definer', 'tenant_data.current_tenant_id()'),
    ('tenant_admission_definer', 'tenant_data.current_user_id()'),
    ('audit_definer', 'tenant_data.current_tenant_id()'),
    ('audit_definer', 'tenant_data.current_user_id()'),
    ('audit_definer', 'tenant_data.session_admitted(uuid,uuid)'),
    ('void_definer', 'tenant_data.current_tenant_id()'),
    ('void_definer', 'tenant_data.current_user_id()'),
    ('void_definer', 'tenant_data.session_admitted(uuid,uuid)'),
    ('void_definer', 'tenant_data.immutability_040_approval_resource(uuid,text)'),
    ('void_definer', 'tenant_data.immutability_040_approver_authority(uuid,text,text)'),
    ('void_definer', 'tenant_data.immutability_040_lock_key(uuid,text)'),
    ('void_definer', 'tenant_data.immutability_042_decision_digest(jsonb)'),
    ('void_definer', 'tenant_data.immutability_042_policy_decision(uuid,text,bigint,text,text,text[],text,text)')
),
owner_allowed_relations(actor_class, relation_name) AS (
  VALUES
    ('tenant_admission_definer', 'tenant_data.members'),
    ('tenant_admission_definer', 'auth.tenant_membership'),
    ('tenant_admission_definer', 'auth.users'),
    ('audit_definer', 'tenant_data.audit_event'),
    ('audit_definer', 'tenant_data.members'),
    ('audit_definer', 'tenant_data.reference_values'),
    ('void_definer', 'tenant_data.approval_policy'),
    ('void_definer', 'tenant_data.approval_requests'),
    ('void_definer', 'tenant_data.assignments'),
    ('void_definer', 'tenant_data.audit'),
    ('void_definer', 'tenant_data.audit_event'),
    ('void_definer', 'tenant_data.command_decisions'),
    ('void_definer', 'tenant_data.command_inbox'),
    ('void_definer', 'tenant_data.company_profiles'),
    ('void_definer', 'tenant_data.denials'),
    ('void_definer', 'tenant_data.entry_voids'),
    ('void_definer', 'tenant_data.journal_corrections'),
    ('void_definer', 'tenant_data.journal_lines'),
    ('void_definer', 'tenant_data.journals'),
    ('void_definer', 'tenant_data.members'),
    ('void_definer', 'tenant_data.outbox'),
    ('void_definer', 'tenant_data.periods'),
    ('void_definer', 'tenant_data.roles'),
    ('void_definer', 'tenant_data.stock_operations'),
    ('void_definer', 'tenant_data.trade_credits'),
    ('void_definer', 'tenant_data.trade_operations'),
    ('operator_definer', 'operator.access_identity'),
    ('operator_definer', 'operator.access_read_policy'),
    ('operator_definer', 'operator.access_session_binding'),
    ('operator_definer', 'operator.operator_audit'),
    ('operator_definer', 'auth.roles'),
    ('operator_definer', 'auth.sessions'),
    ('operator_definer', 'auth.users'),
    ('operator_definer', 'tenant_data.accounts'),
    ('operator_definer', 'tenant_data.business'),
    ('operator_definer', 'tenant_data.company_profiles'),
    ('operator_definer', 'tenant_data.journal_lines'),
    ('operator_definer', 'tenant_data.journals'),
    ('operator_definer', 'tenant_data.members'),
    ('operator_definer', 'tenant_data.support_grants'),
    ('auth_definer', 'auth.accounts'),
    ('auth_definer', 'auth.auth_audit'),
    ('auth_definer', 'auth.oauth_state'),
    ('auth_definer', 'auth.recovery_codes'),
    ('auth_definer', 'auth.reference_value'),
    ('auth_definer', 'auth.roles'),
    ('auth_definer', 'auth.sessions'),
    ('auth_definer', 'auth.tenant_membership'),
    ('auth_definer', 'auth.two_factor'),
    ('auth_definer', 'auth.users'),
    ('auth_definer', 'auth.verification'),
    ('auth_definer', 'auth.auth_audit_id_seq'),
    ('audit_definer', 'tenant_data.audit_event_id_seq'),
    ('operator_definer', 'operator.operator_audit_id_seq')
),
owner_privilege_contract(actor_class, relation_name, privilege, columns) AS (
  SELECT split_part(line, '|', 1), split_part(line, '|', 2),
         split_part(line, '|', 3), split_part(line, '|', 4)
  FROM regexp_split_to_table($owner_manifest$audit_definer|tenant_data.audit_event_id_seq|USAGE|*
audit_definer|tenant_data.audit_event|INSERT|actor_id,detail_jsonb,entity_id,entity_type,event,happened_at,origin_model,origin_model_version,origin_type,origin_user_id,request_id,tenant_id
audit_definer|tenant_data.members|SELECT|tenant_id,user_id,user_uuid
audit_definer|tenant_data.reference_values|SELECT|domain,is_active,tenant_id,value
auth_definer|auth.accounts|SELECT|*
auth_definer|auth.auth_audit_id_seq|SELECT|*
auth_definer|auth.auth_audit_id_seq|USAGE|*
auth_definer|auth.auth_audit|INSERT|*
auth_definer|auth.auth_audit|SELECT|*
auth_definer|auth.oauth_state|SELECT|*
auth_definer|auth.recovery_codes|SELECT|*
auth_definer|auth.reference_value|SELECT|*
auth_definer|auth.roles|SELECT|*
auth_definer|auth.sessions|SELECT|*
auth_definer|auth.tenant_membership|SELECT|*
auth_definer|auth.two_factor|SELECT|*
auth_definer|auth.users|SELECT|*
auth_definer|auth.verification|SELECT|*
operator_definer|auth.roles|SELECT|assurance_class,effective_from,effective_to,is_active,is_operator,requires_mfa,role_id
operator_definer|auth.sessions|SELECT|absolute_expires_at,credential_version,id,idle_expires_at,realm,revoked_at,token_hash,user_id
operator_definer|auth.sessions|UPDATE|revoked_at
operator_definer|auth.users|SELECT|credential_version,id,status
operator_definer|auth.users|UPDATE|status
operator_definer|operator.access_identity|SELECT|assurance_class,effective_from,effective_to,mapping_epoch,operator_role_id,status,subject,user_id
operator_definer|operator.access_read_policy|SELECT|audience,effective_from,effective_to,is_active,issuer,max_clock_skew_seconds,max_source_age_seconds,policy_key,required_assurance,version
operator_definer|operator.access_session_binding|SELECT|assurance_class,audience,binding_scheme,issuer,mapping_epoch,operator_role_id,session_id,source_expires_at,source_issued_at,subject
operator_definer|operator.operator_audit_id_seq|USAGE|*
operator_definer|operator.operator_audit|INSERT|*
operator_definer|tenant_data.accounts|SELECT|code,tenant_id,title
operator_definer|tenant_data.business|SELECT|id,state,tenant_id
operator_definer|tenant_data.company_profiles|SELECT|branch,currency,id,name,tenant_id
operator_definer|tenant_data.journal_lines|SELECT|account,credit,debit,journal_id,line_no,tenant_id
operator_definer|tenant_data.journals|SELECT|branch,company,id,narrative,posting_date,tenant_id
operator_definer|tenant_data.members|SELECT|active,tenant_id,user_id
operator_definer|tenant_data.support_grants|SELECT|actions_jsonb,expires_at,grant_id,granted_by_user_id,grantee_actor_id,is_active,reason,revoked_at,scope_jsonb,starts_at,tenant_id
tenant_admission_definer|auth.tenant_membership|SELECT|revoked_at,status,suspended_at,tenant_id,user_id
tenant_admission_definer|auth.users|SELECT|id,status
tenant_admission_definer|tenant_data.members|SELECT|active,tenant_id,user_uuid
void_definer|tenant_data.approval_policy|SELECT|action_type,approval_threshold_amount,currency,effective_from,effective_to,is_active,policy_key,requires_different_approver,role_id,tenant_id,version
void_definer|tenant_data.approval_requests|SELECT|command_id,decided_by,payload_digest,policy_snapshot,state,tenant_id
void_definer|tenant_data.assignments|SELECT|role_id,tenant_id,user_id
void_definer|tenant_data.audit_event|INSERT|actor_id,detail_jsonb,entity_id,entity_type,event,origin_type,origin_user_id,request_id,tenant_id
void_definer|tenant_data.audit|INSERT|actor,command_id,detail,event,happened_at,tenant_id
void_definer|tenant_data.audit|SELECT|command_id,event,tenant_id
void_definer|tenant_data.command_decisions|SELECT|command_id,tenant_id
void_definer|tenant_data.command_inbox|INSERT|actor,approved_by,created_at,digest,id,payload,state,tenant_id,updated_at
void_definer|tenant_data.command_inbox|SELECT|actor,approved_by,digest,id,payload,state,tenant_id,updated_at
void_definer|tenant_data.command_inbox|UPDATE|approved_by,state,updated_at
void_definer|tenant_data.company_profiles|SELECT|currency,id,tenant_id
void_definer|tenant_data.denials|SELECT|action,tenant_id,user_id
void_definer|tenant_data.entry_voids|INSERT|actor,actor_uuid,approval_command_id,approval_digest,approval_version,approver_actor,correlation_id,created_at,effective_state,entry_id,idempotency_key,original_state,period_locked,policy_decision,policy_digest,policy_version,reason,request_digest,source_debit,source_digest,source_line_count,source_version,tenant_id,updated_at,void_command_id,voided_at
void_definer|tenant_data.entry_voids|SELECT|entry_id,idempotency_key,request_digest,tenant_id,void_command_id
void_definer|tenant_data.journal_corrections|SELECT|command_id,original_id,tenant_id
void_definer|tenant_data.journal_lines|SELECT|account,credit,debit,journal_id,line_no,tenant_id
void_definer|tenant_data.journals|SELECT|branch,company,id,posting_date,tenant_id
void_definer|tenant_data.members|SELECT|active,tenant_id,user_id,user_uuid
void_definer|tenant_data.outbox|INSERT|attempts,event,id,state,tenant_id
void_definer|tenant_data.outbox|SELECT|id,tenant_id
void_definer|tenant_data.periods|SELECT|company,end_date,locked,start_date,tenant_id
void_definer|tenant_data.roles|SELECT|id,permissions,protected,tenant_id
void_definer|tenant_data.stock_operations|SELECT|command_id,tenant_id
void_definer|tenant_data.trade_credits|SELECT|original_id,tenant_id
void_definer|tenant_data.trade_operations|SELECT|command_id,tenant_id
$owner_manifest$, E'\n') line
  WHERE line <> ''
),
owner_allowed_owned_functions(actor_class, signature) AS (
  VALUES
    ('audit_definer', 'tenant_data.immutability_041_audit_native_guard()'),
    ('audit_definer', 'tenant_data.immutability_041_audit_origin(uuid,text,jsonb,text)'),
    ('audit_definer', 'tenant_data.immutability_041_audit_row()'),
    ('audit_definer', 'tenant_data.immutability_041_expected_fingerprint(regclass)'),
    ('audit_definer', 'tenant_data.immutability_041_resolve_type(oid,integer)'),
    ('audit_definer', 'tenant_data.immutability_041_row_key(regclass,jsonb)'),
    ('audit_definer', 'tenant_data.immutability_041_schema_fingerprint(regclass)'),
    ('audit_definer', 'tenant_data.immutability_041_serialize(regclass,jsonb)'),
    ('audit_definer', 'tenant_data.immutability_041_type_supported(oid)'),
    ('operator_definer', 'operator.assert_read_authority_protocol()'),
    ('operator_definer', 'operator.log_operator_read_denial(uuid,text,text,text,text,text,text,text)'),
    ('operator_definer', 'operator.read_tenant_support(uuid,text,text,text,text,text,text,integer)'),
    ('tenant_admission_definer', 'tenant_data.session_admitted(uuid,uuid)'),
    ('void_definer', 'tenant_data.void_posted_entry(uuid,text,text,text,text,text,text)')
),
owner_schema_contract(actor_class, nspname, privilege) AS (
  VALUES
    ('operator_definer', 'operator', 'USAGE'),
    ('operator_definer', 'auth', 'USAGE'),
    ('operator_definer', 'tenant_data', 'USAGE'),
    ('auth_definer', 'auth', 'USAGE'),
    ('tenant_admission_definer', 'auth', 'USAGE'),
    ('tenant_admission_definer', 'tenant_data', 'USAGE'),
    ('audit_definer', 'tenant_data', 'USAGE'),
    ('void_definer', 'tenant_data', 'USAGE')
),
owner_actual_privileges AS (
  SELECT o.actor_class, o.rolname,
         ra.nspname || '.' || ra.relname AS relation_name,
         ra.privilege, '*' AS columns
  FROM owner_roles o
  JOIN relation_acls ra ON ra.grantee = o.oid
  UNION ALL
  SELECT o.actor_class, o.rolname, cr.nspname || '.' || cr.relname, ca.privilege,
         string_agg(ca.attname, ',' ORDER BY ca.attname)
  FROM owner_roles o
  JOIN column_acls ca ON ca.grantee = o.oid
  JOIN covered_relations cr ON cr.oid = ca.rel_oid
  GROUP BY o.actor_class, o.rolname, cr.nspname, cr.relname, ca.privilege
),
owner_actual_schema_privileges AS (
  SELECT o.actor_class, o.rolname, sa.nspname, sa.privilege
  FROM owner_roles o
  JOIN schema_acls sa ON sa.grantee = o.oid
),
owner_relation_grants AS (
  SELECT o.actor_class, o.rolname, ra.nspname, ra.relname, ra.relkind, ra.privilege
  FROM owner_roles o
  JOIN relation_acls ra ON ra.grantee = o.oid
  UNION ALL
  SELECT o.actor_class, o.rolname, cr.nspname, cr.relname, cr.relkind, ca.privilege
  FROM owner_roles o
  JOIN column_acls ca ON ca.grantee = o.oid
  JOIN covered_relations cr ON cr.oid = ca.rel_oid
),
actor_function_grants AS (
  SELECT a.actor_kind, a.actor_class, a.actor_name, f.oid, f.nspname, f.signature,
         f.proowner, true AS is_direct
  FROM actors a
  JOIN function_acls fa ON fa.grantee = a.actor_oid
  JOIN covered_functions f ON f.oid = fa.function_oid
  UNION ALL
  SELECT a.actor_kind, a.actor_class, a.actor_name, f.oid, f.nspname, f.signature,
         f.proowner, false AS is_direct
  FROM actors a
  JOIN function_acls fa
    ON EXISTS (SELECT 1 FROM role_closure rc WHERE rc.member = a.actor_oid AND rc.granted = fa.grantee)
  JOIN covered_functions f ON f.oid = fa.function_oid
),
owner_function_grants AS (
  SELECT o.actor_class, o.rolname, f.oid, f.nspname, f.signature, f.proowner
  FROM owner_roles o
  JOIN function_acls fa ON fa.grantee = o.oid
  JOIN covered_functions f ON f.oid = fa.function_oid
),
-- ---------------------------------------------------------------------------
-- 8. Violations
-- ---------------------------------------------------------------------------
violations (kind, object, detail) AS (
  -- ---- 8.1 Reviewed installed surface -------------------------------------
  SELECT 'MISSING_REQUIRED_SCHEMA', n.nspname,
         'required application schema is not installed'
  FROM unnest(ARRAY['tenant_data', 'auth', 'operator']) n(nspname)
  WHERE NOT EXISTS (SELECT 1 FROM pg_namespace p WHERE p.nspname = n.nspname)
  UNION ALL
  SELECT 'MISSING_REQUIRED_ROLE', r.expected_name,
         'required ' || r.role_kind || ' role class is not installed'
  FROM required_roles r WHERE r.oid IS NULL
  UNION ALL
  SELECT 'REQUIRED_ROLE_ATTRIBUTE', r.rolname,
         'required role must be NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE'
  FROM required_roles r
  WHERE r.oid IS NOT NULL
    AND (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolbypassrls
         OR r.rolcreatedb OR r.rolcreaterole)
  UNION ALL
  SELECT 'MISSING_REQUIRED_RELATION', rr.object_name,
         'required ' || rr.object_type || ' is not installed'
  FROM required_relations rr
  WHERE to_regclass(rr.object_name) IS NULL
  UNION ALL
  SELECT 'REQUIRED_OBJECT_KIND_MISMATCH', rr.object_name,
         'required ' || rr.object_type || ' name is occupied by relkind ' || c.relkind::text
  FROM required_relations rr
  JOIN pg_class c ON c.oid = to_regclass(rr.object_name)
  WHERE (rr.object_type = 'table' AND c.relkind::text NOT IN ('r', 'p'))
     OR (rr.object_type = 'view' AND c.relkind::text <> 'v')
  UNION ALL
  SELECT 'MISSING_REQUIRED_SEQUENCE', rs.object_name,
         'required sequence is not installed'
  FROM required_sequences rs
  WHERE to_regclass(rs.object_name) IS NULL
  UNION ALL
  SELECT 'REQUIRED_OBJECT_KIND_MISMATCH', rs.object_name,
         'required sequence name is occupied by relkind ' || c.relkind::text
  FROM required_sequences rs
  JOIN pg_class c ON c.oid = to_regclass(rs.object_name)
  WHERE c.relkind <> 'S'
  UNION ALL
  SELECT 'MISSING_REQUIRED_FUNCTION', rf.object_name,
         'required function signature is not installed'
  FROM required_functions rf
  WHERE to_regprocedure(rf.object_name) IS NULL
  UNION ALL
  SELECT 'REQUIRED_OBJECT_KIND_MISMATCH', rf.object_name,
         'required function name is occupied by a non-function object'
  FROM required_functions rf
  JOIN pg_proc p ON p.oid = to_regprocedure(rf.object_name)
  WHERE p.prokind <> 'f'
  UNION ALL
  SELECT 'INSTALLATION_BINDING_MISMATCH', b.name,
         'installed source checksum differs from the reviewed immutable installation binding'
  FROM required_installation_bindings b
  JOIN pg_proc p ON p.oid = to_regprocedure(b.name)
  WHERE md5(replace(p.prosrc, (SELECT prefix FROM effective_prefixes LIMIT 1), '')) <> b.expected_md5
  UNION ALL
  SELECT 'MISSING_REQUIRED_TRIGGER', rt.schema_name || '.' || rt.table_name || '.' || rt.trigger_name,
         'required protection is missing, disabled, replica-only, conditional or misbound'
  FROM required_triggers rt
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = rt.schema_name AND c.relname = rt.table_name AND t.tgname = rt.trigger_name
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = rt.expected_type
      AND pn.nspname = rt.function_schema AND p.proname = rt.function_name
      AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgattr = ''::int2vector
      AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgconstraint = 0
  )
  UNION ALL
  SELECT 'MISSING_REQUIRED_COLUMN', 'operator.access_read_policy.' || col,
         'versioned operator read policy is missing a required column'
  FROM unnest(ARRAY['policy_key','version','issuer','audience','required_assurance',
                    'max_source_age_seconds','max_clock_skew_seconds','is_active','effective_from']) col
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'operator' AND c.relname = 'access_read_policy'
      AND a.attname = col AND a.attnum > 0 AND NOT a.attisdropped
  )
  UNION ALL
  SELECT 'MISSING_REQUIRED_CONSTRAINT', 'operator.access_read_policy.required_assurance=access_mfa',
         'the mandatory access_mfa assurance constraint is missing'
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'operator' AND c.relname = 'access_read_policy'
      AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%access_mfa%'
  )
  UNION ALL
  SELECT 'AUTHORITY_HELPER_INVALID', h.function_name,
         'authority gate helper does not match the reviewed migrator trigger-function profile'
  FROM (VALUES
    ('auth.lock_authority_gate', 'saven.auth.authority_gate'),
    ('operator.lock_consent_gate', 'saven.operator.consent_gate'),
    ('operator.lock_policy_gate', 'saven.operator.policy_gate')
  ) h(function_name, gate_key)
  WHERE NOT EXISTS (
    SELECT 1 FROM covered_functions f
    JOIN pg_language l ON l.oid = f.prolang
    JOIN required_roles owner ON owner.oid = f.proowner AND owner.class = 'migrator'
    WHERE f.nspname || '.' || f.proname = h.function_name
      AND f.prorettype = 'trigger'::regtype AND f.pronargs = 0
      AND NOT f.prosecdef AND f.proconfig = ARRAY['search_path=pg_catalog']
      AND l.lanname = 'plpgsql'
      AND f.prosrc LIKE '%pg_advisory_xact_lock(%'
      AND f.prosrc NOT LIKE '%pg_advisory_xact_lock_shared(%'
      AND f.prosrc LIKE '%' || h.gate_key || '%'
  )
  UNION ALL
  SELECT 'PROTOCOL_VALIDATOR_INVALID', 'operator.assert_read_authority_protocol()',
         'the accepted installed-protocol validator is missing its reviewed profile or markers'
  WHERE NOT EXISTS (
    SELECT 1 FROM covered_functions f
    WHERE f.nspname = 'operator' AND f.proname = 'assert_read_authority_protocol'
      AND f.prosecdef
      AND f.proconfig @> ARRAY['search_path=pg_catalog, operator, tenant_data']
      AND f.prosrc LIKE '%OPERATOR_AUTHORITY_PROTOCOL_INVALID%'
      AND f.prosrc LIKE '%required protection%'
  )

  -- ---- 8.2 Tenant table and membership isolation --------------------------
  UNION ALL
  SELECT 'MISSING_ENABLE_RLS', 'tenant_data.' || relname,
         'tenant table does not ENABLE ROW LEVEL SECURITY'
  FROM tenant_tables WHERE NOT relrowsecurity
  UNION ALL
  SELECT 'MISSING_FORCE_RLS', 'tenant_data.' || relname,
         'tenant table does not FORCE ROW LEVEL SECURITY'
  FROM tenant_tables WHERE relrowsecurity AND NOT relforcerowsecurity
  UNION ALL
  SELECT 'MISSING_POLICY', 'tenant_data.' || relname,
         'tenant table has no row-level security policy'
  FROM tenant_tables t
  WHERE NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid)
  UNION ALL
  SELECT CASE WHEN g.policy_suffix = '_runtime_admission' THEN 'RUNTIME_ADMISSION_GAP' ELSE 'POLICY_OPERATION_GAP' END,
         'tenant_data.' || g.relname || ':' || g.cmd || ':' ||
         CASE WHEN g.is_permissive THEN 'permissive' ELSE 'restrictive' END,
         'no exact reviewed policy covers this command with the accepted command, role and USING/WITH CHECK contract'
  FROM tenant_policy_gaps g
  UNION ALL
  SELECT 'POLICY_EXPRESSION_MISMATCH', 'tenant_data.' || st.relname || '.' || st.relname || st.policy_suffix,
         'reviewed policy name exists but command, role, USING or WITH CHECK differs from the accepted contract'
  FROM tenant_policy_status st
  WHERE st.policy_exists AND NOT st.policy_matches
  UNION ALL
  SELECT 'UNEXPECTED_POLICY', 'tenant_data.' || up.relname || '.' || up.polname,
         'policy is not part of the reviewed tenant isolation contract'
  FROM tenant_unexpected_policies up
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_MISSING_ENABLE_RLS', 'auth.' || relname,
         'tenant-scoped membership table does not ENABLE ROW LEVEL SECURITY'
  FROM tenant_scoped_auth WHERE NOT relrowsecurity
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_MISSING_FORCE_RLS', 'auth.' || relname,
         'tenant-scoped membership table does not FORCE ROW LEVEL SECURITY'
  FROM tenant_scoped_auth WHERE relrowsecurity AND NOT relforcerowsecurity
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_POLICY_GAP', 'auth.' || st.relname || ':' || st.policy_name,
         'missing reviewed membership policy from the accepted principal-bound contract'
  FROM membership_policy_status st
  WHERE NOT st.policy_matches
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_POLICY_INVALID', 'auth.' || st.relname || '.' || st.policy_name,
         'membership policy name exists but command, role, USING or WITH CHECK differs from the accepted contract'
  FROM membership_policy_status st
  WHERE st.policy_exists AND NOT st.policy_matches
  UNION ALL
  SELECT 'UNEXPECTED_POLICY', 'auth.' || up.relname || '.' || up.polname,
         'policy is not part of the reviewed membership preselection contract'
  FROM membership_unexpected_policies up
  UNION ALL
  SELECT 'AUTH_MEMBERSHIP_UNAUTHORIZED_WRITE_POLICY', 'auth.' || up.relname || '.' || up.polname,
         'membership writes must fail closed; an unexpected permissive write policy is present'
  FROM membership_unexpected_policies up
  WHERE up.polpermissive AND up.polcmd IN ('a', 'w', 'd', '*')
  -- ---- 8.3 Transitive views, materialized views and children -------------
  UNION ALL
  SELECT 'UNSAFE_VIEW_OWNER', cr.nspname || '.' || cr.relname,
         'runtime-readable view over tenant data is owned by a SUPERUSER or BYPASSRLS principal'
  FROM reachable_relation_details cr
  JOIN pg_roles owner ON owner.oid = cr.relowner
  WHERE cr.kind = 'view'
    AND (owner.rolsuper OR owner.rolbypassrls)
    AND cr.oid IN (SELECT rel_oid FROM runtime_read_endpoints)
  UNION ALL
  SELECT 'UNSAFE_MATERIALIZED_VIEW', cr.nspname || '.' || cr.relname,
         'materialized view reachable from tenant data stores rows that cannot follow row-level security'
  FROM reachable_relation_details cr
  WHERE cr.kind = 'matview'
  UNION ALL
  SELECT 'UNSAFE_VIEW_PATH', cr.nspname || '.' || cr.relname,
         'a tainted view on the path to a runtime-readable endpoint can publish rows outside row-level security'
  FROM reachable_objects ro
  JOIN reachable_relation_details cr ON cr.oid = ro.oid
  WHERE ro.kind IN ('view', 'matview') AND ro.tainted
    AND ro.oid IN (SELECT oid FROM endpoint_ancestors)
  UNION ALL
  SELECT 'UNSAFE_PARTITION_PATH', cr.nspname || '.' || cr.relname,
         'runtime-reachable child of tenant data lacks its own forced RLS and policy'
  FROM reachable_relation_details cr
  WHERE cr.kind = 'child'
    AND cr.oid IN (SELECT rel_oid FROM runtime_read_endpoints)
    AND (NOT cr.relrowsecurity OR NOT cr.relforcerowsecurity
         OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = cr.oid AND p.polpermissive))
  UNION ALL
  SELECT 'UNSAFE_PARTITION_WRITE_PATH', g.object_name || ':' || g.cmd,
         'runtime can write a cross-schema child whose forced RLS or command-specific USING/WITH CHECK is missing'
  FROM child_write_gaps g

  -- ---- 8.4 Definer authority and accepted EXECUTE surface ----------------
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_OWNER', f.nspname || '.' || f.proname,
         'SECURITY DEFINER owner ' || f.owner_name || ' is SUPERUSER or has BYPASSRLS'
  FROM definer_functions f WHERE f.rolsuper OR f.rolbypassrls
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_OWNER_LOGIN', f.nspname || '.' || f.proname,
         'SECURITY DEFINER owner ' || f.owner_name || ' can log in; use a NOLOGIN definer role'
  FROM definer_functions f WHERE f.rolcanlogin
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_SEARCH_PATH', f.nspname || '.' || f.proname,
         'SECURITY DEFINER function lacks a fixed pg_catalog-first search_path without public/$user/pg_temp'
  FROM definer_functions f WHERE f.unsafe_search_path
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_PUBLIC_EXECUTE', f.nspname || '.' || f.proname,
         'PUBLIC can execute a SECURITY DEFINER function (including a NULL/default ACL)'
  FROM definer_functions f WHERE f.public_execute
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_RUNTIME_ASSUMPTION', f.nspname || '.' || f.proname,
         'a runtime role is the owner or can SET ROLE to the SECURITY DEFINER owner'
  FROM definer_functions f WHERE f.runtime_can_assume_owner
  UNION ALL
  SELECT 'UNSAFE_FUNCTION_ROW_SECURITY', f.nspname || '.' || f.proname,
         'SECURITY DEFINER function disables row_security'
  FROM definer_functions f WHERE f.row_security_off
  UNION ALL
  SELECT 'FORBIDDEN_RUNTIME_EXECUTE', g.actor_name || ' -> ' || g.signature,
         'runtime class holds an EXECUTE grant outside the accepted PIVOT-007/tenant allow-list'
  FROM actor_function_grants g
  WHERE g.actor_kind = 'runtime'
    AND NOT EXISTS (SELECT 1 FROM allowed_execute ae
                    WHERE ae.actor_class = g.actor_class AND ae.signature = g.signature)
  UNION ALL
  SELECT 'FORBIDDEN_LOGIN_EXECUTE', g.actor_name || ' -> ' || g.signature,
         'a runtime login holds a direct EXECUTE grant; authority must stay behind SET ROLE'
  FROM actor_function_grants g WHERE g.actor_kind = 'login' AND g.is_direct
  UNION ALL
  SELECT 'MISSING_REQUIRED_EXECUTE', ae.actor_class || ' -> ' || ae.signature,
         'accepted runtime EXECUTE grant is missing'
  FROM allowed_execute ae
  JOIN required_roles rr ON rr.class = ae.actor_class AND rr.oid IS NOT NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM actor_function_grants g
    WHERE g.actor_kind = 'runtime' AND g.actor_class = ae.actor_class AND g.signature = ae.signature
  )
  UNION ALL
  SELECT 'DEFINER_OWNER_EXCESS_AUTHORITY', og.rolname || ' -> ' || og.signature,
         'definer owner holds an EXECUTE grant on a function it does not own and the manifest does not allow'
  FROM owner_function_grants og
  JOIN owner_roles o ON o.rolname = og.rolname
  WHERE o.actor_class <> 'migrator'
    AND og.proowner <> (SELECT oid FROM owner_roles WHERE actor_class = o.actor_class LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM owner_allowed_execute a
                    WHERE a.actor_class = o.actor_class AND a.signature = og.signature)

  -- ---- 8.5 Effective privilege boundary -----------------------------------
  UNION ALL
  SELECT 'CUSTOMER_CROSS_SCHEMA_PRIVILEGE', p.nspname || '.' || p.relname || ':' || p.privilege,
         p.actor_name || ' (customer_app) holds ' || p.privilege || ' on ' || p.nspname || ' (table/sequence)'
  FROM effective_relation_privileges p
  WHERE p.actor_class = 'customer_app' AND p.nspname IN ('auth', 'operator')
  UNION ALL
  SELECT 'CUSTOMER_CROSS_SCHEMA_PRIVILEGE', p.nspname || '.' || p.relname || '.' || p.attname || ':' || p.privilege,
         p.actor_name || ' (customer_app) holds column ' || p.privilege || ' on ' || p.nspname
  FROM effective_column_privileges p
  WHERE p.actor_class = 'customer_app' AND p.nspname IN ('auth', 'operator')
  UNION ALL
  SELECT 'AUTH_SERVICE_TENANT_PRIVILEGE', p.nspname || '.' || p.relname || ':' || p.privilege,
         p.actor_name || ' (auth_service) holds ' || p.privilege || ' on tenant_data'
  FROM effective_relation_privileges p
  WHERE p.actor_class = 'auth_service' AND p.nspname = 'tenant_data'
  UNION ALL
  SELECT 'AUTH_SERVICE_TENANT_PRIVILEGE', p.nspname || '.' || p.relname || '.' || p.attname || ':' || p.privilege,
         p.actor_name || ' (auth_service) holds column ' || p.privilege || ' on tenant_data'
  FROM effective_column_privileges p
  WHERE p.actor_class = 'auth_service' AND p.nspname = 'tenant_data'
  UNION ALL
  SELECT 'OPERATOR_TENANT_PRIVILEGE', p.nspname || '.' || p.relname || ':' || p.privilege,
         p.actor_name || ' (' || p.actor_class || ') holds ' || p.privilege || ' on tenant_data'
  FROM effective_relation_privileges p
  WHERE p.actor_class IN ('operator_read', 'operator_admin') AND p.nspname = 'tenant_data'
  UNION ALL
  SELECT 'OPERATOR_TENANT_PRIVILEGE', p.nspname || '.' || p.relname || '.' || p.attname || ':' || p.privilege,
         p.actor_name || ' (' || p.actor_class || ') holds column ' || p.privilege || ' on tenant_data'
  FROM effective_column_privileges p
  WHERE p.actor_class IN ('operator_read', 'operator_admin') AND p.nspname = 'tenant_data'
  UNION ALL
  SELECT 'OPERATOR_AUTH_PRIVILEGE', p.nspname || '.' || p.relname || ':' || p.privilege,
         p.actor_name || ' (' || p.actor_class || ') holds ' || p.privilege || ' on auth records'
  FROM effective_relation_privileges p
  WHERE p.actor_class IN ('operator_read', 'operator_admin') AND p.nspname = 'auth'
  UNION ALL
  SELECT 'OPERATOR_AUTH_PRIVILEGE', p.nspname || '.' || p.relname || '.' || p.attname || ':' || p.privilege,
         p.actor_name || ' (' || p.actor_class || ') holds column ' || p.privilege || ' on auth records'
  FROM effective_column_privileges p
  WHERE p.actor_class IN ('operator_read', 'operator_admin') AND p.nspname = 'auth'
  UNION ALL
  SELECT 'FORBIDDEN_RUNTIME_PRIVILEGE', p.nspname || '.' || p.relname || ':' || p.privilege,
         p.actor_name || ' holds ' || p.privilege || ' on a tenant relation'
  FROM effective_relation_privileges p
  WHERE p.actor_class = 'customer_app' AND p.nspname = 'tenant_data'
    AND p.privilege IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  UNION ALL
  SELECT 'LOGIN_DIRECT_COVERED_PRIVILEGE', p.rolname || ' -> ' || p.nspname || '.' || p.relname || ':' || p.privilege,
         'runtime login holds a direct covered relation privilege instead of using its target role'
  FROM direct_login_relation_privileges p
  UNION ALL
  SELECT 'LOGIN_DIRECT_COVERED_PRIVILEGE', p.rolname || ' -> ' || p.nspname || '.' || p.relname || '.' || p.attname || ':' || p.privilege,
         'runtime login holds a direct covered column privilege'
  FROM direct_login_column_privileges p
  UNION ALL
  SELECT 'LOGIN_DIRECT_COVERED_PRIVILEGE', p.rolname || ' -> ' || p.signature,
         'runtime login holds a direct covered function privilege'
  FROM direct_login_function_privileges p

  -- ---- 8.6 Ownership, bypass, role switching and unknown principals -------
  UNION ALL
  SELECT 'SAVEN_BYPASS_OR_SUPER', 'role ' || r.rolname,
         'SAVEN principal holds SUPERUSER or BYPASSRLS'
  FROM required_roles r WHERE r.oid IS NOT NULL AND (r.rolsuper OR r.rolbypassrls)
  UNION ALL
  SELECT 'RUNTIME_DDL_ATTRIBUTE', r.rolname,
         'runtime role holds CREATEDB or CREATEROLE'
  FROM required_roles r
  WHERE r.role_kind = 'runtime' AND r.oid IS NOT NULL AND (r.rolcreatedb OR r.rolcreaterole)
  UNION ALL
  SELECT 'RUNTIME_SCHEMA_CREATE', asp.actor_name || ' -> ' || asp.nspname,
         'runtime principal holds CREATE on a covered schema'
  FROM actor_schema_privileges asp
  WHERE asp.privilege = 'CREATE'
  UNION ALL
  SELECT 'RUNTIME_SCHEMA_PRIVILEGE', asp.actor_name || ' -> ' || asp.nspname || ':' || asp.privilege,
         'runtime principal holds a covered-schema privilege outside its accepted profile'
  FROM actor_schema_privileges asp
  WHERE NOT EXISTS (
    SELECT 1 FROM schema_privilege_contract sc
    WHERE sc.actor_class = asp.actor_class AND sc.nspname = asp.nspname AND sc.privilege = asp.privilege
  )
  UNION ALL
  SELECT 'LOGIN_DIRECT_SCHEMA_PRIVILEGE', dsp.rolname || ' -> ' || dsp.nspname || ':' || dsp.privilege,
         'runtime login holds a direct covered-schema privilege instead of using its target role'
  FROM direct_login_schema_privileges dsp
  UNION ALL
  SELECT 'PUBLIC_SCHEMA_PRIVILEGE', sa.nspname || ':' || sa.privilege,
         'PUBLIC holds a covered-schema privilege'
  FROM schema_acls sa
  WHERE sa.grantee = 0
  UNION ALL
  SELECT 'SCHEMA_OWNERSHIP_MISMATCH', n.nspname,
         'covered schema is not owned by the reviewed migrator role'
  FROM pg_namespace n
  WHERE n.nspname IN ('tenant_data', 'auth', 'operator')
    AND NOT EXISTS (
      SELECT 1 FROM required_roles rr
      WHERE rr.oid = n.nspowner AND rr.class = 'migrator'
    )
  UNION ALL
  SELECT 'ROLE_SWITCH_TO_PRIVILEGED_CAPABILITY', a.actor_name || ' -> ' || pcr.rolname,
         'runtime principal can assume a role with dangerous attributes or covered authority'
  FROM actors a
  JOIN role_closure rc ON rc.member = a.actor_oid
  JOIN privileged_capability_roles pcr ON pcr.oid = rc.granted
  UNION ALL
  SELECT 'RUNTIME_OWNS_OBJECT', cr.nspname || '.' || cr.relname,
         'runtime role owns a covered relation'
  FROM runtime_roles rr JOIN covered_relations cr ON cr.relowner = rr.oid
  UNION ALL
  SELECT 'RUNTIME_OWNS_FUNCTION', f.nspname || '.' || f.proname,
         'runtime role owns a covered function'
  FROM runtime_roles rr JOIN covered_functions f ON f.proowner = rr.oid
  UNION ALL
  SELECT 'BYPASS_OWNER', cr.nspname || '.' || cr.relname,
         'covered relation is owned by a SUPERUSER or BYPASSRLS principal'
  FROM covered_relations cr JOIN pg_roles owner ON owner.oid = cr.relowner
  WHERE owner.rolsuper OR owner.rolbypassrls
  UNION ALL
  SELECT 'RUNTIME_ASSUMES_PRIVILEGED_ROLE', a.actor_name || ' -> ' || o.rolname,
         'runtime principal can assume a migrator or definer role through membership'
  FROM actors a
  JOIN role_closure rc ON rc.member = a.actor_oid
  JOIN owner_roles o ON o.oid = rc.granted
  UNION ALL
  SELECT 'CROSS_CLASS_ROLE_SWITCH', a.actor_name || ' -> ' || rr.rolname,
         'runtime principal can assume another runtime class'
  FROM actors a
  JOIN role_closure rc ON rc.member = a.actor_oid
  JOIN runtime_roles rr ON rr.oid = rc.granted AND rr.actor_class <> a.actor_class
  UNION ALL
  SELECT 'LOGIN_MULTI_CLASS_MEMBERSHIP', rl.rolname,
         'runtime login belongs to more than one runtime class'
  FROM runtime_logins rl WHERE rl.runtime_classes > 1
  UNION ALL
  SELECT 'LOGIN_CROSS_AUTHORITY', rl.rolname,
         'runtime login also belongs to a migrator or definer role'
  FROM runtime_logins rl WHERE rl.owner_classes > 0
  UNION ALL
  SELECT 'LOGIN_ROLE_ATTRIBUTE', rl.rolname,
         'runtime login holds SUPERUSER, BYPASSRLS, CREATEDB or CREATEROLE'
  FROM runtime_logins rl
  WHERE rl.rolsuper OR rl.rolbypassrls OR rl.rolcreatedb OR rl.rolcreaterole
  UNION ALL
  SELECT 'OWNER_ROLE_MEMBERSHIP', o.rolname || ' ' || m.member::regrole::text || ' -> ' || m.roleid::regrole::text,
         'definer owner has a direct role membership; the accepted definers have none'
  FROM owner_roles o
  JOIN pg_auth_members m ON (m.member = o.oid OR m.roleid = o.oid)
  WHERE o.actor_class <> 'migrator'
  UNION ALL
  SELECT 'OWNER_ROLE_MEMBERSHIP', 'saven_migrator -> ' || m.roleid::regrole::text,
         'saven_migrator must not be a member of another role'
  FROM owner_roles o JOIN pg_auth_members m ON m.member = o.oid
  WHERE o.actor_class = 'migrator'
  UNION ALL
  SELECT 'OWNER_ROLE_MEMBERSHIP', 'saven_migrator <- ' || m.member::regrole::text,
         'only an offline login principal may hold saven_migrator'
  FROM owner_roles o
  JOIN pg_auth_members m ON m.roleid = o.oid
  JOIN pg_roles member ON member.oid = m.member
  WHERE o.actor_class = 'migrator'
    AND (NOT member.rolcanlogin OR member.rolsuper
         OR EXISTS (SELECT 1 FROM runtime_roles rr WHERE rr.oid = member.oid))
  UNION ALL
  SELECT 'UNKNOWN_PRIVILEGED_PRINCIPAL', r.rolname,
         'non-registered principal owns covered objects, holds covered ACLs or can assume a privileged role'
  FROM pg_roles r
  WHERE NOT r.rolsuper
    AND r.rolname !~ '^pg_'
    AND NOT EXISTS (SELECT 1 FROM required_roles rr WHERE rr.oid = r.oid)
    AND NOT EXISTS (SELECT 1 FROM runtime_logins rl WHERE rl.oid = r.oid)
    AND NOT EXISTS (SELECT 1 FROM offline_logins ol WHERE ol.oid = r.oid)
    AND (
      EXISTS (SELECT 1 FROM relation_acls ra WHERE ra.grantee = r.oid)
      OR EXISTS (SELECT 1 FROM column_acls ca WHERE ca.grantee = r.oid)
      OR EXISTS (SELECT 1 FROM function_acls fa WHERE fa.grantee = r.oid)
      OR EXISTS (SELECT 1 FROM covered_relations cr WHERE cr.relowner = r.oid)
      OR EXISTS (SELECT 1 FROM covered_functions f WHERE f.proowner = r.oid)
      OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN owner_roles o ON o.oid = m.roleid WHERE m.member = r.oid)
    )
  UNION ALL
  SELECT 'DEFINER_OWNER_EXCESS_AUTHORITY', a.rolname || ' -> ' || a.relation_name || ':' || a.privilege,
         'definer owner holds a privilege, operation or column set outside its exact reviewed profile'
  FROM owner_actual_privileges a
  WHERE a.actor_class <> 'migrator'
    AND NOT EXISTS (
      SELECT 1 FROM owner_privilege_contract c
      WHERE c.actor_class = a.actor_class AND c.relation_name = a.relation_name
        AND c.privilege = a.privilege AND c.columns = a.columns
    )
  UNION ALL
  SELECT 'DEFINER_OWNER_PRIVILEGE_MISSING', c.actor_class || ' -> ' || c.relation_name || ':' || c.privilege,
         'reviewed definer owner privilege or column set is missing'
  FROM owner_privilege_contract c
  WHERE NOT EXISTS (
    SELECT 1 FROM owner_actual_privileges a
    WHERE a.actor_class = c.actor_class AND a.relation_name = c.relation_name
      AND a.privilege = c.privilege AND a.columns = c.columns
  )
  UNION ALL
  SELECT 'DEFINER_OWNER_SCHEMA_PRIVILEGE', a.rolname || ' -> ' || a.nspname || ':' || a.privilege,
         'definer owner holds a schema privilege outside its exact reviewed profile'
  FROM owner_actual_schema_privileges a
  WHERE a.actor_class <> 'migrator'
    AND NOT EXISTS (
      SELECT 1 FROM owner_schema_contract c
      WHERE c.actor_class = a.actor_class AND c.nspname = a.nspname AND c.privilege = a.privilege
    )
  UNION ALL
  SELECT 'DEFINER_OWNER_SCHEMA_PRIVILEGE', c.actor_class || ' -> ' || c.nspname || ':' || c.privilege,
         'reviewed definer owner schema privilege is missing'
  FROM owner_schema_contract c
  WHERE NOT EXISTS (
    SELECT 1 FROM owner_actual_schema_privileges a
    WHERE a.actor_class = c.actor_class AND a.nspname = c.nspname AND a.privilege = c.privilege
  )
  UNION ALL
  SELECT 'DEFINER_OWNER_EXCESS_AUTHORITY', o.rolname || ' owns ' || f.signature,
         'definer owner owns a function outside its exact reviewed ownership profile'
  FROM owner_roles o
  JOIN covered_functions f ON f.proowner = o.oid
  WHERE o.actor_class <> 'migrator'
    AND NOT EXISTS (
      SELECT 1 FROM owner_allowed_owned_functions af
      WHERE af.actor_class = o.actor_class AND af.signature = f.signature
    )
  -- ---- 8.7 PUBLIC exposure ------------------------------------------------
  UNION ALL
  SELECT 'PUBLIC_RELATION_PRIVILEGE', pa.nspname || '.' || pa.relname || ':' || pa.privilege,
         'PUBLIC holds ' || pa.privilege || ' on a covered relation or sequence'
  FROM public_relation_acls pa
  UNION ALL
  SELECT 'PUBLIC_COLUMN_PRIVILEGE', cr.nspname || '.' || cr.relname || '.' || pc.attname || ':' || pc.privilege,
         'PUBLIC holds ' || pc.privilege || ' on a covered column'
  FROM public_column_acls pc JOIN covered_relations cr ON cr.oid = pc.rel_oid

)
SELECT DISTINCT kind, object, detail
FROM violations
ORDER BY kind, object;
