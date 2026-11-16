import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {withPivotDatabase, namespaceSql} from './helpers/pg-pivot-fixture.mjs';

const repoRoot = new URL('../', import.meta.url);

// Real run order: schemas, RLS, original immutability payload, then the
// administrator-applied void correction and the explicit dispatcher.
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
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const voidArgs = (entry, actor = 'user-1', key = 'idem-1', reason = 'duplicate entry') =>
  `'${T1}'::uuid, '${entry}', '${actor}', '${reason}', '${key}', 'corr-1', 1, 1`;

async function seedTenant(db, {tenant = T1, user = U1, legacy = 'user-1', email = 'u1@example.test'} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.business(tenant_id, id, state) VALUES ('${tenant}', 'alpha', 'ACTIVE');
    INSERT INTO tenant_data.company_profiles(tenant_id, id, name, currency, branch, created_at)
      VALUES ('${tenant}', 'alpha', 'Alpha', 'PKR', 'main', 0);
    INSERT INTO auth.users(id, legacy_id, email, status)
      VALUES ('${user}', '${legacy}', '${email}', 'active');
    INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
      VALUES ('${tenant}', '${user}', 'ultimate_owner', 'active', now(), now());
    INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active)
      VALUES ('${tenant}', '${legacy}', '${user}', true);
    INSERT INTO tenant_data.accounts(tenant_id, code, title)
      VALUES ('${tenant}', '1000', 'Cash'), ('${tenant}', '4000', 'Revenue');
  `);
}

// A user with a named business role that carries the void action key. The role label
// is deliberately a custom business name: the database must not treat it specially.
async function grantVoidAction(db, {tenant = T1, user = U1, legacy = 'user-1', roleId = 'clerk', roleName = 'Senior Accountant', permission = true} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
      VALUES ('${tenant}', '${roleId}', '${roleName}', false,
              '${JSON.stringify({['accounting.entry.void']: permission})}');
    INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id)
      VALUES ('${tenant}', '${legacy}', '${roleId}');
  `);
}

