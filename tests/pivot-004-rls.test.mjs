import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {
  withPivotDatabase,
  namespaceSql,
  connectClusterAdmin,
  roleNamesForSuffix,
} from './helpers/pg-pivot-fixture.mjs';

const repoRoot = new URL('../', import.meta.url);

// Real run order through the accepted prerequisite schemas, corrections and the
// PIVOT-004-R1 administrator-applied correction.
const schemaFiles = [
  'db/postgres/05-auth-schema.sql',
  'db/postgres/migrations/006-auth-schema-corrections.sql',
  'db/postgres/10-operator-schema.sql',
  'db/postgres/20-tenant-schema.sql',
  'db/postgres/migrations/021-tenant-schema-corrections.sql',
  'db/postgres/30-rls-policies.sql',
];
const adminSqlFiles = [
  'db/postgres/migrations/031-rls-corrections.sql',
  'db/postgres/migrations/032-rls-hardening.sql',
];
const rlsCorrectionsPath = 'db/postgres/migrations/031-rls-corrections.sql';
const rlsHardeningPath = 'db/postgres/migrations/032-rls-hardening.sql';
const quoteRole = name => `"${String(name).replaceAll('"', '""')}"`;

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T3 = '33333333-3333-4333-8333-333333333333';

const tenantTables = [
  'account_profiles', 'accounts', 'approval_policy', 'approval_requests', 'assignments',
  'audit', 'audit_event', 'business', 'business_rule', 'command_decisions', 'command_files',
  'command_inbox', 'company_profiles', 'company_settings', 'denials', 'document_numbers',
  'document_registry', 'document_revisions', 'document_sequences', 'inventory_controls',
  'journal_corrections', 'journal_drafts', 'journal_lines', 'journals', 'members', 'outbox',
  'periods', 'posting_constraint', 'reference_values', 'roles', 'source_store_migrations',
  'stock_balances', 'stock_items', 'stock_movements', 'stock_operations', 'support_grants',
  'tax_profile', 'trade_allocations', 'trade_controls', 'trade_credit_lines', 'trade_credits',
  'trade_documents', 'trade_lines', 'trade_operations', 'trade_parties', 'verified_entitlement',
  'warehouses',
];

const appendOnlyTables = [
  'journals', 'journal_lines', 'trade_operations', 'trade_documents', 'trade_lines',
  'trade_allocations', 'trade_credits', 'trade_credit_lines', 'stock_operations',
  'stock_movements', 'command_decisions', 'command_files', 'document_numbers',
  'document_revisions', 'journal_corrections',
];

const companyScopedTables = {
  journals: 'journals_company_fkey',
  periods: 'periods_company_fkey',
  journal_drafts: 'journal_drafts_company_fkey',
  document_registry: 'document_registry_company_fkey',
  trade_controls: 'trade_controls_company_fkey',
  trade_parties: 'trade_parties_company_fkey',
};

function sqlStatements(sql) {
  const withoutComments = sql
    .split('\n')
    .map(line => (line.trim().startsWith('--') ? '' : line))
    .join('\n');
  return withoutComments.split(';').map(statement => statement.trim()).filter(Boolean);
}

function grantMap(sql) {
  const map = new Map();
  for (const statement of sqlStatements(sql)) {
    if (!/^GRANT\b/i.test(statement)) continue;
    const tables = [...statement.matchAll(/tenant_data\.([a-z_]+)/g)].map(match => match[1]);
    for (const table of tables) {
      const privileges = new Set(map.get(table) ?? []);
      if (/\bSELECT\b/.test(statement)) privileges.add('SELECT');
      if (/\bINSERT\b/.test(statement)) privileges.add('INSERT');
      if (/\bUPDATE\b/.test(statement)) privileges.add('UPDATE');
      if (/\bDELETE\b/.test(statement)) privileges.add('DELETE');
      if (/\bTRUNCATE\b/.test(statement)) privileges.add('TRUNCATE');
      map.set(table, privileges);
    }
  }
  return map;
}

async function seedBase(db) {
  await db.adminQuery(`
    INSERT INTO tenant_data.business(tenant_id, id, state) VALUES
      ('${T1}', 'alpha', 'ACTIVE'), ('${T2}', 'beta', 'ACTIVE');
    INSERT INTO tenant_data.company_profiles(tenant_id, id, name, currency, branch, created_at) VALUES
      ('${T1}', 'alpha', 'Alpha', 'PKR', 'main', 0),
      ('${T2}', 'beta', 'Beta', 'PKR', 'main', 0);
    INSERT INTO auth.users(id, legacy_id, email, status) VALUES
      ('${U1}', 'user-1', 'u1@example.test', 'active'),
      ('${U2}', 'user-2', 'u2@example.test', 'active'),
      ('${U3}', 'user-3', 'u3@example.test', 'active');
    INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at) VALUES
      ('${T1}', '${U1}', 'ultimate_owner', 'active', now(), now()),
      ('${T2}', '${U1}', 'ultimate_owner', 'active', now(), now()),
      ('${T2}', '${U2}', 'ultimate_owner', 'active', now(), now());
    INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES
      ('${T1}', 'user-1', '${U1}', true),
      ('${T2}', 'user-1', '${U1}', true),
      ('${T2}', 'user-2', '${U2}', true);
    INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES
      ('${T1}', '1000', 'Cash A'), ('${T1}', '4000', 'Revenue A'), ('${T2}', '1000', 'Cash B');
    INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at) VALUES
      ('${T1}', 'cmd-a', 'user-1', 'digest-a', '{"company":"alpha"}', 'POSTED', 0),
      ('${T2}', 'cmd-b', 'user-2', 'digest-b', '{"company":"beta"}', 'POSTED', 0);
    INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative) VALUES
      ('${T1}', 'cmd-a', 'alpha', 'main', '2026-11-15', 'Alpha'),
      ('${T2}', 'cmd-b', 'beta', 'main', '2026-11-15', 'Beta');
    INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES
      ('${T1}', 'cmd-a', 1, '1000', 100, 0), ('${T1}', 'cmd-a', 2, '4000', 0, 100),
      ('${T2}', 'cmd-b', 1, '1000', 50, 0), ('${T2}', 'cmd-b', 2, '1000', 0, 50);
    INSERT INTO tenant_data.denials(tenant_id, user_id, action) VALUES ('${T1}', 'user-1', 'journal.post');
    INSERT INTO tenant_data.reference_values(tenant_id, domain, value, label)
      VALUES ('${T1}', 'document_status', 'PENDING_APPROVAL', 'Pending approval');
  `);
}

