import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {withAuthDatabase} from './helpers/pg-auth-fixture.mjs';
import {encodePassword} from '../src/passwords.mjs';
import {createAuthServer} from '../src/auth/server.mjs';
import {createSessionStore, SESSION_DEFAULTS} from '../src/auth/session-store.mjs';
import {cookieName, sessionCookie} from '../src/auth/routes.mjs';

const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const DAY = 24 * 60 * 60 * 1000;
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const customerCookie = cookieName('customer', true);

function testClock(start = '2026-11-15T00:00:00.000Z') {
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
  return request(`${origin}/v1/auth/login`, {
    method: 'POST',
    headers: {origin, ...headers},
    body,
  });
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

test('AUTH-002 login persists only a digest and issues a host-only secure cookie', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const {handler} = createAuthServer({pool: db.admin, clock: clock.clock, origins, secureCookies: true});
    const userId = await insertUser(db, 'Owner@Example.com', 'correct-horse-battery');

    const {response, body, token} = await login(handler, 'owner@example.com', 'correct-horse-battery');
    assert.equal(response.status, 200);
    assert.ok(token, 'a session cookie must be issued');
    assert.equal(body.realm, 'customer');
    assert.equal(body.user.id, userId);
    assert.equal(body.user.email, 'Owner@Example.com');
    assert.equal(JSON.stringify(body).includes(token), false, 'the session token must never appear in the response body');
    assert.ok(typeof body.csrfToken === 'string' && body.csrfToken.length >= 32);

    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /^__Host-saven_session=/);
    assert.match(setCookie, /; Path=\//);
    assert.match(setCookie, /; HttpOnly/);
    assert.match(setCookie, /; Secure/);
    assert.match(setCookie, /; SameSite=Lax/);
    assert.doesNotMatch(setCookie, /Domain=/i);
    assert.equal(response.headers.get('cache-control'), 'no-store');

    const row = await db.adminQuery(
      `SELECT id::text AS id, token_hash, csrf_token_hash, realm, credential_version,
              created_at, last_seen_at, idle_expires_at, absolute_expires_at,
              (absolute_expires_at - created_at) AS absolute_span,
              (idle_expires_at - created_at) AS idle_span
       FROM auth.sessions WHERE token_hash = $1`,
      [sha256(token)],
    );
    assert.equal(row.rowCount, 1, 'the session row must be found by the digest only');
    const session = row.rows[0];
    assert.equal(session.token_hash, sha256(token));
    assert.notEqual(session.token_hash, token);
    assert.match(session.token_hash, /^[0-9a-f]{64}$/);
    assert.equal(session.csrf_token_hash, sha256(body.csrfToken));
    assert.equal(session.realm, 'customer');
    assert.equal(Number(session.credential_version), 1);
    assert.equal(session.absolute_span.days, 90);
    assert.equal(session.idle_span.days, 30);
    assert.equal(session.last_seen_at.getTime(), session.created_at.getTime());

    const serialized = await db.adminQuery(
      'SELECT row_to_json(s)::text AS json FROM auth.sessions s WHERE id = $1::uuid',
      [session.id],
    );
    assert.equal(serialized.rows[0].json.includes(token), false, 'no column may contain the plaintext token');
    assert.equal(serialized.rows[0].json.includes(body.csrfToken), false, 'no column may contain the plaintext CSRF value');

    const me = await handler(meRequest(token));
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.user.email, 'Owner@Example.com');
    assert.equal(meBody.session.realm, 'customer');
    assert.equal(meBody.session.assuranceLevel, 'single_factor');
    assert.equal(JSON.stringify(meBody).includes(token), false);
    assert.equal(me.headers.get('cache-control'), 'no-store');
  });
});

