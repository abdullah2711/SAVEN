import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {withAuthDatabase} from './helpers/pg-auth-fixture.mjs';
import {createSessionStore} from '../src/auth/session-store.mjs';
import {createAuthRoutes, cookieName} from '../src/auth/routes.mjs';
import {createAuditWriter} from '../src/auth/server.mjs';
import {createAccessValidator, createOperatorAccess, AccessError} from '../src/auth/access.mjs';

const {Pool} = pg;
const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const operatorCookie = cookieName('operator', true);
const ISSUER = 'https://saven.cloudflareaccess.com';
const AUDIENCE = 'saven-operator';
const OP_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUBJECT = 'access-subject-1';

const authSqlFiles = [
  'db/postgres/10-operator-schema.sql',
  'db/postgres/05-auth-schema.sql',
  'db/postgres/migrations/006-auth-schema-corrections.sql',
];

async function applyOperatorStack(db) {
  const roleMap = {
    saven_auth_service: db.roles.authService,
    saven_operator_read: db.roles.operatorRead,
    saven_operator_admin: db.roles.operatorAdmin,
    saven_migrator: db.roles.migrator,
  };
  for (const file of [
    'db/postgres/migrations/033-membership-admission-lock.sql',
    'db/postgres/06-operator-identity.sql',
  ]) {
    let sql = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [fixed, name] of Object.entries(roleMap)) sql = sql.replaceAll(fixed, name);
    await db.adminQuery(sql);
  }
}

async function withOperatorDatabase(run) {
  return withAuthDatabase({sqlFiles: authSqlFiles}, async db => {
    await applyOperatorStack(db);
    return run(db);
  });
}

