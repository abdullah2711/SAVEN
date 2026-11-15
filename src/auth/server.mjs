import {verifyPassword as verifyRetainedScrypt} from '../passwords.mjs';
import {createHash, randomUUID} from 'node:crypto';
import {
  createSessionStore,
  resolveSessionConfig,
  sessionAuthorityHolds,
  capIdleExpiry,
  AuthError,
} from './session-store.mjs';
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
const isDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

const SESSION_FIELD = {
  id: 's.id',
  token: 's.token_hash',
  userId: 's.user_id',
  expiresAt: 's.idle_expires_at',
  createdAt: 's.created_at',
  updatedAt: 's.updated_at',
  ipAddress: 's.ip_address',
  userAgent: 's.user_agent',
};
const USER_FIELD = {
  id: 'u.id',
  email: 'u.email',
  emailVerified: 'u.email_verified',
  name: 'u.name',
  image: 'u.image',
  createdAt: 'u.created_at',
  updatedAt: 'u.updated_at',
};

function requireRawToken(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 200) {
    throw new Error('The library adapter refused an invalid session token value.');
  }
  return value;
}

// Token values are hashed exactly once, per element, and only after the operator is
// known. An unsupported filter shape or an empty list fails closed instead of
// broadening to an empty WHERE clause and silently affecting every row.
function buildWhere(model, where = [], offset = 0, {requireFilter = true} = {}) {
  if (!Array.isArray(where)) throw new Error('Adapter filters must be an array.');
  if (requireFilter && where.length === 0) throw new Error('The library adapter requires an explicit filter.');
  const map = model === 'user' ? USER_FIELD : SESSION_FIELD;
  const clauses = [];
  const values = [];
  for (const entry of where) {
    const column = map[entry.field];
    if (!column) throw new Error(`Unsupported ${model} field in adapter filter: ${entry.field}`);
    if (entry.connector && entry.connector !== 'AND') throw new Error('Only AND connectors are supported.');
    const operator = entry.operator ?? 'eq';
    const isToken = entry.field === 'token';
    if (isToken && !['eq', 'in'].includes(operator)) {
      throw new Error(`Unsupported token filter operator: ${operator}`);
    }
    if (operator === 'eq') {
      values.push(isToken ? digest(requireRawToken(entry.value)) : entry.value);
      clauses.push(`${column} = $${values.length + offset}`);
    } else if (operator === 'ne') {
      values.push(isToken ? digest(requireRawToken(entry.value)) : entry.value);
      clauses.push(`${column} <> $${values.length + offset}`);
    } else if (operator === 'in') {
      const list = Array.isArray(entry.value) ? entry.value : [entry.value];
      if (list.length === 0) throw new Error('The library adapter refused an empty IN filter.');
      values.push(list.map(item => (isToken ? digest(requireRawToken(item)) : item)));
      clauses.push(`${column} = ANY($${values.length + offset})`);
    } else if (['gt', 'gte', 'lt', 'lte'].includes(operator)) {
      if (isToken) throw new Error(`Unsupported token filter operator: ${operator}`);
      values.push(entry.value);
      const symbol = {gt: '>', gte: '>=', lt: '<', lte: '<='}[operator];
      clauses.push(`${column} ${symbol} $${values.length + offset}`);
    } else {
      throw new Error(`Unsupported adapter operator: ${operator}`);
    }
  }
  return {sql: clauses.join(' AND '), values};
}

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
    status: row.status,
    credentialVersion: Number(row.credential_version),
  };
}

