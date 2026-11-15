import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {withAuthDatabase} from './helpers/pg-auth-fixture.mjs';

const repoRoot = new URL('../', import.meta.url);
const hex64 = seed => Buffer.from(seed).toString('hex').padEnd(64, '0');

function statements(sql) {
  return sql
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

test('AUTH-008 schema text declares OIDC readiness without a connector or new grants', async () => {
  const schemaSql = await readFile(new URL('db/postgres/05-auth-schema.sql', repoRoot), 'utf8');
  const correctionSql = await readFile(
    new URL('db/postgres/migrations/006-auth-schema-corrections.sql', repoRoot),
    'utf8',
  );
  const combined = `${schemaSql}\n${correctionSql}`;

  // Provider/subject binding, PKCE state and provider tokens exist as readiness only.
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS auth\.accounts/);
  assert.match(schemaSql, /UNIQUE \(provider_id, account_id\)/);
  assert.match(schemaSql, /user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT/);
  assert.match(schemaSql, /access_token_ciphertext text/);
  assert.match(schemaSql, /refresh_token_ciphertext text/);
  assert.match(schemaSql, /id_token_ciphertext text/);
  assert.match(schemaSql, /token_key_version integer/);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS auth\.oauth_state/);
  assert.match(schemaSql, /state_hash text NOT NULL UNIQUE/);
  assert.match(schemaSql, /nonce_hash text/);
  assert.match(schemaSql, /code_verifier_ciphertext text/);
  assert.match(schemaSql, /link_user_id uuid REFERENCES auth\.users\(id\)/);
  assert.match(schemaSql, /consumed_at timestamptz/);
  assert.match(schemaSql, /CHECK \(expires_at > created_at\)/);

  // The correction is the enforced PKCE key-binding guard, not a plaintext column.
  assert.match(correctionSql, /oauth_state_pkce_key_binding_chk/);
  assert.match(correctionSql, /code_verifier_key_version IS NOT NULL AND code_verifier_key_version > 0/);
  assert.match(correctionSql, /VALIDATE CONSTRAINT/);

  // No plaintext token, provider secret, client credential or auto-link substrate.
  assert.doesNotMatch(schemaSql, /\baccess_token\s+text\b/i);
  assert.doesNotMatch(schemaSql, /\brefresh_token\s+text\b/i);
  assert.doesNotMatch(schemaSql, /\bid_token\s+text\b/i);
  assert.doesNotMatch(combined, /\bclient_secret\b|\bclient_id\b|\bdiscovery_url\b|\bissuer_url\b/i);
  assert.doesNotMatch(combined, /\bauto_link|\btrusted_provider|\bemail_verified_claim/i);
  assert.doesNotMatch(combined, /CREATE TABLE[^;]*\b(?:oauth_provider|oidc_provider|connector|passkey)\b/i);
  assert.doesNotMatch(combined, /https?:\/\/(?!json-schema)/i, 'no provider endpoint may be hardcoded in schema');

  // No live/provider network or key material in SQL.
  assert.doesNotMatch(combined, /\bPASSWORD\s+(?:E)?'|BEGIN (?:RSA|EC) PRIVATE KEY/i);

  // Only the shared auth roles receive grants, and never DELETE/TRUNCATE/ALL.
  const granted = new Set();
  for (const statement of statements(combined)) {
    if (!/^GRANT\b/i.test(statement)) continue;
    for (const match of statement.matchAll(/\bTO\s+(saven_[a-z_]+)/gi)) granted.add(match[1]);
    assert.doesNotMatch(
      statement,
      /\bGRANT\s+ALL\b|\bDELETE\b|\bTRUNCATE\b/i,
      `grants must stay narrow: ${statement.slice(0, 60)}`,
    );
  }
  // The offline DDL role keeps its schema-creation grant; it receives no object
  // privilege from this contract.
  assert.deepEqual([...granted].sort(), ['saven_auth_definer', 'saven_auth_service', 'saven_migrator']);
  for (const statement of statements(combined)) {
    if (!/^GRANT\b/i.test(statement) || !/\bTO\s+saven_migrator\b/i.test(statement)) continue;
    assert.match(statement, /ON SCHEMA auth/i, 'the migrator grant must stay at schema level');
  }
  for (const role of ['customer_app', 'operator_read', 'operator_admin', 'operator_definer']) {
    assert.doesNotMatch(combined, new RegExp(`GRANT[^;]*\\bTO\\s+saven_${role}\\b`, 'i'));
  }

  // Identity and membership stay single-authority: no duplicate registries exist.
  const createdTables = [...combined.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_.]+)/gi)].map(match => match[1]);
  assert.equal(createdTables.filter(name => name.endsWith('.user_identity')).length, 0);
  assert.equal(createdTables.filter(name => name.endsWith('.tenant_membership')).length, 1);
  assert.ok(createdTables.includes('auth.tenant_membership'));
  // Identity-table names may appear only in explanatory comments, never in SQL.
  const executableSql = combined
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  // The words may appear inside documentation comments/strings, but no operator
  // object is created, referenced or granted.
  assert.doesNotMatch(executableSql, /CREATE SCHEMA (?:IF NOT EXISTS )?operator/i);
  assert.doesNotMatch(executableSql, /CREATE TABLE[^;]*\boperator\./i);
  assert.doesNotMatch(executableSql, /REFERENCES\s+operator\./i);
  assert.doesNotMatch(executableSql, /GRANT[^;]*\boperator\./i);
});

