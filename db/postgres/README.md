# PostgreSQL target schema — operator, auth and tenant bootstrap

This directory is the new PostgreSQL target for the controlled pivot. SQLite remains the production path until the retirement gate in `docs/pivot-notes/01-adr-postgresql-pivot.md` is satisfied. It creates constrained roles, Purpose A operator controls, the canonical `auth` identity schema and the Purpose B/C `tenant_data` table skeleton. It does **not** create RLS policies, runtime tenant grants, posted-document immutability triggers, audit triggers, `SECURITY DEFINER` operator functions, a login flow, an MFA flow or any provider connector. The `tenant_data` skeleton is not safe to serve until PIVOT-004 (RLS), PIVOT-005 (posted immutability), PIVOT-006 (audit) and AUTH-006 (tenant context) land.

## Run order

1. `db/postgres/00-roles.sql` — creates constrained NOLOGIN roles. It validates every existing target role first; incompatible pre-existing definitions cause an explicit refusal before mutation. Compatible existing roles are a no-op and are never altered. Run with the private migration/admin connection.
2. `db/postgres/10-operator-schema.sql` — creates the `operator` schema, Purpose A tables, grants, indexes and append-only triggers. The executing connection must be a member of `saven_migrator` (or a superuser). DDL objects are owned by `saven_migrator`.
3. `db/postgres/05-auth-schema.sql` — creates the canonical `auth` schema: identity, provider bindings, tenant membership, sessions, verification, two-factor, recovery codes, assurance roles, append-only auth audit and OAuth readiness. Same membership requirement and ownership rule as step 2.
4. `db/postgres/migrations/006-auth-schema-corrections.sql` — additive AUTH-001 correction applied after `05`. It adds and validates `oauth_state_pkce_key_binding_chk`; the delivered `05` bytes are never edited.
5. `db/postgres/20-tenant-schema.sql` — creates the `tenant_data` schema and its Purpose B/C tables, composite tenant keys, exact money columns, reference/rule tables and the canonical pending-document sidecars. Same migration principal and ownership rule as step 2. Rerunning it is intentionally refused: later changes are additive files under `db/postgres/migrations/`, never an in-place edit of an applied migration.
6. `db/postgres/migrations/021-tenant-schema-corrections.sql` — additive PIVOT-003 correction applied after `20` (see the tenant section below).

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

`operator.user_identity` and `operator.tenant_membership` are deliberately absent. `auth.users` and `auth.tenant_membership`, created by `05-auth-schema.sql`, are the canonical identity and admission owners. Neither the operator bootstrap nor PIVOT-003 creates a competing identity table.

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

## Purpose B/C tables (PIVOT-003)

`20-tenant-schema.sql` creates one shared `tenant_data` schema with 47 tables. Every table, including children and rule tables, carries `tenant_id uuid NOT NULL` as its leading column, leads its primary key with `tenant_id`, and scopes every foreign key, unique key and document-number key by `tenant_id` (plus the existing company/branch components where the source had them). No cross-schema foreign key is created in this file, and PIVOT-003 applies identically whether or not AUTH-001 has landed. `tenant_data.members.user_id` preserves the native text principal id; the text-to-UUID mapping and the composite `(tenant_id, …)` link to `auth.tenant_membership` are finalized in PIVOT-004. A foreign key to vendor `operator.*` is not planned for `tenant_data`: the Fully Private composition omits those tables, so the tenant UUID is validated by the operator/tenant service contract instead.

| Group | Tables |
| --- | --- |
| Identity projection, masters, periods | `business`, `members`, `roles`, `assignments`, `denials`, `accounts`, `account_profiles`, `periods` |
| Accepted commands, approval, ledger | `command_inbox`, `approval_requests`, `journals`, `journal_lines`, `audit`, `outbox`, `document_sequences`, `document_numbers`, `journal_drafts`, `command_decisions` |
| Company, inventory, evidence | `company_profiles`, `warehouses`, `stock_items`, `stock_balances`, `stock_operations`, `stock_movements`, `company_settings`, `command_files`, `inventory_controls`, `journal_corrections` |
| Trade subledger | `trade_controls`, `trade_parties`, `trade_operations`, `trade_documents`, `trade_lines`, `trade_allocations`, `trade_credits`, `trade_credit_lines` |
| Provenance and configuration | `source_store_migrations`, `reference_values`, `business_rule`, `approval_policy`, `posting_constraint`, `tax_profile`, `support_grants` |
| Audit and pending-document sidecars | `audit_event`, `document_registry`, `document_revisions`, `verified_entitlement` |

Compatibility rules applied to every table:

