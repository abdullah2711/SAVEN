import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {withPivotDatabase} from './helpers/pg-pivot-fixture.mjs';

const repoRoot = new URL('../', import.meta.url);

// Real run order through the accepted prerequisite schemas and corrections.
const schemaFiles = [
  'db/postgres/05-auth-schema.sql',
  'db/postgres/migrations/006-auth-schema-corrections.sql',
  'db/postgres/10-operator-schema.sql',
  'db/postgres/20-tenant-schema.sql',
  'db/postgres/migrations/021-tenant-schema-corrections.sql',
  'db/postgres/30-rls-policies.sql',
];

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T3 = '33333333-3333-4333-8333-333333333333';

// Every tenant table PIVOT-003 created. Each must be covered by this migration.
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

// Tables the runtime may only append/read: posted or accepted sources.
const appendOnlyTables = [
  'journals', 'journal_lines', 'trade_operations', 'trade_documents', 'trade_lines',
  'trade_allocations', 'trade_credits', 'trade_credit_lines', 'stock_operations',
  'stock_movements', 'command_decisions', 'command_files', 'document_numbers',
  'document_revisions', 'journal_corrections',
];

function sqlStatements(sql) {
  // Drop line comments first so a statement that begins with an explanatory comment
  // is still recognised as a GRANT.
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

test('PIVOT-004 static contract: forced RLS, atomic grants and exact principal binding', async () => {
  const sql = await readFile(new URL('db/postgres/30-rls-policies.sql', repoRoot), 'utf8');
  const executable = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  // Ordinary hardening: no privileged escape hatch, no secret. Scanned on executable
  // statements so that the header's "no BYPASSRLS/superuser" prose is not a finding.
  assert.doesNotMatch(executable, /BYPASSRLS|SUPERUSER/i);
  assert.doesNotMatch(executable, /\bPASSWORD\b|postgres(?:ql)?:\/\//i);
  assert.match(sql.trimStart(), /^-- PIVOT-004/);
  assert.match(sql, /\nBEGIN;\n/);
  assert.match(sql.trimEnd(), /COMMIT;$/);

  // The migration must refuse to run on a partial prerequisite stack.
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
  assert.match(sql, /existing tenant_data\.members rows have no user_uuid mapping/);

  // No RLS, policy or privilege change on auth/operator schemas: only the additive
  // auth.users pair key may touch another schema.
  const authAlterations = [...sql.matchAll(/ALTER TABLE (auth|operator)\.[a-z_.]+/g)].map(match => match[0]);
  assert.deepEqual(authAlterations, ['ALTER TABLE auth.users']);
  assert.doesNotMatch(sql, /CREATE POLICY[^;]*ON\s+(auth|operator)\./i);
  assert.doesNotMatch(sql, /ALTER TABLE (auth|operator)\.[a-z_.]+\s+(ENABLE|FORCE)/i);

  // Table coverage list matches the accepted tenant schema exactly.
  const listMatch = /tables text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql);
  assert.ok(listMatch, 'the migration must declare the table coverage list');
  const declared = [...listMatch[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
  assert.deepEqual(declared.sort(), [...tenantTables].sort());
  assert.equal(new Set(declared).size, declared.length);

  // Three policies per table: one permissive isolation, two restrictive guards.
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /AS PERMISSIVE FOR ALL TO PUBLIC/);
  assert.match(sql, /AS RESTRICTIVE FOR ALL TO PUBLIC/);
  assert.match(sql, /AS RESTRICTIVE FOR ALL TO %I/);
  assert.match(sql, /'saven_customer_app'\);/);
  assert.match(sql, /tenant_data\.session_admitted\(tenant_data\.current_tenant_id\(\), tenant_data\.current_user_id\(\)\)/);

  // Context helpers fail closed and are not definer functions.
  assert.match(sql, /CREATE FUNCTION tenant_data\.current_tenant_id\(\) RETURNS uuid/);
  assert.match(sql, /CREATE FUNCTION tenant_data\.current_user_id\(\) RETURNS uuid/);
  assert.match(sql, /pg_input_is_valid\(v, 'uuid'\)/);
  assert.match(sql, /CREATE FUNCTION tenant_data\.session_admitted\(p_tenant uuid, p_user uuid\) RETURNS boolean/);
  assert.match(sql, /LANGUAGE sql STABLE SECURITY DEFINER\s+SET search_path = pg_catalog, auth, tenant_data/);
  assert.doesNotMatch(sql, /CREATE FUNCTION tenant_data\.current_[a-z_]+\(\)[\s\S]{0,120}SECURITY DEFINER/);
  assert.match(sql, /REVOKE ALL ON FUNCTION tenant_data\.session_admitted\(uuid, uuid\) FROM PUBLIC/);

  // Admission requires active canonical membership AND an active business principal.
  assert.match(sql, /FROM tenant_data\.members m[\s\S]{0,160}m\.active/);
  assert.match(sql, /FROM auth\.tenant_membership tm[\s\S]{0,220}tm\.status = 'active'[\s\S]{0,120}tm\.revoked_at IS NULL[\s\S]{0,120}tm\.suspended_at IS NULL/);
  assert.match(sql, /FROM auth\.users u[\s\S]{0,80}u\.status = 'active'/);

  // Grants: customer app only, no PUBLIC, no auth/operator role, no TRUNCATE.
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
  assert.equal(grants.get('source_store_migrations').size, 1, 'provenance is read-only');
  assert.deepEqual([...grants.get('audit')].sort(), ['INSERT', 'SELECT']);
  // command_inbox UPDATE is column-scoped only; the column list is asserted below and
  // the table-level UPDATE bit is false in the live grant test.
  assert.deepEqual([...grants.get('command_inbox')].sort(), ['INSERT', 'SELECT', 'UPDATE']);
  assert.match(
    sql,
    /GRANT UPDATE \(state, lease_token, lease_until, error, approved_by, updated_at, updated_by\)\s+ON tenant_data\.command_inbox/,
  );

  const grantTargets = [...sql.matchAll(/GRANT\b[^;]*?\bTO\s+([^;]+);/g)].map(match => match[1].trim());
  assert.ok(grantTargets.length > 0);
  for (const target of grantTargets) {
    const roles = target.split(',').map(role => role.trim());
    assert.deepEqual(roles, ['saven_customer_app'], `unexpected grant target: ${target}`);
  }
  for (const role of ['saven_auth_service', 'saven_auth_definer', 'saven_operator_read', 'saven_operator_admin', 'saven_operator_definer']) {
    assert.doesNotMatch(sql, new RegExp(`GRANT\\b[^;]*\\bTO\\s+${role}`, 'i'));
    assert.match(sql, new RegExp(`REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM[^;]*${role}`));
  }
  assert.doesNotMatch(sql, /GRANT\b[^;]*\bTO\s+PUBLIC/i);

  // RLS is isolation, not business policy: no tenant rule table is consulted in a
  // policy predicate and no growing domain list is introduced here.
  const policyBodies = [...sql.matchAll(/USING \(([^)]*)\)/g)].map(match => match[1]);
  for (const body of policyBodies) {
    assert.doesNotMatch(body, /approval_policy|business_rule|posting_constraint|tax_profile|reference_values/);
  }
  assert.doesNotMatch(sql, /CHECK\s*\([^)]*\bIN\s*\(/i);
});

test('PIVOT-004 catalog: every tenant table is forced and carries isolation plus admission', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles}, async db => {
    const tables = (
      await db.adminQuery(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relkind
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND c.relkind = 'r'
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
      assert.equal(own.filter(row => row.polpermissive).length, 1, `${table} needs exactly one permissive policy`);
      assert.equal(own.filter(row => !row.polpermissive).length, 2, `${table} needs exactly two restrictive policies`);
      assert.deepEqual(
        own.map(row => row.polname).sort(),
        [`${table}_runtime_admission`, `${table}_tenant_isolation`, `${table}_tenant_scope`].sort(),
      );
      for (const row of own) {
        assert.equal(row.has_using, true, `${row.polname} needs USING`);
        assert.equal(row.has_check, true, `${row.polname} needs WITH CHECK`);
      }
      const admission = own.find(row => row.polname === `${table}_runtime_admission`);
      assert.equal(admission.roles.length, 1);
      assert.match(admission.roles[0], /_customer_app$/, `${table} admission policy must target the runtime role only`);
      assert.match(admission.using_expression, /session_admitted/);
      for (const row of own.filter(row => row.polname !== `${table}_runtime_admission`)) {
        assert.equal(row.roles.includes('PUBLIC') || row.roles.length === 0, true, `${row.polname} must be TO PUBLIC`);
        assert.match(row.using_expression, /current_tenant_id/);
      }
    }

    // Runtime roles own no tenant relation and none has BYPASSRLS.
    const runtimeOwned = (
      await db.adminQuery(
        `SELECT count(*)::int AS n
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
         WHERE n.nspname = 'tenant_data' AND r.rolname = ANY($1)`,
        [[db.roles.customerApp, db.roles.authService, db.roles.operatorRead, db.roles.operatorAdmin]],
      )
    ).rows[0].n;
    assert.equal(runtimeOwned, 0, 'runtime roles must not own tenant relations');
    const bypass = (
      await db.adminQuery(
        `SELECT count(*)::int AS n FROM pg_roles WHERE rolbypassrls AND rolname = ANY($1)`,
        [[...db.targetRoles, db.migrationLogin]],
      )
    ).rows[0].n;
    assert.equal(bypass, 0, 'no SAVEN principal may hold BYPASSRLS');

    const foreignPolicies = (
      await db.adminQuery(
        `SELECT n.nspname, count(*)::int AS n
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('auth', 'operator')
         GROUP BY n.nspname`,
      )
    ).rows;
    assert.deepEqual(foreignPolicies, [], 'auth/operator schemas receive no policy from PIVOT-004');
  });
});