test('PIVOT-004 static contract: forced RLS, atomic grants, membership isolation and exact binding', async () => {
  const sql = await readFile(new URL('db/postgres/30-rls-policies.sql', repoRoot), 'utf8');
  const correction = await readFile(new URL(rlsCorrectionsPath, repoRoot), 'utf8');
  const executable = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  assert.doesNotMatch(executable, /BYPASSRLS|SUPERUSER/i);
  assert.doesNotMatch(executable, /\bPASSWORD\b|postgres(?:ql)?:\/\//i);
  assert.match(sql.trimStart(), /^-- PIVOT-004/);
  assert.match(sql, /\nBEGIN;\n/);
  assert.match(sql.trimEnd(), /COMMIT;$/);
  assert.match(sql, /Run 00-roles\.sql before 30-rls-policies\.sql/);
  assert.match(sql, /Run 20-tenant-schema\.sql before 30-rls-policies\.sql/);
  assert.match(sql, /Run 05-auth-schema\.sql before 30-rls-policies\.sql/);
  assert.match(sql, /Run migrations\/021-tenant-schema-corrections\.sql before 30-rls-policies\.sql/);

  // Canonical principal projection: additive, constrained, exact pair binding.
  assert.match(sql, /ALTER TABLE tenant_data\.members ADD COLUMN user_uuid uuid;/);
  assert.match(sql, /ALTER TABLE tenant_data\.members ALTER COLUMN user_uuid SET NOT NULL;/);
  assert.match(sql, /members_tenant_user_uuid_key UNIQUE \(tenant_id, user_uuid\)/);
  assert.match(sql, /ALTER TABLE auth\.users\s+ADD CONSTRAINT users_id_legacy_key UNIQUE \(id, legacy_id\)/);
  assert.match(
    sql,
    /members_canonical_membership_fkey\s+FOREIGN KEY \(tenant_id, user_uuid\)\s+REFERENCES auth\.tenant_membership \(tenant_id, user_id\)\s+ON UPDATE RESTRICT ON DELETE RESTRICT/,
  );
  assert.match(
    sql,
    /members_canonical_identity_fkey\s+FOREIGN KEY \(user_uuid, user_id\)\s+REFERENCES auth\.users \(id, legacy_id\)\s+ON UPDATE RESTRICT ON DELETE RESTRICT/,
  );

  const listMatch = /tables text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql);
  assert.ok(listMatch, 'the migration must declare the table coverage list');
  const declared = [...listMatch[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
  assert.deepEqual(declared.sort(), [...tenantTables].sort());

  assert.match(sql, /AS PERMISSIVE FOR ALL TO PUBLIC/);
  assert.match(sql, /AS RESTRICTIVE FOR ALL TO PUBLIC/);
  assert.match(sql, /AS RESTRICTIVE FOR ALL TO %I/);
  assert.match(sql, /'saven_customer_app'\);/);
  assert.match(sql, /tenant_data\.session_admitted\(tenant_data\.current_tenant_id\(\), tenant_data\.current_user_id\(\)\)/);
  assert.match(sql, /LANGUAGE sql STABLE SECURITY DEFINER\s+SET search_path = pg_catalog, auth, tenant_data/);
  assert.match(sql, /REVOKE ALL ON FUNCTION tenant_data\.session_admitted\(uuid, uuid\) FROM PUBLIC/);

  const grants = grantMap(sql);
  for (const table of tenantTables) {
    const privileges = grants.get(table) ?? new Set();
    assert.ok(privileges.size > 0, `saven_customer_app must be granted something on ${table}`);
    assert.equal(privileges.has('TRUNCATE'), false, `${table} must never be truncatable by the runtime`);
    if (appendOnlyTables.includes(table)) {
      assert.equal(privileges.has('UPDATE'), false, `${table} is append-only: no UPDATE grant`);
      assert.equal(privileges.has('DELETE'), false, `${table} is append-only: no DELETE grant`);
    }
  }
  assert.equal(grants.get('audit_event').has('INSERT'), false, 'audit_event is trigger-only');
  assert.match(
    sql,
    /GRANT UPDATE \(state, lease_token, lease_until, error, approved_by, updated_at, updated_by\)\s+ON tenant_data\.command_inbox/,
  );
  for (const target of sql.matchAll(/GRANT\b[^;]*?\bTO\s+([^;]+);/g)) {
    assert.deepEqual(target[1].split(',').map(role => role.trim()), ['saven_customer_app']);
  }
  assert.doesNotMatch(sql, /GRANT\b[^;]*\bTO\s+PUBLIC/i);

  // Noise about domains is not allowed in policy predicates.
  for (const body of [...sql.matchAll(/USING \(([^)]*)\)/g)].map(match => match[1])) {
    assert.doesNotMatch(body, /approval_policy|business_rule|posting_constraint|tax_profile|reference_values/);
  }
  assert.doesNotMatch(sql, /CHECK\s*\([^)]*\bIN\s*\(/i);

  // 031 correction: administrator step, dedicated owner, membership isolation.
  const correctionExecutable = correction
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(correctionExecutable, /\b(?:CREATE|ALTER)\s+ROLE\b[^;]*\bBYPASSRLS\b/);
  assert.match(correction, /NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION/);
  assert.match(correction, /\nBEGIN;\n/);
  assert.match(correction.trimEnd(), /COMMIT;$/);
  assert.match(correction, /run it as the separate offline administrator \(superuser\)/);
  assert.match(correction, /CREATE ROLE saven_tenant_admission_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION/);
  assert.match(correction, /refused incompatible pre-existing role saven_tenant_admission_definer/);
  assert.match(correction, /ALTER TABLE auth\.tenant_membership ENABLE ROW LEVEL SECURITY/);
  assert.match(correction, /ALTER TABLE auth\.tenant_membership FORCE ROW LEVEL SECURITY/);
  assert.match(correction, /CREATE POLICY tenant_membership_preselect ON auth\.tenant_membership[\s\S]{0,200}TO saven_auth_service/);
  assert.match(correction, /CREATE POLICY tenant_membership_admission_lookup ON auth\.tenant_membership[\s\S]{0,200}TO saven_tenant_admission_definer/);
  assert.doesNotMatch(correction, /CREATE POLICY[^;]*USING \(true\)/i);
  assert.doesNotMatch(correction, /CREATE POLICY[^;]*TO PUBLIC/i);
  assert.doesNotMatch(correction, /CREATE POLICY[^;]*ON auth\.users|CREATE POLICY[^;]*ON auth\.sessions/i);
  assert.match(correction, /p_tenant = tenant_data\.current_tenant_id\(\)/);
  assert.match(correction, /p_user = tenant_data\.current_user_id\(\)/);
  assert.match(correction, /ALTER FUNCTION tenant_data\.session_admitted\(uuid, uuid\) OWNER TO saven_tenant_admission_definer/);
  assert.match(correction, /GRANT SELECT \(tenant_id, user_id, status, suspended_at, revoked_at\)\s+ON auth\.tenant_membership TO saven_tenant_admission_definer/);
  assert.match(correction, /GRANT SELECT \(id, status\)\s+ON auth\.users TO saven_tenant_admission_definer/);
  assert.match(correction, /GRANT SELECT \(tenant_id, user_uuid, active\)\s+ON tenant_data\.members TO saven_tenant_admission_definer/);
  assert.match(correction, /REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM saven_tenant_admission_definer/);
  assert.match(correction, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant_data FROM saven_customer_app/);
  assert.match(correction, /GRANT USAGE, SELECT ON SEQUENCE tenant_data\.audit_id_seq TO saven_customer_app/);
  for (const constraint of Object.values(companyScopedTables)) {
    assert.match(correction, new RegExp(`${constraint} FOREIGN KEY \\(tenant_id, company\\)[\\s\\S]{0,120}REFERENCES tenant_data\\.company_profiles`));
    assert.match(correction, new RegExp(`VALIDATE CONSTRAINT ${constraint}`));
  }
  assert.match(correction, /relkind IN \('r', 'p'\)/);
  assert.match(correction, /031-rls-corrections\.sql is already applied/);
  assert.doesNotMatch(correction, /GRANT\b[^;]*\bTO\s+(?:saven_auth_service|saven_auth_definer|saven_operator_read|saven_operator_admin)\b/i);

  // 032 hardening: restrictive membership guards plus a full-authority validator that
  // refuses rather than repairing, and changes no privilege at all.
  const hardening = await readFile(new URL(rlsHardeningPath, repoRoot), 'utf8');
  const hardeningExecutable = hardening
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  assert.match(hardening, /\nBEGIN;\n/);
  assert.match(hardening.trimEnd(), /COMMIT;$/);
  assert.match(hardening, /032-rls-hardening\.sql is already applied/);
  assert.match(hardening, /CREATE POLICY tenant_membership_preselect_scope ON auth\.tenant_membership\s+AS RESTRICTIVE FOR ALL TO saven_auth_service/);
  assert.match(hardening, /CREATE POLICY tenant_membership_admission_scope ON auth\.tenant_membership\s+AS RESTRICTIVE FOR ALL TO saven_tenant_admission_definer/);
  assert.match(hardening, /tenant_membership_preselect_scope/);
  assert.match(hardening, /R2-AUTHORITY: admission owner has forbidden role attributes/);
  assert.match(hardening, /R2-AUTHORITY: admission owner has direct role memberships/);
  assert.match(hardening, /R2-AUTHORITY: admission owner transitively holds privileges of/);
  assert.match(hardening, /R2-AUTHORITY: a SAVEN principal can assume the admission owner/);
  assert.match(hardening, /R2-AUTHORITY: admission owner owns relations/);
  assert.match(hardening, /R2-AUTHORITY: admission owner schema privileges differ from the allow-list/);
  assert.match(hardening, /R2-AUTHORITY: admission owner holds table\/sequence-level privileges/);
  assert.match(hardening, /R2-AUTHORITY: admission owner column privileges differ from the allow-list/);
  assert.match(hardening, /R2-AUTHORITY: admission owner function privileges differ from the allow-list/);
  assert.match(hardening, /R2-AUTHORITY: admission owner is named in default privileges/);
  assert.match(hardening, /allowed_columns := ARRAY\[/);
  assert.match(hardening, /allowed_functions := ARRAY\[/);
  assert.match(hardening, /SELECT pg_temp\.saven_assert_admission_owner\(\);/g);
  // It must not broaden or strip privileges: no GRANT/REVOKE at all.
  assert.doesNotMatch(hardeningExecutable, /\b(?:GRANT|REVOKE)\b/);
  // The validator names the flags it forbids; no role is created or altered here.
  assert.doesNotMatch(hardeningExecutable, /\b(?:CREATE|ALTER)\s+ROLE\b/);
  assert.match(hardeningExecutable, /'BYPASSRLS', r\.rolbypassrls/);
});

test('PIVOT-004 catalog: tenant and membership isolation, no foreign policies, no bypass', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    const tables = (
      await db.adminQuery(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND c.relkind IN ('r', 'p')
         ORDER BY c.relname`,
      )
    ).rows;
    assert.deepEqual(tables.map(row => row.relname), [...tenantTables].sort());
    for (const table of tables) {
      assert.equal(table.relrowsecurity, true, `${table.relname} must ENABLE ROW LEVEL SECURITY`);
      assert.equal(table.relforcerowsecurity, true, `${table.relname} must FORCE ROW LEVEL SECURITY`);
    }

    const policies = (
      await db.adminQuery(
        `SELECT c.relname AS table_name, p.polname, p.polpermissive,
                p.polqual IS NOT NULL AS has_using,
                p.polwithcheck IS NOT NULL AS has_check,
                pg_get_expr(p.polqual, p.polrelid) AS using_expression,
                ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.oid = ANY(p.polroles)) AS roles
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data'
         ORDER BY c.relname, p.polname`,
      )
    ).rows;
    assert.equal(policies.length, tenantTables.length * 3);
    for (const table of tenantTables) {
      const own = policies.filter(row => row.table_name === table);
      assert.equal(own.filter(row => row.polpermissive).length, 1);
      assert.equal(own.filter(row => !row.polpermissive).length, 2);
      const admission = own.find(row => row.polname === `${table}_runtime_admission`);
      assert.match(admission.roles[0], /_customer_app$/);
      assert.match(admission.using_expression, /session_admitted/);
      for (const row of own.filter(row => row.polname !== `${table}_runtime_admission`)) {
        assert.equal(row.roles.includes('PUBLIC') || row.roles.length === 0, true, `${row.polname} must be TO PUBLIC`);
      }
      for (const row of own) {
        assert.equal(row.has_using, true, `${row.polname} needs USING`);
        assert.equal(row.has_check, true, `${row.polname} needs WITH CHECK`);
      }
    }

    // Membership isolation is forced and role-scoped, and its predicates never call
    // back into a tenant_data policy helper (no recursion path).
    const membership = (
      await db.adminQuery(
        `SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'`,
      )
    ).rows[0];
    assert.deepEqual(membership, {relrowsecurity: true, relforcerowsecurity: true});

    const membershipPolicies = (
      await db.adminQuery(
        `SELECT p.polname, p.polpermissive,
                pg_get_expr(p.polqual, p.polrelid) AS using_expression,
                ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.oid = ANY(p.polroles)) AS roles
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'
         ORDER BY p.polname`,
      )
    ).rows;
    assert.deepEqual(membershipPolicies.map(row => row.polname), [
      'tenant_membership_admission_lookup',
      'tenant_membership_admission_scope',
      'tenant_membership_preselect',
      'tenant_membership_preselect_scope',
    ]);
    for (const policy of membershipPolicies) {
      assert.deepEqual(policy.roles.length, 1, `${policy.polname} must target exactly one role`);
      assert.equal(policy.roles.includes('PUBLIC'), false);
      assert.doesNotMatch(policy.using_expression, /session_admitted/);
      assert.doesNotMatch(policy.using_expression, /^true$/);
    }
    // Each role with membership access has exactly one permissive and one restrictive
    // policy with the same predicate, so an added permissive policy cannot widen it.
    for (const roleName of [db.roles.authService, db.extraRoles.tenantAdmissionDefiner]) {
      const own = membershipPolicies.filter(policy => policy.roles[0] === roleName);
      assert.equal(own.length, 2, `${roleName} must have a permissive/restrictive pair`);
      assert.equal(own.filter(policy => policy.polpermissive).length, 1);
      assert.equal(own.filter(policy => !policy.polpermissive).length, 1);
    }

    const otherAuthPolicies = (
      await db.adminQuery(
        `SELECT c.relname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('auth', 'operator') AND NOT (n.nspname = 'auth' AND c.relname = 'tenant_membership')`,
      )
    ).rows;
    assert.deepEqual(otherAuthPolicies, [], 'only auth.tenant_membership is tenant-scoped; no other auth/operator policy exists');

    // Runtime roles own no tenant relation and no SAVEN principal has BYPASSRLS.
    const runtimeOwned = (
      await db.adminQuery(
        `SELECT count(*)::int AS n
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
         WHERE n.nspname = 'tenant_data' AND r.rolname = ANY($1)`,
        [[db.roles.customerApp, db.roles.authService, db.roles.operatorRead, db.roles.operatorAdmin]],
      )
    ).rows[0].n;
    assert.equal(runtimeOwned, 0);
    const bypass = (
      await db.adminQuery(
        `SELECT count(*)::int AS n FROM pg_roles WHERE rolbypassrls AND rolname = ANY($1)`,
        [[...db.targetRoles, db.extraRoles.tenantAdmissionDefiner, db.migrationLogin]],
      )
    ).rows[0].n;
    assert.equal(bypass, 0);
  });
});