- Source table and column names are preserved exactly. Text ids stay `text`; an existing alpha/northstar id is never cast to `uuid`. The tenant UUID mapping remains `operator.tenant.legacy_id`.
- Native integer minor units stay `bigint` with the same bounds (`0..999999999999`, or `> 0` for document and line amounts). No `real`, `double precision` or `money` column exists anywhere.
- Native epoch-millisecond integers stay `bigint` epoch milliseconds so imported values remain comparable with the native stores. Native ISO date text (`posting_date`, `start_date`, `end_date`, `due_date`) is preserved as text.
- Native `INTEGER` 0/1 flags become `boolean`; the adapter performs that lossless mapping.
- Purpose C policy tables have no native source, so they use `timestamptz`, exact `numeric` decimals and a JSON-schema version column.
- PIVOT-003-R1 restores the native stock valuation invariant on `tenant_data.stock_balances`: `CHECK (quantity > 0 OR value = 0)`, added as the validated named constraint `stock_balances_quantity_value_chk`, so an empty balance can never retain owned stock value. Native parity is preserved rather than deferred to PIVOT-005/013.
- `tenant_data.tax_profile.tax_type` defaults to the canonical seeded `SALES_TAX` value; a default must always resolve to its reference domain instead of an unseeded label.
- Configurable rule data stays inert. `posting_constraint.rule_jsonb.severity` is governed by the `posting_constraint_severity` reference domain (effective-dated `tenant_data.reference_values` rows, interpreted only by the registered handler named in `handler_key`); it is not a JSON-schema enum, and a new value can never install executable policy.
- Growing domains (command state, document type/status, party kind, origin type, action type, ...) are **not** `CHECK` lists. They are declared reference domains annotated inline as `reference domain: <name>` and seeded canonically in `contracts/postgres-business-rules-v1.json`. A new value is a `tenant_data.reference_values` row, not a migration. Only structural/accounting invariants (money bounds, debit/credit exclusivity, positive amounts, one protected ultimate-owner role, one ultimate-owner assignment) are enforced by `CHECK`/unique constraints.
- `tenant_data.document_registry` and `tenant_data.document_revisions` are the canonical pending-document sidecars. AI-origin documents are ordinary documents whose status is `PENDING_APPROVAL` with origin metadata; there is no `ai_proposal` table. Accepted command bytes in `command_inbox` stay immutable and are never rewritten by a pending edit.

Explicitly deferred, and absent from this file: RLS enable/force and policies (PIVOT-004), posted-source immutability triggers (PIVOT-005), business audit triggers (PIVOT-006), runtime grants, tenant context (AUTH-006) and the posting kernel (PIVOT-013). Additive corrections land as `db/postgres/migrations/*.sql` after their base file; this directory currently carries `006-auth-schema-corrections.sql` and `021-tenant-schema-corrections.sql`.

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
- `tenant_data` is default-deny in this skeleton: PUBLIC, customer, auth and every operator role have no schema, table or sequence privilege. Granting tenant access before PIVOT-004 policies exist would expose every tenant's rows, so grants and policies must land together. RLS is also not a substitute for company/branch/resource/approval enforcement.
- No credentials, DSNs, superuser grants or BYPASSRLS grants are present.
- `auth` is default-deny for customer and operator roles. The auth service writes identity/session state only; it is not a tenant-data reader, and AUTH-002/006 must prove server-verified selection before any business request.
- Sessions, verification challenges, recovery codes and OAuth state are digest-only; TOTP seeds, provider tokens and PKCE verifiers are ciphertext with a versioned key. The absolute session ceiling is immutable by trigger.

## Extension points

- Add operator domains as `operator.reference_value` rows with `is_active` and effective dates; do not add a growing CHECK list. The bootstrap seeds and declares these domains but does not enforce FK/reference lookups, effective-dated policy or JSON schemas. Application validation and activation are deferred and explicitly non-authoritative here.
- Store versioned operator configuration in `value_jsonb`/`claims_jsonb` with a documented schema version. `feature_flag.value_schema_version` and `entitlement.claims_schema_version` bind the intended shape, but JSON-schema validation is deferred.
- Add future operator tables with explicit grants to the read/admin/definer roles and an explicit append-only/truncate decision where mutation is prohibited.
- PIVOT-003 adds the tenant business/rule table skeleton (no RLS, no grants); PIVOT-004 adds forced RLS, policies, policies-scoped grants and the deferred auth cross-schema keys; PIVOT-005/006 add posted-source immutability and business audit; PIVOT-007 adds audited `SECURITY DEFINER` operator functions owned by `saven_operator_definer`; PIVOT-008 adds RLS coverage; AUTH-001..010 add the canonical auth schema.
- Tenant reference data: add domains and values as `tenant_data.reference_values` rows with `is_active`/effective dates and a `value_schema_version`; keep the seed list in `contracts/postgres-business-rules-v1.json` current. Do not add a growing `CHECK` list, and never let a reference row install posting/authorization logic — that requires a registered typed handler plus tests.
- Tenant policy: add a new `version` row in `business_rule`/`approval_policy`/`posting_constraint`/`tax_profile` instead of mutating a used row, and validate `*_jsonb` against the versioned JSON schema named in `contracts/postgres-business-rules-v1.json`. Nested configured values such as `posting_constraint.rule_jsonb.severity` resolve through their named reference domain; they are never inlined as JSON-schema enums.
- Stock valuation: the native `quantity > 0 OR value = 0` relationship is enforced by a named validated constraint. Weakening or moving it requires an ADR and the posting/handler work, not a silent schema edit.
- Pending documents: extend `document_type`/`document_status`/`origin_type` reference values, not a table per document type. `document_registry` plus append-only `document_revisions` is the canonical path for both human and AI-origin pending work; accepted command bytes are never rewritten.
- Auth domains grow as `auth.reference_value` rows (assurance levels, statuses, purposes, algorithms, audit event types) and assurance classes as `auth.roles` rows; business/ERP roles and the protected ultimate-owner definition stay in `tenant_data`. Adding a connector, factor type or provider requires its own contract and adapter work.
- Recoverable auth secrets follow one convention: ciphertext, algorithm and key version together. A ciphertext without a non-null positive key version is invalid by constraint.
- Fully Private omits vendor operator tables and the vendor issuer; the same customer/auth/tenant contracts remain.

