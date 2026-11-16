import {argon2 as argon2Callback, randomBytes, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {encodePassword as retainedScryptEncode, verifyPassword as retainedScryptVerify} from '../passwords.mjs';

// AUTH-003-R1 password policy and versioned KDF adapter.
//
// Argon2id is preferred for new verifiers and is available through Node's native
// OpenSSL binding, so no new dependency is introduced. Retained bounded scrypt
// verifiers stay compatible and are upgraded on the next successful sign-in.
//
// Every derivation — hash, Argon2id verification, retained scrypt verification and the
// dummy verification used for absent/unknown/malformed verifiers — passes through the
// same admission counter. Overload is refused before any new native work starts.
// A fixed bounded dummy input is used whenever the supplied input is not a bounded
// string, so an oversized request can never create an oversized KDF buffer.

const argon2 = promisify(argon2Callback);

export const PASSWORD_POLICY_VERSION = 1;

// Hard protocol ceiling. A deployment policy may lower these, never raise them, and the
// verification path re-checks the *stored* verifier against the same absolute caps.
export const ABSOLUTE_KDF_LIMITS = Object.freeze({
  memoryKiB: 262144,
  passes: 10,
  parallelism: 8,
  tagLength: 64,
  saltBytes: 64,
  concurrentKdfs: 4,
});

const DUMMY_INPUT = 'saven-bounded-dummy-verification-input';

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

function requireBound(name, value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function validatePolicy(policy = {}) {
  const merged = {
    ...DEFAULT_PASSWORD_POLICY,
    ...policy,
    argon2id: {...DEFAULT_PASSWORD_POLICY.argon2id, ...(policy.argon2id ?? {})},
  };
  requireBound('Password minimum length', merged.minLength, 8, 512);
  requireBound('Password maximum length', merged.maxLength, merged.minLength, 1024);
  if (!Number.isInteger(merged.maxBytes) || merged.maxBytes < merged.maxLength || merged.maxBytes > 1024) {
    throw new Error('Password byte bound must be an integer between the character bound and 1024.');
  }
  requireBound('Password KDF concurrency', merged.maxConcurrentKdfs, 1, ABSOLUTE_KDF_LIMITS.concurrentKdfs);
  const argon = merged.argon2id;
  requireBound('Argon2id memory', argon.memoryKiB, 8192, ABSOLUTE_KDF_LIMITS.memoryKiB);
  requireBound('Argon2id passes', argon.passes, 1, ABSOLUTE_KDF_LIMITS.passes);
  requireBound('Argon2id parallelism', argon.parallelism, 1, ABSOLUTE_KDF_LIMITS.parallelism);
  requireBound('Argon2id tag length', argon.tagLength, 16, ABSOLUTE_KDF_LIMITS.tagLength);
  requireBound('Argon2id salt length', argon.saltBytes, 16, ABSOLUTE_KDF_LIMITS.saltBytes);
  // Verification caps may tighten but never exceed the absolute protocol ceiling.
  requireBound('Argon2id verification memory cap', argon.maxMemoryKiB ?? ABSOLUTE_KDF_LIMITS.memoryKiB, 8192, ABSOLUTE_KDF_LIMITS.memoryKiB);
  requireBound('Argon2id verification pass cap', argon.maxPasses ?? ABSOLUTE_KDF_LIMITS.passes, 1, ABSOLUTE_KDF_LIMITS.passes);
  requireBound('Argon2id verification parallelism cap', argon.maxParallelism ?? ABSOLUTE_KDF_LIMITS.parallelism, 1, ABSOLUTE_KDF_LIMITS.parallelism);
  if (argon.memoryKiB > (argon.maxMemoryKiB ?? ABSOLUTE_KDF_LIMITS.memoryKiB)) throw new Error('Argon2id memory exceeds its verification cap.');
  if (argon.passes > (argon.maxPasses ?? ABSOLUTE_KDF_LIMITS.passes)) throw new Error('Argon2id passes exceed its verification cap.');
  if (argon.parallelism > (argon.maxParallelism ?? ABSOLUTE_KDF_LIMITS.parallelism)) throw new Error('Argon2id parallelism exceeds its verification cap.');
  if (merged.preferredScheme !== 'argon2id' && merged.preferredScheme !== 'scrypt') throw new Error('Unsupported preferred password scheme.');
  return merged;
}

// Bounded input: anything that is not a string within the configured character/byte
// bounds is replaced by a fixed dummy value. The original bytes never reach a KDF.
function boundedInput(password, settings) {
  if (typeof password !== 'string') return DUMMY_INPUT;
  if (password.length < 1 || password.length > settings.maxLength) return DUMMY_INPUT;
  if (password.includes('\u0000')) return DUMMY_INPUT;
  if (Buffer.byteLength(password, 'utf8') > settings.maxBytes) return DUMMY_INPUT;
  return password;
}

export function createPasswordPolicy({
  policy = {},
  scryptEncode = null,
  scryptVerify = null,
  argon2Impl = null,
  onDerivation = null,
} = {}) {
  const settings = validatePolicy(policy);
  const scryptHash = scryptEncode ?? retainedScryptEncode;
  const scryptCheck = scryptVerify ?? retainedScryptVerify;
  const argon = argon2Impl ?? argon2;
  const argonSpec = settings.argon2id;
  const absolute = ABSOLUTE_KDF_LIMITS;

  let activeKdfs = 0;
  async function derive(kind, work, record = {}) {
    if (activeKdfs >= settings.maxConcurrentKdfs) {
      // Refuse before starting any further native work. Callers translate this to a
      // controlled busy outcome; it never queues unbounded jobs.
      throw new PasswordPolicyError(429, 'PASSWORD_BUSY', 'Sign-in is busy. Try again shortly.');
    }
    activeKdfs += 1;
    try {
      onDerivation?.({kind, ...record});
      return await work();
    } finally {
      activeKdfs -= 1;
    }
  }

  function argonWork(input, salt, overrides) {
    return argon('argon2id', {
      message: Buffer.from(input, 'utf8'),
      nonce: salt,
      memory: overrides.memoryKiB,
      passes: overrides.passes,
      parallelism: overrides.parallelism,
      tagLength: overrides.tagLength,
    });
  }

  async function hash(password) {
    if (typeof password !== 'string') throw new PasswordPolicyError(422, 'PASSWORD_INVALID', 'Use a password of 12 to 128 characters.');
    if (password.length < settings.minLength || password.length > settings.maxLength || Buffer.byteLength(password, 'utf8') > settings.maxBytes) {
      throw new PasswordPolicyError(422, 'PASSWORD_LENGTH', `Use a password of ${settings.minLength} to ${settings.maxLength} characters.`);
    }
    if (password.includes('\u0000')) throw new PasswordPolicyError(422, 'PASSWORD_INVALID', 'Use a password of 12 to 128 characters.');
    if (settings.preferredScheme === 'scrypt') {
      return derive('hash', async () => ({hash: await scryptHash(password), scheme: 'scrypt'}), {scheme: 'scrypt'});
    }
    const salt = randomBytes(argonSpec.saltBytes);
    return derive('hash', async () => {
      const tag = await argonWork(password, salt, argonSpec);
      return {
        hash: `$argon2id$v=19$m=${argonSpec.memoryKiB},t=${argonSpec.passes},p=${argonSpec.parallelism}` +
          `$${salt.toString('base64')}$${Buffer.from(tag).toString('base64')}`,
        scheme: 'argon2id',
      };
    }, {scheme: 'argon2id', memoryKiB: argonSpec.memoryKiB, passes: argonSpec.passes, parallelism: argonSpec.parallelism, inputBytes: Buffer.byteLength(password, 'utf8')});
  }

  // The dummy derivation uses exactly the normal configured workload and a fixed bounded
  // input, so absent, unknown and malformed verifiers do comparable work to a real
  // wrong-password verification.
  async function dummyWork(input) {
    const salt = randomBytes(argonSpec.saltBytes);
    await argonWork(input, salt, argonSpec);
    return false;
  }

  function inspect(credential) {
    const hash = typeof credential === 'string' ? credential : credential?.hash;
    if (typeof hash !== 'string') return {scheme: 'absent'};
    if (SCRYPT_HASH.test(hash)) return {scheme: 'scrypt', hash};
    const match = ARGON2ID_HASH.exec(hash);
    if (match) {
      const salt = Buffer.from(match[4], 'base64');
      const tag = Buffer.from(match[5], 'base64');
      return {
        scheme: 'argon2id',
        hash,
        memoryKiB: Number(match[1]),
        passes: Number(match[2]),
        parallelism: Number(match[3]),
        salt,
        tag,
      };
    }
    return {scheme: 'unknown'};
  }

  function argonVerifierUsable(parsed) {
    if (!Number.isInteger(parsed.memoryKiB) || parsed.memoryKiB < 8192 || parsed.memoryKiB > (argonSpec.maxMemoryKiB ?? absolute.memoryKiB)) return false;
    if (!Number.isInteger(parsed.passes) || parsed.passes < 1 || parsed.passes > (argonSpec.maxPasses ?? absolute.passes)) return false;
    if (!Number.isInteger(parsed.parallelism) || parsed.parallelism < 1 || parsed.parallelism > (argonSpec.maxParallelism ?? absolute.parallelism)) return false;
    if (!(parsed.salt instanceof Buffer) || parsed.salt.length < 16 || parsed.salt.length > absolute.saltBytes) return false;
    if (!(parsed.tag instanceof Buffer) || parsed.tag.length < 16 || parsed.tag.length > absolute.tagLength) return false;
    return true;
  }

  async function verifyArgon2id(input, parsed) {
    const tag = await argonWork(input, parsed.salt, {
      memoryKiB: parsed.memoryKiB,
      passes: parsed.passes,
      parallelism: parsed.parallelism,
      tagLength: parsed.tag.length,
    });
    const actual = Buffer.from(tag);
    return actual.length === parsed.tag.length && timingSafeEqual(actual, parsed.tag);
  }

  // Verification never throws for input shape, provider failure or hostile verifier
  // parameters: every such path is normalized to a bounded failure after comparable
  // work. The only exception is the controlled PASSWORD_BUSY refusal from admission.
  async function verify(password, credential) {
    const input = boundedInput(password, settings);
    const parsed = inspect(credential);
    return derive('verify', async () => {
      if (parsed.scheme === 'scrypt') {
        let valid = false;
        try {
          valid = await scryptCheck(input, parsed.hash);
        } catch {
          valid = false;
        }
        return {valid: valid === true, scheme: 'scrypt', needsRehash: valid === true, busy: false};
      }
      if (parsed.scheme === 'argon2id' && argonVerifierUsable(parsed)) {
        let valid = false;
        try {
          valid = await verifyArgon2id(input, parsed);
        } catch {
          valid = false;
        }
        return {valid, scheme: 'argon2id', needsRehash: valid && needsRehash(parsed), busy: false};
      }
      // Absent, unknown, malformed or hostile verifier: comparable normal-work dummy.
      try {
        await dummyWork(input);
      } catch {
        return {valid: false, scheme: 'unknown', needsRehash: false, busy: false};
      }
      return {valid: false, scheme: 'unknown', needsRehash: false, busy: false};
    }, {scheme: parsed.scheme, memoryKiB: argonSpec.memoryKiB, passes: argonSpec.passes, parallelism: argonSpec.parallelism, inputBytes: Buffer.byteLength(input, 'utf8')});
  }

  function needsRehash(credential) {
    const parsed = typeof credential === 'string' ? inspect(credential) : (credential?.scheme ? credential : inspect(credential));
    if (!parsed || parsed.scheme === 'unknown' || parsed.scheme === 'absent') return false;
    if (settings.preferredScheme === 'argon2id') {
      if (parsed.scheme !== 'argon2id') return true;
      return parsed.memoryKiB < argonSpec.memoryKiB ||
        parsed.passes < argonSpec.passes ||
        parsed.parallelism !== argonSpec.parallelism;
    }
    return false;
  }

  return {
    policy: settings,
    hash,
    verify,
    inspect,
    needsRehash,
    activeDerivations: () => activeKdfs,
  };
}

export const __internals = Object.freeze({boundedInput, validatePolicy, SCRYPT_HASH, ARGON2ID_HASH, DUMMY_INPUT});
