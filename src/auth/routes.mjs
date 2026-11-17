import {timingSafeEqual} from 'node:crypto';
import {AuthError, digestToken, isTokenDigest} from './session-store.mjs';
import {createPasswordPolicy} from './password-policy.mjs';
import {createMfaService} from './factors.mjs';
import {createRecoveryService} from './recovery.mjs';
import {createMailDispatcher} from './mail.mjs';
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
  mfa = null,
  mfaConfig = {},
  mfaOnVerification = null,
  mail = null,
  recoveryConfig = {},
  mailQueueLimit = 256,
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
  const mfaService = mfa ?? createMfaService({store, clock, config: mfaConfig, onVerification: mfaOnVerification});
  // Recovery owns challenge rows; mailer owns delivery. With no injected mail adapter the
  // forgot-password route keeps the AUTH-003 no-delivery behaviour instead of inventing
  // an ad-hoc channel.
  const recovery = createRecoveryService({store, clock, config: recoveryConfig});
  // Delivery is decoupled from the public response: the route enqueues a bounded job and
  // never waits for the external provider. The dispatcher owns the in-memory token until
  // delivery and invalidates an undelivered challenge through `onFailure` (best effort).
  const delivery = mail ? createMailDispatcher({
    mailer: mail,
    maxQueue: mailQueueLimit,
    onFailure: job => job.challengeId
      ? store.withTransaction(tx => recovery.invalidate(job.challengeId, {tx})).catch(() => {})
      : Promise.resolve(),
  }) : null;

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
          // Current assurance authority: any active membership whose role requires MFA.
          // Reuse the leased client for MFA authority reads: one transaction binds the
          // verified principal to RLS context, with no second pool checkout while the
          // reservation scope lock is held.
          const mfaDecision = await lease.transaction(async tx => ({
            requirement: await mfaService.authority(user.id, {tx}),
            state: await mfaService.status(user.id, {tx}),
          }));
          const requirement = mfaDecision.requirement;
          const mfaState = mfaDecision.state;
          if (!requirement.resolved) {
            throw new AuthError(503, 'MFA_AUTHORITY_UNAVAILABLE', 'The MFA requirement could not be verified.');
          }
          if (requirement.required && !mfaState.available) {
            throw new AuthError(503, 'MFA_UNAVAILABLE', 'Multi-factor authentication is required but is not configured.');
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
          return {
            created,
            user,
            mfa: {
              required: requirement.required,
              enrolled: mfaState.enrolled,
              pending: requirement.required,
              available: mfaState.available,
              resolved: true,
            },
          };
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
      mfa: outcome.mfa,
      session: {assuranceLevel: 'single_factor'},
    });
    response.headers.set('Set-Cookie', sessionCookie({
      realm,
      token: outcome.created.token,
      secure: secureCookies,
      maxAgeSeconds: cookieMaxAge,
    }));
    return response;
  }

  // AUTH-005 password reset request. The throttle reservation and its generic response
  // are retained from AUTH-003. Only when a controlled mail adapter is injected is a
  // single-use, hash-stored token created and delivered; an unknown or inactive account
  // takes the same path and response as a known one.
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
          : {reason: 'request_reserved', delivery: delivery ? 'mail_adapter' : 'deferred_to_auth_005'}),
      }, {tx: lease});
    };

    let outcome;
    try {
      outcome = await limiter.attempt({
        keys,
        kind: 'reset',
        reserve,
        action: async (verdict, lease) => {
          if (!delivery) return {accepted: true};
          let user = null;
          try {
            // The throttle lease already owns a client and its scope locks: the lookup
            // runs on that same connection, never a nested checkout.
            user = validEmail(email) ? await loadUserByEmail(lease, email) : null;
          } catch {
            user = null;
          }
          if (!user || user.status !== 'active') return {accepted: true};
          let issued;
          try {
            issued = await lease.transaction(tx => recovery.issueReset({userId: user.id, tx}));
          } catch {
            // A challenge-store failure must not become an existence oracle.
            return {accepted: true};
          }
          const submitted = delivery.submit({
            kind: 'password_reset',
            to: issued.to,
            token: issued.token,
            expiresAt: issued.expiresAt,
            challengeId: issued.id,
          });
          if (!submitted.accepted) {
            // Bounded queue refusal: invalidate best-effort and keep the generic response.
            await lease.transaction(tx => recovery.invalidate(issued.id, {tx})).catch(() => {});
          }
          return {accepted: true};
        },
      });
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

  // Consumes a single-use reset token, sets the new credential, bumps the credential
  // epoch and revokes every live session in one transaction. No session or token is
  // returned; the user signs in again with the new password.
  async function resetPassword(request, url, realm) {
    if (realm === 'operator') {
      throw new AuthError(403, 'OPERATOR_ASSERTION_REQUIRED', 'Operator access uses an asserted identity provider; local password reset is not enabled.');
    }
    if (request.headers.get('origin') !== url.origin) {
      throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    }
    const body = await readJson(request);
    if (Object.keys(body).some(key => !['token', 'password'].includes(key))) {
      throw new AuthError(400, 'UNKNOWN_FIELDS', 'Unknown reset fields.');
    }
    if (typeof body.token !== 'string' || typeof body.password !== 'string') {
      throw new AuthError(400, 'UNKNOWN_FIELDS', 'Provide the reset token and a new password.');
    }
    // Cheap authoritative check first: current address, credential generation, purpose
    // validity and expiry. A stale token never starts a password KDF.
    const usable = await recovery.probeReset(body.token).catch(() => false);
    if (!usable) throw new AuthError(400, 'RESET_TOKEN_INVALID', 'The reset link is invalid or has expired.');
    const hashed = await policy.hash(body.password);
    const archive = auditView(request, trustedClientHeader, sanitizeIngress(request, trustedClientHeader).ip);
    let result;
    try {
      result = await store.withTransaction(async tx => {
        const consumed = await recovery.consumeReset(body.token, {
          passwordHash: hashed.hash,
          passwordScheme: hashed.scheme,
          tx,
        });
        await record({
          eventType: 'password_reset_completed',
          outcome: 'success',
          realm,
          user: {id: consumed.userId},
          request: archive,
          detail: {
            purpose: 'password_reset',
            sessions_revoked: consumed.revoked,
            credential_version: consumed.credentialVersion,
          },
        }, {tx});
        return consumed;
      });
    } catch (error) {
      if (error instanceof AuditWriteError) {
        throw new AuthError(503, 'AUTH_ACCOUNTING_UNAVAILABLE', 'Authentication is temporarily unavailable.');
      }
      // One coherent outward contract for the reset route: the cheap pre-check and the
      // authoritative consume report the same codes.
      if (error?.code === 'RECOVERY_TOKEN_INVALID') {
        throw new AuthError(400, 'RESET_TOKEN_INVALID', 'The reset link is invalid or has expired.');
      }
      if (error?.code === 'RECOVERY_TOKEN_STALE') {
        throw new AuthError(400, 'RESET_TOKEN_STALE', 'The reset link is no longer valid. Request a new one.');
      }
      throw error;
    }
    return json({ok: true, userId: result.userId});
  }

  // Authenticated request for an email-verification message. It carries the AUTH-004
  // transactional authority boundary (revalidate revocation/expiry/epoch under the
  // lifecycle locks) and a durable purpose/account/network admission budget before any
  // challenge or message is created. Delivery is handed to the bounded dispatcher.
  async function emailVerificationRequest(request, url, realm) {
    if (realm === 'operator') {
      throw new AuthError(403, 'OPERATOR_ASSERTION_REQUIRED', 'Operator access uses an asserted identity provider; local email verification is not enabled.');
    }
    if (request.headers.get('origin') !== url.origin) {
      throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    }
    const body = await readJson(request);
    if (Object.keys(body).length > 0) throw new AuthError(400, 'UNKNOWN_FIELDS', 'No fields are accepted.');
    if (!delivery) throw new AuthError(503, 'MAIL_UNAVAILABLE', 'Email verification is not configured.');
    const session = await mutationSession(request, realm);
    const ingress = sanitizeIngress(request, trustedClientHeader);
    const outcome = await store.withTransaction(async tx => {
      await mfaService.assertMutationAuthority({session, tx});
      const verdict = await recovery.admitVerificationRequest({
        userId: session.userId,
        network: ingress.ip,
        tx,
      });
      if (!verdict.allowed) return {denied: verdict};
      const issued = await recovery.issueVerification({
        userId: session.userId,
        network: ingress.ip,
        tx,
      });
      return {issued};
    });
    if (outcome.denied) {
      const seconds = Math.max(1, Math.ceil(outcome.denied.retryAfterMs / 1000));
      const response = failure(429, 'MAIL_THROTTLED', 'Too many verification requests. Try again later.');
      response.headers.set('Retry-After', String(seconds));
      return response;
    }
    const submitted = delivery.submit({
      kind: 'email_verification',
      to: outcome.issued.to,
      token: outcome.issued.token,
      expiresAt: outcome.issued.expiresAt,
      challengeId: outcome.issued.id,
    });
    if (!submitted.accepted) {
      await store.withTransaction(tx => recovery.invalidate(outcome.issued.id, {tx})).catch(() => {});
      throw new AuthError(503, 'MAIL_UNAVAILABLE', 'Email verification is temporarily unavailable.');
    }
    return json({accepted: true}, 202);
  }

  // Public consumption of an email-verification token. The token is account-bound and
  // single-use; the verified address is the one stored on the challenge.
  async function emailVerifyRoute(request, url, realm) {
    if (realm === 'operator') {
      throw new AuthError(403, 'OPERATOR_ASSERTION_REQUIRED', 'Operator access uses an asserted identity provider; local email verification is not enabled.');
    }
    if (request.headers.get('origin') !== url.origin) {
      throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    }
    const body = await readJson(request);
    if (Object.keys(body).some(key => key !== 'token') || typeof body.token !== 'string') {
      throw new AuthError(400, 'UNKNOWN_FIELDS', 'Provide the verification token.');
    }
    const result = await store.withTransaction(tx => recovery.consumeVerification(body.token, {tx}));
    return json({ok: true, verified: true, userId: result.userId});
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
    const status = await store.withTransaction(tx => mfaService.status(session.userId, {tx}));
    if (!status.resolved) throw new AuthError(503, 'MFA_AUTHORITY_UNAVAILABLE', 'The MFA requirement could not be verified.');
    return json({
      user: {id: session.userId, email: session.email},
      session: {
        realm: refreshed.realm,
        assuranceLevel: refreshed.assuranceLevel,
        selectedTenantId: refreshed.selectedTenantId,
        idleExpiresAt: refreshed.idleExpiresAt,
        absoluteExpiresAt: refreshed.absoluteExpiresAt,
      },
      mfa: {
        required: status.required,
        enrolled: status.enrolled,
        pending: status.required && (refreshed.assuranceLevel !== 'mfa_verified' || !status.enrolled),
        available: status.available,
        resolved: status.resolved,
        recoveryRemaining: status.recoveryRemaining,
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

  function requireCsrf(request, session) {
    const provided = request.headers.get('x-csrf-token');
    if (!csrfMatches(provided, session.csrfTokenHash)) {
      throw new AuthError(403, 'CSRF_FAILED', 'CSRF verification failed.');
    }
  }

  async function loadUserById(tx, userId) {
    const result = await tx.query(
      `SELECT id, email, password_hash, password_scheme, status, credential_version
       FROM auth.users WHERE id = $1`,
      [userId],
    );
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      passwordScheme: row.password_scheme,
      status: row.status,
      credentialVersion: Number(row.credential_version),
    };
  }

  // Same shape as loadUserById, but on a caller-owned client and keyed by normalized
  // email. Used by the throttled reset-request path so the lookup never takes a second
  // pool checkout while the limiter lease is held.
  async function loadUserByEmail(executor, email) {
    const result = await executor.query(
      `SELECT id, email, password_hash, password_scheme, status, credential_version
       FROM auth.users WHERE lower(email) = $1`,
      [normalizeEmail(email)],
    );
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      passwordScheme: row.password_scheme,
      status: row.status,
      credentialVersion: Number(row.credential_version),
    };
  }

  // Reads the verified session WITHOUT row locks. Lifecycle transactions then take the
  // deterministic users -> two_factor -> sessions lock order, so concurrent lifecycle
  // requests cannot deadlock on opposing session-row locks.
  async function mutationSession(request, realm) {
    const token = readCookies(request)[cookieName(realm, secureCookies)];
    if (!token) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    const session = await store.readSession(token, {realm});
    if (!session) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    requireCsrf(request, session);
    return session;
  }

  function mfaRealmGuard(realm) {
    if (realm === 'operator') {
      throw new AuthError(403, 'OPERATOR_ASSERTION_REQUIRED', 'Operator access uses an asserted identity provider; local operator MFA is not enabled.');
    }
  }

  async function mfaStatusRoute(request, url, realm) {
    mfaRealmGuard(realm);
    const token = readCookies(request)[cookieName(realm, secureCookies)];
    if (!token) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    const session = await store.readSession(token, {realm});
    if (!session) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
    const status = await store.withTransaction(tx => mfaService.status(session.userId, {tx}));
    if (!status.resolved) throw new AuthError(503, 'MFA_AUTHORITY_UNAVAILABLE', 'The MFA requirement could not be verified.');
    return json({
      required: status.required,
      enrolled: status.enrolled,
      available: status.available,
      recoveryRemaining: status.recoveryRemaining,
      assuranceLevel: session.assuranceLevel,
      pending: status.required && (session.assuranceLevel !== 'mfa_verified' || !status.enrolled),
    });
  }

  async function mfaEnrollRoute(request, url, realm) {
    mfaRealmGuard(realm);
    if (request.headers.get('origin') !== url.origin) throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    const body = await readJson(request);
    const allowed = ['password', 'code', 'recoveryCode'];
    const keys = Object.keys(body);
    if (keys.some(key => !allowed.includes(key))) throw new AuthError(400, 'UNKNOWN_FIELDS', 'Unknown enrollment fields.');
    const replaceProof = keys.includes('password') || keys.includes('code') || keys.includes('recoveryCode');
    const usesCode = typeof body.code === 'string' && body.recoveryCode === undefined;
    const usesRecovery = typeof body.recoveryCode === 'string' && body.code === undefined;
    if (replaceProof && (typeof body.password !== 'string' || (!usesCode && !usesRecovery))) {
      throw new AuthError(400, 'UNKNOWN_FIELDS', 'Replacement requires the password and exactly one existing code.');
    }
    const session = await mutationSession(request, realm);
    const result = await store.withTransaction(async tx => {
      // Common lifecycle authority: revalidate the actual session token/realm,
      // revocation, both expiries, active principal and credential epoch inside this
      // owned transaction AFTER the deterministic lifecycle locks, before any
      // reauthentication or factor mutation.
      await mfaService.assertMutationAuthority({session, tx});
      const status = await mfaService.status(session.userId, {tx});
      if (!status.resolved) throw new AuthError(503, 'MFA_AUTHORITY_UNAVAILABLE', 'The MFA requirement could not be verified.');
      let authorizedReplacement = false;
      if (status.enrolled) {
        // Never treat session assurance as reauthentication proof: the current password
        // and an existing TOTP/recovery factor are both required in this transaction.
        if (!replaceProof) throw new AuthError(403, 'MFA_REAUTH_REQUIRED', 'Reauthentication and an existing factor are required to replace the enrolled factor.');
        // Durable per-user admission precedes any password/KDF work. Locked requests
        // refuse without starting a derivation or a factor step; the failure accounting
        // for wrong credentials still commits (returned as {failed}).
        try {
          await mfaService.checkLocked(session.userId, {tx});
        } catch (error) {
          if (typeof error?.status === 'number' && typeof error?.code === 'string') return {failed: error};
          throw error;
        }
        const user = await loadUserById(tx, session.userId);
        const verification = user ? await policy.verify(body.password, user.passwordHash) : {valid: false};
        if (!verification.valid) {
          await mfaService.registerPasswordFailure(session.userId, {tx});
          return {failed: new AuthError(401, 'SIGN_IN_FAILED', 'Reauthentication failed.')};
        }
        try {
          if (usesRecovery) await mfaService.verifyRecovery(session.userId, body.recoveryCode, {tx});
          else await mfaService.verifyTotp(session.userId, body.code, {tx});
        } catch (error) {
          if (typeof error?.status === 'number' && typeof error?.code === 'string') return {failed: error};
          throw error;
        }
        authorizedReplacement = true;
      } else if (replaceProof) {
        throw new AuthError(400, 'UNKNOWN_FIELDS', 'Initial enrollment takes no proof fields.');
      }
      const started = await mfaService.beginEnrollment(session.userId, {tx, replaceAuthorized: authorizedReplacement});
      await record({
        eventType: 'mfa_enrolled',
        outcome: 'success',
        realm,
        user: {id: session.userId},
        request: auditView(request, trustedClientHeader, sanitizeIngress(request, trustedClientHeader).ip),
        sessionId: session.id,
        detail: {stage: started.replaced ? 'replaced' : 'started'},
      }, {tx});
      return started;
    });
    if (result.failed) throw result.failed;
    return json({otpauthUri: result.otpauthUri, pending: true, replaced: result.replaced === true});
  }

  async function mfaEnrollVerifyRoute(request, url, realm) {
    mfaRealmGuard(realm);
    if (request.headers.get('origin') !== url.origin) throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    const body = await readJson(request);
    if (Object.keys(body).some(key => key !== 'code')) throw new AuthError(400, 'UNKNOWN_FIELDS', 'Unknown verification fields.');
    const session = await mutationSession(request, realm);
    const result = await store.withTransaction(async tx => {
      await mfaService.assertMutationAuthority({session, tx});
      let completed;
      try {
        completed = await mfaService.completeEnrollment(session.userId, body.code, {tx});
      } catch (error) {
        if (typeof error?.status === 'number' && typeof error?.code === 'string') return {failed: error};
        throw error;
      }
      const assurance = await store.setSessionAssurance(session.id, 'mfa_verified', {tx});
      if (!assurance) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
      await record({
        eventType: 'mfa_enrolled',
        outcome: 'success',
        realm,
        user: {id: session.userId},
        request: auditView(request, trustedClientHeader, sanitizeIngress(request, trustedClientHeader).ip),
        sessionId: session.id,
        detail: {stage: 'completed', recovery_codes_issued: completed.recoveryCodes.length},
      }, {tx});
      return completed;
    });
    if (result.failed) throw result.failed;
    return json({ok: true, assuranceLevel: 'mfa_verified', recoveryCodes: result.recoveryCodes});
  }

  async function mfaVerifyRoute(request, url, realm) {
    mfaRealmGuard(realm);
    if (request.headers.get('origin') !== url.origin) throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    const body = await readJson(request);
    const keys = Object.keys(body);
    const usesCode = keys.includes('code') && keys.length === 1;
    const usesRecovery = keys.includes('recoveryCode') && keys.length === 1;
    if (!usesCode && !usesRecovery) throw new AuthError(400, 'UNKNOWN_FIELDS', 'Provide exactly one code or recovery code.');
    const session = await mutationSession(request, realm);
    const result = await store.withTransaction(async tx => {
      await mfaService.assertMutationAuthority({session, tx});
      let verified;
      try {
        verified = usesRecovery
          ? await mfaService.verifyRecovery(session.userId, body.recoveryCode, {tx})
          : await mfaService.verifyTotp(session.userId, body.code, {tx});
      } catch (error) {
        if (typeof error?.status === 'number' && typeof error?.code === 'string') return {failed: error};
        throw error;
      }
      const assurance = await store.setSessionAssurance(session.id, 'mfa_verified', {tx});
      if (!assurance) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
      await record({
        eventType: 'mfa_verified',
        outcome: 'success',
        realm,
        user: {id: session.userId},
        request: auditView(request, trustedClientHeader, sanitizeIngress(request, trustedClientHeader).ip),
        sessionId: session.id,
        detail: {method: verified.method, assurance: 'mfa_verified'},
      }, {tx});
      return verified;
    });
    if (result.failed) throw result.failed;
    return json({ok: true, method: result.method, assuranceLevel: 'mfa_verified'});
  }

  async function mfaDisableRoute(request, url, realm) {
    mfaRealmGuard(realm);
    if (request.headers.get('origin') !== url.origin) throw new AuthError(403, 'ORIGIN_MISMATCH', 'Origin verification failed.');
    const body = await readJson(request);
    const allowed = ['password', 'code', 'recoveryCode'];
    if (Object.keys(body).some(key => !allowed.includes(key)) || typeof body.password !== 'string') {
      throw new AuthError(400, 'UNKNOWN_FIELDS', 'Unknown disable fields.');
    }
    const usesCode = typeof body.code === 'string' && body.recoveryCode === undefined;
    const usesRecovery = typeof body.recoveryCode === 'string' && body.code === undefined;
    if (!usesCode && !usesRecovery) throw new AuthError(400, 'UNKNOWN_FIELDS', 'Provide exactly one code or recovery code.');
    const session = await mutationSession(request, realm);
    const result = await store.withTransaction(async tx => {
      await mfaService.assertMutationAuthority({session, tx});
      // Reauthentication reads run on the already-owned transaction: no nested checkout.
      const user = await loadUserById(tx, session.userId);
      if (!user || user.id !== session.userId) throw new AuthError(401, 'SIGN_IN_FAILED', 'Reauthentication failed.');
      try {
        await mfaService.checkLocked(session.userId, {tx});
      } catch (error) {
        if (typeof error?.status === 'number' && typeof error?.code === 'string') return {failed: error};
        throw error;
      }
      const verification = await policy.verify(body.password, user.passwordHash);
      if (!verification.valid) {
        await mfaService.registerPasswordFailure(session.userId, {tx});
        return {failed: new AuthError(401, 'SIGN_IN_FAILED', 'Reauthentication failed.')};
      }
      try {
        if (usesRecovery) await mfaService.verifyRecovery(session.userId, body.recoveryCode, {tx});
        else await mfaService.verifyTotp(session.userId, body.code, {tx});
      } catch (error) {
        if (typeof error?.status === 'number' && typeof error?.code === 'string') return {failed: error};
        throw error;
      }
      await mfaService.disable(session.userId, {tx});
      const assurance = await store.setSessionAssurance(session.id, 'single_factor', {tx});
      if (!assurance) throw new AuthError(401, 'SESSION_REQUIRED', 'Sign in required.');
      await record({
        eventType: 'mfa_disabled',
        outcome: 'success',
        realm,
        user: {id: session.userId},
        request: auditView(request, trustedClientHeader, sanitizeIngress(request, trustedClientHeader).ip),
        sessionId: session.id,
        detail: {reenrollment_required: true},
      }, {tx});
      return {disabled: true};
    });
    if (result.failed) throw result.failed;
    return json({ok: true, disabled: result.disabled, mfa: {required: true, pending: true}});
  }

  const handle = async function handle(request) {
    let response;
    try {
      const url = new URL(request.url);
      const realm = realmFor(url);
      const path = url.pathname;
      // Pending-MFA sessions may only reach MFA completion, me and logout.
      const preMfaAllowed = new Set([
        '/v1/auth/login',
        '/v1/auth/forgot-password',
        '/v1/auth/reset-password',
        '/v1/auth/email/verification/request',
        '/v1/auth/email/verify',
        '/v1/auth/me',
        '/v1/auth/logout',
        '/v1/auth/mfa',
        '/v1/auth/mfa/enroll',
        '/v1/auth/mfa/enroll/verify',
        '/v1/auth/mfa/verify',
        '/v1/auth/mfa/disable',
      ]);
      if (!preMfaAllowed.has(path) && realm === 'customer') {
        const token = readCookies(request)[cookieName(realm, secureCookies)];
        if (token) {
          const pendingSession = await store.readSession(token, {realm});
          if (pendingSession) {
            const status = await store.withTransaction(tx => mfaService.status(pendingSession.userId, {tx}));
            if (!status.resolved) {
              return failure(503, 'MFA_AUTHORITY_UNAVAILABLE', 'The MFA requirement could not be verified.');
            }
            if (status.required && (pendingSession.assuranceLevel !== 'mfa_verified' || !status.enrolled)) {
              return failure(403, 'MFA_REQUIRED', 'Multi-factor verification is required before this request.');
            }
          }
        }
      }
      if (path === '/v1/auth/login' && request.method === 'POST') {
        response = await login(request, url, realm);
      } else if (path === '/v1/auth/forgot-password' && request.method === 'POST') {
        response = await forgotPassword(request, url, realm);
      } else if (path === '/v1/auth/reset-password' && request.method === 'POST') {
        response = await resetPassword(request, url, realm);
      } else if (path === '/v1/auth/email/verification/request' && request.method === 'POST') {
        response = await emailVerificationRequest(request, url, realm);
      } else if (path === '/v1/auth/email/verify' && request.method === 'POST') {
        response = await emailVerifyRoute(request, url, realm);
      } else if (path === '/v1/auth/me' && request.method === 'GET') {
        response = await me(request, url, realm);
      } else if (path === '/v1/auth/logout' && request.method === 'POST') {
        response = await logout(request, url, realm);
      } else if (path === '/v1/auth/mfa' && request.method === 'GET') {
        response = await mfaStatusRoute(request, url, realm);
      } else if (path === '/v1/auth/mfa/enroll' && request.method === 'POST') {
        response = await mfaEnrollRoute(request, url, realm);
      } else if (path === '/v1/auth/mfa/enroll/verify' && request.method === 'POST') {
        response = await mfaEnrollVerifyRoute(request, url, realm);
      } else if (path === '/v1/auth/mfa/verify' && request.method === 'POST') {
        response = await mfaVerifyRoute(request, url, realm);
      } else if (path === '/v1/auth/mfa/disable' && request.method === 'POST') {
        response = await mfaDisableRoute(request, url, realm);
      } else {
        response = failure(404, 'AUTH_ROUTE_UNAVAILABLE', 'Versioned auth endpoint unavailable.');
      }
    } catch (error) {
      if (error instanceof AuthError || (typeof error?.status === 'number' && typeof error?.code === 'string')) {
        response = failure(error.status, error.code, error.message);
      } else {
        response = failure(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.');
      }
    }
    return response;
  };
  // Explicit ownership: composition/tests may flush or close the bounded delivery queue.
  handle.mailDelivery = delivery;
  return handle;
}