## Local gate fixture

`tests/helpers/pg-pivot-fixture.mjs` creates only `saven_pivot_<suffix>_*` cluster roles and a `saven_pivot_<suffix>` disposable database on a loopback PostgreSQL cluster. It requires `SAVEN_PIVOT_TEST_CLUSTER=1` as an explicit dedicated-cluster opt-in, rejects non-loopback hosts and SAVEN target-role credentials, and never falls back to an owner/shared cluster. A pre-flight check refuses before any mutation if any generated role or database already exists, so pre-existing cluster roles, memberships and grants remain untouched. It applies the checked-in `00-roles.sql` (rewritten only into the disposable namespace) for target-role creation, then creates separate ephemeral runtime logins for customer, auth service, operator read and operator admin plus a discrete migration login. Each runtime login is granted only its own target role; the migration login is the only principal granted `saven_migrator`. Cleanup drops only the objects it created and reports cleanup failures alongside the original run/test failure.

`tests/helpers/pg-auth-fixture.mjs` is the auth sibling: it creates only `saven_auth_<suffix>_*` cluster roles and a `saven_auth_<suffix>` disposable database, applies `00-roles.sql` then `10-operator-schema.sql`, `05-auth-schema.sql` and `migrations/006-auth-schema-corrections.sql` in that order, and removes everything it created. It requires `SAVEN_AUTH_TEST_CLUSTER=1` (or the established `SAVEN_PIVOT_TEST_CLUSTER=1` dedicated-cluster opt-in), rejects non-loopback hosts and SAVEN target-role credentials, refuses before mutation if any generated object already exists, and aggregates cleanup failures with the primary failure. Its contract test is `tests/auth-001-schema.test.mjs`.

The PIVOT-002 test exercises the checked-in role bootstrap for fresh creation and compatible no-op re-entry, and separately proves that an incompatible pre-existing target role causes an atomic refusal with unchanged role attributes and memberships. It also asserts actual object ownership, runtime inability to assume migrator/definer roles, and denied runtime `ALTER`/`DROP` behavior. The production role/bootstrap SQL remains the source for deployment; the fixture never substitutes handwritten target-role creation.

The PIVOT-003 test does not modify the fixture. It passes `sqlFiles: ['db/postgres/10-operator-schema.sql', 'db/postgres/20-tenant-schema.sql']` to the existing fixture and then asserts: 47 `tenant_data` tables with `tenant_id uuid NOT NULL` as the leading primary-key column; migrator ownership; RLS and triggers still absent; no floating/money column; no `ai_proposal` or duplicated identity table; customer and operator roles denied schema access; exact money bounds and debit/credit exclusivity; cross-tenant foreign keys rejected for accounts, commands, parties and document revisions; scoped document numbering; at most one protected ultimate-owner role and at most one owner assignment (existence of exactly one active owner is not enforced by this skeleton); `ai_origin_direct_post_allowed = false` and `editable_in_pending = true` defaults; rejection of a duplicate policy-version key (key uniqueness only — existing versions are not yet immutable); the restored empty-stock valuation constraint on INSERT and UPDATE; the validated `SALES_TAX` default resolving against the canonical seed; and the absence of configurable JSON-schema enums.

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

The contract tests are `tests/pivot-002-operator.test.mjs`, `tests/auth-001-schema.test.mjs` and `tests/pivot-003-schema.test.mjs`; the full Node suite is `node --test tests/*.test.mjs`. Gates require Node `>=24.13 <25` (`.nvmrc`).