async function seedPostedEntry(db, id, {tenant = T1, actor = 'user-1', debit = 100} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
      VALUES ('${tenant}', '${id}', '${actor}', 'digest-${id}', '{"company":"alpha"}', 'ACCEPTED_PENDING', 0);
    INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
      VALUES ('${tenant}', '${id}', 'alpha', 'main', '2026-11-16', 'entry ${id}');
    INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES
      ('${tenant}', '${id}', 1, '1000', ${debit}, 0),
      ('${tenant}', '${id}', 2, '4000', 0, ${debit});
    INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
      VALUES ('${tenant}', '${id}', '${actor}', 'JOURNAL_POSTED', '{}', 0);
    INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
      VALUES ('${tenant}', '${id}', 'JOURNAL_POSTED', 'READY');
  `);
  await db.adminQuery(`UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE tenant_id = '${tenant}' AND id = '${id}'`);
}

const asUser = (db, tenant, user, run, options = {}) => db.asRole('customerApp', async client => {
  if (tenant !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenant]);
  if (user !== undefined) await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', user]);
  return run(client);
}, options);

test('PIVOT-005 static contract: retained sources, terminal void, role-agnostic projections', async () => {
  const payload = await readFile(new URL('db/postgres/migrations/040-posted-immutability.sql', repoRoot), 'utf8');
  const voiding = await readFile(new URL('db/postgres/migrations/042-entry-voiding.sql', repoRoot), 'utf8');
  const dispatcher = await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8');
  const executable = text => text.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');

  for (const [name, text] of [['040', payload], ['042', voiding], ['40', dispatcher]]) {
    assert.doesNotMatch(executable(text), /\b(?:CREATE|ALTER)\s+ROLE\b[^;]*\bBYPASSRLS\b/, `${name} must not grant privileged escape`);
    assert.doesNotMatch(executable(text), /\bPASSWORD\b|postgres(?:ql)?:\/\//i, `${name} must not contain secrets`);
  }

  // 040 is a versioned payload of functions only; 042 adds its own version; the
  // dispatcher attaches both and never only the newest.
  assert.doesNotMatch(payload, /CREATE TRIGGER/i);
  assert.match(payload, /immutability_040_/);
  assert.match(voiding, /immutability_042_/);
  assert.match(dispatcher, /040-posted-immutability/);
  assert.match(dispatcher, /042-entry-voiding/);
  assert.match(dispatcher, /installed payload version\(s\) % are not registered/);
  assert.match(dispatcher, /ORDER BY t\.token::integer DESC/);
  assert.doesNotMatch(dispatcher, /max\(.*proname.*\)\s*\)\s*INTO.*newest/is);

  // The immutability payloads refuse re-application instead of rewriting history.
  assert.match(payload, /already applied and is immutable/);
  assert.match(voiding, /042-entry-voiding\.sql is already applied/);
  assert.match(voiding, /\nBEGIN;\n/);
  assert.match(voiding.trimEnd(), /COMMIT;$/);

  // Role-agnostic correction: no business role names, no eligibility model.
  const voidingExecutable = executable(voiding);
  assert.doesNotMatch(voidingExecutable, /CREATE (?:TABLE|VIEW|FUNCTION)[^;]*eligib/i);
  assert.doesNotMatch(voidingExecutable, /\b(senior|junior|auditor|management|accountant)\b/i);
  assert.doesNotMatch(voidingExecutable, /void_read_eligible|void_read_eligibility/i);
  // Only the accepted runtime grantee may be named in policies/grants.
  const policyRoles = [...voiding.matchAll(/CREATE POLICY[^;]*?\bTO\s+([a-z_]+)/g)].map(match => match[1]);
  for (const role of policyRoles) {
    assert.ok(['PUBLIC', 'saven_customer_app'].includes(role), `unexpected policy target ${role}`);
  }
  assert.doesNotMatch(voidingExecutable, /CREATE POLICY[^;]*USING \(true\)/i);

  // Projections are canonical and derived, never a moving/duplicating adjustment.
  assert.match(voiding, /CREATE VIEW tenant_data\.active_general_ledger/);
  assert.match(voiding, /CREATE VIEW tenant_data\.voided_entries/);
  assert.match(voiding, /security_invoker = true/);
  assert.match(voiding, /NOT EXISTS \(\s*SELECT 1 FROM tenant_data\.entry_voids/);
  assert.doesNotMatch(voiding, /INSERT INTO tenant_data\.journal_lines[^;]*void/is);

  // Terminal rules.
  assert.match(voiding, /UNIQUE \(tenant_id, entry_id\)/);
  assert.match(voiding, /entry_voids_transition CHECK \(original_state = 'POSTED' AND effective_state = 'VOIDED'\)/);
  assert.match(voiding, /VOIDED_IMMUTABLE/);
  assert.match(voiding, /ENTRY_ALREADY_VOIDED/);
  assert.match(voiding, /VOID_IDEMPOTENCY_CONFLICT/);
  assert.match(voiding, /VOID_DEPENDENCY_UNSUPPORTED/);
  assert.match(voiding, /VOID_LINKED_CORRECTION/);
  assert.match(voiding, /VOID_ACTION_REQUIRED/);
  assert.match(voiding, /VOID_ACTOR_MISMATCH/);

  // No generic status assumption on journals; the structural terminal states are the
  // regulated command names and the void overlay is a separate record.
  assert.doesNotMatch(voidingExecutable, /journals\.status|NEW\.status|OLD\.status/);
  const payloadExecutable = executable(payload);
  assert.match(payload, /OLD\.state IN \('POSTED', 'VOIDED'\)/);
  assert.match(payload, /v_state IN \('POSTED', 'VOIDED'\)/);
  assert.doesNotMatch(payloadExecutable, /IN \('ACCEPTED_PENDING', 'AWAITING_APPROVAL', 'POSTED', 'FAILED'\)/);
});

test('PIVOT-005 catalog: forced new tables, projections, narrow primitive owner', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    const tables = (
      await db.adminQuery(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND c.relname IN ('entry_voids', 'void_denials')`,
      )
    ).rows;
    assert.equal(tables.length, 2);
    for (const table of tables) {
      assert.equal(table.relrowsecurity, true);
      assert.equal(table.relforcerowsecurity, true);
    }
    const policyCount = (
      await db.adminQuery(
        `SELECT count(*)::int AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND c.relname IN ('entry_voids', 'void_denials')`,
      )
    ).rows[0].n;
    assert.equal(policyCount, 6);

    // No eligibility artifact of any kind.
    const eligibility = (
      await db.adminQuery(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND c.relname LIKE '%eligib%'`,
      )
    ).rows[0].n;
    assert.equal(eligibility, 0);

    // Views exist and are invoker-scoped projections.
    const views = (
      await db.adminQuery(
        `SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND c.relkind = 'v' ORDER BY c.relname`,
      )
    ).rows;
    assert.deepEqual(views.map(row => row.relname).sort(), ['active_general_ledger', 'voided_entries']);
    for (const view of views) {
      assert.ok((view.reloptions ?? []).includes('security_invoker=true'), `${view.relname} must be security_invoker`);
    }

    // Primitive: dedicated NOLOGIN owner, definer, fixed search_path, narrow ACL.
    const fn = (
      await db.adminQuery(
        `SELECT p.proowner::regrole::text AS owner, p.prosecdef, p.proconfig,
                has_function_privilege($1, p.oid, 'EXECUTE') AS customer_exec,
                has_function_privilege($2, p.oid, 'EXECUTE') AS operator_exec,
                EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_exec
         FROM pg_proc p WHERE p.proname = 'void_posted_entry'`,
        [db.roles.customerApp, db.roles.operatorRead],
      )
    ).rows[0];
    assert.equal(fn.owner, db.extraRoles.voidDefiner);
    assert.equal(fn.prosecdef, true);
    assert.deepEqual(fn.proconfig, ['search_path=pg_catalog, tenant_data']);
    assert.equal(fn.customer_exec, true);
    assert.equal(fn.operator_exec, false);
    assert.equal(fn.public_exec, false);

    const role = (
      await db.adminQuery(
        `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit, rolreplication
         FROM pg_roles WHERE rolname = $1`,
        [db.extraRoles.voidDefiner],
      )
    ).rows[0];
    assert.deepEqual(role, {
      rolsuper: false, rolbypassrls: false, rolcreatedb: false,
      rolcreaterole: false, rolcanlogin: false, rolinherit: false, rolreplication: false,
    });
    const memberships = (
      await db.adminQuery(
        `SELECT count(*)::int AS n FROM pg_auth_members am
         JOIN pg_roles m ON m.oid = am.member JOIN pg_roles g ON g.oid = am.roleid
         WHERE m.rolname = $1 OR g.rolname = $1`,
        [db.extraRoles.voidDefiner],
      )
    ).rows[0].n;
    assert.equal(memberships, 0);
    const owned = (
      await db.adminQuery(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1`,
        [db.extraRoles.voidDefiner],
      )
    ).rows[0].n;
    assert.equal(owned, 0);

    // Both payloads stay attached, and the runtime cannot insert void records directly.
    const triggerBindings = (
      await db.adminQuery(
        `SELECT c.relname AS table_name, p.proname
         FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_proc p ON p.oid = tg.tgfoid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND tg.tgname LIKE 'saven\\_p005\\_%' ORDER BY p.proname`,
      )
    ).rows;
    assert.ok(triggerBindings.some(row => row.proname.startsWith('immutability_040_')));
    assert.ok(triggerBindings.some(row => row.proname.startsWith('immutability_042_')));
    const directInsert = (
      await db.adminQuery(
        `SELECT has_table_privilege($1, 'tenant_data.entry_voids', 'INSERT') AS entry_insert,
                has_table_privilege($1, 'tenant_data.entry_voids', 'UPDATE') AS entry_update,
                has_table_privilege($1, 'tenant_data.entry_voids', 'DELETE') AS entry_delete`,
        [db.roles.customerApp],
      )
    ).rows[0];
    assert.deepEqual(directInsert, {entry_insert: false, entry_update: false, entry_delete: false});

    // Re-applying an installed payload is refused, and the dispatcher keeps both
    // payloads attached (an upgrade never replaces the original protection).
    const payloadSql = namespaceSql(
      await readFile(new URL('db/postgres/migrations/040-posted-immutability.sql', repoRoot), 'utf8'),
      db.roles,
    );
    await assert.rejects(() => db.adminQuery(payloadSql), /already applied and is immutable/);
    // The refused multi-statement batch leaves an aborted transaction on that session.
    await db.adminQuery('ROLLBACK');
    await db.adminQuery(namespaceSql(await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8'), db.roles));
    const afterRerun = (
      await db.adminQuery(
        `SELECT count(*)::int AS n FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND tg.tgname LIKE 'saven\_p005\_%' AND NOT tg.tgisinternal`,
      )
    ).rows[0].n;
    assert.equal(afterRerun, triggerBindings.length, 'dispatcher re-run preserves every attachment');

  });
});