test('PIVOT-004 grants: dedicated admission owner, minimum sequences, no foreign access', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    const oids = Object.fromEntries(
      (
        await db.adminQuery(
          `SELECT c.relname, c.oid::int AS oid FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'tenant_data' AND c.relkind IN ('r', 'p')`,
        )
      ).rows.map(row => [row.relname, row.oid]),
    );
    const priv = async (role, table, privilege) => (
      await db.adminQuery('SELECT has_table_privilege($1, $2::oid, $3) AS allowed', [role, oids[table], privilege])
    ).rows[0].allowed;

    assert.equal(
      (await db.adminQuery('SELECT has_schema_privilege($1, $2, $3) AS allowed', [db.roles.customerApp, 'tenant_data', 'USAGE'])).rows[0].allowed,
      true,
    );
    assert.equal(
      (await db.adminQuery('SELECT has_schema_privilege($1, $2, $3) AS allowed', [db.roles.customerApp, 'tenant_data', 'CREATE'])).rows[0].allowed,
      false,
    );

    const ownerless = [
      db.roles.authService, db.roles.authDefiner,
      db.roles.operatorRead, db.roles.operatorAdmin, db.roles.operatorDefiner,
    ];
    for (const table of tenantTables) {
      assert.equal(await priv(db.roles.customerApp, table, 'TRUNCATE'), false);
      assert.equal(await priv(db.roles.customerApp, table, 'SELECT'), true);
      for (const role of ownerless) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          assert.equal(await priv(role, table, privilege), false, `${role} must hold no ${privilege} on ${table}`);
        }
      }
    }
    for (const table of appendOnlyTables) {
      assert.equal(await priv(db.roles.customerApp, table, 'UPDATE'), false, `${table} must reject runtime UPDATE`);
      assert.equal(await priv(db.roles.customerApp, table, 'DELETE'), false, `${table} must reject runtime DELETE`);
    }
    assert.equal(await priv(db.roles.customerApp, 'audit_event', 'INSERT'), false);

    const columnPrivilege = async (role, table, column, privilege) => (
      await db.adminQuery('SELECT has_column_privilege($1, $2::oid, $3, $4) AS allowed', [
        role, oids[table], column, privilege,
      ])
    ).rows[0].allowed;
    assert.equal(await columnPrivilege(db.roles.customerApp, 'command_inbox', 'state', 'UPDATE'), true);
    assert.equal(await columnPrivilege(db.roles.customerApp, 'command_inbox', 'payload', 'UPDATE'), false);

    // Sequence privilege is now named, not blanket.
    const sequencePrivilege = async (role, sequence, privilege) => (
      await db.adminQuery('SELECT has_sequence_privilege($1, $2, $3) AS allowed', [role, `tenant_data.${sequence}`, privilege])
    ).rows[0].allowed;
    assert.equal(await sequencePrivilege(db.roles.customerApp, 'audit_id_seq', 'USAGE'), true);
    assert.equal(await sequencePrivilege(db.roles.customerApp, 'audit_id_seq', 'SELECT'), true);
    assert.equal(await sequencePrivilege(db.roles.customerApp, 'audit_event_id_seq', 'USAGE'), false);
    const otherSequenceGrants = (
      await db.adminQuery(
        `SELECT count(*)::int AS n
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.rolname = $1
         WHERE n.nspname = 'tenant_data' AND c.relkind = 'S'
           AND c.relacl IS NOT NULL
           AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = r.oid)`,
        [db.roles.customerApp],
      )
    ).rows[0].n;
    assert.equal(otherSequenceGrants, 1, 'the runtime keeps exactly one tenant sequence grant');

    // Dedicated admission owner: constrained attributes, exact column reads only,
    // function ownership, and no runtime membership.
    const definer = db.extraRoles.tenantAdmissionDefiner;
    const role = (
      await db.adminQuery(
        `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit, rolreplication
         FROM pg_roles WHERE rolname = $1`,
        [definer],
      )
    ).rows[0];
    assert.deepEqual(role, {
      rolsuper: false, rolbypassrls: false, rolcreatedb: false,
      rolcreaterole: false, rolcanlogin: false, rolinherit: false, rolreplication: false,
    });
    const functionOwner = (
      await db.adminQuery(
        `SELECT p.proowner::regrole::text AS owner, p.prosecdef, p.proconfig,
                has_function_privilege($1, p.oid, 'EXECUTE') AS customer_exec,
                has_function_privilege($2, p.oid, 'EXECUTE') AS auth_exec,
                has_function_privilege($3, p.oid, 'EXECUTE') AS definer_exec,
                EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_exec
         FROM pg_proc p WHERE p.oid = 'tenant_data.session_admitted(uuid, uuid)'::regprocedure`,
        [db.roles.customerApp, db.roles.authService, definer],
      )
    ).rows[0];
    assert.equal(functionOwner.owner, definer);
    assert.equal(functionOwner.prosecdef, true);
    assert.deepEqual(functionOwner.proconfig, ['search_path=pg_catalog, auth, tenant_data']);
    assert.equal(functionOwner.customer_exec, true);
    assert.equal(functionOwner.auth_exec, false);
    assert.equal(functionOwner.public_exec, false);

    // Exact column reads, no table-level read, no writes, no tenant table ownership.
    assert.equal(await columnPrivilege(definer, 'members', 'tenant_id', 'SELECT'), true);
    assert.equal(await columnPrivilege(definer, 'members', 'user_uuid', 'SELECT'), true);
    assert.equal(await priv(definer, 'members', 'SELECT'), false, 'column grants only, never table-level');
    for (const table of tenantTables.filter(name => name !== 'members')) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.equal(await priv(definer, table, privilege), false, `${definer} must hold no ${privilege} on ${table}`);
      }
    }
    assert.equal(await columnPrivilege(definer, 'members', 'active', 'UPDATE'), false);
    const schemaPrivilege = async (roleName, schema, privilege) => (
      await db.adminQuery('SELECT has_schema_privilege($1, $2, $3) AS allowed', [roleName, schema, privilege])
    ).rows[0].allowed;
    assert.equal(await schemaPrivilege(definer, 'auth', 'USAGE'), true);
    assert.equal(await schemaPrivilege(definer, 'tenant_data', 'USAGE'), true);
    assert.equal(await schemaPrivilege(definer, 'tenant_data', 'CREATE'), false);
    assert.equal(await schemaPrivilege(definer, 'operator', 'USAGE'), false);

    // No runtime principal is a member of the definer, and the definer holds no
    // membership in a runtime role.
    const memberships = (
      await db.adminQuery(
        `SELECT member.rolname AS member, granted.rolname AS granted
         FROM pg_auth_members m
         JOIN pg_roles member ON member.oid = m.member
         JOIN pg_roles granted ON granted.oid = m.roleid
         WHERE granted.rolname = $1 OR member.rolname = $1`,
        [definer],
      )
    ).rows;
    assert.deepEqual(memberships, []);
    await assert.rejects(
      () => db.asRole('customerApp', client => client.query(`SET LOCAL ROLE "${definer}"`)),
      /permission denied|must be member/,
    );

    const publicEntries = (
      await db.adminQuery(
        `SELECT c.relname, a.privilege_type
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a
         WHERE n.nspname = 'tenant_data' AND c.relkind IN ('r', 'p') AND a.grantee = 0`,
      )
    ).rows;
    assert.deepEqual(publicEntries, []);
  });
});

