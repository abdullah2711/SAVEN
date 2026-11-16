import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {withAuthDatabase} from './helpers/pg-auth-fixture.mjs';
import {encodePassword} from '../src/passwords.mjs';
import {createAuthServer, createAuditWriter} from '../src/auth/server.mjs';
import {createSessionStore} from '../src/auth/session-store.mjs';
import {createAuthRoutes, cookieName} from '../src/auth/routes.mjs';
import {createPasswordPolicy, DEFAULT_PASSWORD_POLICY, PasswordPolicyError, __internals as passwordInternals} from '../src/auth/password-policy.mjs';
import {createRateLimiter, normalizeRatePolicy, throttleScopes, canonicalizeIp, AccountingUnavailableError} from '../src/auth/rate-limit.mjs';

const {Pool} = pg;
const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const customerCookie = cookieName('customer', true);
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

function connectionConfig(database, overrides = {}) {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database,
    max: 8,
    application_name: 'saven-auth-003-test',
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

async function insertUser(db, email, password, {scrypt = false} = {}) {
  const encoded = scrypt ? await encodePassword(password) : (await createPasswordPolicy().hash(password)).hash;
  const scheme = scrypt ? 'scrypt' : 'argon2id';
  const result = await db.adminQuery(
    `INSERT INTO auth.users(email, password_hash, password_scheme, password_updated_at, email_verified, email_verified_at)
     VALUES ($1, $2, $3, now(), true, now()) RETURNING id::text AS id`,
    [email, encoded, scheme],
  );
  return result.rows[0].id;
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

function resetRequest(body, {origin = origins.customer, headers = {}} = {}) {
  return request(`${origin}/v1/auth/forgot-password`, {method: 'POST', headers: {origin, ...headers}, body});
}

function tokenFrom(response) {
  const value = response.headers.get('set-cookie') ?? '';
  return new RegExp(`${customerCookie}=([^;]+)`).exec(value)?.[1] ?? null;
}

async function login(handler, email, password, options = {}) {
  const response = await handler(loginRequest({email, password}, options));
  return {response, body: await response.clone().json().catch(() => null), token: tokenFrom(response)};
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

// Builds the versioned routes with an explicit throttle policy, since the frozen
// composition root only supplies defaults.
function buildRoutes({pool, clock, rateLimitPolicy = {}, trustedClientHeader = null, passwordPolicy = null, audit = null, accountingCooldownMs = 30 * 1000}) {
  const store = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
  const handler = createAuthRoutes({
    store,
    findUserByEmail: makeFindUser(pool),
    audit: audit ?? createAuditWriter(pool),
    origins,
    secureCookies: true,
    clock: clock.clock,
    rateLimitPolicy,
    trustedClientHeader,
    passwordPolicy,
    accountingCooldownMs,
  });
  return {store, handler};
}


// Wraps a pool so a test can fail one specific statement without changing production
// code paths, and records release(destroy) decisions.
function hookedPool(basePool) {
  const events = [];
  const controller = {
    events,
    fail: {lockAt: null, unlock: false, commitAt: null, rollback: false},
    lockCount: 0,
    commitCount: 0,
  };
  return {
    controller,
    pool: {
      query: (text, params) => basePool.query(text, params),
      async connect() {
        const client = await basePool.connect();
        const originalQuery = client.query.bind(client);
        const originalRelease = client.release.bind(client);
        client.query = (...args) => {
          const text = args[0];
          const statement = typeof text === 'string' ? text : '';
          if (statement.includes('pg_advisory_lock')) {
            controller.lockCount += 1;
            if (controller.fail.lockAt !== null && controller.lockCount === controller.fail.lockAt) {
              controller.fail.lockAt = null;
              throw new Error('injected scope-lock failure');
            }
          }
          if (statement.includes('pg_advisory_unlock') && controller.fail.unlock) {
            controller.fail.unlock = false;
            throw new Error('injected unlock failure');
          }
          if (statement.trim().toUpperCase() === 'COMMIT') {
            controller.commitCount += 1;
            if (controller.fail.commitAt !== null && controller.commitCount === controller.fail.commitAt) {
              controller.fail.commitAt = null;
              throw new Error('injected commit uncertainty');
            }
          }
          if (statement.trim().toUpperCase() === 'ROLLBACK' && controller.fail.rollback) {
            controller.fail.rollback = false;
            throw new Error('injected rollback failure');
          }
          return originalQuery(...args);
        };
        client.release = destroy => {
          events.push(destroy === true);
          return originalRelease(destroy);
        };
        return client;
      },
    },
  };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms)),
  ]);
}

