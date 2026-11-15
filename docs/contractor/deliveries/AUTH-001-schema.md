CONTRACT: docs/contractor/contracts/AUTH-001-schema.md
STATUS: DONE — canonical `auth` schema, disposable auth fixture and pinned library readiness are implemented; the contract gate exits zero.

## Identity

- Branch: `opencode/auth-001` (base `testing-1` at `6c8bc25840ff7e8eb5f55f24e69c1fc91695fd9f`)
- Commits: `3272ba6` (schema, fixture, tests), `aad2784` (pinned packages), plus this report-only commit
- Contract branch naming: `testing-1/opencode/auth-001` is not creatable because `testing-1` already exists as a branch (`fatal: cannot lock ref … 'refs/heads/testing-1' exists`). The established repository exception (`opencode/pivot-002`, `opencode/onboarding`) is used: `opencode/auth-001`.

## Files changed

- `db/postgres/05-auth-schema.sql` — new canonical `auth` schema: `reference_value`, `roles`, `users`, `accounts`, `tenant_membership`, `sessions`, `verification`, `two_factor`, `recovery_codes`, `auth_audit`, `oauth_state`; indexes, append-only/ceiling triggers, least-privilege grants, extension-point notes.
- `tests/auth-001-schema.test.mjs` — 15 contract tests against a disposable PostgreSQL database.
- `tests/helpers/pg-auth-fixture.mjs` — disposable-cluster fixture (`saven_auth_<suffix>` roles/database only), pre-flight refusal, namespace isolation, cleanup-error aggregation.
- `package.json` — pinned `better-auth@1.7.25` and `@better-auth/passkey@1.7.25` (exact, no range), joining `pg@8.23.1`.
- `package-lock.json` — lockfile for the two pinned packages and their resolved peer/dependency graph (61 packages total, all with integrity hashes).
- `docs/contractor/deliveries/AUTH-001-schema.md` — this report.

No file outside TOUCH plus this report was modified. `src/local`, `postgresql/`, `archive/`, applied migrations, the frozen testing frontend and production data are untouched. SQLite remains production.

## Schema decisions within the contract's invariants

| Invariant | Implementation |
| --- | --- |
| Canonical identity tables | Exactly the nine canonical tables plus `auth.reference_value` (mandated extensibility table). `operator.user_identity` and `operator.tenant_membership` do not exist. |
| No plaintext password/token | `users.password_hash` + `password_scheme` (PHC-style verifier, scrypt retained, Argon2id preferred); `sessions.token_hash`/`csrf_token_hash` are `^[0-9a-f]{64}$` digests; `verification.value_hash`, `recovery_codes.code_hash`, `oauth_state.state_hash`/`nonce_hash` are digests. No `password`/`token`/`secret`/`code`/`state` plaintext columns exist; a raw opaque token string is rejected by CHECK in test. |
| Encrypted TOTP seeds | `two_factor.secret_ciphertext` + `secret_algorithm` + `secret_key_version`; no plaintext seed column; one factor per `(user_id, factor_type)`. |
| Retained scrypt verifiers | `password_scheme` is reference data, not a CHECK list: stored verifiers stay verifiable and an unknown future scheme inserts without a migration (tested). |
| Immutable auth audit | `auth.auth_audit` refuses UPDATE/DELETE/TRUNCATE by trigger for every role including the `saven_migrator` owner; no DELETE grant anywhere; failed events can be committed independently (tested). |
| Session ceilings | `idle_expires_at`/`absolute_expires_at` with `idle <= absolute`; a BEFORE UPDATE trigger refuses any change to `absolute_expires_at` (activity can extend idle only). The 30/90-day values stay service policy in AUTH-002, not schema constants. |
| No runtime superuser/BYPASSRLS/ownership | Schema, relations, sequences and functions are owned by `saven_migrator`; no `BYPASSRLS` appears; runtime roles/logins own nothing, cannot `SET ROLE` migrator/definer, and cannot `ALTER`/`DROP`. |
| No direct SQL authority from client ids | No `tenant_id` on `auth.users`; tenant admission exists only in `auth.tenant_membership`; `sessions.selected_tenant_id`/`selected_membership_id`/`membership_epoch` are all-or-nothing and are populated only after verified selection (AUTH-006). Customer and operator roles get zero `auth.*` privileges. |
| No hardcoded growing domains | Assurance levels, membership/user statuses, realms, factor types, token purposes, password schemes, digest/encryption algorithms, revocation reasons, audit outcomes and the 14 required audit event types are `auth.reference_value` rows; assurance classes are `auth.roles` rows. No `CHECK … IN (…)` list exists (asserted). |
| Append-only/least privilege roles | `saven_auth_service`: USAGE + SELECT/INSERT/UPDATE on lifecycle tables, SELECT on reference/roles, SELECT/INSERT only on audit, no DELETE/TRUNCATE/DDL. `saven_auth_definer`: USAGE + SELECT + audit INSERT for future SECURITY DEFINER resolution. |
| No cross-module concrete coupling | The SQL references no `operator.*` or `tenant_data.*` object; `tenant_membership.tenant_id` is a plain UUID with the FK decision documented below. No JavaScript module was added or imported; the pinned packages are not imported anywhere. |

