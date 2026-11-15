import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {
  withPivotDatabase,
  connectClusterAdmin,
  roleNamesForSuffix,
  combineRunAndCleanupErrors,
} from './helpers/pg-pivot-fixture.mjs';

const repoRoot = new URL('../', import.meta.url);
const tenantId = '11111111-1111-4111-8111-111111111111';
const operatorTables = [
  'ai_requests',
  'entitlement',
  'feature_flag',
  'jobs',
  'migration_events',
  'operator_audit',
  'pg_schema_migrations',
  'reference_value',
  'source_store_migrations',
  'tenant',
  'tenant_placement',
].sort();

const suffixFor = prefix => prefix + randomBytes(4).toString('hex');

test('PIVOT-002 operator bootstrap enforces Purpose A authority boundaries', async () => {
  const rolesSql = await readFile(new URL('db/postgres/00-roles.sql', repoRoot), 'utf8');
  const schemaSql = await readFile(new URL('db/postgres/10-operator-schema.sql', repoRoot), 'utf8');
  assert.doesNotMatch(rolesSql, /\bPASSWORD\b|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(schemaSql, /\bPASSWORD\b|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(
    schemaSql,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?operator\.(?:user_identity|tenant_membership)\b/i,
  );
  assert.match(schemaSql, /entitlement_no_mutation/);
  assert.match(schemaSql, /entitlement_no_truncate/);
  assert.match(schemaSql, /value_schema_version/);
  assert.match(rolesSql, /saven_customer_app/);

  await withPivotDatabase(async (db) => {
    const targetRoles = db.targetRoles;
    const roleRows = (
      await db.adminQuery(
        `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit, rolreplication
         FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
        [targetRoles],
      )
    ).rows;
    assert.equal(roleRows.length, targetRoles.length);
    for (const role of roleRows) {
      assert.equal(role.rolsuper, false, `${role.rolname} must not be SUPERUSER`);
      assert.equal(role.rolbypassrls, false, `${role.rolname} must not have BYPASSRLS`);
      assert.equal(role.rolcreatedb, false, `${role.rolname} must not create databases`);
      assert.equal(role.rolcreaterole, false, `${role.rolname} must not create roles`);
      assert.equal(role.rolcanlogin, false, `${role.rolname} must be NOLOGIN`);
      assert.equal(role.rolinherit, false, `${role.rolname} must be NOINHERIT`);
      assert.equal(role.rolreplication, false, `${role.rolname} must not replicate`);
    }

    const databaseOwner = (
      await db.adminQuery(`SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()`)
    ).rows[0].owner;
    assert.equal(targetRoles.includes(databaseOwner), false, 'No SAVEN target role may own the disposable database');

    const memberships = (
      await db.adminQuery(
        `SELECT r.rolname AS member, g.rolname AS granted
         FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.member
         JOIN pg_roles g ON g.oid = m.roleid
         WHERE r.rolname = ANY($1)`,
        [targetRoles],
      )
    ).rows;
    assert.deepEqual(memberships, [], 'SAVEN target roles must not be members of each other');

    const actualTables = (
      await db.adminQuery(
        `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'operator' AND c.relkind = 'r'
         ORDER BY c.relname`,
      )
    ).rows.map(row => row.table_name);
    assert.deepEqual(actualTables, operatorTables);

    const forbiddenTables = (
      await db.adminQuery(
        `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'operator' AND c.relname IN ('user_identity', 'tenant_membership')`,
      )
    ).rows;
    assert.deepEqual(forbiddenTables, []);

    async function schemaPrivilege(role, privilege) {
      return (
        await db.adminQuery('SELECT has_schema_privilege($1, $2, $3) AS allowed', [role, 'operator', privilege])
      ).rows[0].allowed;
    }
    async function tablePrivilege(role, table, privilege) {
      return (
        await db.adminQuery('SELECT has_table_privilege($1, $2, $3) AS allowed', [role, `operator.${table}`, privilege])
      ).rows[0].allowed;
    }

    assert.equal(await schemaPrivilege(db.roles.customerApp, 'USAGE'), false);
    assert.equal(await schemaPrivilege(db.roles.customerApp, 'CREATE'), false);
    assert.equal(await schemaPrivilege(db.roles.authService, 'USAGE'), false);
    assert.equal(await schemaPrivilege(db.roles.authDefiner, 'USAGE'), false);
    assert.equal(await schemaPrivilege(db.roles.operatorRead, 'USAGE'), true);
    assert.equal(await schemaPrivilege(db.roles.operatorRead, 'CREATE'), false);
    assert.equal(await schemaPrivilege(db.roles.operatorAdmin, 'USAGE'), true);
    assert.equal(await schemaPrivilege(db.roles.operatorAdmin, 'CREATE'), false);
    assert.equal(await schemaPrivilege(db.roles.operatorDefiner, 'USAGE'), true);
    assert.equal(await schemaPrivilege(db.roles.migrator, 'USAGE'), true);
    assert.equal(await schemaPrivilege(db.roles.migrator, 'CREATE'), true);

    for (const table of operatorTables) {
      assert.equal(await tablePrivilege(db.roles.customerApp, table, 'SELECT'), false, `customer app must not read operator.${table}`);
      assert.equal(await tablePrivilege(db.roles.customerApp, table, 'INSERT'), false, `customer app must not write operator.${table}`);
      assert.equal(await tablePrivilege(db.roles.operatorRead, table, 'SELECT'), true, `operator read must read operator.${table}`);
      assert.equal(await tablePrivilege(db.roles.operatorRead, table, 'INSERT'), false, `operator read must not write operator.${table}`);
    }

    assert.equal(
      (await db.adminQuery('SELECT has_function_privilege($1, $2, $3) AS allowed', [
        db.roles.customerApp,
        'operator.reject_mutation()',
        'EXECUTE',
      ])).rows[0].allowed,
      false,
    );
    assert.equal(await tablePrivilege(db.roles.operatorDefiner, 'operator_audit', 'INSERT'), true);
    assert.equal(await tablePrivilege(db.roles.operatorDefiner, 'tenant', 'INSERT'), false);
    assert.equal(await tablePrivilege(db.roles.operatorAdmin, 'entitlement', 'SELECT'), true);
    assert.equal(await tablePrivilege(db.roles.operatorAdmin, 'entitlement', 'INSERT'), true);
    assert.equal(await tablePrivilege(db.roles.operatorAdmin, 'entitlement', 'UPDATE'), false);
    assert.equal(await tablePrivilege(db.roles.operatorAdmin, 'entitlement', 'DELETE'), false);
    assert.equal(await tablePrivilege(db.roles.operatorAdmin, 'entitlement', 'TRUNCATE'), false);

    await assert.rejects(
      () => db.asRole('customerApp', client => client.query('SELECT count(*) FROM operator.tenant')),
      /permission denied for schema operator/,
    );
    await assert.rejects(
      () => db.asRole('customerApp', client => client.query(
        `INSERT INTO operator.tenant(tenant_id, legacy_id, legal_name) VALUES('${tenantId}', 'customer-denied', 'Denied')`,
      )),
      /permission denied for schema operator/,
    );

    await db.asRole('operatorRead', async client => {
      assert.equal((await client.query('SELECT count(*)::int AS n FROM operator.tenant')).rows[0].n, 0);
      assert.equal(
        (await client.query(`SELECT count(*)::int AS n FROM operator.reference_value WHERE domain = 'tenant_status' AND value = 'ACTIVE' AND is_active`)).rows[0].n,
        1,
      );
      await assert.rejects(
        () => client.query(`UPDATE operator.tenant SET legal_name = 'read-denied'`),
        /permission denied/,
      );
    });

    await db.asRole('operatorAdmin', async client => {
      await client.query(
        `INSERT INTO operator.tenant(tenant_id, legacy_id, legal_name, status, plan, created_by)
         VALUES($1, 'alpha-pivot', 'Alpha Pivot', 'ACTIVE', 'STANDARD', 'test-operator')`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO operator.entitlement(tenant_id, version, tier, public_key, signature, issued_at, claims_jsonb, created_by)
         VALUES($1, 1, 'CLOUD', 'test-public-key', 'test-signature', now(), '{"modules":["accounting"]}'::jsonb, 'test-operator')`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO operator.feature_flag(key, tenant_scope, enabled, value_jsonb, created_by)
         VALUES('pivot.test', $1, true, '{"mode":"on"}'::jsonb, 'test-operator')`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO operator.feature_flag(key, tenant_scope, enabled, created_by)
         VALUES('pivot.global', NULL, false, 'test-operator')`,
      );
      await client.query(
        `INSERT INTO operator.tenant_placement(tenant_id, state, schema_version, generation, node_id, updated_by)
         VALUES($1, 'ACTIVE', 1, 1, 'node-test', 'test-operator')`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO operator.jobs(tenant_id, command_id, state) VALUES($1, 'cmd-1', 'READY')`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO operator.ai_requests(id, tenant_id, user_id, company, question_digest, state)
         VALUES('ai-1', $1, 'user-1', 'alpha-pivot', 'digest-1', 'RUNNING')`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO operator.operator_audit(actor_id, action, target_tenant_id, reason)
         VALUES('operator-1', 'TENANT_CREATED', $1, 'contract test')`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO operator.migration_events(tenant_id, from_version, to_version, state)
         VALUES($1, 0, 1, 'SUCCEEDED')`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO operator.source_store_migrations(source_store, tenant_id, version, checksum, source_applied_at)
         VALUES('tenant', $1, 1, 'checksum-tenant', now())`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO operator.source_store_migrations(source_store, tenant_id, version, checksum, source_applied_at)
         VALUES('identity', NULL, 1, 'checksum-identity', now())`,
      );
    }, {commit: true});

    const counts = await db.asRole('operatorRead', async client => (
      await client.query(`SELECT
        (SELECT count(*)::int FROM operator.tenant) AS tenants,
        (SELECT count(*)::int FROM operator.entitlement) AS entitlements,
        (SELECT count(*)::int FROM operator.feature_flag) AS flags,
        (SELECT count(*)::int FROM operator.tenant_placement) AS placements,
        (SELECT count(*)::int FROM operator.jobs) AS jobs,
        (SELECT count(*)::int FROM operator.ai_requests) AS ai_requests,
        (SELECT count(*)::int FROM operator.operator_audit) AS audit,
        (SELECT count(*)::int FROM operator.migration_events) AS migration_events,
        (SELECT count(*)::int FROM operator.source_store_migrations) AS source_migrations`)
    ).rows[0]);
    assert.deepEqual(counts, {
      tenants: 1,
      entitlements: 1,
      flags: 2,
      placements: 1,
      jobs: 1,
      ai_requests: 1,
      audit: 1,
      migration_events: 1,
      source_migrations: 2,
    });

    const tenant = await db.asRole('operatorRead', async client => (
      await client.query(
        `SELECT tenant_id::text AS tenant_id, legacy_id, status, plan
         FROM operator.tenant WHERE tenant_id = $1`,
        [tenantId],
      )
    ).rows[0]);
    assert.deepEqual(tenant, {tenant_id: tenantId, legacy_id: 'alpha-pivot', status: 'ACTIVE', plan: 'STANDARD'});

    const tenantTypes = await db.asRole('operatorRead', async client => (
      await client.query(`SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'operator' AND table_name = 'tenant' AND column_name IN ('tenant_id', 'legacy_id', 'status', 'plan')`)
    ).rows);
    assert.deepEqual(
      Object.fromEntries(tenantTypes.map(row => [row.column_name, row.data_type])),
      {tenant_id: 'uuid', legacy_id: 'text', status: 'text', plan: 'text'},
    );
    const featureFlagVersion = await db.asRole('operatorRead', async client => (
      await client.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'operator' AND table_name = 'feature_flag' AND column_name = 'value_schema_version'`)
    ).rows);
    assert.deepEqual(featureFlagVersion, [{column_name: 'value_schema_version'}]);

    await assert.rejects(
      () => db.asRole('operatorAdmin', client => client.query(
        `INSERT INTO operator.tenant(tenant_id, legacy_id, legal_name)
         VALUES('22222222-2222-4222-8222-222222222222', 'alpha-pivot', 'Duplicate tenant')`,
      )),
      /duplicate key value violates unique constraint/,
    );
    await assert.rejects(
      () => db.asRole('operatorAdmin', client => client.query(
        `INSERT INTO operator.entitlement(tenant_id, version, tier) VALUES($1, 1, 'PRIVATE')`,
        [tenantId],
      )),
      /duplicate key value violates unique constraint/,
    );
    await assert.rejects(
      () => db.asRole('operatorAdmin', client => client.query(
        `INSERT INTO operator.feature_flag(key, tenant_scope, enabled) VALUES('pivot.global', NULL, true)`,
      )),
      /duplicate key value violates unique constraint/,
    );

    await assert.rejects(
      () => db.asRole('operatorAdmin', client => client.query('CREATE TABLE operator.admin_probe(id integer)')),
      /permission denied for schema operator/,
    );
    await assert.rejects(
      () => db.asRole('operatorAdmin', client => client.query(
        `INSERT INTO operator.pg_schema_migrations(version, description, checksum) VALUES(1, 'probe', 'probe')`,
      )),
      /permission denied/,
    );
    await assert.rejects(
      () => db.asRole('operatorAdmin', client => client.query(
        `UPDATE operator.entitlement SET claims_jsonb = '{}'::jsonb WHERE tenant_id = $1`,
        [tenantId],
      )),
      /permission denied/,
    );
    await assert.rejects(
      () => db.asRole('operatorAdmin', client => client.query('TRUNCATE operator.entitlement')),
      /permission denied/,
    );

    await db.asRole('migrator', async client => {
      await client.query('CREATE TABLE operator.migrator_probe(id integer)');
      await client.query('DROP TABLE operator.migrator_probe');
    });
    await db.asRole('migrator', client => client.query(
      `INSERT INTO operator.pg_schema_migrations(version, description, checksum)
       VALUES(1, 'pivot-002b', 'checksum-pivot-002b')`,
    ), {commit: true});

    const immutableStatements = [
      ['UPDATE operator.operator_audit SET reason = $1', ['changed']],
      ['DELETE FROM operator.operator_audit', []],
      ['UPDATE operator.pg_schema_migrations SET description = $1', ['changed']],
      ['DELETE FROM operator.pg_schema_migrations', []],
      ['UPDATE operator.source_store_migrations SET checksum = $1', ['changed']],
      ['DELETE FROM operator.source_store_migrations', []],
      ['UPDATE operator.migration_events SET detail = $1', ['changed']],
      ['DELETE FROM operator.migration_events', []],
      ['UPDATE operator.entitlement SET claims_jsonb = $1::jsonb WHERE tenant_id = $2', ['{}', tenantId]],
      ['DELETE FROM operator.entitlement WHERE tenant_id = $1', [tenantId]],
      ['TRUNCATE operator.operator_audit', []],
      ['TRUNCATE operator.pg_schema_migrations', []],
      ['TRUNCATE operator.source_store_migrations', []],
      ['TRUNCATE operator.migration_events', []],
      ['TRUNCATE operator.entitlement', []],
    ];
    for (const [sql, params] of immutableStatements) {
      await db.asRole('migrator', async client => {
        await assert.rejects(() => client.query(sql, params), /OPERATOR_RECORD_IMMUTABLE/);
      });
    }

    const floatingColumns = await db.asRole('operatorRead', async client => (
      await client.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'operator' AND data_type IN ('real', 'double precision')`)
    ).rows);
    assert.deepEqual(floatingColumns, [], 'Operator schema must not use floating-point money columns');
  });
});

