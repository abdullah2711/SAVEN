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
const preActivationAdminFiles = [
  'db/postgres/migrations/031-rls-corrections.sql',
  'db/postgres/migrations/032-rls-hardening.sql',
];

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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

async function addTenantRole(db, {tenant = T1, legacy = 'user-1', roleId = 'clerk', permissions}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
      VALUES ($1::uuid, $2, $2, false, $3)
  `, [tenant, roleId, JSON.stringify(permissions)]);
  await db.adminQuery(`
    INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id) VALUES ($1::uuid, $2, $3)
  `, [tenant, legacy, roleId]);
}

const voidPermissions = (extra = {}) => ({
  actions: ['accounting.entry.void'],
  companies: ['*'],
  branches: ['*'],
  accounts: ['*'],
  review: false,
  ...extra,
});

async function grantVoid(db, {tenant = T1, legacy = 'user-1', roleId = 'clerk', ...extra} = {}) {
  await addTenantRole(db, {tenant, legacy, roleId, permissions: voidPermissions(extra)});
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

async function pendingReversal(db, id, {tenant = T1, actor = 'user-1', debit = 100} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
      VALUES ('${tenant}', '${id}', '${actor}', 'digest-${id}', '{}', 'ACCEPTED_PENDING', 0);
    INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
      VALUES ('${tenant}', '${id}', 'alpha', 'main', '2026-11-16', 'reversal');
    INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit) VALUES
      ('${tenant}', '${id}', 1, '1000', 0, ${debit}), ('${tenant}', '${id}', 2, '4000', ${debit}, 0);
  `);
}

async function postPending(db, id, {tenant = T1, actor = 'user-1'} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
      VALUES ('${tenant}', '${id}', '${actor}', 'JOURNAL_POSTED', '{}', 0);
    INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
      VALUES ('${tenant}', '${id}', 'JOURNAL_POSTED', 'READY');
    UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE tenant_id = '${tenant}' AND id = '${id}';
  `);
}

async function asAdminTransaction(db, statements) {
  await db.adminQuery('BEGIN');
  try {
    for (const statement of statements) await db.adminQuery(statement);
    await db.adminQuery('COMMIT');
  } catch (error) {
    await db.adminQuery('ROLLBACK').catch(() => {});
    throw error;
  }
}

const requestDigest = async (db, entry, actor, reason, key) => (
  await db.adminQuery(`
    SELECT encode(sha256(convert_to(concat_ws('|', $1::text, $2::text, $3::text, $4::text), 'UTF8')), 'hex') AS d
  `, [entry, actor, reason, key])
).rows[0].d;

const policyDecision = async (db, {tenant = T1, actor = 'user-1', amount = 100, company = 'alpha', branch = 'main', accounts = ['1000', '4000'], entry = 'entry-1', digest = 'd'} = {}) => (
  await db.adminQuery(`
    SELECT tenant_data.immutability_042_policy_decision(
      $1::uuid, $2::text, $3::bigint, $4::text, $5::text, $6::text[], $7::text, $8::text) AS decision
  `, [tenant, actor, amount, company, branch, accounts, entry, digest])
).rows[0].decision;

const decisionDigest = async (db, decision) => (
  await db.adminQuery('SELECT tenant_data.immutability_042_decision_digest($1::jsonb) AS d', [JSON.stringify(decision)])
).rows[0].d;

async function registerVoidSubmission(db, {
  tenant = T1,
  commandId,
  entry,
  actor = 'user-1',
  reason = 'duplicate',
  key = `ap-${commandId}`,
  amount = 100,
  correlationId = null,
} = {}) {
  const digest = await requestDigest(db, entry, actor, reason, key);
  const decision = await policyDecision(db, {tenant, actor, amount, entry, digest});
  const dDigest = await decisionDigest(db, decision);
  const payload = {kind: 'ENTRY_VOID', entry, reason, requestDigest: digest, decisionDigest: dDigest, correlationId};
  await db.adminQuery(`
    INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
      VALUES ($1::uuid, $2, $3, $4, $5, 'ACCEPTED_PENDING', 0)
  `, [tenant, commandId, actor, digest, JSON.stringify(payload)]);
  return {digest, decision, decisionDigest: dDigest, payload, reason, key, amount};
}

async function requestApproval(db, {tenant = T1, commandId, submission, decision = submission.decision}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.approval_requests(tenant_id, command_id, payload_digest, policy_snapshot, state)
      VALUES ($1::uuid, $2, $3, $4, 'PENDING')
  `, [tenant, commandId, submission.digest, JSON.stringify(decision)]);
}

async function approve(db, {tenant = T1, user = U2, legacy = 'user-2', commandId}) {
  return asUser(db, tenant, user, client => client.query(`
    UPDATE tenant_data.approval_requests SET state = 'APPROVED', decided_by = $1
     WHERE tenant_id = $2::uuid AND command_id = $3
  `, [legacy, tenant, commandId]), {commit: true});
}

async function addReviewer(db, {
  tenant = T1,
  user = U2,
  legacy = 'user-2',
  email = 'u2@example.test',
  roleId = 'reviewer',
  denial = false,
  companies = ['*'],
  branches = ['*'],
  accounts = ['*'],
  maxMinor,
} = {}) {
  await addIdentity(db, {tenant, user, legacy, email});
  if (!denial) {
    const permissions = {actions: ['journal.approve'], companies, branches, accounts, review: false};
    if (maxMinor !== undefined) permissions.maxMinor = maxMinor;
    await addTenantRole(db, {tenant, legacy, roleId, permissions});
  }
}