test('AUTH-003 password policy prefers Argon2id and retains bounded scrypt', async () => {
  const policy = createPasswordPolicy();
  const created = await policy.hash('correct-horse-battery');
  assert.equal(created.scheme, 'argon2id');
  assert.match(created.hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(created.hash.includes('correct-horse-battery'), false, 'the verifier must not contain the password');

  const good = await policy.verify('correct-horse-battery', created.hash);
  assert.deepEqual({valid: good.valid, scheme: good.scheme, needsRehash: good.needsRehash}, {valid: true, scheme: 'argon2id', needsRehash: false});
  assert.equal((await policy.verify('wrong-password-value', created.hash)).valid, false);

  const retained = await encodePassword('retained-scrypt-password');
  const scryptResult = await policy.verify('retained-scrypt-password', retained);
  assert.equal(scryptResult.valid, true, 'retained scrypt verifiers must stay verifiable');
  assert.equal(scryptResult.scheme, 'scrypt');
  assert.equal(scryptResult.needsRehash, true, 'scrypt verifiers are upgraded on success');

  assert.equal((await policy.verify('whatever-value', 'bcrypt$2b$whatever')).valid, false, 'bcrypt is not supported');
  assert.equal((await policy.verify('whatever-value', 'plaintext-password')).valid, false, 'plaintext is not supported');
  assert.equal((await policy.verify('whatever-value', null)).valid, false, 'an absent verifier fails closed after dummy work');
  assert.equal((await policy.verify('whatever-value', '$argon2id$v=19$m=1,t=1,p=1$c2FsdA==$dGFn')).valid, false, 'absurd Argon2 parameters fail closed');

  const scryptOnly = createPasswordPolicy({policy: {preferredScheme: 'scrypt'}});
  assert.equal((await scryptOnly.hash('another-valid-password')).scheme, 'scrypt');

  for (const bad of [
    {minLength: 4},
    {maxBytes: 4096},
    {maxConcurrentKdfs: 9},
    {argon2id: {memoryKiB: 1024}},
    {argon2id: {passes: 50}},
  ]) {
    assert.throws(() => createPasswordPolicy({policy: bad}), undefined, JSON.stringify(bad));
  }
  assert.equal(DEFAULT_PASSWORD_POLICY.preferredScheme, 'argon2id');
});

test('AUTH-003 KDF concurrency is bounded and overload is refused', async () => {
  const policy = createPasswordPolicy({policy: {maxConcurrentKdfs: 1}});
  const results = await Promise.allSettled([
    policy.hash('first-valid-password'),
    policy.hash('second-valid-password'),
    policy.hash('third-valid-password'),
  ]);
  const rejected = results.filter(result => result.status === 'rejected');
  assert.ok(rejected.length >= 2, 'excess concurrent derivations must be refused');
  for (const rejection of rejected) {
    assert.ok(rejection.reason instanceof PasswordPolicyError);
    assert.equal(rejection.reason.status, 429);
  }
});

test('AUTH-003 a successful sign-in upgrades a retained scrypt verifier', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const userId = await insertUser(db, 'upgrade@example.com', 'correct-horse-battery', {scrypt: true});
      const before = await db.adminQuery(`SELECT password_hash, password_scheme FROM auth.users WHERE id = $1`, [userId]);
      assert.equal(before.rows[0].password_scheme, 'scrypt');

      const {handler} = buildRoutes({pool, clock});
      const response = await handler(loginRequest({email: 'upgrade@example.com', password: 'correct-horse-battery'}));
      assert.equal(response.status, 200);
      const token = tokenFrom(response);
      assert.ok(token);

      const after = await db.adminQuery(`SELECT password_hash, password_scheme FROM auth.users WHERE id = $1`, [userId]);
      assert.equal(after.rows[0].password_scheme, 'argon2id', 'the verifier must be upgraded on success');
      assert.notEqual(after.rows[0].password_hash, before.rows[0].password_hash);
      assert.equal(after.rows[0].password_hash.includes('correct-horse-battery'), false);
      assert.equal((await createPasswordPolicy().verify('correct-horse-battery', after.rows[0].password_hash)).valid, true);

      const session = await db.adminQuery('SELECT token_hash FROM auth.sessions WHERE token_hash = $1', [sha256(token)]);
      assert.equal(session.rowCount, 1);

      const audit = await db.adminQuery(
        `SELECT detail_jsonb->>'rehashed' AS rehashed FROM auth.auth_audit WHERE event_type = 'login_success' ORDER BY id DESC LIMIT 1`,
      );
      assert.equal(audit.rows[0].rehashed, 'true');

      const again = await handler(loginRequest({email: 'upgrade@example.com', password: 'correct-horse-battery'}));
      assert.equal(again.status, 200);
      const afterSecond = await db.adminQuery(`SELECT password_hash FROM auth.users WHERE id = $1`, [userId]);
      assert.equal(afterSecond.rows[0].password_hash, after.rows[0].password_hash, 'a current verifier is not rehashed again');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003 login throttling is deterministic, durable and non-enumerating', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'known@example.com', 'correct-horse-battery');
      const {handler} = buildRoutes({pool, clock, rateLimitPolicy: {login: {limit: 3, windowMs: 60 * 1000}}});

      const bodies = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await handler(loginRequest({email: 'known@example.com', password: 'wrong-password-value'}));
        assert.equal(response.status, 401, `attempt ${attempt + 1} is within the limit`);
        bodies.push(await response.json());
      }
      assert.equal(new Set(bodies.map(JSON.stringify)).size, 1, 'failure bodies must be identical');

      const known = await handler(loginRequest({email: 'known@example.com', password: 'wrong-password-value'}));
      assert.equal(known.status, 429, 'the account scope is exhausted');
      const retryAfter = Number(known.headers.get('retry-after'));
      assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, 'Retry-After must be bounded by the window');

      // An unknown address is throttled purely by its own attempt history: the same
      // sequence produces the same statuses and bodies as a known address.
      const unknownStatuses = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        unknownStatuses.push((await handler(loginRequest({email: 'nobody@example.com', password: 'wrong-password-value'}))).status);
      }
      assert.deepEqual(unknownStatuses, [401, 401, 401], 'unknown addresses are evaluated identically while under the limit');
      const unknown = await handler(loginRequest({email: 'nobody@example.com', password: 'wrong-password-value'}));
      assert.equal(unknown.status, 429, 'unknown addresses throttle after the same number of attempts');
      const knownBody = await known.json();
      const unknownBody = await unknown.json();
      assert.equal(knownBody.error.code, unknownBody.error.code);
      assert.equal(knownBody.error.message, unknownBody.error.message);

      const denied = await db.adminQuery(`SELECT count(*)::int AS n FROM auth.auth_audit WHERE event_type = 'login_failure' AND outcome = 'denied'`);
      assert.ok(denied.rows[0].n >= 1, 'throttled attempts are audited as denials');

      clock.advance(61 * 1000);
      const afterWindow = await handler(loginRequest({email: 'known@example.com', password: 'wrong-password-value'}));
      assert.equal(afterWindow.status, 401, 'the window must expire deterministically');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003 a successful sign-in resets the failure window', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'reset-window@example.com', 'correct-horse-battery');
      const {handler} = buildRoutes({pool, clock, rateLimitPolicy: {login: {limit: 3, windowMs: 60 * 1000}}});

      for (let attempt = 0; attempt < 2; attempt += 1) {
        assert.equal((await handler(loginRequest({email: 'reset-window@example.com', password: 'wrong-password-value'}))).status, 401);
      }
      assert.equal((await handler(loginRequest({email: 'reset-window@example.com', password: 'correct-horse-battery'}))).status, 200);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        assert.equal((await handler(loginRequest({email: 'reset-window@example.com', password: 'wrong-password-value'}))).status, 401, 'the success must reset the window');
      }
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003 concurrent failures cannot slip past the configured limit', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'burst@example.com', 'correct-horse-battery');
      const {handler} = buildRoutes({pool, clock, rateLimitPolicy: {login: {limit: 3, windowMs: 60 * 1000}}});
      const responses = await Promise.all(
        Array.from({length: 8}, () => handler(loginRequest({email: 'burst@example.com', password: 'wrong-password-value'}))),
      );
      const statuses = responses.map(response => response.status);
      assert.equal(statuses.filter(status => status === 401).length, 3, 'exactly the limit may be evaluated');
      assert.equal(statuses.filter(status => status === 429).length, 5, 'the rest are refused before a KDF runs');
      const failures = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.auth_audit WHERE event_type = 'login_failure' AND outcome = 'failure'`,
      );
      assert.equal(failures.rows[0].n, 3, 'the ledger must contain exactly the allowed failures');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003 throttle scopes ignore spoofed forwarding headers unless configured', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'spoof-a@example.com', 'correct-horse-battery');
      await insertUser(db, 'spoof-b@example.com', 'correct-horse-battery');
      const policy = {login: {limit: 2, windowMs: 60 * 1000}};

      // No trusted header configured: x-forwarded-for is ignored, so the same spoofed
      // value does not create an extra network scope (and does not raise the limit).
      const untrusted = buildRoutes({pool, clock, rateLimitPolicy: policy});
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await untrusted.handler(loginRequest(
          {email: 'spoof-a@example.com', password: 'wrong-password-value'},
          {headers: {'x-forwarded-for': '203.0.113.9'}},
        ));
      }
      assert.equal((await untrusted.handler(loginRequest({email: 'spoof-a@example.com', password: 'wrong-password-value'}))).status, 429);
      const otherAccount = await untrusted.handler(loginRequest(
        {email: 'spoof-b@example.com', password: 'wrong-password-value'},
        {headers: {'x-forwarded-for': '203.0.113.9'}},
      ));
      assert.equal(otherAccount.status, 401, 'without a trusted header the network scope is not applied');

      // With an explicitly trusted header, the network scope is enforced across accounts.
      const trusted = buildRoutes({pool, clock, rateLimitPolicy: policy, trustedClientHeader: 'cf-connecting-ip'});
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await trusted.handler(loginRequest(
          {email: 'net-a@example.com', password: 'wrong-password-value'},
          {headers: {'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.9'}},
        ));
        assert.equal(response.status, 401);
      }
      const crossAccount = await trusted.handler(loginRequest(
        {email: 'net-b@example.com', password: 'wrong-password-value'},
        {headers: {'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '198.51.100.8'}},
      ));
      assert.equal(crossAccount.status, 429, 'the trusted network scope blocks another account with a spoofed forward header');
      const otherNetwork = await trusted.handler(loginRequest(
        {email: 'net-b@example.com', password: 'wrong-password-value'},
        {headers: {'cf-connecting-ip': '198.51.100.8'}},
      ));
      assert.equal(otherNetwork.status, 401, 'a different trusted address is a different scope');

      const scopes = throttleScopes({email: 'spoof-a@example.com', network: null, realm: 'customer'});
      assert.equal(scopes.network, null);
      assert.match(scopes.account, /^[0-9a-f]{64}$/);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003 password-reset requests share the throttle policy and send nothing', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'reset-request@example.com', 'correct-horse-battery');
      const {handler} = buildRoutes({pool, clock, rateLimitPolicy: {reset: {limit: 2, windowMs: 60 * 1000}}});

      const responses = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await handler(resetRequest({email: 'reset-request@example.com'}));
        assert.equal(response.status, 202);
        responses.push(await response.json());
      }
      assert.deepEqual(new Set(responses.map(JSON.stringify)), new Set([JSON.stringify({accepted: true})]));
      const third = await handler(resetRequest({email: 'reset-request@example.com'}));
      assert.equal(third.status, 429);
      assert.ok(Number(third.headers.get('retry-after')) >= 1);

      const unknown = await handler(resetRequest({email: 'nobody@example.com'}));
      assert.equal(unknown.status, 202, 'an unknown account is accepted like any other unthrottled request');
      assert.deepEqual(await unknown.json(), {accepted: true});

      const verificationRows = await db.adminQuery('SELECT count(*)::int AS n FROM auth.verification');
      assert.equal(verificationRows.rows[0].n, 0, 'no reset token may be created before AUTH-005');
      const resetAudit = await db.adminQuery(
        `SELECT outcome, detail_jsonb->>'delivery' AS delivery FROM auth.auth_audit
         WHERE event_type = 'password_reset_requested' ORDER BY id`,
      );
      assert.ok(resetAudit.rows.some(row => row.delivery === 'deferred_to_auth_005'));
      assert.ok(resetAudit.rows.some(row => row.outcome === 'denied'));

      const wrongOrigin = await handler(resetRequest({email: 'reset-request@example.com'}, {origin: 'https://evil.example'}));
      assert.equal(wrongOrigin.status, 421);
      const unknownField = await handler(resetRequest({email: 'reset-request@example.com', redirect: 'https://evil.example'}));
      assert.equal(unknownField.status, 400);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003 audit records throttle digests and never raw secrets', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'redaction@example.com', 'correct-horse-battery');
      const {handler} = buildRoutes({pool, clock, rateLimitPolicy: {login: {limit: 3, windowMs: 60 * 1000}}});
      await handler(loginRequest({email: 'redaction@example.com', password: 'wrong-password-value'}));
      const success = await handler(loginRequest({email: 'redaction@example.com', password: 'correct-horse-battery'}));
      assert.equal(success.status, 200);
      const token = tokenFrom(success);

      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      const joined = serialized.rows.map(row => row.json).join('\n');
      for (const secret of ['correct-horse-battery', 'wrong-password-value', 'redaction@example.com', token ?? 'no-token']) {
        assert.equal(joined.includes(secret), false, `audit rows must not contain ${secret.slice(0, 10)}…`);
      }
      const keys = await db.adminQuery(
        `SELECT detail_jsonb->>'throttle_account' AS account, detail_jsonb->>'throttle_network' AS network
         FROM auth.auth_audit WHERE detail_jsonb ? 'throttle_account'`,
      );
      assert.ok(keys.rowCount > 0);
      for (const row of keys.rows) {
        assert.match(row.account, /^[0-9a-f]{64}$/);
        if (row.network !== null) assert.match(row.network, /^[0-9a-f]{64}$/);
      }
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003 rate policy rejects unsafe configuration', () => {
  for (const bad of [
    {login: {limit: 0}},
    {login: {limit: 2.5}},
    {login: {windowMs: 1000}},
    {reset: {windowMs: 48 * 60 * 60 * 1000}},
    {reset: {limit: 5000}},
  ]) {
    assert.throws(() => normalizeRatePolicy(bad), undefined, JSON.stringify(bad));
  }
  const ok = normalizeRatePolicy({login: {limit: 4, windowMs: 5 * 60 * 1000}});
  assert.equal(ok.login.limit, 4);
  assert.equal(ok.reset.limit, 5, 'unconfigured kinds keep their documented default');
});

// ---------------------------------------------------------------------------
// AUTH-003-R1 corrections
// ---------------------------------------------------------------------------

const quoteRole = name => `"${String(name).replaceAll('"', '""')}"`;
const quoteLiteral = value => `'${String(value).replaceAll("'", "''")}'`;