test('AUTH-008 catalog keeps the configured provider/subject binding unique and user-scoped', async () => {
  await withAuthDatabase(async db => {
    const columns = (
      await db.adminQuery(
        `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'auth' AND table_name IN ('accounts', 'oauth_state', 'users', 'tenant_membership')
         ORDER BY table_name, column_name`,
      )
    ).rows;
    const tableColumns = table => columns.filter(row => row.table_name === table);

    const accounts = tableColumns('accounts');
    const accountNames = accounts.map(row => row.column_name);
    assert.ok(accountNames.includes('provider_id'));
    assert.ok(accountNames.includes('account_id'));
    assert.ok(accountNames.includes('user_id'));
    for (const encrypted of ['access_token_ciphertext', 'refresh_token_ciphertext', 'id_token_ciphertext']) {
      assert.ok(accountNames.includes(encrypted), `${encrypted} must exist`);
    }
    for (const plaintext of ['access_token', 'refresh_token', 'id_token', 'password', 'client_secret', 'client_id']) {
      assert.equal(accountNames.includes(plaintext), false, `auth.accounts must not store plaintext ${plaintext}`);
    }
    assert.equal(tableColumns('accounts').find(row => row.column_name === 'user_id').data_type, 'uuid');

    const oauthState = tableColumns('oauth_state');
    const stateNames = oauthState.map(row => row.column_name);
    for (const required of ['provider_id', 'purpose', 'state_hash', 'nonce_hash', 'code_verifier_ciphertext', 'expires_at', 'consumed_at', 'link_user_id']) {
      assert.ok(stateNames.includes(required), `auth.oauth_state.${required} must exist`);
    }
    for (const plaintext of ['state', 'nonce', 'code_verifier', 'access_token', 'client_secret']) {
      assert.equal(stateNames.includes(plaintext), false, `auth.oauth_state must not store plaintext ${plaintext}`);
    }

    const unique = (
      await db.adminQuery(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'auth' AND t.relname IN ('accounts', 'oauth_state') AND c.contype IN ('u', 'f', 'c')
         ORDER BY c.conname`,
      )
    ).rows;
    const accountUnique = unique.filter(row => row.conname.startsWith('accounts'));
    assert.ok(
      accountUnique.some(row => /UNIQUE \(provider_id, account_id\)/.test(row.definition)),
      'the configured provider/subject pair must be unique',
    );
    const userKey = accountUnique.find(row => /FOREIGN KEY \(user_id\)/.test(row.definition));
    assert.ok(userKey, 'auth.accounts must keep a user foreign key');
    assert.match(userKey.definition, /REFERENCES auth\.users\(id\)/);
    const stateUnique = unique.filter(row => row.conname.startsWith('oauth_state'));
    assert.ok(stateUnique.some(row => /UNIQUE \(state_hash\)/.test(row.definition)), 'state hashes must be unique');
    assert.ok(
      stateUnique.some(row => row.conname === 'oauth_state_pkce_key_binding_chk'),
      'the PKCE key-binding constraint must exist',
    );
    const pkce = stateUnique.find(row => row.conname === 'oauth_state_pkce_key_binding_chk');
    assert.match(pkce.definition, /code_verifier_key_version IS NOT NULL/);

    // One canonical identity and membership registry only.
    const registries = (
      await db.adminQuery(
        `SELECT n.nspname, c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r'
           AND c.relname IN ('users', 'tenant_membership', 'user_identity')
         ORDER BY n.nspname, c.relname`,
      )
    ).rows;
    assert.deepEqual(registries, [
      {nspname: 'auth', relname: 'tenant_membership'},
      {nspname: 'auth', relname: 'users'},
    ]);

    // No new grants: the readiness tables follow the AUTH-001 privilege model.
    const privilege = async (role, table, action) => (
      await db.adminQuery('SELECT has_table_privilege($1, $2, $3) AS allowed', [role, `auth.${table}`, action])
    ).rows[0].allowed;
    for (const role of [db.roles.customerApp, db.roles.operatorRead, db.roles.operatorAdmin]) {
      for (const table of ['accounts', 'oauth_state']) {
        assert.equal(await privilege(role, table, 'SELECT'), false, `${role} must not read auth.${table}`);
      }
    }
    for (const table of ['accounts', 'oauth_state']) {
      assert.equal(await privilege(db.roles.authService, table, 'SELECT'), true);
      assert.equal(await privilege(db.roles.authService, table, 'INSERT'), true);
      assert.equal(await privilege(db.roles.authService, table, 'UPDATE'), true);
      assert.equal(await privilege(db.roles.authService, table, 'DELETE'), false);
      assert.equal(await privilege(db.roles.authService, table, 'TRUNCATE'), false);
    }

    const domains = (
      await db.adminQuery(
        `SELECT domain, value FROM auth.reference_value
         WHERE domain IN ('account_provider', 'oauth_state_purpose') ORDER BY domain, value`,
      )
    ).rows;
    assert.deepEqual(
      domains.filter(row => row.domain === 'account_provider').map(row => row.value),
      ['credential', 'generic_oauth'],
    );
    assert.deepEqual(
      domains.filter(row => row.domain === 'oauth_state_purpose').map(row => row.value),
      ['link', 'login'],
    );
  });
});

test('AUTH-008 provider/subject binding rejects duplicates and unknown users', async () => {
  await withAuthDatabase(async db => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    await db.adminQuery(
      `INSERT INTO auth.users(id, email) VALUES($1, 'oidc-a@example.com'), ($2, 'oidc-b@example.com')`,
      [userId, otherUserId],
    );
    await db.adminQuery(
      `INSERT INTO auth.accounts(user_id, provider_id, account_id, is_primary)
       VALUES($1, 'generic_oauth', 'subject-abc', true)`,
      [userId],
    );

    await assert.rejects(
      () => db.adminQuery(
        `INSERT INTO auth.accounts(user_id, provider_id, account_id) VALUES($1, 'generic_oauth', 'subject-abc')`,
        [otherUserId],
      ),
      /duplicate key value violates unique constraint/,
      'one provider subject may bind to only one user',
    );
    // A different provider may reuse the same subject shape without collision.
    await db.adminQuery(
      `INSERT INTO auth.accounts(user_id, provider_id, account_id) VALUES($1, 'credential', 'subject-abc')`,
      [otherUserId],
    );
    await assert.rejects(
      () => db.adminQuery(
        `INSERT INTO auth.accounts(user_id, provider_id, account_id)
         VALUES('00000000-0000-4000-8000-000000000000', 'generic_oauth', 'subject-missing-user')`,
      ),
      /accounts_user_id_fkey/,
      'an account must belong to an existing canonical user',
    );

    const binding = await db.adminQuery(
      `SELECT count(*)::int AS n FROM auth.accounts WHERE account_id = 'subject-abc'`,
    );
    assert.equal(binding.rows[0].n, 2);
  });
});

test('AUTH-008 provider tokens stay ciphertext-only with a bound key version', async () => {
  await withAuthDatabase(async db => {
    const userId = randomUUID();
    await db.adminQuery(`INSERT INTO auth.users(id, email) VALUES($1, 'tokens@example.com')`, [userId]);

    await assert.rejects(
      () => db.adminQuery(
        `INSERT INTO auth.accounts(user_id, provider_id, account_id, access_token_ciphertext)
         VALUES($1, 'generic_oauth', 'subject-token', 'envelope-ciphertext-value')`,
        [userId],
      ),
      /violates check constraint/,
      'a provider token ciphertext requires a key version',
    );
    await assert.rejects(
      () => db.adminQuery(
        `INSERT INTO auth.accounts(user_id, provider_id, account_id, access_token_ciphertext, token_key_version)
         VALUES($1, 'generic_oauth', 'subject-token', 'envelope-ciphertext-value', 0)`,
        [userId],
      ),
      /violates check constraint/,
    );
    const stored = await db.adminQuery(
      `INSERT INTO auth.accounts(user_id, provider_id, account_id, access_token_ciphertext, refresh_token_ciphertext, token_key_version, access_token_expires_at)
       VALUES($1, 'generic_oauth', 'subject-token', 'envelope-ciphertext-value', 'refresh-ciphertext-value', 3, now() + interval '1 hour')
       RETURNING token_algorithm, token_key_version`,
      [userId],
    );
    assert.deepEqual(stored.rows, [{token_algorithm: 'aes_256_gcm', token_key_version: 3}]);
  });
});

test('AUTH-008 OAuth state, nonce and PKCE readiness is expiring and single-use', async () => {
  await withAuthDatabase(async db => {
    const userId = randomUUID();
    await db.adminQuery(`INSERT INTO auth.users(id, email) VALUES($1, 'state@example.com')`, [userId]);

    const stateHash = hex64('oidc-state');
    await db.adminQuery(
      `INSERT INTO auth.oauth_state(provider_id, purpose, state_hash, nonce_hash, code_verifier_ciphertext, code_verifier_key_version, expires_at)
       VALUES('generic_oauth', 'login', $1, $2, 'pkce-verifier-envelope', 1, now() + interval '10 minutes')`,
      [stateHash, hex64('oidc-nonce')],
    );

    const consume = () => db.adminQuery(
      `UPDATE auth.oauth_state SET consumed_at = now()
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id`,
      [stateHash],
    );
    assert.equal((await consume()).rowCount, 1);
    assert.equal((await consume()).rowCount, 0, 'an OAuth state must be single-use');

    await assert.rejects(
      () => db.adminQuery(
        `INSERT INTO auth.oauth_state(provider_id, state_hash, expires_at)
         VALUES('generic_oauth', $1, now() + interval '1 minute')`,
        [stateHash],
      ),
      /duplicate key value violates unique constraint/,
      'state values must be unique',
    );
    await assert.rejects(
      () => db.adminQuery(
        `INSERT INTO auth.oauth_state(provider_id, state_hash, expires_at)
         VALUES('generic_oauth', $1, now())`,
        [hex64('oidc-state-expired')],
      ),
      /violates check constraint/,
      'a state row must expire after it is created',
    );
    await assert.rejects(
      () => db.adminQuery(
        `INSERT INTO auth.oauth_state(provider_id, state_hash, code_verifier_ciphertext, expires_at)
         VALUES('generic_oauth', $1, 'pkce-verifier-envelope', now() + interval '5 minutes')`,
        [hex64('oidc-state-nokey')],
      ),
      /violates check constraint/,
      'a PKCE ciphertext without a key version is invalid',
    );

    const expiredHash = hex64('oidc-state-old');
    await db.adminQuery(
      `INSERT INTO auth.oauth_state(provider_id, purpose, state_hash, created_at, expires_at)
       VALUES('generic_oauth', 'link', $1, now() - interval '5 minutes', now() - interval '1 minute')`,
      [expiredHash],
    );
    const expiredConsume = await db.adminQuery(
      `UPDATE auth.oauth_state SET consumed_at = now()
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id`,
      [expiredHash],
    );
    assert.equal(expiredConsume.rowCount, 0, 'an expired state must not be consumable');

    const linkRow = await db.adminQuery(
      `SELECT link_user_id, purpose FROM auth.oauth_state WHERE state_hash = $1`,
      [stateHash],
    );
    assert.deepEqual(linkRow.rows, [{link_user_id: null, purpose: 'login'}], 'linking is explicit and never automatic');
  });
});

test('AUTH-008 no connector, auto-link or client-claimed verification substrate exists', async () => {
  await withAuthDatabase(async db => {
    const columns = (
      await db.adminQuery(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'auth' ORDER BY 1, 2`,
      )
    ).rows;
    for (const forbidden of [
      'client_secret',
      'client_id',
      'discovery_url',
      'issuer_url',
      'jwks_uri',
      'auto_link',
      'link_status',
      'trusted_provider',
      'email_verified_claim',
      'provider_email_verified',
    ]) {
      const present = columns.filter(row => row.column_name === forbidden);
      assert.deepEqual(present, [], `auth schema must not store ${forbidden}`);
    }

    // The only verification authority is the canonical column, and it is not a
    // client-supplied flag: no request/claim provenance column exists beside it.
    const userColumns = columns.filter(row => row.table_name === 'users').map(row => row.column_name);
    assert.ok(userColumns.includes('email_verified'));
    assert.ok(!userColumns.some(name => /claim|client|request|trusted/i.test(name)));

    // No connector/service object was created alongside the readiness tables.
    const connectorObjects = (
      await db.adminQuery(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'auth' AND c.relkind IN ('r', 'v', 'm', 'f')
           AND c.relname ~ '(provider|connector|oidc|sso)'`,
      )
    ).rows;
    assert.deepEqual(connectorObjects, [], 'AUTH-008 creates no connector object');

    // Declared readiness remains a reference value, not an activated integration.
    const providerValues = await db.adminQuery(
      `SELECT value, description FROM auth.reference_value WHERE domain = 'account_provider' ORDER BY value`,
    );
    assert.deepEqual(providerValues.rows.map(row => row.value), ['credential', 'generic_oauth']);
    assert.match(
      providerValues.rows.find(row => row.value === 'generic_oauth').description,
      /no connector is built or enabled|readiness/i,
    );

    const grantsToCustomer = await db.adminQuery(
      `SELECT count(*)::int AS n
       FROM information_schema.routine_privileges rp
       WHERE rp.grantee = $1 AND rp.routine_schema = 'auth'`,
      [db.roles.customerApp],
    );
    assert.equal(grantsToCustomer.rows[0].n, 0, 'the customer role gains no auth routine grants');
  });
});
