# PostgreSQL target schema — operator and auth bootstrap

This directory is the new PostgreSQL target for the controlled pivot. SQLite remains the production path until the retirement gate in `docs/pivot-notes/01-adr-postgresql-pivot.md` is satisfied. It currently contains the constrained role bootstrap, the Purpose A `operator` control plane and the canonical `auth` identity schema. It does not yet create tenant business tables, RLS policies, posted-document triggers, `SECURITY DEFINER` operator functions, a login flow, an MFA flow or any provider connector.

## Run order

1. `db/postgres/00-roles.sql` — creates constrained NOLOGIN roles. It validates every existing target role first; incompatible pre-existing definitions cause an explicit refusal before mutation. Compatible existing roles are a no-op and are never altered. Run with the private migration/admin connection.
2. `db/postgres/10-operator-schema.sql` — creates the `operator` schema, Purpose A tables, grants, indexes and append-only triggers. The executing connection must be a member of `saven_migrator` (or a superuser). DDL objects are owned by `saven_migrator`.
3. `db/postgres/05-auth-schema.sql` — creates the canonical `auth` schema: identity, provider bindings, tenant membership, sessions, verification, two-factor, recovery codes, assurance roles, append-only auth audit and OAuth readiness. Same membership requirement; DDL objects are owned by `saven_migrator`.
4. `db/postgres/migrations/006-auth-schema-corrections.sql` — additive AUTH-001 correction applied after `05`. It adds the named `oauth_state_pkce_key_binding_chk` constraint and validates it; the delivered `05` bytes are never edited.

Migrations under `db/postgres/migrations/` are additive corrections applied after their base file, in numeric order, with the same principal. They never rewrite a delivered base SQL file, and they validate existing data instead of repairing it.

No password, connection string, DSN or login principal is stored in these SQL files. Runtime services authenticate separately and use `SET ROLE` only after their own server-side authorization checks. Runtime logins must be separate from the offline migration login; only that migration principal may assume `saven_migrator`.

## Roles

| Role | Login | Intended authority |
| --- | --- | --- |
| `saven_customer_app` | No | Tenant application work; zero `operator.*` privileges and no table ownership. |
| `saven_auth_service` | No | Narrow shared-auth service boundary; no `operator.*` privileges. |
| `saven_operator_read` | No | Read-only operator application access to `operator.*`; no DDL or tenant-data access. |
| `saven_operator_admin` | No | Operator operational writes; no DDL; issued entitlements are insert-only and append-only ledgers remain append-only. |
| `saven_migrator` | No | Offline DDL role; owns the operator schema and bootstrap objects; no superuser or BYPASSRLS. |
| `saven_operator_definer` | No | Non-login owner intended for future audited operator `SECURITY DEFINER` functions. |
| `saven_auth_definer` | No | Non-login owner intended for future auth `SECURITY DEFINER` functions. |

All SAVEN target roles are `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOBYPASSRLS` and `NOREPLICATION`. A deployment login principal is created and granted membership separately by the deployment administrator. Runtime principals (customer, auth service, operator read and operator admin) must not be members of `saven_migrator`, `saven_operator_definer` or `saven_auth_definer`, directly or transitively. Only the discrete offline migration principal may assume `saven_migrator`.

## Purpose A tables

| Table | Source / purpose | Notes |
| --- | --- | --- |
| `operator.tenant` | Canonical subscriber directory from native `commerce.subscriber_accounts` | UUID primary key; `legacy_id` preserves the original text tenant id uniquely; status/plan are reference values. |
| `operator.entitlement` | Versioned entitlement claims from native `commerce.entitlements` | Issued rows are immutable; renewals/corrections supersede with a new version. `claims_jsonb` is versioned JSON; `writes_until` preserves the native epoch-millisecond boundary. |
| `operator.operator_audit` | Operator audit from native `commerce.commercial_audit` | Append-only trigger; `target_tenant_id` is intentionally not a foreign key so failed attempts remain auditable. |
| `operator.feature_flag` | New operator control | Null `tenant_scope` is global; `enabled` defaults false; unique with `NULLS NOT DISTINCT`. |
| `operator.tenant_placement` | Native `fleet.placements` | One row per tenant; `generation` is the writable-owner fence. |
| `operator.jobs` | Native `jobs.jobs` | Operational control-plane state, not financial authority or a tenant inbox. |
| `operator.ai_requests` | Native `jobs.ai_requests` | Redacted usage/reservation metadata only; no prompt or document body. |
| `operator.migration_events` | Native `fleet.migration_events` | Append-only per-tenant migration history. |
| `operator.source_store_migrations` | New provenance ledger | Preserves native store/version/checksum/applied time; append-only. |
| `operator.pg_schema_migrations` | New PostgreSQL ledger | Separate from native source-store checksums; append-only. |
| `operator.reference_value` | Extensibility extension | Seeded operator reference domains and labels; effective dates are declared data for future policy, not a database-enforced lookup or policy engine. |