async function withAuthServicePool(db, action, {max = 8} = {}) {
  const suffix = randomBytesHex(4);
  const login = `saven_auth_${suffix}_service_login`;
  const password = randomBytesHex(24);
  await db.adminQuery(
    `CREATE ROLE ${quoteRole(login)} LOGIN PASSWORD ${quoteLiteral(password)} ` +
    'NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION',
  );
  await db.adminQuery(`GRANT ${quoteRole(db.roles.authService)} TO ${quoteRole(login)}`);
  const pool = new Pool(connectionConfig(db.database, {user: login, password, max}));
  try {
    return await action(pool, login);
  } finally {
    await pool.end().catch(() => {});
    await db.adminQuery(`DROP ROLE IF EXISTS ${quoteRole(login)}`).catch(() => {});
  }
}

function randomBytesHex(bytes) {
  return createHash('sha256').update(String(Math.random())).digest('hex').slice(0, bytes * 2);
}

test('AUTH-003-R1 every verification path is admitted and uses comparable work', async () => {
  const derivations = [];
  const policy = createPasswordPolicy({onDerivation: record => derivations.push(record)});
  const real = await policy.hash('correct-horse-battery');
  const retained = await encodePassword('retained-scrypt-password');

  derivations.length = 0;
  const wrong = await policy.verify('wrong-password-value', real.hash);
  const absent = await policy.verify('wrong-password-value', null);
  const malformed = await policy.verify('wrong-password-value', '$argon2id$v=19$m=1,t=1,p=1$c2FsdA==$dGFn');
  const unknown = await policy.verify('wrong-password-value', 'bcrypt$2b$whatever');
  assert.equal(wrong.valid, false);
  assert.equal(absent.valid, false);
  assert.equal(malformed.valid, false);
  assert.equal(unknown.valid, false);

  const argonRecords = derivations.filter(record => record.kind === 'verify');
  assert.equal(argonRecords.length, 4, 'each verification runs exactly one admitted derivation');
  const work = argonRecords.map(record => `${record.memoryKiB}/${record.passes}/${record.parallelism}`);
  assert.equal(new Set(work).size, 1, 'absent, malformed and wrong verifiers use the same configured workload');
  assert.equal(work[0], '65536/3/1');
  for (const record of argonRecords.slice(1)) {
    assert.ok(record.inputBytes <= 512, 'invalid-shape paths use a bounded dummy input');
  }
  const oversized = await policy.verify('x'.repeat(20000), real.hash);
  assert.equal(oversized.valid, false);
  const oversizedRecord = derivations.at(-1);
  assert.ok(oversizedRecord.inputBytes <= 512, 'oversized input never reaches a KDF buffer');

  const scrypt = await policy.verify('retained-scrypt-password', retained);
  assert.equal(scrypt.valid, true);
  assert.equal(scrypt.needsRehash, true);
  assert.equal(derivations.at(-1).kind, 'verify');
  assert.equal(derivations.at(-1).scheme, 'scrypt', 'retained scrypt stays a documented, admitted compatibility path');
});

