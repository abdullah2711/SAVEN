import {createHash} from 'node:crypto';

// AUTH-003 durable, non-enumerating throttling for sign-in and password-reset
// requests.
//
// Storage is the append-only auth.auth_audit ledger, so no schema change or new grant
// is needed: a scope is throttled by counting its recent failure rows, and a successful
// sign-in resets the window for that scope. Counters are written inside the same
// transaction as the attempt, under a transaction-scoped advisory lock per scope, so a
// concurrent burst cannot slip past the configured limit. A dedicated rate-limit table
// with an index is the documented future optimisation; the ledger remains the durable
// source of truth.
//
// Scopes are pseudonymous SHA-256 digests of the realm plus the normalised account, and
// optionally the trusted ingress address. No raw email address and no request-supplied
// forwarding header is ever stored by the limiter.

export const RATE_LIMIT_DEFAULTS = Object.freeze({
  // Bootstrap defaults only. The contract explicitly does not approve the fixture's
  // eight-failures/15-minutes value as production policy; deployments must set this.
  login: Object.freeze({limit: 8, windowMs: 15 * 60 * 1000}),
  reset: Object.freeze({limit: 5, windowMs: 15 * 60 * 1000}),
});

const MIN_WINDOW_MS = 60 * 1000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

export class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.code = 'RATE_LIMIT_INVALID';
  }
}

export function normalizeRatePolicy(policy = {}) {
  const merged = {
    login: {...RATE_LIMIT_DEFAULTS.login, ...(policy.login ?? {})},
    reset: {...RATE_LIMIT_DEFAULTS.reset, ...(policy.reset ?? {})},
  };
  for (const [kind, value] of Object.entries(merged)) {
    if (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 1000) {
      throw new RateLimitError(`The ${kind} attempt limit must be an integer between 1 and 1000.`);
    }
    if (!Number.isInteger(value.windowMs) || value.windowMs < MIN_WINDOW_MS || value.windowMs > MAX_WINDOW_MS) {
      throw new RateLimitError(`The ${kind} window must be between one minute and 24 hours.`);
    }
  }
  return merged;
}

export function scopeKey(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// The trusted ingress header must be configured explicitly (for example the header an
// operator-managed reverse proxy sets). Arbitrary x-forwarded-for style headers are
// ignored unless that exact header is named here.
export function throttleScopes({email, request, trustedClientHeader = null, realm = 'customer'}) {
  const account = scopeKey(`account|${realm}|${String(email ?? '').trim().toLowerCase()}`);
  let network = null;
  if (trustedClientHeader) {
    const value = request?.headers?.get(trustedClientHeader);
    if (typeof value === 'string' && value.trim().length > 0) {
      network = scopeKey(`network|${realm}|${value.trim()}`);
    }
  }
  return {account, network};
}

const DETAIL_KEY = {login: 'throttle_account', reset: 'throttle_account'};

export function createRateLimiter({store, clock = () => new Date(), policy = {}} = {}) {
  if (!store || typeof store.withTransaction !== 'function') {
    throw new Error('createRateLimiter requires a transactional session store.');
  }
  const settings = normalizeRatePolicy(policy);
  const now = () => new Date(clock());

  function keysFor(input) {
    const scopes = throttleScopes(input);
    return {
      scopes,
      // Deterministic lock order avoids deadlock between account and network scopes.
      values: [...new Set(Object.values(scopes).filter(Boolean))].sort(),
    };
  }

  async function lockScopes(executor, keys) {
    for (const key of keys.values) {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`saven.auth.rate:${key}`]);
    }
  }

  async function countScope(executor, kind, column, key, at) {
    const config = settings[kind];
    const params = [column, key, at.toISOString(), Math.floor(config.windowMs / 1000)];
    if (kind === 'login') {
      // A successful sign-in ends the previous failure window for this scope.
      const result = await executor.query(
        `SELECT count(*)::int AS failures,
                min(a.occurred_at) AS first_failure
         FROM auth.auth_audit a
         WHERE a.event_type = 'login_failure'
           AND a.outcome = 'failure'
           AND a.detail_jsonb->>$1 = $2
           AND a.occurred_at > GREATEST(
             $3::timestamptz - make_interval(secs => $4),
             COALESCE((
               SELECT max(s.occurred_at)
               FROM auth.auth_audit s
               WHERE s.event_type = 'login_success'
                 AND s.detail_jsonb->>$1 = $2
             ), 'epoch'::timestamptz))`,
        params,
      );
      return result.rows[0];
    }
    const result = await executor.query(
      `SELECT count(*)::int AS failures,
              min(a.occurred_at) AS first_failure
       FROM auth.auth_audit a
       WHERE a.event_type = 'password_reset_requested'
         AND a.outcome <> 'denied'
         AND a.detail_jsonb->>$1 = $2
         AND a.occurred_at > $3::timestamptz - make_interval(secs => $4)`,
      params,
    );
    return result.rows[0];
  }

  // Must be called inside a transaction that already holds the scope locks and then
  // writes the attempt row before commit.
  async function checkScopes(executor, keys, kind) {
    const config = settings[kind];
    const at = now();
    for (const [name, key] of Object.entries(keys.scopes)) {
      if (!key) continue;
      const column = name === 'network' ? 'throttle_network' : DETAIL_KEY[kind];
      const row = await countScope(executor, kind, column, key, at);
      if (row.failures >= config.limit) {
        const first = row.first_failure ? new Date(row.first_failure).getTime() : at.getTime();
        // The caller never needs to wait longer than one window for this scope.
        const retryAfterMs = Math.min(config.windowMs, Math.max(0, first + config.windowMs - at.getTime()));
        return {allowed: false, retryAfterMs, limit: config.limit, kind, scope: name};
      }
    }
    return {allowed: true, retryAfterMs: 0, limit: config.limit, kind};
  }

  async function attempt({keys, kind, action}) {
    return store.withTransaction(async tx => {
      await lockScopes(tx, keys);
      const verdict = await checkScopes(tx, keys, kind);
      return action(tx, verdict);
    });
  }

  return {
    policy: settings,
    keysFor,
    lockScopes,
    checkScopes,
    attempt,
  };
}

export const __internals = Object.freeze({MIN_WINDOW_MS, MAX_WINDOW_MS});
