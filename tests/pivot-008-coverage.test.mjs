import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withPivotDatabase} from './helpers/pg-pivot-fixture.mjs';

const repoRoot = new URL('../', import.meta.url);
const coveragePath = fileURLToPath(new URL('db/postgres/99-ci-rls-coverage.sql', repoRoot));
const verifyPath = fileURLToPath(new URL('scripts/verify-pg-rls.mjs', repoRoot));
const checkPath = fileURLToPath(new URL('scripts/check.mjs', repoRoot));
const workflowPath = fileURLToPath(new URL('.github/workflows/postgres-pivot.yml', repoRoot));

const stack = {
  sqlFiles: [
    'db/postgres/05-auth-schema.sql',
    'db/postgres/migrations/006-auth-schema-corrections.sql',
    'db/postgres/10-operator-schema.sql',
    'db/postgres/20-tenant-schema.sql',
    'db/postgres/migrations/021-tenant-schema-corrections.sql',
    'db/postgres/30-rls-policies.sql',
    'db/postgres/migrations/040-posted-immutability.sql',
  ],
  adminSqlFiles: [
    'db/postgres/migrations/031-rls-corrections.sql',
    'db/postgres/migrations/032-rls-hardening.sql',
    'db/postgres/migrations/033-membership-admission-lock.sql',
    'db/postgres/06-operator-identity.sql',
    'db/postgres/migrations/041-audit.sql',
    'db/postgres/migrations/042-entry-voiding.sql',
    'db/postgres/40-triggers.sql',
    'db/postgres/50-functions.sql',
  ],
};