test('PIVOT-005 void: exact active totals, retained source, atomic effects', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db);
    await grantVoidAction(db);
    await seedPostedEntry(db, 'plain-1', {debit: 250});

    const result = await asUser(db, T1, U1, async client => {
      const before = (await client.query('SELECT count(*)::int AS rows, coalesce(sum(debit),0)::text AS total FROM tenant_data.active_general_ledger')).rows[0];
      const voidId = (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('plain-1')}) AS id`)).rows[0].id;
      const after = (await client.query('SELECT count(*)::int AS rows, coalesce(sum(debit),0)::text AS total FROM tenant_data.active_general_ledger')).rows[0];
      const voided = (await client.query('SELECT count(*)::int AS rows, coalesce(sum(debit),0)::text AS total FROM tenant_data.voided_entries')).rows[0];
      const raw = (await client.query(`SELECT count(*)::int AS rows FROM tenant_data.journal_lines WHERE journal_id = 'plain-1'`)).rows[0];
      const numbers = (await client.query('SELECT count(*)::int AS n FROM tenant_data.document_numbers')).rows[0].n;
      const command = (await client.query(`SELECT state FROM tenant_data.command_inbox WHERE id = 'plain-1'`)).rows[0].state;
      return {before, voidId, after, voided, raw, numbers, command};
    }, {commit: true});

    assert.deepEqual(result.before, {rows: 2, total: '250'});
    assert.deepEqual(result.after, {rows: 0, total: '0'});
    assert.deepEqual(result.voided, {rows: 2, total: '250'});
    assert.equal(result.raw.rows, 2, 'raw journal lines are retained');
    assert.equal(result.command, 'POSTED', 'the source stays historically posted');
    assert.match(result.voidId, /^[0-9a-f-]{36}$/);

    // Effects committed atomically: receipt, native audit, change audit, outbox.
    const effects = (
      await db.adminQuery(
        `SELECT
           (SELECT state FROM tenant_data.command_inbox WHERE id = $1) AS receipt_state,
           (SELECT count(*)::int FROM tenant_data.audit WHERE command_id = $1 AND event = 'ENTRY_VOIDED') AS audit_rows,
           (SELECT count(*)::int FROM tenant_data.audit_event WHERE entity_id = 'plain-1' AND event = 'ENTRY_VOIDED') AS event_rows,
           (SELECT count(*)::int FROM tenant_data.outbox WHERE id = $1 AND event = 'ENTRY_VOIDED') AS outbox_rows,
           (SELECT count(*)::int FROM tenant_data.entry_voids WHERE void_command_id = $1) AS void_rows`,
        [result.voidId],
      )
    ).rows[0];
    assert.deepEqual(effects, {receipt_state: 'VOIDED', audit_rows: 1, event_rows: 1, outbox_rows: 1, void_rows: 1});

    // Idempotent replay returns the same receipt and adds nothing.
    const replay = await asUser(db, T1, U1, async client => {
      const again = (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('plain-1')}) AS id`)).rows[0].id;
      const counts = (await client.query(`SELECT count(*)::int AS n FROM tenant_data.entry_voids`)).rows[0].n;
      return {again, counts};
    });
    assert.deepEqual(replay, {again: result.voidId, counts: 1});

    // Different key on an already voided entry, and key reuse with different input.
    await asUser(db, T1, U1, async client => {
      await client.query('SAVEPOINT s1');
      await assert.rejects(
        () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('plain-1', 'user-1', 'idem-2', 'again')})`),
        /ENTRY_ALREADY_VOIDED/,
      );
      await client.query('ROLLBACK TO SAVEPOINT s1');
      await assert.rejects(
        () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('plain-1', 'user-1', 'idem-1', 'different reason')})`),
        /VOID_IDEMPOTENCY_CONFLICT/,
      );
    });
  });
});

