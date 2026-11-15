import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const {Client} = pg;
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

export const targetRoleKeys = Object.freeze([
  'customerApp',
  'authService',
  'operatorRead',
  'operatorAdmin',
  'migrator',
  'operatorDefiner',
  'authDefiner',
]);

export const switchableRoleKeys = Object.freeze([
  'customerApp',
  'operatorRead',
  'operatorAdmin',
  'migrator',
]);

const roleSuffixes = Object.freeze({
  customerApp: 'customer_app',
  authService: 'auth_service',
  operatorRead: 'operator_read',
  operatorAdmin: 'operator_admin',
  migrator: 'migrator',
  operatorDefiner: 'operator_definer',
  authDefiner: 'auth_definer',
});

const defaultSqlFiles = Object.freeze(['db/postgres/10-operator-schema.sql']);

function requireTestCluster() {
  if (process.env.SAVEN_PIVOT_TEST_CLUSTER !== '1') {
    throw new Error(
      'PIVOT-002 fixture refuses to run: set SAVEN_PIVOT_TEST_CLUSTER=1 for a dedicated disposable PostgreSQL cluster.',
    );
  }
}

function quoteIdent(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) {
    throw new Error('PIVOT-002 fixture refused an invalid identifier.');
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
    throw new Error('PIVOT-002 fixture requires a loopback PGHOST (127.0.0.1, localhost, ::1 or a local socket path).');
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PIVOT-002 fixture requires a valid loopback PGPORT.');
  }
  if (/^saven_/i.test(user)) {
    throw new Error('PIVOT-002 fixture requires a separate administrative PGUSER, not a SAVEN target role.');
  }
  const sslMode = process.env.PGSSLMODE;
  if (sslMode && sslMode !== 'disable' && sslMode !== 'require') {
    throw new Error('PIVOT-002 fixture supports only PGSSLMODE=disable or require.');
  }
  return {
    host,
    port,
    user,
    password,
    database: database ?? process.env.PGADMIN_DATABASE ?? 'postgres',
    application_name: 'saven-pivot-002',
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    // Never disable certificate verification. A dedicated local test cluster
    // should run with TLS disabled unless a trusted CA is configured.
    ssl: sslMode === 'require' ? {rejectUnauthorized: true} : false,
    ...overrides,
  };
}

async function connect(config) {
  const client = new Client(config);
  await client.connect();
  return client;
}

export async function connectClusterAdmin() {
  requireTestCluster();
  return connect(connectionConfig());
}

export function roleNamesForSuffix(suffix) {
  if (typeof suffix !== 'string' || !/^[a-z0-9]{8,32}$/.test(suffix)) {
    throw new Error('PIVOT-002 fixture requires an [a-z0-9]{8,32} namespace suffix.');
  }
  const prefix = 'saven_pivot_' + suffix;
  const names = {database: prefix, login: prefix + '_login', migration: prefix + '_migration'};
  for (const [key, roleSuffix] of Object.entries(roleSuffixes)) {
    names[key] = prefix + '_' + roleSuffix;
  }
  return names;
}

export function combineRunAndCleanupErrors(runError, cleanupErrors) {
  const errors = (cleanupErrors ?? []).filter(Boolean);
  if (!errors.length) return runError ?? null;
  const cleanupError = new Error(
    'PIVOT-002 fixture cleanup failed: ' + errors.map(error => error.message).join('; '),
  );
  if (!runError) return cleanupError;
  return new AggregateError([runError, cleanupError], 'PIVOT-002 fixture run and cleanup both failed');
}

function rewriteSql(sql, names) {
  let rewritten = sql;
  for (const key of targetRoleKeys) {
    const fixed = 'saven_' + roleSuffixes[key];
    rewritten = rewritten.replaceAll(fixed, names[key]);
  }
  return rewritten;
}