test('PIVOT-002 fixture refuses pre-existing cluster roles before mutation', async () => {
  const suffix = suffixFor('refuse');
  const names = roleNamesForSuffix(suffix);
  const allRoles = [...Object.values(names).filter(value => value !== names.database)];
  const cluster = await connectClusterAdmin();
  let created = false;
  try {
    await cluster.query(
      `CREATE ROLE "${names.customerApp}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`,
    );
    created = true;
    const before = (
      await cluster.query(
        'SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit, rolreplication FROM pg_roles WHERE rolname = $1',
        [names.customerApp],
      )
    ).rows[0];
    await assert.rejects(
      () => withPivotDatabase({namespaceSuffix: suffix}, async () => {
        throw new Error('fixture callback must not run after a pre-flight refusal');
      }),
      /pre-flight refused/i,
    );
    const after = (
      await cluster.query(
        'SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit, rolreplication FROM pg_roles WHERE rolname = $1',
        [names.customerApp],
      )
    ).rows[0];
    assert.deepEqual(after, before, 'pre-existing role attributes must remain unchanged');
    const database = await cluster.query('SELECT datname FROM pg_database WHERE datname = $1', [names.database]);
    assert.equal(database.rowCount, 0, 'pre-flight refusal must not create the disposable database');
    const otherRoles = await cluster.query(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1) AND rolname <> $2',
      [allRoles, names.customerApp],
    );
    assert.equal(otherRoles.rowCount, 0, 'pre-flight refusal must not create any other fixture role');
  } finally {
    if (created) await cluster.query(`DROP ROLE IF EXISTS "${names.customerApp}"`);
    await cluster.end();
  }
});

