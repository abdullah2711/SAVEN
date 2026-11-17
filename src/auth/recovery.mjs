import {createHash, randomBytes} from 'node:crypto';

// AUTH-005 recovery service.
//
// Email-verification and password-reset challenges live in auth.verification. Only a
// SHA-256 digest of a high-entropy opaque token is stored; the plaintext token exists
// only long enough to be handed to the injected mail adapter. Consumption is a
// conditional UPDATE under a row lock inside the caller's owned transaction, so exactly
// one consumer wins. Password reset bumps the credential epoch and revokes every live
// session in that same transaction; roles, memberships and owner authority are never
// touched here.

export const RECOVERY_DEFAULTS = Object.freeze({
  verificationTtlMs: 24 * 60 * 60 * 1000,
  resetTtlMs: 30 * 60 * 1000,
  tokenBytes: 32,
});

const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

export function digestRecoveryToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw invalid();
  return createHash('sha256').update(token, 'utf8').digest('hex');
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
  return merged;
}

// Purposes are reference data (auth.reference_value domain token_purpose), not a code
// allowlist: a purpose is usable only while its row is active and effective. The two
// purposes this service issues are protocol constants; adding another is a reference
// row plus a typed caller, not an edit to a growing enum.
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

  async function issue({userId, identifier, purpose, ttlMs, tx}) {
    if (!tx) throw new Error('Recovery issuance requires an owned transaction client.');
    if (typeof userId !== 'string' || !UUID.test(userId)) throw new RecoveryError(400, 'RECOVERY_SUBJECT_INVALID', 'A verified identity is required.');
    if (typeof identifier !== 'string' || identifier.trim().length < 1 || identifier.length > 320) {
      throw new RecoveryError(400, 'RECOVERY_IDENTIFIER_INVALID', 'A verified address is required.');
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      throw new RecoveryError(400, 'RECOVERY_TTL_INVALID', 'The challenge lifetime is invalid.');
    }
    await assertPurpose(tx, purpose);
    const token = randomBytes(settings.tokenBytes).toString('base64url');
    const expiresAt = new Date(now().getTime() + ttlMs);
    const result = await tx.query(
      `INSERT INTO auth.verification(
         user_id, identifier, purpose, value_hash, value_digest_algorithm, expires_at)
       VALUES ($1, $2, $3, $4, 'sha256', $5)
       RETURNING id, created_at, expires_at`,
      [userId, identifier.trim(), purpose, digestRecoveryToken(token), expiresAt.toISOString()],
    );
    const row = result.rows[0];
    return {token, id: row.id, expiresAt: new Date(row.expires_at), createdAt: new Date(row.created_at)};
  }

  async function issueVerification({userId, email, tx}) {
    return issue({userId, identifier: email, purpose: 'email_verification', ttlMs: settings.verificationTtlMs, tx});
  }

  async function issueReset({userId, email, tx}) {
    return issue({userId, identifier: email, purpose: 'password_reset', ttlMs: settings.resetTtlMs, tx});
  }

  // Cheap, non-transactional usability check so a garbage or expired token never reaches
  // a password KDF. The authoritative check and consume still happen under the row lock.
  async function probe(token, purpose) {
    let valueHash;
    try {
      valueHash = digestRecoveryToken(token);
    } catch {
      return false;
    }
    return store.withClient(async executor => {
      const result = await executor.query(
        `SELECT 1 AS usable FROM auth.verification
         WHERE value_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > $3::timestamptz`,
        [valueHash, purpose, now().toISOString()],
      );
      return result.rowCount === 1;
    });
  }

  async function lockValid(executor, token, purpose) {
    const valueHash = digestRecoveryToken(token);
    const result = await executor.query(
      `SELECT id, user_id, identifier, purpose, created_at, expires_at, consumed_at
       FROM auth.verification
       WHERE value_hash = $1 AND purpose = $2
       FOR UPDATE`,
      [valueHash, purpose],
    );
    if (result.rowCount !== 1) throw invalid();
    const row = result.rows[0];
    if (row.consumed_at !== null) throw invalid();
    if (new Date(row.expires_at).getTime() <= now().getTime()) throw invalid();
    return row;
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
    const row = await lockValid(tx, token, 'email_verification');
    const userResult = await tx.query(
      'SELECT id, email, status, email_verified FROM auth.users WHERE id = $1 FOR UPDATE',
      [row.user_id],
    );
    if (userResult.rowCount !== 1) throw invalid();
    const user = userResult.rows[0];
    if (user.status !== 'active') throw invalid();
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
    const row = await lockValid(tx, token, 'password_reset');
    const userResult = await tx.query(
      'SELECT id, status, password_updated_at FROM auth.users WHERE id = $1 FOR UPDATE',
      [row.user_id],
    );
    if (userResult.rowCount !== 1) throw invalid();
    const user = userResult.rows[0];
    if (user.status !== 'active') throw invalid();
    // A token issued before a later credential change is stale: an old reset link can
    // never overwrite a credential that has moved on since it was requested.
    if (user.password_updated_at !== null &&
        new Date(user.password_updated_at).getTime() > new Date(row.created_at).getTime()) {
      throw stale();
    }
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

  // Invalidates an undelivered challenge so a mail failure cannot leave a live token
  // behind. Best-effort callers ignore a secondary failure; the token still expires.
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
    probe,
    consumeVerification,
    consumeReset,
    invalidate,
    digest: digestRecoveryToken,
  };
}
