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
  'db/postgres/migrations/042-entry-voiding.sql',
  'db/postgres/40-triggers.sql',
];

const T1 = '11111111-1111-4111-8111-111111111111';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const asUser = (db, tenant, user, run, options = {}) => db.asRole('customerApp', async client => {
  if (tenant !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenant]);
  if (user !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', user]);
  return run(client);
}, options);

async function seed(db, {tenant = T1, user = U1, legacy = 'user-1', email = 'u1@example.test'} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.business(tenant_id, id, state) VALUES ('${tenant}', 'alpha', 'ACTIVE');
    INSERT INTO tenant_data.company_profiles(tenant_id, id, name, currency, branch, created_at)
      VALUES ('${tenant}', 'alpha', 'Alpha', 'PKR', 'main', 0);
    INSERT INTO auth.users(id, legacy_id, email, status) VALUES ('${user}', '${legacy}', '${email}', 'active');
    INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
      VALUES ('${tenant}', '${user}', 'ultimate_owner', 'active', now(), now());
    INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active)
      VALUES ('${tenant}', '${legacy}', '${user}', true);
    INSERT INTO tenant_data.accounts(tenant_id, code, title)
      VALUES ('${tenant}', '1000', 'Cash'), ('${tenant}', '4000', 'Revenue');
  `);
}

async function grantVoid(db, {tenant = T1, legacy = 'user-1', roleId = 'clerk', review = false, maxMinor = null, companies = ['*'], accounts = ['*']} = {}) {
  const permissions = {
    actions: ['accounting.entry.void'],
    companies,
    branches: ['*'],
    accounts,
    review,
  };
  if (maxMinor !== null) permissions.maxMinor = maxMinor;
  await db.adminQuery(`
    INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
      VALUES ('${tenant}', '${roleId}', 'Clerk', false, '${JSON.stringify(permissions)}');
    INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id)
      VALUES ('${tenant}', '${legacy}', '${roleId}');
  `);
}

async function postedEntry(db, id, {tenant = T1, actor = 'user-1', debit = 100, state = 'POSTED'} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
      VALUES ('${tenant}', '${id}', '${actor}', 'digest-${id}', '{}', 'ACCEPTED_PENDING', 0);
    INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
      VALUES ('${tenant}', '${id}', 'alpha', 'main', '2026-11-16', 'entry');
    INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES
      ('${tenant}', '${id}', 1, '1000', ${debit}, 0), ('${tenant}', '${id}', 2, '4000', 0, ${debit});
  `);
  if (state === 'POSTED') {
    await db.adminQuery(`
      INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${tenant}', '${id}', '${actor}', 'JOURNAL_POSTED', '{}', 0);
      INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
        VALUES ('${tenant}', '${id}', 'JOURNAL_POSTED', 'READY');
      UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE tenant_id = '${tenant}' AND id = '${id}';
    `);
  } else if (state !== 'ACCEPTED_PENDING') {
    await db.adminQuery(`UPDATE tenant_data.command_inbox SET state = '${state}' WHERE tenant_id = '${tenant}' AND id = '${id}'`);
  }
}

const voidArgs = (entry, {actor = 'user-1', key = 'idem-1', reason = 'duplicate', approval = null} = {}) =>
  `'${T1}'::uuid, '${entry}', '${actor}', '${reason}', '${key}'` +
  (approval === null ? '' : `, '${approval}'`);

