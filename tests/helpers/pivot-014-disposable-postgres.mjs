// PIVOT-014 — disposable PostgreSQL cluster for the permanent vertical-slice test.
//
// Properties required by S2:
//   * Created and destroyed automatically; no manual preparation, SSH, cloud, shared
//     database or environment skip can produce a pass.
//   * Deterministic port allocation: one ephemeral bind on 127.0.0.1, then the port is
//     released and reused. There is NO retry loop anywhere in this file — a collision is
//     reported as a failure, never retried to green.
//   * Deterministic cleanup: the cluster is stopped and its directory removed in a
//     finally block, and every pool is closed by the caller before destroy().
//   * Missing local prerequisites throw with an actionable message instead of skipping.
//
// The cluster is disposable and loopback-only. It is never a production or shared
// database, and it holds no credential from the environment.

import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Schema lineage required before the vertical-slice grants. Order is load-bearing. */
export const SCHEMA_FILES = Object.freeze([
  'db/postgres/00-roles.sql',
  'db/postgres/05-auth-schema.sql',
  'db/postgres/migrations/006-auth-schema-corrections.sql',
  'db/postgres/10-operator-schema.sql',
  'db/postgres/20-tenant-schema.sql',
  'db/postgres/migrations/021-tenant-schema-corrections.sql',
  'db/postgres/30-rls-policies.sql',
  'db/postgres/migrations/031-rls-corrections.sql',
  'db/postgres/migrations/032-rls-hardening.sql',
  'db/postgres/migrations/033-membership-admission-lock.sql',
  'db/postgres/migrations/040-posted-immutability.sql',
  'db/postgres/migrations/041-audit.sql',
  'db/postgres/migrations/042-entry-voiding.sql',
  'db/postgres/40-triggers.sql',
  'db/postgres/migrations/043-vertical-slice.sql',
]);

function binary(name) {
  const candidates = [
    process.env[`PIVOT014_${name.toUpperCase()}`],
    `/usr/lib/postgresql/18/bin/${name}`,
    `/usr/lib/postgresql/17/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const which = spawnSync('sh', ['-c', `command -v ${name}`], {encoding: 'utf8'});
  const found = which.stdout?.trim();
  if (found) return found;
  throw new Error(
    `PIVOT-014 prerequisite missing: PostgreSQL "${name}" was not found. Install the local `
    + `PostgreSQL server/client packages or set PIVOT014_${name.toUpperCase()} to its path. `
    + 'This test never skips, so a missing prerequisite fails the check.',
  );
}

/** One ephemeral loopback bind; the port is then reused by the cluster. */
async function allocatePort() {
  const server = createServer();
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  await new Promise(resolve => server.close(resolve));
  return port;
}

function run(command, args, {input, env = {}} = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input,
    env: {...process.env, ...env},
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`PIVOT-014 setup step failed: ${command} ${args.join(' ')}\n${detail}`);
  }
  return result;
}

/**
 * Creates the cluster, applies the accepted lineage plus 043, and provisions the two
 * restricted runtime logins. Cleanup is owned from the first temporary-directory
 * allocation, so any partial setup failure stops what started and removes the directory
 * only once shutdown is confirmed.
 */
export async function createDisposableCluster({label = 'pivot014'} = {}) {
  const initdb = binary('initdb');
  const pgCtl = binary('pg_ctl');
  const psql = binary('psql');

  // Ownership starts here: after this line every early return must clean up.
  const root = mkdtempSync(join(tmpdir(), `${label}-`));
  const dataDir = join(root, 'data');
  const socketDir = join(root, 'run');
  let started = false;
  let stopped = false;

  const shutdown = () => {
    if (!started || stopped) return {stopped: true, detail: 'nothing to stop'};
    const stop = spawnSync(pgCtl, ['-D', dataDir, '-m', 'immediate', '-w', '-t', '60', 'stop'], {
      encoding: 'utf8', timeout: 90_000,
    });
    if (stop.error || stop.status !== 0) {
      return {stopped: false, detail: [stop.error?.message, stop.stdout, stop.stderr].filter(Boolean).join('\n').trim()};
    }
    stopped = true;
    return {stopped: true, detail: ''};
  };

  try {
    const port = await allocatePort();
    mkdirSync(socketDir, {recursive: true});

    run(initdb, ['-D', dataDir, '-U', process.env.USER || 'postgres', '--auth=trust', '--no-sync',
      '--encoding=UTF8', '--locale=C']);

    writeFileSync(join(dataDir, 'postgresql.auto.conf'), [
      `listen_addresses = '127.0.0.1'`,
      `port = ${port}`,
      `unix_socket_directories = '${socketDir}'`,
      'fsync = off',
      'synchronous_commit = off',
      'full_page_writes = off',
      'max_connections = 40',
      '',
    ].join('\n'));

    run(pgCtl, ['-D', dataDir, '-l', join(root, 'server.log'), '-w', '-t', '60', 'start']);
    started = true;

    const env = {PGHOST: '127.0.0.1', PGPORT: String(port)};
    // Single verification after pg_ctl -w reported readiness. A failure here is a real
    // failure, not a transient to retry while the gate waits for green.
    const probe = spawnSync(psql, ['-X', '-q', '-A', '-t', '-d', 'postgres', '-c', 'SELECT 1'], {
      encoding: 'utf8', env: {...process.env, ...env}, timeout: 30_000,
    });
    if (probe.status !== 0 || probe.stdout.trim() !== '1') {
      throw new Error(
        `PIVOT-014: the cluster did not accept a verification query after pg_ctl reported ready `
        + `(logs: ${join(root, 'server.log')}): ${[probe.stdout, probe.stderr].filter(Boolean).join(' ')}`,
      );
    }

    const applyFile = relative => {
      run(psql, ['-X', '-q', '--set', 'ON_ERROR_STOP=1', '-d', 'postgres', '-f', join(repoRoot, relative)], {env});
    };
    for (const file of SCHEMA_FILES) applyFile(file);

    run(psql, ['-X', '-q', '-d', 'postgres', '-c', `
      CREATE ROLE p014_app_login LOGIN PASSWORD 'p014-local-app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      CREATE ROLE p014_auth_login LOGIN PASSWORD 'p014-local-auth' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT saven_customer_app TO p014_app_login;
      GRANT saven_auth_service TO p014_auth_login;
    `], {env});

    async function stop() {
      const result = shutdown();
      if (!result.stopped) {
        // Never delete beneath an unconfirmed live cluster: keep the data for diagnosis.
        throw new Error(`PIVOT-014: cluster shutdown could not be confirmed; ${root} preserved. ${result.detail}`);
      }
      rmSync(root, {recursive: true, force: true});
    }

    return {
      root, port, psql, stop,
      host: '127.0.0.1',
      database: 'postgres',
      logins: Object.freeze({app: 'p014_app_login', appPassword: 'p014-local-app',
        auth: 'p014_auth_login', authPassword: 'p014-local-auth'}),
      exec(sql) {
        return run(psql, ['-X', '-q', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', sql], {env}).stdout;
      },
      apply: applyFile,
    };
  } catch (error) {
    const result = shutdown();
    if (result.stopped) rmSync(root, {recursive: true, force: true});
    if (!result.stopped) {
      error.message = `${error.message}\nPIVOT-014 cleanup could not confirm shutdown; ${root} preserved. ${result.detail}`;
    }
    throw error;
  }
}