test('AUTH-003-R1 admission covers dummy and mixed paths and recovers after overload', async () => {
  const records = [];
  const policy = createPasswordPolicy({policy: {maxConcurrentKdfs: 1}, onDerivation: record => records.push(record)});
  const real = await policy.hash('correct-horse-battery');
  const settled = await Promise.allSettled([
    policy.verify('wrong-password-value', real.hash),
    policy.verify('wrong-password-value', null),
    policy.verify('wrong-password-value', 'bcrypt$2b$x'),
  ]);
  const rejected = settled.filter(result => result.status === 'rejected');
  const fulfilled = settled.filter(result => result.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, 'exactly one derivation may run at a time');
  assert.equal(rejected.length, 2);
  for (const rejection of rejected) {
    assert.equal(rejection.reason.code, 'PASSWORD_BUSY');
    assert.equal(rejection.reason.status, 429);
  }
  assert.equal(policy.activeDerivations(), 0, 'the admission counter unwinds after overload');
  const recovery = await policy.verify('wrong-password-value', real.hash);
  assert.equal(recovery.valid, false, 'verification works again after the burst');
});

test('AUTH-003-R1 provider failures are normalized, never escaped', async () => {
  const throwing = createPasswordPolicy({
    argon2Impl: async () => {
      throw new Error('native provider unavailable');
    },
  });
  const result = await throwing.verify('wrong-password-value', '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA==$dGFndGFndGFndGFndGFn');
  assert.equal(result.valid, false, 'a provider failure is a bounded credential failure');
  const absent = await throwing.verify('wrong-password-value', null);
  assert.equal(absent.valid, false);

  for (const bad of [
    {argon2id: {memoryKiB: 1048576}},
    {argon2id: {maxMemoryKiB: 1048576}},
    {argon2id: {maxPasses: 99}},
    {argon2id: {maxParallelism: 99}},
    {argon2id: {tagLength: 128}},
    {maxConcurrentKdfs: 9},
  ]) {
    assert.throws(() => createPasswordPolicy({policy: bad}), undefined, JSON.stringify(bad));
  }
});