test('PIVOT-005 void is terminal: no edit, unvoid, physical deletion or second deletion', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db);
    await grantVoidAction(db);
    await seedPostedEntry(db, 'terminal-1');
    const voidId = await asUser(db, T1, U1, async client =>
      (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('terminal-1')}) AS id`)).rows[0].id, {commit: true});

    // The append-only record, receipt and audit rows reject every mutation.
    for (const statement of [
      `UPDATE tenant_data.entry_voids SET reason = 'changed' WHERE tenant_id = '${T1}' AND void_command_id = '${voidId}'`,
      `DELETE FROM tenant_data.entry_voids WHERE tenant_id = '${T1}' AND void_command_id = '${voidId}'`,
      `UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE id = '${voidId}'`,
      `DELETE FROM tenant_data.command_inbox WHERE id = '${voidId}'`,
      `DELETE FROM tenant_data.audit WHERE command_id = '${voidId}'`,
      `DELETE FROM tenant_data.audit_event WHERE entity_id = 'terminal-1'`,
    ]) {
      await assert.rejects(() => db.adminQuery(statement), /VOID|RETAINED|IMMUTABLE|POSTED_|permission denied/);
    }

    // No late lines/children on a voided (historically posted) entry.
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.journal_lines(tenant_id,journal_id,line_no,account,debit,credit)
                           VALUES ('${T1}','terminal-1',3,'1000',5,0)`),
      /POSTED_SOURCE_LATE_LINE/,
    );
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.command_files(tenant_id,id,command_id,name,media_type,sha256,byte_size,scan,created_at)
                           VALUES ('${T1}','f-1','terminal-1','a.pdf','application/pdf',repeat('a',64),10,'clean',0)`),
      /POSTED_SOURCE_LATE_CHILD/,
    );
    // Physical source rows remain immutable.
    await assert.rejects(() => db.adminQuery(`UPDATE tenant_data.journals SET narrative = 'x' WHERE id = 'terminal-1'`), /POSTED_SOURCE_IMMUTABLE/);
    await assert.rejects(() => db.adminQuery(`DELETE FROM tenant_data.journal_lines WHERE journal_id = 'terminal-1'`), /POSTED_SOURCE_IMMUTABLE/);
    // A VOIDED receipt is itself terminal: no late journal, line, evidence or child may
    // attach to the void command, and its state cannot change.
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.journals(tenant_id,id,company,branch,posting_date,narrative)
                           VALUES ('${T1}','${voidId}','alpha','main','2026-11-16','late')`),
      /POSTED_SOURCE_LATE_JOURNAL/,
    );
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.command_files(tenant_id,id,command_id,name,media_type,sha256,byte_size,scan,created_at)
                           VALUES ('${T1}','f-void','${voidId}','a.pdf','application/pdf',repeat('a',64),10,'clean',0)`),
      /POSTED_SOURCE_LATE_CHILD/,
    );

    // A new void record cannot be fabricated for the same entry.
    await assert.rejects(
      () => db.adminQuery(`INSERT INTO tenant_data.entry_voids(tenant_id,void_command_id,entry_id,reason,actor,actor_uuid,
                             original_state,effective_state,source_digest,source_version,source_line_count,
                             request_digest,idempotency_key,period_locked)
                           VALUES ('${T1}','${voidId}','terminal-1','again','user-1','${U1}','POSTED','VOIDED','d',1,2,'r','k2',false)`),
      /VOID_RECEIPT_INVALID|duplicate key|ENTRY/,
    );
  });
});

test('PIVOT-005 void effects are atomic: a failing effect leaves no trace', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db);
    await grantVoidAction(db);
    await seedPostedEntry(db, 'atomic-1');

    // Force the outbox insert to fail inside the primitive.
    await db.asRole('migrator', client => client.query(
      `CREATE FUNCTION tenant_data.p005_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN IF NEW.event = 'ENTRY_VOIDED' THEN RAISE EXCEPTION 'SIMULATED_EFFECT_FAILURE'; END IF; RETURN NEW; END $fn$;
       CREATE TRIGGER p005_fail_outbox BEFORE INSERT ON tenant_data.outbox FOR EACH ROW EXECUTE FUNCTION tenant_data.p005_fail_outbox()`,
    ), {commit: true});

    await asUser(db, T1, U1, async client => {
      await assert.rejects(
        () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('atomic-1')})`),
        /SIMULATED_EFFECT_FAILURE/,
      );
    });

    const residual = (
      await db.adminQuery(
        `SELECT (SELECT count(*)::int FROM tenant_data.entry_voids WHERE entry_id = 'atomic-1') AS voids,
                (SELECT count(*)::int FROM tenant_data.command_inbox WHERE state = 'VOIDED') AS receipts,
                (SELECT count(*)::int FROM tenant_data.audit WHERE event = 'ENTRY_VOIDED') AS audits,
                (SELECT count(*)::int FROM tenant_data.outbox WHERE event = 'ENTRY_VOIDED') AS outboxes,
                (SELECT count(*)::int FROM tenant_data.audit_event WHERE event = 'ENTRY_VOIDED') AS events`,
      )
    ).rows[0];
    assert.deepEqual(residual, {voids: 0, receipts: 0, audits: 0, outboxes: 0, events: 0});
    const active = (
      await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.active_general_ledger WHERE journal_id = 'atomic-1'`)
    ).rows[0].n;
    assert.equal(active, 2, 'the entry stays active after a failed void');

    await db.asRole('migrator', client => client.query('DROP TRIGGER p005_fail_outbox ON tenant_data.outbox; DROP FUNCTION tenant_data.p005_fail_outbox()'), {commit: true});
  });
});

test('PIVOT-005 authority: module read is separate from the void action, context is verified', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db);
    await grantVoidAction(db);
    await seedTenant(db, {tenant: T2, user: U2, legacy: 'user-2', email: 'u2@example.test'});
    await seedPostedEntry(db, 'auth-1');
    await seedPostedEntry(db, 'auth-3');
    await seedPostedEntry(db, 'auth-2', {tenant: T2, actor: 'user-2'});

    // A later user with a read-only custom role label: reads voided entries, cannot void.
    await db.adminQuery(`
      INSERT INTO auth.users(id, legacy_id, email, status)
        VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'user-3', 'u3@example.test', 'active');
      INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
        VALUES ('${T1}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ultimate_owner', 'active', now(), now());
      INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active)
        VALUES ('${T1}', 'user-3', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
      INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
        VALUES ('${T1}', 'auditor-clerk', 'Auditor', false, '{}');
      INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id)
        VALUES ('${T1}', 'user-3', 'auditor-clerk');
    `);

    // Void with the authorized user first.
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('auth-1')})`), {commit: true});

    // The read-only user sees the same voided projection (role-agnostic visibility).
    const readOnlyView = await asUser(db, T1, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', async client => ({
      voided: (await client.query('SELECT count(*)::int AS n FROM tenant_data.voided_entries')).rows[0].n,
      active: (await client.query('SELECT count(*)::int AS n FROM tenant_data.active_general_ledger')).rows[0].n,
      rawVoidRecord: (await client.query('SELECT count(*)::int AS n FROM tenant_data.entry_voids')).rows[0].n,
    }));
    // auth-1 is voided (2 voided lines), auth-3 remains active (2 active lines).
    assert.deepEqual(readOnlyView, {voided: 2, active: 2, rawVoidRecord: 1});

    // But module read access alone cannot execute the void command.
    await asUser(db, T1, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry('${T1}'::uuid, 'auth-3', 'user-3', 'nope', 'k-3')`),
      /VOID_ACTION_REQUIRED/,
    ));

    // Actor mismatch, missing context and malformed context are denied.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry('${T1}'::uuid, 'auth-3', 'user-2', 'x', 'k-4')`),
      /VOID_ACTOR_MISMATCH/,
    ));
    await asUser(db, undefined, undefined, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry('${T1}'::uuid, 'auth-3', 'user-1', 'x', 'k-5')`),
      /VOID_CONTEXT_REQUIRED|VOID_TENANT_CONTEXT_MISMATCH/,
    ));
    await asUser(db, T1, 'not-a-uuid', client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry('${T1}'::uuid, 'auth-3', 'user-1', 'x', 'k-6')`),
      /VOID_CONTEXT_REQUIRED/,
    ));

    // Cross-tenant denial: tenant-one context cannot void a tenant-two entry.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry('${T2}'::uuid, 'auth-2', 'user-2', 'x', 'k-7')`),
      /VOID_TENANT_CONTEXT_MISMATCH/,
    ));
    // And the entry stays active in its own tenant.
    assert.equal(
      (await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.active_general_ledger WHERE journal_id = 'auth-2'`)).rows[0].n,
      2,
    );
  });
});

test('PIVOT-005 rejects unsupported linked dependencies without partial effects', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db);
    await grantVoidAction(db);

    // A trade-backed command cannot be voided through the plain-journal path.
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
        VALUES ('${T1}', 'trade-1', 'user-1', 'd', '{}', 'ACCEPTED_PENDING', 0);
      INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
        VALUES ('${T1}', 'trade-1', 'alpha', 'main', '2026-11-16', 'trade');
      INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES
        ('${T1}', 'trade-1', 1, '1000', 10, 0), ('${T1}', 'trade-1', 2, '4000', 0, 10);
      INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${T1}', 'trade-1', 'user-1', 'JOURNAL_POSTED', '{}', 0);
      INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
        VALUES ('${T1}', 'trade-1', 'JOURNAL_POSTED', 'READY');
      INSERT INTO tenant_data.trade_operations(tenant_id, command_id, input_digest, payload)
        VALUES ('${T1}', 'trade-1', 'd', '{}');
    `);
    await db.adminQuery(`UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE id = 'trade-1'`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('trade-1')})`),
      /VOID_DEPENDENCY_UNSUPPORTED/,
    ));

    // A journal that is the original of a posted correction cannot be voided alone.
    await seedPostedEntry(db, 'corr-original');
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
        VALUES ('${T1}', 'corr-reversal', 'user-1', 'd', '{}', 'ACCEPTED_PENDING', 0);
      INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
        VALUES ('${T1}', 'corr-reversal', 'alpha', 'main', '2026-11-16', 'reversal');
      INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES
        ('${T1}', 'corr-reversal', 1, '1000', 0, 100), ('${T1}', 'corr-reversal', 2, '4000', 100, 0);
      INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${T1}', 'corr-reversal', 'user-1', 'JOURNAL_POSTED', '{}', 0);
      INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
        VALUES ('${T1}', 'corr-reversal', 'JOURNAL_POSTED', 'READY');
      INSERT INTO tenant_data.journal_corrections(tenant_id, command_id, original_id, reason)
        VALUES ('${T1}', 'corr-reversal', 'corr-original', 'fix');
    `);
    await db.adminQuery(`UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE id = 'corr-reversal'`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('corr-original')})`),
      /VOID_LINKED_CORRECTION/,
    ));

    const residual = (
      await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.entry_voids`)
    ).rows[0].n;
    assert.equal(residual, 0, 'refused voids leave no effect');
  });
});

