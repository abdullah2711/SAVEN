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

export const runtimeRoleKeys = Object.freeze([
  'customerApp',
  'authService',
  'operatorRead',
  'operatorAdmin',
]);

export const switchableRoleKeys = Object.freeze([...runtimeRoleKeys, 'migrator']);

// PIVOT-004-R1 provisions one additional non-login owner (the admission helper's
// definer) through an explicitly opted-in administrator step. It is namespaced,
// preflighted and cleaned up like the other fixture roles, but it is not a runtime
// principal and is never added to the default seven-role bootstrap.
export const extraRoleKeys = Object.freeze(['tenantAdmissionDefiner']);

const extraRoleSuffixes = Object.freeze({
  tenantAdmissionDefiner: 'tenant_admission_definer',
});

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

export async function connectDatabaseAdmin(database) {
  requireTestCluster();
  return connect(connectionConfig(database));
}

export function roleNamesForSuffix(suffix) {
  if (typeof suffix !== 'string' || !/^[a-z0-9]{8,32}$/.test(suffix)) {
    throw new Error('PIVOT-002 fixture requires an [a-z0-9]{8,32} namespace suffix.');
  }
  const prefix = 'saven_pivot_' + suffix;
  const names = {database: prefix, migration: prefix + '_migration', logins: {}};
  for (const [key, roleSuffix] of Object.entries(roleSuffixes)) {
    names[key] = prefix + '_' + roleSuffix;
  }
  for (const [key, roleSuffix] of Object.entries(extraRoleSuffixes)) {
    names[key] = prefix + '_' + roleSuffix;
  }
  for (const [key, loginSuffix] of Object.entries(loginSuffixes)) {
    names.logins[key] = prefix + '_' + loginSuffix;
  }
  return names;
}

export function generatedRoleNames(names) {
  return [
    ...targetRoleKeys.map(key => names[key]),
    ...extraRoleKeys.map(key => names[key]),
    names.migration,
    ...Object.values(names.logins),
  ];
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

function rewriteRoleNames(sql, names) {
  let rewritten = sql;
  for (const key of targetRoleKeys) {
    const fixed = 'saven_' + roleSuffixes[key];
    rewritten = rewritten.replaceAll(fixed, names[key]);
  }
  for (const key of extraRoleKeys) {
    const fixed = 'saven_' + extraRoleSuffixes[key];
    rewritten = rewritten.replaceAll(fixed, names[key]);
  }
  return rewritten;
}

// Rewrite SAVEN role names into one fixture namespace. Exported so a test can apply
// a checked-in migration or a deliberately failing variant through the same mapping
// instead of hand-writing role creation.
export function namespaceSql(sql, names) {
  return rewriteRoleNames(sql, names);
}

export async function roleBootstrapSql(names) {
  return rewriteRoleNames(await readFile(join(repoRoot, 'db/postgres/00-roles.sql'), 'utf8'), names);
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
  // Explicit opt-in administrator step. Some additive corrections must provision a
  // role or transfer function ownership, which the ordinary migration principal
  // cannot do. They run as the fixture's private superuser, after the migration
  // files, and every role they create is tracked for cleanup.
  const adminSqlFiles = options?.adminSqlFiles ?? [];
  const allRoleNames = generatedRoleNames(names);
  const clusterConfig = connectionConfig();
  const adminUser = clusterConfig.user;
  const migrationPassword = randomBytes(32).toString('base64url');
  const loginPasswords = Object.fromEntries(
    runtimeRoleKeys.map(key => [key, randomBytes(32).toString('base64url')]),
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

    // Exercise the checked-in bootstrap, rewritten only into the disposable
    // namespace. It validates every target before creating any missing role.
    const bootstrapSql = await roleBootstrapSql(names);
    await databaseAdmin.query(bootstrapSql);
    for (const key of targetRoleKeys) createdRoles.push(names[key]);

    for (const key of runtimeRoleKeys) {
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
    // The fixture's private admin needs schema USAGE to resolve operator.*
    // names in has_table_privilege checks. This is database-local and temporary.
    await migrationClient.query(`SET ROLE ${quoteIdent(names.migrator)}`);
    await migrationClient.query(`GRANT USAGE ON SCHEMA operator TO ${quoteIdent(adminUser)}`);
    await migrationClient.query('RESET ROLE');
    await migrationClient.end();
    migrationClient = null;

    for (const file of adminSqlFiles) {
      await databaseAdmin.query(rewriteRoleNames(await readFile(join(repoRoot, file), 'utf8'), names));
    }
    for (const key of extraRoleKeys) {
      const exists = (
        await databaseAdmin.query('SELECT 1 AS present FROM pg_roles WHERE rolname = $1', [names[key]])
      ).rowCount > 0;
      if (exists) createdRoles.push(names[key]);
    }

    const loginConfigs = Object.fromEntries(runtimeRoleKeys.map(key => [
      key,
      connectionConfig(names.database, {user: names.logins[key], password: loginPasswords[key]}),
    ]));
    loginConfigs.migrator = connectionConfig(names.database, {user: names.migration, password: migrationPassword});

    async function asRole(roleKey, action, {commit = false} = {}) {
      if (!switchableRoleKeys.includes(roleKey)) {
        throw new Error('PIVOT-002 fixture refused an unknown switchable role.');
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
      if (!switchableRoleKeys.includes(roleKey)) {
        throw new Error('PIVOT-002 fixture refused an unknown login principal.');
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
      targetRoles: targetRoleKeys.map(key => names[key]),
      extraRoles: Object.fromEntries(extraRoleKeys.map(key => [key, names[key]])),
      runtimeRoles: runtimeRoleKeys.map(key => names[key]),
      runtimeLogins: runtimeRoleKeys.map(key => names.logins[key]),
      migrationLogin: names.migration,
      admin: databaseAdmin,
      // No parameters means simple-query protocol, which is required for a
      // multi-statement migration body containing dollar-quoted blocks.
      adminQuery: (sql, params) => databaseAdmin.query(sql, params),
      applyRoleBootstrap: () => databaseAdmin.query(bootstrapSql),
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
      // Administrator-applied corrections may provision the extra owner through a
      // path the fixture did not track (for example a deliberate failure probe).
      // Preflight proved these names did not exist, so dropping them is safe.
      for (const key of extraRoleKeys) {
        if (createdRoles.includes(names[key])) continue;
        try {
          await clusterAdmin.query(`DROP ROLE IF EXISTS ${quoteIdent(names[key])}`);
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
