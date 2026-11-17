import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {withPivotDatabase, namespaceSql} from './helpers/pg-pivot-fixture.mjs';

const repoRoot = new URL('../', import.meta.url);
const schemaFiles = [
  'db/postgres/05-auth-schema.sql',
  'db/postgres/migrations/006-auth-schema-corrections.sql',
  'db/postgres/10-operator-schema.sql',
  'db/postgres/20-tenant-schema.sql',
  'db/postgres/migrations/021-tenant-schema-corrections.sql',
  'db/postgres/30-rls-policies.sql',
  'db/postgres/migrations/040-posted-immutability.sql',
];
const adminSqlFiles = [
  'db/postgres/migrations/031-rls-corrections.sql',
  'db/postgres/migrations/032-rls-hardening.sql',
  'db/postgres/migrations/041-audit.sql',
  'db/postgres/migrations/042-entry-voiding.sql',
];

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const asUser = (db, tenant, user, run, options = {}) => db.asRole('customerApp', async client => {
  if (tenant !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenant]);
  if (user !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', user]);
  return run(client);
}, options);

async function addIdentity(db, {tenant = T1, user = U1, legacy = 'user-1', email = 'u1@example.test'} = {}) {
  await db.adminQuery(`INSERT INTO auth.users(id, legacy_id, email, status) VALUES ($1::uuid, $2, $3, 'active')`,
    [user, legacy, email]);
  await db.adminQuery(`
    INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
      VALUES ($1::uuid, $2::uuid, 'ultimate_owner', 'active', now(), now())
  `, [tenant, user]);
  await db.adminQuery(`
    INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES ($1::uuid, $2, $3::uuid, true)
  `, [tenant, legacy, user]);
}

async function seed(db, {tenant = T1, user = U1, legacy = 'user-1', email = 'u1@example.test'} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.business(tenant_id, id, state) VALUES ('${tenant}', 'alpha', 'ACTIVE');
    INSERT INTO tenant_data.company_profiles(tenant_id, id, name, currency, branch, created_at)
      VALUES ('${tenant}', 'alpha', 'Alpha', 'PKR', 'main', 0);
    INSERT INTO tenant_data.accounts(tenant_id, code, title)
      VALUES ('${tenant}', '1000', 'Cash'), ('${tenant}', '4000', 'Revenue');
    INSERT INTO tenant_data.reference_values(tenant_id, domain, value, label, is_active) VALUES
      ('${tenant}', 'origin_type', 'human', 'Human user', true),
      ('${tenant}', 'origin_type', 'ai', 'AI proposal', true),
      ('${tenant}', 'origin_type', 'integration', 'Integration', true),
      ('${tenant}', 'origin_type', 'system', 'System process', true);
  `);
  await addIdentity(db, {tenant, user, legacy, email});
}

async function activate(db) {
  const dispatcher = await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8');
  await db.adminQuery(namespaceSql(dispatcher, db.roles));
}

async function seedVoidFixture(db, {tenant = T1, legacy = 'user-1', entry = 'p006-void'} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
      VALUES ('${tenant}', 'clerk', 'Clerk', false,
        '{"actions":["accounting.entry.void"],"companies":["*"],"branches":["*"],"accounts":["*"],"review":false}');
    INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id)
      VALUES ('${tenant}', '${legacy}', 'clerk');
    INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
      VALUES ('${tenant}', '${entry}', '${legacy}', 'digest-${entry}', '{}', 'ACCEPTED_PENDING', 0);
    INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
      VALUES ('${tenant}', '${entry}', 'alpha', 'main', '2026-11-17', 'audited void');
    INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit)
      VALUES ('${tenant}', '${entry}', 1, '1000', 100, 0), ('${tenant}', '${entry}', 2, '4000', 0, 100);
    INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
      VALUES ('${tenant}', '${entry}', '${legacy}', 'JOURNAL_POSTED', '{}', 0);
    INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
      VALUES ('${tenant}', '${entry}', 'JOURNAL_POSTED', 'READY');
    UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE tenant_id = '${tenant}' AND id = '${entry}';
  `);
}

const auditRow = async (db, where = 'TRUE', params = []) => (
  await db.adminQuery(`
    SELECT tenant_id::text, actor_id, event, entity_type, entity_id, detail_jsonb,
           origin_type, origin_user_id, request_id
    FROM tenant_data.audit_event
    WHERE ${where}
    ORDER BY id
  `, params)
).rows;