test('PIVOT-005 races: posting state is rechecked and duplicates yield exactly one void', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db);
    await grantVoidAction(db);

    // Void-before-post: an accepted-but-unposted entry is refused and stays active.
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
        VALUES ('${T1}', 'race-1', 'user-1', 'd', '{}', 'ACCEPTED_PENDING', 0);
      INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
        VALUES ('${T1}', 'race-1', 'alpha', 'main', '2026-11-16', 'unposted');
      INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES
        ('${T1}', 'race-1', 1, '1000', 10, 0), ('${T1}', 'race-1', 2, '4000', 0, 10);
    `);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('race-1')})`),
      /VOID_ENTRY_NOT_POSTED/,
    ));

    // Then post it and void; a second distinct attempt cannot produce a second event.
    await db.adminQuery(`
      INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
        VALUES ('${T1}', 'race-1', 'user-1', 'JOURNAL_POSTED', '{}', 0);
      INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
        VALUES ('${T1}', 'race-1', 'JOURNAL_POSTED', 'READY');
      UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE id = 'race-1';
    `);
    const first = await asUser(db, T1, U1, async client =>
      (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('race-1')}) AS id`)).rows[0].id, {commit: true});
    await asUser(db, T1, U1, async client => {
      await client.query('SAVEPOINT s');
      await assert.rejects(
        () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('race-1', 'user-1', 'idem-second')})`),
        /ENTRY_ALREADY_VOIDED/,
      );
      await client.query('ROLLBACK TO SAVEPOINT s');
    });
    const count = (await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.entry_voids WHERE entry_id = 'race-1'`)).rows[0].n;
    assert.equal(count, 1);
    assert.ok(first);
  });
});

test('PIVOT-005 denials are durably loggable and append-only', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db);
    await grantVoidAction(db);
    await seedPostedEntry(db, 'denial-1');

    // A denied attempt (no permission) raises; the caller records it in a later
    // transaction because PostgreSQL has no autonomous transaction.
    await db.adminQuery(`
      INSERT INTO auth.users(id, legacy_id, email, status)
        VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'user-4', 'u4@example.test', 'active');
      INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
        VALUES ('${T1}', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'ultimate_owner', 'active', now(), now());
      INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active)
        VALUES ('${T1}', 'user-4', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
      INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
        VALUES ('${T1}', 'reader', 'Read Only', false, '{}');
      INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id)
        VALUES ('${T1}', 'user-4', 'reader');
    `);
    await asUser(db, T1, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('denial-1', 'user-4', 'deny-1')})`),
      /VOID_ACTION_REQUIRED/,
    ));
    await asUser(db, T1, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', async client => {
      await client.query(
        `INSERT INTO tenant_data.void_denials(tenant_id, entry_id, actor, actor_uuid, attempt_key, reason_code, detail)
         VALUES ('${T1}', 'denial-1', 'user-4', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'deny-1', 'VOID_ACTION_REQUIRED', 'no action authority')`,
      );
      const rows = (await client.query('SELECT count(*)::int AS n FROM tenant_data.void_denials')).rows[0].n;
      assert.equal(rows, 1);
    }, {commit: true});
    await assert.rejects(() => db.adminQuery(`UPDATE tenant_data.void_denials SET reason_code = 'x'`), /VOID_DENIAL_RETAINED/);
    await assert.rejects(() => db.adminQuery(`DELETE FROM tenant_data.void_denials`), /VOID_DENIAL_RETAINED/);
  });
});

