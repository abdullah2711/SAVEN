import {createHash, randomBytes} from 'node:crypto';

// AUTH-002 session adapter (AUTH-002-R1). This module owns the only path to
// auth.sessions: it mints opaque tokens, persists only their SHA-256 digest,
// enforces the idle and absolute ceilings, serializes rotation, and never returns
// or stores a plaintext token.
//
// Every mutation that must be atomic accepts a checked-out transaction client. The
// caller (routes or the Better Auth adapter) owns the transaction boundary, so a
// success transition and its audit row commit together on the same connection.
//
// Trusted time: the injected application clock is the authoritative source for
// session expiry comparisons and writes. The database enforces structural
// constraints and the immutable absolute ceiling; it is not the session clock.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_CEILINGS = Object.freeze({
  idleMs: 30 * DAY_MS,
  absoluteMs: 90 * DAY_MS,
});
export const SESSION_DEFAULTS = Object.freeze({
  idleMs: SESSION_CEILINGS.idleMs,
  absoluteMs: SESSION_CEILINGS.absoluteMs,
  tokenBytes: 32,
});

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function digestToken(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) {
    throw new AuthError(401, 'SESSION_INVALID', 'Sign in required.');
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isTokenDigest(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function mintToken(bytes) {
  return randomBytes(bytes).toString('base64url');
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new AuthError(500, 'SESSION_CLOCK_INVALID', 'Invalid session clock.');
  return date;
}

function iso(value) {
  return asDate(value).toISOString();
}

function requireInteger(name, value) {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer.`);
  return value;
}

// ADR03 ceilings are hard maxima: a deployment may shorten a session, never extend
// it, and malformed or weaker configuration is refused instead of silently applied.
export function resolveSessionConfig(config = {}) {
  const idleMs = requireInteger('idleMs', config.idleMs ?? SESSION_DEFAULTS.idleMs);
  const absoluteMs = requireInteger('absoluteMs', config.absoluteMs ?? SESSION_DEFAULTS.absoluteMs);
  const tokenBytes = requireInteger('tokenBytes', config.tokenBytes ?? SESSION_DEFAULTS.tokenBytes);
  if (idleMs <= 0 || absoluteMs <= 0) throw new Error('Session durations must be positive.');
  if (idleMs > absoluteMs) throw new Error('Session idle duration cannot exceed the absolute duration.');
  if (idleMs > SESSION_CEILINGS.idleMs) throw new Error('Session idle duration exceeds the 30-day ADR03 ceiling.');
  if (absoluteMs > SESSION_CEILINGS.absoluteMs) throw new Error('Session absolute duration exceeds the 90-day ADR03 ceiling.');
  if (tokenBytes < 32 || tokenBytes > 64) throw new Error('Session tokens must use 32 to 64 random bytes.');
  return {idleMs, absoluteMs, tokenBytes};
}

// Shared session authority checks. Both the first-party store and the Better Auth
// adapter use these predicates so the library cannot become a weaker parallel
// authority: a revoked, disabled, credential-stale, idle-expired or absolutely expired
// row never resolves or refreshes.
export function sessionAuthorityHolds(row, at) {
  if (!row) return false;
  if (row.revoked_at !== null && row.revoked_at !== undefined) return false;
  if (row.user_status !== undefined && row.user_status !== 'active') return false;
  if (
    row.current_credential_version !== undefined &&
    row.credential_version !== row.current_credential_version
  ) {
    return false;
  }
  const moment = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (!(row.absolute_expires_at instanceof Date) || row.absolute_expires_at.getTime() <= moment) return false;
  if (!(row.idle_expires_at instanceof Date) || row.idle_expires_at.getTime() <= moment) return false;
  return true;
}

// A requested expiry may shorten, never lengthen: it is capped by the configured idle
// policy and by the immutable absolute ceiling.
export function capIdleExpiry({at, requested, absolute, idleMs}) {
  const moment = at instanceof Date ? at : new Date(at);
  const ceiling = absolute instanceof Date ? absolute : new Date(absolute);
  const requestedAt = requested instanceof Date ? requested : new Date(requested);
  return new Date(Math.min(requestedAt.getTime(), moment.getTime() + idleMs, ceiling.getTime()));
}

export function createSessionStore({connect, clock = () => new Date(), config = {}}) {
  if (typeof connect !== 'function') {
    throw new Error('createSessionStore requires a connect() function that returns a checked-out client.');
  }
  const settings = resolveSessionConfig(config);
  const now = () => asDate(clock());

  async function withClient(action) {
    const client = await connect();
    try {
      return await action(client);
    } finally {
      await client.release?.();
    }
  }

  // Transaction outcome handling distinguishes a known failed statement from an
  // unknown commit outcome. A commit whose acknowledgement is lost cannot be reported
  // as either success or rollback, so the credential is never published and the
  // connection is destroyed instead of being returned to the pool. A rollback that
  // itself fails also destroys the connection: an uncertain client must not be reused.
  async function withTransaction(action) {
    const client = await connect();
    let released = false;
    const close = async destroy => {
      if (released) return;
      released = true;
      try {
        await client.release?.(destroy ? true : undefined);
      } catch {
        // A release failure cannot be repaired here; the connection is not reused.
      }
    };
    let begun = false;
    try {
      await client.query('BEGIN');
      begun = true;
      const result = await action(client);
      try {
        await client.query('COMMIT');
      } catch {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Unknown state: destroy below.
        }
        await close(true);
        throw new AuthError(
          503,
          'SESSION_TRANSACTION_UNCERTAIN',
          'The session transaction outcome is unknown; no credential was issued.',
        );
      }
      await close(false);
      return result;
    } catch (error) {
      if (!released) {
        if (begun) {
          try {
            await client.query('ROLLBACK');
            await close(false);
          } catch {
            await close(true);
          }
        } else {
          await close(true);
        }
      }
      throw error;
    }
  }

  // Runs a transaction on an ALREADY-OWNED client. No second pool checkout is taken, so
  // a caller holding session locks cannot deadlock against itself when the pool is
  // smallest. A lost COMMIT acknowledgement or failed ROLLBACK marks the lease uncertain;
  // the lease owner destroys that connection instead of returning it to the pool.
  async function transactionOn(client, action, {markUncertain = null} = {}) {
    try {
      await client.query('BEGIN');
    } catch (error) {
      // A BEGIN whose acknowledgement is lost or rejected may have opened a transaction
      // on the server. The caller's lease must be destroyed; never infer cleanliness from
      // a later successful unlock or from a following statement.
      if (markUncertain) markUncertain();
      throw error;
    }
    let result;
    try {
      result = await action(client);
    } catch (error) {
      let rollbackOk = true;
      try {
        await client.query('ROLLBACK');
      } catch {
        rollbackOk = false;
      }
      if (!rollbackOk && markUncertain) markUncertain();
      throw error;
    }
    try {
      await client.query('COMMIT');
    } catch {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Unknown state.
      }
      if (markUncertain) markUncertain();
      throw new AuthError(
        503,
        'SESSION_TRANSACTION_UNCERTAIN',
        'The session transaction outcome is unknown; no credential was issued.',
      );
    }
    return result;
  }

  // Checked-out client lease with an explicit destroy path. Used by the throttling layer
  // so session advisory locks and uncertain transactions cannot leak into later borrowers.
  async function withClientLease(action) {
    const client = await connect();
    let released = false;
    let destroyed = false;
    const markUncertain = () => {
      destroyed = true;
    };
    const lease = {
      query: (text, params) => client.query(text, params),
      transaction: run => transactionOn(client, run, {markUncertain}),
      destroy: markUncertain,
      get destroyed() {
        return destroyed;
      },
    };
    try {
      return await action(lease);
    } finally {
      if (!released) {
        released = true;
        try {
          await client.release?.(destroyed ? true : undefined);
        } catch {
          // A release failure cannot be repaired here; never return to the pool again.
        }
      }
    }
  }

  // Uses a caller-owned transaction when provided, otherwise one checked-out client.
  async function run(tx, action) {
    if (tx) return action(tx);
    return withClient(action);
  }

  async function inTransaction(tx, action) {
    if (tx) return action(tx);
    return withTransaction(action);
  }

  async function assertRealm(executor, realm) {
    if (typeof realm !== 'string' || realm.length < 1 || realm.length > 80) {
      throw new AuthError(400, 'SESSION_REALM_INVALID', 'Unknown sign-in realm.');
    }
    const at = iso(now());
    const result = await executor.query(
      `SELECT 1 AS allowed FROM auth.reference_value
       WHERE domain = 'realm' AND value = $1 AND is_active
         AND effective_from <= $2::timestamptz
         AND (effective_to IS NULL OR effective_to > $2::timestamptz)`,
      [realm, at],
    );
    if (result.rowCount !== 1) throw new AuthError(400, 'SESSION_REALM_INVALID', 'Unknown sign-in realm.');
  }

  async function assertRole(executor, roleId) {
    if (roleId == null) return null;
    const at = iso(now());
    const result = await executor.query(
      `SELECT 1 AS allowed FROM auth.roles
       WHERE role_id = $1 AND is_active
         AND effective_from <= $2::timestamptz
         AND (effective_to IS NULL OR effective_to > $2::timestamptz)`,
      [roleId, at],
    );
    if (result.rowCount !== 1) throw new AuthError(400, 'SESSION_ROLE_INVALID', 'Unknown assurance role.');
    return roleId;
  }

  function publicSession(row) {
    return {
      id: row.id,
      realm: row.realm,
      userId: row.user_id,
      assuranceLevel: row.assurance_level,
      selectedTenantId: row.selected_tenant_id ?? null,
      idleExpiresAt: iso(row.idle_expires_at),
      absoluteExpiresAt: iso(row.absolute_expires_at),
      lastSeenAt: iso(row.last_seen_at),
    };
  }

  async function createSession({
    userId,
    realm = 'customer',
    roleId = null,
    assuranceLevel = 'single_factor',
    mfaVerifiedAt = null,
    selection = null,
    ipAddress = null,
    userAgent = null,
    credentialVersion,
  }, {tx} = {}) {
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new AuthError(400, 'SESSION_USER_INVALID', 'A verified user is required.');
    }
    if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 1) {
      throw new AuthError(400, 'SESSION_CREDENTIAL_INVALID', 'A verified credential epoch is required.');
    }
    const membership = selection ?? null;
    const token = mintToken(settings.tokenBytes);
    const csrfToken = mintToken(settings.tokenBytes);
    const created = now();
    const absolute = new Date(created.getTime() + settings.absoluteMs);
    const idle = capIdleExpiry({
      at: created,
      requested: new Date(created.getTime() + settings.idleMs),
      absolute,
      idleMs: settings.idleMs,
    });
    const inserted = await run(tx, async executor => {
      await assertRealm(executor, realm);
      await assertRole(executor, roleId);
      return executor.query(
        `INSERT INTO auth.sessions(
           user_id, token_hash, realm, role_id, assurance_level, mfa_verified_at,
           selected_membership_id, selected_tenant_id, membership_epoch,
           csrf_token_hash, ip_address, user_agent, credential_version,
           created_at, last_seen_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $16)
         RETURNING id, realm, user_id, assurance_level, selected_tenant_id,
                   created_at, last_seen_at, idle_expires_at, absolute_expires_at`,
        [
          userId,
          digestToken(token),
          realm,
          roleId,
          assuranceLevel,
          mfaVerifiedAt == null ? null : iso(mfaVerifiedAt),
          membership?.membershipId ?? null,
          membership?.tenantId ?? null,
          membership?.membershipEpoch ?? null,
          digestToken(csrfToken),
          ipAddress,
          userAgent,
          credentialVersion,
          iso(created),
          iso(idle),
          iso(absolute),
        ],
      );
    });
    return {token, csrfToken, session: publicSession(inserted.rows[0])};
  }

  // Verified-server-session read. The token is hashed before SQL, so no statement,
  // error or pool trace can contain the live credential.
  async function readSession(token, {realm = 'customer'} = {}) {
    const tokenHash = digestToken(token);
    return withClient(async executor => {
      const result = await executor.query(
        `SELECT s.id, s.user_id, s.realm, s.role_id, s.assurance_level, s.selected_tenant_id,
                s.selected_membership_id, s.membership_epoch, s.credential_version, s.csrf_token_hash,
                s.created_at, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
                s.revoked_at, u.email, u.status AS user_status,
                u.credential_version AS current_credential_version
         FROM auth.sessions s
         JOIN auth.users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.realm = $2`,
        [tokenHash, realm],
      );
      if (result.rowCount !== 1) return null;
      const row = result.rows[0];
      if (row.revoked_at !== null) return null;
      if (row.user_status !== 'active') return null;
      if (row.credential_version !== row.current_credential_version) return null;
      const at = now().getTime();
      if (row.absolute_expires_at.getTime() <= at) return null;
      if (row.idle_expires_at.getTime() <= at) return null;
      return {
        ...publicSession(row),
        tokenHash,
        csrfTokenHash: row.csrf_token_hash,
        email: row.email,
        roleId: row.role_id,
        selectedMembershipId: row.selected_membership_id,
        membershipEpoch: row.membership_epoch,
      };
    });
  }

  // Locks and validates a live session at the mutation boundary. Rotation and logout
  // use this so expiry, status, epoch and CSRF are checked under the row lock rather
  // than against a stale earlier read.
  async function lockSession(token, {realm = 'customer', tx} = {}) {
    const tokenHash = digestToken(token);
    return inTransaction(tx, async executor => {
      const result = await executor.query(
        `SELECT s.id, s.user_id, s.realm, s.role_id, s.assurance_level, s.selected_tenant_id,
                s.selected_membership_id, s.membership_epoch, s.credential_version, s.csrf_token_hash,
                s.created_at, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
                s.revoked_at, u.email, u.status AS user_status,
                u.credential_version AS current_credential_version
         FROM auth.sessions s
         JOIN auth.users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.realm = $2
         FOR UPDATE OF s`,
        [tokenHash, realm],
      );
      if (result.rowCount !== 1) return null;
      const row = result.rows[0];
      if (row.revoked_at !== null) return null;
      if (row.user_status !== 'active') return null;
      if (row.credential_version !== row.current_credential_version) return null;
      const at = now().getTime();
      if (row.absolute_expires_at.getTime() <= at || row.idle_expires_at.getTime() <= at) return null;
      return {
        ...publicSession(row),
        tokenHash,
        csrfTokenHash: row.csrf_token_hash,
        email: row.email,
        roleId: row.role_id,
        selectedMembershipId: row.selected_membership_id,
        membershipEpoch: row.membership_epoch,
      };
    });
  }

  // Activity may move idle_expires_at forward, never past the absolute ceiling. The
  // guard clauses are re-evaluated in the UPDATE, so an idle-expired, revoked,
  // disabled or credential-stale row can never be revived.
  async function refreshSession(sessionId, {tx} = {}) {
    const at = now();
    return run(tx, async executor => {
      const result = await executor.query(
        `UPDATE auth.sessions s
         SET last_seen_at = $2::timestamptz,
             idle_expires_at = LEAST($3::timestamptz, s.absolute_expires_at)
         FROM auth.users u
         WHERE s.id = $1
           AND u.id = s.user_id
           AND s.revoked_at IS NULL
           AND s.absolute_expires_at > $2::timestamptz
           AND s.idle_expires_at > $2::timestamptz
           AND u.status = 'active'
           AND u.credential_version = s.credential_version
         RETURNING s.id, s.realm, s.user_id, s.assurance_level, s.selected_tenant_id,
                   s.created_at, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at`,
        [sessionId, iso(at), iso(new Date(at.getTime() + settings.idleMs))],
      );
      return result.rowCount === 1 ? publicSession(result.rows[0]) : null;
    });
  }

  // Rotation consumes the source row under a lock and creates exactly one successor.
  // The successor keeps the original absolute ceiling. A concurrent rotation or a
  // racing revoke leaves exactly one live token (or none), never two.
  async function rotateSession(sessionId, {reason = 'privilege_change', actor = null, tx} = {}) {
    return inTransaction(tx, async executor => {
      const at = now();
      const source = await executor.query(
        `SELECT s.id, s.user_id, s.realm, s.role_id, s.assurance_level, s.mfa_verified_at,
                s.selected_membership_id, s.selected_tenant_id, s.membership_epoch,
                s.ip_address, s.user_agent, s.credential_version,
                s.created_at, s.idle_expires_at, s.absolute_expires_at,
                u.status AS user_status, u.credential_version AS current_credential_version
         FROM auth.sessions s
         JOIN auth.users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.revoked_at IS NULL
         FOR UPDATE OF s`,
        [sessionId],
      );
      if (source.rowCount !== 1) return null;
      const row = source.rows[0];
      if (row.user_status !== 'active') return null;
      if (row.credential_version !== row.current_credential_version) return null;
      if (row.absolute_expires_at.getTime() <= at.getTime()) return null;
      if (row.idle_expires_at.getTime() <= at.getTime()) return null;

      const token = mintToken(settings.tokenBytes);
      const csrfToken = mintToken(settings.tokenBytes);
      const idle = new Date(Math.min(at.getTime() + settings.idleMs, row.absolute_expires_at.getTime()));
      const inserted = await executor.query(
        `INSERT INTO auth.sessions(
           user_id, token_hash, realm, role_id, assurance_level, mfa_verified_at,
           selected_membership_id, selected_tenant_id, membership_epoch,
           csrf_token_hash, ip_address, user_agent, credential_version,
           created_at, last_seen_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $16)
         RETURNING id, realm, user_id, assurance_level, selected_tenant_id,
                   created_at, last_seen_at, idle_expires_at, absolute_expires_at`,
        [
          row.user_id,
          digestToken(token),
          row.realm,
          row.role_id,
          row.assurance_level,
          row.mfa_verified_at == null ? null : iso(row.mfa_verified_at),
          row.selected_membership_id,
          row.selected_tenant_id,
          row.membership_epoch,
          digestToken(csrfToken),
          row.ip_address,
          row.user_agent,
          row.credential_version,
          iso(at),
          iso(idle),
          iso(row.absolute_expires_at),
        ],
      );
      const revoked = await executor.query(
        `UPDATE auth.sessions SET revoked_at = $2::timestamptz, revoked_reason = $3, revoked_by = $4
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [row.id, iso(at), reason, actor],
      );
      if (revoked.rowCount !== 1) {
        // The row was consumed by a concurrent operation; abandon the successor by
        // rolling the whole transaction back.
        throw new AuthError(409, 'SESSION_ROTATION_CONFLICT', 'Session rotation conflicted with another operation.');
      }
      return {token, csrfToken, session: publicSession(inserted.rows[0])};
    });
  }

  async function revokeSession(tokenOrHash, {reason = 'logout', actor = null, tx} = {}) {
    const tokenHash = isTokenDigest(tokenOrHash) ? String(tokenOrHash) : digestToken(tokenOrHash);
    return run(tx, async executor => {
      const result = await executor.query(
        `UPDATE auth.sessions
         SET revoked_at = $2::timestamptz, revoked_reason = $3, revoked_by = $4
         WHERE token_hash = $1 AND revoked_at IS NULL
         RETURNING id, user_id`,
        [tokenHash, iso(now()), reason, actor],
      );
      return result.rowCount === 1 ? result.rows[0] : null;
    });
  }

  async function revokeAllSessions(userId, {reason = 'sessions_revoked_all', actor = null, tx} = {}) {
    return run(tx, async executor => {
      const result = await executor.query(
        `UPDATE auth.sessions
         SET revoked_at = $2::timestamptz, revoked_reason = $3, revoked_by = $4
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, iso(now()), reason, actor],
      );
      return result.rowCount;
    });
  }

  return {
    createSession,
    readSession,
    lockSession,
    refreshSession,
    rotateSession,
    revokeSession,
    revokeAllSessions,
    withClient,
    withTransaction,
    withClientLease,
    transactionOn,
    config: settings,
    clock: now,
  };
}