test('PIVOT-006 records actor-bound insert/update/delete audit with before, after and target', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await activate(db);

    // INSERT as the real customer role.
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '2000', 'Audit account')
    `), {commit: true});
    const inserted = (await auditRow(db, `entity_type = 'accounts' AND actor_id = 'user-1'`)).at(-1);
    assert.equal(inserted.event, 'TENANT_CHANGE_INSERT');
    assert.equal(inserted.origin_type, 'system');
    assert.equal(inserted.origin_user_id, null);
    assert.equal(inserted.request_id, null);
    assert.equal(inserted.detail_jsonb.action, 'INSERT');
    assert.equal(inserted.detail_jsonb.serializationVersion, 1);
    assert.equal(inserted.detail_jsonb.provenance, 'unavailable');
    assert.equal(inserted.detail_jsonb.version, 1);
    assert.ok(inserted.detail_jsonb.transactionId);
    assert.equal(inserted.detail_jsonb.before, null);
    assert.equal(inserted.detail_jsonb.after.row.code, '2000');
    assert.match(inserted.entity_id, /"code": ?"2000"/);

    // UPDATE actor spoof: the row's updated_by is another user, but the audit actor is
    // the verified current principal.
    await asUser(db, T1, U1, client => client.query(`
      UPDATE tenant_data.accounts
         SET title = 'Audit account updated', updated_by = 'user-2'
       WHERE tenant_id = '${T1}' AND code = '2000'
    `), {commit: true});
    const updated = (await auditRow(db, `entity_type = 'accounts' AND event = 'TENANT_CHANGE_UPDATE'`)).at(-1);
    assert.equal(updated.actor_id, 'user-1');
    assert.equal(updated.origin_user_id, null);
    assert.equal(updated.detail_jsonb.before.row.title, 'Audit account');
    assert.equal(updated.detail_jsonb.after.row.title, 'Audit account updated');
    assert.equal(updated.detail_jsonb.after.row.updated_by, 'user-2');

    // DELETE through a table whose runtime grant includes DELETE.
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions, created_by)
        VALUES ('${T1}', 'audit-role', 'Audit role', false, '{}', 'user-2')
    `), {commit: true});
    await asUser(db, T1, U1, client => client.query(`
      DELETE FROM tenant_data.roles WHERE tenant_id = '${T1}' AND id = 'audit-role'
    `), {commit: true});
    const deleted = (await auditRow(db, `entity_type = 'roles' AND event = 'TENANT_CHANGE_DELETE'`)).at(-1);
    assert.equal(deleted.actor_id, 'user-1');
    assert.equal(deleted.detail_jsonb.after, null);
    assert.equal(deleted.detail_jsonb.before.row.id, 'audit-role');
    assert.equal(deleted.detail_jsonb.before.row.created_by, 'user-2');
  });
});

test('PIVOT-006 missing context fails closed and audit storage is append-only and tenant-scoped', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await seed(db, {tenant: T2, user: U2, legacy: 'user-2', email: 'u2@example.test'});
    await activate(db);

    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '2100', 'Scoped audit')
    `), {commit: true});

    // Administrative/context-less changes are not silently attributed to a fabricated
    // actor; they fail closed before the mutation commits.
    await assert.rejects(
      () => db.adminQuery(`UPDATE tenant_data.accounts SET title = 'No context' WHERE tenant_id = '${T1}' AND code = '2100'`),
      /AUDIT_CONTEXT_REQUIRED/,
    );
    const afterMissing = (await db.adminQuery(`SELECT title FROM tenant_data.accounts WHERE tenant_id = '${T1}' AND code = '2100'`)).rows[0];
    assert.equal(afterMissing.title, 'Scoped audit');

    // Tenant two cannot see tenant one audit rows.
    const foreign = await asUser(db, T2, U2, client =>
      client.query('SELECT count(*)::int AS n FROM tenant_data.audit_event'));
    assert.equal(foreign.rows[0].n, 0);
    const own = await asUser(db, T1, U1, client =>
      client.query('SELECT count(*)::int AS n FROM tenant_data.audit_event'));
    assert.ok(own.rows[0].n > 0);

    // A spoofed tenant/user pair that is not admitted for that tenant cannot write,
    // so no unaudited row or audit row is created.
    await asUser(db, T1, U2, client => assert.rejects(
      () => client.query(`INSERT INTO tenant_data.accounts(tenant_id, code, title)
        VALUES ('${T1}', '9998', 'Spoofed context')`),
      /row-level security|permission denied/,
    ));
    const spoofed = (await db.adminQuery(`
      SELECT (SELECT count(*)::int FROM tenant_data.accounts WHERE code = '9998') AS accounts,
             (SELECT count(*)::int FROM tenant_data.audit_event
               WHERE detail_jsonb -> 'after' -> 'row' ->> 'code' = '9998') AS audits
    `)).rows[0];
    assert.deepEqual(spoofed, {accounts: 0, audits: 0});

    // Runtime has no audit mutation privileges.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`UPDATE tenant_data.audit_event SET event = 'X'`), /permission denied/));
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query('DELETE FROM tenant_data.audit_event'), /permission denied/));
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query('TRUNCATE tenant_data.audit_event'), /permission denied/));

    // Administrative mutation is refused by the append-only guards, including TRUNCATE.
    await assert.rejects(
      () => db.adminQuery(`UPDATE tenant_data.audit_event SET event = 'X'`),
      /AUDIT_IMMUTABLE|VOID_AUDIT_IMMUTABLE/);
    await assert.rejects(
      () => db.adminQuery('DELETE FROM tenant_data.audit_event'),
      /AUDIT_IMMUTABLE|VOID_AUDIT_IMMUTABLE/);
    await assert.rejects(
      () => db.adminQuery('TRUNCATE tenant_data.audit_event'),
      /AUDIT_TRUNCATE_DENIED/);
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${T1}', NULL, 'user-1', 'AUDIT_TEST', '{}', 0)
    `), {commit: true});
    await assert.rejects(
      () => db.adminQuery(`UPDATE tenant_data.audit SET event = 'X'`),
      /AUDIT_IMMUTABLE|VOID_AUDIT_IMMUTABLE/);
    await assert.rejects(
      () => db.adminQuery('TRUNCATE tenant_data.audit'),
      /AUDIT_TRUNCATE_DENIED/);
  });
});

