// PIVOT-008: target PostgreSQL RLS/privilege coverage runner.
//
// Invoked by `node scripts/check.mjs --postgres`. It:
//   1. refuses to run without an explicitly opted-in disposable/test PostgreSQL
//      configuration (SAVEN_PIVOT_TEST_CLUSTER=1) and a loopback admin connection;
//   2. by default creates a private database, applies the complete accepted schema
//      stack in the documented order, and runs db/postgres/99-ci-rls-coverage.sql;
//   3. with --database <name>, runs the same coverage query against an existing
//      database that a test has already provisioned;
//   4. exits nonzero when the gate is unavailable, when installation fails, or when
//      the coverage query returns any row. A zero-row result is the only pass.
//
// It never repairs a violation, never grants anything and never touches a database it
// did not create. The temporary database is dropped on the same run.

import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const {Client} = pg;
const root = fileURLToPath(new URL('..', import.meta.url));
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

// The accepted stack, in db/postgres/README.md order. Migration files are applied
// first because they create the base schemas; the administrator steps then provision
// dedicated definer owners, corrections, payloads, activation and the operator surface.
// Keeping this list explicit means a new migration is added deliberately, together
// with its coverage review, instead of being swept in by a directory glob.
const migrationFiles = [
  'db/postgres/00-roles.sql',
  'db/postgres/10-operator-schema.sql',
  'db/postgres/05-auth-schema.sql',
  'db/postgres/migrations/006-auth-schema-corrections.sql',
  'db/postgres/20-tenant-schema.sql',
  'db/postgres/migrations/021-tenant-schema-corrections.sql',
  'db/postgres/30-rls-policies.sql',
  'db/postgres/migrations/040-posted-immutability.sql',
];
const administratorFiles = [
  'db/postgres/migrations/031-rls-corrections.sql',
  'db/postgres/migrations/032-rls-hardening.sql',
  'db/postgres/migrations/033-membership-admission-lock.sql',
  'db/postgres/06-operator-identity.sql',
  'db/postgres/migrations/041-audit.sql',
  'db/postgres/migrations/042-entry-voiding.sql',
  'db/postgres/40-triggers.sql',
  'db/postgres/50-functions.sql',
];
const coverageFile = 'db/postgres/99-ci-rls-coverage.sql';

function fail(message, code = 2) {
  process.stderr.write(`PIVOT-008 RLS coverage gate: ${message}\n`);
  process.exit(code);
}

function parseArguments(argv) {
  let database = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--database') {
      database = argv[index + 1];
      if (!database || database.startsWith('--')) fail('--database requires a database name');
      index += 1;
    } else if (argument === '--help') {
      process.stdout.write(
        'Usage: node scripts/verify-pg-rls.mjs [--database <name>]\n' +
        'Without --database, installs the full accepted stack into a private temporary\n' +
        'database and drops it. Requires SAVEN_PIVOT_TEST_CLUSTER=1.\n',
      );
      process.exit(0);
    } else {
      fail(`unknown argument ${argument}`);
    }
  }
  return {database};
}

function requireDisposableConfiguration() {
  if (process.env.SAVEN_PIVOT_TEST_CLUSTER !== '1') {
    fail(
      'refusing to run without SAVEN_PIVOT_TEST_CLUSTER=1; the coverage gate creates ' +
      'and drops databases and must target a dedicated disposable PostgreSQL cluster',
    );
  }
  const host = process.env.PGHOST ?? '127.0.0.1';
  if (!loopbackHosts.has(host) && !host.startsWith('/')) {
    fail('requires a loopback PGHOST (127.0.0.1, localhost, ::1 or a local socket path)');
  }
  const port = Number(process.env.PGPORT ?? 5432);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('requires a valid PGPORT');
  }
  const user = process.env.PGUSER ?? 'postgres';
  if (/^saven_/i.test(user)) {
    fail('requires a separate administrative PGUSER, not a SAVEN target role');
  }
  const sslMode = process.env.PGSSLMODE;
  if (sslMode && sslMode !== 'disable' && sslMode !== 'require') {
    fail('supports only PGSSLMODE=disable or require');
  }
  return {host, port, user, sslMode};
}

function connectionConfig(database, environment) {
  return {
    host: environment.host,
    port: environment.port,
    user: environment.user,
    password: process.env.PGPASSWORD ?? '',
    database: database ?? process.env.PGADMIN_DATABASE ?? 'postgres',
    application_name: 'saven-pivot-008-rls-coverage',
    connectionTimeoutMillis: 10000,
    statement_timeout: 60000,
    // Never disable certificate verification for a remote TLS connection.
    ssl: environment.sslMode === 'require' ? {rejectUnauthorized: true} : false,
  };
}

function quoteIdent(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) {
    fail('refused an invalid database identifier');
  }
  return `"${value}"`;
}

async function connect(config, label) {
  const client = new Client(config);
  try {
    await client.connect();
  } catch (error) {
    fail(`cannot connect to ${label}: ${error.message}`, 2);
  }
  return client;
}

async function applyStack(client) {
  for (const file of [...migrationFiles, ...administratorFiles]) {
    const sql = await readFile(resolve(root, file), 'utf8');
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`failed to apply ${file}: ${error.message}`);
    }
  }
}

async function runCoverage(client) {
  const sql = await readFile(resolve(root, coverageFile), 'utf8');
  let result;
  try {
    result = await client.query(sql);
  } catch (error) {
    throw new Error(`coverage query failed: ${error.message}`);
  }
  return result.rows;
}

function report(rows) {
  if (rows.length === 0) {
    process.stdout.write(
      `PASS: PIVOT-008 RLS/privilege coverage found no violation in ${process.env.PGPORT ?? 5432}.\n`,
    );
    return 0;
  }
  process.stderr.write(`FAIL: PIVOT-008 RLS/privilege coverage found ${rows.length} violation(s):\n`);
  for (const row of rows) {
    process.stderr.write(`  ${row.kind} ${row.object} — ${row.detail}\n`);
  }
  return 1;
}

const {database} = parseArguments(process.argv.slice(2));
const environment = requireDisposableConfiguration();

if (database) {
  const client = await connect(connectionConfig(database, environment), `database ${database}`);
  let rows;
  try {
    rows = await runCoverage(client);
  } catch (error) {
    await client.end().catch(() => {});
    fail(error.message, 1);
  }
  await client.end();
  process.exit(report(rows));
}

const temporaryName = `saven_rls_gate_${Date.now()}_${randomBytes(4).toString('hex')}`;
const admin = await connect(connectionConfig(undefined, environment), 'the administrative database');
let databaseClient = null;
let rows;
try {
  await admin.query(`CREATE DATABASE ${quoteIdent(temporaryName)}`);
  databaseClient = await connect(
    connectionConfig(temporaryName, environment),
    `temporary database ${temporaryName}`,
  );
  await applyStack(databaseClient);
  rows = await runCoverage(databaseClient);
} catch (error) {
  await databaseClient?.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(temporaryName)} WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});
  fail(error.message, 1);
}
await databaseClient.end();
await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(temporaryName)} WITH (FORCE)`);
await admin.end();
process.exit(report(rows));