const coverageSql = await readFile(coveragePath, 'utf8');
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function quoteRole(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

const env = () => ({...process.env, SAVEN_PIVOT_TEST_CLUSTER: '1'});
const runCli = (args, extraEnv = {}) => spawnSync(
  process.execPath,
  [verifyPath, ...args],
  {encoding: 'utf8', env: {...env(), ...extraEnv}},
);
const runCheck = (extraEnv = {}) => spawnSync(
  process.execPath,
  [checkPath, '--postgres'],
  {encoding: 'utf8', env: {...env(), ...extraEnv}},
);

async function coverage(db) {
  return (await db.adminQuery(coverageSql)).rows;
}

async function probe(db, statements) {
  await db.adminQuery('BEGIN');
  try {
    for (const statement of statements) await db.adminQuery(statement);
    return await coverage(db);
  } finally {
    await db.adminQuery('ROLLBACK');
  }
}

const has = (rows, kind) => rows.some(row => row.kind === kind);
const kinds = rows => [...new Set(rows.map(row => row.kind))].join(', ');

async function seedTwoTenants(db) {
  // Replica role disables fixture-side triggers for setup only; the gate never does
  // this. Context/audit behavior is exercised through the real runtime login below.
  await db.adminQuery(`
    BEGIN;
    SET LOCAL session_replication_role = replica;
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
    INSERT INTO tenant_data.denials(tenant_id, user_id, action) VALUES
      ('${T1}', 'user-1', 'journal.post'), ('${T2}', 'user-2', 'journal.post');
    COMMIT;
  `);
}

const asUser = (db, tenant, user, run, options = {}) => db.asRole('customerApp', async client => {
  if (tenant !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenant]);
  if (user !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', user]);
  return run(client);
}, options);

test('PIVOT-008 static contract: manifest, effective checks and fail-closed runner wiring', async () => {
  const stripped = coverageSql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  const withoutStrings = stripped.replace(/'(?:[^']|'')*'/g, "''");
  assert.equal((withoutStrings.match(/;/g) ?? []).length, 1, 'the coverage gate must be one read-only statement');
  assert.match(stripped.trimStart(), /^WITH RECURSIVE\b/);
  assert.doesNotMatch(stripped, /^\s*(?:GRANT|REVOKE|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);

  for (const kind of [
    'MISSING_REQUIRED_SCHEMA', 'MISSING_REQUIRED_ROLE', 'MISSING_REQUIRED_RELATION',
    'MISSING_REQUIRED_SEQUENCE', 'MISSING_REQUIRED_FUNCTION', 'MISSING_REQUIRED_TRIGGER',
    'MISSING_REQUIRED_COLUMN', 'MISSING_REQUIRED_CONSTRAINT',
    'AUTHORITY_HELPER_INVALID', 'PROTOCOL_VALIDATOR_INVALID',
    'MISSING_ENABLE_RLS', 'MISSING_FORCE_RLS', 'MISSING_POLICY',
    'POLICY_OPERATION_GAP', 'RUNTIME_ADMISSION_GAP', 'POLICY_EXPRESSION_MISMATCH',
    'UNEXPECTED_POLICY',
    'AUTH_MEMBERSHIP_MISSING_ENABLE_RLS', 'AUTH_MEMBERSHIP_MISSING_FORCE_RLS',
    'AUTH_MEMBERSHIP_UNAUTHORIZED_WRITE_POLICY', 'AUTH_MEMBERSHIP_POLICY_GAP',
    'AUTH_MEMBERSHIP_POLICY_INVALID',
    'REQUIRED_OBJECT_KIND_MISMATCH', 'INSTALLATION_BINDING_MISMATCH',
    'RUNTIME_SCHEMA_CREATE', 'RUNTIME_SCHEMA_PRIVILEGE', 'LOGIN_DIRECT_SCHEMA_PRIVILEGE',
    'PUBLIC_SCHEMA_PRIVILEGE', 'SCHEMA_OWNERSHIP_MISMATCH',
    'ROLE_SWITCH_TO_PRIVILEGED_CAPABILITY', 'DEFINER_OWNER_PRIVILEGE_MISSING',
    'DEFINER_OWNER_SCHEMA_PRIVILEGE',
    'UNSAFE_VIEW_PATH', 'UNSAFE_VIEW_OWNER', 'UNSAFE_MATERIALIZED_VIEW',
    'UNSAFE_PARTITION_PATH', 'UNSAFE_PARTITION_WRITE_PATH',
    'UNSAFE_FUNCTION_OWNER', 'UNSAFE_FUNCTION_SEARCH_PATH', 'UNSAFE_FUNCTION_PUBLIC_EXECUTE',
    'UNSAFE_FUNCTION_RUNTIME_ASSUMPTION', 'UNSAFE_FUNCTION_ROW_SECURITY',
    'FORBIDDEN_RUNTIME_EXECUTE', 'MISSING_REQUIRED_EXECUTE', 'DEFINER_OWNER_EXCESS_AUTHORITY',
    'CUSTOMER_CROSS_SCHEMA_PRIVILEGE', 'AUTH_SERVICE_TENANT_PRIVILEGE',
    'OPERATOR_TENANT_PRIVILEGE', 'OPERATOR_AUTH_PRIVILEGE', 'FORBIDDEN_RUNTIME_PRIVILEGE',
    'LOGIN_DIRECT_COVERED_PRIVILEGE', 'RUNTIME_ASSUMES_PRIVILEGED_ROLE',
    'CROSS_CLASS_ROLE_SWITCH', 'UNKNOWN_PRIVILEGED_PRINCIPAL', 'SAVEN_BYPASS_OR_SUPER',
    'PUBLIC_RELATION_PRIVILEGE', 'PUBLIC_COLUMN_PRIVILEGE',
  ]) {
    assert.match(coverageSql, new RegExp(`'${kind}'`), `${kind} must be part of the gate`);
  }

  const check = await readFile(checkPath, 'utf8');
  assert.match(check, /--postgres/);
  assert.match(check, /scripts\/verify-pg-rls\.mjs/);

  const verify = await readFile(verifyPath, 'utf8');
  assert.match(verify, /SAVEN_PIVOT_TEST_CLUSTER !== '1'/);
  assert.match(verify, /confirmedOwner/);
  assert.match(verify, /42P04/);
  assert.match(verify, /RESIDUE/);
  assert.match(verify, /PROTOCOL_PROBE_FAILED/);
  assert.match(verify, /operator\.assert_read_authority_protocol/);
  assert.match(verify, /assert_operator_definer_authority/);

  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /image: postgres:18/);
  assert.match(workflow, /node scripts\/check\.mjs --postgres/);
  assert.match(workflow, /node --test tests\/pivot-008-coverage\.test\.mjs/);
  assert.doesNotMatch(workflow, /continue-on-error|if:\s*false|\|\|\s*true/);
});

