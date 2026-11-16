import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

// AUTH-003 durable, non-enumerating throttling (R2).
//
// The limiter now reserves an attempt *before any KDF work starts* and holds a
// session-scoped advisory lock for the whole attempt. Sequence per attempt:
//
//   1. acquire the session-level scope lock(s) on one checked-out client;
//   2. in a short committed transaction, re-check the budget and write either a denial
//      row or a reservation row carrying the post-lock order;
//   3. only then may the caller run verification and its own success transaction;
//   4. release the scope lock.
//
// A crash after step 2 leaves a durable, counted attempt record; a crash before it
// leaves no work. A waiting concurrent attempt cannot observe an unrecorded attempt
// because the lock is held across the reservation commit and the whole attempt. If the
// audit store cannot record the reservation, the limiter fails closed and opens a
// cooldown breaker so repeated requests are refused *before* any KDF admission.
//
// Counters use the application-clock time and PostgreSQL transaction id sampled after
// the lock (attempt_at/attempt_order). No append-only row is rewritten.

export const RATE_LIMIT_DEFAULTS = Object.freeze({
  // Bootstrap defaults only; not approved production policy. Thresholds are deployment
  // configuration and must be reviewed and versioned by server composition.
  login: Object.freeze({limit: 8, windowMs: 15 * 60 * 1000}),
  reset: Object.freeze({limit: 5, windowMs: 15 * 60 * 1000}),
});

const MIN_WINDOW_MS = 60 * 1000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ACCOUNTING_COOLDOWN_MS = 30 * 1000;

export class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.code = 'RATE_LIMIT_INVALID';
  }
}

export class AccountingUnavailableError extends Error {
  constructor(message = 'Authentication accounting is unavailable.', options) {
    super(message, options);
    this.code = 'AUTH_ACCOUNTING_UNAVAILABLE';
    this.status = 503;
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

// One canonical IP spelling per address. IPv4 is normalised to dotted decimal; IPv6 is
// canonicalised through the URL parser (compressed, lower-case). Anything that is not a
// valid IP yields null, so an invalid configured header can never create a scope.
export function canonicalizeIp(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || isIP(trimmed) === 0) return null;
  if (isIP(trimmed) === 4) return trimmed.split('.').map(part => String(Number(part))).join('.');
  try {
    const host = new URL(`http://[${trimmed}]/`).hostname;
    return host.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return null;
  }
}

// The network identity must already be validated and canonicalised by the caller; the
// limiter never reads request headers itself.
export function throttleScopes({email, network = null, realm = 'customer'}) {
  const account = scopeKey(`account|${realm}|${String(email ?? '').trim().toLowerCase()}`);
  const canonical = canonicalizeIp(network);
  return {
    account,
    network: canonical ? scopeKey(`network|${realm}|${canonical}`) : null,
  };
}

const DETAIL_KEY = {login: 'throttle_account', reset: 'throttle_account'};

export function createRateLimiter({
  store,
  clock = () => new Date(),
  policy = {},
  accountingCooldownMs = DEFAULT_ACCOUNTING_COOLDOWN_MS,
} = {}) {
  if (!store || typeof store.withClient !== 'function') {
    throw new Error('createRateLimiter requires a store with a checked-out client helper.');
  }
  const settings = normalizeRatePolicy(policy);
  if (!Number.isInteger(accountingCooldownMs) || accountingCooldownMs < 0 || accountingCooldownMs > 60 * 60 * 1000) {
    throw new RateLimitError('The accounting cooldown must be between 0 and one hour.');
  }
  const now = () => new Date(clock());
  let accountingBlockedUntil = 0;

  function keysFor(input) {
    const scopes = throttleScopes(input);
    return {scopes, values: [...new Set(Object.values(scopes).filter(Boolean))].sort()};
  }

  // Session-scoped locks survive the short reservation commit and are released only when
  // the whole attempt ends (success, failure, or exception).
  async function lockScopes(client, keys) {
    for (const key of keys.values) {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [`saven.auth.rate:${key}`]);
    }
  }

