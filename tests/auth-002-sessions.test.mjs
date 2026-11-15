import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import pg from 'pg';
import {withAuthDatabase} from './helpers/pg-auth-fixture.mjs';
import {encodePassword} from '../src/passwords.mjs';
import {createAuthServer, createBetterAuthSessions} from '../src/auth/server.mjs';
import {createSessionStore, resolveSessionConfig, SESSION_CEILINGS, SESSION_DEFAULTS, AuthError} from '../src/auth/session-store.mjs';
import {cookieName, sessionCookie} from '../src/auth/routes.mjs';

const {Pool} = pg;
const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const DAY = 24 * 60 * 60 * 1000;
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const customerCookie = cookieName('customer', true);
const quoteRole = name => `"${String(name).replaceAll('"', '""')}"`;
const quoteLiteral = value => `'${String(value).replaceAll("'", "''")}'`;

function connectionConfig(database, overrides = {}) {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database,
    max: 4,
    application_name: 'saven-auth-002-test',
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

async function insertUser(db, email, password, {status = 'active', verified = true} = {}) {
  const encoded = await encodePassword(password);
  const result = await db.adminQuery(
    `INSERT INTO auth.users(email, password_hash, password_scheme, password_updated_at, email_verified, email_verified_at, status)
     VALUES ($1, $2, 'scrypt', now(), $3, CASE WHEN $3 THEN now() ELSE NULL END, $4)
     RETURNING id::text AS id`,
    [email, encoded, verified, status],
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

function meRequest(token, {origin = origins.customer, realm = 'customer'} = {}) {
  return request(`${origin}/v1/auth/me`, {headers: {cookie: `${cookieName(realm, true)}=${token}`}});
}

function logoutRequest(token, csrf, {origin = origins.customer, headers = {}} = {}) {
  const merged = {origin, cookie: `${customerCookie}=${token}`, ...headers};
  if (csrf !== undefined) merged['x-csrf-token'] = csrf;
  return request(`${origin}/v1/auth/logout`, {method: 'POST', headers: merged});
}

function tokenFrom(response) {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${customerCookie}=([^;]+)`).exec(setCookie);
  return match?.[1] ?? null;
}

async function login(handler, email, password, options = {}) {
  const response = await handler(loginRequest({email, password}, options));
  return {response, body: await response.clone().json().catch(() => null), token: tokenFrom(response)};
}

async function sessionState(db, token) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('A session token is required for observation.');
  const result = await db.adminQuery(
    `SELECT id::text AS id, token_hash, csrf_token_hash, realm, credential_version,
            created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revoked_reason
     FROM auth.sessions WHERE token_hash = $1`,
    [sha256(token)],
  );
  return result.rows[0] ?? null;
}

// Creates a real non-owner login that is a member of the fixture's namespaced
// auth-service role. Setup and observation stay on the fixture's administrative
// connection; the exercised service only has the production grants.
async function withAuthServicePool(db, action) {
  const suffix = randomBytes(4).toString('hex');
  const login = `saven_auth_${suffix}_service_login`;
  const password = randomBytes(24).toString('base64url');
  // INHERIT so the login actually receives the auth-service grants; it still owns
  // nothing and has no elevated attribute.
  await db.adminQuery(
    `CREATE ROLE ${quoteRole(login)} LOGIN PASSWORD ${quoteLiteral(password)} ` +
    'NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION',
  );
  await db.adminQuery(`GRANT ${quoteRole(db.roles.authService)} TO ${quoteRole(login)}`);
  const pool = new Pool(connectionConfig(db.database, {user: login, password}));
  try {
    return await action(pool, login);
  } finally {
    await pool.end().catch(() => {});
    await db.adminQuery(`DROP ROLE IF EXISTS ${quoteRole(login)}`).catch(() => {});
  }
}

test('AUTH-002 login persists only a digest and issues a host-only secure cookie', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      const userId = await insertUser(db, 'Owner@Example.com', 'correct-horse-battery');

      const {response, body, token} = await login(handler, 'owner@example.com', 'correct-horse-battery');
      assert.equal(response.status, 200);
      assert.ok(token, 'a session cookie must be issued');
      assert.equal(body.realm, 'customer');
      assert.equal(body.user.id, userId);
      assert.equal(JSON.stringify(body).includes(token), false);
      assert.equal(response.headers.get('cache-control'), 'no-store');

      const setCookie = response.headers.get('set-cookie');
      assert.match(setCookie, /^__Host-saven_session=/);
      assert.match(setCookie, /; HttpOnly/);
      assert.match(setCookie, /; Secure/);
      assert.match(setCookie, /; SameSite=Lax/);
      assert.doesNotMatch(setCookie, /Domain=/i);

      const session = await sessionState(db, token);
      assert.equal(session.token_hash, sha256(token));
      assert.notEqual(session.token_hash, token);
      assert.equal(session.csrf_token_hash, sha256(body.csrfToken));
      assert.equal(session.revoked_at, null);
      assert.equal(session.absolute_expires_at - session.created_at, SESSION_DEFAULTS.absoluteMs);
      assert.equal(session.idle_expires_at - session.created_at, SESSION_DEFAULTS.idleMs);

      const serialized = await db.adminQuery(
        'SELECT row_to_json(s)::text AS json FROM auth.sessions s WHERE id = $1::uuid',
        [session.id],
      );
      assert.equal(serialized.rows[0].json.includes(token), false);
      assert.equal(serialized.rows[0].json.includes(body.csrfToken), false);

      const me = await handler(meRequest(token));
      assert.equal(me.status, 200);
      const meBody = await me.json();
      assert.equal(meBody.user.email, 'Owner@Example.com');
      assert.equal(meBody.session.realm, 'customer');
      assert.equal(JSON.stringify(meBody).includes(token), false);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-002 sessions fail closed on expiry, revocation, disablement and credential epochs', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler, store} = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      await insertUser(db, 'active@example.com', 'correct-horse-battery');

      const idle = await login(handler, 'active@example.com', 'correct-horse-battery');
      clock.advance(SESSION_DEFAULTS.idleMs + 1000);
      assert.equal((await handler(meRequest(idle.token))).status, 401, 'idle expiry must refuse the session');

      const revoked = await login(handler, 'active@example.com', 'correct-horse-battery');
      const out = await handler(logoutRequest(revoked.token, revoked.body.csrfToken));
      assert.equal(out.status, 200);
      assert.equal((await handler(meRequest(revoked.token))).status, 401, 'a revoked session must not resolve');
      assert.equal((await handler(logoutRequest(revoked.token, revoked.body.csrfToken))).status, 401, 'logout replay must fail');

      const disabled = await login(handler, 'active@example.com', 'correct-horse-battery');
      await db.adminQuery(`UPDATE auth.users SET status = 'disabled' WHERE email = 'active@example.com'`);
      assert.equal((await handler(meRequest(disabled.token))).status, 401, 'a disabled identity must not keep a session');
      const disabledLogin = await login(handler, 'active@example.com', 'correct-horse-battery');
      assert.equal(disabledLogin.response.status, 401);
      await db.adminQuery(`UPDATE auth.users SET status = 'active' WHERE email = 'active@example.com'`);

      const epoch = await login(handler, 'active@example.com', 'correct-horse-battery');
      await db.adminQuery(`UPDATE auth.users SET credential_version = credential_version + 1 WHERE email = 'active@example.com'`);
      assert.equal((await handler(meRequest(epoch.token))).status, 401, 'a stale credential epoch must invalidate the session');
      await db.adminQuery(`UPDATE auth.users SET credential_version = 1 WHERE email = 'active@example.com'`);

      const realmSession = await login(handler, 'active@example.com', 'correct-horse-battery');
      assert.equal(await store.readSession(realmSession.token, {realm: 'operator'}), null, 'a customer token must not resolve in the operator realm');

      const operatorLogin = await handler(loginRequest(
        {email: 'active@example.com', password: 'correct-horse-battery'},
        {origin: origins.operator},
      ));
      assert.equal(operatorLogin.status, 403);
      assert.equal((await operatorLogin.json()).error.code, 'OPERATOR_ASSERTION_REQUIRED');
      const operatorRows = await db.adminQuery(`SELECT count(*)::int AS n FROM auth.sessions WHERE realm = 'operator'`);
      assert.equal(operatorRows.rows[0].n, 0, 'no local operator session may be created');
      assert.equal((await handler(meRequest(realmSession.token, {origin: origins.operator}))).status, 403);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-002 activity extends idle expiry but never the absolute ceiling', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      await insertUser(db, 'ceiling@example.com', 'correct-horse-battery');
      const session = await login(handler, 'ceiling@example.com', 'correct-horse-battery');

      const initial = await sessionState(db, session.token);
      const absolute = initial.absolute_expires_at;

      clock.advance(29 * DAY);
      const touched = await handler(meRequest(session.token));
      assert.equal(touched.status, 200);
      const refreshed = await sessionState(db, session.token);
      assert.equal(refreshed.absolute_expires_at.getTime(), absolute.getTime(), 'activity must not move the absolute ceiling');
      assert.ok(refreshed.idle_expires_at.getTime() <= absolute.getTime());
      assert.ok(refreshed.idle_expires_at.getTime() > refreshed.last_seen_at.getTime());

      await assert.rejects(
        () => db.adminQuery(
          `UPDATE auth.sessions SET absolute_expires_at = absolute_expires_at + interval '1 day' WHERE id = $1::uuid`,
          [initial.id],
        ),
        /AUTH_SESSION_ABSOLUTE_EXPIRY_IMMUTABLE/,
      );

      clock.advance(62 * DAY);
      assert.equal((await handler(meRequest(session.token))).status, 401, 'the absolute ceiling must end the session');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-002 rotation is serialized, preserves the ceiling and cannot be replayed', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler, store} = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      await insertUser(db, 'rotate@example.com', 'correct-horse-battery');
      const first = await login(handler, 'rotate@example.com', 'correct-horse-battery');
      const source = await sessionState(db, first.token);

      const [a, b] = await Promise.all([
        store.rotateSession(source.id),
        store.rotateSession(source.id),
      ]);
      const winners = [a, b].filter(Boolean);
      assert.equal(winners.length, 1, 'exactly one concurrent rotation may issue a successor');
      assert.equal(winners[0].session.absoluteExpiresAt, source.absolute_expires_at.toISOString(), 'rotation preserves the ceiling');

      assert.equal((await handler(meRequest(first.token))).status, 401, 'the old token must stop working');
      assert.equal((await handler(meRequest(winners[0].token))).status, 200, 'the single successor must work');
      const live = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.sessions
         WHERE user_id = $1::uuid AND revoked_at IS NULL`,
        [await db.adminQuery(`SELECT user_id::text AS id FROM auth.sessions WHERE id = $1::uuid`, [source.id]).then(r => r.rows[0].id)],
      );
      assert.equal(live.rows[0].n, 1, 'concurrent rotation must not leave two live sessions');

      const old = await sessionState(db, first.token);
      assert.ok(old.revoked_at instanceof Date, 'the source row is revoked, not deleted');
      assert.equal(old.revoked_reason, 'privilege_change');

      assert.equal(await store.rotateSession(source.id), null, 'a revoked session cannot be rotated again');

      const rotated = await store.rotateSession(winners[0].session.id);
      assert.ok(rotated);
      await assert.rejects(
        () => store.withTransaction(async tx => {
          await store.rotateSession(rotated.session.id, {tx});
          throw new Error('simulated mid-operation failure');
        }),
        /simulated mid-operation failure/,
      );
      const afterFailure = await db.adminQuery(
        `SELECT count(*)::int AS n FROM auth.sessions WHERE user_id = $1::uuid AND revoked_at IS NULL`,
        [await db.adminQuery(`SELECT user_id::text AS id FROM auth.sessions WHERE id = $1::uuid`, [source.id]).then(r => r.rows[0].id)],
      );
      assert.equal(afterFailure.rows[0].n, 1, 'a rolled-back rotation leaves the source live and no successor');
      assert.equal((await handler(meRequest(rotated.token))).status, 200, 'the rolled-back successor is not live');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-002 rotation and refresh cannot revive an idle-expired session', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler, store} = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      await insertUser(db, 'expired@example.com', 'correct-horse-battery');
      const session = await login(handler, 'expired@example.com', 'correct-horse-battery');
      const source = await sessionState(db, session.token);

      clock.advance(SESSION_DEFAULTS.idleMs + 60 * 1000);
      assert.equal(await store.refreshSession(source.id), null, 'refresh must not revive an idle-expired row');
      assert.equal(await store.rotateSession(source.id), null, 'rotation must not revive an idle-expired row');
      assert.equal((await handler(meRequest(session.token))).status, 401);

      const rows = await db.adminQuery(`SELECT revoked_at FROM auth.sessions WHERE id = $1::uuid`, [source.id]);
      assert.equal(rows.rows[0].revoked_at, null, 'the expired row is left untouched, not silently rotated');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-002 success and audit commit atomically while failure audit stays durable', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      await insertUser(db, 'atomic@example.com', 'correct-horse-battery');
      const events = [];
      const failingSuccessAudit = async (event, {tx} = {}) => {
        events.push(event.eventType);
        if (event.eventType === 'login_success') throw new Error('audit unavailable');
        const executor = tx ?? pool;
        await executor.query(
          `INSERT INTO auth.auth_audit(event_type, outcome, user_id, realm, detail_jsonb)
           VALUES($1, $2, $3, $4, '{}'::jsonb)`,
          [event.eventType, event.outcome ?? 'success', event.user?.id ?? null, event.realm ?? null],
        );
      };
      const {handler} = createAuthServer({
        pool,
        clock: clock.clock,
        origins,
        secureCookies: true,
        audit: failingSuccessAudit,
      });

      const broken = await login(handler, 'atomic@example.com', 'correct-horse-battery');
      assert.equal(broken.response.status, 503, 'an unrecorded success must not be reported');
      assert.equal(broken.token, null, 'no cookie may be issued when the transaction rolls back');
      const sessions = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions');
      assert.equal(sessions.rows[0].n, 0, 'the session insert must roll back with the failed audit');
      const successRows = await db.adminQuery(`SELECT count(*)::int AS n FROM auth.auth_audit WHERE event_type = 'login_success'`);
      assert.equal(successRows.rows[0].n, 0, 'no success audit row may survive the rollback');

      const failure = await login(handler, 'atomic@example.com', 'wrong-password-value');
      assert.equal(failure.response.status, 401);
      const failureRows = await db.adminQuery(`SELECT count(*)::int AS n FROM auth.auth_audit WHERE event_type = 'login_failure'`);
      assert.equal(failureRows.rows[0].n, 1, 'a failed login is audited on its own durable path');
      assert.ok(events.includes('login_failure'));

      // Logout audit failure must roll the revocation back.
      const working = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      const session = await login(working.handler, 'atomic@example.com', 'correct-horse-battery');
      const failingLogoutAudit = async (event, {tx} = {}) => {
        if (event.eventType === 'logout') throw new Error('audit unavailable');
        const executor = tx ?? pool;
        await executor.query(
          `INSERT INTO auth.auth_audit(event_type, outcome, user_id, realm, detail_jsonb)
           VALUES($1, $2, $3, $4, '{}'::jsonb)`,
          [event.eventType, event.outcome ?? 'success', event.user?.id ?? null, event.realm ?? null],
        );
      };
      const brokenLogout = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true, audit: failingLogoutAudit});
      const logout = await brokenLogout.handler(logoutRequest(session.token, session.body.csrfToken));
      assert.equal(logout.status, 503);
      const stillLive = await sessionState(db, session.token);
      assert.equal(stillLive.revoked_at, null, 'the failed audit must roll the revocation back');
      assert.equal((await working.handler(meRequest(session.token))).status, 200);
      const logoutRows = await db.adminQuery(`SELECT count(*)::int AS n FROM auth.auth_audit WHERE event_type = 'logout'`);
      assert.equal(logoutRows.rows[0].n, 0, 'no logout audit row may survive the rollback');
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-002 CSRF, origin, content-type and field boundaries refuse client authority', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      await insertUser(db, 'boundary@example.com', 'correct-horse-battery');
      const session = await login(handler, 'boundary@example.com', 'correct-horse-battery');

      assert.equal((await handler(logoutRequest(session.token))).status, 403, 'CSRF header is required');
      assert.equal((await handler(logoutRequest(session.token, 'not-the-csrf-value'))).status, 403, 'a wrong CSRF value is refused');
      assert.equal((await handler(meRequest(session.token))).status, 200, 'a refused logout must not revoke the session');

      const missingOrigin = await handler(request(`${origins.customer}/v1/auth/login`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email: 'boundary@example.com', password: 'correct-horse-battery'}),
      }));
      assert.equal(missingOrigin.status, 403);
      assert.equal((await handler(loginRequest(
        {email: 'boundary@example.com', password: 'correct-horse-battery'},
        {origin: 'https://evil.example'},
      ))).status, 421);

      const wrongType = await handler(request(`${origins.customer}/v1/auth/login`, {
        method: 'POST',
        headers: {origin: origins.customer, 'content-type': 'text/plain'},
        body: 'email=boundary@example.com',
      }));
      assert.equal(wrongType.status, 415);

      const before = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions');
      const forged = await handler(loginRequest({
        email: 'boundary@example.com',
        password: 'correct-horse-battery',
        userId: '00000000-0000-4000-8000-000000000000',
        tenantId: '00000000-0000-4000-8000-000000000001',
        roleId: 'ultimate_owner',
        credentialVersion: 99,
      }));
      assert.equal(forged.status, 400);
      assert.equal((await forged.json()).error.code, 'UNKNOWN_FIELDS');
      const after = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions');
      assert.equal(after.rows[0].n, before.rows[0].n);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-002 failures are non-enumerating and audited without secrets', async () => {
  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {handler} = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      await insertUser(db, 'known@example.com', 'correct-horse-battery');

      const wrongPassword = await login(handler, 'known@example.com', 'wrong-password-value');
      const unknownIdentity = await login(handler, 'nobody@example.com', 'wrong-password-value');
      assert.equal(wrongPassword.response.status, 401);
      assert.equal(unknownIdentity.response.status, 401);
      assert.deepEqual(wrongPassword.body, unknownIdentity.body);

      const success = await login(handler, 'known@example.com', 'correct-horse-battery');
      await handler(logoutRequest(success.token, success.body.csrfToken));

      const events = await db.adminQuery(
        `SELECT event_type, outcome, user_id IS NOT NULL AS has_user FROM auth.auth_audit ORDER BY id`,
      );
      const types = events.rows.map(row => `${row.event_type}:${row.outcome}`);
      assert.ok(types.includes('login_failure:failure'));
      assert.ok(types.includes('login_success:success'));
      assert.ok(types.includes('logout:success'));
      const failures = events.rows.filter(row => row.event_type === 'login_failure');
      assert.ok(failures.some(row => row.has_user === false));
      assert.ok(failures.some(row => row.has_user === true));

      const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
      const joined = serialized.rows.map(row => row.json).join('\n');
      for (const secret of ['correct-horse-battery', 'wrong-password-value', success.token, success.body.csrfToken, 'known@example.com']) {
        assert.equal(joined.includes(secret), false, `audit rows must not contain ${secret.slice(0, 12)}…`);
      }

      await assert.rejects(() => db.adminQuery(`UPDATE auth.auth_audit SET outcome = 'success'`), /AUTH_RECORD_IMMUTABLE/);
      await assert.rejects(() => db.adminQuery('DELETE FROM auth.auth_audit'), /AUTH_RECORD_IMMUTABLE/);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-002 plaintext tokens never cross the database boundary on the real role', async () => {
  await withAuthDatabase(async db => {
    const calls = [];
    const clock = testClock();
    await insertUser(db, 'boundary-spy@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async (pool, roleLogin) => {
      const spyPool = {
        async connect() {
          const client = await pool.connect();
          const original = client.query.bind(client);
          client.query = (text, params) => {
            calls.push({text, params});
            return original(text, params);
          };
          return client;
        },
        query(text, params) {
          calls.push({text, params});
          return pool.query(text, params);
        },
      };
      const {handler, store} = createAuthServer({pool: spyPool, clock: clock.clock, origins, secureCookies: true});
      const session = await login(handler, 'boundary-spy@example.com', 'correct-horse-battery');
      assert.equal(session.response.status, 200, `${roleLogin} must authenticate with only auth-service grants`);
      assert.equal((await handler(meRequest(session.token))).status, 200);
      const source = await sessionState(db, session.token);
      const rotated = await store.rotateSession(source.id);
      const userId = await db.adminQuery(`SELECT user_id::text AS id FROM auth.sessions WHERE id = $1::uuid`, [source.id])
        .then(result => result.rows[0].id);
      await store.revokeSession(rotated.token, {reason: 'logout'});
      await store.revokeAllSessions(userId);

      const secrets = [session.token, session.body.csrfToken, rotated.token, rotated.csrfToken];
      for (const call of calls) {
        for (const secret of secrets) {
          assert.equal(call.text.includes(secret), false, 'SQL text must never contain a live token');
          for (const param of call.params ?? []) {
            assert.equal(String(param).includes(secret), false, 'a query parameter must never contain a live token');
          }
        }
        for (const param of call.params ?? []) {
          if (typeof param === 'string' && /^[0-9a-f]{64}$/.test(param)) continue;
          assert.doesNotMatch(String(param), /^[A-Za-z0-9_-]{40,}$/, 'long opaque values may only travel as digests');
        }
      }
      assert.ok(calls.some(call => call.text.includes('token_hash')));
    });
  });
});

