// PIVOT-008: target PostgreSQL RLS/privilege coverage runner.
//
// Invoked by `node scripts/check.mjs --postgres`. It:
//   1. refuses to run without an explicitly opted-in disposable/test PostgreSQL
//      configuration (SAVEN_PIVOT_TEST_CLUSTER=1) and a loopback admin connection;
//   2. by default creates a private database, applies the complete accepted schema
//      stack in the documented order, and runs db/postgres/99-ci-rls-coverage.sql;
//   3. with --database <name>, runs the same coverage query against an existing
//      database that a test has already provisioned;
//   4. runs the accepted read-only protocol validators
//      (operator.assert_read_authority_protocol and
//      operator.assert_operator_definer_authority) so a disabled writer gate or a
//      widened definer surface turns the gate red;
//   5. exits nonzero when the gate is unavailable, when installation fails, when a
//      protocol validator refuses the installation, or when the coverage query
//      returns any row. A zero-row result with accepted validators is the only pass.
//
// Failure-path contract: an inner operation never exits the process. Exit happens
// once, after cleanup. A temporary database is dropped only when this run confirmed
// that its own CREATE DATABASE succeeded; a name collision or uncertain creation is
// never dropped, and cleanup residue is reported with the retained target.

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

const protocolProbes = [
  ['operator.assert_read_authority_protocol()', 'SELECT operator.assert_read_authority_protocol()'],
  [
    "operator.assert_operator_definer_authority('post', false)",
    "SELECT operator.assert_operator_definer_authority('post', false)",
  ],
];

class GateError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

function parseArguments(argv) {
  const options = {
    database: null,
    temporaryName: null,
    injectFailureAfterCreate: false,
    injectDropFailure: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--database') {
      options.database = argv[index + 1];
      if (!options.database || options.database.startsWith('--')) {
        throw new GateError('--database requires a database name');
      }
      index += 1;
    } else if (argument === '--temporary-name') {
      // Test seam for deterministic collision coverage. Not used by normal CI.
      options.temporaryName = argv[index + 1];
      if (!options.temporaryName || options.temporaryName.startsWith('--')) {
        throw new GateError('--temporary-name requires a name');
      }
      index += 1;
    } else if (argument === '--inject-failure-after-create') {
      options.injectFailureAfterCreate = true;
    } else if (argument === '--inject-drop-failure') {
      options.injectDropFailure = true;
    } else if (argument === '--help') {
      process.stdout.write(
        'Usage: node scripts/verify-pg-rls.mjs [--database <name>]\n' +
        'Without --database, installs the full accepted stack into a private temporary\n' +
        'database and drops it. Requires SAVEN_PIVOT_TEST_CLUSTER=1.\n' +
        'Test-only seams: --temporary-name, --inject-failure-after-create,\n' +
        '--inject-drop-failure.\n',
      );
      process.exit(0);
    } else {
      throw new GateError(`unknown argument ${argument}`);
    }
  }
  return options;
}

function requireDisposableConfiguration() {
  if (process.env.SAVEN_PIVOT_TEST_CLUSTER !== '1') {
    throw new GateError(
      'refusing to run without SAVEN_PIVOT_TEST_CLUSTER=1; the coverage gate creates ' +
      'and drops databases and must target a dedicated disposable PostgreSQL cluster',
    );
  }
  const host = process.env.PGHOST ?? '127.0.0.1';
  if (!loopbackHosts.has(host) && !host.startsWith('/')) {
    throw new GateError('requires a loopback PGHOST (127.0.0.1, localhost, ::1 or a local socket path)');
  }
  const port = Number(process.env.PGPORT ?? 5432);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new GateError('requires a valid PGPORT');
  }
  const user = process.env.PGUSER ?? 'postgres';
  if (/^saven_/i.test(user)) {
    throw new GateError('requires a separate administrative PGUSER, not a SAVEN target role');
  }
  const sslMode = process.env.PGSSLMODE;
  if (sslMode && sslMode !== 'disable' && sslMode !== 'require') {
    throw new GateError('supports only PGSSLMODE=disable or require');
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
    throw new GateError('refused an invalid database identifier');
  }
  return `"${value}"`;
}

async function connect(config, label) {
  const client = new Client(config);
  try {
    await client.connect();
  } catch (error) {
    throw new GateError(`cannot connect to ${label}: ${error.message}`, 2);
  }
  return client;
}

async function applyStack(client) {
  for (const file of [...migrationFiles, ...administratorFiles]) {
    const sql = await readFile(resolve(root, file), 'utf8');
    try {
      await client.query(sql);
    } catch (error) {
      throw new GateError(`failed to apply ${file}: ${error.message}`, 1);
    }
  }
}

async function runCoverage(client) {
  const sql = await readFile(resolve(root, coverageFile), 'utf8');
  try {
    return (await client.query(sql)).rows;
  } catch (error) {
    throw new GateError(`coverage query failed: ${error.message}`, 1);
  }
}