test('PIVOT-006 business mutation and audit are atomic, including a forced audit failure', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await activate(db);

    await db.adminQuery(`
      CREATE FUNCTION tenant_data.p006_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'P006_INJECTED_AUDIT_FAILURE';
      END;
      $fn$;
      CREATE TRIGGER p006_fail_audit BEFORE INSERT ON tenant_data.audit_event
        FOR EACH ROW EXECUTE FUNCTION tenant_data.p006_fail_audit();
    `);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '9999', 'Should roll back')`),
      /P006_INJECTED_AUDIT_FAILURE/,
    ));
    await db.adminQuery(`
      DROP TRIGGER p006_fail_audit ON tenant_data.audit_event;
      DROP FUNCTION tenant_data.p006_fail_audit();
    `);
    const rolledBack = (await db.adminQuery(`
      SELECT (SELECT count(*)::int FROM tenant_data.accounts WHERE code = '9999') AS accounts,
             (SELECT count(*)::int FROM tenant_data.audit_event
               WHERE detail_jsonb -> 'after' -> 'row' ->> 'code' = '9999') AS audits
    `)).rows[0];
    assert.deepEqual(rolledBack, {accounts: 0, audits: 0});

    // Two concurrent business commits produce two distinct actor-bound audit rows.
    await Promise.all([
      asUser(db, T1, U1, client => client.query(`
        INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '3000', 'Concurrent A')
      `), {commit: true}),
      asUser(db, T1, U1, client => client.query(`
        INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '3001', 'Concurrent B')
      `), {commit: true}),
    ]);
    const concurrent = (await db.adminQuery(`
      SELECT count(*)::int AS n, count(DISTINCT id)::int AS ids,
             count(*) FILTER (WHERE actor_id = 'user-1')::int AS actor_rows
      FROM tenant_data.audit_event
      WHERE entity_type = 'accounts' AND (detail_jsonb -> 'after' -> 'row' ->> 'code') IN ('3000','3001')
    `)).rows[0];
    assert.deepEqual(concurrent, {n: 2, ids: 2, actor_rows: 2});
  });
});

test('PIVOT-006 preserves native financial audit and never recursively audits audit storage', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await activate(db);

    await asUser(db, T1, U1, async client => {
      await client.query(`INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
        VALUES ('${T1}', 'audit-post-1', 'user-1', 'digest-audit-post-1', '{}', 'ACCEPTED_PENDING', 0)`);
      await client.query(`INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
        VALUES ('${T1}', 'audit-post-1', 'alpha', 'main', '2026-11-17', 'audited posting')`);
      await client.query(`INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit)
        VALUES ('${T1}', 'audit-post-1', 1, '1000', 100, 0), ('${T1}', 'audit-post-1', 2, '4000', 0, 100)`);
      await client.query(`INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${T1}', 'audit-post-1', 'user-1', 'JOURNAL_POSTED', '{}', 0)`);
      await client.query(`INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
        VALUES ('${T1}', 'audit-post-1', 'JOURNAL_POSTED', 'READY')`);
      await client.query(`UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE id = 'audit-post-1'`);
    }, {commit: true});

    const native = (await db.adminQuery(`
      SELECT count(*)::int AS n, min(event) AS event, min(detail) AS detail
      FROM tenant_data.audit WHERE command_id = 'audit-post-1'
    `)).rows[0];
    assert.deepEqual(native, {n: 1, event: 'JOURNAL_POSTED', detail: '{}'});

    const changes = (await db.adminQuery(`
      SELECT entity_type, event, count(*)::int AS n
      FROM tenant_data.audit_event
      WHERE entity_type IN ('journals', 'journal_lines')
      GROUP BY entity_type, event ORDER BY entity_type
    `)).rows;
    assert.deepEqual(changes, [
      {entity_type: 'journal_lines', event: 'TENANT_CHANGE_INSERT', n: 2},
      {entity_type: 'journals', event: 'TENANT_CHANGE_INSERT', n: 1},
    ]);

    const recursive = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM tenant_data.audit_event
      WHERE entity_type IN ('audit', 'audit_event')
    `)).rows[0];
    assert.equal(recursive.n, 0);
  });
});

test('PIVOT-006 dispatcher registers 041 alongside 040/042 and re-activation is idempotent', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await activate(db);

    const before = (await db.adminQuery(`
      SELECT count(*) FILTER (WHERE tgname LIKE 'saven_p005_%')::int AS p005,
             count(*) FILTER (WHERE tgname LIKE 'saven_p006_%')::int AS p006
      FROM pg_trigger WHERE NOT tgisinternal
    `)).rows[0];
    assert.ok(before.p005 >= 24);
    assert.ok(before.p006 >= 44);
    for (const trigger of [
      'saven_p005_journals', 'saven_p005_entry_voids', 'saven_p005_correction_commit',
      'saven_p006_audit_accounts', 'saven_p006_audit_journals',
      'saven_p006_audit_append', 'saven_p006_audit_event_append',
      'saven_p006_audit_truncate_audit', 'saven_p006_audit_truncate_audit_event',
    ]) {
      const found = (await db.adminQuery('SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal', [trigger])).rows[0].n;
      assert.equal(found, 1, `missing ${trigger}`);
    }

    // Re-running the dispatcher keeps every prior binding and the audit bindings.
    await activate(db);
    const after = (await db.adminQuery(`
      SELECT count(*) FILTER (WHERE tgname LIKE 'saven_p005_%')::int AS p005,
             count(*) FILTER (WHERE tgname LIKE 'saven_p006_%')::int AS p006
      FROM pg_trigger WHERE NOT tgisinternal
    `)).rows[0];
    assert.deepEqual(after, before);

    // The new payload is immutable and is not silently replaced.
    const auditPayload = await readFile(new URL('db/postgres/migrations/041-audit.sql', repoRoot), 'utf8');
    await assert.rejects(() => db.adminQuery(namespaceSql(auditPayload, db.roles)), /already applied and is immutable/);
    await db.adminQuery('ROLLBACK').catch(() => {});
    const postedPayload = await readFile(new URL('db/postgres/migrations/040-posted-immutability.sql', repoRoot), 'utf8');
    await assert.rejects(() => db.adminQuery(namespaceSql(postedPayload, db.roles)), /already applied and is immutable/);
    await db.adminQuery('ROLLBACK').catch(() => {});
  });
});

test('PIVOT-006 static contract: immutable payload, explicit registration and no runtime audit writes', async () => {
  const audit = await readFile(new URL('db/postgres/migrations/041-audit.sql', repoRoot), 'utf8');
  const dispatcher = await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8');
  const readme = await readFile(new URL('db/postgres/README.md', repoRoot), 'utf8');

  assert.match(audit, /SECURITY DEFINER/);
  assert.match(audit, /NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION/);
  assert.match(audit, /saven_audit_definer/);
  assert.match(audit, /AUDIT-OWNER/);
  assert.match(audit, /session_admitted/);
  assert.match(audit, /AUDIT_CONTEXT_REQUIRED/);
  assert.match(audit, /AUDIT_ACTOR_UNVERIFIED/);
  assert.match(audit, /AUDIT_TARGET_UNRESOLVED/);
  assert.match(audit, /immutability_041_audit_native_guard/);
  assert.match(audit, /AUDIT_ACTOR_MISMATCH/);
  assert.match(audit, /immutability_041_serialize/);
  assert.match(audit, /serializationVersion/);
  assert.match(audit, /AUDIT_SERIALIZATION_UNSUPPORTED/);
  assert.match(audit, /immutability_041_audit_origin/);
  assert.match(audit, /AUDIT_PROVENANCE_INVALID/);
  assert.match(audit, /reference_values/);
  assert.match(audit, /audit_event_id_seq/);
  assert.match(audit, /AUDIT_IMMUTABLE/);
  assert.match(audit, /AUDIT_TRUNCATE_DENIED/);
  assert.match(audit, /TENANT_CHANGE_/);
  assert.match(audit, /immutability_041_row_key/);
  assert.match(audit, /current_tenant_id/);
  assert.match(audit, /current_user_id/);
  assert.doesNotMatch(audit, /GRANT (?:INSERT|UPDATE|DELETE|TRUNCATE)[^;]*TO saven_customer_app/);

  assert.match(dispatcher, /immutability_041_audit_row/);
  assert.match(dispatcher, /immutability_041_audit_native_guard/);
  assert.match(dispatcher, /saven_audit_definer/);
  assert.match(dispatcher, /search_path=pg_catalog, tenant_data/);
  assert.match(dispatcher, /saven_p006_audit_/);
  assert.match(dispatcher, /audit_append_guard/);
  assert.match(dispatcher, /audit_truncate_guard/);
  assert.match(dispatcher, /saven_p005_journals/);
  assert.match(dispatcher, /saven_p005_entry_voids/);
  assert.match(dispatcher, /installed payload version\(s\) % are not registered/);

  assert.match(readme, /041-audit\.sql/);
  assert.match(readme, /PIVOT-006/);
  assert.match(readme, /saven_audit_definer/);
  assert.match(readme, /serialization/i);
  assert.match(readme, /provenance/i);
  assert.match(readme, /quiesc/i);
  assert.match(readme, /append-only actor-bound tenant change audit/i);
});

test('PIVOT-006 dedicated audit owner has only the reviewed authority and refuses polluted owners', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await activate(db);
    const role = db.extraRoles.auditDefiner;
    const attrs = (await db.adminQuery(`
      SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolreplication
      FROM pg_roles WHERE rolname = $1
    `, [role])).rows[0];
    assert.deepEqual(attrs, {
      rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
      rolinherit: false, rolbypassrls: false, rolreplication: false,
    });
    const priv = (await db.adminQuery(`
      SELECT has_schema_privilege($1, 'tenant_data', 'USAGE') AS schema_usage,
             has_schema_privilege($1, 'tenant_data', 'CREATE') AS schema_create,
             has_column_privilege($1, 'tenant_data.members', 'user_id', 'SELECT') AS member_read,
             has_column_privilege($1, 'tenant_data.members', 'active', 'SELECT') AS member_active_read,
             has_column_privilege($1, 'tenant_data.reference_values', 'value', 'SELECT') AS origin_read,
             has_column_privilege($1, 'tenant_data.audit_event', 'actor_id', 'INSERT') AS event_insert,
             has_column_privilege($1, 'tenant_data.audit_event', 'id', 'INSERT') AS event_id_insert,
             has_table_privilege($1, 'tenant_data.audit_event', 'SELECT') AS event_read,
             has_table_privilege($1, 'tenant_data.accounts', 'SELECT') AS account_read,
             has_sequence_privilege($1, 'tenant_data.audit_event_id_seq', 'USAGE') AS seq_usage,
             has_function_privilege($1, 'tenant_data.session_admitted(uuid, uuid)', 'EXECUTE') AS admitted_exec,
             has_function_privilege($1, 'tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)', 'EXECUTE') AS void_exec,
             has_function_privilege($2, 'tenant_data.immutability_041_audit_row()', 'EXECUTE') AS runtime_audit_exec
    `, [role, db.roles.customerApp])).rows[0];
    assert.deepEqual(priv, {
      schema_usage: true, schema_create: false, member_read: true, member_active_read: false,
      origin_read: true, event_insert: true, event_id_insert: false, event_read: false,
      account_read: false, seq_usage: true, admitted_exec: true, void_exec: false,
      runtime_audit_exec: false,
    });

    const owned = (await db.adminQuery(`
      SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
      WHERE r.rolname = $1 AND p.proname LIKE 'immutability_041_%'
      ORDER BY p.proname
    `, [role])).rows;
    assert.equal(owned.length, 5);
    const config = Object.fromEntries(owned.map(row => [row.proname, [row.prosecdef, row.proconfig]]));
    assert.deepEqual(config.immutability_041_row_key, [false, ['search_path=pg_catalog']]);
    assert.deepEqual(config.immutability_041_serialize, [false, ['search_path=pg_catalog']]);
    assert.deepEqual(config.immutability_041_audit_origin, [false, ['search_path=pg_catalog, tenant_data']]);
    assert.deepEqual(config.immutability_041_audit_row, [true, ['search_path=pg_catalog, tenant_data']]);
    assert.deepEqual(config.immutability_041_audit_native_guard, [true, ['search_path=pg_catalog, tenant_data']]);

    const ownership = (await db.adminQuery(`
      SELECT
        (SELECT count(*)::int FROM pg_class c WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = $1)) AS relations,
        (SELECT count(*)::int FROM pg_namespace n WHERE n.nspowner = (SELECT oid FROM pg_roles WHERE rolname = $1)) AS schemas,
        (SELECT count(*)::int FROM pg_auth_members am WHERE am.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
           OR am.roleid = (SELECT oid FROM pg_roles WHERE rolname = $1)) AS memberships
    `, [role])).rows[0];
    assert.deepEqual(ownership, {relations: 0, schemas: 0, memberships: 0});
  });

  const poisonCases = [
    {name: 'extra table ACL', sql: role => `GRANT SELECT ON tenant_data.accounts TO "${role}"`},
    {name: 'schema CREATE', sql: role => `GRANT CREATE ON SCHEMA tenant_data TO "${role}"`},
    {name: 'role membership', sql: (role, db) => `GRANT "${db.roles.migrator}" TO "${role}"`},
    {name: 'relation ownership', sql: role => `
      CREATE TABLE tenant_data.p006_owned_row(id integer);
      ALTER TABLE tenant_data.p006_owned_row OWNER TO "${role}";
    `},
    {name: 'function ownership', sql: role => `
      CREATE FUNCTION tenant_data.p006_owned_fn() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
      ALTER FUNCTION tenant_data.p006_owned_fn() OWNER TO "${role}";
    `},
    {name: 'default privilege', sql: role => `ALTER DEFAULT PRIVILEGES IN SCHEMA tenant_data GRANT SELECT ON TABLES TO "${role}"`},
  ];
  for (const scenario of poisonCases) {
    await withPivotDatabase({
      sqlFiles: schemaFiles,
      adminSqlFiles: ['db/postgres/migrations/031-rls-corrections.sql', 'db/postgres/migrations/032-rls-hardening.sql', 'db/postgres/migrations/042-entry-voiding.sql'],
    }, async db => {
      await seed(db);
      const role = db.extraRoles.auditDefiner;
      await db.adminQuery(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
      await db.adminQuery(scenario.sql(role, db));
      const before = (await db.adminQuery(`
        SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolreplication
        FROM pg_roles WHERE rolname = $1
      `, [role])).rows[0];
      const sql = namespaceSql(await readFile(new URL('db/postgres/migrations/041-audit.sql', repoRoot), 'utf8'), db.roles);
      await assert.rejects(() => db.adminQuery(sql), /AUDIT-OWNER/, `${scenario.name} should refuse`);
      await db.adminQuery('ROLLBACK').catch(() => {});
      const after = (await db.adminQuery(`
        SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolreplication
        FROM pg_roles WHERE rolname = $1
      `, [role])).rows[0];
      assert.deepEqual(after, before, `${scenario.name}: role definition is untouched`);
      const functions = (await db.adminQuery(`
        SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'immutability_041_%'
      `)).rows[0].n;
      assert.equal(functions, 0, `${scenario.name}: no audit functions are created`);
      if (scenario.name === 'extra table ACL') {
        const still = (await db.adminQuery(`SELECT has_table_privilege($1, 'tenant_data.accounts', 'SELECT') AS n`, [role])).rows[0].n;
        assert.equal(still, true, 'unrelated prior grants are not silently stripped');
      }
    });
  }
});

test('PIVOT-006 native audit inserts are bound to the admitted actor and tenant', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await seedVoidFixture(db);
    await activate(db);

    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${T1}', NULL, 'user-1', 'AUDIT_ACCEPTED', '{}', 0)
    `), {commit: true});
    const accepted = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM tenant_data.audit WHERE event = 'AUDIT_ACCEPTED' AND actor = 'user-1'
    `)).rows[0].n;
    assert.equal(accepted, 1);

    for (const actor of ['user-2', 'invented-actor']) {
      await asUser(db, T1, U1, client => assert.rejects(
        () => client.query(`
          INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
            VALUES ('${T1}', NULL, '${actor}', 'AUDIT_SPOOF', '{}', 0)
        `),
        /AUDIT_ACTOR_MISMATCH/,
      ));
    }
    await assert.rejects(
      () => db.adminQuery(`
        INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
          VALUES ('${T1}', NULL, 'user-1', 'AUDIT_NO_CONTEXT', '{}', 0)
      `),
      /AUDIT_CONTEXT_REQUIRED/,
    );
    const spoofed = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM tenant_data.audit WHERE event IN ('AUDIT_SPOOF','AUDIT_NO_CONTEXT')
    `)).rows[0].n;
    assert.equal(spoofed, 0);

    // A command-linked transaction rolls back both the native audit row and its event.
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${T1}', NULL, 'user-1', 'AUDIT_ROLLBACK', '{}', 0)
    `), {commit: false});
    const rolledBack = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM tenant_data.audit WHERE event = 'AUDIT_ROLLBACK'
    `)).rows[0].n;
    assert.equal(rolledBack, 0);

    // The existing void definer path writes ENTRY_VOIDED with the admitted actor.
    await asUser(db, T1, U1, client => client.query(`
      SELECT tenant_data.void_posted_entry('${T1}'::uuid, 'p006-void', 'user-1', 'audit void', 'p006-void-1')
    `), {commit: true});
    const voidAudit = (await db.adminQuery(`
      SELECT count(*)::int AS n, min(actor) AS actor
      FROM tenant_data.audit WHERE event = 'ENTRY_VOIDED'
    `)).rows[0];
    assert.deepEqual(voidAudit, {n: 1, actor: 'user-1'});
    const voidRecords = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM tenant_data.entry_voids WHERE entry_id = 'p006-void'
    `)).rows[0].n;
    assert.equal(voidRecords, 1);
  });
});

test('PIVOT-006 serialization redacts extensible payloads and validates provenance', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await activate(db);

    const secretJson = 'P006_JSON_SECRET_7f3a';
    const secretText = 'P006_TEXT_SECRET_91b2';
    const secretSnapshot = 'P006_SNAPSHOT_SECRET_44c1';

    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.business_rule(tenant_id, rule_key, version, scope_type, config_jsonb, config_schema_version, is_active)
        VALUES ('${T1}', 'p006-secret', 1, 'tenant', '{"apiToken":"${secretJson}","thresholdMinor":100}', 1, true)
    `), {commit: true});
    await asUser(db, T1, U1, client => client.query(`
      UPDATE tenant_data.business_rule
         SET config_jsonb = '{"apiToken":"${secretJson}_updated","thresholdMinor":200}'
       WHERE tenant_id = '${T1}' AND rule_key = 'p006-secret' AND version = 1
    `), {commit: true});
    const ruleAudits = (await db.adminQuery(`
      SELECT event, detail_jsonb FROM tenant_data.audit_event
      WHERE entity_type = 'business_rule' ORDER BY id
    `)).rows;
    assert.deepEqual(ruleAudits.map(row => row.event),
      ['TENANT_CHANGE_INSERT', 'TENANT_CHANGE_UPDATE']);
    for (const row of ruleAudits) {
      assert.ok(!JSON.stringify(row.detail_jsonb).includes(secretJson));
      const snapshot = row.detail_jsonb.after;
      assert.equal(snapshot.row.config_jsonb.redacted, true);
      assert.ok(snapshot.redactedColumns.includes('config_jsonb'));
    }

    // Text payload redaction across INSERT/UPDATE/DELETE uses a table whose runtime
    // grant includes DELETE.
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
        VALUES ('${T1}', 'p006-secret-role', 'Secret role', false, '{"apiToken":"${secretText}"}')
    `), {commit: true});
    await asUser(db, T1, U1, client => client.query(`
      UPDATE tenant_data.roles SET permissions = '{"apiToken":"${secretText}_updated"}'
       WHERE tenant_id = '${T1}' AND id = 'p006-secret-role'
    `), {commit: true});
    await asUser(db, T1, U1, client => client.query(`
      DELETE FROM tenant_data.roles WHERE tenant_id = '${T1}' AND id = 'p006-secret-role'
    `), {commit: true});
    const roleAudits = (await db.adminQuery(`
      SELECT event, detail_jsonb FROM tenant_data.audit_event
      WHERE entity_type = 'roles' AND entity_id LIKE '%p006-secret-role%' ORDER BY id
    `)).rows;
    assert.deepEqual(roleAudits.map(row => row.event),
      ['TENANT_CHANGE_INSERT', 'TENANT_CHANGE_UPDATE', 'TENANT_CHANGE_DELETE']);
    for (const row of roleAudits) {
      assert.ok(!JSON.stringify(row.detail_jsonb).includes(secretText));
      const snapshot = row.event === 'TENANT_CHANGE_DELETE' ? row.detail_jsonb.before : row.detail_jsonb.after;
      assert.equal(snapshot.row.permissions.redacted, true);
      assert.ok(snapshot.redactedColumns.includes('permissions'));
    }

    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.document_registry(tenant_id, document_id, document_type, document_status, company, branch,
        origin_type, origin_user_id, origin_model, origin_model_version)
        VALUES ('${T1}', 'p006-doc', 'journal', 'PENDING_APPROVAL', 'alpha', 'main', 'human', 'user-1', NULL, NULL)
    `), {commit: true});
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.document_revisions(tenant_id, document_id, revision, document_type, document_status,
        payload, payload_digest, policy_snapshot, origin_type, origin_user_id, origin_model, origin_model_version)
        VALUES ('${T1}', 'p006-doc', 1, 'journal', 'PENDING_APPROVAL',
          '{"password":"${secretText}","amount":100}', 'd', '{"token":"${secretSnapshot}"}', 'human', 'user-1', NULL, NULL)
    `), {commit: true});
    const revisionAudit = (await db.adminQuery(`
      SELECT detail_jsonb FROM tenant_data.audit_event
      WHERE entity_type = 'document_revisions' ORDER BY id DESC LIMIT 1
    `)).rows[0].detail_jsonb;
    assert.ok(!JSON.stringify(revisionAudit).includes(secretText));
    assert.ok(!JSON.stringify(revisionAudit).includes(secretSnapshot));
    assert.equal(revisionAudit.after.row.payload.redacted, true);
    assert.equal(revisionAudit.after.row.policy_snapshot.redacted, true);
    assert.ok(revisionAudit.after.redactedColumns.includes('payload'));
    assert.ok(revisionAudit.after.redactedColumns.includes('policy_snapshot'));

    // Safe business values remain visible.
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '2200', 'Safe audit account')
    `), {commit: true});
    const safe = (await db.adminQuery(`
      SELECT detail_jsonb FROM tenant_data.audit_event
      WHERE entity_type = 'accounts' AND detail_jsonb -> 'after' -> 'row' ->> 'code' = '2200'
      ORDER BY id DESC LIMIT 1
    `)).rows[0].detail_jsonb;
    assert.equal(safe.after.row.title, 'Safe audit account');
    assert.ok(!safe.after.redactedColumns.includes('title'));

    // Unsupported column shapes fail closed and roll the business mutation back.
    await db.adminQuery('ALTER TABLE tenant_data.accounts ADD COLUMN p006_blob bytea');
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '9997', 'Unsupported')`),
      /AUDIT_SERIALIZATION_UNSUPPORTED/,
    ));
    await db.adminQuery('ALTER TABLE tenant_data.accounts DROP COLUMN p006_blob');
    const unsupported = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM tenant_data.accounts WHERE code = '9997'
    `)).rows[0].n;
    assert.equal(unsupported, 0);

    // Human / AI / integration document origins are retained distinctly.
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.document_registry(tenant_id, document_id, document_type, document_status, company, branch,
        origin_type, origin_user_id, origin_model, origin_model_version)
        VALUES ('${T1}', 'p006-ai', 'journal', 'PENDING_APPROVAL', 'alpha', 'main', 'ai', 'user-1', 'p006-model', '1')
    `), {commit: true});
    const aiAudit = (await db.adminQuery(`
      SELECT origin_type, origin_user_id, origin_model, origin_model_version, detail_jsonb
      FROM tenant_data.audit_event WHERE entity_type = 'document_registry' AND entity_id LIKE '%p006-ai%'
      ORDER BY id DESC LIMIT 1
    `)).rows[0];
    assert.equal(aiAudit.origin_type, 'ai');
    assert.equal(aiAudit.origin_user_id, 'user-1');
    assert.equal(aiAudit.origin_model, 'p006-model');
    assert.equal(aiAudit.origin_model_version, '1');
    assert.equal(aiAudit.detail_jsonb.provenance, 'row-declared');

    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.document_registry(tenant_id, document_id, document_type, document_status, company, branch,
        origin_type, origin_user_id, origin_model, origin_model_version)
        VALUES ('${T1}', 'p006-integration', 'journal', 'PENDING_APPROVAL', 'alpha', 'main', 'integration', 'svc-p006', 'adapter', '2')
    `), {commit: true});
    const integrationAudit = (await db.adminQuery(`
      SELECT origin_type, origin_user_id, origin_model, origin_model_version
      FROM tenant_data.audit_event WHERE entity_type = 'document_registry' AND entity_id LIKE '%p006-integration%'
      ORDER BY id DESC LIMIT 1
    `)).rows[0];
    assert.deepEqual(integrationAudit, {
      origin_type: 'integration', origin_user_id: 'svc-p006', origin_model: 'adapter', origin_model_version: '2',
    });

    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.document_registry(tenant_id, document_id, document_type, document_status, company, branch,
        origin_type, origin_user_id)
        VALUES ('${T1}', 'p006-human', 'journal', 'PENDING_APPROVAL', 'alpha', 'main', 'human', NULL)
    `), {commit: true});
    const humanAudit = (await db.adminQuery(`
      SELECT origin_type, origin_user_id, origin_model
      FROM tenant_data.audit_event WHERE entity_type = 'document_registry' AND entity_id LIKE '%p006-human%'
      ORDER BY id DESC LIMIT 1
    `)).rows[0];
    assert.deepEqual(humanAudit, {origin_type: 'human', origin_user_id: 'user-1', origin_model: null});

    // Spoofed/invalid provenance fails closed.
    for (const [documentId, originType, originUser, originModel] of [
      ['p006-ai-no-model', 'ai', 'user-1', null],
      ['p006-ai-ghost', 'ai', 'ghost-user', 'model'],
      ['p006-human-model', 'human', 'user-1', 'forged-model'],
      ['p006-bogus', 'bogus', 'user-1', null],
    ]) {
      await asUser(db, T1, U1, client => assert.rejects(
        () => client.query(`
          INSERT INTO tenant_data.document_registry(tenant_id, document_id, document_type, document_status, company, branch,
            origin_type, origin_user_id, origin_model)
            VALUES ('${T1}', '${documentId}', 'journal', 'PENDING_APPROVAL', 'alpha', 'main', '${originType}', '${originUser}', ${originModel === null ? 'NULL' : `'${originModel}'`})
        `),
        /AUDIT_PROVENANCE_INVALID/,
      ));
    }
    const spoofedDocs = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM tenant_data.document_registry WHERE document_id LIKE 'p006-%'
        AND document_id IN ('p006-ai-no-model','p006-ai-ghost','p006-human-model','p006-bogus')
    `)).rows[0].n;
    assert.equal(spoofedDocs, 0);

    // A client-supplied GUC cannot manufacture document/proposal provenance on generic rows.
    await asUser(db, T1, U1, async client => {
      await client.query("SELECT set_config('app.origin_type', 'ai', true)");
      await client.query(`INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '2300', 'GUC provenance')`);
    }, {commit: true});
    const gucAudit = (await db.adminQuery(`
      SELECT origin_type, origin_user_id, detail_jsonb FROM tenant_data.audit_event
      WHERE entity_type = 'accounts' AND detail_jsonb -> 'after' -> 'row' ->> 'code' = '2300'
      ORDER BY id DESC LIMIT 1
    `)).rows[0];
    assert.equal(gucAudit.origin_type, 'system');
    assert.equal(gucAudit.origin_user_id, null);
    assert.equal(gucAudit.detail_jsonb.provenance, 'unavailable');
  });
});