test('AUTH-002 configuration enforces ADR ceilings and effective dates', async () => {
  assert.deepEqual(resolveSessionConfig({}), {...SESSION_DEFAULTS});
  assert.deepEqual(resolveSessionConfig({idleMs: 60 * 60 * 1000, absoluteMs: 2 * 60 * 60 * 1000}), {
    idleMs: 60 * 60 * 1000,
    absoluteMs: 2 * 60 * 60 * 1000,
    tokenBytes: 32,
  });
  for (const bad of [
    {idleMs: SESSION_CEILINGS.idleMs + 1},
    {absoluteMs: SESSION_CEILINGS.absoluteMs + 1},
    {idleMs: 2 * DAY, absoluteMs: DAY},
    {idleMs: 1.5},
    {absoluteMs: NaN},
    {tokenBytes: 16},
    {tokenBytes: 128},
  ]) {
    assert.throws(() => resolveSessionConfig(bad), undefined, JSON.stringify(bad));
  }

  await withAuthDatabase(async db => {
    const pool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => pool.connect(), clock: clock.clock});
      const userId = await insertUser(db, 'config@example.com', 'correct-horse-battery');
      await db.asRole('migrator', client => client.query(
        `INSERT INTO auth.reference_value(domain, value, label, effective_from)
         VALUES('realm', 'future_realm', 'Future realm', now() + interval '1 day')`,
      ), {commit: true});
      await assert.rejects(
        () => store.createSession({
          userId,
          realm: 'future_realm',
          credentialVersion: 1,
        }),
        error => error instanceof AuthError && error.code === 'SESSION_REALM_INVALID',
        'a future-dated realm value must not be usable',
      );
      await db.asRole('migrator', client => client.query(
        `INSERT INTO auth.roles(role_id, label, effective_from)
         VALUES('future_role', 'Future role', now() + interval '1 day')`,
      ), {commit: true});
      await assert.rejects(
        () => store.createSession({userId, roleId: 'future_role', credentialVersion: 1}),
        error => error instanceof AuthError && error.code === 'SESSION_ROLE_INVALID',
        'a future-dated assurance role must not be usable',
      );
      const short = createSessionStore({
        connect: () => pool.connect(),
        clock: clock.clock,
        config: {idleMs: 60 * 60 * 1000, absoluteMs: 2 * 60 * 60 * 1000},
      });
      const created = await short.createSession({userId, credentialVersion: 1});
      const row = await sessionState(db, created.token);
      assert.equal(row.absolute_expires_at - row.created_at, 2 * 60 * 60 * 1000);
      assert.equal(row.idle_expires_at - row.created_at, 60 * 60 * 1000);
    } finally {
      await pool.end();
    }
  });
});