async function addPolicy(db, {
  tenant = T1,
  key = 'void-policy',
  version = 1,
  currency = 'PKR',
  threshold = 100,
  requiresDifferent = true,
  active = true,
  roleId = null,
} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.approval_policy
      (tenant_id, policy_key, version, action_type, role_id, approval_threshold_amount, currency,
       requires_different_approver, is_active, effective_from)
    VALUES ($1::uuid, $2, $3, 'accounting.entry.void', $4, $5, $6, $7, $8, now())
  `, [tenant, key, version, roleId, threshold, currency, requiresDifferent, active]);
}

const voidArgs = (entry, {tenant = T1, actor = 'user-1', key = 'idem-1', reason = 'duplicate', approval = null} = {}) =>
  `'${tenant}'::uuid, '${entry}', '${actor}', '${reason}', '${key}'` +
  (approval === null ? '' : `, '${approval}'`);

// ---------------------------------------------------------------------------
// Canonical lifecycle, source retention and module-read visibility
// ---------------------------------------------------------------------------

test('PIVOT-005 active GL follows the POSTED lifecycle, retains source bytes and exposes a filterable voided projection', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'posted-1', {debit: 250});
    await postedEntry(db, 'accepted-1', {debit: 999, state: 'ACCEPTED_PENDING'});
    await postedEntry(db, 'failed-1', {debit: 777, state: 'FAILED'});

    const totals = (await db.adminQuery(`
      SELECT (SELECT count(*)::int FROM tenant_data.active_general_ledger) AS rows,
             (SELECT coalesce(sum(debit),0)::text FROM tenant_data.active_general_ledger) AS debit,
             (SELECT count(*)::int FROM tenant_data.journal_lines WHERE journal_id IN ('accepted-1','failed-1')) AS unposted_rows
    `)).rows[0];
    assert.deepEqual(totals, {rows: 2, debit: '250', unposted_rows: 4});

    const voidId = await asUser(db, T1, U1, async client =>
      (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('posted-1')}) AS id`)).rows[0].id, {commit: true});

    const after = (await db.adminQuery(`
      SELECT (SELECT count(*)::int FROM tenant_data.active_general_ledger) AS active,
             (SELECT count(*)::int FROM tenant_data.voided_entries) AS voided,
             (SELECT state FROM tenant_data.command_inbox WHERE id = 'posted-1') AS receipt,
             (SELECT count(*)::int FROM tenant_data.journal_lines WHERE journal_id = 'posted-1') AS raw,
             (SELECT count(*)::int FROM tenant_data.entry_voids) AS records,
             (SELECT count(*)::int FROM tenant_data.audit WHERE command_id = $1 AND event = 'ENTRY_VOIDED') AS native_audit,
             (SELECT count(*)::int FROM tenant_data.audit_event WHERE entity_id = 'posted-1' AND event = 'ENTRY_VOIDED') AS change_audit,
             (SELECT count(*)::int FROM tenant_data.outbox WHERE id = $1 AND event = 'ENTRY_VOIDED') AS outbox
    `, [voidId])).rows[0];
    assert.deepEqual(after, {active: 0, voided: 2, receipt: 'POSTED', raw: 2, records: 1, native_audit: 1, change_audit: 1, outbox: 1});

    // A normal read-only module user with no void grant sees the retained projection.
    await postedEntry(db, 'reader-target');
    await addIdentity(db, {tenant: T1, user: U3, legacy: 'user-3', email: 'u3@example.test'});
    await addTenantRole(db, {
      tenant: T1, legacy: 'user-3', roleId: 'reader',
      permissions: {actions: ['journal.read'], companies: ['*'], branches: ['*'], accounts: ['*'], review: false},
    });
    const reader = await asUser(db, T1, U3, async client => ({
      view: (await client.query('SELECT count(*)::int AS n FROM tenant_data.voided_entries')).rows[0].n,
      raw: (await client.query('SELECT count(*)::int AS n FROM tenant_data.entry_voids')).rows[0].n,
    }));
    assert.deepEqual(reader, {view: 2, raw: 1});
    await asUser(db, T1, U3, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('reader-target', {actor: 'user-3', key: 'reader-1'})})`),
      /VOID_ACTION_REQUIRED/,
    ));
  });
});

// ---------------------------------------------------------------------------
// Canonical action/scope/denial/locked-period authority
// ---------------------------------------------------------------------------

test('PIVOT-005 void authority uses canonical permissions, explicit denials, scope, locked periods and maxMinor', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'perm-1');
    await postedEntry(db, 'perm-2');
    await postedEntry(db, 'perm-locked');

    // Protected ultimate owner authority still applies without a custom grant.
    await db.adminQuery(`
      INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
        VALUES ('${T1}', 'ultimate_business_admin', 'Owner', true, '{}');
      INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id) VALUES ('${T1}', 'user-1', 'ultimate_business_admin');
    `);
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-1', {key: 'owner-1'})})`), {commit: true});

    // Explicit denial wins even with a protected owner assignment.
    await db.adminQuery(`INSERT INTO tenant_data.denials(tenant_id, user_id, action) VALUES ('${T1}', 'user-1', 'accounting.entry.void')`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-2', {key: 'denied-1'})})`),
      /VOID_ACTION_DENIED/,
    ));
    await db.adminQuery(`DELETE FROM tenant_data.denials WHERE tenant_id = '${T1}'`);

    // Locked periods are enforced, not overridden by voiding.
    await db.adminQuery(`INSERT INTO tenant_data.periods(tenant_id, company, start_date, end_date, locked)
      VALUES ('${T1}', 'alpha', '2026-11-01', '2026-11-30', true)`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-locked', {key: 'locked-1'})})`),
      /VOID_PERIOD_LOCKED/,
    ));
    await db.adminQuery(`DELETE FROM tenant_data.periods WHERE tenant_id = '${T1}'`);

    // Out-of-scope company is refused.
    await db.adminQuery(`DELETE FROM tenant_data.assignments WHERE tenant_id = '${T1}' AND role_id IN ('ultimate_business_admin','clerk')`);
    await addTenantRole(db, {
      tenant: T1, legacy: 'user-1', roleId: 'scoped',
      permissions: voidPermissions({companies: ['other']}),
    });
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-2', {key: 'scope-1'})})`),
      /VOID_ACTION_REQUIRED/,
    ));

    // maxMinor is an exact integer minor-unit boundary.
    await db.adminQuery(`UPDATE tenant_data.roles
      SET permissions = '{"actions":["accounting.entry.void"],"companies":["*"],"branches":["*"],"accounts":["*"],"review":false,"maxMinor":50}'
      WHERE tenant_id = '${T1}' AND id = 'scoped'`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-2', {key: 'amount-1'})})`),
      /VOID_ACTION_REQUIRED/,
    ));

    // A malformed maxMinor is an unknown limit and fails closed, rather than becoming
    // an unlimited grant or being silently ignored.
    await db.adminQuery(`UPDATE tenant_data.roles
      SET permissions = '{"actions":["accounting.entry.void"],"companies":["*"],"branches":["*"],"accounts":["*"],"review":false,"maxMinor":"50"}'
      WHERE tenant_id = '${T1}' AND id = 'scoped'`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-2', {key: 'amount-2'})})`),
      /VOID_PERMISSION_INVALID/,
    ));

    // Multiple matching roles are ordered deterministically and every role id is bound
    // into the decision. Review is required unless every matching role has review=false.
    await db.adminQuery(`DELETE FROM tenant_data.assignments WHERE tenant_id = '${T1}'`);
    await db.adminQuery(`DELETE FROM tenant_data.roles WHERE tenant_id = '${T1}'`);
    await addTenantRole(db, {tenant: T1, legacy: 'user-1', roleId: 'az-void', permissions: voidPermissions({review: true})});
    await addTenantRole(db, {tenant: T1, legacy: 'user-1', roleId: 'bz-review-void', permissions: voidPermissions({review: true})});
    const multiRole = await policyDecision(db, {actor: 'user-1', amount: 100, entry: 'perm-2', digest: 'multi'});
    assert.deepEqual(multiRole.roles.map(role => role.roleId), ['az-void', 'bz-review-void']);
    assert.equal(multiRole.review, true);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('perm-2', {key: 'multi-1'})})`),
      /VOID_APPROVAL_REQUIRED/,
    ));
  });
});

// ---------------------------------------------------------------------------
// Approval authority, submission binding, policy currency/units/selection
// ---------------------------------------------------------------------------

test('PIVOT-005 rejects fabricated, self, unauthorised, wrong-submission and stale approvals', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db, {review: true});
    await postedEntry(db, 'approval-1');
    await addReviewer(db);

    // Without a pre-registered approved receipt the void is refused.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('approval-1', {key: 'ap-1'})})`),
      /VOID_APPROVAL_REQUIRED/,
    ));

    // Direct INSERT of an APPROVED row is not an approval decision.
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
        VALUES ('${T1}', 'void-direct', 'user-1', 'd', '{}', 'ACCEPTED_PENDING', 0);
    `);
    await assert.rejects(() => db.adminQuery(`
      INSERT INTO tenant_data.approval_requests(tenant_id, command_id, payload_digest, policy_snapshot, state, decided_by)
        VALUES ('${T1}', 'void-direct', 'd', '{}', 'APPROVED', 'user-2')
    `), /APPROVAL_TRANSITION_REQUIRED/);

    // A pending request may not name its decider either.
    await assert.rejects(() => db.adminQuery(`
      INSERT INTO tenant_data.approval_requests(tenant_id, command_id, payload_digest, policy_snapshot, state, decided_by)
        VALUES ('${T1}', 'void-direct', 'd', '{}', 'PENDING', 'user-2')
    `), /APPROVAL_DECIDER_UNEXPECTED/);

    // The approver must be the verified principal taking the decision.
    const submission = await registerVoidSubmission(db, {
      commandId: 'void-cmd-1', entry: 'approval-1', key: 'ap-2',
    });
    await requestApproval(db, {commandId: 'void-cmd-1', submission});
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state = 'APPROVED', decided_by = 'user-2'
        WHERE tenant_id = '${T1}' AND command_id = 'void-cmd-1'`),
      /APPROVAL_DECIDER_MISMATCH/,
    ));

    // Even self-approval by a user who holds journal.approve is refused.
    await addTenantRole(db, {
      tenant: T1, legacy: 'user-1', roleId: 'self-approver',
      permissions: {actions: ['journal.approve'], companies: ['*'], branches: ['*'], accounts: ['*'], review: false},
    });
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state = 'APPROVED', decided_by = 'user-1'
        WHERE tenant_id = '${T1}' AND command_id = 'void-cmd-1'`),
      /APPROVAL_SELF_FORBIDDEN/,
    ));
    await db.adminQuery(`DELETE FROM tenant_data.assignments WHERE tenant_id = '${T1}' AND role_id = 'self-approver'`);

    // An approver without a current approval grant is refused.
    await addIdentity(db, {tenant: T1, user: U3, legacy: 'user-3', email: 'u3@example.test'});
    await asUser(db, T1, U3, client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state = 'APPROVED', decided_by = 'user-3'
        WHERE tenant_id = '${T1}' AND command_id = 'void-cmd-1'`),
      /APPROVAL_AUTHORITY_REQUIRED/,
    ));

    // The request must bind the exact accepted command digest at creation.
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
        VALUES ('${T1}', 'void-wrong', 'user-1', 'd', '{}', 'ACCEPTED_PENDING', 0);
    `);
    await assert.rejects(() => db.adminQuery(`
      INSERT INTO tenant_data.approval_requests(tenant_id, command_id, payload_digest, policy_snapshot, state)
        VALUES ('${T1}', 'void-wrong', 'different-digest', '{}', 'PENDING')
    `), /APPROVAL_DIGEST_MISMATCH/);

    // A stale decision snapshot is rejected at execution even if the row is approved.
    const stale = await registerVoidSubmission(db, {commandId: 'void-stale', entry: 'approval-1', key: 'ap-stale'});
    const staleDecision = {...stale.decision, amount: stale.decision.amount + 1};
    await requestApproval(db, {commandId: 'void-stale', submission: stale, decision: staleDecision});
    await approve(db, {commandId: 'void-stale'});
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('approval-1', {key: 'ap-stale', approval: 'void-stale'})})`),
      /VOID_APPROVAL_STALE/,
    ));

    // A correct, independent, actor-bound approval authorises exactly this submission.
    const good = await registerVoidSubmission(db, {commandId: 'void-cmd-2', entry: 'approval-1', key: 'ap-3'});
    await requestApproval(db, {commandId: 'void-cmd-2', submission: good});
    await approve(db, {commandId: 'void-cmd-2'});
    const approved = await asUser(db, T1, U1, async client =>
      (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('approval-1', {key: 'ap-3', approval: 'void-cmd-2'})}) AS id`)).rows[0].id, {commit: true});
    assert.equal(approved, 'void-cmd-2');
    const record = (await db.adminQuery(`
      SELECT approver_actor, approval_command_id, approval_version, approval_digest
      FROM tenant_data.entry_voids WHERE void_command_id = 'void-cmd-2'
    `)).rows[0];
    assert.deepEqual(record, {
      approver_actor: 'user-2',
      approval_command_id: 'void-cmd-2',
      approval_version: null,
      approval_digest: good.decisionDigest,
    });
  });
});

test('PIVOT-005 approval policy is currency-matched, deterministic, exact and revalidated at execution', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'policy-1');
    await postedEntry(db, 'policy-2');
    await postedEntry(db, 'policy-3');
    await addReviewer(db);

    // Threshold is exact minor units. Amount equal to the threshold does not review.
    await addPolicy(db, {key: 'a', version: 1, threshold: 100, currency: 'PKR'});
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('policy-1', {key: 'th-1'})})`), {commit: true});

    // Highest version across keys wins; version 2 (threshold 1000) applies to amount 500.
    await addPolicy(db, {key: 'b', version: 2, threshold: 1000, currency: 'PKR'});
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('policy-2', {key: 'th-2'})})`), {commit: true});

    // Two keys claiming the same maximum version are ambiguous and fail closed.
    await addPolicy(db, {key: 'c', version: 2, threshold: 1000, currency: 'PKR'});
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('policy-3', {key: 'th-3'})})`),
      /VOID_POLICY_AMBIGUOUS/,
    ));
    await db.adminQuery(`DELETE FROM tenant_data.approval_policy WHERE tenant_id = '${T1}' AND policy_key = 'c'`);

    // A policy for another currency never applies to this entry's minor units.
    await db.adminQuery(`UPDATE tenant_data.approval_policy SET is_active = false WHERE tenant_id = '${T1}'`);
    await addPolicy(db, {key: 'usd', version: 1, threshold: 100, currency: 'USD'});
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('policy-3', {key: 'th-4'})})`),
      /VOID_POLICY_CURRENCY_MISMATCH/,
    ));

    // A non-integral threshold is malformed and fails closed.
    await db.adminQuery(`DELETE FROM tenant_data.approval_policy WHERE tenant_id = '${T1}' AND policy_key = 'usd'`);
    await addPolicy(db, {key: 'bad', version: 1, threshold: 100.5, currency: 'PKR'});
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('policy-3', {key: 'th-5'})})`),
      /VOID_POLICY_INVALID/,
    ));
    await db.adminQuery(`DELETE FROM tenant_data.approval_policy WHERE tenant_id = '${T1}' AND policy_key = 'bad'`);

    // Threshold exceeded requires review; a policy change after approval makes the
    // approval stale.
    await addPolicy(db, {key: 'strict', version: 1, threshold: 50, currency: 'PKR'});
    await postedEntry(db, 'policy-4');
    const before = await registerVoidSubmission(db, {commandId: 'void-policy-1', entry: 'policy-4', key: 'pol-1', amount: 100});
    await requestApproval(db, {commandId: 'void-policy-1', submission: before});
    await approve(db, {commandId: 'void-policy-1'});
    await addPolicy(db, {key: 'strict', version: 2, threshold: 60, currency: 'PKR'});
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('policy-4', {key: 'pol-1', approval: 'void-policy-1'})})`),
      /VOID_APPROVAL_STALE/,
    ));

    // A current approved decision executes and records the real policy version and
    // exact approver, not a constant approval_version=1.
    await addPolicy(db, {key: 'strict', version: 3, threshold: 50, currency: 'PKR'});
    await postedEntry(db, 'policy-6');
    const current = await registerVoidSubmission(db, {commandId: 'void-policy-2', entry: 'policy-6', key: 'pol-2', amount: 100});
    await requestApproval(db, {commandId: 'void-policy-2', submission: current});
    await approve(db, {commandId: 'void-policy-2'});
    await asUser(db, T1, U1, client => client.query(
      `SELECT tenant_data.void_posted_entry(${voidArgs('policy-6', {key: 'pol-2', approval: 'void-policy-2'})})`), {commit: true});
    const recorded = (await db.adminQuery(`
      SELECT approver_actor, approval_version, policy_version
      FROM tenant_data.entry_voids WHERE void_command_id = 'void-policy-2'
    `)).rows[0];
    assert.deepEqual(recorded, {approver_actor: 'user-2', approval_version: '3', policy_version: '3'});

    // Revoking the approver between approval and execution fails closed.
    await postedEntry(db, 'policy-5');
    const revoked = await registerVoidSubmission(db, {commandId: 'void-policy-3', entry: 'policy-5', key: 'pol-3', amount: 100});
    await requestApproval(db, {commandId: 'void-policy-3', submission: revoked});
    await approve(db, {commandId: 'void-policy-3'});
    await db.adminQuery(`UPDATE tenant_data.members SET active = false WHERE tenant_id = '${T1}' AND user_id = 'user-2'`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('policy-5', {key: 'pol-3', approval: 'void-policy-3'})})`),
      /APPROVAL_APPROVER_NOT_ACTIVE|VOID_APPROVAL_STALE/,
    ));
  });
});

