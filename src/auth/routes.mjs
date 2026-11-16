import {timingSafeEqual} from 'node:crypto';
import {AuthError, digestToken, isTokenDigest} from './session-store.mjs';
import {createPasswordPolicy} from './password-policy.mjs';
import {createRateLimiter, canonicalizeIp, AccountingUnavailableError} from './rate-limit.mjs';

// AUTH-003 versioned auth routes.
//
// Sign-in first commits a durable reservation (or denial) under its scope lock, then
// verifies on the same leased client and commits the upgrade, session and success audit
// atomically in one transaction on that client. No nested pool checkout is taken while
// locks are held. Password-reset requests use the same reservation policy and audit
// ledger but send nothing: mail delivery is AUTH-005 work.
//
// Non-enumeration: unknown accounts, wrong passwords and throttled attempts all take a
// bounded state path and return generic bodies. Raw emails and raw ingress values are
// never stored; only scope digests are audited.

const MAX_BODY_BYTES = 32 * 1024;
const EMAIL_MAX = 320;
const PASSWORD_MAX_BYTES = 512;

// Distinguishes an audit-store failure from an authentication/provider failure. The
// former fails closed with an explicit accounting-unavailable outcome; the latter is
// retried once on a durable path so the attempt consumes the budget.
class AuditWriteError extends Error {}

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

// Only an explicitly configured trusted header, carrying a syntactically valid IP
// address, can contribute ingress identity. Everything else is discarded before it can
// reach the audit writer (which would otherwise read cf-connecting-ip unconditionally)
// or the session row.
// One validated, canonical ingress identity feeds the network scope, the session row and
// audit metadata. Invalid values yield null and therefore create no scope.
function sanitizeIngress(request, trustedClientHeader) {
  if (!trustedClientHeader) return {ip: null};
  return {ip: canonicalizeIp(request.headers.get(trustedClientHeader))};
}

const SOCKET_HEADERS = new Set([
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  'true-client-ip',
  'x-client-ip',
]);

// A request view for audit persistence that cannot carry an untrusted socket address.
function auditView(request, trustedClientHeader, ip) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (SOCKET_HEADERS.has(lower)) continue;
    if (lower === 'x-request-id' && !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) continue;
    headers.set(name, lower === 'user-agent' ? value.slice(0, 1000) : value);
  }
  if (ip && trustedClientHeader === 'cf-connecting-ip') headers.set(trustedClientHeader, ip);
  return {headers};
}

function throttleDetail(keys, verdict, extra = {}) {
  return {
    ...extra,
    throttle_account: keys.scopes.account,
    throttle_network: keys.scopes.network,
    ...(verdict ? {attempt_at: verdict.at, attempt_order: verdict.order} : {}),
  };
}

