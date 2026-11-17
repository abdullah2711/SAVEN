import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import pg from 'pg';
import {withAuthDatabase} from './helpers/pg-auth-fixture.mjs';
import {createSessionStore} from '../src/auth/session-store.mjs';
import {createAuthRoutes, cookieName} from '../src/auth/routes.mjs';
import {createAuditWriter} from '../src/auth/server.mjs';
import {createPasswordPolicy} from '../src/auth/password-policy.mjs';
import {createRecoveryService, digestRecoveryToken, validateRecoveryConfig} from '../src/auth/recovery.mjs';
import {createMailAdapter, createMailDispatcher, MailConfigurationError, MailDeliveryError} from '../src/auth/mail.mjs';

const {Pool} = pg;
const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const customerCookie = cookieName('customer', true);
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const RESET_TTL_MS = 30 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const TENANT = '11111111-1111-4111-8111-111111111111';

function connectionConfig(database, overrides = {}) {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database,
    max: 8,
    application_name: 'saven-auth-005-test',
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

async function addMembership(db, userId, roleId) {
  await db.adminQuery(
    `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
     VALUES ($1, $2, $3, 'active', now(), now())`,
    [TENANT, userId, roleId],
  );
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

function buildRoutes({pool, clock, mail = null, recoveryConfig = {}, rateLimitPolicy = {}, wrapStore = null, mailQueueLimit = 256, passwordPolicy = null, audit = null}) {
  const baseStore = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
  const store = wrapStore ? wrapStore(baseStore) : baseStore;
  const handler = createAuthRoutes({
    store,
    findUserByEmail: makeFindUser(pool),
    audit: audit ?? createAuditWriter(pool),
    origins,
    secureCookies: true,
    clock: clock.clock,
    rateLimitPolicy,
    mail,
    recoveryConfig,
    mailQueueLimit,
    passwordPolicy,
  });
  return {store, handler};
}

function spyPolicy(counter) {
  const base = createPasswordPolicy();
  return {
    hash: (...args) => {
      counter.hash += 1;
      return base.hash(...args);
    },
    verify: (...args) => {
      counter.verify += 1;
      return base.verify(...args);
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(settle => {
    resolve = settle;
  });
  return {promise, resolve};
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function within(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

// Mutates session/principal state after the non-transactional readSession but before the
// route opens its owned transaction, reproducing the read-valid-then-stale window.
function interceptingStore(hookRef) {
  return baseStore => {
    const wrapped = {...baseStore};
    wrapped.readSession = async (token, options) => {
      const session = await baseStore.readSession(token, options);
      if (session && hookRef.current) {
        const hook = hookRef.current;
        hookRef.current = null;
        await hook(session);
      }
      return session;
    };
    return wrapped;
  };
}

// Fails the COMMIT of the transaction that updates the credential, so the reset
// transaction's unknown-commit outcome can be exercised without a real network fault.
function hookedResetPool(basePool) {
  const releases = [];
  let injected = false;
  return {
    releases,
    get injected() { return injected; },
    pool: {
      query: (...args) => basePool.query(...args),
      async connect() {
        const client = await basePool.connect();
        const originalQuery = client.query.bind(client);
        const originalRelease = client.release.bind(client);
        let resetTransaction = false;
        client.query = async (text, params) => {
          const statement = typeof text === 'string' ? text.trim().toUpperCase() : '';
          if (statement === 'BEGIN') resetTransaction = false;
          if (statement.includes('SET PASSWORD_HASH')) resetTransaction = true;
          if (statement === 'COMMIT' && resetTransaction && !injected) {
            injected = true;
            throw new Error('commit acknowledgement lost');
          }
          return originalQuery(text, params);
        };
        client.release = destroy => {
          releases.push(destroy === true);
          return originalRelease(destroy);
        };
        return client;
      },
    },
  };
}

async function flushMail(handler) {
  if (handler.mailDelivery) await handler.mailDelivery.flush();
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

function forgotRequest(body, {origin = origins.customer, headers = {}} = {}) {
  return request(`${origin}/v1/auth/forgot-password`, {method: 'POST', headers: {origin, ...headers}, body});
}

function resetRequest(body, {origin = origins.customer, headers = {}} = {}) {
  return request(`${origin}/v1/auth/reset-password`, {method: 'POST', headers: {origin, ...headers}, body});
}

function emailVerifyRequest(body, {origin = origins.customer} = {}) {
  return request(`${origin}/v1/auth/email/verify`, {method: 'POST', headers: {origin}, body});
}

function loginRequest(body, {origin = origins.customer} = {}) {
  return request(`${origin}/v1/auth/login`, {method: 'POST', headers: {origin}, body});
}

function authedPost(handler, path, token, csrf, body = {}) {
  return handler(request(`${origins.customer}${path}`, {
    method: 'POST',
    headers: {origin: origins.customer, cookie: `${customerCookie}=${token}`, 'x-csrf-token': csrf},
    body,
  }));
}

function tokenFrom(response) {
  const value = response.headers.get('set-cookie') ?? '';
  return new RegExp(`${customerCookie}=([^;]+)`).exec(value)?.[1] ?? null;
}

async function login(handler, email, password) {
  const response = await handler(loginRequest({email, password}));
  const body = await response.clone().json().catch(() => null);
  return {response, body, token: tokenFrom(response), csrf: body?.csrfToken ?? null};
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

function failingMail() {
  return createMailAdapter({
    transport: async () => {
      throw new Error('smtp unavailable');
    },
    baseUrl: 'https://app.saven.test',
  });
}

function tokenFromMessage(message) {
  const match = /[?&]token=([A-Za-z0-9_.-]+)/.exec(message.text);
  assert.ok(match, 'the captured message must carry a token link');
  return decodeURIComponent(match[1]);
}

async function verificationRows(db, purpose) {
  const result = await db.adminQuery(
    `SELECT id::text AS id, user_id::text AS user_id, identifier, purpose, value_hash,
            expires_at, created_at, consumed_at
     FROM auth.verification WHERE purpose = $1 ORDER BY created_at, id`,
    [purpose],
  );
  return result.rows;
}

test('AUTH-005 reset request stores only a digest and sends through the capture adapter', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'reset-request@example.com', 'correct-horse-battery');

      const response = await handler(forgotRequest({email: 'reset-request@example.com'}));
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), {accepted: true});
      await flushMail(handler);
      assert.equal(messages.length, 1, 'one message is handed to the capture adapter');
      assert.equal(messages[0].to, 'reset-request@example.com');

      const token = tokenFromMessage(messages[0]);
      const rows = await verificationRows(db, 'password_reset');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].user_id, user.id);
      assert.equal(rows[0].identifier, 'reset-request@example.com');
      assert.equal(rows[0].value_hash, sha256(token), 'only the SHA-256 digest is stored');
      assert.notEqual(rows[0].value_hash, token);
      assert.equal(rows[0].consumed_at, null);
      assert.equal(new Date(rows[0].expires_at).getTime(), clock.now().getTime() + RESET_TTL_MS);

      const ledger = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      const ledgerText = ledger.rows.map(row => row.json).join('\n');
      assert.equal(ledgerText.includes(token), false, 'the audit ledger never contains the token');
      const stored = await db.adminQuery('SELECT row_to_json(v)::text AS json FROM auth.verification v');
      assert.equal(stored.rows[0].json.includes(token), false, 'the verification row never contains the token');
      const requested = await db.adminQuery(
        `SELECT detail_jsonb->>'delivery' AS delivery FROM auth.auth_audit
         WHERE event_type = 'password_reset_requested' AND outcome = 'success'`,
      );
      assert.ok(requested.rows.some(row => row.delivery === 'mail_adapter'));

      // An unknown address takes the identical path and response but creates nothing.
      const unknown = await handler(forgotRequest({email: 'nobody@example.com'}));
      assert.equal(unknown.status, 202);
      assert.deepEqual(await unknown.json(), {accepted: true});
      assert.equal(messages.length, 1, 'no message is sent to an unknown account');
      assert.equal((await verificationRows(db, 'password_reset')).length, 1, 'no token is created for an unknown account');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005 reset is single-use, changes the credential and revokes every session', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'reset-consume@example.com', 'correct-horse-battery');
      await addMembership(db, user.id, 'member');
      const first = await login(handler, 'reset-consume@example.com', 'correct-horse-battery');
      const second = await login(handler, 'reset-consume@example.com', 'correct-horse-battery');
      assert.ok(first.token && second.token);
      const membershipBefore = await db.adminQuery(
        'SELECT tenant_id::text AS tenant_id, role_id, status FROM auth.tenant_membership WHERE user_id = $1::uuid',
        [user.id],
      );

      assert.equal((await handler(forgotRequest({email: 'reset-consume@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);

      const reset = await handler(resetRequest({token, password: 'new-correct-horse-battery'}));
      assert.equal(reset.status, 200);
      const resetBody = await reset.json();
      assert.equal(resetBody.ok, true);
      assert.equal(JSON.stringify(resetBody).includes(token), false, 'the response never echoes the token');

      const after = await db.adminQuery(
        `SELECT password_hash, credential_version, password_updated_at, email
         FROM auth.users WHERE id = $1::uuid`,
        [user.id],
      );
      const policy = createPasswordPolicy();
      assert.equal((await policy.verify('new-correct-horse-battery', after.rows[0].password_hash)).valid, true);
      assert.equal((await policy.verify('correct-horse-battery', after.rows[0].password_hash)).valid, false);
      assert.equal(Number(after.rows[0].credential_version), user.credentialVersion + 1, 'the credential epoch advances');
      assert.ok(after.rows[0].password_updated_at instanceof Date);

      const membershipAfter = await db.adminQuery(
        'SELECT tenant_id::text AS tenant_id, role_id, status FROM auth.tenant_membership WHERE user_id = $1::uuid',
        [user.id],
      );
      assert.deepEqual(membershipAfter.rows, membershipBefore.rows, 'roles and membership are untouched');

      const sessions = await db.adminQuery(
        'SELECT revoked_at, revoked_reason FROM auth.sessions WHERE user_id = $1::uuid',
        [user.id],
      );
      assert.equal(sessions.rowCount, 2);
      assert.ok(sessions.rows.every(row => row.revoked_at instanceof Date && row.revoked_reason === 'password_reset'));

      const oldSession = await handler(request(`${origins.customer}/v1/auth/me`, {
        headers: {cookie: `${customerCookie}=${first.token}`},
      }));
      assert.equal(oldSession.status, 401, 'a revoked session no longer resolves');

      assert.equal((await login(handler, 'reset-consume@example.com', 'correct-horse-battery')).response.status, 401);
      assert.equal((await login(handler, 'reset-consume@example.com', 'new-correct-horse-battery')).response.status, 200);

      const replay = await handler(resetRequest({token, password: 'another-correct-horse'}));
      assert.equal(replay.status, 400);
      assert.equal((await replay.json()).error.code, 'RESET_TOKEN_INVALID');
      const still = await db.adminQuery('SELECT credential_version FROM auth.users WHERE id = $1::uuid', [user.id]);
      assert.equal(Number(still.rows[0].credential_version), user.credentialVersion + 1, 'replay changes nothing');

      const completed = await db.adminQuery(
        `SELECT detail_jsonb->>'purpose' AS purpose, detail_jsonb->>'sessions_revoked' AS revoked
         FROM auth.auth_audit WHERE event_type = 'password_reset_completed'`,
      );
      assert.equal(completed.rowCount, 1);
      assert.equal(completed.rows[0].purpose, 'password_reset');
      const ledger = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      assert.equal(ledger.rows.some(row => row.json.includes(token)), false);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005 invalid and expired reset tokens are refused without a credential change', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'reset-expiry@example.com', 'correct-horse-battery');
      const before = await db.adminQuery('SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid', [user.id]);

      const invalid = await handler(resetRequest({token: randomBytes(24).toString('base64url'), password: 'new-correct-horse-battery'}));
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error.code, 'RESET_TOKEN_INVALID');

      assert.equal((await handler(forgotRequest({email: 'reset-expiry@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);
      clock.advance(RESET_TTL_MS + 60 * 1000);
      const expired = await handler(resetRequest({token, password: 'new-correct-horse-battery'}));
      assert.equal(expired.status, 400);
      assert.equal((await expired.json()).error.code, 'RESET_TOKEN_INVALID');

      const after = await db.adminQuery('SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid', [user.id]);
      assert.deepEqual(after.rows, before.rows, 'a refused token never rewrites the credential');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005 two concurrent consumers of one reset token yield exactly one success', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'reset-race@example.com', 'correct-horse-battery');
      assert.equal((await handler(forgotRequest({email: 'reset-race@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);

      const [a, b] = await Promise.all([
        handler(resetRequest({token, password: 'first-correct-horse-battery'})),
        handler(resetRequest({token, password: 'second-correct-horse-battery'})),
      ]);
      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, [200, 400], 'exactly one consume succeeds');

      const row = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      const policy = createPasswordPolicy();
      const first = await policy.verify('first-correct-horse-battery', row.rows[0].password_hash);
      const second = await policy.verify('second-correct-horse-battery', row.rows[0].password_hash);
      assert.equal([first.valid, second.valid].filter(Boolean).length, 1, 'exactly one new password is stored');
      assert.equal(Number(row.rows[0].credential_version), user.credentialVersion + 1);

      const consumed = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.verification WHERE purpose = 'password_reset' AND consumed_at IS NOT NULL`,
      );
      assert.equal(consumed.rows[0].n, 1);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005 a reset token from an older credential generation is stale', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const counter = {hash: 0, verify: 0};
      const {handler} = buildRoutes({pool, clock, mail, passwordPolicy: spyPolicy(counter)});
      const user = await insertUser(db, 'reset-stale@example.com', 'correct-horse-battery');
      const session = await login(handler, 'reset-stale@example.com', 'correct-horse-battery');
      assert.ok(session.token);

      assert.equal((await handler(forgotRequest({email: 'reset-stale@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);

      // A credential change advances the immutable generation after the token was issued.
      const interim = await createPasswordPolicy().hash('interim-correct-horse');
      await db.adminQuery(
        `UPDATE auth.users
         SET password_hash = $2, password_scheme = $3, password_updated_at = now(),
             credential_version = credential_version + 1
         WHERE id = $1::uuid`,
        [user.id, interim.hash, interim.scheme],
      );

      counter.hash = 0;
      const stale = await handler(resetRequest({token, password: 'attacker-correct-horse'}));
      assert.equal(stale.status, 400);
      assert.equal((await stale.json()).error.code, 'RESET_TOKEN_INVALID', 'a stale generation is refused by the cheap probe');
      assert.equal(counter.hash, 0, 'a stale token never starts a password KDF');

      const policy = createPasswordPolicy();
      const stored = await db.adminQuery('SELECT password_hash FROM auth.users WHERE id = $1::uuid', [user.id]);
      assert.equal((await policy.verify('interim-correct-horse', stored.rows[0].password_hash)).valid, true, 'the later credential survives');
      assert.equal((await policy.verify('attacker-correct-horse', stored.rows[0].password_hash)).valid, false);
      const live = await db.adminQuery('SELECT revoked_at FROM auth.sessions WHERE user_id = $1::uuid', [user.id]);
      assert.ok(live.rows.every(row => row.revoked_at === null), 'a refused stale reset does not revoke sessions');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005 mail failure stays generic for reset and leaves no live token', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock, mail: failingMail()});
      await insertUser(db, 'mail-failure@example.com', 'correct-horse-battery');

      const known = await handler(forgotRequest({email: 'mail-failure@example.com'}));
      assert.equal(known.status, 202, 'delivery failure is not an account-existence oracle');
      const body = await known.clone().text();
      assert.equal(body.includes('token'), false);
      const unknown = await handler(forgotRequest({email: 'unknown-mail-failure@example.com'}));
      assert.equal(unknown.status, 202);
      assert.equal(await unknown.text(), body, 'known and unknown addresses are indistinguishable');

      await flushMail(handler);
      const rows = await verificationRows(db, 'password_reset');
      assert.equal(rows.length, 1, 'only the known account has a challenge row');
      assert.ok(rows[0].consumed_at instanceof Date, 'an undelivered challenge is invalidated when cleanup succeeds');

      // The authenticated verification-request path also hands delivery to the queue; the
      // outward 202 does not depend on the provider, and a failed delivery invalidates the
      // challenge through the dispatcher's failure callback.
      const session = await login(handler, 'mail-failure@example.com', 'correct-horse-battery');
      const verification = await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {});
      assert.equal(verification.status, 202);
      await flushMail(handler);
      const verifyRows = await verificationRows(db, 'email_verification');
      assert.equal(verifyRows.length, 1);
      assert.ok(verifyRows[0].consumed_at instanceof Date, 'the undelivered verification challenge is invalidated');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005 email verification is session-requested, single-use and expiring', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'verify-email@example.com', 'correct-horse-battery', {verified: false});

      const session = await login(handler, 'verify-email@example.com', 'correct-horse-battery');
      assert.equal(session.response.status, 200);
      const requested = await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {});
      assert.equal(requested.status, 202);
      await flushMail(handler);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].to, 'verify-email@example.com');
      const token = tokenFromMessage(messages[0]);
      const rows = await verificationRows(db, 'email_verification');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].value_hash, sha256(token));
      assert.equal(new Date(rows[0].expires_at).getTime(), clock.now().getTime() + VERIFY_TTL_MS);

      const verified = await handler(emailVerifyRequest({token}));
      assert.equal(verified.status, 200);
      const userRow = await db.adminQuery(
        'SELECT email_verified, email_verified_at FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      assert.equal(userRow.rows[0].email_verified, true);
      assert.ok(userRow.rows[0].email_verified_at instanceof Date);

      const replay = await handler(emailVerifyRequest({token}));
      assert.equal(replay.status, 400);
      assert.equal((await replay.json()).error.code, 'RECOVERY_TOKEN_INVALID');

      assert.equal((await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {})).status, 202);
      await flushMail(handler);
      const expiredToken = tokenFromMessage(messages[1]);
      clock.advance(VERIFY_TTL_MS + 60 * 1000);
      const expired = await handler(emailVerifyRequest({token: expiredToken}));
      assert.equal(expired.status, 400);

      const invalid = await handler(emailVerifyRequest({token: randomBytes(24).toString('base64url')}));
      assert.equal(invalid.status, 400);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005 two concurrent verification consumers yield exactly one success', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      await insertUser(db, 'verify-race@example.com', 'correct-horse-battery', {verified: false});
      const session = await login(handler, 'verify-race@example.com', 'correct-horse-battery');
      assert.equal((await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {})).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);

      const [a, b] = await Promise.all([
        handler(emailVerifyRequest({token})),
        handler(emailVerifyRequest({token})),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [200, 400]);
      const consumed = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.verification
         WHERE purpose = 'email_verification' AND consumed_at IS NOT NULL`,
      );
      assert.equal(consumed.rows[0].n, 1);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005 keeps the AUTH-003 non-enumerating throttle boundary and no-adapter behaviour', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      // No mail adapter: the retained AUTH-003 behaviour must be unchanged.
      const plain = buildRoutes({pool, clock});
      await insertUser(db, 'no-adapter@example.com', 'correct-horse-battery');
      assert.equal((await plain.handler(forgotRequest({email: 'no-adapter@example.com'}))).status, 202);
      assert.equal((await verificationRows(db, 'password_reset')).length, 0, 'no token without a controlled adapter');
      const deferred = await db.adminQuery(
        `SELECT detail_jsonb->>'delivery' AS delivery FROM auth.auth_audit
         WHERE event_type = 'password_reset_requested'`,
      );
      assert.ok(deferred.rows.every(row => row.delivery === 'deferred_to_auth_005'));

      // With an adapter the shared throttle remains authoritative.
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail, rateLimitPolicy: {reset: {limit: 2, windowMs: 60 * 1000}}});
      await insertUser(db, 'throttle@example.com', 'correct-horse-battery');
      const bodies = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await handler(forgotRequest({email: 'throttle@example.com'}));
        assert.equal(response.status, 202);
        bodies.push(await response.text());
      }
      await flushMail(handler);
      assert.equal(new Set(bodies).size, 1);
      assert.equal(messages.length, 2);
      const before = (await verificationRows(db, 'password_reset')).length;
      const throttled = await handler(forgotRequest({email: 'throttle@example.com'}));
      assert.equal(throttled.status, 429);
      assert.ok(Number(throttled.headers.get('retry-after')) >= 1);
      assert.equal(messages.length, 2, 'a throttled request sends no mail');
      assert.equal((await verificationRows(db, 'password_reset')).length, before, 'a throttled request creates no token');

      const unknown = await handler(forgotRequest({email: 'unknown-throttle@example.com'}));
      assert.equal(unknown.status, 202);
      assert.equal(await unknown.text(), bodies[0], 'known and unknown requests share one response');

      assert.equal((await handler(forgotRequest({email: 'throttle@example.com', redirect: 'https://evil.example'}))).status, 400);
      assert.equal((await handler(forgotRequest({email: 'throttle@example.com'}, {origin: 'https://evil.example'}))).status, 421);
      const badReset = await handler(resetRequest({token: 'short', password: 'new-correct-horse-battery'}));
      assert.equal(badReset.status, 400);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005 runs the reset lifecycle under the real auth-service role', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await withAuthServicePool(db, async pool => {
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'real-role-reset@example.com', 'correct-horse-battery');
      const session = await login(handler, 'real-role-reset@example.com', 'correct-horse-battery');
      assert.equal(session.response.status, 200);

      assert.equal((await handler(forgotRequest({email: 'real-role-reset@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);
      const reset = await handler(resetRequest({token, password: 'rotated-correct-horse'}));
      assert.equal(reset.status, 200, 'the restricted service role can consume and rotate');

      const sessions = await db.adminQuery('SELECT revoked_at FROM auth.sessions WHERE user_id = $1::uuid', [user.id]);
      assert.ok(sessions.rows.length >= 1 && sessions.rows.every(row => row.revoked_at instanceof Date));
      const relogin = await login(handler, 'real-role-reset@example.com', 'rotated-correct-horse');
      assert.equal(relogin.response.status, 200, 'the new credential authenticates on the restricted role');
    });
  });
});

test('AUTH-005 mail adapter requires an injected transport and never leaks the token in errors', async () => {
  assert.throws(() => createMailAdapter({baseUrl: 'https://app.saven.test'}), MailConfigurationError);
  assert.throws(() => createMailAdapter({transport: async () => {}, baseUrl: 'not-a-url'}), MailConfigurationError);

  const messages = [];
  const mail = createMailAdapter({
    transport: async message => {
      messages.push(message);
    },
    baseUrl: 'https://app.saven.test',
  });
  await mail.sendPasswordReset({to: 'person@example.com', token: 'TOKENVALUE0123456789', expiresAt: new Date()});
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'person@example.com');
  assert.ok(messages[0].text.includes('TOKENVALUE0123456789'));
  assert.match(messages[0].subject, /reset/i);

  const failing = createMailAdapter({
    transport: async () => {
      throw new Error('provider echoed TOKENVALUE0123456789');
    },
    baseUrl: 'https://app.saven.test',
  });
  await assert.rejects(
    () => failing.sendPasswordReset({to: 'person@example.com', token: 'TOKENVALUE0123456789', expiresAt: new Date()}),
    error => error instanceof MailDeliveryError && !error.message.includes('TOKENVALUE0123456789'),
  );

  // Service/config validation is bounded and purpose rows are reference data.
  assert.throws(() => validateRecoveryConfig({resetTtlMs: 1}), /one minute/);
  assert.throws(() => validateRecoveryConfig({tokenBytes: 8}), /32 to 64/);
  assert.equal(digestRecoveryToken('x'.repeat(40)).length, 64);
  assert.throws(() => digestRecoveryToken('short'), /invalid or has expired/);
  const store = {
    withClient: async () => {},
    withTransaction: async () => {},
    revokeAllSessions: async () => 0,
  };
  const service = createRecoveryService({store, config: {resetTtlMs: 60 * 1000}});
  assert.equal(service.settings.resetTtlMs, 60 * 1000);
});

// Creates a real non-owner login that is a member of the fixture's namespaced
// auth-service role. Setup and observation stay on the fixture's administrative
// connection; the exercised service only has the production grants.
async function withAuthServicePool(db, action, {max = 8} = {}) {
  const suffix = randomBytes(4).toString('hex');
  const login = `saven_auth_${suffix}_service_login`;
  const password = randomBytes(24).toString('base64url');
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const literal = value => `'${String(value).replaceAll("'", "''")}'`;
  await db.adminQuery(
    `CREATE ROLE ${quote(login)} LOGIN PASSWORD ${literal(password)} ` +
    'NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION',
  );
  await db.adminQuery(`GRANT ${quote(db.roles.authService)} TO ${quote(login)}`);
  const pool = new Pool(connectionConfig(db.database, {user: login, password, max}));
  try {
    return await action(pool, login);
  } finally {
    await pool.end().catch(() => {});
    await db.adminQuery(`DROP ROLE IF EXISTS ${quote(login)}`).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// AUTH-005-R2: immutable address/generation binding, admission, pool and mail
// response boundaries.
// ---------------------------------------------------------------------------

test('AUTH-005-R2 an old-address verification token cannot verify a new address', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'old-address-verify@example.com', 'correct-horse-battery', {verified: false});
      const session = await login(handler, 'old-address-verify@example.com', 'correct-horse-battery');
      assert.equal((await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {})).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);

      // The account moves to a different, still-unverified address after issuance.
      await db.adminQuery(
        "UPDATE auth.users SET email = $2, email_verified = false, email_verified_at = NULL WHERE id = $1::uuid",
        [user.id, 'new-address-verify@example.com'],
      );

      const response = await handler(emailVerifyRequest({token}));
      assert.equal(response.status, 400, 'the old-address token must not verify the new address');
      const row = await db.adminQuery(
        'SELECT email, email_verified, email_verified_at FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      assert.equal(row.rows[0].email, 'new-address-verify@example.com');
      assert.equal(row.rows[0].email_verified, false, 'no wrong-address verification occurred');
      assert.equal(row.rows[0].email_verified_at, null);
      const challenge = await db.adminQuery(
        `SELECT consumed_at FROM auth.verification WHERE purpose = 'email_verification' AND user_id = $1::uuid`,
        [user.id],
      );
      assert.equal(challenge.rows[0].consumed_at, null, 'the refused challenge is not partially consumed');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 an old-address reset token cannot reset a new address', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'old-address-reset@example.com', 'correct-horse-battery');
      assert.equal((await handler(forgotRequest({email: 'old-address-reset@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);
      const before = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );

      await db.adminQuery(
        "UPDATE auth.users SET email = $2 WHERE id = $1::uuid",
        [user.id, 'relocated-reset@example.com'],
      );

      const response = await handler(resetRequest({token, password: 'attacker-correct-horse'}));
      assert.equal(response.status, 400, 'the old-address reset token is refused');
      const after = await db.adminQuery(
        'SELECT email, password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      assert.equal(after.rows[0].email, 'relocated-reset@example.com');
      assert.equal(after.rows[0].password_hash, before.rows[0].password_hash);
      assert.equal(after.rows[0].credential_version, before.rows[0].credential_version);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 issuance resolves the current account address, not a caller snapshot', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'address-before@example.com', 'correct-horse-battery');
      await db.adminQuery(
        "UPDATE auth.users SET email = $2 WHERE id = $1::uuid",
        [user.id, 'address-after@example.com'],
      );

      const current = await handler(forgotRequest({email: 'address-after@example.com'}));
      assert.equal(current.status, 202);
      await flushMail(handler);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].to, 'address-after@example.com', 'mail goes to the current stored address');
      const rows = await db.adminQuery(
        `SELECT identifier FROM auth.verification WHERE purpose = 'password_reset' AND user_id = $1::uuid`,
        [user.id],
      );
      assert.equal(rows.rows[0].identifier, 'address-after@example.com');

      const oldAddress = await handler(forgotRequest({email: 'address-before@example.com'}));
      assert.equal(oldAddress.status, 202);
      await flushMail(handler);
      assert.equal(messages.length, 1, 'the replaced address no longer resolves to the account');
      assert.equal((await verificationRows(db, 'password_reset')).length, 1);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 two reset links for one credential generation: the first change invalidates the second', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'two-links@example.com', 'correct-horse-battery');
      assert.equal((await handler(forgotRequest({email: 'two-links@example.com'}))).status, 202);
      assert.equal((await handler(forgotRequest({email: 'two-links@example.com'}))).status, 202);
      await flushMail(handler);
      assert.equal(messages.length, 2);
      const [first, second] = messages.map(tokenFromMessage);

      assert.equal((await handler(resetRequest({token: first, password: 'first-winner-password'}))).status, 200);
      const secondAttempt = await handler(resetRequest({token: second, password: 'second-loser-password'}));
      assert.equal(secondAttempt.status, 400);
      assert.equal((await secondAttempt.json()).error.code, 'RESET_TOKEN_INVALID');

      const policy = createPasswordPolicy();
      const stored = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      assert.equal((await policy.verify('first-winner-password', stored.rows[0].password_hash)).valid, true);
      assert.equal((await policy.verify('second-loser-password', stored.rows[0].password_hash)).valid, false);
      assert.equal(Number(stored.rows[0].credential_version), user.credentialVersion + 1, 'exactly one credential change');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 a credential change that starts earlier and commits later still invalidates the link', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    const holder = await pool.connect();
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'older-start@example.com', 'correct-horse-battery');
      const session = await login(handler, 'older-start@example.com', 'correct-horse-battery');
      assert.equal((await handler(forgotRequest({email: 'older-start@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);

      const interim = await createPasswordPolicy().hash('interim-credential-password');
      await holder.query('BEGIN');
      await holder.query(
        `UPDATE auth.users
         SET password_hash = $2, password_scheme = $3, password_updated_at = now(),
             credential_version = credential_version + 1
         WHERE id = $1::uuid`,
        [user.id, interim.hash, interim.scheme],
      );

      const resetPromise = handler(resetRequest({token, password: 'reset-attempt-password'}));
      await sleep(250);
      await holder.query('COMMIT');

      const reset = await resetPromise;
      assert.equal(reset.status, 400, 'the older-start/later-commit credential wins');
      const body = await reset.json();
      assert.ok(['RESET_TOKEN_STALE', 'RESET_TOKEN_INVALID'].includes(body.error.code));

      const policy = createPasswordPolicy();
      const stored = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      assert.equal((await policy.verify('interim-credential-password', stored.rows[0].password_hash)).valid, true);
      assert.equal((await policy.verify('reset-attempt-password', stored.rows[0].password_hash)).valid, false);
      assert.equal((await policy.verify('correct-horse-battery', stored.rows[0].password_hash)).valid, false);
      assert.equal(Number(stored.rows[0].credential_version), user.credentialVersion + 1);
      const challenge = await db.adminQuery(
        'SELECT consumed_at FROM auth.verification WHERE purpose = $1 AND user_id = $2::uuid',
        ['password_reset', user.id],
      );
      assert.equal(challenge.rows[0].consumed_at, null, 'the refused link is not consumed');
      const live = await db.adminQuery('SELECT revoked_at FROM auth.sessions WHERE user_id = $1::uuid', [user.id]);
      assert.ok(live.rows.every(row => row.revoked_at === null), 'a refused reset does not revoke sessions');
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
      await pool.end();
    }
  });
});

test('AUTH-005-R2 reset and an authenticated credential change serialize to exactly one accepted change', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      const user = await insertUser(db, 'credential-race@example.com', 'correct-horse-battery');
      const session = await login(handler, 'credential-race@example.com', 'correct-horse-battery');
      assert.equal((await handler(forgotRequest({email: 'credential-race@example.com'}))).status, 202);
      assert.equal((await handler(forgotRequest({email: 'credential-race@example.com'}))).status, 202);
      await flushMail(handler);
      const [first, second] = messages.map(tokenFromMessage);

      const changeHash = await createPasswordPolicy().hash('authenticated-change-password');
      const change = (async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await client.query(
            `UPDATE auth.users
             SET password_hash = $2, password_scheme = $3, password_updated_at = now(),
                 credential_version = credential_version + 1
             WHERE id = $1::uuid AND credential_version = $4
             RETURNING id`,
            [user.id, changeHash.hash, changeHash.scheme, user.credentialVersion],
          );
          await client.query('COMMIT');
          return result.rowCount === 1;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      })();

      const [reset, changed] = await Promise.all([
        handler(resetRequest({token: first, password: 'reset-winner-password'})),
        change,
      ]);
      const accepted = (reset.status === 200 ? 1 : 0) + (changed ? 1 : 0);
      assert.equal(accepted, 1, 'exactly one credential change is accepted');

      const loser = await handler(resetRequest({token: second, password: 'second-link-password'}));
      assert.equal(loser.status, 400, 'the second old link is invalid in either outcome');

      const policy = createPasswordPolicy();
      const stored = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      assert.equal(Number(stored.rows[0].credential_version), user.credentialVersion + 1);
      const resetWon = (await policy.verify('reset-winner-password', stored.rows[0].password_hash)).valid;
      const changeWon = (await policy.verify('authenticated-change-password', stored.rows[0].password_hash)).valid;
      assert.equal([resetWon, changeWon].filter(Boolean).length, 1, 'only one new credential is stored');
      if (resetWon) {
        const live = await db.adminQuery('SELECT revoked_at FROM auth.sessions WHERE user_id = $1::uuid', [user.id]);
        assert.ok(live.rows.every(row => row.revoked_at instanceof Date), 'a winning reset revokes sessions');
      } else {
        const live = await db.adminQuery('SELECT revoked_at FROM auth.sessions WHERE user_id = $1::uuid', [user.id]);
        assert.ok(live.rows.every(row => row.revoked_at === null), 'a refused reset does not revoke sessions');
      }
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 an audit failure rolls the whole reset back', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const writer = createAuditWriter(pool);
      const audit = async (event, options) => {
        if (event.eventType === 'password_reset_completed') throw new Error('audit unavailable');
        return writer(event, options);
      };
      const {handler} = buildRoutes({pool, clock, mail, audit});
      const user = await insertUser(db, 'audit-failure@example.com', 'correct-horse-battery');
      const session = await login(handler, 'audit-failure@example.com', 'correct-horse-battery');
      assert.equal((await handler(forgotRequest({email: 'audit-failure@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);
      const before = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );

      const response = await handler(resetRequest({token, password: 'should-be-rolled-back'}));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'AUTH_ACCOUNTING_UNAVAILABLE');

      const after = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      assert.deepEqual(after.rows, before.rows, 'the credential change is rolled back');
      const challenge = await db.adminQuery(
        `SELECT consumed_at FROM auth.verification WHERE purpose = 'password_reset' AND user_id = $1::uuid`,
        [user.id],
      );
      assert.equal(challenge.rows[0].consumed_at, null, 'the token is not consumed on rollback');
      const live = await db.adminQuery('SELECT revoked_at FROM auth.sessions WHERE user_id = $1::uuid', [user.id]);
      assert.ok(live.rows.every(row => row.revoked_at === null), 'sessions are not revoked on rollback');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 a revocation failure rolls the whole reset back', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const wrapStore = store => {
        const wrapped = {...store};
        wrapped.revokeAllSessions = async () => {
          throw new Error('revocation unavailable');
        };
        return wrapped;
      };
      const {handler} = buildRoutes({pool, clock, mail, wrapStore});
      const user = await insertUser(db, 'revoke-failure@example.com', 'correct-horse-battery');
      await login(handler, 'revoke-failure@example.com', 'correct-horse-battery');
      assert.equal((await handler(forgotRequest({email: 'revoke-failure@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);
      const before = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );

      const response = await handler(resetRequest({token, password: 'should-be-rolled-back'}));
      assert.equal(response.status, 503);
      const after = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      assert.deepEqual(after.rows, before.rows);
      const challenge = await db.adminQuery(
        `SELECT consumed_at FROM auth.verification WHERE purpose = 'password_reset' AND user_id = $1::uuid`,
        [user.id],
      );
      assert.equal(challenge.rows[0].consumed_at, null);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 an unknown reset COMMIT publishes nothing and destroys the client', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const hooked = hookedResetPool(pool);
      const {handler} = buildRoutes({pool: hooked.pool, clock, mail});
      const user = await insertUser(db, 'uncertain-commit@example.com', 'correct-horse-battery');
      assert.equal((await handler(forgotRequest({email: 'uncertain-commit@example.com'}))).status, 202);
      await flushMail(handler);
      const token = tokenFromMessage(messages[0]);
      const before = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );

      const response = await handler(resetRequest({token, password: 'uncertain-commit-password'}));
      const clone = response.clone();
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'SESSION_TRANSACTION_UNCERTAIN');
      assert.ok(hooked.injected, 'the reset transaction COMMIT was the injected boundary');
      assert.ok(hooked.releases.includes(true), 'the uncertain client is destroyed');
      const text = await clone.text();
      assert.equal(text.includes(token), false, 'no token is published on an uncertain commit');

      // The injected failure occurs before COMMIT is sent, so this run rolls back; the
      // response itself still reports an unknown outcome and never publishes a credential.
      const after = await db.adminQuery(
        'SELECT password_hash, credential_version FROM auth.users WHERE id = $1::uuid',
        [user.id],
      );
      assert.deepEqual(after.rows, before.rows);
      const challenge = await db.adminQuery(
        `SELECT consumed_at FROM auth.verification WHERE purpose = 'password_reset' AND user_id = $1::uuid`,
        [user.id],
      );
      assert.equal(challenge.rows[0].consumed_at, null);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 forgot-password completes on a size-one real-role pool', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await withAuthServicePool(db, async pool => {
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      await insertUser(db, 'max-one-known@example.com', 'correct-horse-battery');

      const known = await within(handler(forgotRequest({email: 'max-one-known@example.com'})), 15000, 'known reset request');
      assert.equal(known.status, 202);
      await flushMail(handler);
      assert.equal(messages.length, 1, 'the known request delivers through the bounded queue');

      const unknown = await within(handler(forgotRequest({email: 'max-one-unknown@example.com'})), 15000, 'unknown reset request');
      assert.equal(unknown.status, 202);
      await flushMail(handler);
      assert.equal(messages.length, 1, 'the unknown request sends no mail');
    }, {max: 1});
  });
});

test('AUTH-005-R2 concurrent reset requests complete on a saturated small pool', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await withAuthServicePool(db, async pool => {
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({pool, clock, mail});
      await insertUser(db, 'saturated@example.com', 'correct-horse-battery');
      const responses = await within(Promise.all([
        handler(forgotRequest({email: 'saturated@example.com'})),
        handler(forgotRequest({email: 'saturated@example.com'})),
      ]), 20000, 'saturated reset requests');
      assert.deepEqual(responses.map(response => response.status), [202, 202]);
      await flushMail(handler);
      assert.equal(messages.length, 2);
    }, {max: 2});
  });
});

test('AUTH-005-R2 verification requests use a durable admission budget and recover after the window', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({
        pool,
        clock,
        mail,
        recoveryConfig: {verificationRequestLimit: 2, verificationRequestWindowMs: 60 * 1000},
      });
      const user = await insertUser(db, 'verify-budget@example.com', 'correct-horse-battery', {verified: false});
      const session = await login(handler, 'verify-budget@example.com', 'correct-horse-battery');

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {});
        assert.equal(response.status, 202);
      }
      await flushMail(handler);
      assert.equal(messages.length, 2);
      const issued = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.verification WHERE purpose = 'email_verification' AND user_id = $1::uuid`,
        [user.id],
      );
      assert.equal(issued.rows[0].n, 2);

      const denied = await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {});
      assert.equal(denied.status, 429);
      assert.equal((await denied.json()).error.code, 'MAIL_THROTTLED');
      assert.ok(Number(denied.headers.get('retry-after')) >= 1);
      await flushMail(handler);
      assert.equal(messages.length, 2, 'a denied request creates and sends nothing');
      const afterDenied = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.verification WHERE purpose = 'email_verification' AND user_id = $1::uuid`,
        [user.id],
      );
      assert.equal(afterDenied.rows[0].n, 2);

      clock.advance(61 * 1000);
      const afterWindow = await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {});
      assert.equal(afterWindow.status, 202, 'the window admits requests again');
      await flushMail(handler);
      assert.equal(messages.length, 3);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 concurrent verification requests admit exactly the configured budget', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const {handler} = buildRoutes({
        pool,
        clock,
        mail,
        recoveryConfig: {verificationRequestLimit: 1, verificationRequestWindowMs: 60 * 1000},
      });
      const user = await insertUser(db, 'verify-concurrent@example.com', 'correct-horse-battery', {verified: false});
      const session = await login(handler, 'verify-concurrent@example.com', 'correct-horse-battery');

      const responses = await Promise.all([
        authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {}),
        authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {}),
      ]);
      assert.deepEqual(responses.map(response => response.status).sort(), [202, 429]);
      await flushMail(handler);
      assert.equal(messages.length, 1);
      const issued = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.verification WHERE purpose = 'email_verification' AND user_id = $1::uuid`,
        [user.id],
      );
      assert.equal(issued.rows[0].n, 1);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 slow and failing transports do not control the reset response boundary', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const slow = deferred();
      const messages = [];
      const slowMail = createMailAdapter({
        transport: async message => {
          await slow.promise;
          messages.push(message);
        },
        baseUrl: 'https://app.saven.test',
      });
      const {handler} = buildRoutes({pool, clock, mail: slowMail});
      await insertUser(db, 'slow-known@example.com', 'correct-horse-battery');
      const inactive = await insertUser(db, 'slow-inactive@example.com', 'correct-horse-battery');
      await db.adminQuery("UPDATE auth.users SET status = 'suspended' WHERE id = $1::uuid", [inactive.id]);

      for (const email of ['slow-known@example.com', 'slow-inactive@example.com', 'slow-unknown@example.com']) {
        const response = await within(handler(forgotRequest({email})), 2000, `${email} response`);
        assert.equal(response.status, 202, 'the public response never waits for the provider');
        assert.deepEqual(await response.json(), {accepted: true});
      }
      assert.equal(messages.length, 0, 'delivery is still pending when the responses returned');

      slow.resolve();
      await flushMail(handler);
      assert.equal(messages.length, 1, 'only the active account produced a message');
      assert.equal(messages[0].to, 'slow-known@example.com');

      // Cleanup is best effort: a failing invalidation does not make the dispatcher hang,
      // and the residual challenge can remain live until expiry. That boundary is tested.
      const failingDispatcher = createMailDispatcher({
        mailer: failingMail(),
        onFailure: async () => {
          throw new Error('cleanup unavailable');
        },
      });
      const submitted = failingDispatcher.submit({
        kind: 'password_reset',
        to: 'cleanup@example.com',
        token: 'TOKENVALUE0123456789.1',
        expiresAt: new Date(clock.now().getTime() + RESET_TTL_MS),
        challengeId: '00000000-0000-4000-8000-000000000000',
      });
      assert.equal(submitted.accepted, true);
      await within(failingDispatcher.flush(), 2000, 'failing cleanup flush');
      assert.equal(failingDispatcher.failures.length, 1);
      assert.equal(failingDispatcher.pending(), 0);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 verification requests refuse a read-valid-then-stale session', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      const modes = {
        revoked: session => db.adminQuery('UPDATE auth.sessions SET revoked_at = now() WHERE id = $1::uuid', [session.id]),
        expired: session => db.adminQuery(
          'UPDATE auth.sessions SET idle_expires_at = $2::timestamptz WHERE id = $1::uuid',
          [session.id, new Date(clock.now().getTime() - 1000).toISOString()],
        ),
        disabled: session => db.adminQuery("UPDATE auth.users SET status = 'disabled' WHERE id = $1::uuid", [session.userId]),
        credential: session => db.adminQuery(
          'UPDATE auth.users SET credential_version = credential_version + 1 WHERE id = $1::uuid',
          [session.userId],
        ),
      };
      let index = 0;
      for (const [mode, mutate] of Object.entries(modes)) {
        index += 1;
        const email = `verify-stale-${mode}-${index}@example.com`;
        const user = await insertUser(db, email, 'correct-horse-battery', {verified: false});
        const hookRef = {current: null};
        const {handler} = buildRoutes({pool, clock, mail, wrapStore: interceptingStore(hookRef)});
        const session = await login(handler, email, 'correct-horse-battery');
        hookRef.current = mutate;
        const response = await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {});
        assert.equal(response.status, 401, `${mode} is refused`);
        await flushMail(handler);
        const rows = await db.adminQuery(
          `SELECT count(*)::int AS n FROM auth.verification WHERE purpose = 'email_verification' AND user_id = $1::uuid`,
          [user.id],
        );
        assert.equal(rows.rows[0].n, 0, `${mode}: no challenge is created`);
      }
      assert.equal(messages.length, 0, 'no unauthorized mail is sent');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-005-R2 a verification admission store failure creates no challenge or mail', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {messages, mail} = captureMail();
      let fail = false;
      const wrapStore = store => {
        const wrapped = {...store};
        wrapped.withTransaction = async (...args) => {
          if (fail) throw new Error('store unavailable');
          return store.withTransaction(...args);
        };
        return wrapped;
      };
      const {handler} = buildRoutes({pool, clock, mail, wrapStore});
      const user = await insertUser(db, 'verify-store-failure@example.com', 'correct-horse-battery', {verified: false});
      const session = await login(handler, 'verify-store-failure@example.com', 'correct-horse-battery');
      fail = true;
      const response = await authedPost(handler, '/v1/auth/email/verification/request', session.token, session.csrf, {});
      assert.equal(response.status, 503);
      await flushMail(handler);
      assert.equal(messages.length, 0);
      const rows = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.verification WHERE purpose = 'email_verification' AND user_id = $1::uuid`,
        [user.id],
      );
      assert.equal(rows.rows[0].n, 0);
    } finally {
      await pool.end();
    }
  });
});
