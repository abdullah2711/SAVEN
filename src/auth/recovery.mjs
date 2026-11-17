import {createHash, randomBytes} from 'node:crypto';

// AUTH-005-R2 recovery service.
//
// Email-verification and password-reset challenges live in auth.verification. Only a
// SHA-256 digest of a high-entropy opaque token is stored; the plaintext token exists
// only long enough to be handed to the injected delivery queue. A reset token also
// carries the credential generation (auth.users.credential_version) it was issued under,
// so staleness is decided by an immutable generation rather than wall-clock ordering.
//
// Every consume re-validates purpose (against the reference domain), the account's
// current normalized email (address binding) and, for reset, the current credential
// generation under the principal row lock inside the caller's owned transaction.
// Consumption is conditional, so exactly one consumer wins. Password reset bumps the
// credential generation and revokes every live session in that same transaction.

export const RECOVERY_DEFAULTS = Object.freeze({
  verificationTtlMs: 24 * 60 * 60 * 1000,
  resetTtlMs: 30 * 60 * 1000,
  tokenBytes: 32,
  verificationRequestLimit: 5,
  verificationRequestWindowMs: 60 * 60 * 1000,
});

const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_WINDOW_MS = 60 * 1000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RecoveryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid() {
  return new RecoveryError(400, 'RECOVERY_TOKEN_INVALID', 'The link is invalid or has expired.');
}

function stale() {
  return new RecoveryError(400, 'RECOVERY_TOKEN_STALE', 'The link is no longer valid. Request a new one.');
}

export function normalizeRecoveryEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function digestRecoveryToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw invalid();
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// A token is `<base64url random>.<credential generation>`. The generation is covered by
// the stored digest, so it cannot be rewritten; base64url never contains a dot.
function decodeToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw invalid();
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0].length < 20) throw invalid();
  const generation = Number(parts[1]);
  if (!Number.isSafeInteger(generation) || generation < 1) throw invalid();
  return {valueHash: digestRecoveryToken(token), generation};
}

export function validateRecoveryConfig(config = {}) {
  const merged = {...RECOVERY_DEFAULTS, ...config};
  for (const key of ['verificationTtlMs', 'resetTtlMs']) {
    const value = merged[key];
    if (!Number.isInteger(value) || value < MIN_TTL_MS || value > MAX_TTL_MS) {
      throw new Error(`${key} must be an integer between one minute and seven days.`);
    }
  }
  if (!Number.isInteger(merged.tokenBytes) || merged.tokenBytes < 32 || merged.tokenBytes > 64) {
    throw new Error('Recovery tokens must use 32 to 64 random bytes.');
  }
  if (!Number.isInteger(merged.verificationRequestLimit) || merged.verificationRequestLimit < 1 || merged.verificationRequestLimit > 1000) {
    throw new Error('The verification request limit must be an integer between 1 and 1000.');
  }
  if (!Number.isInteger(merged.verificationRequestWindowMs) ||
      merged.verificationRequestWindowMs < MIN_WINDOW_MS ||
      merged.verificationRequestWindowMs > MAX_WINDOW_MS) {
    throw new Error('The verification request window must be between one minute and 24 hours.');
  }
  return merged;
}

