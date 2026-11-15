import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {withPivotDatabase, targetRoles} from './helpers/pg-pivot-fixture.mjs';

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

test('PIVOT-002 operator bootstrap enforces Purpose A authority boundaries', async () => {
  const rolesSql = await readFile(new URL('db/postgres/00-roles.sql', repoRoot), 'utf8');
  const schemaSql = await readFile(new URL('db/postgres/10-operator-schema.sql', repoRoot), 'utf8');
  assert.doesNotMatch(rolesSql, /\bPASSWORD\b|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(schemaSql, /\bPASSWORD\b|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(
    schemaSql,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?operator\.(?:user_identity|tenant_membership)\b/i,
  );

  await withPivotDatabase(async (db) => {
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

    const schemaPrivileges = (
      await db.adminQuery(`
        SELECT
          has_schema_privilege('saven_customer_app', 'operator', 'USAGE') AS customer_usage,
          has_schema_privilege('saven_customer_app', 'operator', 'CREATE') AS customer_create,
          has_schema_privilege('saven_auth_service', 'operator', 'USAGE') AS auth_usage,
          has_schema_privilege('saven_auth_definer', 'operator', 'USAGE') AS auth_definer_usage,
          has_schema_privilege('saven_operator_read', 'operator', 'USAGE') AS read_usage,
          has_schema_privilege('saven_operator_read', 'operator', 'CREATE') AS read_create,
          has_schema_privilege('saven_operator_admin', 'operator', 'USAGE') AS admin_usage,
          has_schema_privilege('saven_operator_admin', 'operator', 'CREATE') AS admin_create,
          has_schema_privilege('saven_operator_definer', 'operator', 'USAGE') AS definer_usage,
          has_schema_privilege('saven_migrator', 'operator', 'USAGE') AS migrator_usage,
          has_schema_privilege('saven_migrator', 'operator', 'CREATE') AS migrator_create
      `)
    ).rows[0];
    assert.equal(schemaPrivileges.customer_usage, false);
    assert.equal(schemaPrivileges.customer_create, false);
    assert.equal(schemaPrivileges.auth_usage, false);
    assert.equal(schemaPrivileges.auth_definer_usage, false);
    assert.equal(schemaPrivileges.read_usage, true);
    assert.equal(schemaPrivileges.read_create, false);
    assert.equal(schemaPrivileges.admin_usage, true);
    assert.equal(schemaPrivileges.admin_create, false);
    assert.equal(schemaPrivileges.definer_usage, true);
    assert.equal(schemaPrivileges.migrator_usage, true);
    assert.equal(schemaPrivileges.migrator_create, true);

    for (const table of operatorTables) {
      const privileges = (
        await db.adminQuery(
          `SELECT
             has_table_privilege('saven_customer_app', $1, 'SELECT') AS customer_select,
             has_table_privilege('saven_customer_app', $1, 'INSERT') AS customer_insert,
             has_table_privilege('saven_operator_read', $1, 'SELECT') AS read_select,
             has_table_privilege('saven_operator_read', $1, 'INSERT') AS read_insert`,
          [`operator.${table}`],
        )
      ).rows[0];
      assert.equal(privileges.customer_select, false, `customer app must not read operator.${table}`);
      assert.equal(privileges.customer_insert, false, `customer app must not write operator.${table}`);
      assert.equal(privileges.read_select, true, `operator read must read operator.${table}`);
      assert.equal(privileges.read_insert, false, `operator read must not write operator.${table}`);
    }

    const definerPrivileges = (
      await db.adminQuery(`SELECT
        has_table_privilege('saven_operator_definer', 'operator.operator_audit', 'INSERT') AS audit_insert,
        has_table_privilege('saven_operator_definer', 'operator.tenant', 'INSERT') AS tenant_insert,
        has_function_privilege('saven_customer_app', 'operator.reject_mutation()', 'EXECUTE') AS customer_function`)
    ).rows[0];
    assert.equal(definerPrivileges.audit_insert, true);
    assert.equal(definerPrivileges.tenant_insert, false);
    assert.equal(definerPrivileges.customer_function, false);

    await assert.rejects(
      () => db.asRole('saven_customer_app', client => client.query('SELECT count(*) FROM operator.tenant')),
      /permission denied for schema operator/,
    );
    await assert.rejects(
      () => db.asRole('saven_customer_app', client => client.query(
        `INSERT INTO operator.tenant(tenant_id, legacy_id, legal_name) VALUES('${tenantId}', 'customer-denied', 'Denied')`,
      )),
      /permission denied for schema operator/,
    );

    await db.asRole('saven_operator_read', async client => {
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

    await db.asRole('saven_operator_admin', async client => {
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
        `INSERT INTO operator.feature_flag(key, tenant_scope, enabled, created_by)
         VALUES('pivot.test', $1, true, 'test-operator')`,
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

    const counts = await db.asRole('saven_operator_read', async client => (
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

    const tenant = await db.asRole('saven_operator_read', async client => (
      await client.query(
        `SELECT tenant_id::text AS tenant_id, legacy_id, status, plan
         FROM operator.tenant WHERE tenant_id = $1`,
        [tenantId],
      )
    ).rows[0]);
    assert.deepEqual(tenant, {tenant_id: tenantId, legacy_id: 'alpha-pivot', status: 'ACTIVE', plan: 'STANDARD'});

    const tenantTypes = await db.asRole('saven_operator_read', async client => (
      await client.query(`SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'operator' AND table_name = 'tenant' AND column_name IN ('tenant_id', 'legacy_id', 'status', 'plan')`)
    ).rows);
    assert.deepEqual(
      Object.fromEntries(tenantTypes.map(row => [row.column_name, row.data_type])),
      {tenant_id: 'uuid', legacy_id: 'text', status: 'text', plan: 'text'},
    );

    await assert.rejects(
      () => db.asRole('saven_operator_admin', client => client.query(
        `INSERT INTO operator.tenant(tenant_id, legacy_id, legal_name)
         VALUES('22222222-2222-4222-8222-222222222222', 'alpha-pivot', 'Duplicate tenant')`,
      )),
      /duplicate key value violates unique constraint/,
    );
    await assert.rejects(
      () => db.asRole('saven_operator_admin', client => client.query(
        `INSERT INTO operator.entitlement(tenant_id, version, tier) VALUES($1, 1, 'PRIVATE')`,
        [tenantId],
      )),
      /duplicate key value violates unique constraint/,
    );
    await assert.rejects(
      () => db.asRole('saven_operator_admin', client => client.query(
        `INSERT INTO operator.feature_flag(key, tenant_scope, enabled) VALUES('pivot.global', NULL, true)`,
      )),
      /duplicate key value violates unique constraint/,
    );

    await assert.rejects(
      () => db.asRole('saven_operator_admin', client => client.query('CREATE TABLE operator.admin_probe(id integer)')),
      /permission denied for schema operator/,
    );
    await assert.rejects(
      () => db.asRole('saven_operator_admin', client => client.query(
        `INSERT INTO operator.pg_schema_migrations(version, description, checksum) VALUES(1, 'probe', 'probe')`,
      )),
      /permission denied/,
    );

    await db.asRole('saven_migrator', async client => {
      await client.query('CREATE TABLE operator.migrator_probe(id integer)');
      await client.query('DROP TABLE operator.migrator_probe');
    });
    await db.asRole('saven_migrator', client => client.query(
      `INSERT INTO operator.pg_schema_migrations(version, description, checksum)
       VALUES(1, 'pivot-002', 'checksum-pivot-002')`,
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
    ];
    for (const [sql, params] of immutableStatements) {
      await db.asRole('saven_migrator', async client => {
        await assert.rejects(() => client.query(sql, params), /OPERATOR_RECORD_IMMUTABLE/);
      });
    }

    const floatingColumns = await db.asRole('saven_operator_read', async client => (
      await client.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'operator' AND data_type IN ('real', 'double precision')`)
    ).rows);
    assert.deepEqual(floatingColumns, [], 'Operator schema must not use floating-point money columns');
  });
});
