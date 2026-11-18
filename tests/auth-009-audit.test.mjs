import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {withAuthDatabase} from './helpers/pg-auth-fixture.mjs';
import {createSessionStore} from '../src/auth/session-store.mjs';
import {createAuthRoutes, cookieName} from '../src/auth/routes.mjs';
import {
  createAuditWriter,
  prepareAuditRow,
  AUTH_AUDIT_CATALOG,
  ADR03_REQUIRED_EVENTS,
  AuditDurabilityError,
} from '../src/auth/audit.mjs';
import {createPasswordPolicy} from '../src/auth/password-policy.mjs';
import {createMailAdapter} from '../src/auth/mail.mjs';
import {totpCode} from '../src/auth/factors.mjs';

const {Pool} = pg;
const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const customerCookie = cookieName('customer', true);
const accountKey = Buffer.alloc(32, 11);
const recoveryKey = Buffer.alloc(32, 13);
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

// The Node version and disposable-cluster requirements of the AUTH contract are the
// same as AUTH-001..007: the fixture refuses to run without an explicit opt-in.
function connectionConfig(database, overrides = {}) {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database,
    max: 8,
    application_name: 'saven-auth-009-test',
    ...overrides,
  };
}

function testClock(start = new Date()) {
  let now = new Date(start);
  return {
    clock: () => now,
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
}

const mfaConfig = () => ({
  keys: [{version: 1, key: accountKey}],
  recoveryKeys: [{version: 1, key: recoveryKey}],
  maxFailures: 3,
  lockoutMs: 60 * 1000,
  recoveryCodeCount: 5,
});

async function insertUser(db, email, password, {verified = true} = {}) {
  const hashed = await createPasswordPolicy().hash(password);
  const result = await db.adminQuery(
    `INSERT INTO auth.users(email, password_hash, password_scheme, password_updated_at,
                            email_verified, email_verified_at)
     VALUES ($1, $2, $3, now(), $4, CASE WHEN $4 THEN now() ELSE NULL END)
     RETURNING id::text AS id, credential_version`,
    [email, hashed.hash, hashed.scheme, verified],
  );
  return {id: result.rows[0].id, credentialVersion: Number(result.rows[0].credential_version)};
}

function makeFindUser(pool) {
  return async email => {
    const result = await pool.query(
      `SELECT id, email, email_verified, password_hash, password_scheme, status, credential_version
       FROM auth.users WHERE lower(email) = $1`,
      [String(email).trim().toLowerCase()],
    );
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified === true,
      passwordHash: row.password_hash,
      passwordScheme: row.password_scheme,
      status: row.status,
      credentialVersion: Number(row.credential_version),
    };
  };
}

function buildRoutes({pool, clock, audit = null, mail = null, operatorAccess = null, mfa = mfaConfig(), rateLimitPolicy = {}}) {
  const store = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
  const handler = createAuthRoutes({
    store,
    findUserByEmail: makeFindUser(pool),
    audit: audit ?? createAuditWriter(pool),
    origins,
    secureCookies: true,
    clock: clock.clock,
    rateLimitPolicy,
    mfaConfig: mfa,
    mail,
    operatorAccess,
  });
  return {store, handler};
}

function request(url, {method = 'GET', cookie, headers = {}, body} = {}) {
  const merged = {...headers};
  if (cookie) merged.cookie = cookie;
  if (body !== undefined) {
    merged['content-type'] = merged['content-type'] ?? 'application/json';
    return new Request(url, {method, headers: merged, body: JSON.stringify(body)});
  }
  return new Request(url, {method, headers: merged});
}

function loginRequest(body, {origin = origins.customer, headers = {}} = {}) {
  return request(`${origin}/v1/auth/login`, {method: 'POST', headers: {origin, ...headers}, body});
}

function forgotRequest(body, {origin = origins.customer} = {}) {
  return request(`${origin}/v1/auth/forgot-password`, {method: 'POST', headers: {origin}, body});
}

function resetRequest(body, {origin = origins.customer} = {}) {
  return request(`${origin}/v1/auth/reset-password`, {method: 'POST', headers: {origin}, body});
}

function authedPost(path, token, csrf, body = {}) {
  return request(`${origins.customer}${path}`, {
    method: 'POST',
    headers: {origin: origins.customer, cookie: `${customerCookie}=${token}`, 'x-csrf-token': csrf},
    body,
  });
}

