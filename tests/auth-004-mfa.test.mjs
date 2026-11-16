import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import pg from 'pg';
import {withAuthDatabase} from './helpers/pg-auth-fixture.mjs';
import {createSessionStore} from '../src/auth/session-store.mjs';
import {createAuthRoutes, cookieName} from '../src/auth/routes.mjs';
import {createAuditWriter} from '../src/auth/server.mjs';
import {createPasswordPolicy} from '../src/auth/password-policy.mjs';
import {base32Decode, base32Encode, totpCode} from '../src/auth/factors.mjs';

const {Pool} = pg;
const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const customerCookie = cookieName('customer', true);
const accountKey = Buffer.alloc(32, 7);
const recoveryKey = Buffer.alloc(32, 9);
const TENANT = '11111111-1111-4111-8111-111111111111';
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

function connectionConfig(database, overrides = {}) {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database,
    max: 8,
    application_name: 'saven-auth-004-test',
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

function buildRoutes({pool, clock, config = mfaConfig(), rateLimitPolicy = {}, onVerification = null, passwordPolicy = null, wrapStore = null}) {
  const baseStore = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
  const store = wrapStore ? wrapStore(baseStore) : baseStore;
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
    mfaOnVerification: onVerification,
    passwordPolicy,
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
      assert.deepEqual(session.body.mfa, {required: true, enrolled: false, pending: true, available: true, resolved: true});
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
      assert.equal(tampered.status, 401, 'a tampered seed fails closed rather than authenticating');
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
      assert.deepEqual(member.body.mfa, {required: false, enrolled: false, pending: false, available: true, resolved: true});
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

// ---------------------------------------------------------------------------
// AUTH-004-R1 corrections
// ---------------------------------------------------------------------------
import {readFile} from 'node:fs/promises';
import {createMfaService} from '../src/auth/factors.mjs';

async function applyRlsStack(db) {
  const admissionDefiner = db.roles.authService.replace('auth_service', 'tenant_admission_definer');
  const map = {
    saven_customer_app: db.roles.customerApp,
    saven_auth_service: db.roles.authService,
    saven_operator_read: db.roles.operatorRead,
    saven_operator_admin: db.roles.operatorAdmin,
    saven_migrator: db.roles.migrator,
    saven_operator_definer: db.roles.operatorDefiner,
    saven_auth_definer: db.roles.authDefiner,
    saven_tenant_admission_definer: admissionDefiner,
  };
  const rewrite = raw => {
    let out = raw;
    for (const [fixed, name] of Object.entries(map)) out = out.replaceAll(fixed, name);
    return out;
  };
  const files = [
    ['db/postgres/20-tenant-schema.sql', 'migrator'],
    ['db/postgres/migrations/021-tenant-schema-corrections.sql', 'migrator'],
    ['db/postgres/30-rls-policies.sql', 'migrator'],
    ['db/postgres/migrations/031-rls-corrections.sql', 'admin'],
    ['db/postgres/migrations/032-rls-hardening.sql', 'admin'],
  ];
  for (const [file, via] of files) {
    const sql = rewrite(await readFile(file, 'utf8'));
    if (via === 'admin') await db.adminQuery(sql);
    else await db.asLogin('migrator', client => client.query(sql));
  }
}

function randomToken(bytes) {
  return createHash('sha256').update(String(Math.random())).digest('hex').slice(0, bytes * 2);
}

async function withAuthServicePool(db, action, {max = 8} = {}) {
  const login = `saven_auth_${randomToken(4)}_service_login`;
  const password = randomToken(16);
  await db.adminQuery(
    `CREATE ROLE "${login}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION`,
  );
  await db.adminQuery(`GRANT "${db.roles.authService}" TO "${login}"`);
  const pool = new Pool(connectionConfig(db.database, {user: login, password, max}));
  try {
    return await action(pool, login);
  } finally {
    await pool.end().catch(() => {});
    await db.adminQuery(`DROP ROLE IF EXISTS "${login}"`).catch(() => {});
  }
}

test('AUTH-004-R1 a password-only session cannot replace an enrolled factor', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      const before = await db.adminQuery(
        `SELECT secret_ciphertext, verified_at FROM auth.two_factor WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      const unusedBefore = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.recovery_codes WHERE user_id = $1::uuid AND used_at IS NULL`,
        [enrolled.userId],
      );

      const fresh = await login(handler, 'admin@example.com', 'correct-horse-battery');
      assert.equal(fresh.body.session.assuranceLevel, 'single_factor', 'a password-only login is never reauthentication proof');
      const attempt = await mfaPost(handler, '/v1/auth/mfa/enroll', fresh.token, fresh.csrf, {});
      assert.equal(attempt.status, 403);
      assert.equal((await attempt.json()).error.code, 'MFA_REAUTH_REQUIRED');

      const after = await db.adminQuery(
        `SELECT secret_ciphertext, verified_at FROM auth.two_factor WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      assert.deepEqual(after.rows, before.rows, 'the existing seed and verification state are unchanged');
      const unusedAfter = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.recovery_codes WHERE user_id = $1::uuid AND used_at IS NULL`,
        [enrolled.userId],
      );
      assert.equal(unusedAfter.rows[0].n, unusedBefore.rows[0].n, 'existing recovery codes are not invalidated by a refused request');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004-R1 authorized replacement downgrades other sessions and invalidates old proofs', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      const other = await login(handler, 'admin@example.com', 'correct-horse-battery');
      clock.advance(30 * 1000);
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', other.token, other.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      })).status, 200);
      const beforeSecret = await db.adminQuery(
        `SELECT secret_ciphertext FROM auth.two_factor WHERE user_id = $1::uuid`,
        [enrolled.userId],
      ).then(result => result.rows[0].secret_ciphertext);

      clock.advance(30 * 1000);
      const replacement = await mfaPost(handler, '/v1/auth/mfa/enroll', other.token, other.csrf, {
        password: 'correct-horse-battery',
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(replacement.status, 200);
      assert.equal((await replacement.json()).replaced, true);
      const newUri = (await (await mfaPost(handler, '/v1/auth/mfa/enroll', other.token, other.csrf, {
        password: 'correct-horse-battery',
        code: totpCode(enrolled.secret, {at: clock.now()}),
      })).json().catch(() => ({}))).otpauthUri;
      assert.equal(newUri, undefined, 'the old proof cannot authorize a second replacement');

      const afterSecret = await db.adminQuery(
        `SELECT secret_ciphertext, verified_at FROM auth.two_factor WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      assert.notEqual(afterSecret.rows[0].secret_ciphertext, beforeSecret, 'the replacement writes a fresh seed');
      assert.equal(afterSecret.rows[0].verified_at, null);

      const oldCodes = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.recovery_codes WHERE user_id = $1::uuid AND used_at IS NULL`,
        [enrolled.userId],
      );
      assert.equal(oldCodes.rows[0].n, 0, 'old recovery codes are invalidated');

      const sessionOne = await me(handler, enrolled.token);
      assert.equal((await sessionOne.json()).mfa.pending, true, 'other sessions are downgraded');
      assert.equal((await handler(request(`${origins.customer}/v1/auth/sessions`, {
        headers: {cookie: `${customerCookie}=${enrolled.token}`},
      }))).status, 403);

      const staleVerification = await mfaPost(handler, '/v1/auth/mfa/verify', enrolled.token, enrolled.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(staleVerification.status, 403, 'the replaced seed cannot be used');

      // The authorized replacement itself is still completable and usable.
      const restart = await mfaPost(handler, '/v1/auth/mfa/enroll', other.token, other.csrf, {});
      assert.equal(restart.status, 200, 'a pending (unverified) restart needs no proof');
      const newSecret = secretFromUri((await restart.json()).otpauthUri);
      clock.advance(30 * 1000);
      const completed = await mfaPost(handler, '/v1/auth/mfa/enroll/verify', other.token, other.csrf, {
        code: totpCode(newSecret, {at: clock.now()}),
      });
      assert.equal(completed.status, 200);
      assert.equal((await completed.json()).recoveryCodes.length, 5);
      clock.advance(30 * 1000);
      const freshSession = await login(handler, 'admin@example.com', 'correct-horse-battery');
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', freshSession.token, freshSession.csrf, {
        code: totpCode(newSecret, {at: clock.now()}),
      })).status, 200, 'the new enrollment is usable');

      const audit = await db.adminQuery(
        `SELECT detail_jsonb->>'stage' AS stage FROM auth.auth_audit WHERE event_type = 'mfa_enrolled' ORDER BY id`,
      );
      assert.ok(audit.rows.some(row => row.stage === 'replaced'));
      assert.ok(audit.rows.some(row => row.stage === 'completed'));
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004-R1 disable/disable-race invalidates every session and stale proof', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      const second = await login(handler, 'admin@example.com', 'correct-horse-battery');
      clock.advance(30 * 1000);
      const secondVerify = await mfaPost(handler, '/v1/auth/mfa/verify', second.token, second.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(secondVerify.status, 200);

      clock.advance(30 * 1000);
      const disabled = await mfaPost(handler, '/v1/auth/mfa/disable', second.token, second.csrf, {
        password: 'correct-horse-battery',
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(disabled.status, 200);

      for (const token of [enrolled.token, second.token]) {
        const body = await me(handler, token).then(response => response.json());
        assert.equal(body.mfa.pending, true, 'no live session keeps verified assurance after disable');
        assert.equal((await handler(request(`${origins.customer}/v1/auth/sessions`, {
          headers: {cookie: `${customerCookie}=${token}`},
        }))).status, 403);
      }

      const staleTotp = await mfaPost(handler, '/v1/auth/mfa/verify', enrolled.token, enrolled.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(staleTotp.status, 403, 'the old TOTP seed is gone');
      const staleRecovery = await mfaPost(handler, '/v1/auth/mfa/verify', enrolled.token, enrolled.csrf, {
        recoveryCode: enrolled.recoveryCodes[0],
      });
      assert.equal(staleRecovery.status, 403, 'old recovery codes cannot restore assurance');

      const restart = await mfaPost(handler, '/v1/auth/mfa/enroll', enrolled.token, enrolled.csrf, {});
      assert.equal(restart.status, 200);
      const newSecret = secretFromUri((await restart.json()).otpauthUri);
      clock.advance(30 * 1000);
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/enroll/verify', enrolled.token, enrolled.csrf, {
        code: totpCode(newSecret, {at: clock.now()}),
      })).status, 200);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004-R1 authority resolves under accepted forced membership RLS', async () => {
  await withAuthDatabase(async db => {
    await applyRlsStack(db);
    const clock = testClock();
    await withAuthServicePool(db, async pool => {
      const {handler} = buildRoutes({pool, clock});
      const adminId = await insertUser(db, 'rls-admin@example.com', 'correct-horse-battery');
      await addMembership(db, adminId, 'tenant_admin');
      const memberId = await insertUser(db, 'rls-member@example.com', 'correct-horse-battery');
      await addMembership(db, memberId, 'member');

      // Without verified transaction context the accepted policy exposes no rows.
      const noContext = await pool.query('SELECT count(*)::int AS n FROM auth.tenant_membership');
      assert.equal(noContext.rows[0].n, 0, 'membership is invisible without bound context');

      const admin = await login(handler, 'rls-admin@example.com', 'correct-horse-battery');
      assert.equal(admin.response.status, 200);
      assert.equal(admin.body.mfa.required, true, 'authority survives forced membership RLS');
      assert.equal(admin.body.mfa.resolved, true);

      const member = await login(handler, 'rls-member@example.com', 'correct-horse-battery');
      assert.equal(member.response.status, 200);
      assert.equal(member.body.mfa.required, false, 'a verified ordinary member is not MFA-required');
      assert.equal(member.body.mfa.resolved, true);

      // Promotion and revocation change the requirement on the same pooled paths.
      await db.adminQuery('UPDATE auth.tenant_membership SET role_id = $1 WHERE user_id = $2::uuid', ['tenant_admin', memberId]);
      const promoted = await login(handler, 'rls-member@example.com', 'correct-horse-battery');
      assert.equal(promoted.body.mfa.required, true);
      await db.adminQuery('UPDATE auth.tenant_membership SET status = $1 WHERE user_id = $2::uuid', ['revoked', memberId]);
      const revoked = await login(handler, 'rls-member@example.com', 'correct-horse-battery');
      assert.equal(revoked.body.mfa.required, false);

      // A malformed principal cannot be resolved into a non-required identity.
      const store = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
      const service = createMfaService({store, clock: clock.clock, config: mfaConfig()});
      const malformed = await service.authority('not-a-uuid', {tx: {query: async () => ({rows: [], rowCount: 0})}});
      assert.equal(malformed.resolved, false);
      const unavailable = await service.authority('11111111-1111-4111-8111-111111111111', {
        tx: {query: async () => { throw new Error('context unavailable'); }},
      });
      assert.equal(unavailable.resolved, false, 'authority failures are distinct from verified-nonrequired');
    }, {max: 1});
  });
});