test('PIVOT-005 active GL follows the source lifecycle and excludes voided entries', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'posted-1', {debit: 250});
    await postedEntry(db, 'accepted-1', {debit: 999, state: 'ACCEPTED_PENDING'});
    await postedEntry(db, 'failed-1', {debit: 777, state: 'FAILED'});

    const totals = await db.adminQuery(`
      SELECT
        (SELECT count(*)::int FROM tenant_data.active_general_ledger) AS rows,
        (SELECT coalesce(sum(debit),0)::text FROM tenant_data.active_general_ledger) AS debit,
        (SELECT count(*)::int FROM tenant_data.journal_lines WHERE journal_id IN ('accepted-1','failed-1')) AS unposted_rows
    `);
    assert.deepEqual(totals.rows[0], {rows: 2, debit: '250', unposted_rows: 4});

    const voidId = await asUser(db, T1, U1, async client =>
      (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('posted-1')}) AS id`)).rows[0].id, {commit: true});

    const after = (
      await db.adminQuery(`
        SELECT (SELECT count(*)::int FROM tenant_data.active_general_ledger) AS active,
               (SELECT count(*)::int FROM tenant_data.voided_entries) AS voided,
               (SELECT state FROM tenant_data.command_inbox WHERE id = 'posted-1') AS receipt,
               (SELECT count(*)::int FROM tenant_data.journal_lines WHERE journal_id = 'posted-1') AS raw
      `)
    ).rows[0];
    assert.deepEqual(after, {active: 0, voided: 2, receipt: 'POSTED', raw: 2});
    assert.ok(voidId);
  });
});

test('PIVOT-005 void authority uses canonical permissions, denials, scope and approvals', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await seed(db, {tenant: '22222222-2222-4222-8222-222222222222', user: U2, legacy: 'user-2', email: 'u2@example.test'});
    await grantVoid(db);
    await postedEntry(db, 'perm-1');
    await postedEntry(db, 'perm-2');
    await postedEntry(db, 'perm-locked');

    // Protected ultimate owner authority still applies.
    await db.adminQuery(`INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions) VALUES ('${T1}','ultimate_business_admin','Owner',true,'{}')`);
    await db.adminQuery(`INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id) VALUES ('${T1}','user-1','ultimate_business_admin')`);
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-1', {key: 'owner-1'})})`), {commit: true});

    // Explicit denial wins even with a protected owner assignment.
    await db.adminQuery(`INSERT INTO tenant_data.denials(tenant_id, user_id, action) VALUES ('${T1}','user-1','accounting.entry.void')`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-2', {key: 'denied-1'})})`),
      /VOID_ACTION_DENIED/,
    ));
    await db.adminQuery(`DELETE FROM tenant_data.denials WHERE tenant_id = '${T1}'`);

    // Locked period is enforced, not overridden by voiding.
    await db.adminQuery(`INSERT INTO tenant_data.periods(tenant_id, company, start_date, end_date, locked) VALUES ('${T1}','alpha','2026-11-01','2026-11-30',true)`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-locked', {key: 'locked-1'})})`),
      /VOID_PERIOD_LOCKED/,
    ));
    await db.adminQuery(`DELETE FROM tenant_data.periods WHERE tenant_id = '${T1}'`);

    // Resource scope: a second user cannot void a company they are not scoped to.
    await db.adminQuery(`
      INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
        VALUES ('${T1}','scoped','Scoped',false,'{"actions":["accounting.entry.void"],"companies":["other"],"branches":["*"],"accounts":["*"],"review":false}');
      INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id) VALUES ('${T1}','user-1','scoped');
    `);
    await db.adminQuery(`DELETE FROM tenant_data.assignments WHERE tenant_id = '${T1}' AND role_id IN ('ultimate_business_admin','clerk')`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-2', {key: 'scope-1'})})`),
      /VOID_ACTION_REQUIRED/,
    ));
    // maxMinor bound.
    await db.adminQuery(`
      UPDATE tenant_data.roles SET permissions = '{"actions":["accounting.entry.void"],"companies":["*"],"branches":["*"],"accounts":["*"],"review":false,"maxMinor":50}'
      WHERE tenant_id = '${T1}' AND id = 'scoped';
    `);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-2', {key: 'amount-1'})})`),
      /VOID_ACTION_REQUIRED/,
    ));
  });
});