test('AUTH-002 lifecycle and failure paths run under the real auth-service role', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    await insertUser(db, 'realrole@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async (pool, roleLogin) => {
      const {handler, store} = createAuthServer({pool, clock: clock.clock, origins, secureCookies: true});
      const session = await login(handler, 'realrole@example.com', 'correct-horse-battery');
      assert.equal(session.response.status, 200);
      assert.equal((await handler(meRequest(session.token))).status, 200);
      const source = await sessionState(db, session.token);
      const rotated = await store.rotateSession(source.id);
      assert.ok(rotated);
      assert.equal((await handler(meRequest(session.token))).status, 401);
      assert.equal((await handler(meRequest(rotated.token))).status, 200);
      assert.equal((await handler(logoutRequest(rotated.token, rotated.csrfToken))).status, 200);
      assert.equal((await handler(meRequest(rotated.token))).status, 401);

      const auditRows = await db.adminQuery(
        `SELECT event_type FROM auth.auth_audit WHERE event_type IN ('login_success','logout') ORDER BY id`,
      );
      assert.ok(auditRows.rows.some(row => row.event_type === 'login_success'));
      assert.ok(auditRows.rows.some(row => row.event_type === 'logout'));

      const owner = await pool.query('SELECT current_user AS name').then(result => result.rows[0].name);
      assert.equal(owner, roleLogin);
      const ddl = await pool.query('ALTER TABLE auth.sessions ADD COLUMN probe integer')
        .then(() => 'allowed')
        .catch(error => error.code);
      assert.equal(ddl, '42501', 'the runtime role must not own or alter auth tables');
    });
  });
});

