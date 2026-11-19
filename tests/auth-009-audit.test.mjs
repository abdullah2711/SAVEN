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
  validateAuditCatalog,
  AUTH_AUDIT_CATALOG,
  AUTH_AUDIT_CATALOG_VERSION,
  ADR03_REQUIRED_EVENTS,
  ADR03_PRODUCER_MAP,
  AuditDurabilityError,
} from '../src/auth/audit.mjs';
import {createAuthServer} from '../src/auth/server.mjs';
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
const PROBE_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

function buildRoutes({pool, clock, audit = null, mail = null, operatorAccess = null, mfa = mfaConfig(), rateLimitPolicy = {}, wrapStore = null}) {
  const base = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
  const store = wrapStore ? wrapStore(base) : base;
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

function authedGet(path, token) {
  return request(`${origins.customer}${path}`, {headers: {cookie: `${customerCookie}=${token}`}});
}

function tokenFrom(response) {
  const value = response.headers.get('set-cookie') ?? '';
  return new RegExp(`${customerCookie}=([^;]+)`).exec(value)?.[1] ?? null;
}

async function login(handler, email, password, options = {}) {
  const response = await handler(loginRequest({email, password}, options));
  const body = await response.clone().json().catch(() => null);
  const token = tokenFrom(response);
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
            request_id, tenant_id::text AS tenant_id, detail_jsonb, detail_schema_version
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

// The authority gate rejects a superuser caller, so composed runtime paths are
// exercised through a real non-owner auth-service login. Setup/observation stay
// administrative; the requests do not.
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
// Reference/configuration catalog (finding 3)
// ---------------------------------------------------------------------------

test('AUTH-009 event domain is an external, versioned, validated configuration', async () => {
  assert.equal(AUTH_AUDIT_CATALOG_VERSION, 1);
  assert.equal(Object.isFrozen(AUTH_AUDIT_CATALOG), true);
  for (const name of Object.keys(ADR03_REQUIRED_EVENTS)) {
    assert.ok(Object.hasOwn(AUTH_AUDIT_CATALOG, name), `${name} must be configured`);
  }

  const captured = [];
  const fakePool = {query: async (sql, params) => { captured.push(params); return {rows: [{id: '1'}]}; }};
  const configured = validateAuditCatalog({
    catalogVersion: 1,
    events: {
      ...AUTH_AUDIT_CATALOG,
      probe_event: {
        category: 'probe',
        producer: 'test.probe',
        actors: ['authenticated'],
        outcomes: ['success'],
        detail: ['reason'],
      },
    },
  });
  const writer = createAuditWriter(fakePool, {auditCatalog: configured});
  const written = await writer({eventType: 'probe_event', realm: 'customer', user: {id: PROBE_USER}, detail: {reason: 'probe'}});
  assert.equal(written.recorded, true);
  assert.equal(captured.length, 1);
  assert.equal(captured[0][0], 'probe_event');
  assert.equal(JSON.parse(captured[0][11]).actor_kind, 'authenticated');
  assert.equal(captured[0][12], 1, 'the configured event uses the same writer and versioning');

  await assert.rejects(
    () => writer({eventType: 'probe_event', realm: 'customer', user: {id: PROBE_USER}, detail: {password: 'x'}}),
    error => error.code === 'AUDIT_DETAIL_FORBIDDEN',
    'the same redaction guard applies to a separately configured event',
  );
  await assert.rejects(
    () => writer({eventType: 'probe_event', realm: 'customer', user: {id: PROBE_USER}, detail: {undeclared: 'x'}}),
    error => error.code === 'AUDIT_DETAIL_UNKNOWN',
  );
  await assert.rejects(
    () => writer({eventType: 'unconfigured_event', realm: 'customer', detail: {}}),
    error => error.code === 'AUDIT_EVENT_UNKNOWN',
  );

  const invalidCatalogs = [
    {catalogVersion: 2, events: {probe_event: {category: 'probe', producer: null, actors: ['authenticated'], outcomes: ['success'], detail: []}}},
    {catalogVersion: 1, events: {probe_event: {category: 'probe', producer: null, actors: [], outcomes: ['success'], detail: []}}},
    {catalogVersion: 1, events: {probe_event: {category: 'probe', producer: null, actors: ['authenticated'], outcomes: ['invented'], detail: []}}},
    {catalogVersion: 1, events: {probe_event: {category: 'probe', producer: null, actors: ['authenticated'], outcomes: ['success'], detail: ['password']}}},
    {catalogVersion: 1, events: {probe_event: {category: 'probe', producer: null, actors: ['authenticated'], outcomes: ['success'], detail: ['reason', 'reason']}}},
    {catalogVersion: 1, events: {__proto__: null}},
  ];
  for (const bad of invalidCatalogs) {
    assert.throws(
      () => createAuditWriter(fakePool, {auditCatalog: bad}),
      error => error.code === 'AUDIT_CATALOG_INVALID',
    );
  }
});

test('AUTH-009 the required-event map stays independent of the configurable catalog', () => {
  const required = Object.keys(ADR03_REQUIRED_EVENTS);
  assert.equal(required.length, 13);
  for (const name of required) {
    assert.equal(ADR03_REQUIRED_EVENTS[name].status, 'required', `${name} must remain REQUIRED`);
    assert.notEqual(ADR03_REQUIRED_EVENTS[name].status, 'deferred', 'no review finding may be downgraded by data');
    assert.ok(Object.hasOwn(AUTH_AUDIT_CATALOG, name), `${name} must have a configured schema`);
  }
  assert.ok(AUTH_AUDIT_CATALOG.password_changed.producer, 'password_changed now has a real producer');
  for (const name of ['role_changed', 'membership_invited', 'membership_accepted']) {
    assert.equal(ADR03_REQUIRED_EVENTS[name].status, 'required');
    assert.equal(ADR03_REQUIRED_EVENTS[name].producerDeferredTo, 'IAM/membership administration contract',
      `${name} must carry the explicit producer-deferred marker`);
  }
  // A catalog entry cannot mark an event optional: the source map has no such status,
  // and every entry is checked above as `required`.
  for (const spec of Object.values(AUTH_AUDIT_CATALOG)) {
    assert.equal(Object.hasOwn(spec, 'required'), false);
  }
});

test('AUTH-009 producer/transition map is precise and records the Principal-approved producer deferral', () => {
  assert.deepEqual(Object.keys(ADR03_PRODUCER_MAP).sort(), Object.keys(ADR03_REQUIRED_EVENTS).sort());
  const deferred = [];
  for (const [name, entry] of Object.entries(ADR03_PRODUCER_MAP)) {
    assert.ok(['live', 'producer-deferred'].includes(entry.status), `${name} needs an explicit status`);
    assert.notEqual(entry.status, 'deferred', `${name} may not be dropped from the required set by the map`);
    assert.equal(typeof entry.transition, 'string');
    if (entry.status === 'live') {
      assert.ok(entry.producer && entry.route, `${name} live entry needs flow and route`);
      assert.ok(AUTH_AUDIT_CATALOG[name].producer, `${name} live entry must match a configured producer`);
    } else {
      deferred.push(name);
      assert.equal(entry.producer, null);
      assert.equal(entry.route, null);
      assert.equal(entry.deferredTo, 'IAM/membership administration contract');
      assert.ok(entry.legacyProducer && entry.legacyProducer.length > 0, `${name} must name the live legacy producer`);
      assert.ok(entry.absent && entry.absent.length > 0, `${name} must state what the audited surface lacks`);
      assert.equal(AUTH_AUDIT_CATALOG[name].producer, null, `${name} must not claim a configured producer`);
      assert.equal(ADR03_REQUIRED_EVENTS[name].status, 'required', `${name} stays REQUIRED`);
      assert.equal(ADR03_REQUIRED_EVENTS[name].producerDeferredTo, 'IAM/membership administration contract');
    }
  }
  assert.deepEqual(deferred.sort(), ['membership_accepted', 'membership_invited', 'role_changed'],
    'these producers are Principal-deferred to the IAM contract, not silently skipped');
  assert.equal(ADR03_PRODUCER_MAP.password_changed.status, 'live');
});

// ---------------------------------------------------------------------------
// Redaction, attribution, durability
// ---------------------------------------------------------------------------

test('AUTH-009 redaction refuses credential-shaped detail and unverified actors', () => {
  const base = {eventType: 'login_failure', realm: 'customer', outcome: 'failure', detail: {reason: 'attempt_reserved'}};
  const row = prepareAuditRow(base);
  assert.equal(row.detail_schema_version, 1);
  assert.equal(JSON.parse(row.detail_jsonb).actor_kind, 'unknown');
  assert.equal(row.user_id, null);

  assert.throws(() => prepareAuditRow({...base, eventType: 'invented_event'}), error => error.code === 'AUDIT_EVENT_UNKNOWN');
  for (const key of ['password', 'raw_token', 'session_token', 'recovery_code', 'csrf', 'authorization', 'assertion', 'code_hash']) {
    assert.throws(
      () => prepareAuditRow({...base, detail: {[key]: 'secret-value'}}),
      error => error.code === 'AUDIT_DETAIL_FORBIDDEN',
      `${key} must never reach the ledger`,
    );
  }
  assert.throws(() => prepareAuditRow({...base, detail: {unknown_key: 'x'}}), error => error.code === 'AUDIT_DETAIL_UNKNOWN');
  assert.throws(() => prepareAuditRow({...base, detail: {reason: {nested: true}}}), error => error.code === 'AUDIT_DETAIL_INVALID');
  assert.throws(() => prepareAuditRow({...base, user: {id: 'not-a-uuid'}}), error => error.code === 'AUDIT_ACTOR_INVALID');
  assert.throws(() => prepareAuditRow({...base, actorKind: 'authenticated'}), error => error.code === 'AUDIT_ACTOR_INVALID');
  assert.throws(() => prepareAuditRow({...base, realm: 'somewhere'}), error => error.code === 'AUDIT_REALM_INVALID');
  const sanitized = prepareAuditRow({...base, detail: {reason: 'x'.repeat(400), retry_after_ms: 1000}});
  assert.equal(JSON.parse(sanitized.detail_jsonb).reason.length, 320);
  assert.equal(sanitized.ip_address, null);
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
  assert.equal(stats.catalogVersion, 1);
  assert.deepEqual(stats.lastFailure, {eventType: 'login_failure', code: 'AUDIT_DURABILITY_FAILED'});
  assert.equal(notified, 1);
});

// ---------------------------------------------------------------------------
// Login, reset and the new password_changed producer
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
      assert.equal(attempt.response.headers.get('set-cookie'), null);
      assert.equal((await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions')).rows[0].n, 0);
      assert.equal((await ledger(db, "event_type = 'login_success'")).length, 0);
      assert.equal((await ledger(db, "event_type = 'login_failure' AND detail_jsonb->>'reason' = 'attempt_reserved'")).length, 1);
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
      assert.deepEqual(await first.response.clone().json(), await unknown.response.clone().json());

      assert.equal((await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions')).rows[0].n, 0);
      const failures = await ledger(db, "event_type = 'login_failure'");
      assert.equal(failures.length, 3, 'each attempt is its own committed row, including a retry');
      const knownRows = failures.filter(row => row.user_id === user.id);
      assert.equal(knownRows.length, 2);
      assert.ok(knownRows.every(row => row.detail_jsonb.actor_kind === 'unverified_attempt'));
      const unknownRow = failures.find(row => row.user_id === null);
      assert.ok(unknownRow);
      assert.equal(unknownRow.detail_jsonb.actor_kind, 'unknown');
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
      assert.equal(rows.some(row => row.user_id === forged), false);
      assert.equal(rows.some(row => row.tenant_id === TENANT), false);
      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      for (const secret of ['correct-horse-battery', 'wrong-password-value', 'attribution@example.com', forged]) {
        assert.equal(serialized.rows.some(row => row.json.includes(secret)), false);
      }
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 password_changed is produced by the authenticated credential-change flow', async () => {
  await withAuthDatabase(async db => {
    await applyAuthorityGate(db);
    const clock = testClock();
    const user = await insertUser(db, 'change@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async pool => {
      const {handler} = buildRoutes({pool, clock});
      const first = await login(handler, 'change@example.com', 'correct-horse-battery');
      const second = await login(handler, 'change@example.com', 'correct-horse-battery');
      assert.ok(first.token && second.token);

      const changed = await handler(authedPost('/v1/auth/password/change', first.token, first.csrf, {
        currentPassword: 'correct-horse-battery',
        newPassword: 'new-correct-horse-battery',
      }));
      assert.equal(changed.status, 200);
      assert.match(changed.headers.get('set-cookie') ?? '', /Max-Age=0/);
      const clearCookie = changed.headers.get('set-cookie') ?? '';
      assert.match(clearCookie, new RegExp(`${customerCookie}=;`));
      assert.doesNotMatch(JSON.stringify(await changed.clone().json()), /new-correct-horse-battery/);

      const after = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      const policy = createPasswordPolicy();
      assert.equal((await policy.verify('new-correct-horse-battery', after.rows[0].password_hash)).valid, true);
      assert.equal((await policy.verify('correct-horse-battery', after.rows[0].password_hash)).valid, false);
      assert.equal(Number(after.rows[0].credential_version), user.credentialVersion + 1);

      const completed = await ledger(db, "event_type = 'password_changed'");
      assert.equal(completed.length, 1);
      assert.equal(completed[0].user_id, user.id);
      assert.equal(completed[0].detail_jsonb.credential_version, user.credentialVersion + 1);
      assert.equal(completed[0].detail_jsonb.actor_kind, 'authenticated');
      const revoked = await ledger(db, "event_type = 'sessions_revoked' AND detail_jsonb->>'reason' = 'password_change'");
      assert.equal(revoked.length, 1);
      assert.equal(revoked[0].detail_jsonb.scope, 'all');
      assert.equal(revoked[0].detail_jsonb.revoked_count, 2);

      assert.equal((await handler(authedGet('/v1/auth/me', first.token))).status, 401, 'every prior session is revoked');
      assert.equal((await handler(authedGet('/v1/auth/me', second.token))).status, 401);
      assert.equal((await login(handler, 'change@example.com', 'correct-horse-battery')).response.status, 401);
      assert.equal((await login(handler, 'change@example.com', 'new-correct-horse-battery')).response.status, 200);

      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      assert.equal(serialized.rows.some(row => row.json.includes('new-correct-horse-battery')), false);
      assert.equal(serialized.rows.some(row => row.json.includes(first.token)), false);
    });
  });
});

test('AUTH-009 a wrong current password is a durable, single refusal and changes nothing', async () => {
  await withAuthDatabase(async db => {
    await applyAuthorityGate(db);
    const clock = testClock();
    const user = await insertUser(db, 'wrong-change@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async pool => {
      const {handler} = buildRoutes({pool, clock});
      const session = await login(handler, 'wrong-change@example.com', 'correct-horse-battery');

      const attempt = await handler(authedPost('/v1/auth/password/change', session.token, session.csrf, {
        currentPassword: 'not-the-password',
        newPassword: 'new-correct-horse-battery',
      }));
      assert.equal(attempt.status, 401);
      assert.equal((await attempt.json()).error.code, 'SIGN_IN_FAILED');

      const failures = await ledger(db, "event_type = 'password_change_failed'");
      assert.equal(failures.length, 1, 'exactly one refusal row, not a duplicate from the safety net');
      assert.equal(failures[0].detail_jsonb.reason, 'attempt_reserved');
      assert.equal(failures[0].user_id, user.id);
      assert.equal((await ledger(db, "event_type = 'password_changed'")).length, 0);
      const after = await db.adminQuery('SELECT credential_version FROM auth.users WHERE id = $1::uuid', [user.id]);
      assert.equal(Number(after.rows[0].credential_version), user.credentialVersion);
      assert.equal((await handler(authedGet('/v1/auth/me', session.token))).status, 200, 'the session is not revoked');
    });
  });
});

test('AUTH-009 a failed password_changed audit rolls the credential change and revokes back', async () => {
  await withAuthDatabase(async db => {
    await applyAuthorityGate(db);
    const clock = testClock();
    const user = await insertUser(db, 'change-atomic@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async pool => {
      const writer = createAuditWriter(pool);
      const failingAudit = async (event, options) => {
        if (event.eventType === 'password_changed') throw new Error('audit store unavailable');
        return writer(event, options);
      };
      failingAudit.failure = writer.failure;
      const {handler} = buildRoutes({pool, clock, audit: failingAudit});
      const session = await login(handler, 'change-atomic@example.com', 'correct-horse-battery');

      const response = await handler(authedPost('/v1/auth/password/change', session.token, session.csrf, {
        currentPassword: 'correct-horse-battery',
        newPassword: 'should-not-commit-horse',
      }));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'AUTH_ACCOUNTING_UNAVAILABLE');
      const after = await db.adminQuery('SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid', [user.id]);
      assert.equal(Number(after.rows[0].credential_version), user.credentialVersion);
      const policy = createPasswordPolicy();
      assert.equal((await policy.verify('correct-horse-battery', after.rows[0].password_hash)).valid, true);
      assert.equal((await ledger(db, "event_type = 'sessions_revoked' AND detail_jsonb->>'reason' = 'password_change'")).length, 0);
      assert.equal((await handler(authedGet('/v1/auth/me', session.token))).status, 200);
    });
  });
});

