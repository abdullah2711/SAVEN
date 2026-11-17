import {createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

// AUTH-004-R1 TOTP MFA service.
//
// Seeds are stored only as versioned AES-256-GCM envelopes. Recovery codes are keyed
// one-way digests with a truthful hash-key version. Every transactional operation runs
// on the caller's already-owned transaction client, locks the principal and factor rows
// in a deterministic order (users -> two_factor), and binds the verified transaction
// context (app.current_user_id) before reading RLS-protected membership rows.
//
// Authority resolution is fail-closed and explicit: `resolved:false` means the
// membership requirement could not be established under enforced RLS, which callers
// must distinguish from a verified non-required identity.

export const TOTP_DEFAULTS = Object.freeze({
  issuer: 'SAVEN',
  digits: 6,
  period: 30,
  window: 1,
  maxFailures: 5,
  lockoutMs: 15 * 60 * 1000,
  recoveryCodeCount: 10,
  recoveryCodeBytes: 10,
  secretBytes: 20,
});

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text) {
  const clean = String(text).replaceAll('=', '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 input.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secretBytes, step, digits) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secretBytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpCode(secret, {at = new Date(), digits = 6, period = 30} = {}) {
  const secretBytes = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  return hotp(secretBytes, Math.floor(new Date(at).getTime() / 1000 / period), digits);
}

function codesEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function uniqueVersions(name, values) {
  const seen = new Set();
  for (const entry of values) {
    if (!Number.isInteger(entry?.version) || entry.version < 1) throw new Error(`${name} key versions must be positive integers.`);
    if (seen.has(entry.version)) throw new Error(`${name} key versions must be unique.`);
    seen.add(entry.version);
  }
}

export function validateMfaConfig(config = {}) {
  const merged = {...TOTP_DEFAULTS, ...config, keys: config.keys ?? [], recoveryKeys: config.recoveryKeys ?? []};
  if (!Number.isInteger(merged.secretBytes) || merged.secretBytes < 20 || merged.secretBytes > 64) {
    throw new Error('TOTP secretBytes must be 20 to 64 random bytes.');
  }
  if (!Number.isInteger(merged.recoveryCodeBytes) || merged.recoveryCodeBytes < 10 || merged.recoveryCodeBytes > 32) {
    throw new Error('Recovery code entropy must be 10 to 32 random bytes.');
  }
  if (!Number.isInteger(merged.digits) || merged.digits < 6 || merged.digits > 8) throw new Error('TOTP digits must be 6 to 8.');
  if (!Number.isInteger(merged.period) || merged.period < 15 || merged.period > 120) throw new Error('TOTP period must be 15 to 120 seconds.');
  if (!Number.isInteger(merged.window) || merged.window < 0 || merged.window > 2) throw new Error('TOTP window must be 0 to 2 steps.');
  if (!Number.isInteger(merged.maxFailures) || merged.maxFailures < 3 || merged.maxFailures > 20) throw new Error('MFA failure limit must be 3 to 20.');
  if (!Number.isInteger(merged.lockoutMs) || merged.lockoutMs < 60_000 || merged.lockoutMs > 24 * 60 * 60 * 1000) throw new Error('MFA lockout must be between one minute and 24 hours.');
  if (!Number.isInteger(merged.recoveryCodeCount) || merged.recoveryCodeCount < 5 || merged.recoveryCodeCount > 20) throw new Error('Recovery code count must be 5 to 20.');

  if (merged.keys.length === 0) return {...merged, available: false, activeRecoveryVersion: null};
  uniqueVersions('MFA', merged.keys);
  for (const entry of merged.keys) {
    if (!Buffer.isBuffer(entry.key) || entry.key.length !== 32) throw new Error('MFA encryption keys must be 32-byte buffers.');
  }
  if (merged.recoveryKeys.length === 0) throw new Error('MFA recovery keys are required when MFA is configured.');
  uniqueVersions('MFA recovery', merged.recoveryKeys);
  for (const entry of merged.recoveryKeys) {
    if (!Buffer.isBuffer(entry.key) || entry.key.length < 32) throw new Error('MFA recovery keys must be at least 32-byte buffers.');
  }
  const active = merged.recoveryActiveVersion ?? Math.max(...merged.recoveryKeys.map(entry => entry.version));
  if (!merged.recoveryKeys.some(entry => entry.version === active)) throw new Error('The active recovery key version must exist.');
  return {...merged, available: true, activeRecoveryVersion: active};
}

function envelope(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

function openEnvelope(keys, version, value) {
  const entry = keys.find(candidate => candidate.version === version);
  if (!entry) throw new Error('Unknown MFA key version.');
  const [iv, tag, ciphertext] = String(value).split('.');
  if (!iv || !tag || ciphertext === undefined) throw new Error('Malformed MFA envelope.');
  const decipher = createDecipheriv('aes-256-gcm', entry.key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function mfaError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requireAvailable(settings) {
  if (!settings.available) throw mfaError(503, 'MFA_UNAVAILABLE', 'MFA is not configured for this deployment.');
}

export function createMfaService({store, clock = () => new Date(), config = {}, onVerification = null} = {}) {
  if (!store || typeof store.withClient !== 'function' || typeof store.withTransaction !== 'function') {
    throw new Error('createMfaService requires the auth session store.');
  }
  const settings = validateMfaConfig(config);
  const now = () => new Date(clock());
  const activeKey = settings.keys[0] ?? null;
  const resolve = (tx, action) => (tx ? action(tx) : store.withClient(action));
  const withExecutor = (tx, action) => (tx ? action(tx) : store.withTransaction(action));

  function stepAt(at = now()) {
    return Math.floor(at.getTime() / 1000 / settings.period);
  }

  function digestWith(version, code) {
    const entry = settings.recoveryKeys.find(candidate => candidate.version === version);
    if (!entry) return null;
    return createHmac('sha256', entry.key).update(String(code).trim().toUpperCase(), 'utf8').digest('hex');
  }

  function recoveryDigest(code) {
    return digestWith(settings.activeRecoveryVersion, code);
  }

  // Deterministic lifecycle lock order: principal row, then factor row. Every factor
  // mutation and verification uses this same order.
  async function lockLifecycle(executor, userId) {
    const user = await executor.query('SELECT id, status, credential_version FROM auth.users WHERE id = $1 FOR UPDATE', [userId]);
    if (user.rowCount !== 1) throw mfaError(404, 'MFA_USER_UNKNOWN', 'Unknown identity.');
    const factor = await executor.query(
      `SELECT id, user_id, secret_ciphertext, secret_algorithm, secret_key_version,
              verified_at, last_used_step, failed_attempts, locked_until
       FROM auth.two_factor WHERE user_id = $1 AND factor_type = 'totp' FOR UPDATE`,
      [userId],
    );
    return {user: user.rows[0], factor: factor.rowCount === 1 ? factor.rows[0] : null};
  }

  function assertUnlocked(factor) {
    if (factor?.locked_until && new Date(factor.locked_until).getTime() > now().getTime()) {
      throw mfaError(429, 'MFA_LOCKED', 'Too many failed attempts. Try again later.');
    }
  }

  // Relative, atomic increment: parallel failures cannot overwrite each other.
  async function registerFailure(executor, factor) {
    const lockAt = new Date(now().getTime() + settings.lockoutMs).toISOString();
    const result = await executor.query(
      `UPDATE auth.two_factor
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN $3::timestamptz ELSE locked_until END,
           updated_at = now()
       WHERE id = $1
       RETURNING failed_attempts, locked_until`,
      [factor.id, settings.maxFailures, lockAt],
    );
    return result.rows[0];
  }

  async function resetFailure(executor, factorId) {
    await executor.query(
      'UPDATE auth.two_factor SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
      [factorId],
    );
  }

  // Every write that proves a secret is authorized to touch the factor lifecycle.
  async function registerPasswordFailure(userId, {tx} = {}) {
    return withExecutor(tx, async executor => {
      const {factor: row} = await lockLifecycle(executor, userId);
      assertUnlocked(row);
      return row ? registerFailure(executor, row) : {failed_attempts: 0, locked_until: null};
    });
  }

  async function checkLocked(userId, {tx} = {}) {
    return withExecutor(tx, async executor => {
      const {factor: row} = await lockLifecycle(executor, userId);
      assertUnlocked(row);
      return {locked: false};
    });
  }

  // Binds the verified principal to transaction-local context, then reads the
  // RLS-protected membership authority. The parameter and the GUC are the same verified
  // server-side user; no client value participates.
  async function authority(userId, {tx} = {}) {
    if (!tx) throw new Error('MFA authority requires an owned transaction client.');
    if (typeof userId !== 'string' || !UUID.test(userId)) {
      return {resolved: false, required: false, roleIds: [], reason: 'invalid_principal'};
    }
    try {
      await tx.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const bound = await tx.query("SELECT current_setting('app.current_user_id', true) AS value");
      if (bound.rows[0]?.value !== userId) {
        return {resolved: false, required: false, roleIds: [], reason: 'context_not_bound'};
      }
      const result = await tx.query(
        `SELECT DISTINCT m.role_id
         FROM auth.tenant_membership m
         JOIN auth.roles r ON r.role_id = m.role_id
         WHERE m.user_id = $1 AND m.status = 'active' AND r.is_active AND r.requires_mfa
           AND r.effective_from <= $2::timestamptz
           AND (r.effective_to IS NULL OR r.effective_to > $2::timestamptz)`,
        [userId, now().toISOString()],
      );
      return {resolved: true, required: result.rowCount > 0, roleIds: result.rows.map(row => row.role_id)};
    } catch {
      return {resolved: false, required: false, roleIds: [], reason: 'authority_unavailable'};
    }
  }

  // Revalidates the caller's verified session and principal INSIDE the owned
  // transaction, after the deterministic lifecycle locks (users -> two_factor) are
  // held. The session row is read WITHOUT a row lock: taking one here would oppose
  // the session-row locks used by rotation/logout and could deadlock a concurrent
  // lifecycle request. No nested pool checkout is taken; the caller's client is used.
  //
  // This is the common lifecycle authorization boundary: a session that was valid at
  // the earlier non-transactional read but has since been revoked, idle/absolutely
  // expired, disabled, or had its credential epoch changed is refused before any
  // reauthentication (KDF) or factor mutation.
  async function assertMutationAuthority({session, tx} = {}) {
    if (!tx) throw new Error('MFA mutation authority requires an owned transaction client.');
    if (!session || typeof session.id !== 'string' || typeof session.userId !== 'string' || typeof session.realm !== 'string') {
      throw mfaError(401, 'SESSION_REQUIRED', 'Sign in required.');
    }
    const refuse = () => mfaError(401, 'SESSION_REQUIRED', 'Sign in required.');
    let locked;
    try {
      locked = await lockLifecycle(tx, session.userId);
    } catch (error) {
      if (error?.code === 'MFA_USER_UNKNOWN') throw refuse();
      throw error;
    }
    if (locked.user.status !== 'active') throw refuse();
    const result = await tx.query(
      `SELECT s.id, s.user_id, s.realm, s.revoked_at, s.credential_version,
              s.idle_expires_at, s.absolute_expires_at,
              u.status AS user_status, u.credential_version AS current_credential_version
       FROM auth.sessions s
       JOIN auth.users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [session.id],
    );
    if (result.rowCount !== 1) throw refuse();
    const row = result.rows[0];
    if (String(row.user_id) !== String(session.userId)) throw refuse();
    if (row.realm !== session.realm) throw refuse();
    if (row.revoked_at !== null) throw refuse();
    if (row.user_status !== 'active') throw refuse();
    if (Number(row.credential_version) !== Number(row.current_credential_version)) throw refuse();
    const at = now().getTime();
    if (new Date(row.absolute_expires_at).getTime() <= at) throw refuse();
    if (new Date(row.idle_expires_at).getTime() <= at) throw refuse();
    return {userId: String(row.user_id), credentialVersion: Number(row.current_credential_version)};
  }

  async function status(userId, {tx} = {}) {
    return withExecutor(tx, async executor => {
      const requirement = await authority(userId, {tx: executor});
      const factorRow = await executor.query(
        `SELECT verified_at, locked_until FROM auth.two_factor WHERE user_id = $1 AND factor_type = 'totp'`,
        [userId],
      );
      const recovery = await executor.query(
        'SELECT count(*)::int AS remaining FROM auth.recovery_codes WHERE user_id = $1 AND used_at IS NULL',
        [userId],
      );
      const row = factorRow.rows[0] ?? null;
      return {
        resolved: requirement.resolved,
        reason: requirement.reason ?? null,
        required: requirement.required,
        roleIds: requirement.roleIds,
        enrolled: Boolean(row?.verified_at),
        verified: Boolean(row?.verified_at),
        lockedUntil: row?.locked_until ? new Date(row.locked_until).toISOString() : null,
        recoveryRemaining: recovery.rows[0].remaining,
        available: settings.available,
      };
    });
  }

  async function downgradeSessions(executor, userId) {
    await executor.query(
      `UPDATE auth.sessions
       SET assurance_level = 'single_factor', mfa_verified_at = NULL, updated_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL AND assurance_level <> 'single_factor'`,
      [userId],
    );
  }

  // Initial enrollment is allowed only with no verified factor. Replacing a verified
  // factor requires replaceAuthorized=true, which the route sets only after password
  // reauthentication plus a current TOTP or recovery proof in the same transaction.
  async function beginEnrollment(userId, {tx, replaceAuthorized = false} = {}) {
    requireAvailable(settings);
    return withExecutor(tx, async executor => {
      const {factor: row} = await lockLifecycle(executor, userId);
      assertUnlocked(row);
      if (row?.verified_at && !replaceAuthorized) {
        throw mfaError(403, 'MFA_REAUTH_REQUIRED', 'Reauthentication and an existing factor are required to replace the enrolled factor.');
      }
      const secret = base32Encode(randomBytes(settings.secretBytes));
      const ciphertext = envelope(activeKey.key, secret);
      if (!row || row.verified_at) {
        // Fresh enrollment (or an authorized replacement): reset counters and prior proofs.
        await executor.query(
          `INSERT INTO auth.two_factor(
             user_id, factor_type, secret_ciphertext, secret_algorithm, secret_key_version,
             verified_at, last_used_step, failed_attempts, locked_until)
           VALUES ($1, 'totp', $2, 'aes_256_gcm', $3, NULL, NULL, 0, NULL)
           ON CONFLICT (user_id, factor_type) DO UPDATE
             SET secret_ciphertext = EXCLUDED.secret_ciphertext,
                 secret_algorithm = EXCLUDED.secret_algorithm,
                 secret_key_version = EXCLUDED.secret_key_version,
                 verified_at = NULL,
                 last_used_step = NULL,
                 failed_attempts = 0,
                 locked_until = NULL,
                 updated_at = now()`,
          [userId, ciphertext, activeKey.version],
        );
        await executor.query('UPDATE auth.recovery_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
        await downgradeSessions(executor, userId);
        return {otpauthUri: otpauthUri(secret), replaced: Boolean(row?.verified_at)};
      }
      // Pending restart: new seed, but never reset the failure counter or its lock.
      await executor.query(
        `UPDATE auth.two_factor
         SET secret_ciphertext = $2, secret_algorithm = 'aes_256_gcm', secret_key_version = $3,
             last_used_step = NULL, updated_at = now()
         WHERE id = $1`,
        [row.id, ciphertext, activeKey.version],
      );
      return {otpauthUri: otpauthUri(secret), replaced: false};
    });
  }

  function otpauthUri(secret) {
    return `otpauth://totp/${encodeURIComponent(settings.issuer)}?secret=${secret}` +
      `&issuer=${encodeURIComponent(settings.issuer)}&algorithm=SHA1&digits=${settings.digits}&period=${settings.period}`;
  }

  function matchingStep(secret, code, at = now()) {
    const current = stepAt(at);
    for (let delta = -settings.window; delta <= settings.window; delta += 1) {
      const step = current + delta;
      if (step < 0) continue;
      if (codesEqual(hotp(base32Decode(secret), step, settings.digits), code)) return step;
    }
    return null;
  }

  async function consumeStep(executor, row, step) {
    const result = await executor.query(
      `UPDATE auth.two_factor
       SET last_used_step = $2, failed_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE id = $1 AND (last_used_step IS NULL OR last_used_step < $2)
       RETURNING id`,
      [row.id, step],
    );
    return result.rowCount === 1;
  }

  async function issueRecoveryCodes(executor, userId) {
    const codes = [];
    const batch = randomBytes(16).toString('hex');
    for (let index = 0; index < settings.recoveryCodeCount; index += 1) {
      const code = base32Encode(randomBytes(settings.recoveryCodeBytes)).slice(0, 24);
      codes.push(code);
      await executor.query(
        `INSERT INTO auth.recovery_codes(user_id, code_hash, hash_algorithm, hash_key_version, batch_id)
         VALUES ($1, $2, 'hmac_sha256', $3, $4::uuid)`,
        [userId, recoveryDigest(code), settings.activeRecoveryVersion, batch],
      );
    }
    return codes;
  }

  async function completeEnrollment(userId, code, {tx} = {}) {
    requireAvailable(settings);
    return withExecutor(tx, async executor => {
      const {factor: row} = await lockLifecycle(executor, userId);
      if (!row) throw mfaError(400, 'MFA_NOT_ENROLLED', 'No pending factor to verify.');
      if (row.verified_at) throw mfaError(409, 'MFA_ALREADY_ENROLLED', 'A verified factor already exists.');
      assertUnlocked(row);
      onVerification?.({operation: 'completeEnrollment', userId});
      let step = null;
      try {
        const secret = openEnvelope(settings.keys, row.secret_key_version, row.secret_ciphertext);
        step = matchingStep(secret, String(code ?? ''));
      } catch {
        step = null;
      }
      if (step === null) {
        await registerFailure(executor, row);
        throw mfaError(401, 'MFA_CODE_INVALID', 'The verification code is invalid.');
      }
      const verified = await executor.query(
        `UPDATE auth.two_factor
         SET verified_at = now(), last_used_step = $2, failed_attempts = 0, locked_until = NULL, updated_at = now()
         WHERE id = $1 AND verified_at IS NULL RETURNING id`,
        [row.id, step],
      );
      if (verified.rowCount !== 1) throw mfaError(409, 'MFA_ENROLLMENT_CONFLICT', 'Enrollment was already completed.');
      const codes = await issueRecoveryCodes(executor, userId);
      return {recoveryCodes: codes};
    });
  }

  async function requireVerifiedFactor(executor, userId) {
    const {factor: row} = await lockLifecycle(executor, userId);
    if (!row || !row.verified_at) throw mfaError(403, 'MFA_NOT_ENROLLED', 'No verified factor is enrolled.');
    assertUnlocked(row);
    return row;
  }

  async function verifyTotp(userId, code, {tx} = {}) {
    requireAvailable(settings);
    return withExecutor(tx, async executor => {
      const row = await requireVerifiedFactor(executor, userId);
      onVerification?.({operation: 'verifyTotp', userId});
      let step = null;
      try {
        const secret = openEnvelope(settings.keys, row.secret_key_version, row.secret_ciphertext);
        step = matchingStep(secret, String(code ?? ''));
      } catch {
        step = null;
      }
      if (step === null) {
        await registerFailure(executor, row);
        throw mfaError(401, 'MFA_CODE_INVALID', 'The verification code is invalid.');
      }
      if (!(await consumeStep(executor, row, step))) {
        throw mfaError(401, 'MFA_CODE_REPLAYED', 'That code was already used.');
      }
      return {method: 'totp', step};
    });
  }

  async function verifyRecovery(userId, code, {tx} = {}) {
    requireAvailable(settings);
    return withExecutor(tx, async executor => {
      const row = await requireVerifiedFactor(executor, userId);
      onVerification?.({operation: 'verifyRecovery', userId});
      const digest = recoveryDigest(code);
      const candidates = await executor.query(
        `SELECT id, code_hash, hash_key_version FROM auth.recovery_codes
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      let match = null;
      if (digest) {
        for (const candidate of candidates.rows) {
          // Any configured recovery key version remains usable for codes issued under
          // it; retiring a key explicitly makes its outstanding codes unusable.
          const expected = digestWith(candidate.hash_key_version, code);
          if (expected && codesEqual(expected, candidate.code_hash)) {
            match = candidate;
            break;
          }
        }
      }
      if (!match) {
        await registerFailure(executor, row);
        throw mfaError(401, 'MFA_RECOVERY_INVALID', 'The recovery code is invalid or already used.');
      }
      const consumed = await executor.query(
        'UPDATE auth.recovery_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id',
        [match.id],
      );
      if (consumed.rowCount !== 1) {
        await registerFailure(executor, row);
        throw mfaError(401, 'MFA_RECOVERY_INVALID', 'The recovery code is invalid or already used.');
      }
      await resetFailure(executor, row.id);
      return {method: 'recovery'};
    });
  }

  // Caller must have proved password and a current factor in this transaction.
  async function disable(userId, {tx} = {}) {
    requireAvailable(settings);
    return withExecutor(tx, async executor => {
      const {factor: row} = await lockLifecycle(executor, userId);
      if (!row) return {disabled: true};
      if (!row.verified_at) throw mfaError(409, 'MFA_NOT_ENROLLED', 'No verified factor is enrolled.');
      const replacement = envelope(activeKey.key, base32Encode(randomBytes(settings.secretBytes)));
      await executor.query(
        `UPDATE auth.two_factor
         SET secret_ciphertext = $2, secret_algorithm = 'aes_256_gcm', secret_key_version = $3,
             verified_at = NULL, last_used_step = NULL, failed_attempts = 0, locked_until = NULL, updated_at = now()
         WHERE id = $1`,
        [row.id, replacement, activeKey.version],
      );
      await executor.query('UPDATE auth.recovery_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await downgradeSessions(executor, userId);
      return {disabled: true};
    });
  }

  return {
    settings,
    authority,
    assertMutationAuthority,
    status,
    lockLifecycle,
    assertUnlocked,
    registerPasswordFailure,
    checkLocked,
    beginEnrollment,
    completeEnrollment,
    verifyTotp,
    verifyRecovery,
    disable,
  };
}

export const __internals = Object.freeze({envelope, openEnvelope, hotp, codesEqual});
