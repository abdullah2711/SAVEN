import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const {Client} = pg;
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

// The AUTH-001 fixture is the auth-schema sibling of the PIVOT-002 fixture. It
// creates only saven_auth_<suffix>* cluster roles and a saven_auth_<suffix>
// disposable database, and it refuses to run without an explicit
// dedicated-disposable-cluster opt-in.
export const authTargetRoleKeys = Object.freeze([
  'customerApp',
  'authService',
  'operatorRead',
  'operatorAdmin',
  'migrator',
  'operatorDefiner',
  'authDefiner',
]);

export const authRuntimeRoleKeys = Object.freeze([
  'customerApp',
  'authService',
  'operatorRead',
  'operatorAdmin',
]);

export const authSwitchableRoleKeys = Object.freeze([...authRuntimeRoleKeys, 'migrator']);

const roleSuffixes = Object.freeze({
  customerApp: 'customer_app',
  authService: 'auth_service',
  operatorRead: 'operator_read',
  operatorAdmin: 'operator_admin',
  migrator: 'migrator',
  operatorDefiner: 'operator_definer',
  authDefiner: 'auth_definer',
});

const loginSuffixes = Object.freeze({
  customerApp: 'customer_app_login',
  authService: 'auth_service_login',
  operatorRead: 'operator_read_login',
  operatorAdmin: 'operator_admin_login',
});

const defaultSqlFiles = Object.freeze([
  'db/postgres/10-operator-schema.sql',
  'db/postgres/05-auth-schema.sql',
  'db/postgres/migrations/006-auth-schema-corrections.sql',
]);

function requireTestCluster() {
  // SAVEN_PIVOT_TEST_CLUSTER is the established dedicated-disposable-cluster
  // opt-in supplied by the unchanged Verify SAVEN workflow, so the AUTH-001
  // suite runs there without a workflow edit. SAVEN_AUTH_TEST_CLUSTER is the
  // explicit auth-suite name for local disposable clusters.
  if (process.env.SAVEN_AUTH_TEST_CLUSTER !== '1' && process.env.SAVEN_PIVOT_TEST_CLUSTER !== '1') {
    throw new Error(
      'AUTH-001 fixture refuses to run: set SAVEN_AUTH_TEST_CLUSTER=1 (or the established SAVEN_PIVOT_TEST_CLUSTER=1) for a dedicated disposable PostgreSQL cluster.',
    );
  }
}

