import {timingSafeEqual} from 'node:crypto';
import {AuthError, digestToken} from './session-store.mjs';

// AUTH-002 versioned auth routes. They are deliberately independent of the active
// SQLite `/api` handler: nothing here is wired into the native entry points, and no
// existing route changes. The handler is a pure Web-API (Request → Response) function
// so it can be mounted by any future server without a framework dependency.
//
// Realm separation: exact-origin allowlists only. Customer realm uses a host-only
// `__Host-` cookie with SameSite=Lax; operator realm is reserved for AUTH-007 and
// responds with an explicit refusal instead of accepting a local password.

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
  // `__Host-` requires Secure, Path=/ and no Domain. Local non-TLS fixtures use an
  // explicitly separate, obviously non-production name instead.
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
  if (typeof storedDigest !== 'string' || !/^[0-9a-f]{64}$/.test(storedDigest)) return false;
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
  if (!store || typeof store.createSession !== 'function') throw new Error('createAuthRoutes requires a session store.');
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

  async function currentSession(request, realm) {
    const token = readCookies(request)[cookieName(realm, secureCookies)];
    if (!token) return null;
    let session;
    try {
      session = await store.readSession(token, {realm});
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) return null;
      throw error;
    }
    return session ? {session, token} : null;
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
    const created = await store.createSession({
      userId: user.id,
      realm,
      roleId: null,
      assuranceLevel: 'single_factor',
      ipAddress: request.headers.get('cf-connecting-ip') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
      credentialVersion: user.credentialVersion,
    });
    await audit({
      eventType: 'login_success',
      outcome: 'success',
      realm,
      user,
      request,
      sessionId: created.session.id,
      detail: {assurance: 'single_factor'},
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
    const found = await currentSession(request, realm);
    if (!found) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    // Touching the session is activity only; the absolute ceiling cannot move.
    await store.refreshSession(found.session.id).catch(() => null);
    return json({
      user: {id: found.session.userId, email: found.session.email},
      session: {
        realm: found.session.realm,
        assuranceLevel: found.session.assuranceLevel,
        selectedTenantId: found.session.selectedTenantId,
        idleExpiresAt: found.session.idleExpiresAt,
        absoluteExpiresAt: found.session.absoluteExpiresAt,
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
    const found = await currentSession(request, realm);
    if (!found) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    const provided = request.headers.get('x-csrf-token');
    if (typeof provided !== 'string' || !csrfMatches(provided, found.session.csrfTokenHash)) {
      throw new AuthError(403, 'CSRF_FAILED', 'CSRF verification failed.');
    }
    await store.revokeSession(found.token, {reason: 'logout', actor: found.session.userId});
    await audit({
      eventType: 'logout',
      outcome: 'success',
      realm,
      user: {id: found.session.userId},
      request,
      sessionId: found.session.id,
      detail: {},
    });
    const response = json({ok: true});
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