function tokenFrom(response) {
  const value = response.headers.get('set-cookie') ?? '';
  return new RegExp(`${customerCookie}=([^;]+)`).exec(value)?.[1] ?? null;
}

async function login(handler, email, password, options = {}) {
  const response = await handler(loginRequest({email, password}, options));
  const body = await response.clone().json().catch(() => null);
  const setCookie = response.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${customerCookie}=([^;]+)`).exec(setCookie)?.[1] ?? null;
  return {response, body, token, csrf: body?.csrfToken ?? null};
}

async function flushMail(handler) {
  if (handler.mailDelivery) await handler.mailDelivery.flush();
}

function captureMail() {
  const messages = [];
  const mail = createMailAdapter({
    transport: async message => {
      messages.push(message);
    },
    baseUrl: 'https://app.saven.test',
  });
  return {messages, mail};
}

function tokenFromMessage(message) {
  const match = /[?&]token=([A-Za-z0-9_.-]+)/.exec(message.text);
  assert.ok(match, 'the captured message must carry a token link');
  return decodeURIComponent(match[1]);
}

function secretFromUri(uri) {
  const secret = /[?&]secret=([A-Z2-7]+)/.exec(uri)?.[1];
  assert.ok(secret, 'the otpauth URI must carry the base32 secret');
  return secret;
}

async function ledger(db, where = '', params = []) {
  const clause = where ? ` WHERE ${where}` : '';
  const result = await db.adminQuery(
    `SELECT event_type, outcome, user_id::text AS user_id, realm, session_id,
            request_id, tenant_id::text AS tenant_id, detail_jsonb, detail_schema_version,
            actor_subject
     FROM auth.auth_audit${clause} ORDER BY id`,
    params,
  );
  return result.rows;
}

async function enrolledAdmin({db, clock, handler, email = 'admin@example.com'}) {
  const user = await insertUser(db, email, 'correct-horse-battery');
  await db.adminQuery(
    `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
     VALUES ($1, $2, 'tenant_admin', 'active', now(), now())`,
    [TENANT, user.id],
  );
  const session = await login(handler, email, 'correct-horse-battery');
  assert.equal(session.response.status, 200);
  const enroll = await handler(authedPost('/v1/auth/mfa/enroll', session.token, session.csrf, {}));
  assert.equal(enroll.status, 200);
  const secret = secretFromUri((await enroll.json()).otpauthUri);
  const code = totpCode(secret, {at: clock.now()});
  const verified = await handler(authedPost('/v1/auth/mfa/enroll/verify', session.token, session.csrf, {code}));
  assert.equal(verified.status, 200);
  const body = await verified.json();
  return {...session, userId: user.id, secret, recoveryCodes: body.recoveryCodes};
}

async function applyAuthorityGate(db) {
  const sql = (await readFile(new URL('../db/postgres/migrations/033-membership-admission-lock.sql', import.meta.url), 'utf8'))
    .replaceAll('saven_migrator', `"${db.roles.migrator}"`);
  await db.adminQuery(sql);
}

// The authority gate rejects a superuser caller (its owner must be unreachable), so
// tenant selection is exercised through a real non-owner auth-service login exactly as
// AUTH-006 does. The extra login is dropped before the fixture tears the namespace down.
async function withAuthServicePool(db, action) {
  const login = `saven_auth_${randomBytes(5).toString('hex')}_service_login`;
  const password = randomBytes(24).toString('base64url');
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  await db.adminQuery(
    `CREATE ROLE ${quote(login)} LOGIN PASSWORD '${password}' ` +
    'NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION',
  );
  await db.adminQuery(`GRANT ${quote(db.roles.authService)} TO ${quote(login)}`);
  const pool = new Pool(connectionConfig(db.database, {user: login, password}));
  try {
    return await action(pool);
  } finally {
    await pool.end().catch(() => {});
    await db.adminQuery(`DROP ROLE IF EXISTS ${quote(login)}`).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Catalog, redaction and attribution contract (no database)
// ---------------------------------------------------------------------------

test('AUTH-009 catalog covers every ADR03 event and reports its real producer honestly', () => {
  for (const required of Object.keys(ADR03_REQUIRED_EVENTS)) {
    assert.ok(Object.hasOwn(AUTH_AUDIT_CATALOG, required), `${required} must exist in the catalog`);
  }
  for (const [name, spec] of Object.entries(AUTH_AUDIT_CATALOG)) {
    assert.ok(typeof spec.category === 'string' && spec.category.length > 0, `${name} needs a category`);
    assert.ok(Array.isArray(spec.actors) && spec.actors.length > 0, `${name} needs actor semantics`);
    assert.ok(Array.isArray(spec.outcomes) && spec.outcomes.length > 0, `${name} needs outcomes`);
    assert.ok(Array.isArray(spec.detail), `${name} needs a detail allow-list`);
    assert.ok(spec.producer === null || typeof spec.producer === 'string', `${name} producer must be explicit`);
    for (const key of spec.detail) {
      assert.doesNotMatch(key, /password|token|secret|assertion|cookie|otp|totp|csrf/i, `${name}.${key} must not name a credential`);
    }
  }
  // This is the reported AUTH-009 gap: these ADR03 events have no producing flow in
  // the AUTH-001..007 surface. The vocabulary exists, but no synthetic row is written.
  // If a later contract adds the flow, it must update this assertion and the delivery
  // report together.
  for (const pending of ['password_changed', 'role_changed', 'membership_invited', 'membership_accepted']) {
    assert.equal(AUTH_AUDIT_CATALOG[pending].producer, null, `${pending} must not claim a producer`);
  }
});

test('AUTH-009 redaction refuses unknown events, credential-shaped detail and unverified actors', () => {
  const base = {eventType: 'login_failure', realm: 'customer', outcome: 'failure', detail: {reason: 'attempt_reserved'}};
  const row = prepareAuditRow(base);
  assert.equal(row.detail_schema_version, 1, 'the row carries an explicit detail schema version');
  assert.equal(JSON.parse(row.detail_jsonb).actor_kind, 'unknown');
  assert.equal(row.user_id, null);

  assert.throws(
    () => prepareAuditRow({...base, eventType: 'invented_event'}),
    error => error.code === 'AUDIT_EVENT_UNKNOWN',
  );
  for (const key of ['password', 'raw_token', 'session_token', 'recovery_code', 'csrf', 'authorization', 'assertion', 'code_hash']) {
    assert.throws(
      () => prepareAuditRow({...base, detail: {[key]: 'secret-value'}}),
      error => error.code === 'AUDIT_DETAIL_FORBIDDEN',
      `${key} must never reach the ledger`,
    );
  }
  assert.throws(
    () => prepareAuditRow({...base, detail: {unknown_key: 'x'}}),
    error => error.code === 'AUDIT_DETAIL_UNKNOWN',
  );
  assert.throws(
    () => prepareAuditRow({...base, detail: {reason: {nested: true}}}),
    error => error.code === 'AUDIT_DETAIL_INVALID',
  );
  assert.throws(
    () => prepareAuditRow({...base, user: {id: 'not-a-uuid'}}),
    error => error.code === 'AUDIT_ACTOR_INVALID',
  );
  assert.throws(
    () => prepareAuditRow({...base, actorKind: 'authenticated'}),
    error => error.code === 'AUDIT_ACTOR_INVALID',
    'login_failure cannot claim an authenticated actor',
  );
  assert.throws(
    () => prepareAuditRow({...base, realm: 'other'}),
    error => error.code === 'AUDIT_REALM_INVALID',
  );
  assert.throws(
    () => prepareAuditRow({eventType: 'login_success', realm: 'customer', outcome: 'failure', user: {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}),
    error => error.code === 'AUDIT_OUTCOME_INVALID',
  );
  const sanitized = prepareAuditRow({
    ...base,
    detail: {reason: 'x'.repeat(400), retry_after_ms: 1000},
  });
  assert.equal(JSON.parse(sanitized.detail_jsonb).reason.length, 320, 'detail strings are bounded');
  assert.equal(sanitized.ip_address, null, 'an invalid ingress address is dropped, not stored');
});

test('AUTH-009 failure-audit durability faults are counted and notified, never swallowed', async () => {
  let notified = 0;
  const down = {query: async () => { throw new Error('ledger unavailable'); }};
  const writer = createAuditWriter(down, {onDurabilityFailure: () => { notified += 1; }});
  await assert.rejects(
    () => writer.failure({eventType: 'login_failure', realm: 'customer', detail: {reason: 'attempt_reserved'}}),
    error => error instanceof AuditDurabilityError && error.code === 'AUDIT_DURABILITY_FAILED',
  );
  const stats = writer.stats();
  assert.equal(stats.durabilityFailures, 1);
  assert.deepEqual(stats.lastFailure, {eventType: 'login_failure', code: 'AUDIT_DURABILITY_FAILED'});
  assert.equal(notified, 1);
});

// ---------------------------------------------------------------------------
// Real credential and session flows
// ---------------------------------------------------------------------------

test('AUTH-009 login success is atomic with its audit row and publishes no credential on an audit fault', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const writer = createAuditWriter(pool);
      const failingAudit = async (event, options) => {
        if (event.eventType === 'login_success') throw new Error('audit store unavailable');
        return writer(event, options);
      };
      failingAudit.failure = writer.failure;
      const {handler} = buildRoutes({pool, clock, audit: failingAudit});
      await insertUser(db, 'atomic@example.com', 'correct-horse-battery');

      const attempt = await login(handler, 'atomic@example.com', 'correct-horse-battery');
      assert.equal(attempt.response.status, 503);
      assert.equal((await attempt.response.json()).error.code, 'AUTH_ACCOUNTING_UNAVAILABLE');
      assert.equal(attempt.response.headers.get('set-cookie'), null, 'no credential may be published');
      assert.equal((await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions')).rows[0].n, 0);
      assert.equal((await ledger(db, "event_type = 'login_success'")).length, 0);
      assert.equal((await ledger(db, "event_type = 'login_failure' AND detail_jsonb->>'reason' = 'attempt_reserved'")).length, 1,
        'the reservation remains durable');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 failed sign-ins are independently committed, attributed and repeatable', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const user = await insertUser(db, 'known@example.com', 'correct-horse-battery');

      const first = await login(handler, 'known@example.com', 'wrong-password-value');
      const retry = await login(handler, 'known@example.com', 'wrong-password-value');
      const unknown = await login(handler, 'nobody@example.com', 'wrong-password-value');
      assert.equal(first.response.status, 401);
      assert.equal(retry.response.status, 401);
      assert.equal(unknown.response.status, 401);
      assert.deepEqual(await first.response.clone().json(), await unknown.response.clone().json(), 'non-enumerating bodies');

      assert.equal((await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions')).rows[0].n, 0,
        'no failed attempt leaves a session');
      const failures = await ledger(db, "event_type = 'login_failure'");
      assert.equal(failures.length, 3, 'each attempt is its own committed row, including a retry');
      const knownRows = failures.filter(row => row.user_id === user.id);
      assert.equal(knownRows.length, 2);
      assert.ok(knownRows.every(row => row.detail_jsonb.actor_kind === 'unverified_attempt'));
      const unknownRow = failures.find(row => row.detail_jsonb.reason === 'attempt_reserved' && row.user_id === null);
      assert.ok(unknownRow, 'an unknown identity is recorded without inventing attribution');
      assert.equal(unknownRow.detail_jsonb.actor_kind, 'unknown');
      assert.ok(failures.every(row => row.detail_schema_version === 1));
      assert.ok(failures.every(row => row.realm === 'customer'));
      assert.equal((await ledger(db, "event_type = 'login_success'")).length, 0);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 client-supplied actor fields never influence audit attribution', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const forged = '99999999-9999-4999-8999-999999999999';
      await insertUser(db, 'attribution@example.com', 'correct-horse-battery');

      const rejected = await handler(loginRequest({
        email: 'attribution@example.com',
        password: 'correct-horse-battery',
        userId: forged,
        actor: forged,
        tenantId: TENANT,
        eventType: 'login_success',
      }));
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).error.code, 'UNKNOWN_FIELDS');

      const wrong = await login(handler, 'attribution@example.com', 'wrong-password-value');
      assert.equal(wrong.response.status, 401);
      const rows = await ledger(db);
      assert.ok(rows.length > 0);
      assert.equal(rows.some(row => row.user_id === forged), false, 'a forged client id never becomes the actor');
      assert.equal(rows.some(row => row.tenant_id === TENANT), false);
      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      for (const secret of ['correct-horse-battery', 'wrong-password-value', 'attribution@example.com', forged]) {
        assert.equal(serialized.rows.some(row => row.json.includes(secret)), false, `the ledger must not contain ${secret.slice(0, 12)}…`);
      }
    } finally {
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Reset / revoke-all and MFA failure durability
// ---------------------------------------------------------------------------

test('AUTH-009 reset completion, all-session revocation and audit commit together', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'reset-audit@example.com', 'correct-horse-battery');
      const first = await login(handler, 'reset-audit@example.com', 'correct-horse-battery');
      const second = await login(handler, 'reset-audit@example.com', 'correct-horse-battery');
      assert.ok(first.token && second.token);

      assert.equal((await handler(forgotRequest({email: 'reset-audit@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);

      const reset = await handler(resetRequest({token, password: 'new-correct-horse-battery'}));
      assert.equal(reset.status, 200);

      const requested = await ledger(db, "event_type = 'password_reset_requested'");
      assert.equal(requested.length, 1);
      assert.equal(requested[0].detail_jsonb.delivery, 'mail_adapter');
      const completed = await ledger(db, "event_type = 'password_reset_completed'");
      assert.equal(completed.length, 1);
      assert.equal(completed[0].user_id, user.id);
      assert.equal(completed[0].detail_jsonb.actor_kind, 'recovery_token');
      assert.equal(completed[0].detail_jsonb.sessions_revoked, 2);
      const revoked = await ledger(db, "event_type = 'sessions_revoked'");
      assert.equal(revoked.length, 1, 'one/all session revocation is its own ADR03 event');
      assert.equal(revoked[0].detail_jsonb.scope, 'all');
      assert.equal(revoked[0].detail_jsonb.reason, 'password_reset');
      assert.equal(revoked[0].detail_jsonb.revoked_count, 2);

      const sessions = await db.adminQuery(
        'SELECT revoked_at, revoked_reason FROM auth.sessions WHERE user_id = $1::uuid',
        [user.id],
      );
      assert.equal(sessions.rowCount, 2);
      assert.ok(sessions.rows.every(row => row.revoked_at instanceof Date && row.revoked_reason === 'password_reset'));

      const replay = await handler(resetRequest({token, password: 'another-correct-horse'}));
      assert.equal(replay.status, 400);
      const failed = await ledger(db, "event_type = 'password_reset_failed'");
      assert.equal(failed.length, 1, 'a refused reset is independently observable');
      assert.equal(failed[0].detail_jsonb.reason, 'RESET_TOKEN_INVALID');
      assert.equal((await ledger(db, "event_type = 'password_reset_completed'")).length, 1);

      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      assert.equal(serialized.rows.some(row => row.json.includes(token)), false, 'the reset token never reaches the ledger');
      assert.equal(serialized.rows.some(row => row.json.includes('new-correct-horse-battery')), false);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 a failed reset audit rolls back the credential change and every revoke', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const writer = createAuditWriter(pool);
      const failingAudit = async (event, options) => {
        if (event.eventType === 'password_reset_completed') throw new Error('audit store unavailable');
        return writer(event, options);
      };
      failingAudit.failure = writer.failure;
      const {handler} = buildRoutes({pool, clock, mail, audit: failingAudit});
      const user = await insertUser(db, 'reset-rollback@example.com', 'correct-horse-battery');
      const session = await login(handler, 'reset-rollback@example.com', 'correct-horse-battery');
      assert.ok(session.token);

      assert.equal((await handler(forgotRequest({email: 'reset-rollback@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);
      const reset = await handler(resetRequest({token, password: 'should-not-commit-horse'}));
      assert.equal(reset.status, 503);
      assert.equal((await reset.json()).error.code, 'AUTH_ACCOUNTING_UNAVAILABLE');

      const after = await db.adminQuery('SELECT credential_version, password_hash FROM auth.users WHERE id = $1::uuid', [user.id]);
      assert.equal(Number(after.rows[0].credential_version), user.credentialVersion, 'the credential epoch is unchanged');
      const policy = createPasswordPolicy();
      assert.equal((await policy.verify('correct-horse-battery', after.rows[0].password_hash)).valid, true);
      const sessions = await db.adminQuery('SELECT revoked_at FROM auth.sessions WHERE user_id = $1::uuid', [user.id]);
      assert.ok(sessions.rows.every(row => row.revoked_at === null), 'no session was revoked by the rolled-back reset');
      assert.equal((await ledger(db, "event_type = 'sessions_revoked'")).length, 0);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 MFA refusals are recorded durably while the lifecycle transaction keeps its invariants', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await enrolledAdmin({db, clock, handler});

      const reenroll = await handler(authedPost('/v1/auth/mfa/enroll', enrolled.token, enrolled.csrf, {}));
      assert.equal(reenroll.status, 403);
      assert.equal((await reenroll.json()).error.code, 'MFA_REAUTH_REQUIRED');
      const enrollFailures = await ledger(db, "event_type = 'mfa_enroll_failed'");
      assert.equal(enrollFailures.length, 1);
      assert.equal(enrollFailures[0].detail_jsonb.reason, 'MFA_REAUTH_REQUIRED');
      assert.equal(enrollFailures[0].detail_jsonb.actor_kind, 'authenticated');
      assert.equal(enrollFailures[0].user_id, enrolled.userId);

      clock.advance(30 * 1000);
      const wrong = await handler(authedPost('/v1/auth/mfa/verify', enrolled.token, enrolled.csrf, {code: '000000'}));
      assert.equal(wrong.status, 401);
      const failures = await ledger(db, "event_type = 'mfa_verification_failed'");
      assert.equal(failures.length, 1);
      assert.equal(failures[0].detail_jsonb.reason, 'MFA_CODE_INVALID');
      assert.equal(failures[0].detail_jsonb.stage, 'verify');
      assert.equal(failures[0].detail_jsonb.method, 'totp');
      assert.equal(failures[0].session_id !== null, true);
      assert.equal((await ledger(db, "event_type = 'mfa_verified'")).length, 0, 'a failure never emits a success event');

      const factor = await db.adminQuery(
        `SELECT failed_attempts FROM auth.two_factor WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      assert.equal(factor.rows[0].failed_attempts, 1, 'the failure counter also committed');

      clock.advance(30 * 1000);
      const good = await handler(authedPost('/v1/auth/mfa/verify', enrolled.token, enrolled.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      }));
      assert.equal(good.status, 200);
      assert.equal((await ledger(db, "event_type = 'mfa_verified'")).length, 1);
    } finally {
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Operator exchange failure coverage and ledger separation
// ---------------------------------------------------------------------------

test('AUTH-009 operator guard refusals are audited before the assertion is exchanged', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock, operatorAccess: {}});

      const missing = await handler(request(`${origins.operator}/v1/auth/operator/access`, {
        method: 'POST',
        headers: {origin: origins.operator},
        body: {},
      }));
      assert.equal(missing.status, 401);
      assert.equal((await missing.json()).error.code, 'OPERATOR_ACCESS_REQUIRED');

      const badShape = await handler(request(`${origins.operator}/v1/auth/operator/access`, {
        method: 'POST',
        headers: {origin: origins.operator, authorization: 'Bearer synthetic-assertion-value'},
        body: {userId: '99999999-9999-4999-8999-999999999999'},
      }));
      assert.equal(badShape.status, 400);
      assert.equal((await badShape.json()).error.code, 'UNKNOWN_FIELDS');

      const wrongRealm = await handler(request(`${origins.customer}/v1/auth/operator/access`, {
        method: 'POST',
        headers: {origin: origins.customer},
        body: {},
      }));
      assert.equal(wrongRealm.status, 403);

      const rows = await ledger(db, "event_type = 'login_failure'");
      assert.equal(rows.length, 3, 'every guard refusal on the exchange route is recorded');
      assert.ok(rows.every(row => row.detail_jsonb.actor_kind === 'operator_assertion'));
      const reasons = rows.map(row => row.detail_jsonb.reason).sort();
      assert.deepEqual(reasons, ['OPERATOR_ACCESS_REQUIRED', 'OPERATOR_REALM_REQUIRED', 'UNKNOWN_FIELDS']);
      assert.ok(rows.some(row => row.realm === 'operator'));
      assert.equal(rows.some(row => row.user_id !== null), false, 'no local identity is invented for a refused assertion');
      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      assert.equal(serialized.rows.some(row => row.json.includes('synthetic-assertion-value')), false,
        'the bearer assertion never reaches the ledger');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 authentication audit stays distinct from operator audit history', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      await insertUser(db, 'separation@example.com', 'correct-horse-battery');
      const session = await login(handler, 'separation@example.com', 'correct-horse-battery');
      assert.equal(session.response.status, 200);
      const logout = await handler(authedPost('/v1/auth/logout', session.token, session.csrf));
      assert.equal(logout.status, 200);

      const authRows = await ledger(db);
      assert.deepEqual(authRows.map(row => row.event_type), ['login_failure', 'login_success', 'logout'],
        'the durable attempt reservation precedes the success event; nothing crosses realms');
      assert.ok(authRows.every(row => row.realm === 'customer'));
      assert.equal(authRows[0].outcome, 'failure', 'a successful attempt still records its reservation');
      assert.equal(authRows[0].detail_jsonb.reason, 'attempt_reserved');
      assert.equal(authRows[2].detail_jsonb.scope, 'one');

      const operatorAudit = await db.adminQuery('SELECT count(*)::int AS n FROM operator.operator_audit');
      assert.equal(operatorAudit.rows[0].n, 0, 'auth events never write the operator audit ledger');
      const operatorRows = await db.adminQuery(
        "SELECT count(*)::int AS n FROM auth.auth_audit WHERE realm = 'operator'",
      );
      assert.equal(operatorRows.rows[0].n, 0);
    } finally {
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Tenant selection (AUTH-006 carry-forward): success event is in-transaction
// ---------------------------------------------------------------------------

test('AUTH-009 tenant selection and clearing are audited atomically with the binding', async () => {
  await withAuthDatabase(async db => {
    await applyAuthorityGate(db);
    const clock = testClock();
    const user = await insertUser(db, 'selector@example.com', 'correct-horse-battery');
    await db.adminQuery(
      `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
       VALUES ($1, $2, 'member', 'active', now(), now())`,
      [TENANT, user.id],
    );
    await withAuthServicePool(db, async pool => {
      const {handler} = buildRoutes({pool, clock});
      const session = await login(handler, 'selector@example.com', 'correct-horse-battery');
      assert.equal(session.response.status, 200);

      const selected = await handler(authedPost('/v1/auth/tenant/select', session.token, session.csrf, {tenantId: TENANT}));
      assert.equal(selected.status, 200);
      const rows = await ledger(db, "event_type = 'tenant_selected'");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].tenant_id, TENANT);
      assert.equal(rows[0].user_id, user.id);
      assert.equal(rows[0].detail_jsonb.role_id, 'member');

      const denied = await handler(authedPost('/v1/auth/tenant/select', session.token, session.csrf, {tenantId: OTHER_TENANT}));
      assert.equal(denied.status, 403);
      const failed = await ledger(db, "event_type = 'tenant_selection_failed'");
      assert.equal(failed.length, 1);
      assert.equal(failed[0].detail_jsonb.reason, 'TENANT_ACCESS_DENIED');
      assert.equal(failed[0].detail_jsonb.actor_kind, 'authenticated');

      const cleared = await handler(authedPost('/v1/auth/tenant/clear', session.token, session.csrf));
      assert.equal(cleared.status, 200);
      assert.equal((await ledger(db, "event_type = 'tenant_cleared'")).length, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// Append-only enforcement
// ---------------------------------------------------------------------------

test('AUTH-009 the ledger refuses UPDATE, DELETE and TRUNCATE for every principal', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      await insertUser(db, 'append-only@example.com', 'correct-horse-battery');
      const session = await login(handler, 'append-only@example.com', 'correct-horse-battery');
      assert.equal(session.response.status, 200);

      await assert.rejects(() => db.adminQuery(`UPDATE auth.auth_audit SET outcome = 'failure'`), /AUTH_RECORD_IMMUTABLE/);
      await assert.rejects(() => db.adminQuery('DELETE FROM auth.auth_audit'), /AUTH_RECORD_IMMUTABLE/);
      await assert.rejects(() => db.adminQuery('TRUNCATE auth.auth_audit'), /AUTH_RECORD_IMMUTABLE/);
      await assert.rejects(
        () => db.asRole('authService', client => client.query(`UPDATE auth.auth_audit SET outcome = 'failure'`)),
        /AUTH_RECORD_IMMUTABLE|permission denied/,
      );
      await assert.rejects(
        () => db.asRole('authService', client => client.query('DELETE FROM auth.auth_audit')),
        /AUTH_RECORD_IMMUTABLE|permission denied/,
      );
      assert.equal((await ledger(db)).length >= 1, true, 'the row survived every mutation attempt');
    } finally {
      await pool.end();
    }
  });
});