test('AUTH-009 password change revalidates required MFA assurance inside its owned boundary', async () => {
  await withAuthDatabase(async db => {
    await applyAuthorityGate(db);
    await withAuthServicePool(db, async pool => {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await enrolledAdmin({db, clock, handler, email: 'inside-gate@example.com'});

      // A fresh sign-in after enrollment is a pending single-factor session. The
      // pre-route gate is bypassed with a snapshot that claims mfa_verified; the owned
      // boundary re-reads the locked session and must refuse.
      const pending = await login(handler, 'inside-gate@example.com', 'correct-horse-battery');
      assert.equal(pending.response.status, 200);
      const {handler: raceHandler} = buildRoutes({
        pool,
        clock,
        wrapStore: base => ({
          ...base,
          readSession: async (token, options) => {
            const session = await base.readSession(token, options);
            return session ? {...session, assuranceLevel: 'mfa_verified'} : null;
          },
        }),
      });

      const attempt = await raceHandler(authedPost('/v1/auth/password/change', pending.token, pending.csrf, {
        currentPassword: 'correct-horse-battery',
        newPassword: 'should-not-change-horse',
      }));
      assert.equal(attempt.status, 403);
      assert.equal((await attempt.json()).error.code, 'MFA_REQUIRED');

      const after = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [enrolled.userId],
      );
      assert.equal(Number(after.rows[0].credential_version), 1, 'no credential advancement occurred');
      const policy = createPasswordPolicy();
      assert.equal((await policy.verify('correct-horse-battery', after.rows[0].password_hash)).valid, true);
      assert.equal((await ledger(db, "event_type = 'password_changed'")).length, 0);
      assert.equal((await ledger(db, "event_type = 'sessions_revoked' AND detail_jsonb->>'reason' = 'password_change'")).length, 0);
      const denied = await ledger(db, "event_type = 'assurance_denied'");
      assert.equal(denied.length, 1, 'the inside-boundary refusal is recorded exactly once');
      assert.equal(denied[0].detail_jsonb.reason, 'MFA_REQUIRED');
      assert.equal(denied[0].detail_jsonb.route, '/v1/auth/password/change');
      assert.equal(denied[0].user_id, enrolled.userId);
      assert.equal(denied[0].detail_jsonb.actor_kind, 'authenticated');
    });
  });
});

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
      assert.equal(completed[0].detail_jsonb.sessions_revoked, 2);
      const revoked = await ledger(db, "event_type = 'sessions_revoked' AND detail_jsonb->>'reason' = 'password_reset'");
      assert.equal(revoked.length, 1);
      assert.equal(revoked[0].detail_jsonb.scope, 'all');
      assert.equal(revoked[0].detail_jsonb.revoked_count, 2);

      const replay = await handler(resetRequest({token, password: 'another-correct-horse'}));
      assert.equal(replay.status, 400);
      assert.equal((await ledger(db, "event_type = 'password_reset_failed'")).length, 1);
      assert.equal((await ledger(db, "event_type = 'password_reset_completed'")).length, 1);
      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      assert.equal(serialized.rows.some(row => row.json.includes(token)), false);
    } finally {
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Early security-decision coverage (finding 2)
// ---------------------------------------------------------------------------

test('AUTH-009 pre-reservation login refusals are recorded once with the correct attribution', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});

      const operatorLogin = await handler(loginRequest(
        {email: 'someone@example.com', password: 'correct-horse-battery'},
        {origin: origins.operator},
      ));
      assert.equal(operatorLogin.status, 403);
      assert.equal((await operatorLogin.json()).error.code, 'OPERATOR_ASSERTION_REQUIRED');

      const wrongOrigin = await handler(request(`${origins.customer}/v1/auth/login`, {
        method: 'POST',
        headers: {origin: 'https://evil.example', 'content-type': 'application/json'},
        body: {email: 'someone@example.com', password: 'correct-horse-battery'},
      }));
      assert.equal(wrongOrigin.status, 403);
      assert.equal((await wrongOrigin.json()).error.code, 'ORIGIN_MISMATCH');

      const unrecognized = await handler(request('https://evil.example/v1/auth/login', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: {email: 'someone@example.com', password: 'correct-horse-battery'},
      }));
      assert.equal(unrecognized.status, 421);
      assert.equal((await unrecognized.json()).error.code, 'ORIGIN_UNRECOGNIZED');

      const rows = await ledger(db, "event_type = 'login_failure'");
      assert.equal(rows.length, 3);
      const byReason = Object.fromEntries(rows.map(row => [row.detail_jsonb.reason, row]));
      assert.equal(byReason.OPERATOR_ASSERTION_REQUIRED.realm, 'operator');
      assert.equal(byReason.ORIGIN_MISMATCH.realm, 'customer');
      assert.equal(byReason.ORIGIN_UNRECOGNIZED.realm, 'unknown', 'no fabricated realm for an unrecognized origin');
      assert.ok(rows.every(row => row.user_id === null && row.detail_jsonb.actor_kind === 'unknown'));
      assert.ok(rows.every(row => row.detail_jsonb.route === '/v1/auth/login'));

      // Malformed JSON is a request fault, not an authentication decision: it may stay
      // unrecorded, and it must not create a false failure row.
      const malformed = await handler(new Request(`${origins.customer}/v1/auth/login`, {
        method: 'POST',
        headers: {origin: origins.customer, 'content-type': 'application/json'},
        body: '{not-json',
      }));
      assert.equal(malformed.status, 400);
      assert.equal((await ledger(db, "event_type = 'login_failure'")).length, 3);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 assurance, CSRF and session refusals are classified and recorded exactly once', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const admin = await insertUser(db, 'gate@example.com', 'correct-horse-battery');
      await db.adminQuery(
        `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
         VALUES ($1, $2, 'tenant_admin', 'active', now(), now())`,
        [TENANT, admin.id],
      );
      const pending = await login(handler, 'gate@example.com', 'correct-horse-battery');
      assert.equal(pending.response.status, 200);

      // Pending-MFA customer session reaches a non-pre-MFA route: the common assurance
      // gate denies before the tenant-selection route can record anything.
      const gated = await handler(authedGet('/v1/auth/tenants', pending.token));
      assert.equal(gated.status, 403);
      assert.equal((await gated.json()).error.code, 'MFA_REQUIRED');
      const assurance = await ledger(db, "event_type = 'assurance_denied'");
      assert.equal(assurance.length, 1);
      assert.equal(assurance[0].user_id, admin.id);
      assert.equal(assurance[0].detail_jsonb.reason, 'MFA_REQUIRED');
      assert.equal(assurance[0].detail_jsonb.route, '/v1/auth/tenants');
      assert.equal(assurance[0].detail_jsonb.actor_kind, 'authenticated');
      assert.equal((await ledger(db, "event_type = 'tenant_selection_failed'")).length, 0);

      // A normal member session survives the gate; CSRF failure is a session decision.
      const member = await insertUser(db, 'member@example.com', 'correct-horse-battery');
      const session = await login(handler, 'member@example.com', 'correct-horse-battery');
      assert.equal(session.response.status, 200);
      const badCsrf = await handler(request(`${origins.customer}/v1/auth/tenant/select`, {
        method: 'POST',
        headers: {origin: origins.customer, cookie: `${customerCookie}=${session.token}`, 'x-csrf-token': 'wrong'},
        body: {tenantId: TENANT},
      }));
      assert.equal(badCsrf.status, 403);
      assert.equal((await badCsrf.json()).error.code, 'CSRF_FAILED');
      const csrfRows = await ledger(db, "event_type = 'session_denied' AND detail_jsonb->>'reason' = 'CSRF_FAILED'");
      assert.equal(csrfRows.length, 1);
      assert.equal(csrfRows[0].user_id, member.id, 'the verified session supplies the actor, not the header');
      assert.equal(csrfRows[0].detail_jsonb.actor_kind, 'authenticated');

      // A revoked/expired cookie establishes no actor.
      await db.adminQuery('UPDATE auth.sessions SET revoked_at = now(), revoked_reason = $1 WHERE user_id = $2::uuid',
        ['admin_revoked', member.id]);
      const revoked = await handler(authedPost('/v1/auth/tenant/select', session.token, session.csrf, {tenantId: TENANT}));
      assert.equal(revoked.status, 401);
      const revokedRows = await ledger(db, "event_type = 'session_denied' AND detail_jsonb->>'reason' = 'SESSION_REQUIRED'");
      assert.equal(revokedRows.length, 1);
      assert.equal(revokedRows[0].user_id, null);
      assert.equal(revokedRows[0].detail_jsonb.actor_kind, 'unknown');

      // An idle-expired cookie is likewise refused before any route recorder runs.
      await insertUser(db, 'expire@example.com', 'correct-horse-battery');
      const expiring = await login(handler, 'expire@example.com', 'correct-horse-battery');
      assert.equal(expiring.response.status, 200);
      clock.advance(31 * 24 * 60 * 60 * 1000);
      const expired = await handler(authedPost('/v1/auth/tenant/select', expiring.token, expiring.csrf, {tenantId: TENANT}));
      assert.equal(expired.status, 401);
      const expiredRows = await ledger(db, "event_type = 'session_denied' AND detail_jsonb->>'reason' = 'SESSION_REQUIRED'");
      assert.equal(expiredRows.length, 2);
      assert.ok(expiredRows.every(row => row.user_id === null && row.detail_jsonb.actor_kind === 'unknown'));
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 email verification request/verify refusals are recorded without secrets', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      await insertUser(db, 'verify@example.com', 'correct-horse-battery', {verified: false});
      const session = await login(handler, 'verify@example.com', 'correct-horse-battery');

      const requested = await handler(authedPost('/v1/auth/email/verification/request', session.token, session.csrf, {}));
      assert.equal(requested.status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);
      assert.equal((await ledger(db, "event_type = 'email_verification_requested'")).length, 1);

      const verified = await handler(request(`${origins.customer}/v1/auth/email/verify`, {
        method: 'POST',
        headers: {origin: origins.customer, 'content-type': 'application/json'},
        body: {token},
      }));
      assert.equal(verified.status, 200);
      const success = await ledger(db, "event_type = 'email_verified'");
      assert.equal(success.length, 1);
      assert.equal(success[0].detail_jsonb.already_verified, false);

      const replay = await handler(request(`${origins.customer}/v1/auth/email/verify`, {
        method: 'POST',
        headers: {origin: origins.customer, 'content-type': 'application/json'},
        body: {token},
      }));
      assert.equal(replay.status, 400);
      const failed = await ledger(db, "event_type = 'email_verification_failed'");
      assert.equal(failed.length, 1);
      assert.equal(failed[0].detail_jsonb.route, '/v1/auth/email/verify');
      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      assert.equal(serialized.rows.some(row => row.json.includes(token)), false);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 composed refusals run under the real non-owner auth-service login', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const admin = await insertUser(db, 'composed-gate@example.com', 'correct-horse-battery');
    await db.adminQuery(
      `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
       VALUES ($1, $2, 'tenant_admin', 'active', now(), now())`,
      [TENANT, admin.id],
    );
    await withAuthServicePool(db, async pool => {
      const {handler} = buildRoutes({pool, clock});

      const operatorLogin = await handler(loginRequest(
        {email: 'composed-gate@example.com', password: 'correct-horse-battery'},
        {origin: origins.operator},
      ));
      assert.equal(operatorLogin.status, 403);

      const pending = await login(handler, 'composed-gate@example.com', 'correct-horse-battery');
      assert.equal(pending.response.status, 200);
      const gated = await handler(authedGet('/v1/auth/tenants', pending.token));
      assert.equal(gated.status, 403);
      assert.equal((await gated.json()).error.code, 'MFA_REQUIRED');

      const row = await ledger(db, "event_type = 'assurance_denied'");
      assert.equal(row.length, 1);
      assert.equal(row[0].user_id, admin.id);
      const operatorRows = await ledger(db, "event_type = 'login_failure' AND realm = 'operator'");
      assert.equal(operatorRows.length, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// MFA
// ---------------------------------------------------------------------------

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

      clock.advance(30 * 1000);
      const wrong = await handler(authedPost('/v1/auth/mfa/verify', enrolled.token, enrolled.csrf, {code: '000000'}));
      assert.equal(wrong.status, 401);
      const failures = await ledger(db, "event_type = 'mfa_verification_failed'");
      assert.equal(failures.length, 1);
      assert.equal(failures[0].detail_jsonb.reason, 'MFA_CODE_INVALID');
      assert.equal(failures[0].detail_jsonb.stage, 'verify');
      assert.equal((await ledger(db, "event_type = 'mfa_verified'")).length, 0);

      const factor = await db.adminQuery('SELECT failed_attempts FROM auth.two_factor WHERE user_id = $1::uuid', [enrolled.userId]);
      assert.equal(factor.rows[0].failed_attempts, 1);

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
// Operator, separation, selection, append-only
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
      const badShape = await handler(request(`${origins.operator}/v1/auth/operator/access`, {
        method: 'POST',
        headers: {origin: origins.operator, authorization: 'Bearer synthetic-assertion-value'},
        body: {userId: '99999999-9999-4999-8999-999999999999'},
      }));
      assert.equal(badShape.status, 400);
      const wrongRealm = await handler(request(`${origins.customer}/v1/auth/operator/access`, {
        method: 'POST',
        headers: {origin: origins.customer},
        body: {},
      }));
      assert.equal(wrongRealm.status, 403);

      const rows = await ledger(db, "event_type = 'login_failure'");
      assert.equal(rows.length, 3);
      assert.ok(rows.every(row => row.detail_jsonb.actor_kind === 'operator_assertion'));
      const reasons = rows.map(row => row.detail_jsonb.reason).sort();
      assert.deepEqual(reasons, ['OPERATOR_ACCESS_REQUIRED', 'OPERATOR_REALM_REQUIRED', 'UNKNOWN_FIELDS']);
      assert.equal(rows.some(row => row.user_id !== null), false);
      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      assert.equal(serialized.rows.some(row => row.json.includes('synthetic-assertion-value')), false);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 MFA route guards that precede the factor try block are recorded', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});

      const noSession = await handler(request(`${origins.customer}/v1/auth/mfa/verify`, {
        method: 'POST',
        headers: {origin: origins.customer, 'content-type': 'application/json'},
        body: {code: '123456'},
      }));
      assert.equal(noSession.status, 401);
      assert.equal((await noSession.json()).error.code, 'SESSION_REQUIRED');

      const operatorRealm = await handler(request(`${origins.operator}/v1/auth/mfa/enroll`, {
        method: 'POST',
        headers: {origin: origins.operator, 'content-type': 'application/json'},
        body: {},
      }));
      assert.equal(operatorRealm.status, 403);
      assert.equal((await operatorRealm.json()).error.code, 'OPERATOR_ASSERTION_REQUIRED');

      const sessionRows = await ledger(db, "event_type = 'session_denied'");
      assert.equal(sessionRows.length, 1);
      assert.equal(sessionRows[0].detail_jsonb.route, '/v1/auth/mfa/verify');
      assert.equal(sessionRows[0].user_id, null);
      const accessRows = await ledger(db, "event_type = 'access_denied'");
      assert.equal(accessRows.length, 1);
      assert.equal(accessRows[0].realm, 'operator');
      assert.equal(accessRows[0].detail_jsonb.reason, 'OPERATOR_ASSERTION_REQUIRED');
      assert.equal(accessRows[0].detail_jsonb.route, '/v1/auth/mfa/enroll');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 every route family records its early security decision exactly once', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock, operatorAccess: {}});

      const forgotOperator = await handler(forgotRequest({email: 'nobody@example.com'}, {origin: origins.operator}));
      assert.equal(forgotOperator.status, 403);
      assert.equal((await forgotOperator.json()).error.code, 'OPERATOR_ASSERTION_REQUIRED');

      const resetWrongOrigin = await handler(request(`${origins.customer}/v1/auth/reset-password`, {
        method: 'POST',
        headers: {origin: 'https://evil.example', 'content-type': 'application/json'},
        body: {token: 'synthetic-reset-token', password: 'synthetic-new-password'},
      }));
      assert.equal(resetWrongOrigin.status, 403);
      assert.equal((await resetWrongOrigin.json()).error.code, 'ORIGIN_MISMATCH');

      const logoutNoSession = await handler(request(`${origins.customer}/v1/auth/logout`, {
        method: 'POST',
        headers: {origin: origins.customer},
      }));
      assert.equal(logoutNoSession.status, 401);

      const changeOperator = await handler(request(`${origins.operator}/v1/auth/password/change`, {
        method: 'POST',
        headers: {origin: origins.operator, 'content-type': 'application/json'},
        body: {currentPassword: 'a', newPassword: 'b'},
      }));
      assert.equal(changeOperator.status, 403);
      assert.equal((await changeOperator.json()).error.code, 'OPERATOR_ASSERTION_REQUIRED');

      const operatorMeNoCookie = await handler(request(`${origins.operator}/v1/auth/operator/me`, {method: 'GET'}));
      assert.equal(operatorMeNoCookie.status, 401);

      const requested = await ledger(db, "event_type = 'password_reset_requested'");
      assert.equal(requested.length, 1);
      assert.equal(requested[0].realm, 'operator');
      assert.equal(requested[0].detail_jsonb.reason, 'OPERATOR_ASSERTION_REQUIRED');

      const resetFailed = await ledger(db, "event_type = 'password_reset_failed'");
      assert.equal(resetFailed.length, 1);
      assert.equal(resetFailed[0].realm, 'customer');
      assert.equal(resetFailed[0].detail_jsonb.reason, 'ORIGIN_MISMATCH');

      const changeFailed = await ledger(db, "event_type = 'password_change_failed'");
      assert.equal(changeFailed.length, 1);
      assert.equal(changeFailed[0].realm, 'operator');
      assert.equal(changeFailed[0].detail_jsonb.reason, 'OPERATOR_ASSERTION_REQUIRED');

      const sessionRows = await ledger(db, "event_type = 'session_denied'");
      assert.equal(sessionRows.length, 2, 'logout and operator/me each produce one row');
      assert.ok(sessionRows.every(row => row.detail_jsonb.reason === 'SESSION_REQUIRED'));
      assert.ok(sessionRows.every(row => row.user_id === null && row.detail_jsonb.actor_kind === 'unknown'));

      assert.equal((await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions')).rows[0].n, 0,
        'no refusal created a success mutation');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-009 server composition validates and forwards the configured catalog', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      assert.throws(
        () => createAuthServer({
          pool,
          origins,
          auditCatalog: {
            catalogVersion: 1,
            events: {probe_event: {category: 'probe', producer: null, actors: [], outcomes: ['success'], detail: []}},
          },
        }),
        error => error.code === 'AUDIT_CATALOG_INVALID',
        'an invalid deployment catalog fails at composition',
      );

      const deploymentCatalog = {
        catalogVersion: 1,
        events: {
          ...AUTH_AUDIT_CATALOG,
          probe_event: {
            category: 'probe',
            producer: 'deployment.probe',
            actors: ['authenticated'],
            outcomes: ['success'],
            detail: ['reason'],
          },
        },
      };
      const server = createAuthServer({pool, origins, auditCatalog: deploymentCatalog});
      await insertUser(db, 'wiring@example.com', 'correct-horse-battery');
      const response = await server.handler(loginRequest({email: 'wiring@example.com', password: 'wrong-password-value'}));
      assert.equal(response.status, 401);
      const rows = await ledger(db, "event_type = 'login_failure'");
      assert.equal(rows.length, 1, 'the composed writer uses the deployment catalog through the same boundary');
      assert.equal(rows[0].detail_jsonb.reason, 'attempt_reserved');
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
      assert.deepEqual(authRows.map(row => row.event_type), ['login_failure', 'login_success', 'logout']);
      assert.ok(authRows.every(row => row.realm === 'customer'));
      assert.equal(authRows[0].detail_jsonb.reason, 'attempt_reserved');
      assert.equal(authRows[2].detail_jsonb.scope, 'one');

      const operatorAudit = await db.adminQuery('SELECT count(*)::int AS n FROM operator.operator_audit');
      assert.equal(operatorAudit.rows[0].n, 0);
      assert.equal((await db.adminQuery("SELECT count(*)::int AS n FROM auth.auth_audit WHERE realm = 'operator'")).rows[0].n, 0);
    } finally {
      await pool.end();
    }
  });
});

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
      assert.equal(rows[0].detail_jsonb.role_id, 'member');

      const denied = await handler(authedPost('/v1/auth/tenant/select', session.token, session.csrf, {tenantId: OTHER_TENANT}));
      assert.equal(denied.status, 403);
      const failed = await ledger(db, "event_type = 'tenant_selection_failed'");
      assert.equal(failed.length, 1);
      assert.equal(failed[0].detail_jsonb.reason, 'TENANT_ACCESS_DENIED');

      const cleared = await handler(authedPost('/v1/auth/tenant/clear', session.token, session.csrf));
      assert.equal(cleared.status, 200);
      assert.equal((await ledger(db, "event_type = 'tenant_cleared'")).length, 1);
    });
  });
});

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
    } finally {
      await pool.end();
    }
  });
});
