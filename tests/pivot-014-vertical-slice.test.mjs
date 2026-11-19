// PIVOT-014 — permanent automated proof of the authenticated journal lifecycle.
//
// Runs inside `node scripts/check.mjs` on every invocation against a freshly created
// disposable local PostgreSQL cluster. No manual preparation, live credential, SSH,
// cloud service or environment skip can produce a pass: missing prerequisites throw and
// fail the check.
//
// NO-FLAKINESS: this file contains no retry loop. Every operation runs once. Connection
// teardown, timeout or port-collision faults propagate as failures, and the whole test
// is bounded by WHOLE_TEST_BUDGET_MS. Deterministic port allocation happens once in the
// helper (one ephemeral bind), and cleanup runs in a finally block.

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';

import {createDisposableCluster} from './helpers/pivot-014-disposable-postgres.mjs';
import {createAuthServer} from '../src/auth/server.mjs';
import {cookieName} from '../src/auth/routes.mjs';
import {createAuditWriter, AUTH_AUDIT_CATALOG_VERSION, AUTH_AUDIT_VERSION} from '../src/auth/audit.mjs';
import {encodePassword} from '../src/passwords.mjs';
import {composeVerticalSlice} from '../src/accounting/vertical-slice/application.mjs';
import {createPgRepository} from '../src/accounting/vertical-slice/pg-repository.mjs';
import {API_PREFIX} from '../src/accounting/vertical-slice/ports.mjs';

/** Declared whole-test budget. Exceeding it fails the gate; nothing is retried. */
const WHOLE_TEST_BUDGET_MS = 240_000;

/** Pinned security-audit catalog version (Principal directive, PIVOT-006 review). */
const PINNED_CATALOG_VERSION = 1;

const ORIGIN = 'https://app.example.test';
const OPERATOR_ORIGIN = 'https://ops.example.test';
const COMPANY = 'ACME';
const BRANCH = 'HQ';
const POSTING_DATE = '2026-03-05';
const PASSWORD = 'correct horse battery staple';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLERK_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTOR = {ownerA: 'owner-a', clerkA: 'clerk-a', ownerB: 'owner-b'};

const CLERK_RULE = JSON.stringify({
  actions: ['journal.read', 'journal.prepare', 'journal.post'],
  companies: [COMPANY],
  branches: [BRANCH],
  accounts: ['*'],
  review: false,
});

// ---------------------------------------------------------------- utilities

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function call(handler, method, path, {origin = ORIGIN, cookie, csrf, body, key, requestId} = {}) {
  const headers = {'origin': origin};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (requestId) headers['x-request-id'] = requestId;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const request = new Request(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request);
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return {status: response.status, body: parsed, text, headers: response.headers};
}

/**
 * Pins an accepted group role on each borrowed connection. The login itself holds no
 * owner/DDL/BYPASSRLS authority, so this is not "SET ROLE from an owner connection".
 */
function withRole(pool, role) {
  return {
    async connect() {
      const client = await pool.connect();
      await client.query(`SET ROLE ${role}`);
      return client;
    },
    async query(text, params) {
      const client = await pool.connect();
      try {
        await client.query(`SET ROLE ${role}`);
        return await client.query(text, params);
      } finally {
        client.release();
      }
    },
  };
}

function balanced(lines = [['1000', '50000', '0'], ['4000', '0', '50000']]) {
  return {
    company: COMPANY,
    branch: BRANCH,
    postingDate: POSTING_DATE,
    narrative: 'Slice proof entry',
    lines: lines.map(([account, debit, credit]) => ({account, debit, credit})),
  };
}

// ---------------------------------------------------------------- the test