// ---------------------------------------------------------------------------
// Posting boundary: supported plain journal only, unsupported shapes fail closed
// ---------------------------------------------------------------------------

async function pendingCommandApproval(db, {commandId, payload, digest = 'd'}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
      VALUES ($1::uuid, $2, 'user-1', $3, $4, 'ACCEPTED_PENDING', 0)
  `, [T1, commandId, digest, JSON.stringify(payload)]);
  await db.adminQuery(`
    INSERT INTO tenant_data.approval_requests(tenant_id, command_id, payload_digest, policy_snapshot, state)
      VALUES ($1::uuid, $2, $3, '{}', 'PENDING')
  `, [T1, commandId, digest]);
}

test('PIVOT-005 approver authority applies the reviewer exact accounts and maxMinor at decision and execution', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db, {review: true});
    await addReviewer(db, {user: U2, legacy: 'user-2', email: 'u2@example.test', roleId: 'reviewer-valid',
      accounts: ['1000', '4000'], maxMinor: 100});
    await addReviewer(db, {user: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', legacy: 'user-4', email: 'u4@example.test',
      roleId: 'reviewer-account', accounts: ['1000'], maxMinor: 100});
    await addReviewer(db, {user: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', legacy: 'user-5', email: 'u5@example.test',
      roleId: 'reviewer-low', accounts: ['*'], maxMinor: 99});
    await addReviewer(db, {user: 'ffffffff-ffff-4fff-8fff-ffffffffffff', legacy: 'user-6', email: 'u6@example.test',
      roleId: 'reviewer-malformed', accounts: ['*'], maxMinor: '100'});
    await addReviewer(db, {user: '99999999-9999-4999-8999-999999999999', legacy: 'user-7', email: 'u7@example.test',
      roleId: 'reviewer-company', companies: ['other'], accounts: ['*'], maxMinor: 100});
    await addReviewer(db, {user: U3, legacy: 'user-3', email: 'u3@example.test', roleId: 'reviewer-wild'});

    const entries = ['entry-valid', 'entry-account', 'entry-low', 'entry-malformed', 'entry-company', 'entry-exec'];
    for (const entry of entries) await postedEntry(db, entry);

    const prepare = async (entry, commandId, key) => {
      const submission = await registerVoidSubmission(db, {commandId, entry, key});
      await requestApproval(db, {commandId, submission});
      return submission;
    };

    // Valid scoped reviewer: both accounts and the exact maxMinor boundary pass,
    // and the same helper is re-run successfully at void execution.
    await prepare('entry-valid', 'void-valid', 'valid-1');
    await approve(db, {commandId: 'void-valid', user: U2, legacy: 'user-2'});
    await asUser(db, T1, U1, client => client.query(
      `SELECT tenant_data.void_posted_entry(${voidArgs('entry-valid', {key: 'valid-1', approval: 'void-valid'})})`), {commit: true});

    // Reviewer scoped to only one of the two target accounts cannot approve.
    await prepare('entry-account', 'void-account', 'account-1');
    await asUser(db, T1, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state='APPROVED', decided_by='user-4'
        WHERE tenant_id='${T1}' AND command_id='void-account'`),
      /APPROVAL_AUTHORITY_REQUIRED/,
    ));

    // maxMinor is an exact ceiling; 99 cannot approve 100.
    await prepare('entry-low', 'void-low', 'low-1');
    await asUser(db, T1, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state='APPROVED', decided_by='user-5'
        WHERE tenant_id='${T1}' AND command_id='void-low'`),
      /APPROVAL_AUTHORITY_REQUIRED/,
    ));

    // A malformed present maxMinor fails closed rather than becoming unlimited.
    await prepare('entry-malformed', 'void-malformed', 'malformed-1');
    await asUser(db, T1, 'ffffffff-ffff-4fff-8fff-ffffffffffff', client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state='APPROVED', decided_by='user-6'
        WHERE tenant_id='${T1}' AND command_id='void-malformed'`),
      /APPROVAL_PERMISSION_INVALID/,
    ));

    // Out-of-scope company cannot approve.
    await prepare('entry-company', 'void-company', 'company-1');
    await asUser(db, T1, '99999999-9999-4999-8999-999999999999', client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state='APPROVED', decided_by='user-7'
        WHERE tenant_id='${T1}' AND command_id='void-company'`),
      /APPROVAL_AUTHORITY_REQUIRED/,
    ));

    // A pending accepted command resolves the immutable payload's company/branch/lines.
    const pendingPayload = {
      company: 'alpha', branch: 'main', date: '2026-11-16', narrative: 'pending',
      lines: [{account: '1000', debit: 100, credit: 0}, {account: '4000', debit: 0, credit: 100}],
    };
    await pendingCommandApproval(db, {commandId: 'pending-company', payload: pendingPayload});
    await asUser(db, T1, '99999999-9999-4999-8999-999999999999', client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state='APPROVED', decided_by='user-7'
        WHERE tenant_id='${T1}' AND command_id='pending-company'`),
      /APPROVAL_AUTHORITY_REQUIRED/,
    ));
    await pendingCommandApproval(db, {commandId: 'pending-good', payload: pendingPayload});
    await asUser(db, T1, U3, client => client.query(
      `UPDATE tenant_data.approval_requests SET state='APPROVED', decided_by='user-3'
        WHERE tenant_id='${T1}' AND command_id='pending-good'`), {commit: true});

    // Missing or malformed accepted resource data fails closed; it is never
    // treated as an unrestricted action-only grant.
    await pendingCommandApproval(db, {commandId: 'pending-missing', payload: {}});
    await asUser(db, T1, U3, client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state='APPROVED', decided_by='user-3'
        WHERE tenant_id='${T1}' AND command_id='pending-missing'`),
      /APPROVAL_RESOURCE_UNRESOLVED/,
    ));
    await pendingCommandApproval(db, {
      commandId: 'pending-malformed',
      payload: {company: 'alpha', branch: 'main', lines: [
        {account: '1000', debit: '100', credit: 0}, {account: '4000', debit: 0, credit: 100},
      ]},
    });
    await asUser(db, T1, U3, client => assert.rejects(
      () => client.query(`UPDATE tenant_data.approval_requests SET state='APPROVED', decided_by='user-3'
        WHERE tenant_id='${T1}' AND command_id='pending-malformed'`),
      /APPROVAL_RESOURCE_UNRESOLVED/,
    ));

    // Authority is rechecked at execution: an approver narrowed after approval
    // cannot execute a void that its current role no longer covers by account or amount.
    await postedEntry(db, 'entry-exec-limit');
    await prepare('entry-exec', 'void-exec', 'exec-1');
    await prepare('entry-exec-limit', 'void-exec-limit', 'exec-2');
    await approve(db, {commandId: 'void-exec', user: U3, legacy: 'user-3'});
    await approve(db, {commandId: 'void-exec-limit', user: U3, legacy: 'user-3'});
    await db.adminQuery(`
      UPDATE tenant_data.roles
         SET permissions = '{"actions":["journal.approve"],"companies":["*"],"branches":["*"],"accounts":["1000"],"review":false}'
       WHERE tenant_id = '${T1}' AND id = 'reviewer-wild'
    `);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('entry-exec', {key: 'exec-1', approval: 'void-exec'})})`),
      /APPROVAL_AUTHORITY_REQUIRED/,
    ));
    await db.adminQuery(`
      UPDATE tenant_data.roles
         SET permissions = '{"actions":["journal.approve"],"companies":["*"],"branches":["*"],"accounts":["*"],"review":false,"maxMinor":50}'
       WHERE tenant_id = '${T1}' AND id = 'reviewer-wild'
    `);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('entry-exec-limit', {key: 'exec-2', approval: 'void-exec-limit'})})`),
      /APPROVAL_AUTHORITY_REQUIRED/,
    ));
    const partial = (await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.entry_voids WHERE entry_id IN ('entry-exec','entry-exec-limit')`)).rows[0].n;
    assert.equal(partial, 0);
  });
});

