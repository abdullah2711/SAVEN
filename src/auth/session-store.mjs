import {createHash, randomBytes} from 'node:crypto';

// AUTH-002 session adapter. This module owns the only path to auth.sessions: it
// mints opaque tokens, persists only their SHA-256 digest, enforces the idle and
// absolute ceilings, and never returns or stores a plaintext token.
//
// The adapter is deliberately library-agnostic. Any session library (including the
// pinned Better Auth) must be wired through this boundary so hash-only storage,
// revoking by UPDATE instead of DELETE, and the absolute ceiling stay enforced;
// see src/auth/README.md.

export const SESSION_DEFAULTS = Object.freeze({
  idleMs: 30 * 24 * 60 * 60 * 1000,
  absoluteMs: 90 * 24 * 60 * 60 * 1000,
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

function mintToken(bytes) {
  return randomBytes(bytes).toString('base64url');
}

// The database clock is authoritative for expiry comparisons, but every write also
// carries the application clock so a test can advance time deterministically.
function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new AuthError(500, 'SESSION_CLOCK_INVALID', 'Invalid session clock.');
  return date;
}

function iso(value) {
  return asDate(value).toISOString();
}

export function createSessionStore({query, clock = () => new Date(), config = {}}) {
  if (typeof query !== 'function') throw new Error('createSessionStore requires a parameterized query function.');
  const idleMs = config.idleMs ?? SESSION_DEFAULTS.idleMs;
  const absoluteMs = config.absoluteMs ?? SESSION_DEFAULTS.absoluteMs;
  const tokenBytes = config.tokenBytes ?? SESSION_DEFAULTS.tokenBytes;
  if (!(idleMs > 0) || !(absoluteMs > 0) || idleMs > absoluteMs) {
    throw new Error('createSessionStore requires 0 < idleMs <= absoluteMs.');
  }

  const now = () => asDate(clock());

  // Reference data, not a hardcoded list: realms come from auth.reference_value.
  async function assertRealm(realm) {
    if (typeof realm !== 'string' || realm.length < 1 || realm.length > 80) {
      throw new AuthError(400, 'SESSION_REALM_INVALID', 'Unknown sign-in realm.');
    }
    const result = await query(
      `SELECT 1 AS allowed FROM auth.reference_value
       WHERE domain = 'realm' AND value = $1 AND is_active
         AND (effective_to IS NULL OR effective_to > now())`,
      [realm],
    );
    if (result.rowCount !== 1) throw new AuthError(400, 'SESSION_REALM_INVALID', 'Unknown sign-in realm.');
  }

  async function assertRole(roleId) {
    if (roleId == null) return null;
    const result = await query(
      `SELECT 1 AS allowed FROM auth.roles WHERE role_id = $1 AND is_active
         AND (effective_to IS NULL OR effective_to > now())`,
      [roleId],
    );
    if (result.rowCount !== 1) throw new AuthError(400, 'SESSION_ROLE_INVALID', 'Unknown assurance role.');
    return roleId;
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
  }) {
    await assertRealm(realm);
    await assertRole(roleId);
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new AuthError(400, 'SESSION_USER_INVALID', 'A verified user is required.');
    }
    if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 1) {
      throw new AuthError(400, 'SESSION_CREDENTIAL_INVALID', 'A verified credential epoch is required.');
    }
    // A selection object may only be produced by a verified server-side membership
    // resolution (AUTH-006). Callers never pass client input here.
    const membership = selection ?? null;
    const token = mintToken(tokenBytes);
    const csrfToken = mintToken(tokenBytes);
    const created = now();
    const absolute = new Date(created.getTime() + absoluteMs);
    const idle = new Date(Math.min(created.getTime() + idleMs, absolute.getTime()));
    const inserted = await query(
      `INSERT INTO auth.sessions(
         user_id, token_hash, realm, role_id, assurance_level, mfa_verified_at,
         selected_membership_id, selected_tenant_id, membership_epoch,
         csrf_token_hash, ip_address, user_agent, credential_version,
         created_at, last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $16)
       RETURNING id, created_at, last_seen_at, idle_expires_at, absolute_expires_at`,
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
    return {token, csrfToken, session: describe(inserted.rows[0])};
  }

  function describe(row) {
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

  // Verified-server-session read. The token is hashed before it reaches SQL, so a
  // logged statement, error or pool trace can never contain the live credential.
  async function readSession(token, {realm = 'customer', touch = false} = {}) {
    const tokenHash = digestToken(token);
    const at = iso(now());
    const result = await query(
      `SELECT s.id, s.user_id, s.realm, s.role_id, s.assurance_level, s.selected_tenant_id,
              s.selected_membership_id, s.membership_epoch, s.credential_version, s.csrf_token_hash,
              s.created_at, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
              s.revoked_at, u.email, u.status AS user_status, u.credential_version AS current_credential_version
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
    if (row.absolute_expires_at.getTime() <= now().getTime()) return null;
    if (row.idle_expires_at.getTime() <= now().getTime()) return null;
    if (touch) await refreshSession(row.id);
    return {
      ...describe(row),
      tokenHash,
      csrfTokenHash: row.csrf_token_hash,
      email: row.email,
      roleId: row.role_id,
      selectedMembershipId: row.selected_membership_id,
      membershipEpoch: row.membership_epoch,
    };
  }

  // Activity may move idle_expires_at forward, never past the absolute ceiling.
  async function refreshSession(sessionId) {
    const at = now();
    const result = await query(
      `UPDATE auth.sessions
       SET last_seen_at = $2,
           idle_expires_at = LEAST($3::timestamptz, absolute_expires_at)
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING id, last_seen_at, idle_expires_at, absolute_expires_at`,
      [sessionId, iso(at), iso(new Date(at.getTime() + idleMs))],
    );
    if (result.rowCount !== 1) return null;
    return describe(result.rows[0]);
  }

  // Privilege/credential changes rotate the token instead of extending the session:
  // the replacement row keeps the original absolute ceiling.
  async function rotateSession(sessionId, {reason = 'privilege_change', actor = null} = {}) {
    const at = now();
    const current = await query(
      `SELECT id, user_id, realm, role_id, assurance_level, mfa_verified_at,
              selected_membership_id, selected_tenant_id, membership_epoch,
              ip_address, user_agent, credential_version,
              created_at, absolute_expires_at
       FROM auth.sessions WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
    if (current.rowCount !== 1) return null;
    const source = current.rows[0];
    const token = mintToken(tokenBytes);
    const csrfToken = mintToken(tokenBytes);
    const idle = new Date(Math.min(at.getTime() + idleMs, source.absolute_expires_at.getTime()));
    const inserted = await query(
      `INSERT INTO auth.sessions(
         user_id, token_hash, realm, role_id, assurance_level, mfa_verified_at,
         selected_membership_id, selected_tenant_id, membership_epoch,
         csrf_token_hash, ip_address, user_agent, credential_version,
         created_at, last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $16)
       RETURNING id, realm, user_id, assurance_level, selected_tenant_id,
                 idle_expires_at, absolute_expires_at, last_seen_at`,
      [
        source.user_id,
        digestToken(token),
        source.realm,
        source.role_id,
        source.assurance_level,
        source.mfa_verified_at == null ? null : iso(source.mfa_verified_at),
        source.selected_membership_id,
        source.selected_tenant_id,
        source.membership_epoch,
        digestToken(csrfToken),
        source.ip_address,
        source.user_agent,
        source.credential_version,
        iso(at),
        iso(idle),
        iso(source.absolute_expires_at),
      ],
    );
    await query(
      `UPDATE auth.sessions SET revoked_at = $2, revoked_reason = $3, revoked_by = $4
       WHERE id = $1 AND revoked_at IS NULL`,
      [source.id, iso(at), reason, actor],
    );
    return {token, csrfToken, session: describe(inserted.rows[0])};
  }

  async function revokeSession(tokenOrHash, {reason = 'logout', actor = null} = {}) {
    const tokenHash = /^[0-9a-f]{64}$/.test(String(tokenOrHash)) ? String(tokenOrHash) : digestToken(tokenOrHash);
    const result = await query(
      `UPDATE auth.sessions
       SET revoked_at = $2, revoked_reason = $3, revoked_by = $4
       WHERE token_hash = $1 AND revoked_at IS NULL
       RETURNING id, user_id`,
      [tokenHash, iso(now()), reason, actor],
    );
    return result.rowCount === 1 ? result.rows[0] : null;
  }

  async function revokeAllSessions(userId, {reason = 'sessions_revoked_all', actor = null} = {}) {
    const result = await query(
      `UPDATE auth.sessions
       SET revoked_at = $2, revoked_reason = $3, revoked_by = $4
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, iso(now()), reason, actor],
    );
    return result.rowCount;
  }

  return {
    createSession,
    readSession,
    refreshSession,
    rotateSession,
    revokeSession,
    revokeAllSessions,
    config: {idleMs, absoluteMs, tokenBytes},
  };
}
