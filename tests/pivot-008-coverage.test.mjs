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

// The complete accepted stack, in db/postgres/README.md order. The fixture applies the
// migration files as the migration principal and the administrator steps as superuser.
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

async function coverage(db) {
  return (await db.adminQuery(coverageSql)).rows;
}

// Probe one deliberately broken state inside a transaction and roll it back, so every
// negative case starts from the same accepted stack.
async function probe(db, statements) {
  await db.adminQuery('BEGIN');
  try {
    for (const statement of statements) await db.adminQuery(statement);
    return await coverage(db);
  } finally {
    await db.adminQuery('ROLLBACK');
  }
}

function has(rows, kind) {
  return rows.some(row => row.kind === kind);
}

function kinds(rows) {
  return [...new Set(rows.map(row => row.kind))].join(', ');
}

function quoteRole(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

test('PIVOT-008 static contract: read-only single-query gate wired to check --postgres', async () => {
  const stripped = coverageSql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  // Semicolons inside string literals are data, not statement terminators.
  const withoutStrings = stripped.replace(/'(?:[^']|'')*'/g, "''");
  assert.equal((withoutStrings.match(/;/g) ?? []).length, 1, 'the coverage gate must be one read-only statement');
  assert.match(stripped.trim(), /;$/);
  assert.match(stripped.trimStart(), /^WITH RECURSIVE\b/, 'the gate is a single catalog query');
  assert.doesNotMatch(stripped, /\bBEGIN\b|\bCOMMIT\b/);
  assert.doesNotMatch(stripped, /^\s*(?:GRANT|REVOKE|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);

  for (const kind of [
    'MISSING_ENABLE_RLS',
    'MISSING_FORCE_RLS',
    'MISSING_POLICY',
    'MISSING_PERMISSIVE_POLICY',
    'MISSING_RESTRICTIVE_POLICY',
    'UNSAFE_RESTRICTIVE_POLICY',
    'AUTH_MEMBERSHIP_MISSING_ENABLE_RLS',
    'AUTH_MEMBERSHIP_MISSING_FORCE_RLS',
    'UNSAFE_PARTITION_PATH',
    'UNSAFE_VIEW_OWNER',
    'UNSAFE_MATERIALIZED_VIEW',
    'UNSAFE_FUNCTION_OWNER',
    'UNSAFE_FUNCTION_SEARCH_PATH',
    'UNSAFE_FUNCTION_PUBLIC_EXECUTE',
    'UNSAFE_FUNCTION_RUNTIME_ASSUMPTION',
    'SAVEN_BYPASS_OR_SUPER',
    'RUNTIME_OWNS_OBJECT',
    'RUNTIME_ASSUMES_PRIVILEGED_ROLE',
    'PUBLIC_RELATION_PRIVILEGE',
    'FORBIDDEN_RUNTIME_PRIVILEGE',
    'CUSTOMER_CROSS_SCHEMA_PRIVILEGE',
  ]) {
    assert.match(coverageSql, new RegExp(`'${kind}'`), `${kind} must be part of the gate`);
  }

  const check = await readFile(checkPath, 'utf8');
  assert.match(check, /--postgres/);
  assert.match(check, /scripts\/verify-pg-rls\.mjs/);
  assert.match(check, /gate\.status!==0\)process\.exit/);

  const verify = await readFile(verifyPath, 'utf8');
  assert.match(verify, /SAVEN_PIVOT_TEST_CLUSTER !== '1'/);
  assert.match(verify, /99-ci-rls-coverage\.sql/);
  assert.match(verify, /DROP DATABASE IF EXISTS/);
  assert.doesNotMatch(verify, /skip/i);

  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /image: postgres:18/);
  assert.match(workflow, /SAVEN_PIVOT_TEST_CLUSTER: "1"/);
  assert.match(workflow, /node scripts\/check\.mjs --postgres/);
  assert.match(workflow, /node --test tests\/pivot-008-coverage\.test\.mjs/);
  assert.doesNotMatch(workflow, /continue-on-error|if:\s*false|\|\|\s*true/);
});

test('PIVOT-008 healthy accepted stack: full surface is present and coverage is empty', async () => {
  await withPivotDatabase(stack, async db => {
    const surface = (
      await db.adminQuery(`
        SELECT
          (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'tenant_data' AND c.relkind IN ('r', 'p')) AS tenant_tables,
          (SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'tenant_data') AS tenant_policies,
          (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN ('tenant_data', 'auth', 'operator') AND p.prosecdef) AS definer_functions,
          (SELECT count(*)::int FROM pg_roles WHERE rolname ~ '(^|_)customer_app$') AS runtime_customer
      `)
    ).rows[0];
    // A zero-row gate is only meaningful when the catalogs it scans are populated.
    assert.ok(surface.tenant_tables >= 49, 'the accepted tenant surface must be installed');
    assert.ok(surface.tenant_policies >= surface.tenant_tables * 3, 'every tenant table keeps its policy set');
    assert.ok(surface.definer_functions >= 5, 'the PIVOT-004/005/006/007 definer surface must be installed');
    assert.ok(surface.runtime_customer >= 1, 'the customer runtime role must exist');

    assert.deepEqual(await coverage(db), [], 'the accepted stack must produce no coverage violation');
  });
});