test('PIVOT-005 approval policy applies only to matching current role identities', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await addReviewer(db);

    // An unrelated role has a much higher-version high-threshold policy. It must not
    // apply to the requester and must not mask the clerk-specific zero threshold.
    await db.adminQuery(`
      INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
        VALUES ('${T1}', 'other-role', 'Other', false, '{"actions":["accounting.entry.void"],"companies":["*"],"branches":["*"],"accounts":["*"],"review":false}')
    `);
    await addPolicy(db, {key: 'other-role-policy', version: 9, roleId: 'other-role', threshold: 1000, currency: 'PKR'});
    await addPolicy(db, {key: 'global-policy', version: 5, roleId: null, threshold: 1000, currency: 'PKR'});
    await addPolicy(db, {key: 'clerk-policy', version: 1, roleId: 'clerk', threshold: 0, currency: 'PKR'});

    const single = await policyDecision(db, {actor: 'user-1', amount: 100, entry: 'policy-role-1', digest: 'd1'});
    assert.deepEqual(single.matchingRoleIds, ['clerk']);
    assert.equal(single.review, true);
    assert.equal(single.policyVersion, 1);
    assert.equal(single.policyKey, 'clerk-policy');
    assert.equal(single.policies.length, 1);
    assert.deepEqual(single.policies[0], {
      roleId: 'clerk', policyKey: 'clerk-policy', scope: 'ROLE', version: 1, currency: 'PKR',
      thresholdMinor: 0, requiresDifferentApprover: true,
    });
    assert.ok(!single.policies.some(policy => policy.roleId === 'other-role'));

    // A second matching role without a specific policy falls back to the global one.
    // The combined result remains conservative: the zero threshold still controls.
    await addTenantRole(db, {tenant: T1, legacy: 'user-1', roleId: 'clerk-2', permissions: voidPermissions()});
    const multi = await policyDecision(db, {actor: 'user-1', amount: 100, entry: 'policy-role-1', digest: 'd1'});
    assert.deepEqual(multi.matchingRoleIds, ['clerk', 'clerk-2']);
    assert.deepEqual(multi.policies.map(policy => [policy.roleId, policy.scope, policy.version]),
      [['clerk', 'ROLE', 1], ['clerk-2', 'GLOBAL', 5]]);
    assert.equal(multi.review, true);
    assert.equal(multi.policyVersion, 1);
    assert.ok(!multi.policies.some(policy => policy.roleId === 'other-role'));

    // Two global keys at the same maximum version are genuine ambiguity and fail closed.
    await addPolicy(db, {key: 'global-policy-b', version: 5, roleId: null, threshold: 900, currency: 'PKR'});
    await assert.rejects(
      () => policyDecision(db, {actor: 'user-1', amount: 100, entry: 'policy-role-1', digest: 'd1'}),
      /VOID_POLICY_AMBIGUOUS/,
    );
    await db.adminQuery(`DELETE FROM tenant_data.approval_policy WHERE tenant_id='${T1}' AND policy_key='global-policy-b'`);

    // The approval snapshot binds applicability. Removing a matching role after approval
    // changes the decision and invalidates the approval at execution.
    await postedEntry(db, 'policy-role-1');
    const submission = await registerVoidSubmission(db, {commandId: 'void-role-1', entry: 'policy-role-1', key: 'role-1'});
    await requestApproval(db, {commandId: 'void-role-1', submission});
    await approve(db, {commandId: 'void-role-1'});
    await db.adminQuery(`DELETE FROM tenant_data.assignments WHERE tenant_id='${T1}' AND role_id='clerk-2'`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('policy-role-1', {key: 'role-1', approval: 'void-role-1'})})`),
      /VOID_APPROVAL_STALE/,
    ));
  });
});

test('PIVOT-005 runtime posting is exact for a plain journal and refuses unreconciled trade/stock shapes', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);

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

    // Missing audit and missing outbox are refused, and no partial POSTED state remains.
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
      await client.query(`INSERT INTO tenant_data.audit(tenant_id,command_id,actor,event,detail,happened_at)
        VALUES ('${T1}','rt-2','user-1','JOURNAL_POSTED','{}',0)`);
      await assert.rejects(() => client.query(`UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='rt-2'`), /POSTED_REQUIRES_OUTBOX/);
      await client.query('ROLLBACK TO SAVEPOINT s');
    }, {commit: true});
    const rt2 = (await db.adminQuery(`SELECT state FROM tenant_data.command_inbox WHERE id='rt-2'`)).rows[0].state;
    assert.equal(rt2, 'ACCEPTED_PENDING');

    // A balanced journal plus an arbitrary stock operation is NOT accepted as a
    // reconciled posting. The unsupported shape is refused before POSTED.
    await asUser(db, T1, U1, async client => {
      await client.query(`INSERT INTO tenant_data.command_inbox(tenant_id,id,actor,digest,payload,state,created_at)
        VALUES ('${T1}','rt-stock','user-1','d','{}','ACCEPTED_PENDING',0)`);
      await client.query(`INSERT INTO tenant_data.journals(tenant_id,id,company,branch,posting_date,narrative)
        VALUES ('${T1}','rt-stock','alpha','main','2026-11-16','stock')`);
      await client.query(`INSERT INTO tenant_data.journal_lines(tenant_id,journal_id,line_no,account,debit,credit)
        VALUES ('${T1}','rt-stock',1,'1000',10,0),('${T1}','rt-stock',2,'4000',0,10)`);
      await client.query(`INSERT INTO tenant_data.audit(tenant_id,command_id,actor,event,detail,happened_at)
        VALUES ('${T1}','rt-stock','user-1','JOURNAL_POSTED','{}',0)`);
      await client.query(`INSERT INTO tenant_data.outbox(tenant_id,id,event,state) VALUES ('${T1}','rt-stock','JOURNAL_POSTED','READY')`);
      await client.query(`INSERT INTO tenant_data.stock_operations(tenant_id,command_id,kind,payload,expected)
        VALUES ('${T1}','rt-stock','issue','{}','{}')`);
      await client.query('SAVEPOINT s');
      await assert.rejects(() => client.query(`UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='rt-stock'`),
        /POSTED_OPERATION_UNSUPPORTED/);
      await client.query('ROLLBACK TO SAVEPOINT s');
    }, {commit: true});
    const stockState = (await db.adminQuery(`SELECT state FROM tenant_data.command_inbox WHERE id='rt-stock'`)).rows[0].state;
    assert.equal(stockState, 'ACCEPTED_PENDING');

    // Trade-backed commands are equally unsupported at this boundary.
    await asUser(db, T1, U1, async client => {
      await client.query(`INSERT INTO tenant_data.command_inbox(tenant_id,id,actor,digest,payload,state,created_at)
        VALUES ('${T1}','rt-trade','user-1','d','{}','ACCEPTED_PENDING',0)`);
      await client.query(`INSERT INTO tenant_data.journals(tenant_id,id,company,branch,posting_date,narrative)
        VALUES ('${T1}','rt-trade','alpha','main','2026-11-16','trade')`);
      await client.query(`INSERT INTO tenant_data.journal_lines(tenant_id,journal_id,line_no,account,debit,credit)
        VALUES ('${T1}','rt-trade',1,'1000',10,0),('${T1}','rt-trade',2,'4000',0,10)`);
      await client.query(`INSERT INTO tenant_data.audit(tenant_id,command_id,actor,event,detail,happened_at)
        VALUES ('${T1}','rt-trade','user-1','JOURNAL_POSTED','{}',0)`);
      await client.query(`INSERT INTO tenant_data.outbox(tenant_id,id,event,state) VALUES ('${T1}','rt-trade','JOURNAL_POSTED','READY')`);
      await client.query(`INSERT INTO tenant_data.trade_operations(tenant_id,command_id,input_digest,payload)
        VALUES ('${T1}','rt-trade','d','{}')`);
      await client.query('SAVEPOINT s');
      await assert.rejects(() => client.query(`UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='rt-trade'`),
        /POSTED_OPERATION_UNSUPPORTED/);
      await client.query('ROLLBACK TO SAVEPOINT s');
    }, {commit: true});
  });
});

// ---------------------------------------------------------------------------
// Terminal protection, retention and atomic effect rollback
// ---------------------------------------------------------------------------

test('PIVOT-005 void is terminal under runtime and administrative roles, and a failing effect leaves no trace', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await addReviewer(db);
    await postedEntry(db, 'term-1');

    const voidId = await asUser(db, T1, U1, async client =>
      (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('term-1')}) AS id`)).rows[0].id, {commit: true});

    // Runtime may read but never update or physically delete the retained record.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`UPDATE tenant_data.entry_voids SET reason='x'`), /permission denied/));
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query('DELETE FROM tenant_data.entry_voids'), /permission denied/));
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='${voidId}'`),
      /FINAL_STATE_IMMUTABLE|VOID_RECEIPT_IMMUTABLE|POSTED_/));
    // Administrative mutation is refused by the payload guards.
    await assert.rejects(() => db.adminQuery(`UPDATE tenant_data.entry_voids SET reason='x'`), /VOIDED_IMMUTABLE/);
    await assert.rejects(() => db.adminQuery('DELETE FROM tenant_data.entry_voids'), /VOID_RETAINED/);
    await assert.rejects(() => db.adminQuery(`UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='${voidId}'`), /FINAL_STATE_IMMUTABLE|VOID_RECEIPT_IMMUTABLE|POSTED_/);
    await assert.rejects(() => db.adminQuery(`DELETE FROM tenant_data.command_inbox WHERE id='${voidId}'`), /RETAINED/);

    // Native audit and change-audit rows are retained and immutable.
    await assert.rejects(() => db.adminQuery(`UPDATE tenant_data.audit SET event='X' WHERE command_id='${voidId}'`), /VOID_AUDIT_IMMUTABLE/);
    await assert.rejects(() => db.adminQuery(`DELETE FROM tenant_data.audit WHERE command_id='${voidId}'`), /VOID_AUDIT_IMMUTABLE/);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`UPDATE tenant_data.audit SET event='X' WHERE command_id='${voidId}'`), /permission denied/));
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`DELETE FROM tenant_data.audit WHERE command_id='${voidId}'`), /permission denied/));

    // No late children on either the voided source or the terminal void command.
    await assert.rejects(() => db.adminQuery(`
      INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit)
        VALUES ('${T1}', 'term-1', 9, '1000', 1, 0)
    `), /POSTED_SOURCE_LATE_LINE/);
    await assert.rejects(() => db.adminQuery(`
      INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
        VALUES ('${T1}', 'term-1', 'alpha', 'main', '2026-11-16', 'late')
    `), /POSTED_SOURCE_LATE_JOURNAL/);
    await assert.rejects(() => db.adminQuery(`
      INSERT INTO tenant_data.command_files(tenant_id, id, command_id, name, media_type, sha256, byte_size, scan, created_at)
        VALUES ('${T1}', 'late-file', 'term-1', 'x', 'text/plain', repeat('a', 64), 1, 'clean', 0)
    `), /POSTED_SOURCE_LATE_CHILD/);

    // Injected failure: a pre-existing outbox row with the same terminal command id
    // makes the primitive's outbox insert fail; the whole void bundle must roll back.
    await postedEntry(db, 'term-atomic');
    await addPolicy(db, {key: 'atomic-policy', version: 1, threshold: 50, currency: 'PKR'});
    const atomic = await registerVoidSubmission(db, {commandId: 'void-atomic', entry: 'term-atomic', key: 'atomic-1'});
    await requestApproval(db, {commandId: 'void-atomic', submission: atomic});
    await approve(db, {commandId: 'void-atomic'});
    await db.adminQuery(`INSERT INTO tenant_data.outbox(tenant_id, id, event, state) VALUES ('${T1}', 'void-atomic', 'BLOCKER', 'READY')`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('term-atomic', {key: 'atomic-1', approval: 'void-atomic'})})`),
      /duplicate key|outbox_pkey/,
    ));
    const rollback = (await db.adminQuery(`
      SELECT (SELECT count(*)::int FROM tenant_data.entry_voids WHERE entry_id = 'term-atomic') AS voids,
             (SELECT count(*)::int FROM tenant_data.audit WHERE command_id = 'void-atomic' AND event = 'ENTRY_VOIDED') AS native_audit,
             (SELECT count(*)::int FROM tenant_data.audit_event WHERE entity_id = 'term-atomic' AND event = 'ENTRY_VOIDED') AS change_audit,
             (SELECT state FROM tenant_data.command_inbox WHERE id = 'void-atomic') AS receipt,
             (SELECT state FROM tenant_data.command_inbox WHERE id = 'term-atomic') AS source
    `)).rows[0];
    assert.deepEqual(rollback, {voids: 0, native_audit: 0, change_audit: 0, receipt: 'ACCEPTED_PENDING', source: 'POSTED'});
  });
});