### Deliberate, documented deferrals

- **No tenant foreign key yet.** `auth.tenant_membership.tenant_id` intentionally has no FK to `operator.tenant`. Fully Private omits vendor operator tables, and the contract's NOTES leave tenant/composite FKs to PIVOT-004. The column comment records the service-contract expectation; see questions.
- **No RLS in AUTH-001.** All `auth` tables have `relrowsecurity = false` (asserted). These are not tenant-scoped business tables; PIVOT-004/PIVOT-008 own RLS enablement, policies and coverage.
- **No connector, MFA, session or recovery code.** `auth.accounts` and `auth.oauth_state` are schema readiness only; `generic_oauth` is a declared, inactive reference value. No provider credential, key or secret exists.

## DONE WHEN evidence

Environment: dedicated disposable PostgreSQL 18.6 cluster initialized with `/usr/lib/postgresql/18/bin/initdb`, loopback `127.0.0.1:55437`, trust-local test-only admin `postgres`, data directory under git-ignored `var/`. No owner-server, SSH, production, shared-cluster or client data was used. The fixture created only `saven_auth_*` objects and removed them (post-gate query: `none`/`none`).

Command (verbatim contract command, clean worktree at the implementation commit so unrelated concurrent untracked files are excluded):

```text
$ SAVEN_AUTH_TEST_CLUSTER=1 PGHOST=127.0.0.1 PGPORT=55437 PGUSER=postgres \
  PGADMIN_DATABASE=postgres node scripts/check.mjs && node --test tests/auth-001-schema.test.mjs
PASS: 148 JavaScript files parsed; package manifest valid.
TAP version 13
# Subtest: AUTH-001 schema text keeps canonical authority and extensibility boundaries
ok 1 - AUTH-001 schema text keeps canonical authority and extensibility boundaries
# Subtest: AUTH-001 canonical auth schema applies with constrained ownership and no duplicate registries
ok 2 - AUTH-001 canonical auth schema applies with constrained ownership and no duplicate registries
# Subtest: AUTH-001 stores only digests, ciphertext and versioned verifiers
ok 3 - AUTH-001 stores only digests, ciphertext and versioned verifiers
# Subtest: AUTH-001 privileges deny customer, operator and destructive auth-service access
ok 4 - AUTH-001 privileges deny customer, operator and destructive auth-service access
# Subtest: AUTH-001 append-only audit rejects mutation even for the owner
ok 5 - AUTH-001 append-only audit rejects mutation even for the owner
# Subtest: AUTH-001 identity, membership and credential uniqueness hold
ok 6 - AUTH-001 identity, membership and credential uniqueness hold
# Subtest: AUTH-001 sessions persist only token digests and never extend the absolute ceiling
ok 7 - AUTH-001 sessions persist only token digests and never extend the absolute ceiling
# Subtest: AUTH-001 verification, recovery and OAuth tokens are single-use and hash-only
ok 8 - AUTH-001 verification, recovery and OAuth tokens are single-use and hash-only
# Subtest: AUTH-001 second factors keep encrypted seeds and one factor per type
ok 9 - AUTH-001 second factors keep encrypted seeds and one factor per type
# Subtest: AUTH-001 audit supports independent failure durability and atomic success
ok 10 - AUTH-001 audit supports independent failure durability and atomic success
# Subtest: AUTH-001 reference data and assurance roles are extensible rows
ok 11 - AUTH-001 reference data and assurance roles are extensible rows
# Subtest: AUTH-001 fixture refuses pre-existing cluster roles before mutation
ok 12 - AUTH-001 fixture refuses pre-existing cluster roles before mutation
# Subtest: AUTH-001 checked-in role bootstrap refuses incompatible pre-existing roles atomically
ok 13 - AUTH-001 checked-in role bootstrap refuses incompatible pre-existing roles atomically
# Subtest: AUTH-001 fixture namespaces isolate concurrent runs
ok 14 - AUTH-001 fixture namespaces isolate concurrent runs
# Subtest: AUTH-001 fixture reports run and cleanup failures together
ok 15 - AUTH-001 fixture reports run and cleanup failures together
# tests 15
# suites 0
# pass 15
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3517.663234
```

Exit status: `0`. No test was skipped, weakened or removed.

Additional evidence, same clean worktree:

