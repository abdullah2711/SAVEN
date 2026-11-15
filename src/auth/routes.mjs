import {timingSafeEqual} from 'node:crypto';
import {AuthError, digestToken, isTokenDigest} from './session-store.mjs';

// AUTH-002 versioned auth routes (AUTH-002-R1). They remain independent of the
// active SQLite `/api` handler: nothing here is wired into a native entry point.
//
// Success transitions are atomic: the session row and its success audit row are
// written on one checked-out transaction client, and the cookie is only issued after
// commit. Failed-login audit is written independently so a rolled-back attempt is
// still recorded. Rotation and logout validate the session under a row lock at the
// mutation boundary.
//
// Realm separation: exact-origin allowlists only. Customer realm uses a host-only
// `__Host-` cookie with SameSite=Lax; the operator realm is reserved for AUTH-007 and
// fails closed instead of accepting a local password.

const MAX_BODY_BYTES = 32 * 1024;
const EMAIL_MAX = 320;
const PASSWORD_MAX = 128;
const PASSWORD_MIN = 1;

export const REALMS = Object.freeze({
  customer: {cookieBase: 'saven_session', sameSite: 'Lax'},
  operator: {cookieBase: 'saven_operator_session', sameSite: 'Strict'},
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function failure(status, code, message) {
  return json({error: {code, message}}, status);
}

export function cookieName(realm, secure) {
  const config = REALMS[realm];
  if (!config) throw new Error('Unknown cookie realm.');
  return secure ? `__Host-${config.cookieBase}` : config.cookieBase;
}

export function sessionCookie({realm, token, secure = true, maxAgeSeconds}) {
  const config = REALMS[realm];
  if (!config) throw new Error('Unknown cookie realm.');
  const attributes = [
    `${cookieName(realm, secure)}=${token ?? ''}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${config.sameSite}`,
  ];
  if (secure) attributes.push('Secure');
  attributes.push(`Max-Age=${token ? maxAgeSeconds : 0}`);
  return attributes.join('; ');
}

// The client sends the plaintext CSRF value; only its digest is stored. Compare in
// constant time over equal-length digests, and never echo the value back.
function csrfMatches(provided, storedDigest) {
  if (!isTokenDigest(storedDigest) || typeof provided !== 'string' || provided.length === 0) return false;
  let digest;
  try {
    digest = digestToken(provided);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(storedDigest, 'hex'));
}

function readCookies(request) {
  const header = request.headers.get('cookie') ?? '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(email) {
  return email.length >= 3 && email.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function createAuthRoutes({
  store,
  findUserByEmail,
  verifyPassword,
  audit = async () => {},
  origins,
  secureCookies = true,
  clock = () => new Date(),
}) {
  if (!store || typeof store.createSession !== 'function' || typeof store.withTransaction !== 'function') {
    throw new Error('createAuthRoutes requires a transactional session store.');
  }
  if (typeof findUserByEmail !== 'function') throw new Error('createAuthRoutes requires findUserByEmail.');
  if (typeof verifyPassword !== 'function') throw new Error('createAuthRoutes requires verifyPassword.');
  if (!origins || typeof origins !== 'object') throw new Error('createAuthRoutes requires exact realm origins.');
  const customerOrigin = new URL(origins.customer).origin;
  const operatorOrigin = new URL(origins.operator).origin;
  if (customerOrigin === operatorOrigin) throw new Error('Separate customer and operator origins required.');
  const cookieMaxAge = Math.floor((store.config?.absoluteMs ?? 90 * 24 * 60 * 60 * 1000) / 1000);

  function realmFor(url) {
    if (url.origin === customerOrigin) return 'customer';
    if (url.origin === operatorOrigin) return 'operator';
    throw new AuthError(421, 'ORIGIN_UNRECOGNIZED', 'Unrecognized application origin.');
  }

  async function readJson(request) {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      throw new AuthError(415, 'JSON_REQUIRED', 'JSON content is required.');
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      throw new AuthError(413, 'BODY_TOO_LARGE', 'Request too large.');
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AuthError(400, 'JSON_INVALID', 'Invalid JSON.');
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new AuthError(400, 'JSON_INVALID', 'A JSON object is required.');
    }
    return parsed;
  }

  async function login(request, url, realm) {
    // Cloud operator authentication is delegated to validated Cloudflare Access/IdP
    // assertions (AUTH-007). No local operator password path exists in this route.
    if (realm === 'operator') {
      throw new AuthError(403, 'OPERATOR_ASSERTION_REQUIRED', 'Operator access uses an asserted identity provider; local operator sign-in is not enabled.');
    }
    if (request.headers.get('origin') !== url.origin) {
      throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    }
    const body = await readJson(request);
    const unknown = Object.keys(body).filter(key => !['email', 'password'].includes(key));
    if (unknown.length > 0) {
      throw new AuthError(400, 'UNKNOWN_FIELDS', 'Unknown sign-in fields.');
    }
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!validEmail(email) || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      await audit({eventType: 'login_failure', outcome: 'failure', realm, request, detail: {reason: 'invalid_request'}});
      throw new AuthError(401, 'SIGN_IN_FAILED', 'The email or password is incorrect.');
    }
    const user = await findUserByEmail(email);
    // A missing user still runs a bounded dummy verification so response timing does
    // not disclose account existence.
    const credential = user && user.passwordHash
      ? {hash: user.passwordHash, scheme: user.passwordScheme}
      : null;
    const verified = await verifyPassword(password, credential);
    if (!user || !verified || user.status !== 'active') {
      // Failure audit is its own durable statement path: no business transaction is
      // open and nothing was created, so the record survives the refused request.
      await audit({
        eventType: 'login_failure',
        outcome: 'failure',
        realm,
        user,
        request,
        detail: {reason: user ? 'invalid_credentials' : 'unknown_identity'},
      });
      throw new AuthError(401, 'SIGN_IN_FAILED', 'The email or password is incorrect.');
    }

    // The session and its success audit commit together on one client. The cookie is
    // only returned after commit, so an audit or commit failure leaves no live session.
    const created = await store.withTransaction(async tx => {
      const session = await store.createSession({
        userId: user.id,
        realm,
        roleId: null,
        assuranceLevel: 'single_factor',
        ipAddress: request.headers.get('cf-connecting-ip') ?? null,
        userAgent: request.headers.get('user-agent') ?? null,
        credentialVersion: user.credentialVersion,
      }, {tx});
      await audit({
        eventType: 'login_success',
        outcome: 'success',
        realm,
        user,
        request,
        sessionId: session.session.id,
        detail: {assurance: 'single_factor'},
      }, {tx});
      return session;
    });

    const response = json({
      realm,
      csrfToken: created.csrfToken,
      user: {id: user.id, email: user.email, emailVerified: user.emailVerified === true},
    });
    response.headers.set('Set-Cookie', sessionCookie({
      realm,
      token: created.token,
      secure: secureCookies,
      maxAgeSeconds: cookieMaxAge,
    }));
    return response;
  }

  async function me(request, url, realm) {
    if (realm === 'operator') {
      throw new AuthError(403, 'OPERATOR_ASSERTION_REQUIRED', 'Operator access uses an asserted identity provider; local operator sessions are not enabled.');
    }
    const token = readCookies(request)[cookieName(realm, secureCookies)];
    if (!token) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    const session = await store.readSession(token, {realm});
    if (!session) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    // Activity is a guarded UPDATE: if the window closed (idle, absolute, revoked,
    // disabled, epoch) between the read and the refresh, the request fails closed
    // instead of returning a stale success.
    const refreshed = await store.refreshSession(session.id);
    if (!refreshed) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    return json({
      user: {id: session.userId, email: session.email},
      session: {
        realm: refreshed.realm,
        assuranceLevel: refreshed.assuranceLevel,
        selectedTenantId: refreshed.selectedTenantId,
        idleExpiresAt: refreshed.idleExpiresAt,
        absoluteExpiresAt: refreshed.absoluteExpiresAt,
      },
    });
  }

  async function logout(request, url, realm) {
    if (realm === 'operator') {
      throw new AuthError(403, 'OPERATOR_ASSERTION_REQUIRED', 'Operator access uses an asserted identity provider; local operator sessions are not enabled.');
    }
    if (request.headers.get('origin') !== url.origin) {
      throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    }
    const token = readCookies(request)[cookieName(realm, secureCookies)];
    if (!token) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    const provided = request.headers.get('x-csrf-token');
    const revoked = await store.withTransaction(async tx => {
      const session = await store.lockSession(token, {realm, tx});
      if (!session) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
      if (!csrfMatches(provided, session.csrfTokenHash)) {
        throw new AuthError(403, 'CSRF_FAILED', 'CSRF verification failed.');
      }
      const result = await store.revokeSession(session.tokenHash, {
        reason: 'logout',
        actor: session.userId,
        tx,
      });
      if (!result) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
      await audit({
        eventType: 'logout',
        outcome: 'success',
        realm,
        user: {id: session.userId},
        request,
        sessionId: session.id,
        detail: {},
      }, {tx});
      return result;
    });
    const response = json({ok: true, userId: revoked.user_id});
    response.headers.set('Set-Cookie', sessionCookie({realm, token: '', secure: secureCookies, maxAgeSeconds: 0}));
    return response;
  }

  return async function handle(request) {
    let response;
    try {
      const url = new URL(request.url);
      const realm = realmFor(url);
      const path = url.pathname;
      if (path === '/v1/auth/login' && request.method === 'POST') {
        response = await login(request, url, realm);
      } else if (path === '/v1/auth/me' && request.method === 'GET') {
        response = await me(request, url, realm);
      } else if (path === '/v1/auth/logout' && request.method === 'POST') {
        response = await logout(request, url, realm);
      } else {
        response = failure(404, 'AUTH_ROUTE_UNAVAILABLE', 'Versioned auth endpoint unavailable.');
      }
    } catch (error) {
      if (error instanceof AuthError) {
        response = failure(error.status, error.code, error.message);
      } else {
        response = failure(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.');
      }
    }
    return response;
  };
}