test('PIVOT-004 runtime: verified context isolates reads, writes and the admission oracle', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedBase(db);

    const withContext = async (tenant, user, run) => db.asRole('customerApp', async client => {
      if (tenant !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenant]);
      if (user !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', user]);
      return run(client);
    });
    const counts = async (tenant, user) => withContext(tenant, user, async client => ({
      accounts: (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n,
      lines: (await client.query('SELECT count(*)::int AS n FROM tenant_data.journal_lines')).rows[0].n,
      ownAccounts: (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T1}'`)).rows[0].n,
      foreignAccounts: (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n,
    }));

    assert.deepEqual(await counts(T1, U1), {accounts: 2, lines: 2, ownAccounts: 2, foreignAccounts: 0});
    assert.deepEqual(await counts(T2, U2), {accounts: 1, lines: 2, ownAccounts: 0, foreignAccounts: 1});
    assert.deepEqual(await counts(undefined, undefined), {accounts: 0, lines: 0, ownAccounts: 0, foreignAccounts: 0});
    assert.deepEqual(await counts('', U1), {accounts: 0, lines: 0, ownAccounts: 0, foreignAccounts: 0});
    assert.deepEqual(await counts('not-a-uuid', U1), {accounts: 0, lines: 0, ownAccounts: 0, foreignAccounts: 0});
    assert.deepEqual(await counts(T1, U2), {accounts: 0, lines: 0, ownAccounts: 0, foreignAccounts: 0});
    assert.deepEqual(await counts(T2, U3), {accounts: 0, lines: 0, ownAccounts: 0, foreignAccounts: 0});

    // Admission state denial.
    for (const [label, mutate, restore] of [
      ['suspended membership', `UPDATE auth.tenant_membership SET suspended_at = now() WHERE tenant_id = '${T1}' AND user_id = '${U1}'`, `UPDATE auth.tenant_membership SET suspended_at = NULL WHERE tenant_id = '${T1}' AND user_id = '${U1}'`],
      ['revoked membership', `UPDATE auth.tenant_membership SET revoked_at = now(), status = 'revoked' WHERE tenant_id = '${T1}' AND user_id = '${U1}'`, `UPDATE auth.tenant_membership SET revoked_at = NULL, status = 'active' WHERE tenant_id = '${T1}' AND user_id = '${U1}'`],
      ['inactive principal', `UPDATE tenant_data.members SET active = false WHERE tenant_id = '${T1}' AND user_id = 'user-1'`, `UPDATE tenant_data.members SET active = true WHERE tenant_id = '${T1}' AND user_id = 'user-1'`],
      ['inactive identity', `UPDATE auth.users SET status = 'suspended' WHERE id = '${U1}'`, `UPDATE auth.users SET status = 'active' WHERE id = '${U1}'`],
    ]) {
      await db.adminQuery(mutate);
      const denied = await counts(T1, U1);
      assert.equal(denied.accounts, 0, `${label} must deny tenant reads`);
      assert.equal(denied.lines, 0, `${label} must deny child-table reads`);
      await db.adminQuery(restore);
    }
    assert.deepEqual(await counts(T1, U1), {accounts: 2, lines: 2, ownAccounts: 2, foreignAccounts: 0});

    // The admission helper is bound to verified context: it is not an oracle.
    const oracle = await withContext(T1, U1, async client => ({
      own: (await client.query(`SELECT tenant_data.session_admitted('${T1}'::uuid, '${U1}'::uuid) AS v`)).rows[0].v,
      otherTenant: (await client.query(`SELECT tenant_data.session_admitted('${T2}'::uuid, '${U2}'::uuid) AS v`)).rows[0].v,
      otherUser: (await client.query(`SELECT tenant_data.session_admitted('${T1}'::uuid, '${U2}'::uuid) AS v`)).rows[0].v,
      sameTenantOtherUser: (await client.query(`SELECT tenant_data.session_admitted('${T2}'::uuid, '${U1}'::uuid) AS v`)).rows[0].v,
    }));
    assert.deepEqual(oracle, {own: true, otherTenant: false, otherUser: false, sameTenantOtherUser: false});

    // Writes and append-only classes.
    await withContext(T1, U1, async client => {
      const expectRefused = async (statement, pattern, label) => {
        await client.query('SAVEPOINT pivot004_probe');
        await assert.rejects(() => client.query(statement), pattern, label);
        await client.query('ROLLBACK TO SAVEPOINT pivot004_probe');
      };
      await client.query(`INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '5000', 'New A')`);
      await client.query(`UPDATE tenant_data.accounts SET title = 'Cash A2' WHERE code = '1000'`);
      await expectRefused(
        `INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T2}', '5000', 'New B')`,
        /row-level security/,
      );
      await expectRefused(
        `UPDATE tenant_data.accounts SET tenant_id = '${T2}' WHERE code = '5000'`,
        /row-level security/,
      );
      assert.equal(
        (await client.query(`UPDATE tenant_data.accounts SET title = 'nope' WHERE tenant_id = '${T2}'`)).rowCount,
        0,
      );
      assert.equal((await client.query(`DELETE FROM tenant_data.denials WHERE tenant_id = '${T1}'`)).rowCount, 1);
      await client.query(`INSERT INTO tenant_data.audit(tenant_id, actor, event, detail, happened_at) VALUES ('${T1}', 'user-1', 'COMMAND_ACCEPTED', '{}', 0)`);
      await expectRefused(`UPDATE tenant_data.journal_lines SET debit = debit`, /permission denied for table journal_lines/);
      await expectRefused(`DELETE FROM tenant_data.journals`, /permission denied for table journals/);
      await expectRefused(
        `INSERT INTO tenant_data.audit_event(tenant_id, actor_id, event, entity_type) VALUES ('${T1}', 'user-1', 'probe', 'document')`,
        /permission denied for table audit_event/,
      );
      await expectRefused(
        `INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES ('${T1}', 'cmd-b', 9, '1000', 5, 0)`,
        /foreign key|row-level security/,
      );
      await expectRefused(`SELECT count(*) FROM auth.tenant_membership`, /permission denied for schema auth/);
    });

    // Joins/aggregates only ever see the caller's tenant.
    await withContext(T1, U1, async client => {
      const rows = (
        await client.query(
          `SELECT j.tenant_id::text AS tenant_id, a.code, sum(l.debit)::text AS debit
           FROM tenant_data.journals j
           JOIN tenant_data.journal_lines l ON l.tenant_id = j.tenant_id AND l.journal_id = j.id
           JOIN tenant_data.accounts a ON a.tenant_id = l.tenant_id AND a.code = l.account
           GROUP BY 1, 2 ORDER BY 2`,
        )
      ).rows;
      assert.deepEqual(rows, [
        {tenant_id: T1, code: '1000', debit: '100'},
        {tenant_id: T1, code: '4000', debit: '0'},
      ]);
    });

    // Owner is still subject to FORCE RLS.
    const ownerView = await db.asRole('migrator', async client => {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', T1]);
      return {
        own: (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n,
        foreign: (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n,
        membership: (await client.query('SELECT count(*)::int AS n FROM auth.tenant_membership')).rows[0].n,
      };
    });
    assert.deepEqual(ownerView, {own: 2, foreign: 0, membership: 0});
    await assert.rejects(
      () => db.asRole('migrator', async client => {
        await client.query('SET LOCAL row_security = off');
        await client.query('SELECT count(*) FROM tenant_data.accounts');
      }),
      /row-level security/,
    );
  });
});

test('PIVOT-004 auth membership: principal-bound preselection and no cross-principal read', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedBase(db);

    const preselection = async (user) => db.asRole('authService', async client => {
      if (user !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', user]);
      const rows = (await client.query(
        'SELECT tenant_id::text AS tenant_id, user_id::text AS user_id FROM auth.tenant_membership ORDER BY tenant_id',
      )).rows;
      return rows;
    });

    // U1 is a member of two tenants: that is authorized selection, not a leak.
    assert.deepEqual(await preselection(U1), [
      {tenant_id: T1, user_id: U1},
      {tenant_id: T2, user_id: U1},
    ]);
    assert.deepEqual(await preselection(U2), [{tenant_id: T2, user_id: U2}]);
    assert.deepEqual(await preselection(undefined), []);
    assert.deepEqual(await preselection('not-a-uuid'), []);

    // The auth service cannot see another principal by re-setting context alone.
    await db.asRole('authService', async client => {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', U3]);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.tenant_membership')).rows[0].n, 0);
    });

    // Preselection is read-only: no blanket write policy exists.
    await db.asRole('authService', async client => {
      await client.query('SAVEPOINT probe');
      await assert.rejects(
        () => client.query(
          `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status) VALUES ('${T3}', '${U3}', 'member', 'invited')`,
        ),
        /row-level security/,
        'membership provisioning needs its own reviewed, principal-bound policy',
      );
      await client.query('ROLLBACK TO SAVEPOINT probe');
    });
  });
});