test('PIVOT-005 review-required voids need an independent, digest-bound approval', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await db.adminQuery(`
      INSERT INTO auth.users(id, legacy_id, email, status) VALUES ('${U2}', 'user-2', 'u2@example.test', 'active');
      INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
        VALUES ('${T1}', '${U2}', 'ultimate_owner', 'active', now(), now());
      INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active)
        VALUES ('${T1}', 'user-2', '${U2}', true);
    `);
    await grantVoid(db, {review: true});
    await postedEntry(db, 'approval-1');

    // Without a pre-registered approved receipt the void is refused.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('approval-1', {key: 'ap-1'})})`),
      /VOID_APPROVAL_REQUIRED/,
    ));

    // Stale decision binding: receipt + pending approval with a wrong decision digest.
    const digest = (await db.adminQuery(`
      SELECT encode(sha256(convert_to(concat_ws('|', 'approval-1', 'user-1', 'duplicate', 'ap-2'), 'UTF8')), 'hex') AS d
    `)).rows[0].d;
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
        VALUES ('${T1}', 'void-cmd-1', 'user-1', 'd', '{"requestDigest":"${digest}"}', 'ACCEPTED_PENDING', 0);
      INSERT INTO tenant_data.approval_requests(tenant_id, command_id, payload_digest, policy_snapshot, state)
        VALUES ('${T1}', 'void-cmd-1', '${digest}', '{"decisionDigest":"stale"}', 'PENDING');
      UPDATE tenant_data.approval_requests SET state = 'APPROVED', decided_by = 'user-2'
        WHERE tenant_id = '${T1}' AND command_id = 'void-cmd-1';
    `);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('approval-1', {key: 'ap-2', approval: 'void-cmd-1'})})`),
      /VOID_APPROVAL_STALE/,
    ));

    // A correct, independent, digest-bound approval authorises the void.
    const decisionDigest = (await db.adminQuery(`
      SELECT tenant_data.immutability_042_decision_digest(
        tenant_data.immutability_042_policy_decision('${T1}'::uuid, 'user-1', 100, 'alpha', 'main', ARRAY['1000','4000'])
      ) AS d
    `)).rows[0].d;
    const digest2 = (await db.adminQuery(`
      SELECT encode(sha256(convert_to(concat_ws('|', 'approval-1', 'user-1', 'duplicate', 'ap-3'), 'UTF8')), 'hex') AS d
    `)).rows[0].d;
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
        VALUES ('${T1}', 'void-cmd-2', 'user-1', 'd', '{"requestDigest":"${digest2}"}', 'ACCEPTED_PENDING', 0);
      INSERT INTO tenant_data.approval_requests(tenant_id, command_id, payload_digest, policy_snapshot, state, decided_by)
        VALUES ('${T1}', 'void-cmd-2', '${digest2}', '{"decisionDigest":"${decisionDigest}"}', 'APPROVED', 'user-2');
    `);
    const approved = await asUser(db, T1, U1, async client =>
      (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('approval-1', {key: 'ap-3', approval: 'void-cmd-2'})}) AS id`)).rows[0].id, {commit: true});
    assert.equal(approved, 'void-cmd-2');
    const voided = (await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.voided_entries`)).rows[0].n;
    assert.equal(voided, 2);
  });
});

test('PIVOT-005 runtime role posts through effects and rejects incomplete postings', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db, {review: false});

    // Full accepted -> effects -> POSTED as the actual runtime role.
    const posted = await asUser(db, T1, U1, async client => {
      await client.query(`INSERT INTO tenant_data.command_inbox(tenant_id,id,actor,digest,payload,state,created_at)
        VALUES ('${T1}','rt-1','user-1','d','{}','ACCEPTED_PENDING',0)`);
      await client.query(`INSERT INTO tenant_data.journals(tenant_id,id,company,branch,posting_date,narrative)
        VALUES ('${T1}','rt-1','alpha','main','2026-11-16','runtime')`);
      await client.query(`INSERT INTO tenant_data.journal_lines(tenant_id,journal_id,line_no,account,debit,credit)
        VALUES ('${T1}','rt-1',1,'1000',75,0),('${T1}','rt-1',2,'4000',0,75)`);
      await client.query(`INSERT INTO tenant_data.audit(tenant_id,command_id,actor,event,detail,happened_at)
        VALUES ('${T1}','rt-1','user-1','JOURNAL_POSTED','{}',0)`);
      await client.query(`INSERT INTO tenant_data.outbox(tenant_id,id,event,state) VALUES ('${T1}','rt-1','JOURNAL_POSTED','READY')`);
      await client.query(`UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='rt-1'`);
      return (await client.query(`SELECT state FROM tenant_data.command_inbox WHERE id='rt-1'`)).rows[0].state;
    }, {commit: true});
    assert.equal(posted, 'POSTED');

    // Missing audit/outbox effects are refused for the runtime too.
    await asUser(db, T1, U1, async client => {
      await client.query(`INSERT INTO tenant_data.command_inbox(tenant_id,id,actor,digest,payload,state,created_at)
        VALUES ('${T1}','rt-2','user-1','d','{}','ACCEPTED_PENDING',0)`);
      await client.query(`INSERT INTO tenant_data.journals(tenant_id,id,company,branch,posting_date,narrative)
        VALUES ('${T1}','rt-2','alpha','main','2026-11-16','x')`);
      await client.query(`INSERT INTO tenant_data.journal_lines(tenant_id,journal_id,line_no,account,debit,credit)
        VALUES ('${T1}','rt-2',1,'1000',10,0),('${T1}','rt-2',2,'4000',0,10)`);
      await client.query('SAVEPOINT s');
      await assert.rejects(() => client.query(`UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='rt-2'`), /POSTED_REQUIRES_AUDIT/);
      await client.query('ROLLBACK TO SAVEPOINT s');
    });
  });
});

test('PIVOT-005 terminal, replay and correction invariants hold', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'term-1');

    const first = await asUser(db, T1, U1, async client =>
      (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('term-1')}) AS id`)).rows[0].id, {commit: true});
    const replay = await asUser(db, T1, U1, async client => ({
      id: (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('term-1')}) AS id`)).rows[0].id,
      rows: (await client.query('SELECT count(*)::int AS n FROM tenant_data.entry_voids')).rows[0].n,
    }));
    assert.deepEqual(replay, {id: first, rows: 1});

    await assert.rejects(() => db.adminQuery(`UPDATE tenant_data.entry_voids SET reason='x'`), /VOIDED_IMMUTABLE/);
    await assert.rejects(() => db.adminQuery(`DELETE FROM tenant_data.entry_voids`), /VOID_RETAINED/);
    await assert.rejects(() => db.adminQuery(`UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='${first}'`), /VOID|IMMUTABLE|POSTED_/);
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.journal_corrections(tenant_id,command_id,original_id,reason) VALUES ('${T1}','${first}','term-1','x')`),
      /CORRECTION_/,
    );
  });
});