test('AUTH-002 sessions fail closed on expiry, revocation, disablement and credential epochs', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const {handler, store} = createAuthServer({pool: db.admin, clock: clock.clock, origins, secureCookies: true});
    await insertUser(db, 'active@example.com', 'correct-horse-battery');

    const idle = await login(handler, 'active@example.com', 'correct-horse-battery');
    clock.advance(SESSION_DEFAULTS.idleMs + 1000);
    assert.equal((await handler(meRequest(idle.token))).status, 401, 'idle expiry must refuse the session');

    clock.advance(0);
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
    await db.adminQuery(
      `UPDATE auth.users SET credential_version = credential_version + 1 WHERE email = 'active@example.com'`,
    );
    assert.equal((await handler(meRequest(epoch.token))).status, 401, 'a stale credential epoch must invalidate the session');

    await db.adminQuery(
      `UPDATE auth.users SET credential_version = 1 WHERE email = 'active@example.com'`,
    );
    const realmSession = await login(handler, 'active@example.com', 'correct-horse-battery');
    assert.equal(await store.readSession(realmSession.token, {realm: 'operator'}), null, 'a customer token must not resolve in the operator realm');

    const operatorLogin = await handler(loginRequest(
      {email: 'active@example.com', password: 'correct-horse-battery'},
      {origin: origins.operator},
    ));
    assert.equal(operatorLogin.status, 403);
    const operatorBody = await operatorLogin.json();
    assert.equal(operatorBody.error.code, 'OPERATOR_ASSERTION_REQUIRED');
    const operatorRows = await db.adminQuery(
      `SELECT count(*)::int AS n FROM auth.sessions WHERE realm = 'operator'`,
    );
    assert.equal(operatorRows.rows[0].n, 0, 'no local operator session may be created');
    const operatorMe = await handler(meRequest(realmSession.token, {origin: origins.operator}));
    assert.equal(operatorMe.status, 403, 'the operator realm fails closed before session resolution');
  });
});

test('AUTH-002 activity extends idle expiry but never the absolute ceiling', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const {handler} = createAuthServer({pool: db.admin, clock: clock.clock, origins, secureCookies: true});
    await insertUser(db, 'ceiling@example.com', 'correct-horse-battery');
    const session = await login(handler, 'ceiling@example.com', 'correct-horse-battery');

    const initial = await db.adminQuery(
      `SELECT id::text AS id, absolute_expires_at FROM auth.sessions WHERE token_hash = $1`,
      [sha256(session.token)],
    );
    const absolute = initial.rows[0].absolute_expires_at;

    clock.advance(29 * DAY);
    const touched = await handler(meRequest(session.token));
    assert.equal(touched.status, 200);
    const refreshed = await db.adminQuery(
      `SELECT idle_expires_at, last_seen_at, absolute_expires_at FROM auth.sessions WHERE id = $1::uuid`,
      [initial.rows[0].id],
    );
    assert.equal(refreshed.rows[0].absolute_expires_at.getTime(), absolute.getTime(), 'activity must not move the absolute ceiling');
    assert.ok(refreshed.rows[0].idle_expires_at.getTime() > refreshed.rows[0].last_seen_at.getTime());
    assert.ok(refreshed.rows[0].idle_expires_at.getTime() <= absolute.getTime());

    // Even by direct SQL the ceiling cannot be extended; AUTH-001's trigger owns this.
    await assert.rejects(
      () => db.adminQuery(
        `UPDATE auth.sessions SET absolute_expires_at = absolute_expires_at + interval '1 day' WHERE id = $1::uuid`,
        [initial.rows[0].id],
      ),
      /AUTH_SESSION_ABSOLUTE_EXPIRY_IMMUTABLE/,
    );

    clock.advance(62 * DAY);
    assert.equal((await handler(meRequest(session.token))).status, 401, 'the absolute ceiling must end the session');
  });
});

test('AUTH-002 rotation and revocation keep history and invalidate old tokens', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const {handler, store} = createAuthServer({pool: db.admin, clock: clock.clock, origins, secureCookies: true});
    await insertUser(db, 'rotate@example.com', 'correct-horse-battery');
    const first = await login(handler, 'rotate@example.com', 'correct-horse-battery');

    const before = await db.adminQuery(
      `SELECT id::text AS id, absolute_expires_at, user_id::text AS user_id FROM auth.sessions WHERE token_hash = $1`,
      [sha256(first.token)],
    );
    const rotated = await store.rotateSession(before.rows[0].id, {reason: 'privilege_change', actor: before.rows[0].user_id});
    assert.ok(rotated.token && rotated.token !== first.token);
    assert.equal(rotated.session.absoluteExpiresAt, before.rows[0].absolute_expires_at.toISOString(), 'rotation must preserve the absolute ceiling');

    assert.equal((await handler(meRequest(first.token))).status, 401, 'the old token must stop working');
    assert.equal((await handler(meRequest(rotated.token))).status, 200, 'the rotated token must work');

    const history = await db.adminQuery(
      `SELECT revoked_at, revoked_reason, revoked_by FROM auth.sessions WHERE token_hash = $1`,
      [sha256(first.token)],
    );
    assert.ok(history.rows[0].revoked_at instanceof Date, 'the old row is revoked, not deleted');
    assert.equal(history.rows[0].revoked_reason, 'privilege_change');

    const revokedCount = await store.revokeAllSessions(before.rows[0].user_id, {reason: 'sessions_revoked_all'});
    assert.ok(revokedCount >= 1);
    assert.equal((await handler(meRequest(rotated.token))).status, 401, 'revoke-all must invalidate every live token');
  });
});