test('PIVOT-004 grants: least privilege for the runtime, none for auth/operator/PUBLIC', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles}, async db => {
    const oids = Object.fromEntries(
      (
        await db.adminQuery(
          `SELECT c.relname, c.oid::int AS oid FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'tenant_data' AND c.relkind = 'r'`,
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
      assert.equal(await priv(db.roles.customerApp, table, 'TRUNCATE'), false, `${table} must not be truncatable`);
      assert.equal(await priv(db.roles.customerApp, table, 'SELECT'), true, `${table} must be readable by the runtime`);
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
    assert.equal(await priv(db.roles.customerApp, 'audit_event', 'INSERT'), false, 'audit_event is trigger-only');
    assert.equal(await priv(db.roles.customerApp, 'audit_event', 'UPDATE'), false);
    assert.equal(await priv(db.roles.customerApp, 'audit_event', 'DELETE'), false);
    assert.equal(await priv(db.roles.customerApp, 'source_store_migrations', 'INSERT'), false);
    assert.equal(await priv(db.roles.customerApp, 'command_inbox', 'UPDATE'), false);
    const columnPrivilege = async (column, privilege) => (
      await db.adminQuery('SELECT has_column_privilege($1, $2::oid, $3, $4) AS allowed', [
        db.roles.customerApp, oids.command_inbox, column, privilege,
      ])
    ).rows[0].allowed;
    assert.equal(await columnPrivilege('state', 'UPDATE'), true);
    assert.equal(await columnPrivilege('approved_by', 'UPDATE'), true);
    assert.equal(await columnPrivilege('payload', 'UPDATE'), false, 'accepted bytes are not updatable');
    assert.equal(await columnPrivilege('digest', 'UPDATE'), false);
    assert.equal(await columnPrivilege('actor', 'UPDATE'), false);

    const publicEntries = (
      await db.adminQuery(
        `SELECT c.relname, a.privilege_type
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a
         WHERE n.nspname = 'tenant_data' AND c.relkind = 'r' AND a.grantee = 0`,
      )
    ).rows;
    assert.deepEqual(publicEntries, [], 'no tenant table may be granted to PUBLIC');

    const functionAcl = (
      await db.adminQuery(
        `SELECT p.prosecdef,
                p.proconfig,
                has_function_privilege($1, p.oid, 'EXECUTE') AS customer_exec,
                has_function_privilege($2, p.oid, 'EXECUTE') AS auth_exec,
                EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_exec
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'tenant_data' AND p.proname = 'session_admitted'`,
        [db.roles.customerApp, db.roles.authService],
      )
    ).rows[0];
    assert.equal(functionAcl.prosecdef, true);
    assert.equal(functionAcl.customer_exec, true);
    assert.equal(functionAcl.auth_exec, false);
    assert.equal(functionAcl.public_exec, false);
    assert.match(functionAcl.proconfig.join(','), /search_path=pg_catalog, auth, tenant_data/);
  });
});