// ---------------------------------------------------------------------------
// Correction references: both ends, creation timing and concurrency
// ---------------------------------------------------------------------------

test('PIVOT-005 correction links protect both ends, require link-before-post and refuse late links', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'orig-1');
    await postedEntry(db, 'orig-2');
    await pendingReversal(db, 'rev-1');

    // Positive: link while the reversal is pending, then post it in the same transaction.
    await asAdminTransaction(db, [
      `INSERT INTO tenant_data.journal_corrections(tenant_id, command_id, original_id, reason)
         VALUES ('${T1}', 'rev-1', 'orig-1', 'fix')`,
      `INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
         VALUES ('${T1}', 'rev-1', 'user-1', 'JOURNAL_POSTED', '{}', 0)`,
      `INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
         VALUES ('${T1}', 'rev-1', 'JOURNAL_POSTED', 'READY')`,
      `UPDATE tenant_data.command_inbox SET state = 'POSTED' WHERE tenant_id = '${T1}' AND id = 'rev-1'`,
    ]);
    const linked = (await db.adminQuery(`
      SELECT (SELECT state FROM tenant_data.command_inbox WHERE id='rev-1') AS reversal,
             (SELECT count(*)::int FROM tenant_data.journal_corrections WHERE command_id='rev-1') AS links
    `)).rows[0];
    assert.deepEqual(linked, {reversal: 'POSTED', links: 1});

    // A late link onto an already posted reversal is refused.
    await postedEntry(db, 'rev-2');
    await assert.rejects(() => db.adminQuery(`
      INSERT INTO tenant_data.journal_corrections(tenant_id, command_id, original_id, reason)
        VALUES ('${T1}', 'rev-2', 'orig-2', 'late')
    `), /CORRECTION_REVERSAL_FINAL/);

    // The concrete counterexample: void the would-be reversal first, then try to link it.
    await postedEntry(db, 'rev-3');
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('rev-3', {key: 'void-rev-3'})})`), {commit: true});
    await assert.rejects(() => db.adminQuery(`
      INSERT INTO tenant_data.journal_corrections(tenant_id, command_id, original_id, reason)
        VALUES ('${T1}', 'rev-3', 'orig-2', 'late-voided')
    `), /CORRECTION_REVERSAL_FINAL/);

    // Once a link exists, neither end may be voided as a plain journal.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('orig-1', {key: 'void-orig'})})`),
      /VOID_LINKED_CORRECTION/,
    ));
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('rev-1', {key: 'void-rev-1'})})`),
      /VOID_LINKED_CORRECTION/,
    ));

    // Void before posting is refused; after posting (without a link) it succeeds once.
    await pendingReversal(db, 'rev-4');
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('rev-4', {key: 'void-rev-4'})})`),
      /VOID_ENTRY_NOT_POSTED/,
    ));
    await postPending(db, 'rev-4');
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('rev-4', {key: 'void-rev-4'})})`), {commit: true});
  });
});

test('PIVOT-005 correction and void writers serialize on both ends', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'race-1');
    await pendingReversal(db, 'race-rev');

    // Correction first, void second: the reversal is linked while pending and then
    // posted in one transaction. The void waits on the shared original lock and must
    // observe the committed link.
    const results = await Promise.allSettled([
      asUser(db, T1, U1, async client => {
        await client.query(`INSERT INTO tenant_data.journal_corrections(tenant_id,command_id,original_id,reason)
          VALUES ('${T1}','race-rev','race-1','fix')`);
        await client.query(`INSERT INTO tenant_data.audit(tenant_id, command_id, actor, event, detail, happened_at)
          VALUES ('${T1}', 'race-rev', 'user-1', 'JOURNAL_POSTED', '{}', 0)`);
        await client.query(`INSERT INTO tenant_data.outbox(tenant_id, id, event, state)
          VALUES ('${T1}', 'race-rev', 'JOURNAL_POSTED', 'READY')`);
        await client.query(`UPDATE tenant_data.command_inbox SET state='POSTED' WHERE id='race-rev'`);
        await client.query('SELECT pg_sleep(0.3)');
        return 'correction';
      }, {commit: true}),
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('race-1', {key: 'race-c'})})`), {commit: true});
      })(),
    ]);
    assert.equal(results[0].status, 'fulfilled', String(results[0].reason));
    assert.equal(results[1].status, 'rejected');
    assert.match(String(results[1].reason), /VOID_LINKED_CORRECTION/);
    const links = (await db.adminQuery(`SELECT count(*)::int AS n FROM tenant_data.journal_corrections WHERE original_id='race-1'`)).rows[0].n;
    assert.equal(links, 1);
  });
});