test('AUTH-002 pinned Better Auth drives the digest-only session lifecycle', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const userId = await insertUser(db, 'library@example.com', 'correct-horse-battery');
    await withAuthServicePool(db, async (pool) => {
      const calls = [];
      const spyPool = {
        async connect() {
          const client = await pool.connect();
          const original = client.query.bind(client);
          client.query = (text, params) => {
            calls.push({text, params});
            return original(text, params);
          };
          return client;
        },
        query(text, params) {
          calls.push({text, params});
          return pool.query(text, params);
        },
      };
      const {auth, context} = await createBetterAuthSessions({
        pool: spyPool,
        origins,
        secret: 'test-only-library-secret-that-is-long-enough',
        clock: clock.clock,
      });
      assert.equal(auth.options.session.cookieCache.enabled, false, 'cookie-only authority must stay disabled');

      const created = await context.internalAdapter.createSession(userId, false);
      assert.ok(typeof created.token === 'string' && created.token.length >= 32, 'the library must issue a strong token');
      const stored = await sessionState(db, created.token);
      assert.ok(stored, 'the library session must be persisted');
      assert.equal(stored.token_hash, sha256(created.token));
      assert.notEqual(stored.token_hash, created.token);

      const found = await context.internalAdapter.findSession(created.token);
      assert.ok(found, 'the library must find its session through the digest adapter');
      assert.equal(found.session.userId, userId);
      assert.equal(found.user.email, 'library@example.com');

      const missing = await context.internalAdapter.findSession(created.token + 'x');
      assert.equal(missing, null, 'a wrong token must not resolve');

      const before = stored.absolute_expires_at;
      await context.internalAdapter.updateSession(created.token, {
        expiresAt: new Date(clock.now().getTime() + 60 * 60 * 1000),
      });
      const refreshed = await sessionState(db, created.token);
      assert.equal(refreshed.absolute_expires_at.getTime(), before.getTime(), 'library refresh must not move the ceiling');
      assert.ok(refreshed.idle_expires_at.getTime() <= before.getTime());

      await context.internalAdapter.deleteSession(created.token);
      const revoked = await sessionState(db, created.token);
      assert.ok(revoked.revoked_at instanceof Date, 'library revoke must be a revocation UPDATE, not a delete');
      assert.equal(await context.internalAdapter.findSession(created.token), null, 'a revoked library session must not resolve');

      const serialized = await db.adminQuery('SELECT row_to_json(s)::text AS json FROM auth.sessions s');
      assert.equal(serialized.rows.map(row => row.json).join('\n').includes(created.token), false);
      for (const call of calls) {
        for (const param of call.params ?? []) {
          assert.equal(String(param).includes(created.token), false, 'the library adapter must hash before SQL');
        }
      }
    });
  });
});

test('AUTH-002 cookie policy distinguishes realms and local fixtures', () => {
  const customer = sessionCookie({realm: 'customer', token: 'opaque', secure: true, maxAgeSeconds: 100});
  assert.match(customer, /^__Host-saven_session=opaque/);
  assert.match(customer, /SameSite=Lax/);
  assert.match(customer, /; Secure/);
  assert.doesNotMatch(customer, /Domain=/i);

  const operator = sessionCookie({realm: 'operator', token: 'opaque', secure: true, maxAgeSeconds: 100});
  assert.match(operator, /^__Host-saven_operator_session=opaque/);
  assert.match(operator, /SameSite=Strict/);

  const local = sessionCookie({realm: 'customer', token: 'opaque', secure: false, maxAgeSeconds: 100});
  assert.match(local, /^saven_session=opaque/);
  assert.doesNotMatch(local, /__Host-/);
  assert.doesNotMatch(local, /; Secure/);

  const cleared = sessionCookie({realm: 'customer', token: '', secure: true, maxAgeSeconds: 0});
  assert.match(cleared, /Max-Age=0/);
});