test('PIVOT-004 runtime: verified context isolates reads and writes, missing context denies', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles}, async db => {
    // Superuser setup bypasses RLS; the runtime behaviour below does not.
    await db.adminQuery(`
      INSERT INTO tenant_data.business(tenant_id, id, state) VALUES
        ('${T1}', 'alpha', 'ACTIVE'), ('${T2}', 'beta', 'ACTIVE');
      INSERT INTO auth.users(id, legacy_id, email, status) VALUES
        ('${U1}', 'user-1', 'u1@example.test', 'active'),
        ('${U2}', 'user-2', 'u2@example.test', 'active'),
        ('${U3}', 'user-3', 'u3@example.test', 'active');
      INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at) VALUES
        ('${T1}', '${U1}', 'ultimate_owner', 'active', now(), now()),
        ('${T2}', '${U2}', 'ultimate_owner', 'active', now(), now());
      INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES
        ('${T1}', 'user-1', '${U1}', true),
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

    const withContext = async (tenant, user, run) => db.asRole('customerApp', async client => {
      if (tenant !== undefined) await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenant]);
      if (user !== undefined) await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [user]);
      return run(client);
    });
    const counts = async (tenant, user) => withContext(tenant, user, async client => ({
      accounts: (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n,
      lines: (await client.query('SELECT count(*)::int AS n FROM tenant_data.journal_lines')).rows[0].n,
      debit: (await client.query('SELECT coalesce(sum(debit), 0)::text AS n FROM tenant_data.journal_lines')).rows[0].n,
      ownAccounts: (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T1}'`)).rows[0].n,
      foreignAccounts: (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n,
    }));

    // Positive control: an admitted principal sees exactly its own tenant.
    assert.deepEqual(await counts(T1, U1), {accounts: 2, lines: 2, debit: '100', ownAccounts: 2, foreignAccounts: 0});
    assert.deepEqual(await counts(T2, U2), {accounts: 1, lines: 2, debit: '50', ownAccounts: 0, foreignAccounts: 1});

    // Missing, empty, malformed and mismatched context all deny.
    assert.deepEqual(await counts(undefined, undefined), {accounts: 0, lines: 0, debit: '0', ownAccounts: 0, foreignAccounts: 0});
    assert.deepEqual(await counts('', U1), {accounts: 0, lines: 0, debit: '0', ownAccounts: 0, foreignAccounts: 0});
    assert.deepEqual(await counts('not-a-uuid', U1), {accounts: 0, lines: 0, debit: '0', ownAccounts: 0, foreignAccounts: 0});
    assert.deepEqual(await counts(T1, U2), {accounts: 0, lines: 0, debit: '0', ownAccounts: 0, foreignAccounts: 0});
    assert.deepEqual(await counts(T2, U1), {accounts: 0, lines: 0, debit: '0', ownAccounts: 0, foreignAccounts: 0});

    // Admission state: suspended membership, revoked membership, inactive principal,
    // inactive identity all deny even with a valid tenant/user context.
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
    assert.deepEqual(await counts(T1, U1), {accounts: 2, lines: 2, debit: '100', ownAccounts: 2, foreignAccounts: 0});

    // Writes: own tenant allowed, foreign tenant rejected by WITH CHECK, tenant-key
    // changes rejected, and append-only classes denied by privilege. Expected failures
    // use savepoints so one refusal cannot abort the rest of the verified transaction.
    await withContext(T1, U1, async client => {
      const expectRefused = async (statement, pattern, label) => {
        await client.query('SAVEPOINT pivot004_probe');
        await assert.rejects(() => client.query(statement), pattern, label);
        await client.query('ROLLBACK TO SAVEPOINT pivot004_probe');
      };

      await client.query(`INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '5000', 'New A')`);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts`)).rows[0].n, 3);
      await client.query(`UPDATE tenant_data.accounts SET title = 'Cash A2' WHERE code = '1000'`);

      await expectRefused(
        `INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T2}', '5000', 'New B')`,
        /row-level security/,
        'WITH CHECK must reject a foreign tenant_id',
      );
      await expectRefused(
        `UPDATE tenant_data.accounts SET tenant_id = '${T2}' WHERE code = '5000'`,
        /row-level security/,
        'a tenant-key change must be rejected by WITH CHECK',
      );
      assert.equal(
        (await client.query(`UPDATE tenant_data.accounts SET title = 'nope' WHERE tenant_id = '${T2}'`)).rowCount,
        0,
        'unseen foreign rows must not be updatable',
      );
      assert.equal(
        (await client.query(`DELETE FROM tenant_data.denials WHERE tenant_id = '${T1}'`)).rowCount,
        1,
        'administration rows are deletable inside the tenant',
      );
      await client.query(`INSERT INTO tenant_data.audit(tenant_id, actor, event, detail, happened_at) VALUES ('${T1}', 'user-1', 'COMMAND_ACCEPTED', '{}', 0)`);

      await expectRefused(
        `UPDATE tenant_data.journal_lines SET debit = debit`,
        /permission denied for table journal_lines/,
        'posted lines are append-only',
      );
      await expectRefused(
        `DELETE FROM tenant_data.journals`,
        /permission denied for table journals/,
        'posted journals are append-only',
      );
      await expectRefused(
        `INSERT INTO tenant_data.audit_event(tenant_id, actor_id, event, entity_type) VALUES ('${T1}', 'user-1', 'probe', 'document')`,
        /permission denied for table audit_event/,
        'audit_event is trigger-only',
      );
      await expectRefused(
        `INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES ('${T1}', 'cmd-b', 9, '1000', 5, 0)`,
        /foreign key|row-level security/,
        'a child row may not join another tenant command',
      );
      await expectRefused(
        `SELECT count(*) FROM auth.tenant_membership`,
        /permission denied for schema auth/,
        'the runtime must not read canonical auth tables',
      );
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

    // The owner is not an isolation bypass: FORCE applies to the table owner too.
    const ownerView = await db.asRole('migrator', async client => {
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [T1]);
      return {
        own: (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n,
        foreign: (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n,
      };
    });
    assert.deepEqual(ownerView, {own: 2, foreign: 0});
    await assert.rejects(
      () => db.asRole('migrator', async client => {
        await client.query('SET LOCAL row_security = off');
        await client.query('SELECT count(*) FROM tenant_data.accounts');
      }),
      /row-level security/,
      'FORCE RLS must refuse row_security=off for the owner',
    );
  });
});