// ---------------------------------------------------------------------------
// Idempotency and concurrency
// ---------------------------------------------------------------------------

test('PIVOT-005 replay, duplicate and same-key/different-entry races follow the idempotency contract', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'conc-1');
    await postedEntry(db, 'conc-2');
    await postedEntry(db, 'conc-3');

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
    const once = (await db.adminQuery(`
      SELECT (SELECT count(*)::int FROM tenant_data.entry_voids) AS voids,
             (SELECT count(*)::int FROM tenant_data.audit WHERE event='ENTRY_VOIDED') AS audit
    `)).rows[0];
    assert.deepEqual(once, {voids: 1, audit: 1});

    // A distinct key on the same voided entry is refused, not silently replayed.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('conc-1', {key: 'other-key'})})`),
      /ENTRY_ALREADY_VOIDED/,
    ));

    // Same idempotency key, concurrent different entries: exactly one commits and the
    // other receives the declared conflict, never a raw unique-index failure.
    const sameKey = await Promise.allSettled([
      asUser(db, T1, U1, async client => {
        const id = (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('conc-2', {key: 'shared-key'})}) AS id`)).rows[0].id;
        await client.query('SELECT pg_sleep(0.3)');
        return id;
      }, {commit: true}),
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return asUser(db, T1, U1, async client =>
          (await client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('conc-3', {key: 'shared-key'})}) AS id`)).rows[0].id, {commit: true});
      })(),
    ]);
    const fulfilled = sameKey.filter(r => r.status === 'fulfilled');
    const rejected = sameKey.filter(r => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(String(rejected[0].reason), /VOID_IDEMPOTENCY_CONFLICT/);
  });
});