export async function createBetterAuthSessions({
  pool,
  origins,
  secret,
  clock = () => new Date(),
  config = {},
  realm = 'customer',
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
  const nowIso = () => now().toISOString();
  const query = (text, params) => pool.query(text, params);
  const {createAdapterFactory} = await import('better-auth/adapters');
  const {betterAuth} = await import('better-auth');

  // Guarded session selection shared by every library read/update path. The library
  // must not become a weaker authority: identity status, credential epoch, realm,
  // revocation, idle expiry and the absolute ceiling are all enforced here.
  function sessionSelect(where, offset, {limit} = {}) {
    const filter = buildWhere('session', where, offset);
    const params = [...filter.values, nowIso(), realm];
    const at = params.length - 1;
    const realmIndex = params.length;
    let sql = `SELECT s.*, u.status AS user_status,
                      u.credential_version AS current_credential_version
               FROM auth.sessions s
               JOIN auth.users u ON u.id = s.user_id
               WHERE ${filter.sql}
                 AND s.revoked_at IS NULL
                 AND s.realm = $${realmIndex}
                 AND s.absolute_expires_at > $${at}::timestamptz
                 AND s.idle_expires_at > $${at}::timestamptz
                 AND u.status = 'active'
                 AND u.credential_version = s.credential_version`;
    if (limit !== undefined) {
      params.push(limit);
      sql += ` ORDER BY s.created_at DESC LIMIT $${params.length}`;
    }
    return {sql, params};
  }

  const adapterFactory = createAdapterFactory({
    config: {
      adapterId: 'saven-postgres-digest',
      adapterName: 'SAVEN PostgreSQL digest session adapter',
      usePlural: false,
      supportsDates: true,
      supportsJSON: true,
      supportsBooleans: true,
      transaction: false,
      debugLogs: false,
    },
    adapter: () => ({
      async create({model, data}) {
        if (model !== 'session') throw new Error(`The SAVEN library adapter does not create ${model} rows.`);
        // The injected application clock is authoritative; a library-supplied
        // timestamp cannot reorder the row relative to the trusted now.
        const createdAt = now();
        const absolute = new Date(createdAt.getTime() + settings.absoluteMs);
        const requested = data.expiresAt instanceof Date
          ? data.expiresAt
          : new Date(createdAt.getTime() + settings.idleMs);
        const idle = capIdleExpiry({at: createdAt, requested, absolute, idleMs: settings.idleMs});
        const user = await query(
          'SELECT status, credential_version FROM auth.users WHERE id = $1',
          [data.userId],
        );
        if (user.rowCount !== 1 || user.rows[0].status !== 'active') {
          throw new AuthError(400, 'SESSION_USER_INVALID', 'The library adapter refused an inactive or unknown user.');
        }
        const inserted = await query(
          `INSERT INTO auth.sessions(
             user_id, token_hash, realm, assurance_level,
             ip_address, user_agent, credential_version,
             created_at, last_seen_at, idle_expires_at, absolute_expires_at)
           VALUES ($1, $2, $3, 'single_factor', $4, $5, $6, $7, $7, $8, $9)
           RETURNING *`,
          [
            data.userId,
            digest(requireRawToken(data.token)),
            realm,
            data.ipAddress || null,
            data.userAgent || null,
            Number(user.rows[0].credential_version),
            createdAt.toISOString(),
            idle.toISOString(),
            absolute.toISOString(),
          ],
        );
        return librarySession(inserted.rows[0], data.token);
      },

      async findOne({model, where, join}) {
        if (model === 'user') {
          const filter = buildWhere('user', where);
          const result = await query(`SELECT * FROM auth.users u WHERE ${filter.sql} LIMIT 1`, filter.values);
          return result.rowCount === 1 ? libraryUser(result.rows[0]) : null;
        }
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const {sql, params} = sessionSelect(where, 0, {limit: 1});
        const result = await query(sql, params);
        if (result.rowCount !== 1) return null;
        const row = result.rows[0];
        if (!sessionAuthorityHolds(row, now())) return null;
        const rawToken = where?.find(entry => entry.field === 'token')?.value;
        const session = librarySession(row, typeof rawToken === 'string' ? rawToken : undefined);
        if (join?.user) {
          const user = await query('SELECT * FROM auth.users WHERE id = $1', [row.user_id]);
          if (user.rowCount !== 1) return null;
          return {...session, user: libraryUser(user.rows[0])};
        }
        return session;
      },

      async findMany({model, where = [], limit = 100, sortBy, offset = 0, join}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where, 0, {requireFilter: false});
        const params = [...filter.values, nowIso(), realm];
        const at = params.length - 1;
        const realmIndex = params.length;
        const order = sortBy
          ? `ORDER BY ${SESSION_FIELD[sortBy.field] ?? 's.created_at'} ${sortBy.direction === 'asc' ? 'ASC' : 'DESC'}`
          : 'ORDER BY s.created_at DESC';
        params.push(Math.min(limit, 100), offset);
        const result = await query(
          `SELECT s.*, u.status AS user_status, u.credential_version AS current_credential_version
           FROM auth.sessions s
           JOIN auth.users u ON u.id = s.user_id
           ${filter.sql ? `WHERE ${filter.sql} AND` : 'WHERE'}
             s.revoked_at IS NULL
             AND s.realm = $${realmIndex}
             AND s.absolute_expires_at > $${at}::timestamptz
             AND s.idle_expires_at > $${at}::timestamptz
             AND u.status = 'active'
             AND u.credential_version = s.credential_version
           ${order}
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        const live = result.rows.filter(row => sessionAuthorityHolds(row, now()));
        if (!live.length) return [];
        // Bulk token filters know the raw tokens; map each digest back so the library
        // can key its result set by the token it asked for. Hashes are never reversed.
        const rawByDigest = new Map();
        for (const entry of where) {
          if (entry.field !== 'token') continue;
          for (const value of Array.isArray(entry.value) ? entry.value : [entry.value]) {
            if (typeof value === 'string') rawByDigest.set(digest(value), value);
          }
        }
        let users = new Map();
        if (join?.user) {
          const ids = [...new Set(live.map(row => row.user_id))];
          const userRows = await query('SELECT * FROM auth.users WHERE id = ANY($1::uuid[])', [ids]);
          users = new Map(userRows.rows.map(row => [row.id, libraryUser(row)]));
        }
        return live.map(row => {
          const session = librarySession(row, rawByDigest.get(row.token_hash));
          return join?.user ? {...session, user: users.get(row.user_id)} : session;
        });
      },

      async update({model, where, update}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where, 3);
        const at = now();
        const requested = update.expiresAt instanceof Date ? update.expiresAt : at;
        const params = [at.toISOString(), requested.toISOString(), settings.idleMs / 1000, ...filter.values, realm];
        const realmIndex = params.length;
        const result = await query(
          `UPDATE auth.sessions s
           SET last_seen_at = GREATEST($1::timestamptz, s.created_at),
               idle_expires_at = LEAST(
                 GREATEST($1::timestamptz, s.created_at) + make_interval(secs => $3::double precision),
                 $2::timestamptz,
                 s.absolute_expires_at),
               updated_at = $1::timestamptz
           FROM auth.users u
           WHERE u.id = s.user_id
             AND ${filter.sql}
             AND s.revoked_at IS NULL
             AND s.realm = $${realmIndex}
             AND s.absolute_expires_at > $1::timestamptz
             AND s.idle_expires_at > $1::timestamptz
             AND u.status = 'active'
             AND u.credential_version = s.credential_version
           RETURNING s.*`,
          params,
        );
        if (result.rowCount !== 1) return null;
        const rawToken = where?.find(entry => entry.field === 'token')?.value;
        return librarySession(result.rows[0], typeof rawToken === 'string' ? rawToken : undefined);
      },

      async updateMany({model, where, update}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        if (!(update.expiresAt instanceof Date)) throw new Error('Only expiry updates are supported.');
        const filter = buildWhere('session', where, 3);
        const at = now();
        const params = [
          at.toISOString(),
          update.expiresAt.toISOString(),
          settings.idleMs / 1000,
          ...filter.values,
          realm,
        ];
        const realmIndex = params.length;
        const result = await query(
          `UPDATE auth.sessions s
           SET last_seen_at = GREATEST($1::timestamptz, s.created_at),
               idle_expires_at = LEAST(
                 GREATEST($1::timestamptz, s.created_at) + make_interval(secs => $3::double precision),
                 $2::timestamptz,
                 s.absolute_expires_at),
               updated_at = $1::timestamptz
           FROM auth.users u
           WHERE u.id = s.user_id
             AND ${filter.sql}
             AND s.revoked_at IS NULL
             AND s.realm = $${realmIndex}
             AND s.absolute_expires_at > $1::timestamptz
             AND s.idle_expires_at > $1::timestamptz
             AND u.status = 'active'
             AND u.credential_version = s.credential_version`,
          params,
        );
        return result.rowCount;
      },

      // The library deletes on revoke; canonical history is preserved as a revocation.
      async delete({model, where}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where, 2);
        const result = await query(
          `UPDATE auth.sessions s
           SET revoked_at = $1::timestamptz, revoked_reason = 'logout'
           WHERE ${filter.sql} AND s.revoked_at IS NULL AND s.realm = $2`,
          [nowIso(), realm, ...filter.values],
        );
        if (result.rowCount === 0) {
          throw new Error('The library adapter matched no session to revoke.');
        }
        return undefined;
      },

      async deleteMany({model, where}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where, 2);
        const result = await query(
          `UPDATE auth.sessions s
           SET revoked_at = $1::timestamptz, revoked_reason = 'sessions_revoked_all'
           WHERE ${filter.sql} AND s.revoked_at IS NULL AND s.realm = $2`,
          [nowIso(), realm, ...filter.values],
        );
        return result.rowCount;
      },

      async count({model, where = []}) {
        if (model !== 'session') throw new Error(`Unsupported adapter model: ${model}`);
        const filter = buildWhere('session', where, 0, {requireFilter: false});
        const params = [...filter.values, nowIso(), realm];
        const at = params.length - 1;
        const realmIndex = params.length;
        const result = await query(
          `SELECT count(*)::int AS n
           FROM auth.sessions s
           JOIN auth.users u ON u.id = s.user_id
           ${filter.sql ? `WHERE ${filter.sql} AND` : 'WHERE'}
             s.revoked_at IS NULL
             AND s.realm = $${realmIndex}
             AND s.absolute_expires_at > $${at}::timestamptz
             AND s.idle_expires_at > $${at}::timestamptz
             AND u.status = 'active'
             AND u.credential_version = s.credential_version`,
          params,
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