// Purposes are reference data (auth.reference_value domain token_purpose), not a code
// allowlist. Validity is checked both at issue time and again at consumption.
export function createRecoveryService({store, clock = () => new Date(), config = {}} = {}) {
  if (!store || typeof store.withClient !== 'function' || typeof store.withTransaction !== 'function' || typeof store.revokeAllSessions !== 'function') {
    throw new Error('createRecoveryService requires the transactional auth session store.');
  }
  const settings = validateRecoveryConfig(config);
  const now = () => new Date(clock());

  async function assertPurpose(executor, purpose) {
    const at = now().toISOString();
    const result = await executor.query(
      `SELECT 1 AS allowed FROM auth.reference_value
       WHERE domain = 'token_purpose' AND value = $1 AND is_active
         AND effective_from <= $2::timestamptz
         AND (effective_to IS NULL OR effective_to > $2::timestamptz)`,
      [purpose, at],
    );
    if (result.rowCount !== 1) throw invalid();
  }

  function networkTag(network) {
    return typeof network === 'string' && network.length > 0
      ? `net:${createHash('sha256').update(`verification|${network}`, 'utf8').digest('hex')}`
      : null;
  }

  // Issuance resolves the CURRENT active account and address on the owned transaction
  // under a principal lock; a caller's earlier snapshot is never trusted.
  async function issue({userId, purpose, ttlMs, tx, network = null}) {
    if (!tx) throw new Error('Recovery issuance requires an owned transaction client.');
    if (typeof userId !== 'string' || !UUID.test(userId)) throw new RecoveryError(400, 'RECOVERY_SUBJECT_INVALID', 'A verified identity is required.');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      throw new RecoveryError(400, 'RECOVERY_TTL_INVALID', 'The challenge lifetime is invalid.');
    }
    await assertPurpose(tx, purpose);
    const account = await tx.query(
      'SELECT id, email, status, credential_version FROM auth.users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    if (account.rowCount !== 1 || account.rows[0].status !== 'active') {
      throw new RecoveryError(400, 'RECOVERY_SUBJECT_INVALID', 'A verified active account is required.');
    }
    const email = normalizeRecoveryEmail(account.rows[0].email);
    if (email.length < 3 || email.length > 320) {
      throw new RecoveryError(400, 'RECOVERY_IDENTIFIER_INVALID', 'A verified address is required.');
    }
    const generation = Number(account.rows[0].credential_version);
    const token = `${randomBytes(settings.tokenBytes).toString('base64url')}.${generation}`;
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + ttlMs);
    const tag = networkTag(network);
    const result = await tx.query(
      `INSERT INTO auth.verification(
         user_id, identifier, purpose, value_hash, value_digest_algorithm,
         expires_at, request_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'sha256', $5, $6, $7, $7)
       RETURNING id, created_at, expires_at`,
      [userId, email, purpose, digestRecoveryToken(token), expiresAt.toISOString(), tag, issuedAt.toISOString()],
    );
    return {
      token,
      id: result.rows[0].id,
      to: account.rows[0].email,
      identifier: email,
      generation,
      networkTag: tag,
      expiresAt: new Date(result.rows[0].expires_at),
      createdAt: new Date(result.rows[0].created_at),
    };
  }

  async function issueVerification({userId, tx, network = null}) {
    return issue({userId, purpose: 'email_verification', ttlMs: settings.verificationTtlMs, tx, network});
  }

  async function issueReset({userId, tx}) {
    return issue({userId, purpose: 'password_reset', ttlMs: settings.resetTtlMs, tx});
  }

  // Durable request admission for verification mail. The challenge rows themselves are
  // the budget; transaction-scoped advisory locks serialize concurrent requests for the
  // same account and network scope. No password-reset audit rows are written here.
  async function admitVerificationRequest({userId, network = null, tx} = {}) {
    if (!tx) throw new Error('Recovery admission requires an owned transaction client.');
    const at = now();
    const since = new Date(at.getTime() - settings.verificationRequestWindowMs).toISOString();
    const tag = networkTag(network);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`saven.auth.recovery:account:${userId}`]);
    if (tag) await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`saven.auth.recovery:network:${tag}`]);
    const account = await tx.query(
      `SELECT count(*)::int AS n, min(created_at) AS first
       FROM auth.verification
       WHERE purpose = 'email_verification' AND user_id = $1 AND created_at > $2::timestamptz`,
      [userId, since],
    );
    const networkCount = tag
      ? await tx.query(
        `SELECT count(*)::int AS n, min(created_at) AS first
         FROM auth.verification
         WHERE purpose = 'email_verification' AND request_id = $1 AND created_at > $2::timestamptz`,
        [tag, since],
      )
      : {rows: [{n: 0, first: null}]};
    const exceeded = account.rows[0].n >= settings.verificationRequestLimit ||
      networkCount.rows[0].n >= settings.verificationRequestLimit;
    if (!exceeded) return {allowed: true, networkTag: tag, limit: settings.verificationRequestLimit};
    const firsts = [account.rows[0].first, networkCount.rows[0].first]
      .filter(value => value !== null && value !== undefined)
      .map(value => new Date(value).getTime());
    const first = firsts.length > 0 ? Math.min(...firsts) : at.getTime();
    const retryAfterMs = Math.min(
      settings.verificationRequestWindowMs,
      Math.max(0, first + settings.verificationRequestWindowMs - at.getTime()),
    );
    return {allowed: false, retryAfterMs, limit: settings.verificationRequestLimit};
  }

  // Cheap, non-transactional reset probe. It validates current address, generation,
  // purpose validity and expiry, so a stale token never reaches a password KDF.
  async function probeReset(token) {
    let decoded;
    try {
      decoded = decodeToken(token);
    } catch {
      return false;
    }
    return store.withClient(async executor => {
      const at = now().toISOString();
      const result = await executor.query(
        `SELECT 1 AS usable
         FROM auth.verification v
         JOIN auth.users u ON u.id = v.user_id
         WHERE v.value_hash = $1 AND v.purpose = 'password_reset'
           AND v.consumed_at IS NULL AND v.expires_at > $2::timestamptz
           AND u.status = 'active'
           AND lower(v.identifier) = lower(u.email)
           AND u.credential_version = $3
           AND EXISTS (
             SELECT 1 FROM auth.reference_value r
             WHERE r.domain = 'token_purpose' AND r.value = v.purpose AND r.is_active
               AND r.effective_from <= $2::timestamptz
               AND (r.effective_to IS NULL OR r.effective_to > $2::timestamptz)
           )`,
        [decoded.valueHash, at, decoded.generation],
      );
      return result.rowCount === 1;
    });
  }

  async function lockValid(executor, token, purpose) {
    await assertPurpose(executor, purpose);
    const decoded = decodeToken(token);
    const result = await executor.query(
      `SELECT id, user_id, identifier, purpose, created_at, expires_at, consumed_at
       FROM auth.verification
       WHERE value_hash = $1 AND purpose = $2
       FOR UPDATE`,
      [decoded.valueHash, purpose],
    );
    if (result.rowCount !== 1) throw invalid();
    const row = result.rows[0];
    if (row.consumed_at !== null) throw invalid();
    if (new Date(row.expires_at).getTime() <= now().getTime()) throw invalid();
    return {row, generation: decoded.generation};
  }

  async function markConsumed(executor, id) {
    const result = await executor.query(
      `UPDATE auth.verification SET consumed_at = now(), updated_at = now()
       WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
      [id],
    );
    if (result.rowCount !== 1) throw invalid();
  }

  async function consumeVerification(token, {tx} = {}) {
    if (!tx) throw new Error('Recovery consumption requires an owned transaction client.');
    const {row} = await lockValid(tx, token, 'email_verification');
    const account = await tx.query(
      'SELECT id, email, status, email_verified FROM auth.users WHERE id = $1 FOR UPDATE',
      [row.user_id],
    );
    if (account.rowCount !== 1) throw invalid();
    const user = account.rows[0];
    if (user.status !== 'active') throw invalid();
    // Immutable address binding: a challenge issued for an old address can never verify
    // the account's different current address.
    if (normalizeRecoveryEmail(user.email) !== normalizeRecoveryEmail(row.identifier)) throw stale();
    await markConsumed(tx, row.id);
    if (!user.email_verified) {
      await tx.query(
        'UPDATE auth.users SET email_verified = true, email_verified_at = now(), updated_at = now() WHERE id = $1',
        [row.user_id],
      );
    }
    return {userId: String(row.user_id), email: user.email, alreadyVerified: user.email_verified === true};
  }

  async function consumeReset(token, {passwordHash, passwordScheme, tx} = {}) {
    if (!tx) throw new Error('Recovery consumption requires an owned transaction client.');
    if (typeof passwordHash !== 'string' || passwordHash.length < 16 || passwordHash.length > 1024) {
      throw new RecoveryError(422, 'PASSWORD_INVALID', 'The new password could not be accepted.');
    }
    if (typeof passwordScheme !== 'string' || passwordScheme.length < 1 || passwordScheme.length > 80) {
      throw new RecoveryError(422, 'PASSWORD_INVALID', 'The new password could not be accepted.');
    }
    const {row, generation} = await lockValid(tx, token, 'password_reset');
    const account = await tx.query(
      'SELECT id, email, status, credential_version FROM auth.users WHERE id = $1 FOR UPDATE',
      [row.user_id],
    );
    if (account.rowCount !== 1) throw invalid();
    const user = account.rows[0];
    if (user.status !== 'active') throw invalid();
    if (normalizeRecoveryEmail(user.email) !== normalizeRecoveryEmail(row.identifier)) throw stale();
    // Generation binding replaces any wall-clock comparison. A credential change that
    // began earlier but committed later still advances the generation and invalidates.
    if (Number(user.credential_version) !== generation) throw stale();
    await markConsumed(tx, row.id);
    const updated = await tx.query(
      `UPDATE auth.users
       SET password_hash = $2, password_scheme = $3, password_updated_at = now(),
           credential_version = credential_version + 1, updated_by = 'auth005-reset', updated_at = now()
       WHERE id = $1 AND status = 'active'
       RETURNING credential_version`,
      [row.user_id, passwordHash, passwordScheme],
    );
    if (updated.rowCount !== 1) throw invalid();
    const revoked = await store.revokeAllSessions(row.user_id, {
      reason: 'password_reset',
      actor: row.user_id,
      tx,
    });
    return {
      userId: String(row.user_id),
      credentialVersion: Number(updated.rows[0].credential_version),
      revoked,
    };
  }

  // Invalidates an undelivered challenge. This is a best-effort cleanup: a failure here
  // leaves the challenge live until its own expiry, and that boundary is reported rather
  // than claimed as a guarantee.
  async function invalidate(id, {tx} = {}) {
    if (!tx) throw new Error('Recovery invalidation requires an owned transaction client.');
    await tx.query(
      'UPDATE auth.verification SET consumed_at = now(), updated_at = now() WHERE id = $1 AND consumed_at IS NULL',
      [id],
    );
  }

  return {
    settings,
    issueVerification,
    issueReset,
    admitVerificationRequest,
    probeReset,
    consumeVerification,
    consumeReset,
    invalidate,
    digest: digestRecoveryToken,
  };
}