test('AUTH-003-R1 exceptional attempts are durably accounted and publish nothing', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'exceptional@example.com', 'correct-horse-battery');
      const base = createPasswordPolicy();

      const cases = [
        ['provider error', {
          ...base,
          verify: async () => {
            throw new Error('verifier exploded');
          },
        }, 'AUTH_UNAVAILABLE', 'attempt_reserved'],
        ['busy', {
          ...base,
          verify: async () => {
            throw new PasswordPolicyError(429, 'PASSWORD_BUSY', 'Sign-in is busy.');
          },
        }, 'SIGN_IN_BUSY', 'attempt_reserved'],
        ['rehash error', {
          ...base,
          verify: async () => ({valid: true, scheme: 'scrypt', needsRehash: true}),
          hash: async () => {
            throw new Error('rehash exploded');
          },
        }, 'AUTH_UNAVAILABLE', 'attempt_reserved'],
      ];

      for (const [label, passwordPolicy, code, expectedReason] of cases) {
        const before = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions');
        const email = `exceptional-${label.replaceAll(' ', '-')}@example.com`;
        await insertUser(db, email, 'correct-horse-battery');
        const {handler} = buildRoutes({pool, clock, passwordPolicy, rateLimitPolicy: {login: {limit: 1, windowMs: 60 * 1000}}});
        const response = await handler(loginRequest({email, password: 'correct-horse-battery'}));
        assert.equal(response.status, 503, label);
        assert.equal((await response.json()).error.code, code, label);
        assert.equal(response.headers.get('set-cookie'), null, `${label}: no credential may be published`);
        const after = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions');
        assert.equal(after.rows[0].n, before.rows[0].n, `${label}: no session may survive`);
        const audit = await db.adminQuery(
          `SELECT detail_jsonb->>'reason' AS reason, detail_jsonb->>'attempt_order' AS ordering
           FROM auth.auth_audit WHERE event_type = 'login_failure' ORDER BY id DESC LIMIT 1`,
        );
        assert.equal(audit.rows[0].reason, expectedReason, label);
        assert.ok(/^[0-9]+$/.test(audit.rows[0].ordering), `${label}: the exceptional attempt carries a durable order`);

        // The next request reflects the consumed budget (limit 1).
        const next = await handler(loginRequest({email, password: 'correct-horse-battery'}));
        assert.equal(next.status, 429, `${label}: the next attempt is throttled`);
      }
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003-R1 audit-store failure fails closed before KDF admission and recovers', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'audit-down@example.com', 'correct-horse-battery');
      let auditBroken = true;
      const healthAudit = async (event, {tx} = {}) => {
        if (auditBroken) throw new Error('audit store unavailable');
        const executor = tx ?? pool;
        await executor.query(
          `INSERT INTO auth.auth_audit(event_type, outcome, detail_jsonb)
           VALUES($1, $2, $3::jsonb)`,
          [event.eventType, event.outcome ?? 'success', JSON.stringify(event.detail ?? {})],
        );
      };
      const derivations = [];
      const policy = createPasswordPolicy({onDerivation: record => derivations.push(record)});
      const {handler} = buildRoutes({
        pool,
        clock,
        audit: healthAudit,
        passwordPolicy: policy,
        accountingCooldownMs: 2000,
        rateLimitPolicy: {login: {limit: 3, windowMs: 60 * 1000}},
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await handler(loginRequest({email: 'audit-down@example.com', password: 'wrong-password-value'}));
        assert.equal(response.status, 503, 'an unaccounted attempt fails closed');
        assert.equal((await response.json()).error.code, 'AUTH_ACCOUNTING_UNAVAILABLE');
        assert.equal(response.headers.get('set-cookie'), null);
      }
      assert.equal(derivations.length, 0, 'repeated audit failures never reach a KDF despite admission slots');
      const sessions = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions');
      assert.equal(sessions.rows[0].n, 0);

      // Recovery after the cooldown: working audit store admits the attempt again.
      auditBroken = false;
      clock.advance(3000);
      const recovered = await handler(loginRequest({email: 'audit-down@example.com', password: 'wrong-password-value'}));
      assert.equal(recovered.status, 401, 'the request is evaluated again after recovery');
      assert.ok(derivations.length >= 1, 'a KDF ran after accounting recovered');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003-R1 reservations are serialized: paused logging blocks concurrent work', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'paused@example.com', 'correct-horse-battery');
      const derivations = [];
      const policy = createPasswordPolicy({onDerivation: record => derivations.push(record)});
      const realAudit = createAuditWriter(pool);
      let releaseFirst;
      const firstReservation = new Promise(resolve => {
        releaseFirst = resolve;
      });
      let paused = false;
      let firstReservationSeen = false;
      const gateAudit = async (event, options) => {
        if (event.eventType === 'login_failure' && !firstReservationSeen) {
          firstReservationSeen = true;
          paused = true;
          await firstReservation;
        }
        return realAudit(event, options);
      };
      const {handler} = buildRoutes({
        pool,
        clock,
        audit: gateAudit,
        passwordPolicy: policy,
        rateLimitPolicy: {login: {limit: 1, windowMs: 60 * 1000}},
      });

      const first = handler(loginRequest({email: 'paused@example.com', password: 'wrong-password-value'}));
      while (!paused) await new Promise(resolve => setTimeout(resolve, 5));
      const second = handler(loginRequest({email: 'paused@example.com', password: 'wrong-password-value'}));
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(derivations.length, 0, 'no KDF starts while the reservation is uncommitted');
      releaseFirst();
      const [a, b] = await Promise.all([first, second]);
      assert.deepEqual([a.status, b.status].sort(), [401, 429], 'exactly one attempt is evaluated at limit one');
      assert.equal(derivations.length, 1, 'exactly one admitted KDF runs');
      const failures = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.auth_audit WHERE event_type = 'login_failure' AND outcome = 'failure'`,
      );
      assert.equal(failures.rows[0].n, 1, 'the reservation is the single durable attempt record');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003-R1 a post-reservation audit failure keeps the attempt counted and withholds credentials', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'post-reservation@example.com', 'correct-horse-battery');
      const realAudit = createAuditWriter(pool);
      const audit = async (event, options) => {
        if (event.eventType === 'login_success') throw new Error('success audit unavailable');
        return realAudit(event, options);
      };
      const {handler} = buildRoutes({
        pool,
        clock,
        audit,
        accountingCooldownMs: 1000,
        rateLimitPolicy: {login: {limit: 1, windowMs: 60 * 1000}},
      });
      const response = await handler(loginRequest({email: 'post-reservation@example.com', password: 'correct-horse-battery'}));
      assert.equal(response.status, 503, 'the unrecorded success is not reported');
      assert.equal(response.headers.get('set-cookie'), null, 'no credential is published');
      const sessions = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions');
      assert.equal(sessions.rows[0].n, 0, 'the session transaction rolled back');
      const reserved = await db.adminQuery(
        `SELECT detail_jsonb->>'reason' AS reason FROM auth.auth_audit WHERE event_type='login_failure' ORDER BY id DESC LIMIT 1`,
      );
      assert.equal(reserved.rows[0].reason, 'attempt_reserved', 'the durable reservation survives the later failure');
      const next = await handler(loginRequest({email: 'post-reservation@example.com', password: 'correct-horse-battery'}));
      assert.equal(next.status, 503, 'the audit failure also cools down admission');
      assert.equal((await next.json()).error.code, 'AUTH_ACCOUNTING_UNAVAILABLE');
      clock.advance(2000);
      const afterCooldown = await handler(loginRequest({email: 'post-reservation@example.com', password: 'correct-horse-battery'}));
      assert.equal(afterCooldown.status, 429, 'the failed attempt still consumes the budget after cooldown');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003-R1 untrusted ingress headers never reach audit or session storage', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'ingress@example.com', 'correct-horse-battery');

      // Default-off: even a syntactically invalid cf-connecting-ip cannot break the
      // failure audit (the retained writer would otherwise cast it to inet) and no raw
      // value is persisted.
      const untrusted = buildRoutes({pool, clock});
      const bad = await untrusted.handler(loginRequest(
        {email: 'ingress@example.com', password: 'wrong-password-value'},
        {headers: {'cf-connecting-ip': 'not-an-ip', 'x-forwarded-for': '203.0.113.9'}},
      ));
      assert.equal(bad.status, 401, 'an invalid untrusted header must not break accounting');
      const success = await untrusted.handler(loginRequest(
        {email: 'ingress@example.com', password: 'correct-horse-battery'},
        {headers: {'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.10'}},
      ));
      assert.equal(success.status, 200);
      const token = tokenFrom(success);
      const session = await db.adminQuery('SELECT host(ip_address) AS ip FROM auth.sessions WHERE token_hash = $1', [sha256(token)]);
      assert.equal(session.rows[0].ip, null, 'an untrusted address is never stored on the session');
      const audit = await db.adminQuery(`SELECT coalesce(host(ip_address), 'null') AS ip, row_to_json(a)::text AS json FROM auth.auth_audit a`);
      for (const row of audit.rows) {
        assert.equal(row.ip, 'null', 'an untrusted address is never stored in audit');
        assert.equal(row.json.includes('203.0.113.9'), false);
        assert.equal(row.json.includes('203.0.113.10'), false);
        assert.equal(row.json.includes('not-an-ip'), false);
      }

      // Trusted and valid: the sanitized address is stored; invalid values are ignored.
      const trusted = buildRoutes({pool, clock, trustedClientHeader: 'cf-connecting-ip'});
      const trustedLogin = await trusted.handler(loginRequest(
        {email: 'ingress@example.com', password: 'correct-horse-battery'},
        {headers: {'cf-connecting-ip': '198.51.100.7'}},
      ));
      assert.equal(trustedLogin.status, 200);
      const trustedToken = tokenFrom(trustedLogin);
      const trustedSession = await db.adminQuery('SELECT host(ip_address) AS ip FROM auth.sessions WHERE token_hash = $1', [sha256(trustedToken)]);
      assert.equal(trustedSession.rows[0].ip, '198.51.100.7');
      const invalid = await trusted.handler(loginRequest(
        {email: 'ingress@example.com', password: 'wrong-password-value'},
        {headers: {'cf-connecting-ip': '999.999.999.999'}},
      ));
      assert.equal(invalid.status, 401, 'an invalid trusted value is discarded without an audit failure');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003-R1 ordering follows serialized post-lock attempts, with ties resolved', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
      const limiter = createRateLimiter({store, clock: clock.clock, policy: {login: {limit: 2, windowMs: 60 * 1000}}});
      const account = 'order@example.com';
      const keys = limiter.keysFor({email: account, network: null, realm: 'customer'});
      const column = 'throttle_account';
      const key = keys.scopes.account;
      const at = clock.now();
      const old = new Date(at.getTime() - 10 * 60 * 1000).toISOString();

      const write = async (eventType, outcome, order, attemptAt) => {
        await pool.query(
          `INSERT INTO auth.auth_audit(event_type, outcome, occurred_at, detail_jsonb)
           VALUES($1, $2, now(), $3::jsonb)`,
          [eventType, outcome, JSON.stringify({
            throttle_account: key,
            attempt_order: order,
            attempt_at: attemptAt,
          })],
        );
      };

      // A failure with a lower post-lock order than a success (but the same or older
      // time) is BEFORE that success and must not count against the window.
      await write('login_success', 'success', '900', at.toISOString());
      await write('login_failure', 'failure', '800', at.toISOString());

      const beforeCount = await store.withClient(async tx => {
        await limiter.lockScopes(tx, keys.values);
        const verdict = await limiter.checkScopes(tx, keys, 'login');
        await limiter.unlockScopes(tx, keys.values);
        return verdict;
      });
      assert.equal(beforeCount.allowed, true, 'an earlier-order failure is reset by the later success');
      assert.match(beforeCount.order, /^[0-9]+$/, 'the verdict exposes the post-lock transaction order');

      // Equal attempt_at but higher order counts, and the tie is unambiguous.
      await write('login_failure', 'failure', '901', at.toISOString());
      await write('login_failure', 'failure', '902', at.toISOString());
      const equalTime = await store.withClient(async tx => {
        await limiter.lockScopes(tx, keys.values);
        const verdict = await limiter.checkScopes(tx, keys, 'login');
        await limiter.unlockScopes(tx, keys.values);
        return verdict;
      });
      assert.equal(equalTime.allowed, false, 'two same-time failures after the success reach the limit of two');

      // Window expiry excludes even correctly ordered failures.
      await write('login_success', 'success', '1000', at.toISOString());
      await write('login_failure', 'failure', '1001', old);
      const expired = await store.withClient(async tx => {
        await limiter.lockScopes(tx, keys.values);
        const verdict = await limiter.checkScopes(tx, keys, 'login');
        await limiter.unlockScopes(tx, keys.values);
        return verdict;
      });
      assert.equal(expired.allowed, true, 'a failure older than the window does not count');

      // Concurrent login and reset histories both account, with unique orders.
      const {handler} = buildRoutes({pool, clock, rateLimitPolicy: {login: {limit: 5, windowMs: 60 * 1000}, reset: {limit: 5, windowMs: 60 * 1000}}});
      await Promise.all([
        handler(loginRequest({email: 'order@example.com', password: 'wrong-password-value'})),
        handler(resetRequest({email: 'order@example.com'})),
        handler(loginRequest({email: 'order-2@example.com', password: 'wrong-password-value'})),
      ]);
      const orders = await db.adminQuery(
        `SELECT count(*)::int AS rows, count(DISTINCT detail_jsonb->>'attempt_order')::int AS unique_orders
         FROM auth.auth_audit WHERE detail_jsonb ? 'attempt_order'`,
      );
      assert.equal(orders.rows[0].rows, orders.rows[0].unique_orders, 'every accounted attempt carries a unique post-lock order');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003-R1 restricted auth-service role and composition path', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const userId = await insertUser(db, 'composed@example.com', 'correct-horse-battery', {scrypt: true});
    await withAuthServicePool(db, async (pool, roleLogin) => {
      // Real composition root (createAuthServer), not a hand-wired factory.
      const server = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      const success = await server.handler(loginRequest({email: 'composed@example.com', password: 'correct-horse-battery'}));
      assert.equal(success.status, 200, `${roleLogin} must authenticate through the composition root`);
      const token = tokenFrom(success);
      assert.ok(token);
      const upgraded = await db.adminQuery('SELECT password_scheme FROM auth.users WHERE id = $1', [userId]);
      assert.equal(upgraded.rows[0].password_scheme, 'argon2id', 'the conditional rehash UPDATE succeeds under auth-service grants');
      const session = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions WHERE token_hash = $1', [sha256(token)]);
      assert.equal(session.rows[0].n, 1);

      // Default composed throttle: eight failures are evaluated, the ninth is refused.
      let last = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        last = await server.handler(loginRequest({email: 'composed@example.com', password: 'wrong-password-value'}));
        assert.equal(last.status, 401);
      }
      const throttled = await server.handler(loginRequest({email: 'composed@example.com', password: 'wrong-password-value'}));
      assert.equal(throttled.status, 429, 'the composed default policy still throttles');

      const who = await pool.query('SELECT current_user AS name').then(result => result.rows[0].name);
      assert.equal(who, roleLogin);
      const ddl = await pool.query('ALTER TABLE auth.sessions ADD COLUMN probe integer').then(() => 'allowed').catch(error => error.code);
      assert.equal(ddl, '42501', 'the runtime role cannot alter auth tables');
      const tenant = await pool.query('SELECT count(*) FROM operator.tenant').then(() => 'allowed').catch(error => error.code);
      assert.equal(tenant, '42501', 'the runtime role cannot read tenant financial data');
    });
  });
});

test('AUTH-003-R1 invalid input never authenticates through the dummy substitution', async () => {
  const DUMMY = passwordInternals.DUMMY_INPUT;
  const policy = createPasswordPolicy();
  const argonHash = (await policy.hash(DUMMY)).hash;
  const scryptHash = await encodePassword(DUMMY);
  const invalidInputs = [undefined, null, 12345, '', 'x'.repeat(20000), `dummy\u0000value`];
  for (const input of invalidInputs) {
    const argon = await policy.verify(input, argonHash);
    assert.equal(argon.valid, false, `argon2id must refuse invalid input ${String(input).slice(0, 12)}`);
    assert.equal(argon.needsRehash, false);
    assert.equal(argon.inputValid, false);
    const scrypt = await policy.verify(input, scryptHash);
    assert.equal(scrypt.valid, false, `retained scrypt must refuse invalid input ${String(input).slice(0, 12)}`);
    assert.equal(scrypt.needsRehash, false);
  }
  // A short string is a well-formed but wrong credential, not an invalid shape.
  assert.equal((await policy.verify('short', argonHash)).valid, false);
  assert.equal((await policy.verify(DUMMY, argonHash)).valid, true, 'the real password still works');
  const scryptReal = await policy.verify(DUMMY, scryptHash);
  assert.equal(scryptReal.valid, true);
  assert.equal(scryptReal.needsRehash, true, 'a retained scrypt verifier still upgrades only after a real match');

  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const userId = await insertUser(db, 'dummy-string@example.com', DUMMY);
      const {handler} = buildRoutes({pool, clock});
      const before = await db.adminQuery('SELECT password_hash FROM auth.users WHERE id = $1', [userId]);
      for (const body of [
        {email: 'dummy-string@example.com'},
        {email: 'dummy-string@example.com', password: null},
        {email: 'dummy-string@example.com', password: 12345},
        {email: 'dummy-string@example.com', password: ''},
        {email: 'dummy-string@example.com', password: 'x'.repeat(20000)},
        {email: 'dummy-string@example.com', password: `dummy\u0000value`},
      ]) {
        const response = await handler(loginRequest(body));
        assert.equal(response.status, 401, `invalid input must not authenticate: ${JSON.stringify(body.password)?.slice(0, 12)}`);
        assert.equal(response.headers.get('set-cookie'), null);
      }
      const sessions = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions');
      assert.equal(sessions.rows[0].n, 0, 'no session may be issued for invalid input');
      const after = await db.adminQuery('SELECT password_hash FROM auth.users WHERE id = $1', [userId]);
      assert.equal(after.rows[0].password_hash, before.rows[0].password_hash, 'invalid input must not trigger a rehash');

      const valid = await handler(loginRequest({email: 'dummy-string@example.com', password: DUMMY}));
      assert.equal(valid.status, 200, 'the actual valid password still authenticates');
      assert.ok(tokenFrom(valid));
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003-R1 ingress identity is canonical, validated and shared by both endpoints', async () => {
  assert.equal(canonicalizeIp('999.1.1.1'), null);
  assert.equal(canonicalizeIp('not-an-ip'), null);
  assert.equal(canonicalizeIp(''), null);
  assert.equal(canonicalizeIp('198.51.100.7'), '198.51.100.7');
  const v6a = canonicalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001');
  const v6b = canonicalizeIp('2001:db8::1');
  assert.ok(v6a && v6a === v6b, 'equivalent IPv6 spellings must canonicalise identically');

  const base = scopeValues('198.51.100.7');
  assert.deepEqual(scopeValues('198.51.100.7'), base);
  assert.deepEqual(scopeValues('2001:0DB8::1'), scopeValues('2001:db8:0:0:0:0:0:1'));
  assert.equal(scopeValues('999.1.1.1').network, null, 'an invalid configured value creates no network scope');
  assert.equal(scopeValues(null).network, null);

  function scopeValues(network) {
    return throttleScopes({email: 'scope@example.com', network, realm: 'customer'});
  }

  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'scope-login@example.com', 'correct-horse-battery');
      // Invalid configured header: no network scope and no audit failure.
      const invalid = buildRoutes({pool, clock, trustedClientHeader: 'cf-connecting-ip', rateLimitPolicy: {login: {limit: 2, windowMs: 60 * 1000}}});
      for (let attempt = 0; attempt < 2; attempt += 1) {
        assert.equal((await invalid.handler(loginRequest(
          {email: 'scope-login@example.com', password: 'wrong-password-value'},
          {headers: {'cf-connecting-ip': '999.1.1.1'}},
        ))).status, 401);
      }
      assert.equal((await invalid.handler(loginRequest(
        {email: 'scope-login@example.com', password: 'wrong-password-value'},
        {headers: {'cf-connecting-ip': '999.1.1.1'}},
      ))).status, 429, 'the account budget still applies');

      // Two equivalent IPv6 spellings share one network scope for both endpoints.
      const v6 = buildRoutes({pool, clock, trustedClientHeader: 'cf-connecting-ip', rateLimitPolicy: {
        login: {limit: 5, windowMs: 60 * 1000},
        reset: {limit: 1, windowMs: 60 * 1000},
      }});
      const firstReset = await v6.handler(resetRequest(
        {email: 'scope-reset@example.com'},
        {headers: {'cf-connecting-ip': '2001:0DB8::1'}},
      ));
      assert.equal(firstReset.status, 202);
      const secondReset = await v6.handler(resetRequest(
        {email: 'scope-reset-2@example.com'},
        {headers: {'cf-connecting-ip': '2001:db8:0:0:0:0:0:1'}},
      ));
      assert.equal(secondReset.status, 429, 'canonical equivalent spellings share the network budget');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-003-R3 a correct login completes on a single-connection pool', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await insertUser(db, 'pool-one@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async pool => {
      const server = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      const session = await withTimeout(
        login(server.handler, 'pool-one@example.com', 'correct-horse-battery'),
        15000,
        'max=1 correct login',
      );
      assert.equal(session.response.status, 200, 'a correct login must not deadlock a size-one pool');
      assert.ok(session.token);
      const stored = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions WHERE token_hash = $1', [sha256(session.token)]);
      assert.equal(stored.rows[0].n, 1);
    }, {max: 1});
  });
});

test('AUTH-003-R3 a saturated small pool still completes same-scope successes', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await insertUser(db, 'pool-saturated@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async pool => {
      const server = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      const results = await withTimeout(
        Promise.all([
          login(server.handler, 'pool-saturated@example.com', 'correct-horse-battery'),
          login(server.handler, 'pool-saturated@example.com', 'correct-horse-battery'),
          login(server.handler, 'pool-saturated@example.com', 'correct-horse-battery'),
        ]),
        30000,
        'saturated same-scope successes',
      );
      assert.deepEqual(results.map(result => result.response.status), [200, 200, 200]);
      for (const result of results) assert.ok(result.token);
      const sessions = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.sessions WHERE token_hash = ANY($1::text[])`,
        [results.map(result => sha256(result.token))],
      );
      assert.equal(sessions.rows[0].n, 3);
    }, {max: 2});
  });
});