  async function unlockScopes(client, keys) {
    for (const key of keys.values) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`saven.auth.rate:${key}`]);
    }
  }

  async function countScope(executor, kind, column, key, at) {
    const config = settings[kind];
    const params = [column, key, at.toISOString(), Math.floor(config.windowMs / 1000)];
    if (kind === 'login') {
      const result = await executor.query(
        `SELECT count(*)::int AS failures,
                min((a.detail_jsonb->>'attempt_at')::timestamptz) AS first_failure
         FROM auth.auth_audit a
         WHERE a.event_type = 'login_failure'
           AND a.outcome = 'failure'
           AND a.detail_jsonb->>$1 = $2
           AND (a.detail_jsonb->>'attempt_order')::numeric >
               COALESCE((
                 SELECT max((s.detail_jsonb->>'attempt_order')::numeric)
                 FROM auth.auth_audit s
                 WHERE s.event_type = 'login_success'
                   AND s.detail_jsonb->>$1 = $2
               ), -1)
           AND (a.detail_jsonb->>'attempt_at')::timestamptz > $3::timestamptz - make_interval(secs => $4)`,
        params,
      );
      return result.rows[0];
    }
    const result = await executor.query(
      `SELECT count(*)::int AS failures,
              min((a.detail_jsonb->>'attempt_at')::timestamptz) AS first_failure
       FROM auth.auth_audit a
       WHERE a.event_type = 'password_reset_requested'
         AND a.outcome <> 'denied'
         AND a.detail_jsonb->>$1 = $2
         AND (a.detail_jsonb->>'attempt_at')::timestamptz > $3::timestamptz - make_interval(secs => $4)`,
      params,
    );
    return result.rows[0];
  }

  // Must run under the held scope locks. Samples the authoritative post-lock time/order.
  async function checkScopes(executor, keys, kind) {
    const config = settings[kind];
    const at = now();
    const orderResult = await executor.query('SELECT pg_current_xact_id()::text AS id');
    const order = orderResult.rows[0].id;
    const verdict = {allowed: true, retryAfterMs: 0, limit: config.limit, kind, at: at.toISOString(), order};
    for (const [name, key] of Object.entries(keys.scopes)) {
      if (!key) continue;
      const column = name === 'network' ? 'throttle_network' : DETAIL_KEY[kind];
      const row = await countScope(executor, kind, column, key, at);
      if (row.failures >= config.limit) {
        const first = row.first_failure ? new Date(row.first_failure).getTime() : at.getTime();
        const retryAfterMs = Math.min(config.windowMs, Math.max(0, first + config.windowMs - at.getTime()));
        return {...verdict, allowed: false, retryAfterMs, scope: name};
      }
    }
    return verdict;
  }

  function accountingBlocked() {
    return now().getTime() < accountingBlockedUntil;
  }

  function noteAccountingFailure() {
    accountingBlockedUntil = now().getTime() + accountingCooldownMs;
  }

  function clearAccountingFailure() {
    accountingBlockedUntil = 0;
  }

  // reserve(client, verdict, meta) must durably write the reservation/denial row inside
  // the open transaction. Any throw is an accounting failure: fail closed and cool down.
  async function attempt({keys, kind, reserve, action}) {
    if (accountingBlocked()) throw new AccountingUnavailableError('Accounting is cooling down after a store failure.');
    return store.withClient(async client => {
      await lockScopes(client, keys);
      let reservation;
      try {
        try {
          await client.query('BEGIN');
          const verdict = await checkScopes(client, keys, kind);
          await reserve(client, verdict);
          await client.query('COMMIT');
          reservation = verdict;
          if (!verdict.allowed) return {throttled: verdict};
        } catch (error) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // The reservation is unknown; cool down below.
          }
          noteAccountingFailure();
          throw new AccountingUnavailableError('The attempt could not be durably reserved.', {cause: error});
        }
        // The scope lock is still held while the caller runs verification and its own
        // success transaction, so no waiting attempt can slip in unrecorded.
        return await action(reservation);
      } finally {
        await unlockScopes(client, keys).catch(() => {});
      }
    });
  }

  return {
    policy: settings,
    keysFor,
    lockScopes,
    unlockScopes,
    checkScopes,
    attempt,
    accountingBlocked,
    noteAccountingFailure,
    clearAccountingFailure,
    accountingCooldownMs,
  };
}

export const __internals = Object.freeze({MIN_WINDOW_MS, MAX_WINDOW_MS, DEFAULT_ACCOUNTING_COOLDOWN_MS});