test('PIVOT-004 scoped references: same-tenant wrong-parent and cross-tenant are both refused', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedBase(db);

    // Every represented company column now has a parent.
    const constraints = (
      await db.adminQuery(
        `SELECT c.relname AS table_name, con.conname
         FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND con.contype = 'f'
           AND con.conname = ANY($1) ORDER BY con.conname`,
        [Object.values(companyScopedTables)],
      )
    ).rows;
    assert.deepEqual(
      constraints.map(row => `${row.table_name}:${row.conname}`).sort(),
      Object.entries(companyScopedTables).map(([table, name]) => `${table}:${name}`).sort(),
    );

    // A second accepted command exists so the company test fails on the parent link,
    // not on a duplicate journal key.
    await db.adminQuery(`INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at) VALUES ('${T1}', 'cmd-a2', 'user-1', 'digest-a2', '{}', 'ACCEPTED_PENDING', 0)`);

    // Same tenant, unknown company (wrong parent) is refused, not merely hidden.
    for (const [statement, pattern] of [
      [`INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative) VALUES ('${T1}', 'cmd-a2', 'ghost', 'main', '2026-11-15', 'x')`, /journals_company_fkey/],
      [`INSERT INTO tenant_data.periods(tenant_id, company, start_date, end_date, locked) VALUES ('${T1}', 'ghost', '2026-11-01', '2026-11-30', false)`, /periods_company_fkey/],
      [`INSERT INTO tenant_data.journal_drafts(tenant_id, id, actor, company, branch, payload, revision, state, created_at, updated_at) VALUES ('${T1}', 'draft-ghost', 'user-1', 'ghost', 'main', '{}', 1, 'DRAFT', 0, 0)`, /journal_drafts_company_fkey/],
      [`INSERT INTO tenant_data.trade_controls(tenant_id, company, branch, account) VALUES ('${T1}', 'ghost', 'main', '1000')`, /trade_controls_company_fkey/],
      [`INSERT INTO tenant_data.trade_parties(tenant_id, company, branch, id, kind, name) VALUES ('${T1}', 'ghost', 'main', 'p1', 'customer', 'Ghost')`, /trade_parties_company_fkey/],
      [`INSERT INTO tenant_data.document_registry(tenant_id, document_id, document_type, document_status, company) VALUES ('${T1}', 'doc-ghost', 'JOURNAL', 'DRAFT', 'ghost')`, /document_registry_company_fkey/],
    ]) {
      await assert.rejects(() => db.adminQuery(statement), pattern);
    }

    // Same tenant, real company: accepted.
    await db.adminQuery(`INSERT INTO tenant_data.periods(tenant_id, company, start_date, end_date, locked) VALUES ('${T1}', 'alpha', '2026-11-01', '2026-11-30', false)`);
    await db.adminQuery(`INSERT INTO tenant_data.trade_parties(tenant_id, company, branch, id, kind, name) VALUES ('${T1}', 'alpha', 'main', 'p1', 'customer', 'Real')`);

    // One trade document per command, so each probe gets its own accepted command.
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at) VALUES
        ('${T1}', 'cmd-a3', 'user-1', 'digest-a3', '{}', 'ACCEPTED_PENDING', 0),
        ('${T1}', 'cmd-a4', 'user-1', 'digest-a4', '{}', 'ACCEPTED_PENDING', 0);
      INSERT INTO tenant_data.trade_operations(tenant_id, command_id, input_digest, payload) VALUES
        ('${T1}', 'cmd-a', 'digest-trade', '{}'),
        ('${T1}', 'cmd-a3', 'digest-trade-3', '{}'),
        ('${T1}', 'cmd-a4', 'digest-trade-4', '{}');
    `);
    await db.adminQuery(
      `INSERT INTO tenant_data.trade_documents(tenant_id, command_id, company, branch, party_id, kind, reference, posting_date, due_date, total)
       VALUES ('${T1}', 'cmd-a', 'alpha', 'main', 'p1', 'invoice', 'INV-OK', '2026-11-15', '2026-12-15', 100)`,
    );

    // Unknown parent inside the same tenant: refused.
    await assert.rejects(
      () => db.adminQuery(
        `INSERT INTO tenant_data.trade_documents(tenant_id, command_id, company, branch, party_id, kind, reference, posting_date, due_date, total)
         VALUES ('${T1}', 'cmd-a3', 'alpha', 'main', 'p1-wrong', 'invoice', 'INV-1', '2026-11-15', '2026-12-15', 100)`,
      ),
      /trade_documents_party_fkey/,
    );

    // A parent that exists only in another tenant: refused, even though the parent
    // id is valid somewhere in the database.
    await db.adminQuery(
      `INSERT INTO tenant_data.trade_parties(tenant_id, company, branch, id, kind, name) VALUES ('${T2}', 'beta', 'main', 'p2', 'customer', 'Other tenant')`,
    );
    await assert.rejects(
      () => db.adminQuery(
        `INSERT INTO tenant_data.trade_documents(tenant_id, command_id, company, branch, party_id, kind, reference, posting_date, due_date, total)
         VALUES ('${T1}', 'cmd-a4', 'alpha', 'main', 'p2', 'invoice', 'INV-2', '2026-11-15', '2026-12-15', 100)`,
      ),
      /trade_documents_party_fkey/,
      'a same-id party from another tenant is still refused',
    );
  });
});

test('PIVOT-004 principal mapping: exact text/UUID membership and identity binding', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedBase(db);
    // A valid membership for (T3, U1) makes the membership FK satisfiable, so the
    // negative test below can only fail for the exact text/UUID pair reason.
    await db.adminQuery(`INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at) VALUES ('${T3}', '${U1}', 'ultimate_owner', 'active', now(), now())`);

    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES ('${T3}', 'user-2', '${U1}', true)`),
      /members_canonical_identity_fkey/,
      'membership exists but the text/UUID pair is wrong: the identity pair FK must refuse it',
    );
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES ('${T3}', 'user-3', '${U3}', true)`),
      /members_canonical_membership_fkey/,
    );
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES ('${T1}', 'user-1-alt', '${U1}', true)`),
      /members_tenant_user_uuid_key/,
    );
    // The same canonical user may be a principal in another tenant (T3 has its own
    // valid membership for U1, so this proves the projection is tenant-scoped rather
    // than globally unique).
    await db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES ('${T3}', 'user-1', '${U1}', true)`);
    await assert.rejects(
      () => db.adminQuery(`UPDATE auth.users SET legacy_id = 'user-1-renamed' WHERE id = '${U1}'`),
      /members_canonical_identity_fkey/,
    );
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, active) VALUES ('${T1}', 'user-null', true)`),
      /null value in column "user_uuid"|not-null/,
    );
  });
});

