import {verifyPassword as verifyRetainedScrypt} from '../passwords.mjs';
import {createSessionStore} from './session-store.mjs';
import {createAuthRoutes} from './routes.mjs';

// AUTH-002 composition root. It is intentionally not imported by any active entry
// point: the SQLite `/api` handler remains the running auth path until the owner
// authorizes a cutover. Callers supply the PostgreSQL pool, so this module holds no
// connection string, credential or environment secret, and it never issues DDL.
//
// The pool must be a runtime principal restricted to `saven_auth_service` in
// production (see db/postgres/README.md). It must never be a superuser, a migrator
// or a table owner; AUTH-001 tests assert those boundaries separately.

const EMAIL_NORMALIZE = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export function createAuthServer({
  pool,
  clock = () => new Date(),
  origins,
  secureCookies = true,
  config = {},
  verifyCredential = null,
  audit = null,
} = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createAuthServer requires a PostgreSQL pool (parameterized query).');
  }
  if (!origins || !origins.customer || !origins.operator) {
    throw new Error('createAuthServer requires exact customer and operator origins.');
  }
  const query = (text, params = []) => pool.query(text, params);
  const store = createSessionStore({query, clock, config});

  async function findUserByEmail(email) {
    const result = await query(
      `SELECT id, email, email_verified, password_hash, password_scheme, status, credential_version
       FROM auth.users
       WHERE lower(email) = $1`,
      [EMAIL_NORMALIZE(email)],
    );
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified === true,
      passwordHash: row.password_hash,
      passwordScheme: row.password_scheme,
      status: row.status,
      credentialVersion: Number(row.credential_version),
    };
  }

  // Retained bounded scrypt verification is the compatibility path required by ADR03.
  // Unknown schemes fail closed after the same bounded dummy derivation; AUTH-003 owns
  // Argon2id, rehash-on-success and the versioned password policy.
  async function defaultVerify(password, credential) {
    if (!credential || credential.scheme !== 'scrypt') {
      await verifyRetainedScrypt(password, '');
      return false;
    }
    return verifyRetainedScrypt(password, credential.hash);
  }

  // Append-only auth audit. A failed insert fails the request: an unrecorded
  // authentication event must not be reported as success. Failure events are written
  // on their own statement path, outside any business transaction.
  async function defaultAudit({eventType, outcome, realm, user, request, sessionId, detail}) {
    await query(
      `INSERT INTO auth.auth_audit(
         event_type, outcome, user_id, realm, session_id, request_id,
         ip_address, user_agent, detail_jsonb)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        eventType,
        outcome ?? 'success',
        user?.id ?? null,
        realm ?? null,
        sessionId ?? null,
        request?.headers?.get('x-request-id')?.slice(0, 200) ?? null,
        request?.headers?.get('cf-connecting-ip') ?? null,
        request?.headers?.get('user-agent')?.slice(0, 1000) ?? null,
        JSON.stringify(detail ?? {}),
      ],
    );
  }

  const handler = createAuthRoutes({
    store,
    findUserByEmail,
    verifyPassword: verifyCredential ?? defaultVerify,
    audit: audit ?? defaultAudit,
    origins,
    secureCookies,
    clock,
  });

  return {
    store,
    handler,
    config: store.config,
  };
}