test('PIVOT-002 fixture namespaces isolate concurrent runs', async () => {
  const suffixA = suffixFor('isoa');
  const suffixB = suffixFor('isob');
  const [a, b] = await Promise.all([
    withPivotDatabase({namespaceSuffix: suffixA}, async db => ({
      database: db.database,
      customerApp: db.roles.customerApp,
      current: (await db.asRole('operatorRead', client => client.query('SELECT current_database() AS db'))).rows[0].db,
    })),
    withPivotDatabase({namespaceSuffix: suffixB}, async db => ({
      database: db.database,
      customerApp: db.roles.customerApp,
      current: (await db.asRole('operatorRead', client => client.query('SELECT current_database() AS db'))).rows[0].db,
    })),
  ]);
  assert.equal(a.database, 'saven_pivot_' + suffixA);
  assert.equal(b.database, 'saven_pivot_' + suffixB);
  assert.equal(a.current, a.database);
  assert.equal(b.current, b.database);
  assert.notEqual(a.customerApp, b.customerApp);
});

test('PIVOT-002 fixture reports run and cleanup failures together', () => {
  const runError = new Error('run failed');
  const combined = combineRunAndCleanupErrors(runError, [new Error('cleanup failed')]);
  assert.ok(combined instanceof AggregateError);
  assert.equal(combined.errors[0], runError);
  assert.match(combined.errors[1].message, /cleanup failed/);
  assert.equal(combineRunAndCleanupErrors(runError, []), runError);
  const cleanupOnly = combineRunAndCleanupErrors(null, [new Error('cleanup failed')]);
  assert.match(cleanupOnly.message, /cleanup failed/);
});
