import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const {Client} = pg;
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

export const targetRoles = Object.freeze([
  'saven_customer_app',
  'saven_auth_service',
  'saven_operator_read',
  'saven_operator_admin',
  'saven_migrator',
  'saven_operator_definer',
  'saven_auth_definer',
]);

export const switchableRoles = Object.freeze([
  'saven_customer_app',
  'saven_operator_read',
  'saven_operator_admin',
  'saven_migrator',
]);

const defaultSqlFiles = Object.freeze([
  'db/postgres/00-roles.sql',
  'db/postgres/10-operator-schema.sql',
]);

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
  return {
    host,
    port,
    user,
    password,
    database: database ?? process.env.PGADMIN_DATABASE ?? 'postgres',
    application_name: 'saven-pivot-002',
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    ssl: process.env.PGSSLMODE === 'require' ? {rejectUnauthorized: false} : false,
    ...overrides,
  };
}

async function connect(config) {
  const client = new Client(config);
  await client.connect();
  return client;
}

export async function withPivotDatabase(options, run) {
  if (typeof options === 'function') {
    run = options;
    options = {};
  }
  if (typeof run !== 'function') throw new Error('withPivotDatabase requires a callback.');
  const sqlFiles = options?.sqlFiles ?? defaultSqlFiles;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const database = 'saven_pivot_' + suffix;
  const loginRole = 'pivot_login_' + suffix;
  const loginPassword = randomBytes(32).toString('base64url');
  const clusterConfig = connectionConfig();
  const adminUser = clusterConfig.user;

  let clusterAdmin;
  let databaseAdmin;
  let existingRoles = new Set();
  let runError = null;
  let result;

  try {
    // The cluster connection only creates/drops the disposable database and
    // roles. All schema assertions run on databaseAdmin below.
    clusterAdmin = await connect(clusterConfig);
    existingRoles = new Set(
      (await clusterAdmin.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1)', [targetRoles])).rows.map(row => row.rolname),
    );
    await clusterAdmin.query(`CREATE DATABASE ${quoteIdent(database)}`);
    databaseAdmin = await connect(connectionConfig(database));

    const rolesFile = sqlFiles.find(file => file.endsWith('00-roles.sql'));
    const schemaFiles = sqlFiles.filter(file => !file.endsWith('00-roles.sql'));
    if (rolesFile) {
      await databaseAdmin.query(await readFile(join(repoRoot, rolesFile), 'utf8'));
      // The bootstrap schema is owned by saven_migrator. A real migration
      // connection is a member of that role; the fixture grants membership only
      // inside its disposable test database and never changes a production login.
      await databaseAdmin.query(`GRANT saven_migrator TO ${quoteIdent(adminUser)}`);
    }
    for (const file of schemaFiles) {
      await databaseAdmin.query(await readFile(join(repoRoot, file), 'utf8'));
    }
    // The fixture's private admin inspects object privileges; it needs schema
    // USAGE to resolve operator.* names. This is a disposable test grant, not a
    // SAVEN target-role privilege and not part of the production bootstrap.
    await databaseAdmin.query('SET ROLE saven_migrator');
    await databaseAdmin.query(`GRANT USAGE ON SCHEMA operator TO ${quoteIdent(adminUser)}`);
    await databaseAdmin.query('RESET ROLE');

    await databaseAdmin.query(
      `CREATE ROLE ${quoteIdent(loginRole)} LOGIN PASSWORD ${quoteLiteral(loginPassword)} ` +
      'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION',
    );
    for (const role of switchableRoles) {
      await databaseAdmin.query(`GRANT ${quoteIdent(role)} TO ${quoteIdent(loginRole)}`);
    }

    const loginConfig = connectionConfig(database, {user: loginRole, password: loginPassword});

    async function asRole(role, action, {commit = false} = {}) {
      if (!switchableRoles.includes(role)) throw new Error('PIVOT-002 fixture refused an unknown switchable role.');
      const client = await connect(loginConfig);
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${quoteIdent(role)}`);
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
      database,
      admin: databaseAdmin,
      adminQuery: (sql, params = []) => databaseAdmin.query(sql, params),
      loginRole,
      loginPassword,
      loginConfig,
      asRole,
    });
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    if (databaseAdmin) {
      await databaseAdmin.end().catch(error => cleanupErrors.push(error));
    }
    if (clusterAdmin) {
      try {
        await clusterAdmin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await clusterAdmin.query(`DROP ROLE IF EXISTS ${quoteIdent(loginRole)}`);
      } catch (error) {
        cleanupErrors.push(error);
      }
      for (const role of targetRoles) {
        if (existingRoles.has(role)) continue;
        try {
          await clusterAdmin.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      await clusterAdmin.end().catch(error => cleanupErrors.push(error));
    }
    if (cleanupErrors.length && !runError) {
      throw new Error('PIVOT-002 fixture cleanup failed: ' + cleanupErrors.map(error => error.message).join('; '));
    }
  }

  return result;
}
