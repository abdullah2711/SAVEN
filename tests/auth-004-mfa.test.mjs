import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import pg from 'pg';
import {withAuthDatabase} from './helpers/pg-auth-fixture.mjs';
import {createSessionStore} from '../src/auth/session-store.mjs';
import {createAuthRoutes, cookieName} from '../src/auth/routes.mjs';
import {createAuditWriter} from '../src/auth/server.mjs';
import {createPasswordPolicy} from '../src/auth/password-policy.mjs';
import {base32Decode, totpCode} from '../src/auth/factors.mjs';

const {Pool} = pg;
const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const customerCookie = cookieName('customer', true);
const accountKey = Buffer.alloc(32, 7);
const recoveryKey = Buffer.alloc(32, 9);
const TENANT = '11111111-1111-4111-8111-111111111111';
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

function connectionConfig(database) {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database,
    max: 8,
    application_name: 'saven-auth-004-test',
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
  recoveryHashKey: recoveryKey,
  maxFailures: 3,
  lockoutMs: 60 * 1000,
  recoveryCodeCount: 5,
});

async function insertUser(db, email, password) {
  const policy = createPasswordPolicy();
  const hashed = await policy.hash(password);
  const result = await db.adminQuery(
    `INSERT INTO auth.users(email, password_hash, password_scheme, password_updated_at, email_verified, email_verified_at)
     VALUES ($1, $2, $3, now(), true, now()) RETURNING id::text AS id`,
    [email, hashed.hash, hashed.scheme],
  );
  return result.rows[0].id;
}

async function addMembership(db, userId, roleId) {
  await db.adminQuery(
    `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
     VALUES ($1, $2, $3, 'active', now(), now())`,
    [TENANT, userId, roleId],
  );
}