test('AUTH-002 CSRF, origin, content-type and field boundaries refuse client authority', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const {handler} = createAuthServer({pool: db.admin, clock: clock.clock, origins, secureCookies: true});
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
    const foreignOrigin = await handler(loginRequest(
      {email: 'boundary@example.com', password: 'correct-horse-battery'},
      {origin: 'https://evil.example'},
    ));
    assert.equal(foreignOrigin.status, 421);

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
    assert.equal(forged.status, 400, 'client-supplied identity fields are refused');
    assert.equal((await forged.json()).error.code, 'UNKNOWN_FIELDS');
    const after = await db.adminQuery('SELECT count(*)::int AS n FROM auth.sessions');
    assert.equal(after.rows[0].n, before.rows[0].n, 'a refused login must not create a session');
  });
});

test('AUTH-002 failures are non-enumerating and audited without secrets', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const {handler} = createAuthServer({pool: db.admin, clock: clock.clock, origins, secureCookies: true});
    await insertUser(db, 'known@example.com', 'correct-horse-battery');

    const wrongPassword = await login(handler, 'known@example.com', 'wrong-password-value');
    const unknownIdentity = await login(handler, 'nobody@example.com', 'wrong-password-value');
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(unknownIdentity.response.status, 401);
    assert.deepEqual(wrongPassword.body, unknownIdentity.body, 'failures must not disclose account existence');

    const success = await login(handler, 'known@example.com', 'correct-horse-battery');
    await handler(logoutRequest(success.token, success.body.csrfToken));

    const events = await db.adminQuery(
      `SELECT event_type, outcome, user_id IS NOT NULL AS has_user, detail_jsonb::text AS detail
       FROM auth.auth_audit ORDER BY id`,
    );
    const types = events.rows.map(row => `${row.event_type}:${row.outcome}`);
    assert.ok(types.includes('login_failure:failure'));
    assert.ok(types.includes('login_success:success'));
    assert.ok(types.includes('logout:success'));
    const failures = events.rows.filter(row => row.event_type === 'login_failure');
    assert.ok(failures.some(row => row.has_user === false), 'an unknown identity is still audited without invented attribution');
    assert.ok(failures.some(row => row.has_user === true), 'a known identity failure is attributed to its user');

    const serialized = await db.adminQuery('SELECT row_to_json(a)::text AS json FROM auth.auth_audit a');
    const joined = serialized.rows.map(row => row.json).join('\n');
    for (const secret of ['correct-horse-battery', 'wrong-password-value', success.token, success.body.csrfToken, 'known@example.com']) {
      assert.equal(joined.includes(secret), false, `audit rows must not contain ${secret.slice(0, 12)}…`);
    }

    // The audit trail is append-only even for the fixture's administrative principal.
    await assert.rejects(
      () => db.adminQuery(`UPDATE auth.auth_audit SET outcome = 'success'`),
      /AUTH_RECORD_IMMUTABLE/,
    );
    await assert.rejects(
      () => db.adminQuery('DELETE FROM auth.auth_audit'),
      /AUTH_RECORD_IMMUTABLE/,
    );
  });
});

test('AUTH-002 the plaintext token never crosses the database boundary', async () => {
  await withAuthDatabase(async db => {
    const clock = testClock();
    const calls = [];
    const spyPool = {
      query(text, params = []) {
        calls.push({text, params});
        return db.admin.query(text, params);
      },
    };
    const {handler, store} = createAuthServer({
      pool: spyPool,
      clock: clock.clock,
      origins,
      secureCookies: true,
    });
    await insertUser(db, 'boundary-spy@example.com', 'correct-horse-battery');
    const session = await login(handler, 'boundary-spy@example.com', 'correct-horse-battery');
    assert.equal((await handler(meRequest(session.token))).status, 200);
    const row = await db.adminQuery(
      `SELECT id::text AS id FROM auth.sessions WHERE token_hash = $1`,
      [sha256(session.token)],
    );
    const rotated = await store.rotateSession(row.rows[0].id);
    await store.revokeSession(rotated.token, {reason: 'logout'});
    await store.revokeAllSessions(row.rows[0].id);

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
    assert.ok(calls.some(call => call.text.includes('token_hash')), 'the adapter must persist token hashes');
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
  assert.match(local, /^saven_session=opaque/, 'local HTTP fixtures use an explicitly separate non-production cookie name');
  assert.doesNotMatch(local, /__Host-/);
  assert.doesNotMatch(local, /; Secure/);

  const cleared = sessionCookie({realm: 'customer', token: '', secure: true, maxAgeSeconds: 0});
  assert.match(cleared, /Max-Age=0/);
});