test('AUTH-004-R1 durable bounded failure policy spans sessions and endpoints', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const starts = [];
      const config = {...mfaConfig(), maxFailures: 3};
      const {handler} = buildRoutes({pool, clock, config, onVerification: record => starts.push(record)});
      const enrolled = await adminEnrolled({db, clock, handler});

      // Initial enrollment failure accounting + restart preserving the lock.
      const pendingId = await insertUser(db, 'enroll-lock@example.com', 'correct-horse-battery');
      await addMembership(db, pendingId, 'tenant_admin');
      const pending = await login(handler, 'enroll-lock@example.com', 'correct-horse-battery');
      const start = await mfaPost(handler, '/v1/auth/mfa/enroll', pending.token, pending.csrf, {});
      assert.equal(start.status, 200);
      const secret = secretFromUri((await start.json()).otpauthUri);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal((await mfaPost(handler, '/v1/auth/mfa/enroll/verify', pending.token, pending.csrf, {
          code: totpCode(secret, {at: new Date(clock.now().getTime() - (attempt + 4) * 30 * 1000)}),
        })).status, 401);
      }
      const lockedComplete = await mfaPost(handler, '/v1/auth/mfa/enroll/verify', pending.token, pending.csrf, {
        code: totpCode(secret, {at: clock.now()}),
      });
      assert.equal(lockedComplete.status, 429, 'locked enrollment rejects further verification');
      const restart = await mfaPost(handler, '/v1/auth/mfa/enroll', pending.token, pending.csrf, {});
      assert.equal(restart.status, 429, 'restart does not reset the lockout');
      const counters = await db.adminQuery(
        `SELECT failed_attempts, locked_until FROM auth.two_factor WHERE user_id = $1::uuid`,
        [pendingId],
      );
      assert.equal(counters.rows[0].failed_attempts, 3);
      assert.ok(counters.rows[0].locked_until instanceof Date);

      clock.advance(61 * 1000);
      const restarted = await mfaPost(handler, '/v1/auth/mfa/enroll', pending.token, pending.csrf, {});
      assert.equal(restarted.status, 200, 'cooldown recovery allows restart');
      const freshSecret = secretFromUri((await restarted.json()).otpauthUri);
      clock.advance(30 * 1000);
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/enroll/verify', pending.token, pending.csrf, {
        code: totpCode(freshSecret, {at: clock.now()}),
      })).status, 200);

      // Cross-session concurrent TOTP burst: serialized increments, bounded starts.
      const first = await login(handler, 'admin@example.com', 'correct-horse-battery');
      const second = await login(handler, 'admin@example.com', 'correct-horse-battery');
      clock.advance(30 * 1000);
      starts.length = 0;
      const burst = await Promise.all(Array.from({length: 6}, (_, index) => mfaPost(
        handler,
        '/v1/auth/mfa/verify',
        index % 2 === 0 ? first.token : second.token,
        index % 2 === 0 ? first.csrf : second.csrf,
        {code: '000000'},
      )));
      const statuses = burst.map(response => response.status).sort();
      assert.equal(statuses.filter(status => status === 401).length, 3, 'exactly the limit is evaluated');
      assert.equal(statuses.filter(status => status === 429).length, 3, 'the rest are refused before verification');
      assert.equal(starts.length, 3, 'bounded verification starts');
      const burstCounters = await db.adminQuery(
        `SELECT failed_attempts FROM auth.two_factor WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      assert.equal(burstCounters.rows[0].failed_attempts, 3, 'concurrent increments are durable and exact');

      // Recovery failures count against the same policy after a success resets counters.
      clock.advance(61 * 1000);
      const recoverySession = await login(handler, 'admin@example.com', 'correct-horse-battery');
      clock.advance(30 * 1000);
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', recoverySession.token, recoverySession.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      })).status, 200, 'a successful factor verification resets the failure counters');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', recoverySession.token, recoverySession.csrf, {
          recoveryCode: `WRONGCODE${attempt}`,
        })).status, 401);
      }
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', recoverySession.token, recoverySession.csrf, {
        recoveryCode: 'WRONGCODE9',
      })).status, 429, 'recovery failures lock the factor');

      // Disable password reauthentication is bounded by the same durable counter.
      clock.advance(61 * 1000);
      const disableSession = await login(handler, 'admin@example.com', 'correct-horse-battery');
      clock.advance(30 * 1000);
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', disableSession.token, disableSession.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      })).status, 200);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal((await mfaPost(handler, '/v1/auth/mfa/disable', disableSession.token, disableSession.csrf, {
          password: 'wrong-password-value',
          code: totpCode(enrolled.secret, {at: clock.now()}),
        })).status, 401);
      }
      const lockedDisable = await mfaPost(handler, '/v1/auth/mfa/disable', disableSession.token, disableSession.csrf, {
        password: 'correct-horse-battery',
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(lockedDisable.status, 429, 'disable password failures also lock the factor');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004-R1 disable works on a size-one pool and a saturated small pool', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await withAuthServicePool(db, async pool => {
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      clock.advance(30 * 1000);
      const disable = await Promise.race([
        mfaPost(handler, '/v1/auth/mfa/disable', enrolled.token, enrolled.csrf, {
          password: 'correct-horse-battery',
          code: totpCode(enrolled.secret, {at: clock.now()}),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('disable timed out on max=1')), 15000)),
      ]);
      assert.equal(disable.status, 200, 'disable reauthentication uses the owned transaction');
    }, {max: 1});
  });
});

test('AUTH-004-R1 configuration bounds, recovery key versions and RFC 6238 vectors', async () => {
  for (const bad of [
    {secretBytes: 0},
    {secretBytes: 8},
    {recoveryCodeBytes: 4},
    {recoveryCodeBytes: 64},
    {keys: [{version: 1, key: accountKey}, {version: 1, key: accountKey}], recoveryKeys: [{version: 1, key: recoveryKey}]},
    {keys: [{version: 1, key: accountKey}], recoveryKeys: [{version: 1, key: recoveryKey}, {version: 1, key: recoveryKey}]},
    {keys: [{version: 1, key: accountKey}], recoveryKeys: []},
  ]) {
    assert.throws(() => createMfaService({
      store: {withClient: async () => {}, withTransaction: async () => {}},
      config: {...mfaConfig(), ...bad},
    }), undefined, JSON.stringify(bad));
  }

  // RFC 6238 appendix B, SHA-1 vectors (secret ASCII "12345678901234567890").
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(totpCode(rfcSecret, {at: new Date(seconds * 1000), digits: 8}), expected);
  }

  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const config = {
        ...mfaConfig(),
        recoveryKeys: [
          {version: 1, key: Buffer.alloc(32, 3)},
          {version: 2, key: recoveryKey},
        ],
        recoveryActiveVersion: 2,
      };
      const {handler} = buildRoutes({pool, clock, config});
      const enrolled = await adminEnrolled({db, clock, handler});
      const versions = await db.adminQuery(
        `SELECT DISTINCT hash_key_version FROM auth.recovery_codes WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      assert.deepEqual(versions.rows, [{hash_key_version: 2}], 'issued codes record the active recovery key version');

      // An outstanding code under a retained older version remains verifiable.
      const legacyCode = 'LEGACYCODE234567';
      const legacyDigest = createHash('sha256')
        .update('placeholder')
        .digest('hex');
      void legacyDigest;
      const {createHmac} = await import('node:crypto');
      const legacyHash = createHmac('sha256', Buffer.alloc(32, 3)).update(legacyCode).digest('hex');
      await db.adminQuery(
        `INSERT INTO auth.recovery_codes(user_id, code_hash, hash_algorithm, hash_key_version, batch_id)
         VALUES ($1::uuid, $2, 'hmac_sha256', 1, gen_random_uuid()::text::uuid)`,
        [enrolled.userId, legacyHash],
      );
      clock.advance(30 * 1000);
      const session = await login(handler, 'admin@example.com', 'correct-horse-battery');
      const verified = await mfaPost(handler, '/v1/auth/mfa/verify', session.token, session.csrf, {recoveryCode: legacyCode});
      assert.equal(verified.status, 200, 'retained recovery key versions verify their outstanding codes');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004-R1 concurrent disables are serialized without leaving verified assurance', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database, {max: 4}));
    try {
      const clock = testClock();
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      const second = await login(handler, 'admin@example.com', 'correct-horse-battery');
      clock.advance(30 * 1000);
      assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', second.token, second.csrf, {
        code: totpCode(enrolled.secret, {at: clock.now()}),
      })).status, 200);
      clock.advance(30 * 1000);
      const code = totpCode(enrolled.secret, {at: clock.now()});
      const [a, b] = await Promise.all([
        mfaPost(handler, '/v1/auth/mfa/disable', enrolled.token, enrolled.csrf, {password: 'correct-horse-battery', code}),
        mfaPost(handler, '/v1/auth/mfa/disable', second.token, second.csrf, {password: 'correct-horse-battery', code}),
      ]);
      if ([a.status, b.status].includes(503)) {
        console.error('DBG disable bodies', a.status, await a.clone().json(), b.status, await b.clone().json());
      }
      const statuses = [a.status, b.status].sort();
      assert.equal(statuses.includes(200), true, 'one disable wins');
      assert.ok(statuses.every(status => [200, 401, 403, 409, 429].includes(status)), `the loser fails closed: ${JSON.stringify(statuses)}`);
      for (const token of [enrolled.token, second.token]) {
        const body = await me(handler, token).then(response => response.json());
        assert.equal(body.mfa.pending, true, 'the serialized loser does not keep verified assurance');
      }
      const factor = await db.adminQuery(
        `SELECT verified_at FROM auth.two_factor WHERE user_id = $1::uuid`,
        [enrolled.userId],
      );
      assert.equal(factor.rows[0].verified_at, null);
    } finally {
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// AUTH-004-R2 corrections: admission-before-KDF, in-transaction authority, and
// observed-transaction-phase uncertainty (the last in the AUTH-002 suite).
// ---------------------------------------------------------------------------

function spyPolicy(counter) {
  const base = createPasswordPolicy();
  return {
    verify: (...args) => {
      counter.verify += 1;
      return base.verify(...args);
    },
    hash: (...args) => base.hash(...args),
  };
}

// Wraps the real store so a test can mutate session/principal state AFTER the
// non-transactional readSession returns but BEFORE the route opens its owned
// transaction. This reproduces the read-valid-then-stale window deterministically.
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

async function factorState(db, userId) {
  const factor = await db.adminQuery(
    `SELECT secret_ciphertext, verified_at, failed_attempts, locked_until
     FROM auth.two_factor WHERE user_id = $1::uuid`,
    [userId],
  );
  const recovery = await db.adminQuery(
    'SELECT count(*)::int AS n FROM auth.recovery_codes WHERE user_id = $1::uuid AND used_at IS NULL',
    [userId],
  );
  return {row: factor.rows[0] ?? null, unusedRecovery: recovery.rows[0].n};
}

async function assuranceState(db, userId) {
  const result = await db.adminQuery(
    'SELECT id::text AS id, assurance_level FROM auth.sessions WHERE user_id = $1::uuid ORDER BY id',
    [userId],
  );
  return result.rows;
}

test('AUTH-004-R2 locked replacement refuses before any password or factor derivation', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const counter = {verify: 0};
      const starts = [];
      const {handler} = buildRoutes({
        pool,
        clock,
        passwordPolicy: spyPolicy(counter),
        onVerification: record => starts.push(record),
      });
      const enrolled = await adminEnrolled({db, clock, handler});

      // Lock the shared factor with three wrong TOTP steps on a pending session.
      const pending = await login(handler, 'admin@example.com', 'correct-horse-battery');
      clock.advance(30 * 1000);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal((await mfaPost(handler, '/v1/auth/mfa/verify', pending.token, pending.csrf, {
          code: '000000',
        })).status, 401);
      }
      const locked = await db.adminQuery(
        'SELECT failed_attempts, locked_until FROM auth.two_factor WHERE user_id = $1::uuid',
        [enrolled.userId],
      );
      assert.equal(locked.rows[0].failed_attempts, 3, 'the factor is durably locked');
      assert.ok(locked.rows[0].locked_until instanceof Date);

      const before = await factorState(db, enrolled.userId);
      const first = await login(handler, 'admin@example.com', 'correct-horse-battery');
      const second = await login(handler, 'admin@example.com', 'correct-horse-battery');

      // Every replacement shape — correct/wrong password × TOTP/recovery — is an
      // admission decision before any derivation starts.
      counter.verify = 0;
      starts.length = 0;
      const shapes = [
        {password: 'correct-horse-battery', code: totpCode(enrolled.secret, {at: clock.now()})},
        {password: 'correct-horse-battery', recoveryCode: enrolled.recoveryCodes[0]},
        {password: 'wrong-password-value', code: '123456'},
        {password: 'wrong-password-value', recoveryCode: 'WRONGCODE234567'},
      ];
      for (const body of shapes) {
        const response = await mfaPost(handler, '/v1/auth/mfa/enroll', first.token, first.csrf, body);
        assert.equal(response.status, 429, 'a locked factor refuses replacement admission');
        assert.equal((await response.json()).error.code, 'MFA_LOCKED');
      }
      assert.equal(counter.verify, 0, 'locked replacement starts no password KDF');
      assert.equal(starts.length, 0, 'locked replacement starts no TOTP/recovery derivation');

      // Cross-session bursts stay bounded and never reach a derivation.
      counter.verify = 0;
      starts.length = 0;
      const burst = await Promise.all(Array.from({length: 6}, (_, index) => mfaPost(
        handler,
        '/v1/auth/mfa/enroll',
        index % 2 === 0 ? first.token : second.token,
        index % 2 === 0 ? first.csrf : second.csrf,
        index % 2 === 0
          ? {password: 'correct-horse-battery', code: totpCode(enrolled.secret, {at: clock.now()})}
          : {password: 'wrong-password-value', recoveryCode: enrolled.recoveryCodes[1]},
      )));
      assert.ok(burst.every(response => response.status === 429), 'every concurrent locked replacement is refused');
      assert.equal(counter.verify, 0, 'concurrent locked replacement starts no KDF work');
      assert.equal(starts.length, 0, 'concurrent locked replacement starts no factor derivation');

      const afterBurst = await factorState(db, enrolled.userId);
      assert.equal(afterBurst.row.secret_ciphertext, before.row.secret_ciphertext, 'the seed is unchanged');
      assert.equal(afterBurst.row.failed_attempts, 3, 'refusals do not erase the durable counter');
      assert.equal(afterBurst.unusedRecovery, before.unusedRecovery, 'recovery codes are unchanged');

      // Cooldown recovery: admission passes, derivation resumes and counters reset.
      clock.advance(61 * 1000);
      counter.verify = 0;
      starts.length = 0;
      const recovered = await mfaPost(handler, '/v1/auth/mfa/enroll', first.token, first.csrf, {
        password: 'correct-horse-battery',
        code: totpCode(enrolled.secret, {at: clock.now()}),
      });
      assert.equal(recovered.status, 200, 'the factor is unlocked after the cooldown');
      assert.equal((await recovered.json()).replaced, true);
      assert.ok(counter.verify >= 1, 'an admitted replacement performs the password verification');
      assert.ok(starts.some(record => record.operation === 'verifyTotp'), 'an admitted replacement derives the TOTP step');
      const afterRecovery = await factorState(db, enrolled.userId);
      assert.notEqual(afterRecovery.row.secret_ciphertext, before.row.secret_ciphertext, 'a fresh seed is written');
      assert.equal(afterRecovery.row.failed_attempts, 0);
      assert.equal(afterRecovery.row.locked_until, null);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004-R2 read-valid then stale session/principal is refused before reauthentication', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const modes = {
        revoked: async session => {
          await db.adminQuery('UPDATE auth.sessions SET revoked_at = now() WHERE id = $1::uuid', [session.id]);
        },
        expired: async session => {
          await db.adminQuery(
            'UPDATE auth.sessions SET idle_expires_at = $2::timestamptz WHERE id = $1::uuid',
            [session.id, new Date(clock.now().getTime() - 1000).toISOString()],
          );
        },
        disabled: async session => {
          await db.adminQuery("UPDATE auth.users SET status = 'disabled' WHERE id = $1::uuid", [session.userId]);
        },
        credential: async session => {
          const policy = createPasswordPolicy();
          const changed = await policy.hash('rotated-password-value');
          await db.adminQuery(
            `UPDATE auth.users
             SET password_hash = $2, password_scheme = $3, password_updated_at = now(),
                 credential_version = credential_version + 1
             WHERE id = $1::uuid`,
            [session.userId, changed.hash, changed.scheme],
          );
        },
      };

      let index = 0;
      async function runCase(mode, flow) {
        index += 1;
        const email = `stale-${mode}-${flow}-${index}@example.com`;
        const counter = {verify: 0};
        const hookRef = {current: null};
        const {handler} = buildRoutes({
          pool,
          clock,
          passwordPolicy: spyPolicy(counter),
          wrapStore: interceptingStore(hookRef),
        });

        let userId;
        let token;
        let csrf;
        let secret = null;
        let before;
        if (flow === 'replacement') {
          const enrolled = await adminEnrolled({db, clock, handler, email});
          userId = enrolled.userId;
          token = enrolled.token;
          csrf = enrolled.csrf;
          secret = enrolled.secret;
          clock.advance(30 * 1000);
          before = await factorState(db, userId);
        } else {
          userId = await insertUser(db, email, 'correct-horse-battery');
          await addMembership(db, userId, 'tenant_admin');
          const session = await login(handler, email, 'correct-horse-battery');
          assert.equal(session.response.status, 200);
          token = session.token;
          csrf = session.csrf;
          before = await factorState(db, userId);
          assert.equal(before.row, null, 'initial enrollment starts with no factor');
        }
        const assuranceBefore = await assuranceState(db, userId);
        const auditBefore = await db.adminQuery(
          "SELECT count(*)::int AS n FROM auth.auth_audit WHERE event_type = 'mfa_enrolled'",
        ).then(result => result.rows[0].n);

        hookRef.current = modes[mode];
        counter.verify = 0;
        const body = flow === 'replacement'
          ? {password: 'correct-horse-battery', code: totpCode(secret, {at: clock.now()})}
          : {};
        const response = await mfaPost(handler, '/v1/auth/mfa/enroll', token, csrf, body);

        assert.equal(response.status, 401, `${mode}/${flow} is refused`);
        assert.equal((await response.json()).error.code, 'SESSION_REQUIRED');
        assert.equal(counter.verify, 0, `${mode}/${flow}: no password KDF runs before the refusal`);

        const after = await factorState(db, userId);
        if (flow === 'replacement') {
          assert.equal(after.row.secret_ciphertext, before.row.secret_ciphertext, `${mode}/${flow}: seed unchanged`);
          assert.equal(after.row.verified_at.getTime(), before.row.verified_at.getTime(), `${mode}/${flow}: verification unchanged`);
          assert.equal(after.unusedRecovery, before.unusedRecovery, `${mode}/${flow}: recovery unchanged`);
        } else {
          assert.equal(after.row, null, `${mode}/${flow}: no pending factor is created`);
        }
        assert.deepEqual(await assuranceState(db, userId), assuranceBefore, `${mode}/${flow}: assurance unchanged`);
        const auditAfter = await db.adminQuery(
          "SELECT count(*)::int AS n FROM auth.auth_audit WHERE event_type = 'mfa_enrolled'",
        ).then(result => result.rows[0].n);
        assert.equal(auditAfter, auditBefore, `${mode}/${flow}: no mfa_enrolled success is recorded`);
      }

      for (const flow of ['initial', 'replacement']) {
        for (const mode of ['revoked', 'expired', 'disabled', 'credential']) {
          await runCase(mode, flow);
        }
      }
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-004-R2 authorized replacement uses the owned transaction on a size-one pool', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await withAuthServicePool(db, async pool => {
      const {handler} = buildRoutes({pool, clock});
      const enrolled = await adminEnrolled({db, clock, handler});
      clock.advance(30 * 1000);
      const replace = await Promise.race([
        mfaPost(handler, '/v1/auth/mfa/enroll', enrolled.token, enrolled.csrf, {
          password: 'correct-horse-battery',
          code: totpCode(enrolled.secret, {at: clock.now()}),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('replacement timed out on max=1')), 15000)),
      ]);
      assert.equal(replace.status, 200, 'replacement reauthentication uses the owned transaction');
      assert.equal((await replace.json()).replaced, true);
    }, {max: 1});
  });
});
