import {argon2 as argon2Callback, randomBytes, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {encodePassword as retainedScryptEncode, verifyPassword as retainedScryptVerify} from '../passwords.mjs';

// AUTH-003 password policy and versioned KDF adapter.
//
// Argon2id is preferred for new verifiers and is available through Node's native
// OpenSSL binding, so no new dependency is introduced. Existing bounded scrypt
// verifiers remain compatible and are upgraded on the next successful sign-in.
// bcrypt and plaintext storage are not supported. Unknown or malformed schemes fail
// closed after the same bounded dummy derivation, so timing does not disclose
// account state.

const argon2 = promisify(argon2Callback);

export const PASSWORD_POLICY_VERSION = 1;

export const DEFAULT_PASSWORD_POLICY = Object.freeze({
  version: PASSWORD_POLICY_VERSION,
  minLength: 12,
  maxLength: 128,
  maxBytes: 512,
  preferredScheme: 'argon2id',
  retainedSchemes: ['scrypt'],
  maxConcurrentKdfs: 2,
  argon2id: Object.freeze({
    memoryKiB: 65536,
    passes: 3,
    parallelism: 1,
    tagLength: 32,
    saltBytes: 16,
    // Verification bounds protect against a tampered or absurd stored verifier.
    maxMemoryKiB: 262144,
    maxPasses: 10,
    maxParallelism: 8,
  }),
});

const SCRYPT_HASH = /^scrypt\$1\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
const ARGON2ID_HASH = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

export class PasswordPolicyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function validatePolicy(policy) {
  const merged = {...DEFAULT_PASSWORD_POLICY, ...policy, argon2id: {...DEFAULT_PASSWORD_POLICY.argon2id, ...policy?.argon2id}};
  if (!Number.isInteger(merged.minLength) || merged.minLength < 8) throw new Error('Password minimum length must be an integer of at least 8.');
  if (!Number.isInteger(merged.maxLength) || merged.maxLength < merged.minLength) throw new Error('Password maximum length must be an integer of at least the minimum.');
  if (!Number.isInteger(merged.maxBytes) || merged.maxBytes < merged.maxLength) throw new Error('Password byte bound must be at least the character bound.');
  if (merged.maxBytes > 1024) throw new Error('Password byte bound may not exceed 1024.');
  if (!Number.isInteger(merged.maxConcurrentKdfs) || merged.maxConcurrentKdfs < 1 || merged.maxConcurrentKdfs > 4) {
    throw new Error('Password KDF concurrency must be between 1 and 4.');
  }
  const argon = merged.argon2id;
  if (!Number.isInteger(argon.memoryKiB) || argon.memoryKiB < 8192 || argon.memoryKiB > argon.maxMemoryKiB) throw new Error('Invalid Argon2id memory bound.');
  if (!Number.isInteger(argon.passes) || argon.passes < 1 || argon.passes > argon.maxPasses) throw new Error('Invalid Argon2id pass bound.');
  if (!Number.isInteger(argon.parallelism) || argon.parallelism < 1 || argon.parallelism > argon.maxParallelism) throw new Error('Invalid Argon2id parallelism bound.');
  if (!Number.isInteger(argon.tagLength) || argon.tagLength < 16 || argon.tagLength > 64) throw new Error('Invalid Argon2id tag length.');
  if (!Number.isInteger(argon.saltBytes) || argon.saltBytes < 16 || argon.saltBytes > 64) throw new Error('Invalid Argon2id salt length.');
  if (merged.preferredScheme !== 'argon2id' && merged.preferredScheme !== 'scrypt') throw new Error('Unsupported preferred password scheme.');
  return merged;
}

function requirePasswordInput(password, policy) {
  if (typeof password !== 'string') throw new PasswordPolicyError(422, 'PASSWORD_INVALID', 'Use a password of 12 to 128 characters.');
  if (password.length < policy.minLength || password.length > policy.maxLength) {
    throw new PasswordPolicyError(422, 'PASSWORD_LENGTH', `Use a password of ${policy.minLength} to ${policy.maxLength} characters.`);
  }
  if (Buffer.byteLength(password, 'utf8') > policy.maxBytes) {
    throw new PasswordPolicyError(422, 'PASSWORD_LENGTH', 'The password is too long.');
  }
  if (password.includes('\u0000')) throw new PasswordPolicyError(422, 'PASSWORD_INVALID', 'Use a password of 12 to 128 characters.');
}

export function createPasswordPolicy({policy = {}, scryptEncode = null, scryptVerify = null} = {}) {
  const settings = validatePolicy(policy);
  const scryptHash = scryptEncode ?? retainedScryptEncode;
  const scryptCheck = scryptVerify ?? retainedScryptVerify;

  let activeKdfs = 0;
  async function bounded(operation, fallback) {
    if (activeKdfs >= settings.maxConcurrentKdfs) {
      // Refuse rather than queue unbounded work; the caller maps this to a retry.
      return fallback();
    }
    activeKdfs += 1;
    try {
      return await operation();
    } finally {
      activeKdfs -= 1;
    }
  }

  async function argon2idHash(password) {
    const salt = randomBytes(settings.argon2id.saltBytes);
    const tag = await argon2('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      memory: settings.argon2id.memoryKiB,
      passes: settings.argon2id.passes,
      parallelism: settings.argon2id.parallelism,
      tagLength: settings.argon2id.tagLength,
    });
    return {
      hash: `$argon2id$v=19$m=${settings.argon2id.memoryKiB},t=${settings.argon2id.passes},p=${settings.argon2id.parallelism}` +
        `$${salt.toString('base64')}$${Buffer.from(tag).toString('base64')}`,
      scheme: 'argon2id',
    };
  }

  async function hash(password) {
    requirePasswordInput(password, settings);
    if (settings.preferredScheme === 'argon2id') {
      return bounded(() => argon2idHash(password), async () => {
        throw new PasswordPolicyError(429, 'PASSWORD_BUSY', 'Sign-in is busy. Try again shortly.');
      });
    }
    return scryptHash(password).then(value => ({hash: value, scheme: 'scrypt'}));
  }

  // Always performs a bounded derivation, even for an absent or unknown verifier.
  async function dummy(password) {
    const salt = randomBytes(settings.argon2id.saltBytes);
    await argon2('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      memory: settings.argon2id.memoryKiB,
      passes: 1,
      parallelism: 1,
      tagLength: settings.argon2id.tagLength,
    }).catch(() => null);
    return false;
  }

  function inspect(credential) {
    const hash = typeof credential === 'string' ? credential : credential?.hash;
    if (typeof hash !== 'string') return {scheme: 'unknown'};
    if (SCRYPT_HASH.test(hash)) return {scheme: 'scrypt', hash};
    const argon = ARGON2ID_HASH.exec(hash);
    if (argon) {
      return {
        scheme: 'argon2id',
        hash,
        memoryKiB: Number(argon[1]),
        passes: Number(argon[2]),
        parallelism: Number(argon[3]),
        salt: argon[4],
        tag: argon[5],
      };
    }
    return {scheme: 'unknown'};
  }

  async function verifyArgon2id(password, parsed) {
    const argon = settings.argon2id;
    if (
      !Number.isInteger(parsed.memoryKiB) || parsed.memoryKiB < 8192 || parsed.memoryKiB > argon.maxMemoryKiB ||
      !Number.isInteger(parsed.passes) || parsed.passes < 1 || parsed.passes > argon.maxPasses ||
      !Number.isInteger(parsed.parallelism) || parsed.parallelism < 1 || parsed.parallelism > argon.maxParallelism
    ) {
      return false;
    }
    const salt = Buffer.from(parsed.salt, 'base64');
    const expected = Buffer.from(parsed.tag, 'base64');
    const tag = await argon2('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      memory: parsed.memoryKiB,
      passes: parsed.passes,
      parallelism: parsed.parallelism,
      tagLength: expected.length,
    });
    const actual = Buffer.from(tag);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async function verify(password, credential) {
    // Verification never throws for input shape: it fails closed with the same dummy
    // work so callers cannot distinguish a bad password from an invalid verifier.
    if (typeof password !== 'string') return dummy('');
    if (password.length < 1 || password.length > settings.maxLength || Buffer.byteLength(password, 'utf8') > settings.maxBytes) {
      return dummy(password);
    }
    const parsed = inspect(credential);
    const result = await bounded(async () => {
      if (parsed.scheme === 'scrypt') return scryptCheck(password, parsed.hash);
      if (parsed.scheme === 'argon2id') return verifyArgon2id(password, parsed);
      return dummy(password);
    }, () => dummy(password));
    if (result === true) {
      return {
        valid: true,
        scheme: parsed.scheme,
        needsRehash: needsRehash(parsed),
      };
    }
    return {valid: false, scheme: parsed.scheme, needsRehash: false};
  }

  function needsRehash(credential) {
    const parsed = typeof credential === 'string' ? inspect(credential) : credential?.scheme ? credential : inspect(credential);
    if (!parsed || parsed.scheme === 'unknown') return false;
    if (settings.preferredScheme === 'argon2id') {
      if (parsed.scheme !== 'argon2id') return true;
      return parsed.memoryKiB < settings.argon2id.memoryKiB ||
        parsed.passes < settings.argon2id.passes ||
        parsed.parallelism !== settings.argon2id.parallelism;
    }
    return false;
  }

  return {
    policy: settings,
    hash,
    verify,
    inspect,
    needsRehash,
  };
}

export const __internals = Object.freeze({validatePolicy, requirePasswordInput, SCRYPT_HASH, ARGON2ID_HASH});