test('PIVOT-008 installed surface: complete stack passes, empty or single-missing installs fail via CLI', async () => {
  await withPivotDatabase(stack, async db => {
    const surface = (
      await db.adminQuery(`
        SELECT
          (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'tenant_data' AND c.relkind IN ('r', 'p')) AS tenant_tables,
          (SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'tenant_data') AS tenant_policies,
          (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN ('tenant_data', 'auth', 'operator') AND p.prosecdef) AS definer_functions
      `)
    ).rows[0];
    assert.ok(surface.tenant_tables >= 49 && surface.tenant_policies >= surface.tenant_tables * 3);
    assert.ok(surface.definer_functions >= 7);
    assert.deepEqual(await coverage(db), []);

    const healthy = runCli(['--database', db.database]);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.match(healthy.stdout, /installed authority protocol accepted/);

    const emptyName = `p8_empty_${db.suffix}`;
    await db.adminQuery(`CREATE DATABASE ${quoteRole(emptyName)}`);
    try {
      const empty = runCli(['--database', emptyName]);
      assert.notEqual(empty.status, 0);
      assert.match(empty.stderr, /MISSING_REQUIRED_SCHEMA|MISSING_REQUIRED_ROLE|MISSING_REQUIRED_RELATION/);
    } finally {
      await db.adminQuery(`DROP DATABASE IF EXISTS ${quoteRole(emptyName)} WITH (FORCE)`);
    }

    // One missing relation, role and function must each fail specifically.
    await db.adminQuery('ALTER TABLE tenant_data.warehouses RENAME TO warehouses_p8_missing');
    try {
      const missing = runCli(['--database', db.database]);
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /MISSING_REQUIRED_RELATION tenant_data\.warehouses/);
    } finally {
      await db.adminQuery('ALTER TABLE tenant_data.warehouses_p8_missing RENAME TO warehouses');
    }

    const authDefiner = db.roles.authDefiner;
    await db.adminQuery(`ALTER ROLE ${quoteRole(authDefiner)} RENAME TO ${quoteRole(`${authDefiner}_p8_missing`)}`);
    try {
      const missing = runCli(['--database', db.database]);
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /MISSING_REQUIRED_ROLE/);
    } finally {
      await db.adminQuery(`ALTER ROLE ${quoteRole(`${authDefiner}_p8_missing`)} RENAME TO ${quoteRole(authDefiner)}`);
    }

    await db.adminQuery('ALTER FUNCTION tenant_data.current_user_id() RENAME TO current_user_id_p8_missing');
    try {
      const missing = runCli(['--database', db.database]);
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /MISSING_REQUIRED_FUNCTION tenant_data\.current_user_id\(\)/);
    } finally {
      await db.adminQuery('ALTER FUNCTION tenant_data.current_user_id_p8_missing() RENAME TO current_user_id');
    }

    // The manifest enforces the declared kind, not mere name existence.
    await db.adminQuery('ALTER TABLE tenant_data.warehouses RENAME TO warehouses_p8_kind');
    await db.adminQuery('CREATE VIEW tenant_data.warehouses AS SELECT 1 AS id');
    try {
      const mismatch = runCli(['--database', db.database]);
      assert.notEqual(mismatch.status, 0);
      assert.match(mismatch.stderr, /REQUIRED_OBJECT_KIND_MISMATCH tenant_data\.warehouses/);
    } finally {
      await db.adminQuery('DROP VIEW tenant_data.warehouses');
      await db.adminQuery('ALTER TABLE tenant_data.warehouses_p8_kind RENAME TO warehouses');
    }

    // A conflicting installed program must not satisfy the reviewed checksum.
    const originalDefinition = (
      await db.adminQuery("SELECT pg_get_functiondef('tenant_data.current_user_id()'::regprocedure) AS definition")
    ).rows[0].definition;
    await db.asRole('migrator', client => client.query(
      `CREATE OR REPLACE FUNCTION tenant_data.current_user_id() RETURNS uuid
         LANGUAGE sql STABLE SET search_path = pg_catalog
         AS $fn$ SELECT NULL::uuid $fn$`,
    ), {commit: true});
    try {
      const checksum = runCli(['--database', db.database]);
      assert.notEqual(checksum.status, 0);
      assert.match(checksum.stderr, /INSTALLATION_BINDING_MISMATCH tenant_data\.current_user_id\(\)/);
    } finally {
      await db.adminQuery(originalDefinition);
    }

    assert.deepEqual(await coverage(db), []);
    assert.equal(runCli(['--database', db.database]).status, 0);
  });
});