export function createAuthRoutes({
  store,
  findUserByEmail,
  verifyPassword = null,
  passwordPolicy = null,
  rateLimiter = null,
  rateLimitPolicy = {},
  accountingCooldownMs = 30 * 1000,
  poolingMode = 'session',
  trustedClientHeader = null,
  audit = async () => {},
  origins,
  secureCookies = true,
  clock = () => new Date(),
}) {
  if (!store || typeof store.createSession !== 'function' || typeof store.withTransaction !== 'function') {
    throw new Error('createAuthRoutes requires a transactional session store.');
  }
  if (typeof findUserByEmail !== 'function') throw new Error('createAuthRoutes requires findUserByEmail.');
  if (!origins || typeof origins !== 'object') throw new Error('createAuthRoutes requires exact realm origins.');
  const customerOrigin = new URL(origins.customer).origin;
  const operatorOrigin = new URL(origins.operator).origin;
  if (customerOrigin === operatorOrigin) throw new Error('Separate customer and operator origins required.');
  const cookieMaxAge = Math.floor((store.config?.absoluteMs ?? 90 * 24 * 60 * 60 * 1000) / 1000);

  // Retained scrypt verification stays available through the injected verifier (the
  // composition root supplies the bounded compatibility path). The policy prefers
  // Argon2id for new verifiers and upgrades a retained scrypt verifier after a
  // successful sign-in.
  const policy = passwordPolicy ?? createPasswordPolicy({
    scryptVerify: verifyPassword
      ? (password, hash) => verifyPassword(password, {hash, scheme: 'scrypt'})
      : undefined,
  });
  const limiter = rateLimiter ?? createRateLimiter({store, clock, policy: rateLimitPolicy, accountingCooldownMs, poolingMode});

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

  function throttledResponse(retryAfterMs, code) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    const response = failure(429, code, 'Too many attempts. Try again later.');
    response.headers.set('Retry-After', String(seconds));
    return response;
  }

  // All in-transaction audit writes go through here so an audit-store failure is
  // distinguishable from a provider failure.
  async function record(event, options) {
    try {
      await audit(event, options);
    } catch (error) {
      throw new AuditWriteError('audit store unavailable', {cause: error});
    }
  }

  async function login(request, url, realm) {
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
    const ingress = sanitizeIngress(request, trustedClientHeader);
    const archive = auditView(request, trustedClientHeader, ingress.ip);
    const keys = limiter.keysFor({email, network: ingress.ip, realm});
    const user = validEmail(email) ? await findUserByEmail(email) : null;
    const atIso = () => new Date(clock()).toISOString();

    // The reservation is the durable accounting decision: it commits before verification
    // starts, and the scope lock stays held until the attempt ends.
    const reserve = async (lease, verdict) => {
      const denied = !verdict.allowed;
      await record({
        eventType: 'login_failure',
        outcome: denied ? 'denied' : 'failure',
        realm,
        user,
        request: archive,
        detail: throttleDetail(keys, verdict, denied
          ? {reason: 'throttled', retry_after_ms: verdict.retryAfterMs}
          : {reason: 'attempt_reserved', phase: 'verify'}),
      }, {tx: lease});
    };

    let outcome;
    try {
      outcome = await limiter.attempt({
        keys,
        kind: 'login',
        reserve,
        action: async (reservation, lease) => {
          const verification = await policy.verify(password, user?.passwordHash ?? null);
          if (!user || !verification.valid || user.status !== 'active') {
            // The reservation already counts this attempt; no extra failure row is written.
            return {rejected: true};
          }
          // Successful upgrade, session and success audit stay atomic in one transaction.
          const created = await lease.transaction(async tx => {
            const orderRow = await tx.query('SELECT pg_current_xact_id()::text AS id');
            if (verification.needsRehash) {
              const upgraded = await policy.hash(password);
              const updated = await tx.query(
                `UPDATE auth.users
                 SET password_hash = $1, password_scheme = $2, password_updated_at = now(), updated_by = 'auth003-rehash'
                 WHERE id = $3 AND password_hash = $4`,
                [upgraded.hash, upgraded.scheme, user.id, user.passwordHash],
              );
              if (updated.rowCount !== 1) return null;
            }
            const session = await store.createSession({
              userId: user.id,
              realm,
              roleId: null,
              assuranceLevel: 'single_factor',
              ipAddress: ingress.ip,
              userAgent: archive.headers.get('user-agent') ?? null,
              credentialVersion: user.credentialVersion,
            }, {tx});
            await record({
              eventType: 'login_success',
              outcome: 'success',
              realm,
              user,
              request: archive,
              sessionId: session.session.id,
              detail: throttleDetail(keys, {
                at: atIso(),
                order: orderRow.rows[0].id,
              }, {
                assurance: 'single_factor',
                rehashed: verification.needsRehash === true,
                reservation_order: reservation.order,
              }),
            }, {tx});
            return session;
          });
          if (!created) return {rejected: true};
          return {created, user};
        },
      });
    } catch (error) {
      if (error instanceof AccountingUnavailableError || error instanceof AuditWriteError) {
        limiter.noteAccountingFailure();
        return failure(503, 'AUTH_ACCOUNTING_UNAVAILABLE', 'Authentication is temporarily unavailable.');
      }
      const busy = error?.code === 'PASSWORD_BUSY';
      if (error instanceof AuthError) {
        // A commit outcome may be unknown: the credential is withheld regardless. The
        // ambiguity is documented rather than claiming the session certainly does not exist.
        return failure(error.status, error.code, error.message);
      }
      return failure(503, busy ? 'SIGN_IN_BUSY' : 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.');
    }

    if (outcome.throttled) return throttledResponse(outcome.throttled.retryAfterMs, 'SIGN_IN_THROTTLED');
    if (outcome.rejected) throw new AuthError(401, 'SIGN_IN_FAILED', 'The email or password is incorrect.');

    const response = json({
      realm,
      csrfToken: outcome.created.csrfToken,
      user: {id: outcome.user.id, email: outcome.user.email, emailVerified: outcome.user.emailVerified === true},
    });
    response.headers.set('Set-Cookie', sessionCookie({
      realm,
      token: outcome.created.token,
      secure: secureCookies,
      maxAgeSeconds: cookieMaxAge,
    }));
    return response;
  }

  // AUTH-005 owns reset tokens and delivery. This endpoint applies the shared throttle
  // policy and records the request without disclosing account existence or sending mail.
  async function forgotPassword(request, url, realm) {
    if (realm === 'operator') {
      throw new AuthError(403, 'OPERATOR_ASSERTION_REQUIRED', 'Operator access uses an asserted identity provider; local operator recovery is not enabled.');
    }
    if (request.headers.get('origin') !== url.origin) {
      throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    }
    const body = await readJson(request);
    const unknown = Object.keys(body).filter(key => key !== 'email');
    if (unknown.length > 0) {
      throw new AuthError(400, 'UNKNOWN_FIELDS', 'Unknown reset fields.');
    }
    const email = normalizeEmail(body.email);
    const ingress = sanitizeIngress(request, trustedClientHeader);
    const archive = auditView(request, trustedClientHeader, ingress.ip);
    const keys = limiter.keysFor({email, network: ingress.ip, realm});

    const reserve = async (lease, verdict) => {
      const denied = !verdict.allowed;
      await record({
        eventType: 'password_reset_requested',
        outcome: denied ? 'denied' : 'success',
        realm,
        request: archive,
        detail: throttleDetail(keys, verdict, denied
          ? {reason: 'throttled', retry_after_ms: verdict.retryAfterMs}
          : {delivery: 'deferred_to_auth_005', reason: 'request_reserved'}),
      }, {tx: lease});
    };

    let outcome;
    try {
      // The reserved request row is the durable accounting record; no mail or token is
      // created here.
      outcome = await limiter.attempt({keys, kind: 'reset', reserve, action: async () => ({accepted: true})});
    } catch (error) {
      if (error instanceof AccountingUnavailableError || error instanceof AuditWriteError) {
        limiter.noteAccountingFailure();
        return failure(503, 'AUTH_ACCOUNTING_UNAVAILABLE', 'Authentication is temporarily unavailable.');
      }
      if (error instanceof AuthError) return failure(error.status, error.code, error.message);
      return failure(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.');
    }
    if (outcome.throttled) return throttledResponse(outcome.throttled.retryAfterMs, 'RESET_THROTTLED');
    return json({accepted: true}, 202);
  }

  async function me(request, url, realm) {
    if (realm === 'operator') {
      throw new AuthError(403, 'OPERATOR_ASSERTION_REQUIRED', 'Operator access uses an asserted identity provider; local operator sessions are not enabled.');
    }
    const token = readCookies(request)[cookieName(realm, secureCookies)];
    if (!token) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    const session = await store.readSession(token, {realm});
    if (!session) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
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
      await record({
        eventType: 'logout',
        outcome: 'success',
        realm,
        user: {id: session.userId},
        request: auditView(request, trustedClientHeader, sanitizeIngress(request, trustedClientHeader).ip),
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
      } else if (path === '/v1/auth/forgot-password' && request.method === 'POST') {
        response = await forgotPassword(request, url, realm);
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