`operator.user_identity` and `operator.tenant_membership` are deliberately absent. `auth.users` and `auth.tenant_membership`, created by `05-auth-schema.sql`, are the canonical identity and admission owners.

## Auth identity schema (AUTH-001)

`auth` is the canonical identity and authentication authority for both profiles; Fully Private keeps this schema rather than a vendor-only variant. It is schema-only: no login route, session service, MFA flow, recovery flow, provider connector or OIDC exchange exists yet, and no installed library is activated by these tables.

| Table | Purpose |
| --- | --- |
| `auth.users` | Canonical identity. `legacy_id` preserves the original native text id uniquely; `password_hash` stores only an opaque PHC verifier with `password_scheme` (retained scrypt, preferred Argon2id); `credential_version` invalidates older sessions. |
| `auth.accounts` | Unique `(provider_id, account_id)` provider binding. Provider tokens exist only as ciphertext bound to a key version. Passkey activation requires its own plugin schema and is not present. |
| `auth.tenant_membership` | Sole tenant admission authority: `tenant_id`, `user_id`, `role_id`, `status`, `membership_epoch`, invitation/acceptance timestamps. |
| `auth.sessions` | Server-side sessions. Only SHA-256 hex digests of opaque tokens are stored; idle and absolute expiry with an immutable absolute ceiling. |
| `auth.verification` | Expiring, single-use email-verification/password-reset challenges stored as digests; consumption is one conditional `UPDATE`. |
| `auth.two_factor` | TOTP factors with an encrypted recoverable seed, algorithm and key version; `last_used_step` records replay refusal. |
| `auth.recovery_codes` | One-way hashed, atomically single-use MFA recovery codes. |
| `auth.auth_audit` | Append-only authentication event history; `UPDATE`, `DELETE` and `TRUNCATE` are refused for every role including the owner. |
| `auth.oauth_state` | Expiring, single-use OAuth state/nonce/PKCE readiness; no provider is configured or contacted. |
| `auth.roles`, `auth.reference_value` | Authentication-assurance classes and effective-dated auth domains as data, not code constants. |

Auth boundaries:

- `auth.tenant_membership` is tenant-scoped. AUTH-001 ships no RLS, but forced membership isolation and per-table isolation policies remain mandatory in PIVOT-004/PIVOT-008; nothing here exempts membership from that gate.
- There is no foreign key from `auth.tenant_membership.tenant_id` to `operator.tenant`: Fully Private omits vendor operator tables. PIVOT-004 adds the stored tenant-member UUID projection and the exact UUID/text/membership constraints.
- Customer and operator roles have zero `auth.*` privileges. `saven_auth_service` holds lifecycle `SELECT, INSERT, UPDATE` and audit `SELECT, INSERT` only — no `DELETE`, `TRUNCATE` or DDL. `saven_auth_definer` is read-only plus audit `INSERT`.
- Passwords, session tokens, verification tokens, recovery codes and OAuth state are never stored in plaintext; recoverable secrets (TOTP seeds, provider tokens, PKCE verifiers) are ciphertext with an algorithm and key version.
- The additive correction `006-auth-schema-corrections.sql` closes the nullable PKCE key binding: a ciphertext now requires a non-null positive key version, and validation refuses invalid pre-existing rows rather than repairing them.

## Security and boundaries

- The `operator` schema is cross-tenant by design and has no tenant RLS. Customer and auth roles have no schema, table, sequence or function privileges on it.
- `saven_operator_read` has `SELECT` on the current operator tables. New operator tables require an explicit grant.
- `saven_operator_admin` can insert/update operational records. It has `SELECT, INSERT` only on `operator.entitlement`; it cannot mutate or truncate issued entitlement rows, and it cannot update or delete the append-only audit/provenance ledgers.
- Append-only tables and issued entitlements reject every `UPDATE`, `DELETE` and `TRUNCATE` with `OPERATOR_RECORD_IMMUTABLE`, including for the migration owner. `TRUNCATE` is refused by statement-level triggers because it does not fire row `DELETE` triggers.
- The actual `00-roles.sql` bootstrap never runs `ALTER ROLE`. It validates all seven target definitions and refuses incompatible pre-existing roles before creating anything; compatible reruns are a no-op and preserve existing memberships and grants. Roles outside the seven target names are untouched.
- Runtime logins are separate from the offline migration login and have no direct or transitive membership in `saven_migrator`, `saven_operator_definer` or `saven_auth_definer`. Tests assert this, assert actual schema/table/index/sequence/function ownership, and exercise denied `SET ROLE`, `ALTER` and `DROP` through runtime connections.
- Migration and source-provenance ledgers are separate. Native SQLite migration checksums are not asserted to be PostgreSQL SQL checksums.
- Reference values are seeded/declared, not enforced by foreign keys or triggers. Effective-dated policy, JSON-schema validation and financial entitlement activation are deferred and must not be described as implemented.
- Object ownership can alter or drop these guards. Ownership is an operational trust boundary, not tamper-proof audit storage.
- No credentials, DSNs, superuser grants or BYPASSRLS grants are present.