test('PIVOT-008 effective isolation: per-command catalog gaps and real restricted-login behavior', async () => {
  await withPivotDatabase(stack, async db => {
    await seedTwoTenants(db);

    // Catalog: a SELECT-only restrictive policy leaves INSERT/UPDATE/DELETE uncovered.
    const selective = await probe(db, [
      'DROP POLICY accounts_tenant_scope ON tenant_data.accounts',
      'DROP POLICY accounts_runtime_admission ON tenant_data.accounts',
      `CREATE POLICY accounts_tenant_scope ON tenant_data.accounts AS RESTRICTIVE FOR SELECT TO PUBLIC
         USING (tenant_id = tenant_data.current_tenant_id())`,
    ]);
    assert.ok(has(selective, 'POLICY_OPERATION_GAP'), kinds(selective));
    assert.ok(rowsContain(selective, 'POLICY_OPERATION_GAP', /accounts:a:restrictive/), kinds(selective));

    // Missing membership preselection/restrictive partners are also explicit.
    const membershipGap = await probe(db, [
      'DROP POLICY tenant_membership_preselect ON auth.tenant_membership',
      'DROP POLICY tenant_membership_preselect_scope ON auth.tenant_membership',
    ]);
    assert.ok(rowsContain(membershipGap, 'AUTH_MEMBERSHIP_POLICY_GAP', /auth\.tenant_membership:tenant_membership_preselect/), kinds(membershipGap));

    // An added permissive policy is outside the exact reviewed contract, and the
    // accepted restrictive partner still prevents it from widening real runtime reads.
    const widening = await probe(db, [
      'CREATE POLICY p8_widen ON tenant_data.accounts AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true)',
    ]);
    assert.ok(rowsContain(widening, 'UNEXPECTED_POLICY', /accounts\.p8_widen/), kinds(widening));
    await db.adminQuery(
      'CREATE POLICY p8_widen ON tenant_data.accounts AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true)',
    );
    try {
      assert.equal(
        await asUser(db, T1, U1, async client =>
          (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n),
        0,
        'a widening permissive policy cannot bypass the restrictive partner',
      );
    } finally {
      await db.adminQuery('DROP POLICY p8_widen ON tenant_data.accounts');
    }

    // Real customer login: own tenant works, foreign and missing context fail.
    const counts = await asUser(db, T1, U1, async client => ({
      own: (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n,
      foreign: (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n,
    }));
    assert.deepEqual(counts, {own: 2, foreign: 0});
    assert.deepEqual(
      await asUser(db, undefined, undefined, async client =>
        (await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')).rows[0].n),
      0,
    );

    await asUser(db, T1, U1, client => client.query(
      `INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '5000', 'New A')`,
    ), {commit: true});
    await asUser(db, T1, U1, client => client.query(
      `UPDATE tenant_data.accounts SET title = 'Cash A2' WHERE code = '1000'`,
    ), {commit: true});
    assert.equal(
      await asUser(db, T1, U1, async client => (await client.query(
        `DELETE FROM tenant_data.denials WHERE tenant_id = '${T1}'`,
      )).rowCount, {commit: true}),
      1,
    );
    await assert.rejects(
      () => asUser(db, T1, U1, client => client.query(
        `INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T2}', '5000', 'New B')`,
      ), {commit: true}),
      /row-level security/,
    );
    assert.equal(
      await asUser(db, T1, U1, async client => (await client.query(
        `UPDATE tenant_data.accounts SET title = 'nope' WHERE tenant_id = '${T2}'`,
      )).rowCount, {commit: true}),
      0,
    );
    assert.equal(
      await asUser(db, T1, U1, async client => (await client.query(
        `DELETE FROM tenant_data.denials WHERE tenant_id = '${T2}'`,
      )).rowCount, {commit: true}),
      0,
    );
    assert.equal(
      (await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n,
      1,
      'denied mutations must retain the foreign account row',
    );
    assert.equal(
      (await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.denials WHERE tenant_id = '${T2}'`)).rows[0].n,
      1,
      'denied delete must retain the foreign denial row',
    );

    // Membership preselection keeps the accepted principal-bound semantics.
    const preselection = await db.asRole('authService', async client => {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', U1]);
      const own = (await client.query('SELECT tenant_id::text FROM auth.tenant_membership ORDER BY tenant_id')).rows;
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', U3]);
      const other = (await client.query('SELECT count(*)::int AS n FROM auth.tenant_membership')).rows[0].n;
      return {own, other};
    });
    assert.deepEqual(preselection.own, [{tenant_id: T1}, {tenant_id: T2}]);
    assert.equal(preselection.other, 0);
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status) VALUES ('${T1}', '${U3}', 'member', 'invited')`,
      ), {commit: true}),
      /row-level security/,
    );

    // The restrictive guard is load-bearing: a nonliteral always-true predicate that
    // still mentions tenant_id/current_tenant_id is invisible to catalog shape checks,
    // but the real login immediately sees foreign rows. Restore and prove green.
    const customer = quoteRole(db.roles.customerApp);
    const alwaysTrue = `tenant_id = tenant_id AND tenant_data.current_tenant_id() IS NOT NULL`;
    try {
      await db.adminQuery(`
        DROP POLICY accounts_tenant_isolation ON tenant_data.accounts;
        DROP POLICY accounts_tenant_scope ON tenant_data.accounts;
        DROP POLICY accounts_runtime_admission ON tenant_data.accounts;
        CREATE POLICY p8_isolation ON tenant_data.accounts AS PERMISSIVE FOR ALL TO PUBLIC
          USING (${alwaysTrue}) WITH CHECK (${alwaysTrue});
        CREATE POLICY p8_scope ON tenant_data.accounts AS RESTRICTIVE FOR ALL TO PUBLIC
          USING (${alwaysTrue}) WITH CHECK (${alwaysTrue});
        CREATE POLICY p8_admission ON tenant_data.accounts AS RESTRICTIVE FOR ALL TO ${customer}
          USING (${alwaysTrue} AND tenant_data.session_admitted(tenant_data.current_tenant_id(), tenant_data.current_user_id()))
          WITH CHECK (${alwaysTrue} AND tenant_data.session_admitted(tenant_data.current_tenant_id(), tenant_data.current_user_id()));
      `);
      const leaked = await asUser(db, T1, U1, async client =>
        (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n);
      assert.equal(leaked, 1, 'the behavioral probe demonstrates the widened predicate');
      // The actual target gate must refuse the weakened installation; this is the
      // required red/green proof, not the expected-leak demonstration alone.
      const refused = runCli(['--database', db.database]);
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /POLICY_OPERATION_GAP|POLICY_EXPRESSION_MISMATCH|UNEXPECTED_POLICY/);
    } finally {
      await db.adminQuery(`
        DROP POLICY IF EXISTS p8_isolation ON tenant_data.accounts;
        DROP POLICY IF EXISTS p8_scope ON tenant_data.accounts;
        DROP POLICY IF EXISTS p8_admission ON tenant_data.accounts;
        CREATE POLICY accounts_tenant_isolation ON tenant_data.accounts AS PERMISSIVE FOR ALL TO PUBLIC
          USING (tenant_id = tenant_data.current_tenant_id())
          WITH CHECK (tenant_id = tenant_data.current_tenant_id());
        CREATE POLICY accounts_tenant_scope ON tenant_data.accounts AS RESTRICTIVE FOR ALL TO PUBLIC
          USING (tenant_id = tenant_data.current_tenant_id())
          WITH CHECK (tenant_id = tenant_data.current_tenant_id());
        CREATE POLICY accounts_runtime_admission ON tenant_data.accounts AS RESTRICTIVE FOR ALL TO ${customer}
          USING (tenant_id = tenant_data.current_tenant_id()
                 AND tenant_data.session_admitted(tenant_data.current_tenant_id(), tenant_data.current_user_id()))
          WITH CHECK (tenant_id = tenant_data.current_tenant_id()
                 AND tenant_data.session_admitted(tenant_data.current_tenant_id(), tenant_data.current_user_id()));
      `);
    }
    assert.equal(
      await asUser(db, T1, U1, async client =>
        (await client.query(`SELECT count(*)::int AS n FROM tenant_data.accounts WHERE tenant_id = '${T2}'`)).rows[0].n),
      0,
      'restoring the accepted guard restores isolation',
    );
    assert.deepEqual(await coverage(db), []);
    assert.equal(runCli(['--database', db.database]).status, 0);
  });
});

function rowsContain(rows, kind, pattern) {
  return rows.some(row => row.kind === kind && pattern.test(row.object));
}

test('PIVOT-008 effective authority: column ACLs, operator/auth boundary, EXECUTE allow-list and logins', async () => {
  await withPivotDatabase(stack, async db => {
    const customer = quoteRole(db.roles.customerApp);
    const operatorRead = quoteRole(db.roles.operatorRead);
    const authService = quoteRole(db.roles.authService);

    const columnCases = [
      {
        name: 'operator column read on tenant data',
        statements: [`GRANT SELECT (code) ON tenant_data.accounts TO ${operatorRead}`],
        kind: 'OPERATOR_TENANT_PRIVILEGE',
      },
      {
        name: 'operator column read on auth users',
        statements: [`GRANT SELECT (email) ON auth.users TO ${operatorRead}`],
        kind: 'OPERATOR_AUTH_PRIVILEGE',
      },
      {
        name: 'customer column read on auth membership',
        statements: [`GRANT SELECT (tenant_id) ON auth.tenant_membership TO ${customer}`],
        kind: 'CUSTOMER_CROSS_SCHEMA_PRIVILEGE',
      },
      {
        name: 'auth service column read on tenant data',
        statements: [`GRANT SELECT (code) ON tenant_data.accounts TO ${authService}`],
        kind: 'AUTH_SERVICE_TENANT_PRIVILEGE',
      },
      {
        name: 'runtime extra EXECUTE',
        statements: ['GRANT EXECUTE ON FUNCTION operator.assert_read_authority_protocol() TO ' + customer],
        kind: 'FORBIDDEN_RUNTIME_EXECUTE',
      },
      {
        name: 'wrong-service function grant',
        statements: [`GRANT EXECUTE ON FUNCTION tenant_data.current_user_id() TO ${operatorRead}`],
        kind: 'FORBIDDEN_RUNTIME_EXECUTE',
      },
      {
        name: 'runtime missing required EXECUTE',
        statements: ['REVOKE EXECUTE ON FUNCTION tenant_data.current_user_id() FROM ' + customer],
        kind: 'MISSING_REQUIRED_EXECUTE',
      },
      {
        name: 'runtime assumes definer',
        statements: [`GRANT ${quoteRole(db.roles.operatorDefiner)} TO ${customer}`],
        kind: 'RUNTIME_ASSUMES_PRIVILEGED_ROLE',
      },
      {
        name: 'runtime assumes another class',
        statements: [`GRANT ${operatorRead} TO ${customer}`],
        kind: 'CROSS_CLASS_ROLE_SWITCH',
      },
      {
        name: 'arbitrary privileged principal',
        statements: [
          'CREATE ROLE p8_arbitrary_admin NOLOGIN',
          'GRANT SELECT ON tenant_data.accounts TO p8_arbitrary_admin',
        ],
        kind: 'UNKNOWN_PRIVILEGED_PRINCIPAL',
      },
      {
        name: 'runtime schema CREATE',
        statements: [`GRANT CREATE ON SCHEMA tenant_data TO ${customer}`],
        kind: 'RUNTIME_SCHEMA_CREATE',
      },
      {
        name: 'runtime extra schema usage',
        statements: [`GRANT USAGE ON SCHEMA auth TO ${customer}`],
        kind: 'RUNTIME_SCHEMA_PRIVILEGE',
      },
      {
        name: 'capability-based role switch',
        statements: [
          'CREATE ROLE p8_capability_target NOLOGIN BYPASSRLS',
          `GRANT p8_capability_target TO ${customer}`,
        ],
        kind: 'ROLE_SWITCH_TO_PRIVILEGED_CAPABILITY',
      },
      {
        name: 'external-schema definer',
        statements: [
          `CREATE FUNCTION public.p8_external_definer() RETURNS integer LANGUAGE sql
             SECURITY DEFINER SET search_path = pg_catalog AS 'SELECT 1'`,
          `ALTER FUNCTION public.p8_external_definer() OWNER TO ${quoteRole(db.roles.auditDefiner)}`,
          `GRANT EXECUTE ON FUNCTION public.p8_external_definer() TO ${customer}`,
        ],
        kind: 'FORBIDDEN_RUNTIME_EXECUTE',
      },
    ];

    for (const item of columnCases) {
      const rows = await probe(db, item.statements);
      assert.ok(has(rows, item.kind), `${item.name} must report ${item.kind}; got ${kinds(rows)}`);
    }

    // Login role: direct covered privilege and cross-authority are separate findings.
    const loginRows = await probe(db, [
      'CREATE ROLE p8_runtime_login LOGIN NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOBYPASSRLS',
      `GRANT ${customer} TO p8_runtime_login`,
      'GRANT SELECT ON tenant_data.accounts TO p8_runtime_login',
    ]);
    assert.ok(has(loginRows, 'LOGIN_DIRECT_COVERED_PRIVILEGE'), kinds(loginRows));
    assert.ok(!has(loginRows, 'FORBIDDEN_LOGIN_EXECUTE'), 'membership-derived EXECUTE is intended, not a direct grant');

    const elevated = await probe(db, [
      'CREATE ROLE p8_elevated_login LOGIN SUPERUSER',
      `GRANT ${customer} TO p8_elevated_login`,
    ]);
    assert.ok(rowsContain(elevated, 'LOGIN_ROLE_ATTRIBUTE', /p8_elevated_login/), kinds(elevated));
    assert.ok(
      !elevated.some(row => row.kind === 'UNKNOWN_PRIVILEGED_PRINCIPAL' && row.object === process.env.PGUSER),
      'an unrelated offline administrator is not rejected merely for existing',
    );
  });
});

test('PIVOT-008 transitive paths, default ACLs, owner excess and installed authority protocol', async () => {
  await withPivotDatabase(stack, async db => {
    const customer = quoteRole(db.roles.customerApp);

    const viewRows = await probe(db, [
      'CREATE VIEW public.p8_inner AS SELECT * FROM tenant_data.accounts',
      'CREATE VIEW public.p8_outer AS SELECT * FROM public.p8_inner',
      `GRANT SELECT ON public.p8_outer TO ${customer}`,
    ]);
    assert.ok(rowsContain(viewRows, 'UNSAFE_VIEW_OWNER', /public\.p8_outer/), kinds(viewRows));

    const columnViewRows = await probe(db, [
      'CREATE VIEW public.p8_col_inner AS SELECT * FROM tenant_data.accounts',
      'CREATE VIEW public.p8_col_outer AS SELECT * FROM public.p8_col_inner',
      `GRANT SELECT (code) ON public.p8_col_outer TO ${customer}`,
    ]);
    assert.ok(rowsContain(columnViewRows, 'UNSAFE_VIEW_OWNER', /public\.p8_col_outer/), kinds(columnViewRows));

    const matviewRows = await probe(db, [
      'CREATE MATERIALIZED VIEW public.p8_mat AS SELECT * FROM tenant_data.accounts',
      'CREATE VIEW public.p8_mat_outer AS SELECT * FROM public.p8_mat',
      `GRANT SELECT ON public.p8_mat_outer TO ${customer}`,
    ]);
    assert.ok(rowsContain(matviewRows, 'UNSAFE_MATERIALIZED_VIEW', /public\.p8_mat/), kinds(matviewRows));

    const childRows = await probe(db, [
      'CREATE TABLE public.p8_child1 () INHERITS (tenant_data.accounts)',
      'CREATE TABLE public.p8_child2 () INHERITS (public.p8_child1)',
      `GRANT SELECT (code) ON public.p8_child2 TO ${customer}`,
    ]);
    assert.ok(rowsContain(childRows, 'UNSAFE_PARTITION_PATH', /public\.p8_child2/), kinds(childRows));

    const writeChildRows = await probe(db, [
      'CREATE TABLE public.p8_write_child () INHERITS (tenant_data.accounts)',
      `GRANT INSERT ON public.p8_write_child TO ${customer}`,
    ]);
    assert.ok(rowsContain(writeChildRows, 'UNSAFE_PARTITION_WRITE_PATH', /public\.p8_write_child:INSERT/), kinds(writeChildRows));

    const writeColumnChildRows = await probe(db, [
      'CREATE TABLE public.p8_write_col_child () INHERITS (tenant_data.accounts)',
      `GRANT INSERT (code) ON public.p8_write_col_child TO ${customer}`,
    ]);
    assert.ok(
      rowsContain(writeColumnChildRows, 'UNSAFE_PARTITION_WRITE_PATH', /public\.p8_write_col_child:INSERT/),
      kinds(writeColumnChildRows),
    );

    const mixedOwnerRows = await probe(db, [
      'CREATE VIEW public.p8_mixed_inner AS SELECT * FROM tenant_data.accounts',
      `GRANT SELECT ON public.p8_mixed_inner TO ${quoteRole(db.roles.migrator)}`,
      'CREATE VIEW public.p8_mixed_outer AS SELECT * FROM public.p8_mixed_inner',
      `ALTER VIEW public.p8_mixed_outer OWNER TO ${quoteRole(db.roles.migrator)}`,
      `GRANT SELECT ON public.p8_mixed_outer TO ${customer}`,
    ]);
    assert.ok(rowsContain(mixedOwnerRows, 'UNSAFE_VIEW_PATH', /public\.p8_mixed_inner/), kinds(mixedOwnerRows));
    assert.ok(rowsContain(mixedOwnerRows, 'UNSAFE_VIEW_PATH', /public\.p8_mixed_outer/), kinds(mixedOwnerRows));

    // A constrained security-invoker view owned by the migrator is a safe path.
    const safeRows = await probe(db, [
      'SET LOCAL ROLE ' + quoteRole(db.roles.migrator),
      `CREATE VIEW tenant_data.p8_safe WITH (security_invoker = true) AS SELECT * FROM tenant_data.accounts`,
      'RESET ROLE',
      `GRANT SELECT ON tenant_data.p8_safe TO ${customer}`,
    ]);
    assert.deepEqual(safeRows, [], kinds(safeRows));

    // NULL function ACL means PostgreSQL's default PUBLIC EXECUTE.
    const nullAclRows = await probe(db, [
      'SET LOCAL ROLE ' + quoteRole(db.roles.migrator),
      `CREATE FUNCTION tenant_data.p8_null_acl() RETURNS integer LANGUAGE sql SECURITY DEFINER
         SET search_path = pg_catalog AS 'SELECT 1'`,
      'RESET ROLE',
    ]);
    assert.ok(has(nullAclRows, 'UNSAFE_FUNCTION_PUBLIC_EXECUTE'), kinds(nullAclRows));

    // Widened definer owner authority is not hidden by NOLOGIN/no-BYPASS flags.
    const ownerRows = await probe(db, [`GRANT SELECT ON tenant_data.trade_documents TO ${quoteRole(db.roles.operatorDefiner)}`]);
    assert.ok(has(ownerRows, 'DEFINER_OWNER_EXCESS_AUTHORITY'), kinds(ownerRows));

    const ownerColumnRows = await probe(db, [
      `GRANT UPDATE (detail_jsonb) ON tenant_data.audit_event TO ${quoteRole(db.roles.auditDefiner)}`,
    ]);
    assert.ok(has(ownerColumnRows, 'DEFINER_OWNER_EXCESS_AUTHORITY'), kinds(ownerColumnRows));

    const ownerMissingRows = await probe(db, [
      `REVOKE SELECT (code) ON tenant_data.accounts FROM ${quoteRole(db.roles.operatorDefiner)}`,
    ]);
    assert.ok(has(ownerMissingRows, 'DEFINER_OWNER_PRIVILEGE_MISSING'), kinds(ownerMissingRows));

    const ownerFunctionRows = await probe(db, [
      `CREATE FUNCTION public.p8_owned_by_auth() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
      `ALTER FUNCTION public.p8_owned_by_auth() OWNER TO ${quoteRole(db.roles.authDefiner)}`,
    ]);
    assert.ok(rowsContain(ownerFunctionRows, 'DEFINER_OWNER_EXCESS_AUTHORITY', /p8_owned_by_auth/), kinds(ownerFunctionRows));

    // Disabled, replica-only and reprofiled authority gates turn coverage red.
    const disabledRows = await probe(db, [
      'ALTER TABLE auth.tenant_membership DISABLE TRIGGER tenant_membership_authority_gate_insert',
    ]);
    assert.ok(rowsContain(disabledRows, 'MISSING_REQUIRED_TRIGGER', /tenant_membership_authority_gate_insert/), kinds(disabledRows));

    const replicaRows = await probe(db, [
      'ALTER TABLE operator.access_read_policy ENABLE REPLICA TRIGGER access_read_policy_policy_gate_update',
    ]);
    assert.ok(rowsContain(replicaRows, 'MISSING_REQUIRED_TRIGGER', /access_read_policy_policy_gate_update/), kinds(replicaRows));

    const misboundRows = await probe(db, [
      'DROP TRIGGER tenant_membership_authority_gate_delete ON auth.tenant_membership',
      'CREATE TRIGGER tenant_membership_authority_gate_delete BEFORE DELETE ON auth.tenant_membership FOR EACH STATEMENT EXECUTE FUNCTION operator.lock_consent_gate()',
    ]);
    assert.ok(rowsContain(misboundRows, 'MISSING_REQUIRED_TRIGGER', /tenant_membership_authority_gate_delete/), kinds(misboundRows));

    const helperRows = await probe(db, [
      'ALTER FUNCTION auth.lock_authority_gate() SET search_path = pg_catalog, public',
    ]);
    assert.ok(has(helperRows, 'AUTHORITY_HELPER_INVALID'), kinds(helperRows));

    // The accepted validators are what the runner executes; a disabled gate must make
    // the CLI probe fail, not just a catalog row.
    await db.adminQuery('ALTER TABLE auth.tenant_membership DISABLE TRIGGER tenant_membership_authority_gate_insert');
    try {
      const cli = runCli(['--database', db.database]);
      assert.notEqual(cli.status, 0);
      assert.match(cli.stderr, /PROTOCOL_PROBE_FAILED operator\.assert_read_authority_protocol/);
    } finally {
      await db.adminQuery('ALTER TABLE auth.tenant_membership ENABLE TRIGGER tenant_membership_authority_gate_insert');
    }
    assert.equal(runCli(['--database', db.database]).status, 0);
  });
});

test('PIVOT-008 runner failure paths: ownership-tracked cleanup, collision, residue and fail-closed', async () => {
  await withPivotDatabase(stack, async db => {
    const healthy = runCli(['--database', db.database]);
    assert.equal(healthy.status, 0, healthy.stderr);

    await db.adminQuery('ALTER TABLE tenant_data.accounts NO FORCE ROW LEVEL SECURITY');
    try {
      const broken = runCli(['--database', db.database]);
      assert.equal(broken.status, 1);
      assert.match(broken.stderr, /MISSING_FORCE_RLS tenant_data\.accounts/);
    } finally {
      await db.adminQuery('ALTER TABLE tenant_data.accounts FORCE ROW LEVEL SECURITY');
    }

    // Deterministic pre-existing name: never reused and never dropped.
    const collision = `p8_collision_${db.suffix}`;
    await db.adminQuery(`CREATE DATABASE ${quoteRole(collision)}`);
    try {
      const result = runCli(['--temporary-name', collision]);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /already exists; refusing to reuse or drop/);
      assert.equal(
        (await db.adminQuery('SELECT count(*)::int AS n FROM pg_database WHERE datname = $1', [collision])).rows[0].n,
        1,
      );
    } finally {
      await db.adminQuery(`DROP DATABASE IF EXISTS ${quoteRole(collision)} WITH (FORCE)`);
    }

    // Post-CREATE failure still drops the database this run confirmed it created.
    const injected = `p8_injected_${db.suffix}`;
    const afterCreate = runCli(['--temporary-name', injected, '--inject-failure-after-create']);
    assert.equal(afterCreate.status, 1);
    assert.equal(
      (await db.adminQuery('SELECT count(*)::int AS n FROM pg_database WHERE datname = $1', [injected])).rows[0].n,
      0,
    );

    // Cleanup failure preserves the target in evidence and leaves it for the operator.
    const residue = `p8_residue_${db.suffix}`;
    try {
      const dropFailure = runCli(['--temporary-name', residue, '--inject-drop-failure']);
      assert.equal(dropFailure.status, 1);
      assert.match(dropFailure.stderr, new RegExp(`RESIDUE:.*${residue}`));
      assert.equal(
        (await db.adminQuery('SELECT count(*)::int AS n FROM pg_database WHERE datname = $1', [residue])).rows[0].n,
        1,
      );
    } finally {
      await db.adminQuery(`DROP DATABASE IF EXISTS ${quoteRole(residue)} WITH (FORCE)`);
    }

    const unavailable = runCli(['--database', db.database], {PGPORT: '1'});
    assert.equal(unavailable.status, 2);
    assert.match(unavailable.stderr, /cannot connect/);

    const check = runCheck({PGPORT: '1'});
    assert.notEqual(check.status, 0);
    assert.match(check.stderr, /cannot connect|coverage gate could not start/);
  });
});