test('PIVOT-004 principal mapping: exact text/UUID membership and identity binding', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles}, async db => {
    await db.adminQuery(`
      INSERT INTO auth.users(id, legacy_id, email, status) VALUES
        ('${U1}', 'user-1', 'u1@example.test', 'active'),
        ('${U2}', 'user-2', 'u2@example.test', 'active');
      INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at) VALUES
        ('${T1}', '${U1}', 'ultimate_owner', 'active', now(), now()),
        ('${T2}', '${U1}', 'ultimate_owner', 'active', now(), now()),
        ('${T2}', '${U2}', 'ultimate_owner', 'active', now(), now());
      INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES
        ('${T1}', 'user-1', '${U1}', true);
    `);

    // A mismatched legacy/UUID pair is rejected: the (user_uuid, user_id) pair must
    // exist in auth.users exactly, so a text id may not be paired with a foreign UUID.
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES ('${T3}', 'user-2', '${U1}', true)`),
      /members_canonical_(identity|membership)_fkey/,
    );
    // A dangling canonical principal is rejected by the membership FK.
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES ('${T3}', 'user-3', '${U3}', true)`),
      /members_canonical_membership_fkey/,
    );
    // Duplicate UUID projection inside one tenant is rejected.
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES ('${T1}', 'user-1-alt', '${U1}', true)`),
      /members_tenant_user_uuid_key/,
    );
    // The same canonical user may be a principal in another tenant.
    await db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES ('${T2}', 'user-1', '${U1}', true)`);
    // Renaming the canonical legacy id under bound principals is refused (RESTRICT).
    await assert.rejects(
      () => db.adminQuery(`UPDATE auth.users SET legacy_id = 'user-1-renamed' WHERE id = '${U1}'`),
      /members_canonical_identity_fkey/,
    );
    // The projection cannot be null.
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.members(tenant_id, user_id, active) VALUES ('${T1}', 'user-null', true)`),
      /null value in column "user_uuid"|not-null/,
    );
  });
});

test('PIVOT-004 resists an extra permissive policy and honours runtime role separation', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles}, async db => {
    await db.adminQuery(`
      INSERT INTO auth.users(id, legacy_id, email, status) VALUES
        ('${U1}', 'user-1', 'u1@example.test', 'active'),
        ('${U2}', 'user-2', 'u2@example.test', 'active');
      INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at) VALUES
        ('${T1}', '${U1}', 'ultimate_owner', 'active', now(), now()),
        ('${T2}', '${U2}', 'ultimate_owner', 'active', now(), now());
      INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES
        ('${T1}', 'user-1', '${U1}', true),
        ('${T2}', 'user-2', '${U2}', true);
      INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES
        ('${T1}', '1000', 'Cash A'), ('${T2}', '1000', 'Cash B');
    `);

    // Simulate a future/mistaken permissive policy: it must not widen visibility,
    // because the tenant scope is also a RESTRICTIVE policy.
    await db.asRole('migrator', client => client.query(
      `CREATE POLICY pivot004_attack ON tenant_data.accounts AS PERMISSIVE FOR ALL TO saven_customer_app USING (true) WITH CHECK (true)`,
    ), {commit: true});
    const attackView = await db.asRole('customerApp', async client => {
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [T1]);
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [U1]);
      const own = (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n;
      const foreign = (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n;
      return {own, foreign};
    });
    assert.deepEqual(attackView, {own: 1, foreign: 0}, 'an extra permissive policy must not cross tenants');
    const attackNoAdmission = await db.asRole('customerApp', async client => {
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [T1]);
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [U2]);
      return (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n;
    });
    assert.equal(attackNoAdmission, 0, 'an extra permissive policy must not bypass admission');
    await db.asRole('migrator', client => client.query('DROP POLICY pivot004_attack ON tenant_data.accounts'), {commit: true});

    // Runtime role separation: operator and auth principals cannot reach tenant rows,
    // and the customer app cannot perform DDL.
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