test('PIVOT-005 refuses voiding retained operational dependencies without partial effects', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'legacy-stock');
    await postedEntry(db, 'legacy-trade');

    // Simulate retained/imported posted operational data that predates the guarded
    // posting boundary, then prove the void refuses it explicitly.
    await db.adminQuery('ALTER TABLE tenant_data.stock_operations DISABLE TRIGGER saven_p005_stock_operations');
    await db.adminQuery(`
      INSERT INTO tenant_data.stock_operations(tenant_id, command_id, kind, payload, expected)
        VALUES ('${T1}', 'legacy-stock', 'issue', '{}', '{}')
    `);
    await db.adminQuery('ALTER TABLE tenant_data.stock_operations ENABLE TRIGGER saven_p005_stock_operations');
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('legacy-stock', {key: 'legacy-s'})})`),
      /VOID_DEPENDENCY_UNSUPPORTED/,
    ));

    await db.adminQuery('ALTER TABLE tenant_data.trade_operations DISABLE TRIGGER saven_p005_trade_operations');
    await db.adminQuery(`
      INSERT INTO tenant_data.trade_operations(tenant_id, command_id, input_digest, payload)
        VALUES ('${T1}', 'legacy-trade', 'd', '{}')
    `);
    await db.adminQuery('ALTER TABLE tenant_data.trade_operations ENABLE TRIGGER saven_p005_trade_operations');
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('legacy-trade', {key: 'legacy-t'})})`),
      /VOID_DEPENDENCY_UNSUPPORTED/,
    ));

    const partial = (await db.adminQuery(`
      SELECT (SELECT count(*)::int FROM tenant_data.entry_voids) AS voids,
             (SELECT count(*)::int FROM tenant_data.audit WHERE event = 'ENTRY_VOIDED') AS audit
    `)).rows[0];
    assert.deepEqual(partial, {voids: 0, audit: 0});
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation, context binding and permissive-widening resistance
// ---------------------------------------------------------------------------

test('PIVOT-005 tenant isolation, missing/spoofed context and permissive-widening resistance hold', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'iso-1');
    await seed(db, {tenant: T2, user: U2, legacy: 'user-2', email: 'u2@example.test'});
    await addTenantRole(db, {
      tenant: T2, legacy: 'user-2', roleId: 'clerk2', permissions: voidPermissions(),
    });

    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('iso-1')})`), {commit: true});

    // Tenant two sees no void rows and cannot target tenant one's entry.
    const foreign = await asUser(db, T2, U2, async client => ({
      voids: (await client.query('SELECT count(*)::int AS n FROM tenant_data.entry_voids')).rows[0].n,
      view: (await client.query('SELECT count(*)::int AS n FROM tenant_data.voided_entries')).rows[0].n,
    }));
    assert.deepEqual(foreign, {voids: 0, view: 0});
    await asUser(db, T2, U2, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('iso-1', {tenant: T2, actor: 'user-2', key: 'iso-2'})})`),
      /VOID_TENANT_CONTEXT_MISMATCH|VOID_ENTRY_NOT_FOUND/,
    ));

    // Missing and malformed context fail closed.
    await asUser(db, undefined, undefined, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('iso-1', {key: 'no-ctx'})})`),
      /VOID_TENANT_CONTEXT_MISMATCH|VOID_CONTEXT_REQUIRED/,
    ));
    await asUser(db, T1, undefined, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('iso-1', {key: 'no-user'})})`),
      /VOID_CONTEXT_REQUIRED/,
    ));
    await asUser(db, 'not-a-uuid', U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('iso-1', {key: 'bad-ctx'})})`),
      /VOID_TENANT_CONTEXT_MISMATCH|VOID_CONTEXT_REQUIRED/,
    ));
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('iso-1', {actor: 'user-2', key: 'actor'})})`),
      /VOID_ACTOR_MISMATCH/,
    ));

    // Extra permissive policy cannot widen the restrictive tenant scope.
    await db.adminQuery(`
      CREATE POLICY pivot005_attack ON tenant_data.entry_voids AS PERMISSIVE FOR ALL
        TO "${db.roles.customerApp}" USING (true) WITH CHECK (true)
    `);
    const widened = await asUser(db, T2, U2, client =>
      client.query('SELECT count(*)::int AS n FROM tenant_data.entry_voids'));
    assert.equal(widened.rows[0].n, 0);
    await db.adminQuery('DROP POLICY pivot005_attack ON tenant_data.entry_voids');
  });
});

// ---------------------------------------------------------------------------
// Durable denial log and actor binding
// ---------------------------------------------------------------------------