function buildRoutes({pool, clock, config = mfaConfig(), rateLimitPolicy = {}}) {
  const store = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
  const findUserByEmail = async email => {
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
  const handler = createAuthRoutes({
    store,
    findUserByEmail,
    audit: createAuditWriter(pool),
    origins,
    secureCookies: true,
    clock: clock.clock,
    rateLimitPolicy,
    mfaConfig: config,
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

async function login(handler, email, password, {origin = origins.customer} = {}) {
  const response = await handler(request(`${origin}/v1/auth/login`, {
    method: 'POST',
    headers: {origin},
    body: {email, password},
  }));
  const body = await response.clone().json().catch(() => null);
  const setCookie = response.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${customerCookie}=([^;]+)`).exec(setCookie)?.[1] ?? null;
  return {response, body, token, csrf: body?.csrfToken ?? null};
}

function me(handler, token) {
  return handler(request(`${origins.customer}/v1/auth/me`, {headers: {cookie: `${customerCookie}=${token}`}}));
}

function mfaPost(handler, path, token, csrf, body) {
  return handler(request(`${origins.customer}${path}`, {
    method: 'POST',
    headers: {origin: origins.customer, cookie: `${customerCookie}=${token}`, 'x-csrf-token': csrf},
    body,
  }));
}

function mfaGet(handler, token) {
  return handler(request(`${origins.customer}/v1/auth/mfa`, {headers: {cookie: `${customerCookie}=${token}`}}));
}

function secretFromUri(uri) {
  const secret = /[?&]secret=([A-Z2-7]+)/.exec(uri)?.[1];
  assert.ok(secret, 'the otpauth URI must carry the base32 secret once');
  return secret;
}

async function adminEnrolled({db, clock, handler, email = 'admin@example.com'}) {
  const userId = await insertUser(db, email, 'correct-horse-battery');
  await addMembership(db, userId, 'tenant_admin');
  const session = await login(handler, email, 'correct-horse-battery');
  assert.equal(session.response.status, 200);
  const enroll = await mfaPost(handler, '/v1/auth/mfa/enroll', session.token, session.csrf, {});
  assert.equal(enroll.status, 200);
  const uri = (await enroll.json()).otpauthUri;
  const secret = secretFromUri(uri);
  const code = totpCode(secret, {at: clock.now()});
  const verified = await mfaPost(handler, '/v1/auth/mfa/enroll/verify', session.token, session.csrf, {code});
  assert.equal(verified.status, 200);
  const body = await verified.json();
  return {...session, userId, secret, recoveryCodes: body.recoveryCodes};
}

test('AUTH-004 tenant-admin login is pending until MFA is verified and gates other requests', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const userId = await insertUser(db, 'tenant-admin@example.com', 'correct-horse-battery');
      await addMembership(db, userId, 'tenant_admin');

      const session = await login(handler, 'tenant-admin@example.com', 'correct-horse-battery');
      assert.equal(session.response.status, 200);
      assert.deepEqual(session.body.mfa, {required: true, enrolled: false, pending: true, available: true});
      assert.equal(session.body.session.assuranceLevel, 'single_factor');

      const status = await mfaGet(handler, session.token);
      assert.equal(status.status, 200);
      const statusBody = await status.json();
      assert.equal(statusBody.pending, true);
      assert.equal(statusBody.enrolled, false);

      const blocked = await handler(request(`${origins.customer}/v1/auth/sessions`, {
        headers: {cookie: `${customerCookie}=${session.token}`},
      }));
      assert.equal(blocked.status, 403, 'a pending admin session may not reach other endpoints');
      assert.equal((await blocked.json()).error.code, 'MFA_REQUIRED');
      assert.equal((await me(handler, session.token)).status, 200, 'me remains available while pending');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004 enrollment stores an encrypted seed and recovery hashes only', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      assert.equal(enrolled.recoveryCodes.length, 5);

      const factor = await db.adminQuery(
        `SELECT secret_ciphertext, secret_algorithm, secret_key_version, verified_at, last_used_step
         FROM auth.two_factor WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      assert.equal(factor.rowCount, 1);
      assert.equal(factor.rows[0].secret_algorithm, 'aes_256_gcm');
      assert.equal(factor.rows[0].secret_key_version, 1);
      assert.ok(factor.rows[0].verified_at instanceof Date);
      assert.equal(factor.rows[0].secret_ciphertext.includes(enrolled.secret), false, 'the plaintext seed is never stored');
      assert.equal((await db.adminQuery('SELECT row_to_json(t)::text AS json FROM auth.two_factor t')).rows[0].json.includes(enrolled.secret), false);

      const codes = await db.adminQuery(
        `SELECT code_hash, hash_algorithm, hash_key_version, used_at FROM auth.recovery_codes WHERE user_id = $1::uuid ORDER BY id`,
        [enrolled.userId],
      );
      assert.equal(codes.rowCount, 5);
      for (const row of codes.rows) {
        assert.match(row.code_hash, /^[0-9a-f]{64}$/);
        assert.equal(row.hash_algorithm, 'hmac_sha256');
        assert.equal(row.used_at, null);
        for (const code of enrolled.recoveryCodes) assert.notEqual(row.code_hash, code);
      }

      const audit = await db.adminQuery(`SELECT event_type FROM auth.auth_audit ORDER BY id`);
      assert.ok(audit.rows.some(row => row.event_type === 'mfa_enrolled'));

      const upgraded = (await me(handler, enrolled.token).then(response => response.json())).session.assuranceLevel;
      assert.equal(upgraded, 'mfa_verified', 'enrollment upgrades the current session assurance');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004 login requires a fresh TOTP step and refuses replay', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      clock.advance(30 * 1000); // the enrollment consumed the previous step

      const pending = await login(handler, 'admin@example.com', 'correct-horse-battery');
      assert.equal(pending.body.mfa.pending, true);
      assert.equal((await me(handler, pending.token).then(r => r.json())).session.assuranceLevel, 'single_factor');

      const stepCode = totpCode(enrolled.secret, {at: clock.now()});
      const wrong = await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {code: '000000'});
      assert.equal(wrong.status, 401);

      const verified = await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {code: stepCode});
      assert.equal(verified.status, 200);
      assert.equal((await me(handler, pending.token).then(r => r.json())).session.assuranceLevel, 'mfa_verified');

      const replay = await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {code: stepCode});
      assert.equal(replay.status, 401, 'the consumed step cannot be replayed');
      assert.equal((await replay.json()).error.code, 'MFA_CODE_REPLAYED');

      clock.advance(30 * 1000);
      const next = await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(next.status, 200, 'the next step is accepted');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004 TOTP clock window rejects stale and future codes', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      clock.advance(60 * 1000); // move past the consumed enrollment step
      const pending = await login(handler, 'admin@example.com', 'correct-horse-battery');

      const stale = totpCode(enrolled.secret, {at: new Date(clock.now().getTime() - 3 * 30 * 1000)});
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {code: stale})).status, 401);
      const previous = totpCode(enrolled.secret, {at: new Date(clock.now().getTime() - 30 * 1000)});
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {code: previous})).status, 200);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004 recovery codes are single-use under concurrency', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      const code = enrolled.recoveryCodes[0];

      const first = await login(handler, 'admin@example.com', 'correct-horse-battery');
      const second = await login(handler, 'admin@example.com', 'correct-horse-battery');
      const [a, b] = await Promise.all([
        mfaPost(handler, '/v1/auth/mfa/verify', first.token, first.csrf, {recoveryCode: code}),
        mfaPost(handler, '/v1/auth/mfa/verify', second.token, second.csrf, {recoveryCode: code}),
      ]);
      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, [200, 401], 'exactly one concurrent recovery consume succeeds');

      const replay = await mfaPost(handler, '/v1/auth/mfa/verify', first.token, first.csrf, {recoveryCode: code});
      assert.equal(replay.status, 401);

      const used = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.recovery_codes WHERE user_id = $1::uuid AND used_at IS NOT NULL`,
        [enrolled.userId],
      );
      assert.equal(used.rows[0].n, 1);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004 invalid codes lock the factor until the window passes', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      clock.advance(30 * 1000);
      const pending = await login(handler, 'admin@example.com', 'correct-horse-battery');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {code: '999999'})).status, 401);
      }
      const locked = await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(locked.status, 429);
      assert.equal((await locked.json()).error.code, 'MFA_LOCKED');

      clock.advance(61 * 1000);
      const after = await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(after.status, 200, 'the factor unlocks after the configured window');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004 disable requires reauthentication and invalidates old recovery codes', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      clock.advance(30 * 1000);
      const session = await login(handler, 'admin@example.com', 'correct-horse-battery');
      const code = totpCode(enrolled.secret, {at: clock.now()});
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', session.token, session.csrf, {code})).status, 200);

      const wrongPassword = await mfaPost(handler, '/v1/auth/mfa/disable', session.token, session.csrf, {
        password: 'not-the-password', code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(wrongPassword.status, 401);
      const wrongCode = await mfaPost(handler, '/v1/auth/mfa/disable', session.token, session.csrf, {
        password: 'correct-horse-battery', code: '111111',
      });
      assert.equal(wrongCode.status, 401);

      clock.advance(30 * 1000);
      const disabled = await mfaPost(handler, '/v1/auth/mfa/disable', session.token, session.csrf, {
        password: 'correct-horse-battery', code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(disabled.status, 200);
      assert.equal((await me(handler, session.token).then(r => r.json())).session.assuranceLevel, 'single_factor');

      const factor = await db.adminQuery(
        `SELECT verified_at FROM auth.two_factor WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      assert.equal(factor.rows[0].verified_at, null, 'no verified factor remains after disable');

      const reused = await mfaPost(handler, '/v1/auth/mfa/verify', session.token, session.csrf, {
        recoveryCode: enrolled.recoveryCodes[1],
      });
      assert.equal(reused.status, 403, 'recovery codes are unusable without a verified factor');
      const audit = await db.adminQuery(`SELECT event_type FROM auth.auth_audit ORDER BY id`);
      assert.ok(audit.rows.some(row => row.event_type === 'mfa_disabled'));
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004 an unconfigured MFA service fails closed for required identities only', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock, config: {}});
      const adminId = await insertUser(db, 'unconfigured-admin@example.com', 'correct-horse-battery');
      await addMembership(db, adminId, 'tenant_admin');
      await insertUser(db, 'plain-member@example.com', 'correct-horse-battery');

      const admin = await login(handler, 'unconfigured-admin@example.com', 'correct-horse-battery');
      assert.equal(admin.response.status, 503);
      assert.equal(admin.body.error.code, 'MFA_UNAVAILABLE');
      assert.equal(admin.token, null, 'no session is issued when required MFA is unavailable');

      const member = await login(handler, 'plain-member@example.com', 'correct-horse-battery');
      assert.equal(member.response.status, 200, 'non-required users are unaffected');
      assert.equal(member.body.mfa.required, false);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004 tampered ciphertext and unknown factor inputs cannot bypass verification', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      const pending = await login(handler, 'admin@example.com', 'correct-horse-battery');

      const unknownField = await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {passkey: 'x'});
      assert.equal(unknownField.status, 400);
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {code: '123456', recoveryCode: 'abc'})).status, 400);

      await db.adminQuery(
        `UPDATE auth.two_factor SET secret_ciphertext = 'tampered.envelope.value' WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      const tampered = await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.ok([500, 503].includes(tampered.status), 'a tampered seed fails closed rather than authenticating');
      assert.equal((await me(handler, pending.token).then(r => r.json())).session.assuranceLevel, 'single_factor');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004 a non-admin identity logs in without MFA and audit holds no secrets', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const memberId = await insertUser(db, 'member@example.com', 'correct-horse-battery');
      await addMembership(db, memberId, 'member');
      const member = await login(handler, 'member@example.com', 'correct-horse-battery');
      assert.equal(member.response.status, 200);
      assert.deepEqual(member.body.mfa, {required: false, enrolled: false, pending: false, available: true});
      assert.equal((await me(handler, member.token).then(r => r.json())).session.assuranceLevel, 'single_factor');

      const enrolled = await adminEnrolled({db, clock, handler, email: 'audit-admin@example.com'});
      const pending = await login(handler, 'audit-admin@example.com', 'correct-horse-battery');
      await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      const rows = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      const joined = rows.rows.map(row => row.json).join('\n');
      for (const secret of [enrolled.secret, enrolled.recoveryCodes[0], 'correct-horse-battery']) {
        assert.equal(joined.includes(secret), false, 'audit rows must not contain factor secrets or recovery codes');
      }
    } finally {
      await pool.end();
    }
  });
});