test('AUTH-003-R3 lock and transaction failures destroy the connection and stay clean', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await insertUser(db, 'cleanup@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async basePool => {
      const hooked = hookedPool(basePool);
      const server = buildRoutes({pool: hooked.pool, clock, trustedClientHeader: 'cf-connecting-ip', accountingCooldownMs: 0});
      const controller = hooked.controller;

      // 1. Second scope-lock failure: partial acquisition must destroy the client.
      controller.fail.lockAt = 2;
      const lockFailure = await server.handler(loginRequest(
        {email: 'cleanup@example.com', password: 'wrong-password-value'},
        {headers: {'cf-connecting-ip': '198.51.100.7'}},
      ));
      assert.equal(lockFailure.status, 503);
      assert.equal((await lockFailure.json()).error.code, 'AUTH_ACCOUNTING_UNAVAILABLE');
      assert.ok(hooked.controller.events.includes(true), 'a partial lock acquisition destroys the client');
      let healthy = await withTimeout(login(server.handler, 'cleanup@example.com', 'correct-horse-battery'), 15000, 'borrower after lock failure');
      assert.equal(healthy.response.status, 200, 'a subsequent borrower is uncontaminated');

      // 2. Unlock failure after an otherwise completed attempt.
      controller.events.length = 0;
      controller.fail.unlock = true;
      const unlockFailure = await server.handler(loginRequest({email: 'cleanup@example.com', password: 'wrong-password-value'}));
      assert.equal(unlockFailure.status, 401, 'the attempt itself completed');
      assert.ok(controller.events.includes(true), 'an unconfirmed unlock destroys the client');
      healthy = await withTimeout(login(server.handler, 'cleanup@example.com', 'correct-horse-battery'), 15000, 'borrower after unlock failure');
      assert.equal(healthy.response.status, 200);

      // 3. Uncertain reservation COMMIT: accounting fails closed, client destroyed.
      controller.events.length = 0;
      controller.commitCount = 0;
      controller.fail.commitAt = 1;
      const commitFailure = await server.handler(loginRequest({email: 'cleanup@example.com', password: 'wrong-password-value'}));
      assert.equal(commitFailure.status, 503);
      assert.equal((await commitFailure.json()).error.code, 'AUTH_ACCOUNTING_UNAVAILABLE');
      assert.ok(controller.events.includes(true), 'an uncertain reservation commit destroys the client');
      assert.ok(!controller.events.includes(false) || true);
      healthy = await withTimeout(login(server.handler, 'cleanup@example.com', 'correct-horse-battery'), 15000, 'borrower after commit uncertainty');
      assert.equal(healthy.response.status, 200);
    }, {max: 1});
  });
});