test('PIVOT-005 denial log is durable, append-only and bound to verified context', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'deny-1');

    // Force a denial with an explicit denial row, then record it in a separate txn.
    await db.adminQuery(`INSERT INTO tenant_data.denials(tenant_id, user_id, action) VALUES ('${T1}', 'user-1', 'accounting.entry.void')`);
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('deny-1', {key: 'deny-1'})})`),
      /VOID_ACTION_DENIED/,
    ));
    const denial = await asUser(db, T1, U1, async client => {
      await client.query(`
        INSERT INTO tenant_data.void_denials(tenant_id, entry_id, attempt_key, reason_code, detail)
          VALUES ('${T1}', 'deny-1', 'deny-1', 'VOID_ACTION_DENIED', 'denied')
      `);
      return (await client.query(`
        SELECT actor, actor_uuid::text AS actor_uuid, reason_code FROM tenant_data.void_denials
      `)).rows[0];
    }, {commit: true});
    assert.deepEqual(denial, {actor: 'user-1', actor_uuid: U1, reason_code: 'VOID_ACTION_DENIED'});

    // The caller cannot supply the actor columns directly.
    await asUser(db, T1, U1, client => assert.rejects(
      () => client.query(`INSERT INTO tenant_data.void_denials(tenant_id, actor, reason_code) VALUES ('${T1}', 'fake', 'X')`),
      /permission denied/,
    ));
    // The denial log is append-only.
    await assert.rejects(() => db.adminQuery('UPDATE tenant_data.void_denials SET reason_code = \'X\''), /VOID_DENIAL_RETAINED/);
    await assert.rejects(() => db.adminQuery('DELETE FROM tenant_data.void_denials'), /VOID_DENIAL_RETAINED/);
  });
});

// ---------------------------------------------------------------------------
// Activation and installed-payload lifecycle
// ---------------------------------------------------------------------------

test('PIVOT-005 activation is fail-closed, atomic and repeatable', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles: [...preActivationAdminFiles, 'db/postgres/migrations/042-entry-voiding.sql']}, async db => {
    await seed(db);
    await grantVoid(db);
    await postedEntry(db, 'act-1');

    const before = await db.adminQuery(`
      SELECT has_function_privilege($1, 'tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)', 'EXECUTE') AS exec,
             has_table_privilege($1, 'tenant_data.entry_voids', 'SELECT') AS read_voids,
             has_table_privilege($1, 'tenant_data.active_general_ledger', 'SELECT') AS read_active
    `, [db.roles.customerApp]);
    assert.deepEqual(before.rows[0], {exec: false, read_voids: false, read_active: false});

    // Interrupted activation: the whole dispatcher transaction rolls back, so no
    // trigger or grant is left behind and the runtime interface stays closed.
    const dispatcher = await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8');
    const broken = dispatcher.replace(
      'GRANT SELECT ON tenant_data.active_general_ledger, tenant_data.voided_entries TO saven_customer_app;',
      'GRANT SELECT ON tenant_data.active_general_ledger, tenant_data.voided_entries TO saven_p005_missing_runtime;',
    );
    await assert.rejects(() => db.adminQuery(namespaceSql(broken, db.roles)), /saven_p005_missing_runtime|does not exist/);
    await db.adminQuery('ROLLBACK').catch(() => {});
    const interrupted = (await db.adminQuery(`
      SELECT count(*)::int AS triggers FROM pg_trigger WHERE tgname LIKE 'saven_p005_%' AND NOT tgisinternal
    `)).rows[0].triggers;
    assert.equal(interrupted, 0);
    const closed = await db.adminQuery(`
      SELECT has_function_privilege($1, 'tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)', 'EXECUTE') AS exec
    `, [db.roles.customerApp]);
    assert.equal(closed.rows[0].exec, false);

    // Complete activation exposes only the intended interface.
    await db.adminQuery(namespaceSql(dispatcher, db.roles));
    const after = await db.adminQuery(`
      SELECT has_function_privilege($1, 'tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)', 'EXECUTE') AS exec,
             has_table_privilege($1, 'tenant_data.active_general_ledger', 'SELECT') AS read_active,
             has_table_privilege($1, 'tenant_data.entry_voids', 'INSERT') AS write_voids,
             (SELECT count(*)::int FROM pg_trigger WHERE tgname LIKE 'saven_p005_%' AND NOT tgisinternal) AS triggers
    `, [db.roles.customerApp]);
    assert.deepEqual(after.rows[0], {exec: true, read_active: true, write_voids: false, triggers: 25});
    await asUser(db, T1, U1, client => client.query(`SELECT tenant_data.void_posted_entry(${voidArgs('act-1')})`), {commit: true});

    // Re-running the dispatcher is idempotent and revalidates the same bindings.
    await db.adminQuery(namespaceSql(dispatcher, db.roles));
    const repeated = (await db.adminQuery(`
      SELECT count(*)::int AS triggers FROM pg_trigger WHERE tgname LIKE 'saven_p005_%' AND NOT tgisinternal
    `)).rows[0].triggers;
    assert.equal(repeated, 25);

    // Applied payloads are immutable and are not silently replaced.
    const payload = await readFile(new URL('db/postgres/migrations/040-posted-immutability.sql', repoRoot), 'utf8');
    await assert.rejects(() => db.adminQuery(namespaceSql(payload, db.roles)), /already applied and is immutable/);
    await db.adminQuery('ROLLBACK').catch(() => {});
    const voiding = await readFile(new URL('db/postgres/migrations/042-entry-voiding.sql', repoRoot), 'utf8');
    await assert.rejects(() => db.adminQuery(namespaceSql(voiding, db.roles)), /already applied/);
    await db.adminQuery('ROLLBACK').catch(() => {});
  });
});

test('PIVOT-005 refuses every polluted pre-existing void owner class without repairing it', async () => {
  const cases = [
    {
      name: 'extra table ACL',
      pollute: async (db, role) => db.adminQuery(`GRANT SELECT ON tenant_data.accounts TO "${role}"`),
    },
    {
      name: 'schema CREATE',
      pollute: async (db, role) => db.adminQuery(`GRANT CREATE ON SCHEMA tenant_data TO "${role}"`),
    },
    {
      name: 'role membership',
      pollute: async (db, role) => db.adminQuery(`GRANT "${db.roles.migrator}" TO "${role}"`),
    },
    {
      name: 'relation ownership',
      pollute: async (db, role) => db.adminQuery(`
        CREATE TABLE tenant_data.p005_owned_object(id integer);
        ALTER TABLE tenant_data.p005_owned_object OWNER TO "${role}";
      `),
    },
    {
      name: 'default privilege',
      pollute: async (db, role) => db.adminQuery(`ALTER DEFAULT PRIVILEGES IN SCHEMA tenant_data GRANT SELECT ON TABLES TO "${role}"`),
    },
  ];

  for (const scenario of cases) {
    await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles: preActivationAdminFiles}, async db => {
      const role = db.extraRoles.voidDefiner;
      await db.adminQuery(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`);
      await scenario.pollute(db, role);
      const before = await db.adminQuery(`SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1`, [role]);
      const sql = namespaceSql(await readFile(new URL('db/postgres/migrations/042-entry-voiding.sql', repoRoot), 'utf8'), db.roles);
      await assert.rejects(() => db.adminQuery(sql), /R5-AUTHORITY/, `expected ${scenario.name} to refuse`);
      await db.adminQuery('ROLLBACK');
      const after = await db.adminQuery(`SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1`, [role]);
      assert.deepEqual(after.rows, before.rows, `${scenario.name}: role definition is untouched`);
      const fn = await db.adminQuery(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'void_posted_entry'`);
      assert.equal(fn.rows[0].n, 0, `${scenario.name}: no primitive is created`);
    });
  }
});

// ---------------------------------------------------------------------------
// Static contract: structure, canonical authority and registration
// ---------------------------------------------------------------------------

test('PIVOT-005 static contract: lifecycle predicate, both-ended corrections, fail-closed posting, role-agnostic activation', async () => {
  const payload = await readFile(new URL('db/postgres/migrations/040-posted-immutability.sql', repoRoot), 'utf8');
  const voiding = await readFile(new URL('db/postgres/migrations/042-entry-voiding.sql', repoRoot), 'utf8');
  const dispatcher = await readFile(new URL('db/postgres/40-triggers.sql', repoRoot), 'utf8');
  const rules = JSON.parse(await readFile(new URL('contracts/postgres-business-rules-v1.json', repoRoot), 'utf8'));

  // Active GL requires the POSTED lifecycle, not merely the absence of a void.
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

  // Canonical permission contract, currency/units and deterministic role ordering.
  assert.match(voiding, /jsonb_exists\(v_actions, 'accounting\.entry\.void'\)/);
  assert.match(voiding, /d\.action IN \('accounting\.entry\.void', '\*'\)/);
  assert.match(voiding, /jsonb_exists\(v_role\.rule, 'maxMinor'\)/);
  assert.match(voiding, /VOID_PERMISSION_INVALID/);
  assert.match(voiding, /approval_policy/);
  assert.match(voiding, /VOID_POLICY_CURRENCY_MISMATCH/);
  assert.match(voiding, /VOID_POLICY_AMBIGUOUS/);
  assert.match(voiding, /ORDER BY r\.id/);
  assert.match(voiding, /ap\.role_id = v_policy_role/);
  assert.match(voiding, /'matchingRoleIds', to_jsonb\(v_role_ids\)/);
  assert.match(voiding, /'policies', v_policies/);
  assert.match(voiding, /'scope', v_candidate_scope/);
  assert.match(voiding, /candidate_threshold < v_effective_threshold/);
  assert.match(voiding, /VOID_PERIOD_LOCKED/);
  assert.match(voiding, /VOID_APPROVAL_STALE/);
  assert.match(voiding, /immutability_040_approver_authority/);
  assert.match(voiding, /approval_policy\.role_id:SELECT/);
  assert.doesNotMatch(voiding, /permissions::jsonb -> 'accounting\.entry\.void'/);

  // Approver authority resolves a complete resource and applies one role's
  // account/maxMinor grant at both decision and execution.
  assert.match(payload, /immutability_040_approval_resource/);
  assert.match(payload, /APPROVAL_RESOURCE_UNRESOLVED/);
  assert.match(payload, /v_account_scope/);
  assert.match(payload, /v_amount > v_max::bigint/);
  assert.match(payload, /APPROVAL_AUTHORITY_REQUIRED/);

  // Both ends of a correction are locked and checked, before and after posting.
  assert.match(payload, /v_lock_original := tenant_data\.immutability_040_lock_key/);
  assert.match(payload, /v_lock_reversal := tenant_data\.immutability_040_lock_key/);
  assert.match(payload, /CORRECTION_REVERSAL_FINAL/);
  assert.match(payload, /CORRECTION_REVERSAL_VOIDED/);
  assert.match(payload, /CORRECTION_ORIGINAL_VOIDED/);

  // Unsupported operational shapes fail closed at the posting boundary.
  assert.match(payload, /POSTED_OPERATION_UNSUPPORTED/);
  assert.match(payload, /trade_operations/);
  assert.match(payload, /stock_operations/);
  assert.doesNotMatch(payload, /TRADE_UNRECONCILED/);

  // Approval transitions are actor-bound, never insertable as APPROVED metadata.
  assert.match(payload, /APPROVAL_TRANSITION_REQUIRED/);
  assert.match(payload, /APPROVAL_DECIDER_MISMATCH/);
  assert.match(payload, /APPROVAL_SELF_FORBIDDEN/);
  assert.match(payload, /APPROVAL_BINDING_IMMUTABLE/);

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