test('PIVOT-008 seeded isolation breaks each fail with their own violation', async () => {
  await withPivotDatabase(stack, async db => {
    const cases = [
      {
        name: 'missing ENABLE',
        statements: ['ALTER TABLE tenant_data.accounts DISABLE ROW LEVEL SECURITY'],
        kind: 'MISSING_ENABLE_RLS',
      },
      {
        name: 'missing FORCE',
        statements: ['ALTER TABLE tenant_data.accounts NO FORCE ROW LEVEL SECURITY'],
        kind: 'MISSING_FORCE_RLS',
      },
      {
        name: 'missing permissive policy',
        statements: ['DROP POLICY accounts_tenant_isolation ON tenant_data.accounts'],
        kind: 'MISSING_PERMISSIVE_POLICY',
      },
      {
        name: 'missing restrictive policy',
        statements: [
          'DROP POLICY accounts_tenant_scope ON tenant_data.accounts',
          'DROP POLICY accounts_runtime_admission ON tenant_data.accounts',
        ],
        kind: 'MISSING_RESTRICTIVE_POLICY',
      },
      {
        name: 'constantly true restrictive policy',
        statements: [
          "CREATE POLICY probe_true ON tenant_data.accounts AS RESTRICTIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true)",
        ],
        kind: 'UNSAFE_RESTRICTIVE_POLICY',
      },
      {
        name: 'policy granted to a non-runtime role',
        statements: [
          `CREATE POLICY probe_role ON tenant_data.accounts AS RESTRICTIVE FOR ALL TO ${quoteRole(db.roles.authService)}
             USING (tenant_id = tenant_data.current_tenant_id())
             WITH CHECK (tenant_id = tenant_data.current_tenant_id())`,
        ],
        kind: 'FORBIDDEN_POLICY_ROLE',
      },
      {
        name: 'tenant policy reads the raw GUC',
        statements: [
          'DROP POLICY accounts_tenant_isolation ON tenant_data.accounts',
          `CREATE POLICY accounts_tenant_isolation ON tenant_data.accounts AS PERMISSIVE FOR ALL TO PUBLIC
             USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
             WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
        ],
        kind: 'CLIENT_CONTEXT_IN_TENANT_POLICY',
      },
      {
        name: 'auth membership loses FORCE',
        statements: ['ALTER TABLE auth.tenant_membership NO FORCE ROW LEVEL SECURITY'],
        kind: 'AUTH_MEMBERSHIP_MISSING_FORCE_RLS',
      },
      {
        name: 'directly reachable inheritance child',
        statements: [
          'CREATE TABLE tenant_data.accounts_probe_child () INHERITS (tenant_data.accounts)',
          `GRANT SELECT ON tenant_data.accounts_probe_child TO ${quoteRole(db.roles.customerApp)}`,
        ],
        kind: 'UNSAFE_PARTITION_PATH',
      },
      {
        name: 'runtime-readable bypassing view',
        statements: [
          'CREATE VIEW public.accounts_probe_leak AS SELECT * FROM tenant_data.accounts',
          `GRANT SELECT ON public.accounts_probe_leak TO ${quoteRole(db.roles.customerApp)}`,
        ],
        kind: 'UNSAFE_VIEW_OWNER',
      },
      {
        name: 'runtime-readable materialized view',
        statements: [
          'CREATE MATERIALIZED VIEW tenant_data.accounts_probe_mat AS SELECT * FROM tenant_data.accounts',
          `GRANT SELECT ON tenant_data.accounts_probe_mat TO ${quoteRole(db.roles.customerApp)}`,
        ],
        kind: 'UNSAFE_MATERIALIZED_VIEW',
      },
    ];

    for (const item of cases) {
      const rows = await probe(db, item.statements);
      assert.ok(has(rows, item.kind), `${item.name} must report ${item.kind}; got ${kinds(rows)}`);
    }
  });
});

test('PIVOT-008 seeded authority and grant breaks each fail', async () => {
  await withPivotDatabase(stack, async db => {
    const cases = [
      {
        name: 'unconstrained definer function',
        statements: [
          `CREATE FUNCTION tenant_data.probe_definer() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`,
        ],
        kind: 'UNSAFE_FUNCTION_SEARCH_PATH',
      },
      {
        name: 'PUBLIC can execute a definer function',
        statements: [
          `CREATE FUNCTION tenant_data.probe_definer_public() RETURNS integer LANGUAGE sql SECURITY DEFINER
             SET search_path = pg_catalog AS 'SELECT 1'`,
          'GRANT EXECUTE ON FUNCTION tenant_data.probe_definer_public() TO PUBLIC',
        ],
        kind: 'UNSAFE_FUNCTION_PUBLIC_EXECUTE',
      },
      {
        name: 'definer function disables row security',
        statements: [
          `CREATE FUNCTION tenant_data.probe_definer_rowsecurity() RETURNS integer LANGUAGE sql SECURITY DEFINER
             SET search_path = pg_catalog SET row_security = off AS 'SELECT 1'`,
        ],
        kind: 'UNSAFE_FUNCTION_ROW_SECURITY',
      },
      {
        name: 'runtime can assume the definer owner',
        statements: [
          `GRANT ${quoteRole(db.roles.operatorDefiner)} TO ${quoteRole(db.roles.customerApp)}`,
        ],
        kind: 'UNSAFE_FUNCTION_RUNTIME_ASSUMPTION',
      },
      {
        name: 'PUBLIC relation privilege',
        statements: ['GRANT SELECT ON tenant_data.accounts TO PUBLIC'],
        kind: 'PUBLIC_RELATION_PRIVILEGE',
      },
      {
        name: 'runtime TRUNCATE',
        statements: [
          `GRANT TRUNCATE ON tenant_data.accounts TO ${quoteRole(db.roles.customerApp)}`,
        ],
        kind: 'FORBIDDEN_RUNTIME_PRIVILEGE',
      },
      {
        name: 'customer crosses into auth',
        statements: [
          `GRANT SELECT ON auth.tenant_membership TO ${quoteRole(db.roles.customerApp)}`,
        ],
        kind: 'CUSTOMER_CROSS_SCHEMA_PRIVILEGE',
      },
      {
        name: 'auth service reads tenant data',
        statements: [
          `GRANT SELECT ON tenant_data.accounts TO ${quoteRole(db.roles.authService)}`,
        ],
        kind: 'AUTH_SERVICE_TENANT_PRIVILEGE',
      },
      {
        name: 'operator reads tenant data',
        statements: [
          `GRANT SELECT ON tenant_data.accounts TO ${quoteRole(db.roles.operatorRead)}`,
        ],
        kind: 'OPERATOR_TENANT_PRIVILEGE',
      },
      {
        name: 'SAVEN principal gains BYPASSRLS',
        statements: [
          `ALTER ROLE ${quoteRole(db.roles.customerApp)} BYPASSRLS`,
        ],
        kind: 'SAVEN_BYPASS_OR_SUPER',
      },
    ];

    for (const item of cases) {
      const rows = await probe(db, item.statements);
      assert.ok(has(rows, item.kind), `${item.name} must report ${item.kind}; got ${kinds(rows)}`);
    }
  });
});

test('PIVOT-008 CLI translates rows into a nonzero exit and fails closed when unavailable', async () => {
  await withPivotDatabase(stack, async db => {
    const env = {...process.env, SAVEN_PIVOT_TEST_CLUSTER: '1'};
    const healthy = spawnSync(process.execPath, [verifyPath, '--database', db.database], {encoding: 'utf8', env});
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.match(healthy.stdout, /PASS: PIVOT-008 RLS\/privilege coverage found no violation/);

    // A committed violation must change the process outcome, not just a SELECT result.
    await db.adminQuery('ALTER TABLE tenant_data.accounts NO FORCE ROW LEVEL SECURITY');
    try {
      const broken = spawnSync(process.execPath, [verifyPath, '--database', db.database], {encoding: 'utf8', env});
      assert.notEqual(broken.status, 0, 'a violation must exit nonzero');
      assert.match(broken.stderr, /FAIL: PIVOT-008/);
      assert.match(broken.stderr, /MISSING_FORCE_RLS tenant_data\.accounts/);
    } finally {
      await db.adminQuery('ALTER TABLE tenant_data.accounts FORCE ROW LEVEL SECURITY');
    }

    const restored = spawnSync(process.execPath, [verifyPath, '--database', db.database], {encoding: 'utf8', env});
    assert.equal(restored.status, 0, restored.stderr);

    // An unavailable required gate fails; it never reports a skip as success.
    const unavailable = spawnSync(
      process.execPath,
      [verifyPath, '--database', db.database],
      {encoding: 'utf8', env: {...env, PGPORT: '1'}},
    );
    assert.notEqual(unavailable.status, 0);
    assert.match(unavailable.stderr, /cannot connect/);

    // The check.mjs wiring has the same failure behavior.
    const check = spawnSync(process.execPath, [checkPath, '--postgres'], {
      encoding: 'utf8',
      env: {...env, PGPORT: '1'},
    });
    assert.notEqual(check.status, 0);
    assert.match(check.stderr, /cannot connect|coverage gate could not start/);
  });
});