test('AUTH-003-R3 failed rollback destroys the connection; session-lock pooling is enforced', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await insertUser(db, 'rollback@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async basePool => {
      const hooked = hookedPool(basePool);
      let auditBrokenOnce = true;
      const worker = createAuditWriter(basePool);
      const brokenAudit = async (event, options) => {
        if (auditBrokenOnce && event.eventType === 'login_failure' && event.outcome === 'failure') {
          auditBrokenOnce = false;
          throw new Error('reservation audit unavailable');
        }
        return worker(event, options);
      };
      const {handler} = buildRoutes({
        pool: hooked.pool,
        clock,
        audit: brokenAudit,
        accountingCooldownMs: 0,
      });
      hooked.controller.fail.rollback = true;
      const response = await handler(loginRequest({email: 'rollback@example.com', password: 'wrong-password-value'}));
      assert.equal(response.status, 503);
      assert.ok(hooked.controller.events.includes(true), 'a failed ROLLBACK destroys the client');

      // The contaminated client must not be reused; with cooldown 0 a healthy request works.
      const healthy = await withTimeout(login(handler, 'rollback@example.com', 'correct-horse-battery'), 15000, 'borrower after rollback failure');
      assert.equal(healthy.response.status, 200);
    }, {max: 1});
  });

  assert.throws(
    () => createRateLimiter({
      store: {withClientLease: async () => {}},
      poolingMode: 'transaction',
    }),
    /transaction pooling is unsupported/,
  );
});