async function runProtocolProbes(client) {
  const failures = [];
  for (const [name, sql] of protocolProbes) {
    try {
      await client.query(sql);
    } catch (error) {
      failures.push({name, message: error.message});
    }
  }
  return failures;
}

function printReport(rows, probeFailures) {
  let code = 0;
  if (rows.length > 0) {
    code = 1;
    process.stderr.write(`FAIL: PIVOT-008 RLS/privilege coverage found ${rows.length} violation(s):\n`);
    for (const row of rows) {
      process.stderr.write(`  ${row.kind} ${row.object} — ${row.detail}\n`);
    }
  }
  if (probeFailures.length > 0) {
    code = 1;
    process.stderr.write('FAIL: PIVOT-008 installed authority protocol was refused:\n');
    for (const failure of probeFailures) {
      process.stderr.write(`  PROTOCOL_PROBE_FAILED ${failure.name}: ${failure.message}\n`);
    }
  }
  if (code === 0) {
    process.stdout.write(
      `PASS: PIVOT-008 RLS/privilege coverage found no violation in ${process.env.PGPORT ?? 5432}; ` +
      'installed authority protocol accepted.\n',
    );
  }
  return code;
}

async function runAgainstExisting(options, environment) {
  const client = await connect(
    connectionConfig(options.database, environment),
    `database ${options.database}`,
  );
  try {
    const rows = await runCoverage(client);
    const probeFailures = await runProtocolProbes(client);
    return {rows, probeFailures, cleanup: []};
  } finally {
    await client.end().catch(() => {});
  }
}

async function runWithTemporaryDatabase(options, environment) {
  const temporaryName = options.temporaryName ?? `saven_rls_gate_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const admin = await connect(connectionConfig(undefined, environment), 'the administrative database');
  let confirmedOwner = false;
  let databaseClient = null;
  const cleanupErrors = [];
  let rows = null;
  let probeFailures = [];
  let primaryError = null;

  try {
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(temporaryName)}`);
      confirmedOwner = true;
    } catch (error) {
      if (error.code === '42P04') {
        throw new GateError(
          `temporary database ${temporaryName} already exists; refusing to reuse or drop a database this run did not create`,
          2,
        );
      }
      throw new GateError(
        `temporary database ${temporaryName} creation was not confirmed (${error.message}); ` +
        'refusing to drop a database this run may not own',
        2,
      );
    }

    if (options.injectFailureAfterCreate) {
      throw new GateError('injected failure after CREATE DATABASE (test seam)', 1);
    }

    databaseClient = await connect(
      connectionConfig(temporaryName, environment),
      `temporary database ${temporaryName}`,
    );
    await applyStack(databaseClient);
    rows = await runCoverage(databaseClient);
    probeFailures = await runProtocolProbes(databaseClient);
  } catch (error) {
    primaryError = error;
  } finally {
    if (databaseClient) {
      await databaseClient.end().catch(error => cleanupErrors.push(`client close: ${error.message}`));
    }
    if (confirmedOwner) {
      if (options.injectDropFailure) {
        cleanupErrors.push('injected DROP DATABASE failure (test seam)');
      } else {
        try {
          await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(temporaryName)} WITH (FORCE)`);
        } catch (error) {
          cleanupErrors.push(`drop ${temporaryName}: ${error.message}`);
        }
      }
    }
    await admin.end().catch(error => cleanupErrors.push(`admin close: ${error.message}`));
  }

  if (primaryError) {
    return {error: primaryError, rows: [], probeFailures: [], cleanup: cleanupErrors, temporaryName, confirmedOwner};
  }
  return {rows, probeFailures, cleanup: cleanupErrors, temporaryName, confirmedOwner};
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const environment = requireDisposableConfiguration();
  const result = options.database
    ? await runAgainstExisting(options, environment)
    : await runWithTemporaryDatabase(options, environment);

  let code = 0;
  if (result.error) {
    process.stderr.write(`PIVOT-008 RLS coverage gate: ${result.error.message}\n`);
    code = result.error.code ?? 1;
  } else {
    code = printReport(result.rows, result.probeFailures);
  }

  if (result.cleanup.length > 0) {
    code = code || 1;
    process.stderr.write(
      `RESIDUE: temporary resources were not fully cleaned up` +
      (result.temporaryName ? ` (target ${result.temporaryName})` : '') + ':\n',
    );
    for (const message of result.cleanup) process.stderr.write(`  ${message}\n`);
  }
  return code;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (error) {
  if (error instanceof GateError) {
    process.stderr.write(`PIVOT-008 RLS coverage gate: ${error.message}\n`);
    exitCode = error.code;
  } else {
    process.stderr.write(`PIVOT-008 RLS coverage gate: unexpected failure: ${error.message}\n`);
    exitCode = 1;
  }
}
process.exit(exitCode);