## Extension points

- Add operator domains as `operator.reference_value` rows with `is_active` and effective dates; do not add a growing CHECK list. The bootstrap seeds and declares these domains but does not enforce FK/reference lookups, effective-dated policy or JSON schemas. Application validation and activation are deferred and explicitly non-authoritative here.
- Store versioned operator configuration in `value_jsonb`/`claims_jsonb` with a documented schema version. `feature_flag.value_schema_version` and `entitlement.claims_schema_version` bind the intended shape, but JSON-schema validation is deferred.
- Add future operator tables with explicit grants to the read/admin/definer roles and an explicit append-only/truncate decision where mutation is prohibited.
- PIVOT-003/004 add tenant business/rule tables and forced RLS; PIVOT-005/006 add posted-source immutability and business audit; PIVOT-007 adds audited `SECURITY DEFINER` operator functions owned by `saven_operator_definer`; PIVOT-008 adds RLS coverage; AUTH-001..010 add the canonical auth schema.
- Auth domains grow as `auth.reference_value` rows (assurance levels, statuses, purposes, algorithms, audit event types) and assurance classes as `auth.roles` rows; business/ERP roles and the protected ultimate-owner definition stay in `tenant_data`. Adding a connector, factor type or provider still requires its own contract and adapter work.
- Recoverable secrets follow one convention: ciphertext, algorithm and key version together. A ciphertext without a non-null positive key version is invalid by constraint.
- Fully Private omits vendor operator tables and the vendor issuer; the same customer/auth/tenant contracts remain.

## Local gate fixture

`tests/helpers/pg-pivot-fixture.mjs` creates only `saven_pivot_<suffix>_*` cluster roles and a `saven_pivot_<suffix>` disposable database on a loopback PostgreSQL cluster. It requires `SAVEN_PIVOT_TEST_CLUSTER=1` as an explicit dedicated-cluster opt-in, rejects non-loopback hosts and SAVEN target-role credentials, and never falls back to an owner/shared cluster. A pre-flight check refuses before any mutation if any generated role or database already exists, so pre-existing cluster roles, memberships and grants remain untouched. It applies the checked-in `00-roles.sql` (rewritten only into the disposable namespace) for target-role creation, then creates separate ephemeral runtime logins for customer, auth service, operator read and operator admin plus a discrete migration login. Each runtime login is granted only its own target role; the migration login is the only principal granted `saven_migrator`. Cleanup drops only the objects it created and reports cleanup failures alongside the original run/test failure.

`tests/helpers/pg-auth-fixture.mjs` is the auth sibling: it creates only `saven_auth_<suffix>_*` cluster roles and a `saven_auth_<suffix>` disposable database, applies `00-roles.sql` then `10-operator-schema.sql`, `05-auth-schema.sql` and `migrations/006-auth-schema-corrections.sql` in that order, and removes everything it created. It requires `SAVEN_AUTH_TEST_CLUSTER=1` (or the established `SAVEN_PIVOT_TEST_CLUSTER=1` dedicated-cluster opt-in), rejects non-loopback hosts and SAVEN target-role credentials, refuses before mutation if any generated object already exists, and aggregates cleanup failures with the primary failure. Its contract test is `tests/auth-001-schema.test.mjs`.

The test exercises the checked-in bootstrap for fresh creation and compatible no-op re-entry, and separately proves that an incompatible pre-existing target role causes an atomic refusal with unchanged role attributes and memberships. It also asserts actual object ownership, runtime inability to assume migrator/definer roles, and denied runtime `ALTER`/`DROP` behavior. The production role/bootstrap SQL remains the source for deployment; the fixture never substitutes handwritten target-role creation.

`node scripts/check.mjs` — and therefore `npm run check` and `npm run build` — is a database-independent parser/build check. It parses every JavaScript file under `src`, `scripts`, `tests`, `public` and `reference`, then validates `package.json`; it does not connect to PostgreSQL and needs no database environment.

The explicit PostgreSQL tests are separate and mandatory. The PIVOT-002 fixture fails clearly before any mutation when `SAVEN_PIVOT_TEST_CLUSTER=1` is absent and never silently skips or borrows a shared/owner database. The `Verify SAVEN` workflow supplies the disposable PostgreSQL service environment to `node --test tests/*.test.mjs` and the later verifier steps.

Run the explicit tests only against a dedicated disposable local/CI cluster with the following environment:

```text
SAVEN_AUTH_TEST_CLUSTER=1   # or the established SAVEN_PIVOT_TEST_CLUSTER=1
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=<administrative test role>
PGPASSWORD=<private test-only credential>
PGADMIN_DATABASE=postgres
```

The contract tests are `tests/pivot-002-operator.test.mjs` and `tests/auth-001-schema.test.mjs`; the full Node suite is `node --test tests/*.test.mjs`. Gates require Node `>=24.13 <25` (`.nvmrc`).
