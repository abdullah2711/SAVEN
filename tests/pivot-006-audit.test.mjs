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
  'db/postgres/migrations/041-audit.sql',
];
const adminSqlFiles = [
  'db/postgres/migrations/031-rls-corrections.sql',
  'db/postgres/migrations/032-rls-hardening.sql',
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
  `);
  await addIdentity(db, {tenant, user, legacy, email});
}

async function activate(db) {
  const dispatcher = await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8');
  await db.adminQuery(namespaceSql(dispatcher, db.roles));
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
    assert.equal(inserted.origin_type, 'human');
    assert.equal(inserted.origin_user_id, 'user-1');
    assert.equal(inserted.request_id, null);
    assert.equal(inserted.detail_jsonb.action, 'INSERT');
    assert.equal(inserted.detail_jsonb.schemaVersion, 1);
    assert.equal(inserted.detail_jsonb.version, 1);
    assert.ok(inserted.detail_jsonb.transactionId);
    assert.equal(inserted.detail_jsonb.before, null);
    assert.equal(inserted.detail_jsonb.after.code, '2000');
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
    assert.equal(updated.origin_user_id, 'user-1');
    assert.equal(updated.detail_jsonb.before.title, 'Audit account');
    assert.equal(updated.detail_jsonb.after.title, 'Audit account updated');
    assert.equal(updated.detail_jsonb.after.updated_by, 'user-2');

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
    assert.equal(deleted.detail_jsonb.before.id, 'audit-role');
    assert.equal(deleted.detail_jsonb.before.created_by, 'user-2');
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
               WHERE detail_jsonb -> 'after' ->> 'code' = '9998') AS audits
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
    await db.adminQuery(`
      INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${T1}', NULL, 'user-1', 'AUDIT_TEST', '{}', 0)
    `);
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
               WHERE detail_jsonb -> 'after' ->> 'code' = '9999') AS audits
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
      WHERE entity_type = 'accounts' AND (detail_jsonb -> 'after' ->> 'code') IN ('3000','3001')
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
  assert.match(audit, /AUDIT_CONTEXT_REQUIRED/);
  assert.match(audit, /AUDIT_ACTOR_UNVERIFIED/);
  assert.match(audit, /AUDIT_TARGET_UNRESOLVED/);
  assert.match(audit, /AUDIT_IMMUTABLE/);
  assert.match(audit, /AUDIT_TRUNCATE_DENIED/);
  assert.match(audit, /TENANT_CHANGE_/);
  assert.match(audit, /immutability_041_row_key/);
  assert.match(audit, /current_tenant_id/);
  assert.match(audit, /current_user_id/);
  assert.doesNotMatch(audit, /GRANT (?:INSERT|UPDATE|DELETE|TRUNCATE)[^;]*TO saven_customer_app/);

  assert.match(dispatcher, /immutability_041_audit_row/);
  assert.match(dispatcher, /saven_p006_audit_/);
  assert.match(dispatcher, /audit_append_guard/);
  assert.match(dispatcher, /audit_truncate_guard/);
  assert.match(dispatcher, /saven_p005_journals/);
  assert.match(dispatcher, /saven_p005_entry_voids/);
  assert.match(dispatcher, /installed payload version\(s\) % are not registered/);

  assert.match(readme, /041-audit\.sql/);
  assert.match(readme, /PIVOT-006/);
  assert.match(readme, /append-only actor-bound tenant change audit/i);
});