test('PIVOT-005 tenant isolation holds for the new tables and projections', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db);
    await seedTenant(db, {tenant: T2, user: U2, legacy: 'user-2', email: 'u2@example.test'});
    await grantVoidAction(db);
    await seedPostedEntry(db, 'iso-1');
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('iso-1')})`), {commit: true});

    // A second tenant sees neither the void record nor the voided projection rows.
    const foreign = await asUser(db, T2, U2, async client => ({
      voids: (await client.query('SELECT count(*)::int AS n FROM tenant_data.entry_voids')).rows[0].n,
      voided: (await client.query('SELECT count(*)::int AS n FROM tenant_data.voided_entries')).rows[0].n,
      active: (await client.query('SELECT count(*)::int AS n FROM tenant_data.active_general_ledger')).rows[0].n,
      denials: (await client.query('SELECT count(*)::int AS n FROM tenant_data.void_denials')).rows[0].n,
    }));
    assert.deepEqual(foreign, {voids: 0, voided: 0, active: 0, denials: 0});

    // An extra permissive policy cannot widen tenant scope (restrictive scope policy).
    await db.asRole('migrator', client => client.query(
      `CREATE POLICY p005_attack ON tenant_data.entry_voids AS PERMISSIVE FOR SELECT TO "${db.roles.customerApp}" USING (true)`,
    ), {commit: true});
    const attacked = await asUser(db, T2, U2, async client =>
      (await client.query('SELECT count(*)::int AS n FROM tenant_data.entry_voids')).rows[0].n);
    assert.equal(attacked, 0, 'a permissive addition must not cross tenants');
    await db.asRole('migrator', client => client.query('DROP POLICY p005_attack ON tenant_data.entry_voids'), {commit: true});
  });
});
