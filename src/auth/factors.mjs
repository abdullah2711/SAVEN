import {createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

// AUTH-004 TOTP MFA service.
//
// TOTP seeds are recoverable by design and are therefore stored only as versioned
// AES-256-GCM envelopes under deployment-provided keys. Recovery codes are stored as
// keyed one-way digests and consumed with an atomic conditional UPDATE. Verification is
// RFC 6238 (HMAC-SHA1, configurable digits/period/window) with replay refusal per time
// step. Every write path uses the caller's transaction when provided, so factor state
// and its audit row commit together.
//
// No key material lives in this repository: an unconfigured service reports
// `available: false` and fails closed for identities that require MFA.

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

export function totpCode(secret, {at = new Date(), digits = 6, period = 30} = {}) {
  const secretBytes = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const step = Math.floor(new Date(at).getTime() / 1000 / period);
  return hotp(secretBytes, step, digits);
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

function codesEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateMfaConfig(config = {}) {
  const merged = {...TOTP_DEFAULTS, ...config};
  if (!Array.isArray(merged.keys) || merged.keys.length === 0) {
    return {...merged, keys: [], available: false};
  }
  for (const entry of merged.keys) {
    if (!Number.isInteger(entry?.version) || entry.version < 1) throw new Error('MFA key versions must be positive integers.');
    if (!Buffer.isBuffer(entry.key) || entry.key.length !== 32) throw new Error('MFA keys must be 32-byte buffers.');
  }
  if (!Buffer.isBuffer(merged.recoveryHashKey) || merged.recoveryHashKey.length < 32) {
    throw new Error('MFA recovery hash keys must be at least 32-byte buffers.');
  }
  if (!Number.isInteger(merged.digits) || merged.digits < 6 || merged.digits > 8) throw new Error('TOTP digits must be 6 to 8.');
  if (!Number.isInteger(merged.period) || merged.period < 15 || merged.period > 120) throw new Error('TOTP period must be 15 to 120 seconds.');
  if (!Number.isInteger(merged.window) || merged.window < 0 || merged.window > 2) throw new Error('TOTP window must be 0 to 2 steps.');
  if (!Number.isInteger(merged.maxFailures) || merged.maxFailures < 3 || merged.maxFailures > 20) throw new Error('MFA failure limit must be 3 to 20.');
  if (!Number.isInteger(merged.lockoutMs) || merged.lockoutMs < 60_000 || merged.lockoutMs > 24 * 60 * 60 * 1000) throw new Error('MFA lockout must be between one minute and 24 hours.');
  if (!Number.isInteger(merged.recoveryCodeCount) || merged.recoveryCodeCount < 5 || merged.recoveryCodeCount > 20) throw new Error('Recovery code count must be 5 to 20.');
  return {...merged, available: true};
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

function requireAvailable(settings) {
  if (!settings.available) {
    const error = new Error('MFA is not configured for this deployment.');
    error.code = 'MFA_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
}

export function createMfaService({store, clock = () => new Date(), config = {}} = {}) {
  if (!store || typeof store.withClient !== 'function' || typeof store.withTransaction !== 'function') {
    throw new Error('createMfaService requires the auth session store.');
  }
  const settings = validateMfaConfig(config);
  const now = () => new Date(clock());
  const activeKey = settings.keys[0];
  const resolve = (tx, action) => (tx ? action(tx) : store.withClient(action));
  const withExecutor = (tx, action) => (tx ? action(tx) : store.withTransaction(action));

  function stepAt(at = now()) {
    return Math.floor(at.getTime() / 1000 / settings.period);
  }

  function recoveryDigest(code) {
    return createHmac('sha256', settings.recoveryHashKey).update(String(code).trim().toUpperCase(), 'utf8').digest('hex');
  }

  async function authority(userId, {tx} = {}) {
    // Any active membership whose assurance role requires MFA. AUTH-006 narrows this to
    // the verified selected membership; until then the requirement is conservative.
    return resolve(tx, async executor => {
      const result = await executor.query(
        `SELECT DISTINCT m.role_id
         FROM auth.tenant_membership m
         JOIN auth.roles r ON r.role_id = m.role_id
         WHERE m.user_id = $1 AND m.status = 'active' AND r.is_active AND r.requires_mfa
           AND r.effective_from <= $2::timestamptz
           AND (r.effective_to IS NULL OR r.effective_to > $2::timestamptz)`,
        [userId, now().toISOString()],
      );
      return {required: result.rowCount > 0, roleIds: result.rows.map(row => row.role_id)};
    });
  }

  async function factor(userId, {tx} = {}) {
    return resolve(tx, async executor => {
      const result = await executor.query(
        `SELECT id, user_id, factor_type, secret_ciphertext, secret_algorithm, secret_key_version,
                verified_at, last_used_step, failed_attempts, locked_until
         FROM auth.two_factor WHERE user_id = $1 AND factor_type = 'totp'`,
        [userId],
      );
      return result.rowCount === 1 ? result.rows[0] : null;
    });
  }

  async function status(userId, {tx} = {}) {
    const requirement = await authority(userId, {tx});
    const row = await factor(userId, {tx});
    const recovery = await resolve(tx, executor => executor.query(
      `SELECT count(*)::int AS remaining FROM auth.recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    ));
    return {
      required: requirement.required,
      roleIds: requirement.roleIds,
      enrolled: Boolean(row?.verified_at),
      verified: Boolean(row?.verified_at),
      lockedUntil: row?.locked_until ? new Date(row.locked_until).toISOString() : null,
      recoveryRemaining: recovery.rows[0].remaining,
      available: settings.available,
    };
  }

  async function beginEnrollment(userId, {tx} = {}) {
    requireAvailable(settings);
    const secret = base32Encode(randomBytes(settings.secretBytes));
    const ciphertext = envelope(activeKey.key, secret);
    await withExecutor(tx, async executor => {
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
      // A new enrollment invalidates every outstanding recovery code.
      await executor.query(
        `UPDATE auth.recovery_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
    });
    return {otpauthUri: otpauthUri(secret)};
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

  async function registerFailure(executor, row) {
    const failures = Number(row.failed_attempts ?? 0) + 1;
    const lockedUntil = failures >= settings.maxFailures
      ? new Date(now().getTime() + settings.lockoutMs).toISOString()
      : null;
    await executor.query(
      `UPDATE auth.two_factor
       SET failed_attempts = $2, locked_until = COALESCE($3::timestamptz, locked_until), updated_at = now()
       WHERE id = $1`,
      [row.id, failures, lockedUntil],
    );
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
      const code = base32Encode(randomBytes(settings.recoveryCodeBytes)).slice(0, 16);
      codes.push(code);
      await executor.query(
        `INSERT INTO auth.recovery_codes(user_id, code_hash, hash_algorithm, hash_key_version, batch_id)
         VALUES ($1, $2, 'hmac_sha256', 1, $3::uuid)`,
        [userId, recoveryDigest(code), batch],
      );
    }
    return codes;
  }

  async function completeEnrollment(userId, code, {tx} = {}) {
    requireAvailable(settings);
    return withExecutor(tx, async executor => {
      const row = await factor(userId, {tx: executor});
      if (!row) throw mfaError(400, 'MFA_NOT_ENROLLED', 'No pending factor to verify.');
      if (row.verified_at) throw mfaError(409, 'MFA_ALREADY_ENROLLED', 'A verified factor already exists.');
      const secret = openEnvelope(settings.keys, row.secret_key_version, row.secret_ciphertext);
      const step = matchingStep(secret, String(code ?? ''));
      if (step === null) {
        await registerFailure(executor, row);
        throw mfaError(401, 'MFA_CODE_INVALID', 'The verification code is invalid.');
      }
      const verified = await executor.query(
        `UPDATE auth.two_factor SET verified_at = now(), last_used_step = $2, failed_attempts = 0, locked_until = NULL, updated_at = now()
         WHERE id = $1 AND verified_at IS NULL RETURNING id`,
        [row.id, step],
      );
      if (verified.rowCount !== 1) throw mfaError(409, 'MFA_ENROLLMENT_CONFLICT', 'Enrollment was already completed.');
      const codes = await issueRecoveryCodes(executor, userId);
      return {recoveryCodes: codes};
    });
  }

  async function verifyTotp(userId, code, {tx} = {}) {
    requireAvailable(settings);
    return withExecutor(tx, async executor => {
      const row = await factor(userId, {tx: executor});
      if (!row || !row.verified_at) throw mfaError(403, 'MFA_NOT_ENROLLED', 'No verified factor is enrolled.');
      if (row.locked_until && new Date(row.locked_until).getTime() > now().getTime()) {
        throw mfaError(429, 'MFA_LOCKED', 'Too many invalid codes. Try again later.');
      }
      const secret = openEnvelope(settings.keys, row.secret_key_version, row.secret_ciphertext);
      const step = matchingStep(secret, String(code ?? ''));
      if (step === null) {
        await registerFailure(executor, row);
        throw mfaError(401, 'MFA_CODE_INVALID', 'The verification code is invalid.');
      }
      if (!(await consumeStep(executor, row, step))) {
        // Replay of an already consumed step (or a concurrent winner).
        throw mfaError(401, 'MFA_CODE_REPLAYED', 'That code was already used.');
      }
      return {method: 'totp', step};
    });
  }

  async function verifyRecovery(userId, code, {tx} = {}) {
    requireAvailable(settings);
    return withExecutor(tx, async executor => {
      const row = await factor(userId, {tx: executor});
      if (!row || !row.verified_at) throw mfaError(403, 'MFA_NOT_ENROLLED', 'No verified factor is enrolled.');
      const digest = recoveryDigest(code);
      const consumed = await executor.query(
        `UPDATE auth.recovery_codes SET used_at = now()
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
         RETURNING id`,
        [userId, digest],
      );
      if (consumed.rowCount !== 1) throw mfaError(401, 'MFA_RECOVERY_INVALID', 'The recovery code is invalid or already used.');
      return {method: 'recovery'};
    });
  }

  async function disable(userId, {tx} = {}) {
    requireAvailable(settings);
    return withExecutor(tx, async executor => {
      const row = await factor(userId, {tx: executor});
      if (!row) return {disabled: true};
      // Replace the seed with a fresh unverified enrollment so no verified factor remains
      // and no old ciphertext can be replayed.
      const replacement = envelope(activeKey.key, base32Encode(randomBytes(settings.secretBytes)));
      await executor.query(
        `UPDATE auth.two_factor
         SET secret_ciphertext = $2, secret_algorithm = 'aes_256_gcm', secret_key_version = $3,
             verified_at = NULL, last_used_step = NULL, failed_attempts = 0, locked_until = NULL, updated_at = now()
         WHERE id = $1`,
        [row.id, replacement, activeKey.version],
      );
      await executor.query(
        `UPDATE auth.recovery_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      return {disabled: true};
    });
  }

  return {settings, status, authority, beginEnrollment, completeEnrollment, verifyTotp, verifyRecovery, disable};
}

export function mfaError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export const __internals = Object.freeze({envelope, openEnvelope, hotp, codesEqual});