test('PIVOT-004 resists an extra permissive policy and an attacker permissive policy on auth', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedBase(db);

    await db.asRole('migrator', client => client.query(
      `CREATE POLICY pivot004_attack ON tenant_data.accounts AS PERMISSIVE FOR ALL TO saven_customer_app USING (true) WITH CHECK (true)`,
    ), {commit: true});
    await db.asRole('migrator', client => client.query(
      `CREATE POLICY pivot004_auth_attack ON auth.tenant_membership AS PERMISSIVE FOR SELECT TO saven_customer_app USING (true)`,
    ), {commit: true});
    const attackView = await db.asRole('customerApp', async client => {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', T1]);
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', U1]);
      const own = (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n;
      const foreign = (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n;
      return {own, foreign};
    });
    assert.deepEqual(attackView, {own: 2, foreign: 0}, 'an extra permissive policy must not cross tenants');
    const notAdmitted = await db.asRole('customerApp', async client => {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', T1]);
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', U2]);
      return (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n;
    });
    assert.equal(notAdmitted, 0, 'an extra permissive policy must not bypass admission');

    await db.asRole('migrator', client => client.query('DROP POLICY pivot004_attack ON tenant_data.accounts'), {commit: true});
    await db.asRole('migrator', client => client.query('DROP POLICY pivot004_auth_attack ON auth.tenant_membership'), {commit: true});

    // Real attacked-role test: a PERMISSIVE policy targeting the role that actually
    // holds membership access must not widen its view, because the restrictive partner
    // carries the same predicate.
    await db.asRole('migrator', client => client.query(
      `CREATE POLICY r2_auth_service_attack ON auth.tenant_membership AS PERMISSIVE FOR ALL TO ${quoteRole(db.roles.authService)} USING (true) WITH CHECK (true)`,
    ), {commit: true});
    const attacked = await db.asRole('authService', async client => {
      const setUser = value => client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', value]);
      await setUser(U1);
      const ownRows = (await client.query('SELECT tenant_id::text AS t, user_id::text AS u FROM auth.tenant_membership ORDER BY tenant_id')).rows;
      await setUser(U3);
      const foreignRows = (await client.query('SELECT count(*)::int AS n FROM auth.tenant_membership')).rows[0].n;
      await setUser('');
      const emptyRows = (await client.query('SELECT count(*)::int AS n FROM auth.tenant_membership')).rows[0].n;
      await setUser('not-a-uuid');
      const malformedRows = (await client.query('SELECT count(*)::int AS n FROM auth.tenant_membership')).rows[0].n;
      return {ownRows, foreignRows, emptyRows, malformedRows};
    });
    assert.deepEqual(attacked.ownRows, [{t: T1, u: U1}, {t: T2, u: U1}], 'own-user preselection still works');
    assert.equal(attacked.foreignRows, 0, 'an extra permissive policy must not expose another principal');
    assert.equal(attacked.emptyRows, 0);
    assert.equal(attacked.malformedRows, 0);
    await db.asRole('migrator', client => client.query('DROP POLICY r2_auth_service_attack ON auth.tenant_membership'), {commit: true});

    for (const role of ['operatorRead', 'operatorAdmin', 'authService']) {
      await assert.rejects(
        () => db.asRole(role, client => client.query('SELECT count(*) FROM tenant_data.accounts')),
        /permission denied for schema tenant_data/,
      );
    }
    await assert.rejects(
      () => db.asRole('customerApp', client => client.query('CREATE TABLE tenant_data.probe(id integer)')),
      /permission denied for schema tenant_data/,
    );
    await assert.rejects(
      () => db.asRole('customerApp', client => client.query('ALTER TABLE tenant_data.accounts ADD COLUMN probe integer')),
      /must be owner|permission denied/,
    );
  });
});