export async function withPivotDatabase(options, run) {
  if (typeof options === 'function') {
    run = options;
    options = {};
  }
  if (typeof run !== 'function') throw new Error('withPivotDatabase requires a callback.');
  requireTestCluster();

  const suffix = options?.namespaceSuffix ?? randomUUID().replaceAll('-', '').slice(0, 12);
  const names = roleNamesForSuffix(suffix);
  const sqlFiles = options?.sqlFiles ?? defaultSqlFiles;
  const allRoleNames = [...targetRoleKeys.map(key => names[key]), names.login, names.migration];
  const clusterConfig = connectionConfig();
  const adminUser = clusterConfig.user;
  const migrationPassword = randomBytes(32).toString('base64url');
  const loginPassword = randomBytes(32).toString('base64url');
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
    await clusterAdmin.query('SELECT pg_advisory_lock(hashtext($1))', ['saven_pivot:' + suffix]);
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
        `PIVOT-002 fixture pre-flight refused: objects already exist (${objects}); refusing to alter or reuse pre-existing cluster objects.`,
      );
    }

    await clusterAdmin.query(`CREATE DATABASE ${quoteIdent(names.database)}`);
    createdDatabase = true;
    databaseAdmin = await connect(connectionConfig(names.database));

    for (const key of targetRoleKeys) {
      const role = names[key];
      await clusterAdmin.query(
        `CREATE ROLE ${quoteIdent(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`,
      );
      createdRoles.push(role);
    }

    await clusterAdmin.query(
      `CREATE ROLE ${quoteIdent(names.migration)} LOGIN PASSWORD ${quoteLiteral(migrationPassword)} ` +
      'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION',
    );
    createdRoles.push(names.migration);
    await clusterAdmin.query(`GRANT ${quoteIdent(names.migrator)} TO ${quoteIdent(names.migration)}`);
    await clusterAdmin.query(`GRANT CREATE ON DATABASE ${quoteIdent(names.database)} TO ${quoteIdent(names.migration)}`);

    migrationClient = await connect(
      connectionConfig(names.database, {user: names.migration, password: migrationPassword}),
    );
    for (const file of sqlFiles) {
      const sql = rewriteSql(await readFile(join(repoRoot, file), 'utf8'), names);
      await migrationClient.query(sql);
    }
    // The fixture's private admin needs schema USAGE to resolve operator.*
    // names in has_table_privilege checks. This is database-local and temporary.
    await migrationClient.query(`SET ROLE ${quoteIdent(names.migrator)}`);
    await migrationClient.query(`GRANT USAGE ON SCHEMA operator TO ${quoteIdent(adminUser)}`);
    await migrationClient.query('RESET ROLE');
    await migrationClient.end();
    migrationClient = null;

    await clusterAdmin.query(
      `CREATE ROLE ${quoteIdent(names.login)} LOGIN PASSWORD ${quoteLiteral(loginPassword)} ` +
      'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION',
    );
    createdRoles.push(names.login);
    for (const key of switchableRoleKeys) {
      await clusterAdmin.query(`GRANT ${quoteIdent(names[key])} TO ${quoteIdent(names.login)}`);
    }

    const loginConfig = connectionConfig(names.database, {user: names.login, password: loginPassword});

    async function asRole(roleKey, action, {commit = false} = {}) {
      if (!switchableRoleKeys.includes(roleKey)) {
        throw new Error('PIVOT-002 fixture refused an unknown switchable role.');
      }
      const client = await connect(loginConfig);
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

    result = await run({
      suffix,
      database: names.database,
      roles: names,
      targetRoles: targetRoleKeys.map(key => names[key]),
      loginRole: names.login,
      loginPassword,
      admin: databaseAdmin,
      adminQuery: (sql, params = []) => databaseAdmin.query(sql, params),
      asRole,
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
          await clusterAdmin.query('SELECT pg_advisory_unlock(hashtext($1))', ['saven_pivot:' + suffix]);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      await clusterAdmin.end().catch(error => cleanupErrors.push(error));
    }
  }

  const combined = combineRunAndCleanupErrors(runError, cleanupErrors);
  if (combined) throw combined;
  return result;
}