function connectionConfig(database, overrides = {}) {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database,
    max: 8,
    application_name: 'saven-auth-007-test',
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

async function makeLoginPool(db, roleName, label, {max = 4} = {}) {
  const suffix = randomBytes(4).toString('hex');
  const login = `saven_auth007_${label}_${suffix}`;
  const password = randomBytes(24).toString('base64url');
  await db.adminQuery(
    `CREATE ROLE "${login}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION`,
  );
  await db.adminQuery(`GRANT "${roleName}" TO "${login}"`);
  const pool = new Pool(connectionConfig(db.database, {user: login, password, max}));
  return {
    pool,
    async close() {
      await pool.end().catch(() => {});
      await db.adminQuery(`DROP ROLE IF EXISTS "${login}"`).catch(() => {});
    },
  };
}

async function seedMapping(db, overrides = {}) {
  const values = {
    subject: SUBJECT,
    userId: OP_USER,
    email: 'operator@example.test',
    role: 'operator_admin',
    assurance: 'access_mfa',
    status: 'active',
    effectiveTo: null,
    userStatus: 'active',
    ...overrides,
  };
  await db.adminQuery(
    `INSERT INTO auth.users(id, legacy_id, email, status) VALUES ($1::uuid, 'operator-1', $2, $3)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
    [values.userId, values.email, values.userStatus],
  );
  await db.adminQuery(
    `INSERT INTO operator.access_identity(
       subject, user_id, email, operator_role_id, assurance_class, status, effective_from, effective_to)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, now(), $7)
     ON CONFLICT (subject) DO UPDATE
       SET user_id = EXCLUDED.user_id, email = EXCLUDED.email, operator_role_id = EXCLUDED.operator_role_id,
           assurance_class = EXCLUDED.assurance_class, status = EXCLUDED.status,
           effective_to = EXCLUDED.effective_to, updated_at = now()`,
    [values.subject, values.userId, values.email, values.role, values.assurance, values.status,
      values.effectiveTo],
  );
}

function makeKeys(kid = 'key-1') {
  const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  return {kid, key: publicKey, publicKey, privateKey};
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function assertion({key, claims = {}, header = {}} = {}) {
  const at = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: SUBJECT,
    email: 'operator@example.test',
    iat: at,
    nbf: at - 1,
    exp: at + 300,
    type: 'app',
    amr: ['mfa'],
    identity_nonce: randomBytes(12).toString('hex'),
    ...claims,
  };
  const head = {alg: 'RS256', kid: key.kid, typ: 'JWT', ...header};
  const signingInput = `${encode(head)}.${encode(payload)}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), key.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function buildHarness({
  pool,
  clock,
  keys,
  refreshKeys = null,
  refreshCooldownMs = undefined,
  requiredAssurance = 'access_mfa',
  mfaEvidence = undefined,
  maxTokenAgeSeconds = null,
  audit = null,
  wrapStore = null,
}) {
  const validator = createAccessValidator({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys,
    refreshKeys,
    clock: clock.clock,
    skewSeconds: 30,
    ...(refreshCooldownMs === undefined ? {} : {refreshCooldownMs}),
    ...(mfaEvidence === undefined ? {} : {mfaEvidence}),
    ...(maxTokenAgeSeconds === null ? {} : {maxTokenAgeSeconds}),
  });
  const baseStore = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
  const store = wrapStore ? wrapStore(baseStore) : baseStore;
  const operatorAccess = createOperatorAccess({
    validator,
    store,
    clock: clock.clock,
    policy: {requiredAssurance},
  });
  const handler = createAuthRoutes({
    store,
    findUserByEmail: async () => null,
    audit: audit ?? createAuditWriter(pool),
    origins,
    secureCookies: true,
    clock: clock.clock,
    mfaConfig: {},
    operatorAccess,
  });
  return {validator, store, baseStore, operatorAccess, handler};
}

function makeGate() {
  let enter;
  let release;
  const entered = new Promise(resolve => {
    enter = resolve;
  });
  const gate = new Promise(resolve => {
    release = resolve;
  });
  return {entered, enter, gate, release};
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

function exchangeRequest(token, {origin = origins.operator, headers = {}, body = {}} = {}) {
  return request(`${origin}/v1/auth/operator/access`, {
    method: 'POST',
    headers: {origin, ...(token ? {authorization: `Bearer ${token}`} : {}), ...headers},
    body,
  });
}

function operatorMe(handler, token) {
  return handler(request(`${origins.operator}/v1/auth/operator/me`, {
    headers: {cookie: `${operatorCookie}=${token}`},
  }));
}

function operatorLogout(handler, token, csrf) {
  return handler(request(`${origins.operator}/v1/auth/operator/logout`, {
    method: 'POST',
    headers: {origin: origins.operator, cookie: `${operatorCookie}=${token}`, 'x-csrf-token': csrf},
  }));
}

function tokenFrom(response) {
  const value = response.headers.get('set-cookie') ?? '';
  return new RegExp(`${operatorCookie}=([^;]+)`).exec(value)?.[1] ?? null;
}

async function auditCounts(db) {
  const result = await db.adminQuery(
    `SELECT event_type, outcome, count(*)::int AS n
     FROM auth.auth_audit WHERE realm = 'operator' GROUP BY event_type, outcome`,
  );
  return result.rows;
}

test('AUTH-007 a valid Access assertion exchanges into a scoped operator session', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();
      const {handler, store} = buildHarness({pool: auth.pool, clock, keys: [key]});
      const token = assertion({key});

      const response = await handler(exchangeRequest(token));
      assert.equal(response.status, 200);
      const body = await response.clone().json();
      assert.equal(body.realm, 'operator');
      assert.equal(body.operator.subject, SUBJECT);
      assert.equal(body.operator.roleId, 'operator_admin');
      assert.equal(body.operator.assurance, 'access_mfa');
      assert.equal(JSON.stringify(body).includes(token), false, 'the assertion is never returned');
      const cookie = tokenFrom(response);
      assert.ok(cookie, 'operator session cookie is issued');
      const setCookie = response.headers.get('set-cookie');
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Strict/);
      assert.match(setCookie, /__Host-saven_operator_session=/);

      const session = await store.readSession(cookie, {realm: 'operator'});
      assert.equal(session.realm, 'operator');
      assert.equal(session.roleId, 'operator_admin');
      assert.equal(session.assuranceLevel, 'access_asserted');
      const row = await db.adminQuery(
        `SELECT nonce_hash, subject FROM operator.access_exchange WHERE subject = $1`,
        [SUBJECT],
      );
      assert.equal(row.rowCount, 1);
      assert.match(row.rows[0].nonce_hash, /^[0-9a-f]{64}$/);
      assert.equal(row.rows[0].nonce_hash.includes(token), false);

      const me = await operatorMe(handler, cookie);
      assert.equal(me.status, 200);
      const meBody = await me.json();
      assert.equal(meBody.operator.roleId, 'operator_admin');
      assert.equal(meBody.operator.assurance, 'access_mfa');
      assert.equal(meBody.session.assuranceLevel, 'access_asserted');

      const logout = await operatorLogout(handler, cookie, body.csrfToken);
      assert.equal(logout.status, 200);
      assert.equal((await operatorMe(handler, cookie)).status, 401);

      const replay = await handler(exchangeRequest(token));
      assert.equal(replay.status, 409);
      assert.equal((await replay.json()).error.code, 'OPERATOR_EXCHANGE_REPLAY');

      const audit = await auditCounts(db);
      assert.ok(audit.some(row => row.event_type === 'login_success' && row.outcome === 'success'));
      assert.ok(audit.some(row => row.event_type === 'logout'));
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007 missing, expired, wrong-issuer/audience, tampered and unmapped assertions fail closed', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();
      const {handler} = buildHarness({pool: auth.pool, clock, keys: [key]});
      const now = Math.floor(clock.now().getTime() / 1000);

      const cases = [
        ['missing assertion', handler(exchangeRequest('')), 401, 'OPERATOR_ACCESS_REQUIRED'],
        ['expired', handler(exchangeRequest(assertion({key, claims: {exp: now - 120}}))), 401, 'OPERATOR_ACCESS_EXPIRED'],
        ['wrong audience', handler(exchangeRequest(assertion({key, claims: {aud: 'someone-else'}}))), 401, 'OPERATOR_ACCESS_AUDIENCE'],
        ['wrong issuer', handler(exchangeRequest(assertion({key, claims: {iss: 'https://evil.example'}}))), 401, 'OPERATOR_ACCESS_ISSUER'],
        ['not yet valid', handler(exchangeRequest(assertion({key, claims: {nbf: now + 300}}))), 401, 'OPERATOR_ACCESS_NOT_YET_VALID'],
        ['unmapped subject', handler(exchangeRequest(assertion({key, claims: {sub: 'unknown-subject'}}))), 403, 'OPERATOR_ACCESS_DENIED'],
        ['algorithm', handler(exchangeRequest(assertion({key, header: {alg: 'HS256'}}))), 401, 'OPERATOR_ACCESS_ALGORITHM'],
      ];
      for (const [label, pending, status, code] of cases) {
        const response = await pending;
        assert.equal(response.status, status, label);
        assert.equal((await response.json()).error.code, code, label);
      }

      const tampered = assertion({key});
      const [h, p] = tampered.split('.');
      const tamperedResponse = await handler(exchangeRequest(`${h}.${p}.${Buffer.from('not-a-signature').toString('base64url')}`));
      assert.equal(tamperedResponse.status, 401);
      assert.equal((await tamperedResponse.json()).error.code, 'OPERATOR_ACCESS_INVALID');

      const sessions = await db.adminQuery("SELECT count(*)::int AS n FROM auth.sessions WHERE realm = 'operator'");
      assert.equal(sessions.rows[0].n, 0, 'no operator session is created by a refused assertion');
      const audit = await auditCounts(db);
      assert.ok(audit.some(row => row.event_type === 'login_failure' && row.outcome === 'failure'));
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007 revoked/inactive mappings and wrong operator roles are denied', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();
      const {handler} = buildHarness({pool: auth.pool, clock, keys: [key]});

      await db.adminQuery("UPDATE operator.access_identity SET status = 'revoked' WHERE subject = $1", [SUBJECT]);
      let response = await handler(exchangeRequest(assertion({key})));
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'OPERATOR_ACCESS_DENIED');
      await db.adminQuery("UPDATE operator.access_identity SET status = 'active' WHERE subject = $1", [SUBJECT]);

      await db.adminQuery(
        "UPDATE operator.access_identity SET effective_from = now() - interval '2 hours', effective_to = now() - interval '1 hour' WHERE subject = $1",
        [SUBJECT],
      );
      response = await handler(exchangeRequest(assertion({key})));
      assert.equal(response.status, 403);
      await db.adminQuery(
        "UPDATE operator.access_identity SET effective_from = now(), effective_to = NULL WHERE subject = $1",
        [SUBJECT],
      );

      await db.adminQuery("UPDATE auth.users SET status = 'suspended' WHERE id = $1::uuid", [OP_USER]);
      response = await handler(exchangeRequest(assertion({key})));
      assert.equal(response.status, 403);
      await db.adminQuery("UPDATE auth.users SET status = 'active' WHERE id = $1::uuid", [OP_USER]);

      await db.adminQuery("UPDATE operator.access_identity SET operator_role_id = 'member' WHERE subject = $1", [SUBJECT]);
      response = await handler(exchangeRequest(assertion({key})));
      assert.equal(response.status, 403);
      await db.adminQuery("UPDATE operator.access_identity SET operator_role_id = 'operator_admin' WHERE subject = $1", [SUBJECT]);

      const sessions = await db.adminQuery("SELECT count(*)::int AS n FROM auth.sessions WHERE realm = 'operator'");
      assert.equal(sessions.rows[0].n, 0);
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007 mandatory MFA requires explicit multi-factor evidence, never a single method', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();
      const {handler} = buildHarness({pool: auth.pool, clock, keys: [key]});

      for (const label of [['otp'], ['hwk'], ['swk'], ['pwd', 'otp'], []]) {
        const response = await handler(exchangeRequest(assertion({key, claims: {amr: label}})));
        assert.equal(response.status, 403, `amr ${JSON.stringify(label)} must not satisfy MFA`);
        assert.equal((await response.json()).error.code, 'OPERATOR_MFA_REQUIRED');
      }
      const malformed = await handler(exchangeRequest(assertion({key, claims: {amr: 'mfa'}})));
      assert.equal(malformed.status, 403);

      const explicit = await handler(exchangeRequest(assertion({key, claims: {amr: ['mfa']}})));
      assert.equal(explicit.status, 200, 'the explicit RFC 8176 mfa indication is accepted');

      // A custom claim may be used only through a reviewed issuer-controlled predicate.
      const customHarness = buildHarness({
        pool: auth.pool,
        clock,
        keys: [key],
        mfaEvidence: claims => claims?.custom?.mfa === true,
      });
      const customPositive = await customHarness.handler(exchangeRequest(assertion({key, claims: {amr: [], custom: {mfa: true}}})));
      assert.equal(customPositive.status, 200);
      const customNegative = await customHarness.handler(exchangeRequest(assertion({key, claims: {amr: [], custom: {mfa: false}}})));
      assert.equal(customNegative.status, 403);

      await db.adminQuery("UPDATE operator.access_identity SET assurance_class = 'access_asserted' WHERE subject = $1", [SUBJECT]);
      const stale = await handler(exchangeRequest(assertion({key, claims: {amr: ['mfa']}})));
      assert.equal(stale.status, 403);
      assert.equal((await stale.json()).error.code, 'OPERATOR_ACCESS_DENIED');
      await db.adminQuery("UPDATE operator.access_identity SET assurance_class = 'access_mfa' WHERE subject = $1", [SUBJECT]);

      assert.throws(
        () => createOperatorAccess({
          validator: {validate: async () => ({}), assertFresh: () => {}},
          store: {withTransaction: async () => {}, createSession: async () => {}},
          policy: {requiredAssurance: 'access_asserted'},
        }),
        /must require access_mfa/,
        'policy labels cannot weaken the mandatory operator-MFA invariant',
      );
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007 key rollover uses only the fixed trusted source and fails closed', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key1 = makeKeys('key-1');
      const key2 = makeKeys('key-2');
      const refreshCalls = [];
      const {handler} = buildHarness({
        pool: auth.pool,
        clock,
        keys: [key1],
        refreshKeys: async (...args) => {
          refreshCalls.push(args);
          return [key1, key2];
        },
      });

      const rolled = assertion({key: key2, claims: {identity_nonce: randomBytes(12).toString('hex')}});
      const response = await handler(exchangeRequest(rolled));
      assert.equal(response.status, 200, 'a fixed-source refresh may accept the new key');
      assert.equal(refreshCalls.length, 1);
      assert.deepEqual(refreshCalls[0], [], 'refresh is called without token-supplied URL input');

      // A token-supplied jku/x5u is ignored; the fixed trusted keys remain authoritative.
      const jku = assertion({key: key1, claims: {identity_nonce: randomBytes(12).toString('hex')}, header: {jku: 'https://evil.example/jwks'}});
      const jkuResponse = await handler(exchangeRequest(jku));
      assert.equal(jkuResponse.status, 200);
      assert.equal(refreshCalls.length, 1, 'no attacker-directed fetch happened');

      const unknown = makeKeys('key-3');
      const unknownResponse = await handler(exchangeRequest(assertion({key: unknown})));
      assert.equal(unknownResponse.status, 401);
      assert.equal((await unknownResponse.json()).error.code, 'OPERATOR_ACCESS_INVALID');

      const noRefreshValidator = createAccessValidator({
        issuer: ISSUER,
        audience: AUDIENCE,
        keys: [key1],
        clock: clock.clock,
      });
      await assert.rejects(
        () => noRefreshValidator.validate(assertion({key: key2})),
        error => error instanceof AccessError && error.code === 'OPERATOR_ACCESS_INVALID',
      );
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007 exchange nonce is single-use while ordinary bearer validation is reusable', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();
      const {handler, validator} = buildHarness({pool: auth.pool, clock, keys: [key]});
      const token = assertion({key});

      assert.equal((await validator.validate(token)).subject, SUBJECT);
      assert.equal((await validator.validate(token)).subject, SUBJECT, 'unexpired bearer validation is reusable');

      const first = await handler(exchangeRequest(token));
      assert.equal(first.status, 200);
      const second = await handler(exchangeRequest(token));
      assert.equal(second.status, 409);
      assert.equal((await second.json()).error.code, 'OPERATOR_EXCHANGE_REPLAY');

      const sessions = await db.adminQuery("SELECT count(*)::int AS n FROM auth.sessions WHERE realm = 'operator'");
      assert.equal(sessions.rows[0].n, 1, 'a replay creates no second session');
      const exchanges = await db.adminQuery('SELECT count(*)::int AS n FROM operator.access_exchange');
      assert.equal(exchanges.rows[0].n, 1);
      const audit = await auditCounts(db);
      assert.ok(audit.some(row => row.event_type === 'login_failure' && row.outcome === 'denied'));
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007 operator access has no local password path and requires the operator realm', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();
      const {handler} = buildHarness({pool: auth.pool, clock, keys: [key]});

      const wrongRealm = await handler(exchangeRequest(assertion({key}), {origin: origins.customer}));
      assert.equal(wrongRealm.status, 403);
      assert.equal((await wrongRealm.json()).error.code, 'OPERATOR_REALM_REQUIRED');

      const passwordBody = await handler(exchangeRequest(assertion({key}), {body: {password: 'secret'}}));
      assert.equal(passwordBody.status, 400);
      assert.equal((await passwordBody.json()).error.code, 'UNKNOWN_FIELDS');

      const localLogin = await handler(request(`${origins.operator}/v1/auth/login`, {
        method: 'POST',
        headers: {origin: origins.operator},
        body: {email: 'operator@example.test', password: 'secret'},
      }));
      assert.equal(localLogin.status, 403);
      assert.equal((await localLogin.json()).error.code, 'OPERATOR_ASSERTION_REQUIRED');

      const identityColumns = await db.adminQuery(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'operator' AND table_name = 'access_identity'`,
      ).then(result => result.rows.map(row => row.column_name));
      for (const forbidden of ['password', 'password_hash', 'totp_secret']) {
        assert.equal(identityColumns.includes(forbidden), false, `no ${forbidden} column`);
      }

      const privileges = await db.adminQuery(
        `SELECT
           has_table_privilege($1, 'operator.access_identity', 'SELECT') AS identity_select,
           has_table_privilege($1, 'operator.access_identity', 'UPDATE') AS identity_update,
           has_table_privilege($1, 'operator.access_session_binding', 'SELECT') AS binding_select,
           has_table_privilege($1, 'operator.access_session_binding', 'INSERT') AS binding_insert,
           has_table_privilege($1, 'operator.access_session_binding', 'UPDATE') AS binding_update,
           has_table_privilege($1, 'operator.access_exchange', 'SELECT') AS exchange_select,
           has_table_privilege($1, 'operator.access_exchange', 'INSERT') AS exchange_insert,
           has_table_privilege($1, 'operator.access_exchange', 'DELETE') AS exchange_delete`,
        [db.roles.authService],
      ).then(result => result.rows[0]);
      assert.equal(privileges.identity_select, true);
      assert.equal(privileges.identity_update, false);
      assert.equal(privileges.binding_select, true);
      assert.equal(privileges.binding_insert, true);
      assert.equal(privileges.binding_update, false);
      assert.equal(privileges.exchange_select, true);
      assert.equal(privileges.exchange_insert, true);
      assert.equal(privileges.exchange_delete, false);

      const unavailableStore = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const unavailable = createAuthRoutes({
        store: unavailableStore,
        findUserByEmail: async () => null,
        audit: createAuditWriter(auth.pool),
        origins,
        secureCookies: true,
        clock: clock.clock,
        mfaConfig: {},
      });
      const response = await unavailable(exchangeRequest(assertion({key})));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'OPERATOR_ACCESS_UNAVAILABLE');
    } finally {
      await auth.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AUTH-007-R1: mapping authority binding, canonical replay, freshness,
// refresh concurrency and audit/rollback.
// ---------------------------------------------------------------------------

function alterUnusedSignatureBits(token) {
  const parts = token.split('.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const signature = parts[2];
  const last = signature.at(-1);
  const index = alphabet.indexOf(last);
  assert.ok(index >= 0);
  // The 256-byte RSA signature occupies 342 base64url characters: the final character
  // carries 2 used bits and 4 unused bits. Flipping an unused bit changes the text while
  // decoding to the same signature bytes.
  const alteredIndex = (index & 0b110000) | ((index + 1) & 0b001111);
  const altered = alphabet[alteredIndex];
  const changed = `${parts[0]}.${parts[1]}.${signature.slice(0, -1)}${altered}`;
  assert.notEqual(changed, token);
  assert.deepEqual(
    Buffer.from(changed.split('.')[2], 'base64url'),
    Buffer.from(signature, 'base64url'),
    'the altered text must decode to the same signature bytes',
  );
  return changed;
}

async function exchangeCookie(handler, token) {
  const response = await handler(exchangeRequest(token));
  assert.equal(response.status, 200);
  return {cookie: tokenFrom(response), body: await response.clone().json()};
}

async function exchangeCounts(db) {
  const result = await db.adminQuery(
    `SELECT
       (SELECT count(*)::int FROM operator.access_exchange) AS exchange,
       (SELECT count(*)::int FROM operator.access_session_binding) AS binding,
       (SELECT count(*)::int FROM auth.sessions WHERE realm = 'operator') AS sessions,
       (SELECT count(*)::int FROM auth.auth_audit
         WHERE realm = 'operator' AND event_type = 'login_success' AND outcome = 'success') AS success_audit`,
  );
  return result.rows[0];
}

test('AUTH-007-R1 operator use revalidates post-exchange mapping, role and assurance changes', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();
      const {handler} = buildHarness({pool: auth.pool, clock, keys: [key]});

      let active = await exchangeCookie(handler, assertion({key}));
      assert.equal((await operatorMe(handler, active.cookie)).status, 200);

      await db.adminQuery("UPDATE operator.access_identity SET status = 'revoked' WHERE subject = $1", [SUBJECT]);
      let me = await operatorMe(handler, active.cookie);
      assert.equal(me.status, 403, 'revoked mapping denies operator use');
      await db.adminQuery("UPDATE operator.access_identity SET status = 'active' WHERE subject = $1", [SUBJECT]);
      active = await exchangeCookie(handler, assertion({key}));

      await db.adminQuery("UPDATE operator.access_identity SET operator_role_id = 'member' WHERE subject = $1", [SUBJECT]);
      assert.equal((await operatorMe(handler, active.cookie)).status, 403, 'reassigned role denies the bound session');
      await db.adminQuery("UPDATE operator.access_identity SET operator_role_id = 'operator_admin' WHERE subject = $1", [SUBJECT]);
      active = await exchangeCookie(handler, assertion({key}));

      await db.adminQuery("UPDATE operator.access_identity SET email = 'changed@example.test' WHERE subject = $1", [SUBJECT]);
      assert.equal((await operatorMe(handler, active.cookie)).status, 403, 'mapping epoch change invalidates the binding');
      await db.adminQuery("UPDATE operator.access_identity SET email = 'operator@example.test' WHERE subject = $1", [SUBJECT]);
      active = await exchangeCookie(handler, assertion({key}));

      await db.adminQuery("UPDATE auth.roles SET is_active = false WHERE role_id = 'operator_admin'");
      assert.equal((await operatorMe(handler, active.cookie)).status, 403, 'deactivated operator role denies use');
      await db.adminQuery("UPDATE auth.roles SET is_active = true WHERE role_id = 'operator_admin'");
      active = await exchangeCookie(handler, assertion({key}));

      await db.adminQuery("UPDATE operator.access_identity SET assurance_class = 'access_asserted' WHERE subject = $1", [SUBJECT]);
      assert.equal((await operatorMe(handler, active.cookie)).status, 403, 'assurance change denies use');
      await db.adminQuery("UPDATE operator.access_identity SET assurance_class = 'access_mfa' WHERE subject = $1", [SUBJECT]);

      // Same local user, different Access subject: bindings and revocations stay isolated.
      const subject2 = 'access-subject-2';
      await seedMapping(db, {subject: subject2});
      clock.advance(2000); // make the new mapping's effective_from observable to the test clock
      const second = await exchangeCookie(handler, assertion({key, claims: {sub: subject2}}));
      await db.adminQuery("UPDATE operator.access_identity SET status = 'revoked' WHERE subject = $1", [SUBJECT]);
      assert.equal((await operatorMe(handler, active.cookie)).status, 403);
      assert.equal((await operatorMe(handler, second.cookie)).status, 200, 'another subject for the same user is unaffected');

      // Source assertion expiry bounds operator use even while the local session is live.
      active = await exchangeCookie(handler, assertion({key, claims: {sub: subject2}}));
      clock.advance(400 * 1000);
      me = await operatorMe(handler, active.cookie);
      assert.equal(me.status, 401);
      assert.equal((await me.json()).error.code, 'OPERATOR_ACCESS_EXPIRED');
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007-R1 canonical replay identity rejects noncanonical signature encodings', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();
      const {handler, validator} = buildHarness({pool: auth.pool, clock, keys: [key]});
      const token = assertion({key, claims: {identity_nonce: null}});

      const altered = alterUnusedSignatureBits(token);
      const first = await validator.validate(token);
      const second = await validator.validate(token);
      assert.equal(first.canonicalDigest, second.canonicalDigest, 'canonical identity is stable');

      const rejected = await handler(exchangeRequest(altered));
      assert.equal(rejected.status, 401, 'noncanonical bearer text is refused');
      assert.equal((await rejected.json()).error.code, 'OPERATOR_ACCESS_INVALID');

      const [a, b] = await Promise.all([
        handler(exchangeRequest(token)),
        handler(exchangeRequest(token)),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [200, 409], 'exactly one simultaneous exchange commits');
      const counts = await exchangeCounts(db);
      assert.equal(counts.exchange, 1);
      assert.equal(counts.binding, 1);
      assert.equal(counts.sessions, 1);
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007-R1 source expiry and max-age freshness are enforced at owned admission', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();

      const gate = makeGate();
      let paused = false;
      const pauseBeforeTransaction = store => {
        const wrapped = {...store};
        wrapped.withTransaction = async action => {
          if (!paused) {
            paused = true;
            gate.enter();
            await gate.gate;
          }
          return store.withTransaction(action);
        };
        return wrapped;
      };
      const expiring = buildHarness({pool: auth.pool, clock, keys: [key], wrapStore: pauseBeforeTransaction});
      const expSoon = assertion({key, claims: {exp: Math.floor(clock.now().getTime() / 1000) + 5}});
      const exchange = expiring.handler(exchangeRequest(expSoon));
      await gate.entered;
      clock.advance(40 * 1000);
      gate.release();
      const expired = await exchange;
      assert.equal(expired.status, 401);
      assert.equal((await expired.json()).error.code, 'OPERATOR_ACCESS_EXPIRED');
      let counts = await exchangeCounts(db);
      assert.deepEqual({exchange: counts.exchange, binding: counts.binding, sessions: counts.sessions, success: counts.success_audit},
        {exchange: 0, binding: 0, sessions: 0, success: 0});

      // Max-age policy requires a finite iat and rechecks age after the pause.
      const ageGate = makeGate();
      let agePaused = false;
      const pauseAge = store => {
        const wrapped = {...store};
        wrapped.withTransaction = async action => {
          if (!agePaused) {
            agePaused = true;
            ageGate.enter();
            await ageGate.gate;
          }
          return store.withTransaction(action);
        };
        return wrapped;
      };
      const aged = buildHarness({
        pool: auth.pool,
        clock,
        keys: [key],
        maxTokenAgeSeconds: 60,
        wrapStore: pauseAge,
      });
      const missingIat = assertion({key, claims: {iat: undefined}});
      const missingIatResponse = await aged.handler(exchangeRequest(missingIat));
      assert.equal(missingIatResponse.status, 401);
      assert.equal((await missingIatResponse.json()).error.code, 'OPERATOR_ACCESS_INVALID');

      const oldToken = assertion({key, claims: {iat: Math.floor(clock.now().getTime() / 1000) - 30}});
      const ageExchange = aged.handler(exchangeRequest(oldToken));
      await ageGate.entered;
      clock.advance(120 * 1000);
      ageGate.release();
      const stale = await ageExchange;
      assert.equal(stale.status, 401);
      assert.equal((await stale.json()).error.code, 'OPERATOR_ACCESS_STALE');
      counts = await exchangeCounts(db);
      assert.equal(counts.exchange, 0);
      assert.equal(counts.sessions, 0);
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007-R1 key refresh coalesces, retains known-good keys and retries after cooldown', async () => {
  const key1 = makeKeys('key-1');
  const key2 = makeKeys('key-2');
  const slow = makeGate();
  let calls = 0;
  const validator = createAccessValidator({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys: [key1],
    clock: () => new Date(),
    refreshCooldownMs: 1000,
    refreshKeys: async () => {
      calls += 1;
      if (calls === 1) {
        slow.enter();
        return slow.gate.then(() => [key1, key2]);
      }
      return [key1, key2];
    },
  });

  // Cached key needs no refresh.
  assert.equal((await validator.validate(assertion({key: key1}))).subject, SUBJECT);
  assert.equal(calls, 0);

  const tokenA = assertion({key: key2});
  const tokenB = assertion({key: key2});
  const first = validator.validate(tokenA);
  const second = validator.validate(tokenB);
  await slow.entered;
  assert.equal(calls, 1, 'simultaneous unknown kids coalesce into one refresh');
  slow.release();
  assert.equal((await first).subject, SUBJECT);
  assert.equal((await second).subject, SUBJECT);
  assert.equal(calls, 1);

  // Failure retains known-good keys, applies a retry cooldown, then recovers.
  let failing = true;
  let failureCalls = 0;
  const failureValidator = createAccessValidator({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys: [key1],
    clock: () => new Date(),
    refreshCooldownMs: 1000,
    refreshKeys: async () => {
      failureCalls += 1;
      if (failing) throw new Error('refresh rejected');
      return [key1, key2];
    },
  });
  await assert.rejects(
    () => failureValidator.validate(assertion({key: key2})),
    error => error instanceof AccessError && error.code === 'OPERATOR_ACCESS_INVALID',
  );
  assert.equal(failureCalls, 1);
  assert.equal((await failureValidator.validate(assertion({key: key1}))).subject, SUBJECT, 'known-good key survives');
  await assert.rejects(
    () => failureValidator.validate(assertion({key: key2})),
    error => error instanceof AccessError && error.code === 'OPERATOR_ACCESS_INVALID',
  );
  assert.equal(failureCalls, 1, 'retry cooldown prevents immediate repeated refresh');
  failing = false;
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await failureValidator.validate(assertion({key: key2}))).subject, SUBJECT);
  assert.equal(failureCalls, 2);
});

test('AUTH-007-R1 mapping authority interleavings: invalidation-first and admission-first', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();

      // Invalidation-first: mapping change commits after validation but before the owned
      // exchange transaction; exchange must fail with no nonce/session/binding.
      const beforeGate = makeGate();
      let pausedBefore = false;
      const pauseBefore = store => {
        const wrapped = {...store};
        wrapped.withTransaction = async action => {
          if (!pausedBefore) {
            pausedBefore = true;
            beforeGate.enter();
            await beforeGate.gate;
          }
          return store.withTransaction(action);
        };
        return wrapped;
      };
      const invalidationHarness = buildHarness({pool: auth.pool, clock, keys: [key], wrapStore: pauseBefore});
      const pending = invalidationHarness.handler(exchangeRequest(assertion({key})));
      await beforeGate.entered;
      await db.adminQuery("UPDATE operator.access_identity SET status = 'revoked' WHERE subject = $1", [SUBJECT]);
      beforeGate.release();
      const refused = await pending;
      assert.equal(refused.status, 403);
      let counts = await exchangeCounts(db);
      assert.equal(counts.exchange, 0);
      assert.equal(counts.sessions, 0);
      await db.adminQuery("UPDATE operator.access_identity SET status = 'active' WHERE subject = $1", [SUBJECT]);

      // Admission-first: exchange holds the shared gate; a mapping update blocks until the
      // business transaction completes, then operator use revalidates the new authority.
      const atGate = makeGate();
      let pausedAtGate = false;
      const pauseAfterGate = store => {
        const wrapped = {...store};
        wrapped.withTransaction = action => store.withTransaction(async tx => {
          const proxy = {
            query: async (text, params) => {
              const result = await tx.query(text, params);
              if (!pausedAtGate && typeof text === 'string' && text.includes('pg_advisory_xact_lock_shared')) {
                pausedAtGate = true;
                atGate.enter();
                await atGate.gate;
              }
              return result;
            },
          };
          return action(proxy);
        });
        return wrapped;
      };
      const admissionHarness = buildHarness({pool: auth.pool, clock, keys: [key], wrapStore: pauseAfterGate});
      const admitted = admissionHarness.handler(exchangeRequest(assertion({key})));
      await atGate.entered;
      const writer = db.adminQuery("UPDATE operator.access_identity SET status = 'revoked' WHERE subject = $1", [SUBJECT]);
      await assert.rejects(
        () => Promise.race([writer, new Promise((_, reject) => setTimeout(() => reject(new Error('blocked')), 250))]),
        /blocked/,
        'mapping writer blocks behind the shared admission gate',
      );
      atGate.release();
      const success = await admitted;
      assert.equal(success.status, 200);
      const cookie = tokenFrom(success);
      await writer;
      assert.equal((await operatorMe(admissionHarness.handler, cookie)).status, 403);
      counts = await exchangeCounts(db);
      assert.equal(counts.exchange, 1);
      assert.equal(counts.sessions, 1);
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007-R1 audit failure rolls back nonce, binding and session; size-one pool works', async () => {
  await withOperatorDatabase(async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth', {max: 1});
    try {
      const clock = testClock();
      const key = makeKeys();
      const writer = createAuditWriter(auth.pool);
      const audit = async (event, options) => {
        if (event.eventType === 'login_success') throw new Error('audit unavailable');
        return writer(event, options);
      };
      const failing = buildHarness({pool: auth.pool, clock, keys: [key], audit});
      const response = await failing.handler(exchangeRequest(assertion({key})));
      assert.equal(response.status, 503);
      let counts = await exchangeCounts(db);
      assert.deepEqual({exchange: counts.exchange, binding: counts.binding, sessions: counts.sessions},
        {exchange: 0, binding: 0, sessions: 0});

      const healthy = buildHarness({pool: auth.pool, clock, keys: [key]});
      const exchanged = await exchangeCookie(healthy.handler, assertion({key}));
      assert.equal((await operatorMe(healthy.handler, exchanged.cookie)).status, 200, 'size-one auth pool composes');
      counts = await exchangeCounts(db);
      assert.equal(counts.exchange, 1);
      assert.equal(counts.binding, 1);
    } finally {
      await auth.close();
    }
  });
});