test('PIVOT-005 corrections and voids serialize with commit-time invariants', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'race-1');
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
        VALUES ('${T1}', 'reversal-1', 'user-1', 'd', '{}', 'ACCEPTED_PENDING', 0);
      INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
        VALUES ('${T1}', 'reversal-1', 'alpha', 'main', '2026-11-16', 'reversal');
      INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES
        ('${T1}', 'reversal-1', 1, '1000', 0, 100), ('${T1}', 'reversal-1', 2, '4000', 100, 0);
      INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${T1}', 'reversal-1', 'user-1', 'JOURNAL_POSTED', '{}', 0);
      INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
        VALUES ('${T1}', 'reversal-1', 'JOURNAL_POSTED', 'READY');
      UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='reversal-1';
    `);

    // Correction first, void second: the void must refuse the linked correction.
    const [correction] = await Promise.all([
      asUser(db, T1, U1, async client => {
        await client.query(`INSERT INTO tenant_data.journal_corrections(tenant_id,command_id,original_id,reason)
          VALUES ('${T1}','reversal-1','race-1','fix')`);
        await client.query('SELECT pg_sleep(0.3)');
        return 'correction';
      }, {commit: true}),
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return asUser(db, T1, U1, client => assert.rejects(
          () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('race-1', {key: 'race-c'})})`),
          /VOID_LINKED_CORRECTION/,
        ));
      })(),
    ]);
    assert.equal(correction, 'correction');
  });
});