function quoteIdent(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) {
    throw new Error('AUTH-001 fixture refused an invalid identifier.');
  }
  return `"${value}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function connectionConfig(database, overrides = {}) {
  const host = process.env.PGHOST ?? '127.0.0.1';
  const port = Number(process.env.PGPORT ?? 5432);
  const user = process.env.PGUSER ?? 'postgres';
  const password = process.env.PGPASSWORD ?? '';
  if (!loopbackHosts.has(host) && !host.startsWith('/')) {
    throw new Error('AUTH-001 fixture requires a loopback PGHOST (127.0.0.1, localhost, ::1 or a local socket path).');
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('AUTH-001 fixture requires a valid loopback PGPORT.');
  }
  if (/^saven_/i.test(user)) {
    throw new Error('AUTH-001 fixture requires a separate administrative PGUSER, not a SAVEN target role.');
  }
  const sslMode = process.env.PGSSLMODE;
  if (sslMode && sslMode !== 'disable' && sslMode !== 'require') {
    throw new Error('AUTH-001 fixture supports only PGSSLMODE=disable or require.');
  }
  return {
    host,
    port,
    user,
    password,
    database: database ?? process.env.PGADMIN_DATABASE ?? 'postgres',
    application_name: 'saven-auth-001',
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    ssl: sslMode === 'require' ? {rejectUnauthorized: true} : false,
    ...overrides,
  };
}

async function connect(config) {
  const client = new Client(config);
  await client.connect();
  return client;
}

export async function connectAuthClusterAdmin() {
  requireTestCluster();
  return connect(connectionConfig());
}

export async function connectAuthDatabaseAdmin(database) {
  requireTestCluster();
  return connect(connectionConfig(database));
}

export function authRoleNamesForSuffix(suffix) {
  if (typeof suffix !== 'string' || !/^[a-z0-9]{8,32}$/.test(suffix)) {
    throw new Error('AUTH-001 fixture requires an [a-z0-9]{8,32} namespace suffix.');
  }
  const prefix = 'saven_auth_' + suffix;
  const names = {database: prefix, migration: prefix + '_migration', logins: {}};
  for (const [key, roleSuffix] of Object.entries(roleSuffixes)) {
    names[key] = prefix + '_' + roleSuffix;
  }
  for (const [key, loginSuffix] of Object.entries(loginSuffixes)) {
    names.logins[key] = prefix + '_' + loginSuffix;
  }
  return names;
}

export function generatedAuthRoleNames(names) {
  return [
    ...authTargetRoleKeys.map(key => names[key]),
    names.migration,
    ...Object.values(names.logins),
  ];
}

export function combineAuthRunAndCleanupErrors(runError, cleanupErrors) {
  const errors = (cleanupErrors ?? []).filter(Boolean);
  if (!errors.length) return runError ?? null;
  const cleanupError = new Error(
    'AUTH-001 fixture cleanup failed: ' + errors.map(error => error.message).join('; '),
  );
  if (!runError) return cleanupError;
  return new AggregateError([runError, cleanupError], 'AUTH-001 fixture run and cleanup both failed');
}

function rewriteRoleNames(sql, names) {
  let rewritten = sql;
  for (const key of authTargetRoleKeys) {
    const fixed = 'saven_' + roleSuffixes[key];
    rewritten = rewritten.replaceAll(fixed, names[key]);
  }
  return rewritten;
}

export async function authRoleBootstrapSql(names) {
  return rewriteRoleNames(await readFile(join(repoRoot, 'db/postgres/00-roles.sql'), 'utf8'), names);
}

export async function authSchemaSql(names) {
  return rewriteRoleNames(await readFile(join(repoRoot, 'db/postgres/05-auth-schema.sql'), 'utf8'), names);
}

export async function withAuthDatabase(options, run) {
  if (typeof options === 'function') {
    run = options;
    options = {};
  }
  if (typeof run !== 'function') throw new Error('withAuthDatabase requires a callback.');
  requireTestCluster();

  const suffix = options?.namespaceSuffix ?? randomUUID().replaceAll('-', '').slice(0, 12);
  const names = authRoleNamesForSuffix(suffix);
  const sqlFiles = options?.sqlFiles ?? defaultSqlFiles;
  const allRoleNames = generatedAuthRoleNames(names);
  const clusterConfig = connectionConfig();
  const adminUser = clusterConfig.user;
  const migrationPassword = randomBytes(32).toString('base64url');
  const loginPasswords = Object.fromEntries(
    authRuntimeRoleKeys.map(key => [key, randomBytes(32).toString('base64url')]),
  );
  const createdRoles = [];
  const cleanupErrors = [];
  let createdDatabase = false;
  let lockHeld = false;
  let runError = null;
  let result = null;

  let clusterAdmin = null;
  let databaseAdmin = null;
  let migrationClient = null;

  try {
    clusterAdmin = await connect(clusterConfig);
    await clusterAdmin.query('SELECT pg_advisory_lock(hashtext($1))', ['saven_auth:' + suffix]);
    lockHeld = true;

    // Pre-flight: refuse before any mutation if any object this fixture would
    // touch already exists. Existing roles, memberships and grants are untouched.
    const existingRoles = (
      await clusterAdmin.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname', [allRoleNames])
    ).rows.map(row => row.rolname);
    const existingDatabase = (
      await clusterAdmin.query('SELECT datname FROM pg_database WHERE datname = $1', [names.database])
    ).rows.map(row => row.datname);
    if (existingRoles.length || existingDatabase.length) {
      const objects = [...existingRoles, ...existingDatabase].join(', ');
      throw new Error(
        `AUTH-001 fixture pre-flight refused: objects already exist (${objects}); refusing to alter or reuse pre-existing cluster objects.`,
      );
    }

    await clusterAdmin.query(`CREATE DATABASE ${quoteIdent(names.database)}`);
    createdDatabase = true;
    databaseAdmin = await connect(connectionConfig(names.database));

    // Exercise the checked-in bootstrap, rewritten only into the disposable
    // namespace. It validates every target before creating any missing role.
    const bootstrapSql = await authRoleBootstrapSql(names);
    await databaseAdmin.query(bootstrapSql);
    for (const key of authTargetRoleKeys) createdRoles.push(names[key]);

    for (const key of authRuntimeRoleKeys) {
      const login = names.logins[key];
      await databaseAdmin.query(
        `CREATE ROLE ${quoteIdent(login)} LOGIN PASSWORD ${quoteLiteral(loginPasswords[key])} ` +
        'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION',
      );
      createdRoles.push(login);
      await databaseAdmin.query(`GRANT ${quoteIdent(names[key])} TO ${quoteIdent(login)}`);
    }

    await databaseAdmin.query(
      `CREATE ROLE ${quoteIdent(names.migration)} LOGIN PASSWORD ${quoteLiteral(migrationPassword)} ` +
      'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION',
    );
    createdRoles.push(names.migration);
    await databaseAdmin.query(`GRANT ${quoteIdent(names.migrator)} TO ${quoteIdent(names.migration)}`);
    await databaseAdmin.query(`GRANT CREATE ON DATABASE ${quoteIdent(names.database)} TO ${quoteIdent(names.migration)}`);

    migrationClient = await connect(
      connectionConfig(names.database, {user: names.migration, password: migrationPassword}),
    );
    for (const file of sqlFiles) {
      await migrationClient.query(rewriteRoleNames(await readFile(join(repoRoot, file), 'utf8'), names));
    }
    // The fixture's private admin needs schema USAGE to resolve operator.*/auth.*
    // names in has_table_privilege checks. This is database-local and temporary.
    await migrationClient.query(`SET ROLE ${quoteIdent(names.migrator)}`);
    await migrationClient.query(`GRANT USAGE ON SCHEMA operator TO ${quoteIdent(adminUser)}`);
    await migrationClient.query(`GRANT USAGE ON SCHEMA auth TO ${quoteIdent(adminUser)}`);
    await migrationClient.query('RESET ROLE');
    await migrationClient.end();
    migrationClient = null;

    const loginConfigs = Object.fromEntries(authRuntimeRoleKeys.map(key => [
      key,
      connectionConfig(names.database, {user: names.logins[key], password: loginPasswords[key]}),
    ]));
    loginConfigs.migrator = connectionConfig(names.database, {user: names.migration, password: migrationPassword});

    async function asRole(roleKey, action, {commit = false} = {}) {
      if (!authSwitchableRoleKeys.includes(roleKey)) {
        throw new Error('AUTH-001 fixture refused an unknown switchable role.');
      }
      const client = await connect(loginConfigs[roleKey]);
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${quoteIdent(names[roleKey])}`);
        const value = await action(client);
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        await client.end().catch(() => {});
      }
    }

    async function asLogin(roleKey, action) {
      if (!authSwitchableRoleKeys.includes(roleKey)) {
        throw new Error('AUTH-001 fixture refused an unknown login principal.');
      }
      const client = await connect(loginConfigs[roleKey]);
      try {
        return await action(client);
      } finally {
        await client.end().catch(() => {});
      }
    }

    result = await run({
      suffix,
      database: names.database,
      roles: names,
      targetRoles: authTargetRoleKeys.map(key => names[key]),
      runtimeRoles: authRuntimeRoleKeys.map(key => names[key]),
      runtimeLogins: authRuntimeRoleKeys.map(key => names.logins[key]),
      migrationLogin: names.migration,
      admin: databaseAdmin,
      adminQuery: (sql, params = []) => databaseAdmin.query(sql, params),
      applyRoleBootstrap: () => databaseAdmin.query(bootstrapSql),
      schemaSql: () => authSchemaSql(names),
      asRole,
      asLogin,
    });
  } catch (error) {
    runError = error;
  } finally {
    if (migrationClient) {
      await migrationClient.end().catch(error => cleanupErrors.push(error));
    }
    if (databaseAdmin) {
      await databaseAdmin.end().catch(error => cleanupErrors.push(error));
    }
    if (clusterAdmin) {
      if (createdDatabase) {
        try {
          await clusterAdmin.query(`DROP DATABASE IF EXISTS ${quoteIdent(names.database)} WITH (FORCE)`);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      for (const role of [...createdRoles].reverse()) {
        try {
          await clusterAdmin.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (lockHeld) {
        try {
          await clusterAdmin.query('SELECT pg_advisory_unlock(hashtext($1))', ['saven_auth:' + suffix]);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      await clusterAdmin.end().catch(error => cleanupErrors.push(error));
    }
  }

  const combined = combineAuthRunAndCleanupErrors(runError, cleanupErrors);
  if (combined) throw combined;
  return result;
}