test('PIVOT-004 correction 031 is atomic: a failing application leaves no partial state', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles}, async db => {
    const original = await readFile(new URL(rlsCorrectionsPath, repoRoot), 'utf8');
    const snapshot = async () => ({
      roleExists: (await db.adminQuery(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1`, [db.extraRoles.tenantAdmissionDefiner])).rows[0].n,
      membershipForced: (
        await db.adminQuery(
          `SELECT c.relrowsecurity AND c.relforcerowsecurity AS forced FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'`,
        )
      ).rows[0].forced,
      authPolicies: (await db.adminQuery(`SELECT count(*)::int AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth'`)).rows[0].n,
      companyKeys: (await db.adminQuery(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = ANY($1)`, [Object.values(companyScopedTables)])).rows[0].n,
      auditSequenceGrants: (await db.adminQuery(`SELECT has_sequence_privilege($1, 'tenant_data.audit_id_seq', 'USAGE') AS granted`, [db.roles.customerApp])).rows[0].granted,
      functionOwner: (await db.adminQuery(`SELECT p.proowner::regrole::text AS owner FROM pg_proc p WHERE p.oid = 'tenant_data.session_admitted(uuid, uuid)'::regprocedure`)).rows[0].owner,
    });

    const before = await snapshot();
    assert.equal(before.roleExists, 0);
    assert.equal(before.membershipForced, false);
    assert.equal(before.authPolicies, 0);
    assert.equal(before.companyKeys, 0);
    assert.equal(before.functionOwner, db.roles.migrator);

    const failing = namespaceSql(original, db.roles).replace(
      /COMMIT;\s*$/,
      () => "DO $$ BEGIN RAISE EXCEPTION 'PIVOT-004-R1 simulated failure after all corrections'; END $$;\nCOMMIT;",
    );
    assert.notEqual(failing, namespaceSql(original, db.roles));
    await assert.rejects(() => db.adminQuery(failing), /simulated failure after all corrections/);
    // The simple-query batch started a transaction that errored before its COMMIT;
    // clear the aborted transaction on that session before inspecting the catalog.
    await db.adminQuery('ROLLBACK');

    assert.deepEqual(await snapshot(), before, 'a failed correction must leave no partial role, policy, constraint or grant');

    // The real correction then still applies cleanly on the untouched database.
    await db.adminQuery(namespaceSql(original, db.roles));
    const after = await snapshot();
    assert.equal(after.roleExists, 1);
    assert.equal(after.membershipForced, true);
    assert.equal(after.authPolicies, 2);
    assert.equal(after.companyKeys, Object.keys(companyScopedTables).length);
    assert.equal(after.auditSequenceGrants, true);
    assert.equal(after.functionOwner, db.extraRoles.tenantAdmissionDefiner);

    // A second application is refused rather than silently reapplied.
    await assert.rejects(() => db.adminQuery(namespaceSql(original, db.roles)), /031-rls-corrections\.sql is already applied/);
  });
});


test('PIVOT-004-R2 fixture preflight never mutates a pre-existing extra role', async () => {
  const suffix = 'preserve' + randomBytes(4).toString('hex');
  const names = roleNamesForSuffix(suffix);
  const role = names.tenantAdmissionDefiner;
  const probe = names.database + '_probe';
  const cluster = await connectClusterAdmin();
  let created = false;
  try {
    await cluster.query(`CREATE ROLE ${quoteRole(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
    await cluster.query(`CREATE ROLE ${quoteRole(probe)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
    created = true;
    // Give it state a careless cleanup would destroy: a membership, a setting, a comment.
    await cluster.query(`GRANT ${quoteRole(probe)} TO ${quoteRole(role)}`);
    await cluster.query(`ALTER ROLE ${quoteRole(role)} SET search_path = pg_catalog`);
    await cluster.query(`COMMENT ON ROLE ${quoteRole(role)} IS 'pre-existing role must survive a refused pre-flight'`);

    const snapshot = async () => ({
      role: (
        await cluster.query(
          `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
                  rolbypassrls, rolreplication, rolconfig
           FROM pg_roles WHERE rolname = $1`,
          [role],
        )
      ).rows,
      memberships: (
        await cluster.query(
          `SELECT m.rolname AS member, g.rolname AS granted
           FROM pg_auth_members am
           JOIN pg_roles m ON m.oid = am.member
           JOIN pg_roles g ON g.oid = am.roleid
           WHERE m.rolname = $1 OR g.rolname = $1
           ORDER BY 1, 2`,
          [role],
        )
      ).rows,
      comment: (
        await cluster.query(
          `SELECT shobj_description(oid, 'pg_authid') AS comment FROM pg_roles WHERE rolname = $1`,
          [role],
        )
      ).rows,
      grants: (
        await cluster.query(
          `SELECT count(*)::int AS n FROM pg_auth_members am
           JOIN pg_roles m ON m.oid = am.member WHERE m.rolname = $1`,
          [role],
        )
      ).rows,
    });
    const before = await snapshot();

    await assert.rejects(
      () => withPivotDatabase({namespaceSuffix: suffix}, async () => {
        throw new Error('the run callback must not execute after a pre-flight refusal');
      }),
      /pre-flight refused/i,
    );

    assert.deepEqual(await snapshot(), before, 'a refused pre-flight must not alter the pre-existing role');
    assert.equal(
      (await cluster.query('SELECT 1 FROM pg_database WHERE datname = $1', [names.database])).rowCount,
      0,
      'a refused pre-flight must not create the disposable database',
    );
  } finally {
    if (created) {
      await cluster.query(`REVOKE ${quoteRole(probe)} FROM ${quoteRole(role)}`).catch(() => {});
      await cluster.query(`DROP ROLE IF EXISTS ${quoteRole(role)}`).catch(() => {});
      await cluster.query(`DROP ROLE IF EXISTS ${quoteRole(probe)}`).catch(() => {});
    }
    await cluster.end();
  }
});

test('PIVOT-004-R2 fixture cleans role and database after an administrator hook failure', async () => {
  const suffix = 'hookfail' + randomBytes(4).toString('hex');
  const names = roleNamesForSuffix(suffix);
  await assert.rejects(
    () => withPivotDatabase({
      namespaceSuffix: suffix,
      sqlFiles: schemaFiles,
      adminSql: [
        'CREATE ROLE saven_tenant_admission_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION',
        'SELECT 1/0',
      ],
    }, async () => {
      throw new Error('the run callback must not execute after an administrator hook failure');
    }),
    /division by zero/,
  );
  const cluster = await connectClusterAdmin();
  try {
    assert.equal(
      (await cluster.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [names.tenantAdmissionDefiner])).rowCount,
      0,
      'a hook-created role must be removed when the hook fails',
    );
    assert.equal(
      (await cluster.query('SELECT 1 FROM pg_database WHERE datname = $1', [names.database])).rowCount,
      0,
      'the disposable database must be removed when the hook fails',
    );
  } finally {
    await cluster.end();
  }
});

test('PIVOT-004-R2 refuses excessive admission-owner authority without repairing it', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles: [rlsCorrectionsPath]}, async db => {
    const hardening = namespaceSql(await readFile(new URL(rlsHardeningPath, repoRoot), 'utf8'), db.roles);
    const definer = quoteRole(db.extraRoles.tenantAdmissionDefiner);
    const membershipPolicyCount = async () => (
      await db.adminQuery(
        `SELECT count(*)::int AS n FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'auth' AND c.relname = 'tenant_membership'`,
      )
    ).rows[0].n;
    assert.equal(await membershipPolicyCount(), 2);

    const cases = [
      ['extra column grant', `GRANT SELECT (payload) ON tenant_data.command_inbox TO ${definer}`,
        `REVOKE SELECT (payload) ON tenant_data.command_inbox FROM ${definer}`],
      ['table-level grant', `GRANT SELECT ON tenant_data.accounts TO ${definer}`,
        `REVOKE SELECT ON tenant_data.accounts FROM ${definer}`],
      ['schema CREATE', `GRANT CREATE ON SCHEMA tenant_data TO ${definer}`,
        `REVOKE CREATE ON SCHEMA tenant_data FROM ${definer}`],
      ['operator schema access', `GRANT USAGE ON SCHEMA operator TO ${definer}`,
        `REVOKE USAGE ON SCHEMA operator FROM ${definer}`],
      ['inbound runtime path', `GRANT ${quoteRole(db.roles.customerApp)} TO ${definer}`,
        `REVOKE ${quoteRole(db.roles.customerApp)} FROM ${definer}`],
      ['privileged outbound path', `GRANT ${quoteRole(db.roles.migrator)} TO ${definer}`,
        `REVOKE ${quoteRole(db.roles.migrator)} FROM ${definer}`],
      ['owned relation', `CREATE TABLE public.r2_owned_probe(id integer); ALTER TABLE public.r2_owned_probe OWNER TO ${definer}`,
        'DROP TABLE IF EXISTS public.r2_owned_probe'],
      ['owned function', `CREATE FUNCTION public.r2_owned_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1'; ALTER FUNCTION public.r2_owned_fn() OWNER TO ${definer}`,
        'DROP FUNCTION IF EXISTS public.r2_owned_fn()'],
    ];

    for (const [label, excess, undo] of cases) {
      await db.adminQuery(excess);
      await assert.rejects(() => db.adminQuery(hardening), /R2-AUTHORITY/, `${label} must refuse`);
      await db.adminQuery('ROLLBACK');
      assert.equal(await membershipPolicyCount(), 2, `${label}: the refused run must add no policy`);
      assert.equal(
        (await db.adminQuery(
          `SELECT count(*)::int AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'auth' AND p.polname LIKE '%_scope'`,
        )).rows[0].n,
        0,
        `${label}: no restrictive policy may survive a refusal`,
      );
      await db.adminQuery(undo);
    }

    // With the excess removed, the checked-in hardening applies and the pair exists.
    await db.adminQuery(hardening);
    assert.equal(await membershipPolicyCount(), 4);
    await assert.rejects(() => db.adminQuery(hardening), /032-rls-hardening\.sql is already applied/);
  });
});