test('PIVOT-005 activation is fail-closed until the dispatcher installs guards', async () => {
  await withPivotDatabase({
    sqlFiles: schemaFiles,
    adminSqlFiles: ['db/postgres/migrations/031-rls-corrections.sql', 'db/postgres/migrations/032-rls-hardening.sql', 'db/postgres/migrations/042-entry-voiding.sql'],
  }, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'act-1');
    // Before activation the runtime can neither execute the primitive nor read projections.
    const before = await db.adminQuery(`
      SELECT has_function_privilege($1, 'tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)', 'EXECUTE') AS exec,
             has_table_privilege($1, 'tenant_data.entry_voids', 'SELECT') AS read_voids,
             has_table_privilege($1, 'tenant_data.active_general_ledger', 'SELECT') AS read_active
    `, [db.roles.customerApp]);
    assert.deepEqual(before.rows[0], {exec: false, read_voids: false, read_active: false});

    // Activation installs everything and exposes only the intended interface.
    await db.adminQuery(namespaceSql(await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8'), db.roles));
    const after = await db.adminQuery(`
      SELECT has_function_privilege($1, 'tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)', 'EXECUTE') AS exec,
             has_table_privilege($1, 'tenant_data.active_general_ledger', 'SELECT') AS read_active,
             has_table_privilege($1, 'tenant_data.entry_voids', 'INSERT') AS write_voids
    `, [db.roles.customerApp]);
    assert.deepEqual(after.rows[0], {exec: true, read_active: true, write_voids: false});
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('act-1')})`), {commit: true});
  });
});

test('PIVOT-005 refuses a polluted pre-existing void owner without repairing it', async () => {
  await withPivotDatabase({
    sqlFiles: schemaFiles,
    adminSqlFiles: ['db/postgres/migrations/031-rls-corrections.sql', 'db/postgres/migrations/032-rls-hardening.sql'],
  }, async db => {
    const role = db.extraRoles.voidDefiner;
    await db.adminQuery(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
    await db.adminQuery(`GRANT SELECT ON tenant_data.accounts TO "${role}"`);
    const before = await db.adminQuery(`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1
    `, [role]);
    const sql = namespaceSql(await readFile(new URL('db/postgres/migrations/042-entry-voiding.sql', repoRoot), 'utf8'), db.roles);
    await assert.rejects(() => db.adminQuery(sql), /R5-AUTHORITY/);
    await db.adminQuery('ROLLBACK');
    const after = await db.adminQuery(`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1
    `, [role]);
    assert.deepEqual(after.rows, before.rows, 'a refused correction leaves the role definition unchanged');
    const existing = await db.adminQuery(`SELECT has_table_privilege($1, 'tenant_data.accounts', 'SELECT') AS still_granted`, [role]);
    assert.equal(existing.rows[0].still_granted, true, 'unrelated prior grants are not silently stripped');
    const fn = await db.adminQuery(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'void_posted_entry'`);
    assert.equal(fn.rows[0].n, 0, 'a refused correction creates no primitive');
  });
});

