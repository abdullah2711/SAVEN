import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
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
  'db/postgres/06-operator-identity.sql',
];

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

function buildHarness({pool, clock, keys, refreshKeys = null, requiredAssurance = 'access_mfa'}) {
  const validator = createAccessValidator({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys,
    refreshKeys,
    clock: clock.clock,
    skewSeconds: 30,
  });
  const store = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
  const operatorAccess = createOperatorAccess({
    validator,
    store,
    clock: clock.clock,
    policy: {requiredAssurance},
  });
  const handler = createAuthRoutes({
    store,
    findUserByEmail: async () => null,
    audit: createAuditWriter(pool),
    origins,
    secureCookies: true,
    clock: clock.clock,
    mfaConfig: {},
    operatorAccess,
  });
  return {validator, store, operatorAccess, handler};
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
  await withAuthDatabase({sqlFiles: authSqlFiles}, async db => {
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
      assert.equal(meBody.operator.assuranceLevel, 'access_asserted');

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
  await withAuthDatabase({sqlFiles: authSqlFiles}, async db => {
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
  await withAuthDatabase({sqlFiles: authSqlFiles}, async db => {
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

test('AUTH-007 MFA assurance is required from a verified claim, not a valid signature alone', async () => {
  await withAuthDatabase({sqlFiles: authSqlFiles}, async db => {
    await seedMapping(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const key = makeKeys();
      const {handler} = buildHarness({pool: auth.pool, clock, keys: [key]});

      const withoutMfa = await handler(exchangeRequest(assertion({key, claims: {amr: []}})));
      assert.equal(withoutMfa.status, 403);
      assert.equal((await withoutMfa.json()).error.code, 'OPERATOR_MFA_REQUIRED');

      const explicit = await handler(exchangeRequest(assertion({key, claims: {amr: [], custom: {assurance: 'access_mfa'}}})));
      assert.equal(explicit.status, 200);

      await db.adminQuery("UPDATE operator.access_identity SET assurance_class = 'access_asserted' WHERE subject = $1", [SUBJECT]);
      const stale = await handler(exchangeRequest(assertion({key, claims: {identity_nonce: randomBytes(12).toString('hex')}})));
      assert.equal(stale.status, 403);
      assert.equal((await stale.json()).error.code, 'OPERATOR_ACCESS_DENIED');
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-007 key rollover uses only the fixed trusted source and fails closed', async () => {
  await withAuthDatabase({sqlFiles: authSqlFiles}, async db => {
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
  await withAuthDatabase({sqlFiles: authSqlFiles}, async db => {
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
  await withAuthDatabase({sqlFiles: authSqlFiles}, async db => {
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
           has_table_privilege($1, 'operator.access_exchange', 'SELECT') AS exchange_select,
           has_table_privilege($1, 'operator.access_exchange', 'INSERT') AS exchange_insert,
           has_table_privilege($1, 'operator.access_exchange', 'DELETE') AS exchange_delete`,
        [db.roles.authService],
      ).then(result => result.rows[0]);
      assert.equal(privileges.identity_select, true);
      assert.equal(privileges.identity_update, false);
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