test('PIVOT-006 activation is atomic and the 041-without-dispatcher window is explicit', async () => {
  // Function-only 041 is not audit-active until the dispatcher attaches and validates
  // every trigger. A write in that window is unaudited; operators must quiesce.
  await withPivotDatabase({
    sqlFiles: schemaFiles,
    adminSqlFiles: [...adminSqlFiles.filter(file => !file.endsWith('40-triggers.sql'))],
  }, async db => {
    await seed(db);
    const before = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'saven_p006_%' AND NOT tgisinternal
    `)).rows[0].n;
    assert.equal(before, 0);
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '4100', 'Pre-activation')
    `), {commit: true});
    const unaudited = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM tenant_data.audit_event
      WHERE entity_type = 'accounts' AND detail_jsonb -> 'after' -> 'row' ->> 'code' = '4100'
    `)).rows[0].n;
    assert.equal(unaudited, 0);

    await activate(db);
    const after = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'saven_p006_%' AND NOT tgisinternal
    `)).rows[0].n;
    assert.ok(after > 0);
    await asUser(db, T1, U1, client => client.query(`
      INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ('${T1}', '4101', 'Post-activation')
    `), {commit: true});
    const audited = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM tenant_data.audit_event
      WHERE entity_type = 'accounts' AND detail_jsonb -> 'after' -> 'row' ->> 'code' = '4101'
    `)).rows[0].n;
    assert.equal(audited, 1);
  });

  // A failed dispatcher transaction leaves no partial audit or 040/042 trigger set.
  await withPivotDatabase({
    sqlFiles: schemaFiles,
    adminSqlFiles: [...adminSqlFiles.filter(file => !file.endsWith('40-triggers.sql'))],
  }, async db => {
    await seed(db);
    const dispatcher = await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8');
    const broken = dispatcher.replace("r.rolname = 'saven_audit_definer'", "r.rolname = 'saven_p006_missing'");
    await assert.rejects(() => db.adminQuery(namespaceSql(broken, db.roles)), /PIVOT-006/);
    await db.adminQuery('ROLLBACK').catch(() => {});
    const partial = (await db.adminQuery(`
      SELECT count(*) FILTER (WHERE tgname LIKE 'saven_p005_%')::int AS p005,
             count(*) FILTER (WHERE tgname LIKE 'saven_p006_%')::int AS p006
      FROM pg_trigger WHERE NOT tgisinternal
    `)).rows[0];
    assert.deepEqual(partial, {p005: 0, p006: 0});
    await activate(db);
    const complete = (await db.adminQuery(`
      SELECT count(*) FILTER (WHERE tgname LIKE 'saven_p005_%')::int AS p005,
             count(*) FILTER (WHERE tgname LIKE 'saven_p006_%')::int AS p006
      FROM pg_trigger WHERE NOT tgisinternal
    `)).rows[0];
    assert.ok(complete.p005 > 0);
    assert.ok(complete.p006 > 0);
  });

  // A partial 041 payload (missing actor-binding guard) refuses activation and attaches
  // no audit trigger set.
  await withPivotDatabase({
    sqlFiles: schemaFiles,
    adminSqlFiles: [...adminSqlFiles.filter(file => !file.endsWith('40-triggers.sql'))],
  }, async db => {
    await seed(db);
    await db.adminQuery('DROP FUNCTION tenant_data.immutability_041_audit_native_guard()');
    const dispatcher = await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8');
    await assert.rejects(() => db.adminQuery(namespaceSql(dispatcher, db.roles)),
      /incomplete PIVOT-006 audit payload 041|not registered|required payload/);
    await db.adminQuery('ROLLBACK').catch(() => {});
    const triggers = (await db.adminQuery(`
      SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'saven_p006_%' AND NOT tgisinternal
    `)).rows[0].n;
    assert.equal(triggers, 0);
  });

  // An interrupted 041 installation rolls back the dedicated owner and every function.
  await withPivotDatabase({
    sqlFiles: schemaFiles,
    adminSqlFiles: ['db/postgres/migrations/031-rls-corrections.sql', 'db/postgres/migrations/032-rls-hardening.sql', 'db/postgres/migrations/042-entry-voiding.sql'],
  }, async db => {
    await seed(db);
    const auditSql = await readFile(new URL('db/postgres/migrations/041-audit.sql', repoRoot), 'utf8');
    const broken = auditSql.replace(
      'SELECT pg_temp.saven_assert_audit_owner();',
      'GRANT USAGE ON SCHEMA tenant_data TO saven_p006_missing;',
    );
    await assert.rejects(() => db.adminQuery(namespaceSql(broken, db.roles)), /saven_p006_missing|does not exist/);
    await db.adminQuery('ROLLBACK').catch(() => {});
    const owner = (await db.adminQuery('SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1', [db.extraRoles.auditDefiner])).rows[0].n;
    const functions = (await db.adminQuery("SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'immutability_041_%'")).rows[0].n;
    assert.deepEqual({owner, functions}, {owner: 0, functions: 0});
  });
});