test('PIVOT-014 authenticated journal lifecycle (create → post → read → void → audit)', {
  timeout: WHOLE_TEST_BUDGET_MS,
}, async t => {
  const started = Date.now();
  let cluster;
  const pools = [];
  let admin;

  try {
    cluster = await createDisposableCluster();
    const connection = {host: cluster.host, port: cluster.port, database: cluster.database};

    const appPool = new pg.Pool({...connection, user: cluster.logins.app, password: cluster.logins.appPassword, max: 12});
    const authPool = new pg.Pool({...connection, user: cluster.logins.auth, password: cluster.logins.authPassword, max: 12});
    pools.push(appPool, authPool);
    admin = new pg.Client({...connection, user: process.env.USER});
    await admin.connect();

    // ---- synthetic tenant data only (never target journals/lines/audit evidence) ----
    const passwordHash = await encodePassword(PASSWORD);
    const seed = async (sql, params = []) => admin.query(sql, params);
    // Transaction-scoped context: SET LOCAL semantics require an open transaction, so
    // every synthetic write runs inside one. The admin connection is bootstrap only and
    // never executes a lifecycle operation.
    const asTenant = async (tenantId, userUuid, body) => {
      await seed('BEGIN');
      try {
        await seed(`SELECT set_config('app.current_tenant_id', $1, true),
                           set_config('app.current_user_id', $2, true)`, [tenantId, userUuid]);
        await body();
        await seed('COMMIT');
      } catch (error) {
        await seed('ROLLBACK');
        throw error;
      }
    };

    for (const [tenantId, users] of [
      [TENANT_A, [{id: OWNER_A, legacy: ACTOR.ownerA, role: 'ultimate_business_admin'},
        {id: CLERK_A, legacy: ACTOR.clerkA, role: 'clerk'}]],
      [TENANT_B, [{id: OWNER_B, legacy: ACTOR.ownerB, role: 'ultimate_business_admin'}]],
    ]) {
      for (const user of users) {
        await seed(`INSERT INTO auth.users (id, legacy_id, email, email_verified, status,
                          password_hash, password_scheme, password_updated_at, credential_version)
                    VALUES ($1, $2, $3, true, 'active', $4, 'scrypt', now(), 1)`,
        [user.id, user.legacy, `${user.legacy}@example.test`, passwordHash]);
        await seed(`INSERT INTO auth.tenant_membership
                      (id, tenant_id, user_id, role_id, status, membership_epoch, invited_at, accepted_at)
                    VALUES (gen_random_uuid(), $1, $2, $3, 'active', 1, now(), now())`,
        [tenantId, user.id, 'member']);
      }

      // Principal projections and assignments (one context per principal).
      for (const user of users) {
        await asTenant(tenantId, user.id, () => seed(
          `INSERT INTO tenant_data.members (tenant_id, user_id, user_uuid, active)
           VALUES ($1, $2, $3, true)`, [tenantId, user.legacy, user.id]));
      }

      // Shared tenant configuration, written once under the first principal's context.
      await asTenant(tenantId, users[0].id, async () => {
        await seed(`INSERT INTO tenant_data.roles (tenant_id, id, name, protected, permissions)
                    VALUES ($1, 'ultimate_business_admin', 'Ultimate business administrator', true, '{}')`,
        [tenantId]);
        await seed(`INSERT INTO tenant_data.roles (tenant_id, id, name, protected, permissions)
                    VALUES ($1, 'clerk', 'Clerk', false, $2)`, [tenantId, CLERK_RULE]);
        for (const user of users) {
          await seed(`INSERT INTO tenant_data.assignments (tenant_id, user_id, role_id)
                      VALUES ($1, $2, $3)`, [tenantId, user.legacy, user.role]);
        }
        for (const [code, title] of [['1000', 'Cash'], ['4000', 'Revenue'], ['5000', 'Expense']]) {
          await seed(`INSERT INTO tenant_data.accounts (tenant_id, code, title) VALUES ($1, $2, $3)`,
            [tenantId, code, title]);
        }
        await seed(`INSERT INTO tenant_data.company_profiles
                      (tenant_id, id, name, currency, branch, created_at)
                    VALUES ($1, $2, 'Acme', 'USD', $3, 0)`, [tenantId, COMPANY, BRANCH]);
        await seed(`INSERT INTO tenant_data.periods
                      (tenant_id, company, start_date, end_date, locked)
                    VALUES ($1, $2, '2026-01-01', '2026-12-31', false)`, [tenantId, COMPANY]);
        for (const [domain, value, label] of [
          ['origin_type', 'human', 'Human'], ['origin_type', 'ai', 'AI'],
          ['origin_type', 'integration', 'Integration'], ['origin_type', 'system', 'System'],
          ['document_type', 'journal', 'Journal'], ['document_status', 'draft', 'Draft'],
          ['document_status', 'posted', 'Posted'], ['command_state', 'ACCEPTED_PENDING', 'Accepted'],
          ['command_state', 'POSTED', 'Posted'], ['command_state', 'VOIDED', 'Voided'],
        ]) {
          await seed(`INSERT INTO tenant_data.reference_values (tenant_id, domain, value, label)
                      VALUES ($1, $2, $3, $4)`, [tenantId, domain, value, label]);
        }
      });
    }
    await asTenant(TENANT_A, OWNER_A, () => seed(
      `INSERT INTO tenant_data.business (tenant_id, id, state) VALUES ($1, 'biz', 'ACTIVE')`, [TENANT_A]));
    await asTenant(TENANT_B, OWNER_B, () => seed(
      `INSERT INTO tenant_data.business (tenant_id, id, state) VALUES ($1, 'biz', 'ACTIVE')`, [TENANT_B]));

    // ---- the real auth server and the real accounting application ----
    const authService = withRole(authPool, 'saven_auth_service');
    const auth = createAuthServer({
      pool: authService,
      clock: () => new Date(),
      origins: {customer: ORIGIN, operator: OPERATOR_ORIGIN},
      secureCookies: false,
      audit: createAuditWriter(authService),
    });
    const securityWriter = createAuditWriter(authService);
    const app = composeVerticalSlice({
      businessPool: appPool,
      authStore: auth.store,
      securityAuditWriter: securityWriter,
      customerOrigin: ORIGIN,
      cookieName: cookieName('customer', false),
      clock: {now: () => Date.now()},
      pinnedCatalogVersion: PINNED_CATALOG_VERSION,
    });

    const cookieNameValue = cookieName('customer', false);
    async function signIn(email) {
      const response = await call(auth.handler, 'POST', '/v1/auth/login', {body: {email, password: PASSWORD}});
      assert.equal(response.status, 200, `login failed: ${response.text}`);
      const cookie = response.headers.getSetCookie().find(value => value.startsWith(`${cookieNameValue}=`));
      assert.ok(cookie, 'the auth server must issue a host-only session cookie');
      const token = cookie.split(';')[0].split('=')[1];
      const csrf = response.body.csrfToken;
      assert.ok(csrf, 'login must return a CSRF token');
      return {cookie: `${cookieNameValue}=${token}`, token, csrf};
    }
    async function selectTenant(session, tenantId) {
      const response = await call(auth.handler, 'POST', '/v1/auth/tenant/select',
        {cookie: session.cookie, csrf: session.csrf, body: {tenantId}});
      assert.equal(response.status, 200, `tenant selection failed: ${response.text}`);
      return session;
    }

    const ownerA = await selectTenant(await signIn(`${ACTOR.ownerA}@example.test`), TENANT_A);
    const clerkA = await selectTenant(await signIn(`${ACTOR.clerkA}@example.test`), TENANT_A);
    const ownerB = await selectTenant(await signIn(`${ACTOR.ownerB}@example.test`), TENANT_B);

    // ---- baselines captured AFTER login/setup so auth rows never inflate counts ----
    const shortcut = async (sql, params) => (await admin.query(sql, params)).rows;
    const tenantCounts = async tenantId => (await shortcut(`
      SELECT (SELECT count(*) FROM tenant_data.journals WHERE tenant_id=$1)::int AS journals,
             (SELECT count(*) FROM tenant_data.journal_lines WHERE tenant_id=$1)::int AS lines,
             (SELECT count(*) FROM tenant_data.audit WHERE tenant_id=$1)::int AS lifecycle,
             (SELECT count(*) FROM tenant_data.audit_event WHERE tenant_id=$1)::int AS changes,
             (SELECT count(*) FROM tenant_data.document_numbers WHERE tenant_id=$1)::int AS numbers,
             (SELECT count(*) FROM tenant_data.document_sequences WHERE tenant_id=$1)::int AS sequences,
             (SELECT count(*) FROM tenant_data.command_inbox WHERE tenant_id=$1)::int AS commands,
             (SELECT count(*) FROM tenant_data.outbox WHERE tenant_id=$1)::int AS outbox`,
    [tenantId]))[0];
    const authAuditBaseline = (await shortcut(
      'SELECT count(*)::int AS n FROM auth.auth_audit'))[0].n;

    // ---------------------------------------------------------------- S1
    await t.test('S1 real application path and restricted principal', async () => {
      const created = await call(app, 'POST', `${API_PREFIX}/journals`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's1-journal-0001', body: {journal: balanced()}});
      assert.equal(created.status, 201, created.text);
      const steps = app.trace.map(entry => entry.step);
      for (const required of ['origin.verified', 'session.verified', 'tenant.admitted', 'csrf.verified', 'service.create', 'principal.observed']) {
        assert.ok(steps.includes(required), `request path missing ${required}`);
      }
      assert.equal(created.body.meta.principal.current_user, 'saven_customer_app');
      assert.equal(created.body.meta.principal.session_user, cluster.logins.app);
      assert.equal(created.body.meta.slice, 1);

      // No cookie means no lifecycle: the service cannot be reached by direct invocation.
      const anonymous = await call(app, 'POST', `${API_PREFIX}/journals`,
        {key: 's1-journal-0002', body: {journal: balanced()}});
      assert.equal(anonymous.status, 401);
      assert.equal(anonymous.body.error.code, 'AUTH_REQUIRED');

      // Wrong exact origin is refused before any lookup.
      const foreign = await call(app, 'POST', `${API_PREFIX}/journals`,
        {origin: 'https://evil.example.test', cookie: ownerA.cookie, csrf: ownerA.csrf,
          key: 's1-journal-0003', body: {journal: balanced()}});
      assert.equal(foreign.status, 421);
      assert.equal(foreign.body.error.code, 'ORIGIN_UNRECOGNIZED');
    });

    // ---------------------------------------------------------------- S3
    await t.test('S3 cross-tenant refusal with permitted controls', async () => {
      const bCreate = await call(app, 'POST', `${API_PREFIX}/journals?post=1`,
        {cookie: ownerB.cookie, csrf: ownerB.csrf, key: 'b-journal-0001', body: {journal: balanced()}});
      assert.equal(bCreate.status, 201, bCreate.text);
      const bId = bCreate.body.data.id;

      const beforeB = await tenantCounts(TENANT_B);
      const foreignRead = await call(app, 'GET', `${API_PREFIX}/journals/${bId}`, {cookie: ownerA.cookie});
      assert.equal(foreignRead.status, 403);
      assert.equal(foreignRead.body.error.code, 'TENANT_RESOURCE_DENIED');
      assert.ok(!foreignRead.text.includes('Slice proof entry'), 'no foreign payload may leak');

      const foreignAudit = await call(app, 'GET', `${API_PREFIX}/audit?tenantId=${TENANT_B}`, {cookie: ownerA.cookie});
      assert.equal(foreignAudit.status, 403);
      assert.equal(foreignAudit.body.error.code, 'AUDIT_TENANT_DENIED');

      const ownAudit = await call(app, 'GET', `${API_PREFIX}/audit`, {cookie: ownerA.cookie});
      assert.equal(ownAudit.status, 200);
      assert.ok(ownAudit.body.data.lifecycle.length >= 1, 'own audit must not be empty');
      assert.ok(ownAudit.body.data.lifecycle.every(row => !String(row.detail).includes(bId)),
        'own audit must not contain another tenant command');

      const bOwnRead = await call(app, 'GET', `${API_PREFIX}/journals/${bId}`, {cookie: ownerB.cookie});
      assert.equal(bOwnRead.status, 200);
      assert.equal(bOwnRead.body.data.id, bId);
      const bOwnAudit = await call(app, 'GET', `${API_PREFIX}/audit`, {cookie: ownerB.cookie});
      assert.equal(bOwnAudit.status, 200);
      assert.ok(bOwnAudit.body.data.lifecycle.some(row => String(row.detail).includes(bId)));

      const afterB = await tenantCounts(TENANT_B);
      assert.deepEqual(afterB, beforeB, 'refused requests must not mutate tenant B');

      const denials = await shortcut(
        `SELECT detail_jsonb->>'reason' AS reason FROM auth.auth_audit
          WHERE event_type = 'access_denied' AND outcome = 'denied'
            AND detail_jsonb->>'reason' IN ('TENANT_RESOURCE_DENIED','AUDIT_TENANT_DENIED')`);
      assert.ok(denials.length >= 2, 'both refusals must be recorded through the security-audit boundary');
    });

    // ---------------------------------------------------------------- S4
    await t.test('S4 unbalanced request leaves no trace and consumes no number', async () => {
      const before = await tenantCounts(TENANT_A);
      const unbalanced = await call(app, 'POST', `${API_PREFIX}/journals?post=1`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's4-unbalanced-01',
          body: {journal: balanced([['1000', '50000', '0'], ['4000', '0', '49999']])}});
      assert.equal(unbalanced.status, 422);
      assert.equal(unbalanced.body.error.code, 'UNBALANCED_ENTRY');
      const after = await tenantCounts(TENANT_A);
      assert.deepEqual(after, before, 'no journal, line, audit, command, outbox or number may survive');

      // Positive control: the balanced twin posts.
      const ok = await call(app, 'POST', `${API_PREFIX}/journals?post=1`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's4-balanced-001', body: {journal: balanced()}});
      assert.equal(ok.status, 201, ok.text);
      assert.equal(ok.body.data.state, 'POSTED');
    });

    // ---------------------------------------------------------------- S5
    await t.test('S5 void is a state change with retained evidence', async () => {
      const created = await call(app, 'POST', `${API_PREFIX}/journals?post=1`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's5-journal-0001', body: {journal: balanced()}});
      assert.equal(created.status, 201, created.text);
      const id = created.body.data.id;

      const beforeRows = (await shortcut(
        `SELECT to_jsonb(j)::text AS row FROM tenant_data.journals j WHERE tenant_id=$1 AND id=$2`,
        [TENANT_A, id]))[0].row;
      const beforeLines = (await shortcut(
        `SELECT to_jsonb(l)::text AS row FROM tenant_data.journal_lines l
          WHERE tenant_id=$1 AND journal_id=$2 ORDER BY line_no`, [TENANT_A, id])).map(r => r.row);

      const voided = await call(app, 'POST', `${API_PREFIX}/journals/${id}/void`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's5-void-0001', body: {reason: 'Duplicate posting'}});
      assert.equal(voided.status, 200, voided.text);
      assert.equal(voided.body.data.state, 'VOIDED');

      const active = await shortcut(
        `SELECT 1 FROM tenant_data.active_general_ledger WHERE tenant_id=$1 AND journal_id=$2`, [TENANT_A, id]);
      assert.equal(active.length, 0, 'voided entry must leave the active ledger');
      const voidedView = await shortcut(
        `SELECT reason FROM tenant_data.voided_entries WHERE tenant_id=$1 AND entry_id=$2`, [TENANT_A, id]);
      assert.equal(voidedView.length, 2, 'both original lines remain visible as voided history');
      assert.ok(voidedView.every(row => row.reason === 'Duplicate posting'));

      const afterRows = (await shortcut(
        `SELECT to_jsonb(j)::text AS row FROM tenant_data.journals j WHERE tenant_id=$1 AND id=$2`,
        [TENANT_A, id]))[0].row;
      const afterLines = (await shortcut(
        `SELECT to_jsonb(l)::text AS row FROM tenant_data.journal_lines l
          WHERE tenant_id=$1 AND journal_id=$2 ORDER BY line_no`, [TENANT_A, id])).map(r => r.row);
      assert.equal(afterRows, beforeRows, 'the posted source is byte-for-byte retained');
      assert.deepEqual(afterLines, beforeLines, 'the posted lines are byte-for-byte retained');

      // Replay with the same key returns the receipt without a second mutation.
      const beforeReplay = await tenantCounts(TENANT_A);
      const replay = await call(app, 'POST', `${API_PREFIX}/journals/${id}/void`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's5-void-0001', body: {reason: 'Duplicate posting'}});
      assert.equal(replay.status, 200, replay.text);
      const afterReplay = await tenantCounts(TENANT_A);
      assert.deepEqual(afterReplay, beforeReplay, 'same-key void retry must not add rows');

      // A new void request against a terminal entry is refused by a specific error.
      const again = await call(app, 'POST', `${API_PREFIX}/journals/${id}/void`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's5-void-0002', body: {reason: 'Second attempt'}});
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'ENTRY_ALREADY_VOIDED');

      // Physical mutation is refused by the accepted database guards.
      let directUpdate = null;
      let directDelete = null;
      await seed('BEGIN');
      try {
        await seed(`SELECT set_config('app.current_tenant_id', $1, true),
                           set_config('app.current_user_id', $2, true)`, [TENANT_A, OWNER_A]);
        directUpdate = await admin.query(
          `UPDATE tenant_data.journals SET narrative='tampered' WHERE tenant_id=$1 AND id=$2`, [TENANT_A, id]
        ).then(() => null, error => error);
        directDelete = await admin.query(
          `DELETE FROM tenant_data.journal_lines WHERE tenant_id=$1 AND journal_id=$2`, [TENANT_A, id]
        ).then(() => null, error => error);
      } finally {
        await seed('ROLLBACK');
      }
      assert.ok(directUpdate, 'direct journal update must be refused');
      assert.ok(directDelete, 'direct line delete must be refused');

      // Authority is data, never a role name encoded in a table, view or policy.
      const policies = await shortcut(`SELECT qual, with_check FROM pg_policies WHERE schemaname='tenant_data'`);
      assert.ok(!JSON.stringify(policies).includes('ultimate_business_admin'),
        'no policy may encode the protected role name');
    });

    // ---------------------------------------------------------------- S6
    await t.test('S6 complete lifecycle audit with enumerated change events', async () => {
      assert.equal(Number(AUTH_AUDIT_CATALOG_VERSION), PINNED_CATALOG_VERSION,
        'the pinned security-audit catalog version must equal the active version');
      assert.equal(AUTH_AUDIT_VERSION, 1);

      const maxId = async () => (await shortcut('SELECT coalesce(max(id),0)::bigint AS id FROM tenant_data.audit_event'))[0].id;
      const eventsSince = async since => shortcut(
        `SELECT entity_type, event, actor_id, origin_type FROM tenant_data.audit_event
          WHERE tenant_id=$1 AND id > $2 ORDER BY id`, [TENANT_A, since]);

      const lifecycleFor = async commandId => shortcut(
        `SELECT event, actor, detail FROM tenant_data.audit WHERE tenant_id=$1 AND command_id=$2 ORDER BY id`,
        [TENANT_A, commandId]);

      // Expected inventory is declared before observing results.
      const sequenceRowExists = (await shortcut(
        `SELECT 1 FROM tenant_data.document_sequences WHERE tenant_id=$1 AND company=$2 AND kind='JRN'`,
        [TENANT_A, COMPANY])).length > 0;
      const createExpected = [
        'document_numbers:TENANT_CHANGE_INSERT',
        'document_registry:TENANT_CHANGE_INSERT',
        'document_sequences:TENANT_CHANGE_UPDATE',
      ];
      if (!sequenceRowExists) createExpected.push('document_sequences:TENANT_CHANGE_INSERT');

      const s6Start = await maxId();
      let mark = await maxId();
      const created = await call(app, 'POST', `${API_PREFIX}/journals`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's6-journal-0001', body: {journal: balanced()}});
      assert.equal(created.status, 201, created.text);
      const id = created.body.data.id;
      const createEvents = await eventsSince(mark);
      assert.deepEqual(createEvents.map(row => `${row.entity_type}:${row.event}`).sort(),
        createExpected.sort());
      // Actor is the verified principal on every row. Origin is truthful: tables with an
      // origin column record 'human'; tables without one record the accepted
      // 'system'/unavailable provenance marker instead of inventing a human origin.
      assert.ok(createEvents.every(row => row.actor_id === ACTOR.ownerA));
      for (const row of createEvents) {
        const expectedOrigin = row.entity_type === 'document_registry' ? 'human' : 'system';
        assert.equal(row.origin_type, expectedOrigin, `origin for ${row.entity_type}`);
      }
      const createLifecycle = await lifecycleFor(id);
      assert.equal(createLifecycle.length, 1, 'exactly one canonical create event');
      assert.equal(createLifecycle[0].event, 'JOURNAL_ACCEPTED');
      assert.equal(createLifecycle[0].actor, ACTOR.ownerA);

      mark = await maxId();
      const posted = await call(app, 'POST', `${API_PREFIX}/journals/${id}/post`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's6-post-0001'});
      assert.equal(posted.status, 200, posted.text);
      const postEvents = await eventsSince(mark);
      assert.deepEqual(postEvents.map(row => `${row.entity_type}:${row.event}`).sort(),
        ['document_registry:TENANT_CHANGE_UPDATE', 'journal_lines:TENANT_CHANGE_INSERT',
          'journal_lines:TENANT_CHANGE_INSERT', 'journals:TENANT_CHANGE_INSERT']);
      const postLifecycle = await lifecycleFor(id);
      assert.equal(postLifecycle.length, 2);
      assert.equal(postLifecycle[1].event, 'JOURNAL_POSTED');

      mark = await maxId();
      const voided = await call(app, 'POST', `${API_PREFIX}/journals/${id}/void`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's6-void-0001', body: {reason: 'Audit proof'}});
      assert.equal(voided.status, 200, voided.text);
      const voidEvents = await eventsSince(mark);
      assert.deepEqual(voidEvents.map(row => `${row.entity_type}:${row.event}`), ['journal:ENTRY_VOIDED']);
      // The accepted 042 primitive records the void against its own command id, so the
      // entry keeps exactly its create and post events and the void event is separate.
      assert.equal((await lifecycleFor(id)).length, 2);
      const voidCommandId = voided.body.data.voidCommandId;
      const voidLifecycle = await lifecycleFor(voidCommandId);
      assert.equal(voidLifecycle.length, 1, 'exactly one canonical void event');
      assert.equal(voidLifecycle[0].event, 'ENTRY_VOIDED');

      // Authorized application audit path agrees with the independently stored evidence.
      const viaApp = await call(app, 'GET', `${API_PREFIX}/audit?commandId=${id}`, {cookie: ownerA.cookie});
      assert.equal(viaApp.status, 200);
      assert.deepEqual(viaApp.body.data.lifecycle.map(row => row.event),
        ['JOURNAL_ACCEPTED', 'JOURNAL_POSTED']);
      const voidApp = await call(app, 'GET', `${API_PREFIX}/audit?commandId=${voidCommandId}`, {cookie: ownerA.cookie});
      assert.equal(voidApp.status, 200);
      assert.deepEqual(voidApp.body.data.lifecycle.map(row => row.event), ['ENTRY_VOIDED']);
      assert.deepEqual(voidApp.body.data.changes, [], 'the change event is correlated to the voided entry');
      // Complete inventory read through the authorized application path by id window.
      const windowApp = await call(app, 'GET', `${API_PREFIX}/audit?since=${s6Start}`, {cookie: ownerA.cookie});
      assert.equal(windowApp.status, 200);
      assert.equal(windowApp.body.data.changes.length, createExpected.length + 5,
        'the app path must return the whole operation inventory');
      // Entity-correlated reads only see rows 041 gives an entity id; sequence and number
      // rows are correlated by the id window instead, which the next assertion uses.
      assert.deepEqual(viaApp.body.data.changes.map(row => `${row.entity_type}:${row.event}`),
        ['journal:ENTRY_VOIDED']);

      // Secret sentinels never reach stored audit evidence or outward responses.
      const sentinels = [ownerA.token, ownerA.csrf];
      for (const row of [...viaApp.body.data.lifecycle, ...viaApp.body.data.changes]) {
        const text = JSON.stringify(row);
        for (const sentinel of sentinels) assert.ok(!text.includes(sentinel), 'audit payload must not carry credentials');
      }
      for (const sentinel of sentinels) assert.ok(!viaApp.text.includes(sentinel));

      // Atomicity probe: a mid-mutation failure rolls the business change and its success
      // audit back together. INSERT on outbox is withdrawn for the runtime only.
      await seed(`REVOKE INSERT ON tenant_data.outbox FROM saven_customer_app`);
      try {
        const before = await tenantCounts(TENANT_A);
        const broken = await call(app, 'POST', `${API_PREFIX}/journals?post=1`,
          {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's6-rollback-01', body: {journal: balanced()}});
        assert.equal(broken.status, 500, 'a write-permission fault must fail, not silently succeed');
        assert.equal(broken.body.error.code, 'ACCOUNTING_UNAVAILABLE');
        const after = await tenantCounts(TENANT_A);
        assert.equal(after.journals, before.journals, 'no journal may survive the failed transaction');
        assert.equal(after.lines, before.lines, 'no line may survive the failed transaction');
        assert.equal(after.lifecycle, before.lifecycle, 'no success audit row may survive either');
        const stale = await shortcut(
          `SELECT 1 FROM tenant_data.audit WHERE tenant_id=$1 AND command_id='s6-rollback-01'`, [TENANT_A]);
        assert.equal(stale.length, 0);
      } finally {
        await seed(`GRANT INSERT ON tenant_data.outbox TO saven_customer_app`);
      }
    });

    // ---------------------------------------------------------------- S7
    await t.test('S7 idempotent replay and conflict refusal', async () => {
      const created = await call(app, 'POST', `${API_PREFIX}/journals`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's7-journal-0001', body: {journal: balanced()}});
      assert.equal(created.status, 201, created.text);
      const id = created.body.data.id;

      const first = await call(app, 'POST', `${API_PREFIX}/journals/${id}/post`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's7-post-0001'});
      assert.equal(first.status, 200, first.text);
      const baseline = await tenantCounts(TENANT_A);

      const replay = await call(app, 'POST', `${API_PREFIX}/journals/${id}/post`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's7-post-0001'});
      assert.equal(replay.status, 200, replay.text);
      assert.equal(replay.body.data.replayed, true);
      assert.deepEqual(await tenantCounts(TENANT_A), baseline, 'replay must add no rows');

      // Concurrent replay of the same post: still one journal and one logical event.
      const [a, b] = await Promise.all([
        call(app, 'POST', `${API_PREFIX}/journals/${id}/post`, {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's7-post-0002'}),
        call(app, 'POST', `${API_PREFIX}/journals/${id}/post`, {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's7-post-0003'}),
      ]);
      assert.ok([a.status, b.status].every(status => status === 200), `${a.text} / ${b.text}`);
      assert.deepEqual(await tenantCounts(TENANT_A), baseline, 'concurrent replay must add no rows');

      // Same idempotency key with different content is refused by its specific error.
      const conflict = await call(app, 'POST', `${API_PREFIX}/journals`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's7-journal-0001',
          body: {journal: {...balanced(), narrative: 'Different content'}}});
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

      // Session/tenant changes cannot inherit another actor's replay authority.
      const foreign = await call(app, 'POST', `${API_PREFIX}/journals/${id}/post`,
        {cookie: ownerB.cookie, csrf: ownerB.csrf, key: 's7-post-0001'});
      assert.equal(foreign.status, 403);
    });

    // ---------------------------------------------------------------- S8
    await t.test('S8 concurrent numbering and non-reusable allocation', async () => {
      let concurrent = 0;
      let peak = 0;
      const tracked = promise => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        return promise.finally(() => { concurrent -= 1; });
      };

      const [left, right] = await Promise.all([
        tracked(call(app, 'POST', `${API_PREFIX}/journals?post=1`,
          {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's8-concurrent-0001', body: {journal: balanced()}})),
        tracked(call(app, 'POST', `${API_PREFIX}/journals?post=1`,
          {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's8-concurrent-0002', body: {journal: balanced()}})),
      ]);
      assert.equal(left.status, 201, left.text);
      assert.equal(right.status, 201, right.text);
      assert.equal(peak, 2, 'both requests must actually overlap');

      const first = left.body.data.number;
      const second = right.body.data.number;
      assert.notEqual(first, second, 'distinct numbers required');
      const sequence = value => Number(String(value).split('-')[1]);
      assert.ok(sequence(second) === sequence(first) + 1 || sequence(first) === sequence(second) + 1);

      const rows = await shortcut(
        `SELECT sequence, number FROM tenant_data.document_numbers WHERE tenant_id=$1 ORDER BY sequence`, [TENANT_A]);
      const sequences = rows.map(row => Number(row.sequence));
      assert.equal(new Set(sequences).size, sequences.length, 'no duplicate identity may exist');

      // Failure AFTER allocation: the reserved identity is consumed, not reissued.
      const repository = createPgRepository({pool: appPool});
      const contextFor = {tenantId: TENANT_A, userUuid: OWNER_A, actor: ACTOR.ownerA, now: Date.now()};
      const reserved = await repository.reserveNumber(contextFor, {id: 's8-abandoned-0001', company: COMPANY, kind: 'JRN'});
      const retry = await repository.reserveNumber(contextFor, {id: 's8-abandoned-0001', company: COMPANY, kind: 'JRN'});
      assert.equal(retry.number, reserved.number, 'the same id must keep its allocated identity');
      assert.equal(retry.reused, true);

      const later = await call(app, 'POST', `${API_PREFIX}/journals?post=1`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's8-later-0001', body: {journal: balanced()}});
      assert.equal(later.status, 201, later.text);
      assert.ok(sequence(later.body.data.number) > sequence(reserved.number),
        'a later success must advance past the abandoned identity');

      // The abandoned identity is never handed to a different party.
      const others = await shortcut(
        `SELECT id FROM tenant_data.document_numbers WHERE tenant_id=$1 AND number=$2`,
        [TENANT_A, reserved.number]);
      assert.deepEqual(others.map(row => row.id), ['s8-abandoned-0001']);

      // Reapplication/interruption probe: the counter high-water cannot move backwards.
      const before = (await shortcut(
        `SELECT next_number FROM tenant_data.document_sequences WHERE tenant_id=$1 AND company=$2 AND kind='JRN'`,
        [TENANT_A, COMPANY]))[0].next_number;
      const regression = await admin.query(
        `UPDATE tenant_data.document_sequences SET next_number = next_number - 1
          WHERE tenant_id=$1 AND company=$2 AND kind='JRN'`, [TENANT_A, COMPANY]
      ).then(() => null, error => error);
      assert.ok(regression, 'a high-water regression must be refused');
      const after = (await shortcut(
        `SELECT next_number FROM tenant_data.document_sequences WHERE tenant_id=$1 AND company=$2 AND kind='JRN'`,
        [TENANT_A, COMPANY]))[0].next_number;
      assert.equal(after, before);
    });

    // ---------------------------------------------------------------- S9
    await t.test('S9 refusals are specific and paired with permitted controls', async () => {
      // A clerk may post but may not void: the refusal is the accepted policy decision.
      const created = await call(app, 'POST', `${API_PREFIX}/journals?post=1`,
        {cookie: clerkA.cookie, csrf: clerkA.csrf, key: 's9-clerk-0001', body: {journal: balanced()}});
      assert.equal(created.status, 201, created.text);
      const id = created.body.data.id;

      const denied = await call(app, 'POST', `${API_PREFIX}/journals/${id}/void`,
        {cookie: clerkA.cookie, csrf: clerkA.csrf, key: 's9-clerk-void-01', body: {reason: 'Not my authority'}});
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error.code, 'PERMISSION_DENIED');

      const ownerEntry = await call(app, 'POST', `${API_PREFIX}/journals?post=1`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's9-owner-0001', body: {journal: balanced()}});
      assert.equal(ownerEntry.status, 201, ownerEntry.text);
      const permitted = await call(app, 'POST', `${API_PREFIX}/journals/${ownerEntry.body.data.id}/void`,
        {cookie: ownerA.cookie, csrf: ownerA.csrf, key: 's9-owner-void-01', body: {reason: 'Authorized void'}});
      assert.equal(permitted.status, 200, permitted.text);

      // Missing CSRF is a specific refusal, not a generic failure.
      const noCsrf = await call(app, 'POST', `${API_PREFIX}/journals`,
        {cookie: ownerA.cookie, key: 's9-no-csrf-0001', body: {journal: balanced()}});
      assert.equal(noCsrf.status, 403);
      assert.equal(noCsrf.body.error.code, 'CSRF_REQUIRED');

      // Every denial above has a matching security-audit row.
      const reasons = (await shortcut(
        `SELECT detail_jsonb->>'reason' AS reason FROM auth.auth_audit
          WHERE event_type = 'access_denied' AND outcome = 'denied'`)).map(row => row.reason);
      for (const reason of ['PERMISSION_DENIED', 'CSRF_REQUIRED', 'TENANT_RESOURCE_DENIED']) {
        assert.ok(reasons.includes(reason), `security audit must record ${reason}`);
      }
      const authAuditTotal = (await shortcut('SELECT count(*)::int AS n FROM auth.auth_audit'))[0].n;
      assert.ok(authAuditTotal > authAuditBaseline, 'refusals must have added durable auth audit rows');
    });

    const elapsed = Date.now() - started;
    assert.ok(elapsed < WHOLE_TEST_BUDGET_MS, `whole-test budget exceeded: ${elapsed}ms`);
    t.diagnostic(`whole lifecycle completed in ${elapsed}ms of ${WHOLE_TEST_BUDGET_MS}ms budget`);
  } finally {
    if (admin) await admin.end().catch(() => {});
    for (const pool of pools) await pool.end().catch(() => {});
    if (cluster) await cluster.stop();
  }
});