test('PIVOT-005 static contract: lifecycle predicate, role-agnostic views, activation ordering', async () => {
  const payload = await readFile(new URL('db/postgres/migrations/040-posted-immutability.sql', repoRoot), 'utf8');
  const voiding = await readFile(new URL('db/postgres/migrations/042-entry-voiding.sql', repoRoot), 'utf8');
  const dispatcher = await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8');
  const rules = JSON.parse(await readFile(new URL('contracts/postgres-business-rules-v1.json', repoRoot), 'utf8'));

  // Active GL must require the POSTED lifecycle, not merely the absence of a void.
  assert.match(voiding, /JOIN tenant_data\.command_inbox c ON c\.tenant_id = j\.tenant_id AND c\.id = j\.id\s+WHERE c\.state = 'POSTED'/);
  assert.match(voiding, /NOT EXISTS \(\s*SELECT 1 FROM tenant_data\.entry_voids/);

  // Role-agnostic: no eligibility model, no business role names in executable SQL.
  const executable = voiding.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(executable, /CREATE (?:TABLE|VIEW|FUNCTION)[^;]*eligib/i);
  assert.doesNotMatch(executable, /\b(senior|junior|auditor|management|accountant)\b/i);
  for (const role of [...voiding.matchAll(/CREATE POLICY[^;]*?\bTO\s+([a-z_]+)/g)].map(m => m[1])) {
    assert.ok(['PUBLIC', 'saven_customer_app'].includes(role), `unexpected policy target ${role}`);
  }
  assert.match(voiding, /security_invoker = true/);

  // Canonical permission contract, not an invented boolean.
  assert.match(voiding, /-> 'actions'\) \? 'accounting\.entry\.void'/);
  assert.match(voiding, /d\.action IN \('accounting\.entry\.void', '\*'\)/);
  assert.match(voiding, /maxMinor/);
  assert.match(voiding, /approval_policy/);
  assert.match(voiding, /VOID_PERIOD_LOCKED/);
  assert.doesNotMatch(voiding, /permissions::jsonb -> 'accounting\.entry\.void'/);

  // Activation ordering: 042 grants the runtime nothing; 40 grants after attaching.
  assert.doesNotMatch(voiding, /GRANT (?:EXECUTE|SELECT|INSERT)[^;]*TO saven_customer_app/);
  assert.match(dispatcher, /GRANT EXECUTE ON FUNCTION tenant_data\.void_posted_entry/);
  assert.match(dispatcher, /activation refused because required guard bindings are missing/);

  // Dispatcher registers both payloads and both correction ends.
  assert.match(dispatcher, /saven_p005_journal_corrections/);
  assert.match(dispatcher, /saven_p005_correction_commit/);
  assert.match(dispatcher, /installed payload version\(s\) % are not registered/);
  assert.match(payload, /already applied and is immutable/);
  assert.match(payload, /immutability_040_lock_key/);
  assert.match(payload, /immutability_040_correction_committed/);

  // Canonical reference registration completed.
  const states = rules.reference_domains.command_state.values.map(v => v.value);
  const actions = rules.reference_domains.action_type.values.map(v => v.value);
  assert.ok(states.includes('VOIDED'));
  assert.ok(actions.includes('accounting.entry.void'));
  assert.ok(actions.includes('accounting.voided_entries.read'));
});

test('PIVOT-005 concurrent replay and duplicate void yield one terminal event', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'conc-1');
    await postedEntry(db, 'conc-2');

    const [first, second] = await Promise.all([
      asUser(db, T1, U1, async client => {
        const id = (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('conc-1')}) AS id`)).rows[0].id;
        await client.query('SELECT pg_sleep(0.3)');
        return id;
      }, {commit: true}),
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return asUser(db, T1, U1, async client =>
          (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('conc-1')}) AS id`)).rows[0].id, {commit: true});
      })(),
    ]);
    assert.equal(second, first, 'same-key replay returns the original receipt');
    const voids = (await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.entry_voids`)).rows[0].n;
    const audit = (await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.audit WHERE event='ENTRY_VOIDED'`)).rows[0].n;
    assert.deepEqual({voids, audit}, {voids: 1, audit: 1});

    // Distinct key on an already-voided entry is refused after the lock is released.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('conc-1', {key: 'other-key'})})`),
      /ENTRY_ALREADY_VOIDED/,
    ));
  });
});
