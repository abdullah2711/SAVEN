import {verifyPassword as verifyRetainedScrypt} from '../passwords.mjs';
import {createHash, randomUUID} from 'node:crypto';
import {createSessionStore, resolveSessionConfig, AuthError} from './session-store.mjs';
import {createAuthRoutes} from './routes.mjs';

// AUTH-002 composition root (AUTH-002-R1). It is intentionally not imported by any
// active entry point: the SQLite `/api` handler remains the running auth path until
// the owner authorizes a cutover. Callers supply the PostgreSQL pool, so this module
// holds no connection string, credential or environment secret, and it never issues
// DDL.
//
// The pool must be a runtime principal restricted to `saven_auth_service` in
// production (see db/postgres/README.md). It must never be a superuser, a migrator or
// a table owner; AUTH-001 tests assert those boundaries separately.

const EMAIL_NORMALIZE = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');

async function findUser(query, email) {
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
// Argon2id, rehash-on-success and throttling.
async function verifyRetained(password, credential) {
  if (!credential || credential.scheme !== 'scrypt') {
    await verifyRetainedScrypt(password, '');
    return false;
  }
  return verifyRetainedScrypt(password, credential.hash);
}

// Append-only auth audit. When a transaction client is supplied (success
// transitions), the audit row commits with the transition. Failure events are
// written on their own autocommit statement path so a rolled-back attempt is still
// recorded. An audit failure fails the request instead of reporting an unrecorded
// success.
export function createAuditWriter(pool) {
  return async function audit(event, {tx} = {}) {
    const executor = tx ?? pool;
    await executor.query(
      `INSERT INTO auth.auth_audit(
         event_type, outcome, user_id, realm, session_id, request_id,
         ip_address, user_agent, detail_jsonb)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        event.eventType,
        event.outcome ?? 'success',
        event.user?.id ?? null,
        event.realm ?? null,
        event.sessionId ?? null,
        event.request?.headers?.get('x-request-id')?.slice(0, 200) ?? null,
        event.request?.headers?.get('cf-connecting-ip') ?? null,
        event.request?.headers?.get('user-agent')?.slice(0, 1000) ?? null,
        JSON.stringify(event.detail ?? {}),
      ],
    );
  };
}

export function createAuthServer({
  pool,
  clock = () => new Date(),
  origins,
  secureCookies = true,
  config = {},
  verifyCredential = null,
  audit = null,
} = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new Error('createAuthServer requires a PostgreSQL pool with connect() and query().');
  }
  if (!origins || !origins.customer || !origins.operator) {
    throw new Error('createAuthServer requires exact customer and operator origins.');
  }
  const store = createSessionStore({connect: () => pool.connect(), clock, config});
  const handler = createAuthRoutes({
    store,
    findUserByEmail: email => findUser((text, params) => pool.query(text, params), email),
    verifyPassword: verifyCredential ?? verifyRetained,
    audit: audit ?? createAuditWriter(pool),
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

// ---------------------------------------------------------------------------
// Pinned Better Auth session adapter (ADR03 library target).
//
// The library looks sessions up by the raw token and deletes rows on revoke. This
// adapter maps its core `session`/`user` models onto the canonical snake_case schema:
// the raw token is hashed before SQL, revoke becomes a revocation UPDATE, expiry is
// capped by the immutable absolute ceiling and cookie caching is disabled. It is an
// isolated composition path for tests; no active entry point is switched.
// ---------------------------------------------------------------------------

const digest = value => createHash('sha256').update(String(value), 'utf8').digest('hex');
const SESSION_FIELD = {
  id: 'id',
  token: 'token_hash',
  userId: 'user_id',
  expiresAt: 'idle_expires_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  ipAddress: 'ip_address',
  userAgent: 'user_agent',
};
const USER_FIELD = {
  id: 'id',
  email: 'email',
  emailVerified: 'email_verified',
  name: 'name',
  image: 'image',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

function librarySession(row, rawToken) {
  return {
    id: row.id,
    token: rawToken ?? row.token_hash,
    userId: row.user_id,
    expiresAt: row.idle_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

function libraryUser(row) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.name,
    image: row.image,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Builds a bound WHERE clause for the library's cleaned where array. Only the
// operators the session lifecycle uses are accepted; anything else fails closed.
function buildWhere(model, where = [], offset = 0) {
  const map = model === 'user' ? USER_FIELD : SESSION_FIELD;
  const clauses = [];
  const values = [];
  for (const entry of where) {
    const column = map[entry.field];
    if (!column) throw new Error(`Unsupported ${model} field in adapter filter: ${entry.field}`);
    const operator = entry.operator ?? 'eq';
    if (entry.connector && entry.connector !== 'AND') throw new Error('Only AND connectors are supported.');
    const value = entry.field === 'token' ? digest(entry.value) : entry.value;
    if (operator === 'eq') {
      values.push(value);
      clauses.push(`${column} = $${values.length + offset}`);
    } else if (operator === 'ne') {
      values.push(value);
      clauses.push(`${column} <> $${values.length + offset}`);
    } else if (operator === 'in') {
      const list = Array.isArray(value) ? value : [value];
      if (!list.length) {
        clauses.push('FALSE');
        continue;
      }
      values.push(list.map(item => entry.field === 'token' ? digest(item) : item));
      clauses.push(`${column} = ANY($${values.length + offset})`);
    } else if (['gt', 'gte', 'lt', 'lte'].includes(operator)) {
      values.push(value);
      const symbol = {gt: '>', gte: '>=', lt: '<', lte: '<='}[operator];
      clauses.push(`${column} ${symbol} $${values.length + offset}`);
    } else {
      throw new Error(`Unsupported adapter operator: ${operator}`);
    }
  }
  return {sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values};
}

export async function createBetterAuthSessions({
  pool,
  origins,
  secret,
  clock = () => new Date(),
  config = {},
} = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new Error('createBetterAuthSessions requires a PostgreSQL pool with connect() and query().');
  }
  if (!origins || !origins.customer) throw new Error('createBetterAuthSessions requires the customer origin.');
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('createBetterAuthSessions requires a test/deployment secret of at least 32 characters.');
  }
  const settings = resolveSessionConfig(config);
  const now = () => new Date(clock());
  const query = (text, params) => pool.query(text, params);
  const {createAdapterFactory} = await import('better-auth/adapters');
  const {betterAuth} = await import('better-auth');

  const adapterFactory = createAdapterFactory({
    config: {
      adapterId: 'saven-postgres-digest',
      adapterName: 'SAVEN PostgreSQL digest session adapter',
      usePlural: false,
      supportsDates: true,
      supportsJSON: true,
      supportsBooleans: true,
      // Each adapter mutation is a single atomic statement; the session lifecycle
      // does not require a multi-statement library transaction here.
      transaction: false,
      debugLogs: false,
    },
    adapter: () => ({
      async create({model, data}) {
        if (model === 'session') {
          const createdAt = data.createdAt instanceof Date ? data.createdAt : now();
          const requested = data.expiresAt instanceof Date ? data.expiresAt : new Date(createdAt.getTime() + settings.idleMs);
          const absolute = new Date(createdAt.getTime() + settings.absoluteMs);
          const idle = new Date(Math.min(requested.getTime(), absolute.getTime()));
          const credential = await query(
            'SELECT credential_version FROM auth.users WHERE id = $1',
            [data.userId],
          );
          if (credential.rowCount !== 1) throw new AuthError(400, 'SESSION_USER_INVALID', 'Unknown user for library session.');
          const inserted = await query(
            `INSERT INTO auth.sessions(
               user_id, token_hash, realm, assurance_level,
               ip_address, user_agent, credential_version,
               created_at, last_seen_at, idle_expires_at, absolute_expires_at)
             VALUES ($1, $2, 'customer', 'single_factor', $3, $4, $5, $6, $6, $7, $8)
             RETURNING *`,
            [
              data.userId,
              digest(data.token),
              data.ipAddress || null,
              data.userAgent || null,
              Number(credential.rows[0].credential_version),
              createdAt.toISOString(),
              idle.toISOString(),
              absolute.toISOString(),
            ],
          );
          return librarySession(inserted.rows[0], data.token);
        }
        throw new Error(`The SAVEN library adapter does not create ${model} rows.`);
      },

      async findOne({model, where, join}) {
        if (model === 'user') {
          const filter = buildWhere('user', where);
          const result = await query(`SELECT * FROM auth.users ${filter.sql} LIMIT 1`, filter.values);
          return result.rowCount === 1 ? libraryUser(result.rows[0]) : null;
        }
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where);
        const result = await query(
          `SELECT * FROM auth.sessions ${filter.sql ? `${filter.sql} AND` : 'WHERE'} revoked_at IS NULL LIMIT 1`,
          filter.values,
        );
        if (result.rowCount !== 1) return null;
        const row = result.rows[0];
        const at = now().getTime();
        if (row.absolute_expires_at.getTime() <= at || row.idle_expires_at.getTime() <= at) return null;
        const rawToken = where?.find(entry => entry.field === 'token')?.value;
        const session = librarySession(row, typeof rawToken === 'string' ? rawToken : undefined);
        if (join?.user) {
          const user = await query('SELECT * FROM auth.users WHERE id = $1', [row.user_id]);
          if (user.rowCount !== 1) return null;
          return {...session, user: libraryUser(user.rows[0])};
        }
        return session;
      },

      async findMany({model, where, limit = 100, sortBy, offset = 0}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where);
        const order = sortBy ? `ORDER BY ${SESSION_FIELD[sortBy.field] ?? 'created_at'} ${sortBy.direction === 'asc' ? 'ASC' : 'DESC'}` : '';
        const result = await query(
          `SELECT * FROM auth.sessions ${filter.sql ? `${filter.sql} AND` : 'WHERE'} revoked_at IS NULL ${order} LIMIT $${filter.values.length + 1} OFFSET $${filter.values.length + 2}`,
          [...filter.values, Math.min(limit, 100), offset],
        );
        return result.rows.map(row => librarySession(row));
      },

      async update({model, where, update}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where);
        const sets = [];
        const values = [...filter.values];
        if (update.expiresAt instanceof Date) {
          values.push(update.expiresAt.toISOString());
          sets.push(`idle_expires_at = LEAST($${values.length}::timestamptz, absolute_expires_at)`);
        }
        if (update.ipAddress !== undefined) {
          values.push(update.ipAddress);
          sets.push(`ip_address = $${values.length}`);
        }
        if (update.userAgent !== undefined) {
          values.push(update.userAgent);
          sets.push(`user_agent = $${values.length}`);
        }
        if (sets.length === 0) return null;
        values.push(now().toISOString());
        sets.push(`updated_at = $${values.length}`);
        const result = await query(
          `UPDATE auth.sessions SET ${sets.join(', ')} ${filter.sql ? `${filter.sql} AND` : 'WHERE'} revoked_at IS NULL RETURNING *`,
          values,
        );
        if (result.rowCount !== 1) return null;
        const rawToken = where?.find(entry => entry.field === 'token')?.value;
        return librarySession(result.rows[0], typeof rawToken === 'string' ? rawToken : undefined);
      },

      async updateMany({model, where, update}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where, 2);
        if (!(update.expiresAt instanceof Date)) throw new Error('Only expiry updates are supported.');
        const result = await query(
          `UPDATE auth.sessions SET idle_expires_at = LEAST($1::timestamptz, absolute_expires_at), updated_at = $2::timestamptz
           ${filter.sql ? `${filter.sql} AND` : 'WHERE'} revoked_at IS NULL`,
          [update.expiresAt.toISOString(), now().toISOString(), ...filter.values],
        );
        return result.rowCount;
      },

      // The library deletes on revoke; canonical history is preserved as a revocation.
      async delete({model, where}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where, 1);
        await query(
          `UPDATE auth.sessions SET revoked_at = $1::timestamptz, revoked_reason = 'logout'
           ${filter.sql ? `${filter.sql} AND` : 'WHERE'} revoked_at IS NULL`,
          [now().toISOString(), ...filter.values],
        );
      },

      async deleteMany({model, where}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where, 1);
        const result = await query(
          `UPDATE auth.sessions SET revoked_at = $1::timestamptz, revoked_reason = 'sessions_revoked_all'
           ${filter.sql ? `${filter.sql} AND` : 'WHERE'} revoked_at IS NULL`,
          [now().toISOString(), ...filter.values],
        );
        return result.rowCount;
      },

      async count({model, where}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where);
        const result = await query(
          `SELECT count(*)::int AS n FROM auth.sessions ${filter.sql ? `${filter.sql} AND` : 'WHERE'} revoked_at IS NULL`,
          filter.values,
        );
        return result.rows[0].n;
      },
    }),
  });

  const auth = betterAuth({
    baseURL: origins.customer,
    secret,
    database: adapterFactory,
    session: {
      expiresIn: Math.floor(settings.idleMs / 1000),
      updateAge: 60,
      // Cookie-only cached authority is prohibited: every read goes to PostgreSQL.
      cookieCache: {enabled: false},
      storeSessionInDatabase: true,
    },
    advanced: {
      database: {
        validateSchema: false,
        generateId: () => randomUUID(),
      },
    },
  });
  const context = await auth.$context;
  return {auth, context, adapterFactory, config: settings};
}