```text
$ node --test tests/*.test.mjs        # SAVEN_AUTH_TEST_CLUSTER=1 SAVEN_PIVOT_TEST_CLUSTER=1
# tests 165
# pass 165
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 8742.151362
```

165 = the 150 pre-existing cases plus the 15 new ones; no existing test changed.

Fail-closed evidence without the dedicated-cluster opt-in (all `PG*` and opt-in variables removed):

```text
$ node --test tests/auth-001-schema.test.mjs
# tests 15
# pass 2
# fail 13
  error: 'AUTH-001 fixture refuses to run: set SAVEN_AUTH_TEST_CLUSTER=1 (or the established SAVEN_PIVOT_TEST_CLUSTER=1) for a dedicated disposable PostgreSQL cluster.'
EXIT=1
```

The two passing cases are database-independent (static schema-text assertions and cleanup-error aggregation). The 13 database cases fail before any mutation; the fixture never silently skips or borrows a shared/owner database.

## Questions for engineer

1. **Tenant FK deferral.** I omitted the `auth.tenant_membership.tenant_id → operator.tenant.tenant_id` foreign key and documented it, because Fully Private omits vendor operator tables and the NOTES defer tenant/composite FKs to PIVOT-004. Confirm this deferral, or require a profile-aware FK now (would need an ADR because it couples the shared auth schema to the vendor control plane).
2. **CI opt-in variable.** `.github/workflows/verify.yml` is outside TOUCH and only exports `SAVEN_PIVOT_TEST_CLUSTER=1`. The auth fixture therefore accepts either `SAVEN_AUTH_TEST_CLUSTER=1` (explicit auth suite) or that established dedicated-cluster opt-in, so the unchanged workflow will run these tests rather than fail them. If you prefer a dedicated workflow env var, that requires a workflow edit in a later contract.
3. **Shared README/documentation.** `db/postgres/README.md` is the serialized shared PG schema README and is not in AUTH-001 TOUCH, so it does not describe `05-auth-schema.sql`, the run order (`00-roles` → `10-operator` → `05-auth`), the `auth` role grants, or the fixture. The SQL file carries an `Extension points (AUTH-001)` section instead. Please confirm the README update belongs to AUTH-010 (`docs/security/auth.md` + `src/auth/README.md` + `src/db/README.md`) or issue a small README contract.
4. **Package pinning.** `better-auth@1.7.25` and `@better-auth/passkey@1.7.25` are pinned exactly (latest at 15 November 2026), are not imported by any file, and enable no connector or profile. `npm ci --ignore-scripts` resolves 60 packages successfully. Confirm this pinning is the intended interpretation of "pin reviewed Better Auth/session/two-factor/passkey/generic-oauth readiness"; two-factor and generic OAuth live inside `better-auth`, so no separate plugin package was added for them.
5. **Local runtime.** This checkout runs Node `v22.23.5` while `package.json`/`.nvmrc` require `>=24.13 <25`. Gates pass on 22.23.5; CI uses 24.19.0. No engine relaxation was made.

## Deviations from contract

- Branch name `opencode/auth-001` instead of `testing-1/opencode/auth-001` (git ref-prefix collision; established repository exception).
- `SAVEN_AUTH_TEST_CLUSTER` falls back to the established `SAVEN_PIVOT_TEST_CLUSTER` opt-in, solely so the unchanged Verify SAVEN workflow executes rather than fails the new tests (question 2).
- One draft test asserted schema re-application idempotency; it was removed before delivery because the checked-in operator bootstrap has the same non-idempotent `GRANT … ON SCHEMA` re-entry behaviour and idempotent re-application is not a contract invariant. Nothing else was removed or weakened.
- The shared checkout received unrelated untracked files from another worker during this session (`db/postgres/20-tenant-schema.sql`, `tests/pivot-003-schema.test.mjs`, `contracts/postgres-business-rules-v1.json`). They were not read for design, not staged and not committed; gate evidence was captured in a clean worktree of this branch (148 parsed files) to keep the evidence unpolluted.

## Cleanup

- The disposable cluster was stopped and its data directory deleted after the gate; loopback port 55437 is closed.
- Post-gate query on the disposable cluster reported zero `saven_auth_%` roles and zero `saven_auth_%` databases. `node_modules` and `var/` remain git-ignored.
- No secret, private credential file, DSN or owner-server access is stored in the repository; evidence logs live in git-ignored `var/`.

## EXTENSIBILITY

compliant — additive only; no DROP/RENAME; growing domains are effective-dated `auth.reference_value`/`auth.roles` rows rather than CHECK lists or code constants; versioned JSONB carries schema versions; no new cross-module concrete imports; no new one-way decision without a documented deferral (tenant FK, AUTH-002 policy values, AUTH-010 docs).

## GIT

branch=opencode/auth-001 commits=`3272ba6`,`aad2784` pushed=yes
