# PostgreSQL target schema — PIVOT-002 bootstrap

This directory is the new PostgreSQL target for the controlled pivot. SQLite remains the production path until the retirement gate in `docs/pivot-notes/01-adr-postgresql-pivot.md` is satisfied. This bootstrap creates only Purpose A operator controls and constrained roles; it does not create tenant business tables, RLS policies, posted-document triggers, SECURITY DEFINER operator functions or auth tables.

## Run order

1. `db/postgres/00-roles.sql` — creates constrained NOLOGIN roles. Run with the private migration/admin connection.
2. `db/postgres/10-operator-schema.sql` — creates the `operator` schema, Purpose A tables, grants, indexes and append-only triggers. The executing connection must be a member of `saven_migrator` (or a superuser). DDL objects are owned by `saven_migrator`.

No password, connection string, DSN or login principal is stored in these SQL files. Runtime services authenticate separately and use `SET ROLE` only after their own server-side authorization checks.

## Roles

| Role | Login | Intended authority |
| --- | --- | --- |
| `saven_customer_app` | No | Tenant application work; zero `operator.*` privileges and no table ownership. |
| `saven_auth_service` | No | Narrow shared-auth service boundary; no `operator.*` privileges. |
| `saven_operator_read` | No | Read-only operator application access to `operator.*`; no DDL or tenant-data access. |
| `saven_operator_admin` | No | Operator operational writes; no DDL; append-only ledgers remain append-only. |
| `saven_migrator` | No | Offline DDL role; owns the operator schema and bootstrap objects; no superuser or BYPASSRLS. |
| `saven_operator_definer` | No | Non-login owner intended for future audited operator `SECURITY DEFINER` functions. |
| `saven_auth_definer` | No | Non-login owner intended for future auth `SECURITY DEFINER` functions. |

All SAVEN target roles are `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOBYPASSRLS` and `NOREPLICATION`. A deployment login principal is created and granted membership separately by the deployment administrator.

## Purpose A tables

| Table | Source / purpose | Notes |
| --- | --- | --- |
| `operator.tenant` | Canonical subscriber directory from native `commerce.subscriber_accounts` | UUID primary key; `legacy_id` preserves the original text tenant id uniquely; status/plan are reference values. |
| `operator.entitlement` | Versioned entitlement claims from native `commerce.entitlements` | `claims_jsonb` is versioned JSON; `writes_until` preserves the native epoch-millisecond boundary. |
| `operator.operator_audit` | Operator audit from native `commerce.commercial_audit` | Append-only trigger; `target_tenant_id` is intentionally not a foreign key so failed attempts remain auditable. |
| `operator.feature_flag` | New operator control | Null `tenant_scope` is global; `enabled` defaults false; unique with `NULLS NOT DISTINCT`. |
| `operator.tenant_placement` | Native `fleet.placements` | One row per tenant; `generation` is the writable-owner fence. |
| `operator.jobs` | Native `jobs.jobs` | Operational control-plane state, not financial authority or a tenant inbox. |
| `operator.ai_requests` | Native `jobs.ai_requests` | Redacted usage/reservation metadata only; no prompt or document body. |
| `operator.migration_events` | Native `fleet.migration_events` | Append-only per-tenant migration history. |
| `operator.source_store_migrations` | New provenance ledger | Preserves native store/version/checksum/applied time; append-only. |
| `operator.pg_schema_migrations` | New PostgreSQL ledger | Separate from native source-store checksums; append-only. |
| `operator.reference_value` | Extensibility extension | Effective-dated operator reference domains; avoids hardcoded enums and CHECK lists. |

`operator.user_identity` and `operator.tenant_membership` are deliberately absent. `auth.users` and `auth.tenant_membership` are the canonical identity/membership owners and will be added by the AUTH contracts.

## Security and boundaries

- The `operator` schema is cross-tenant by design and has no tenant RLS. Customer and auth roles have no schema, table, sequence or function privileges on it.
- `saven_operator_read` has `SELECT` on the current operator tables. New operator tables require an explicit grant.
- `saven_operator_admin` can insert/update operational records; it cannot update or delete `operator_audit`, `migration_events`, `source_store_migrations` or `pg_schema_migrations`.
- Append-only tables reject every `UPDATE` and `DELETE` with `OPERATOR_RECORD_IMMUTABLE`, including for the migration owner.
- Migration and source-provenance ledgers are separate. Native SQLite migration checksums are not asserted to be PostgreSQL SQL checksums.
- No credentials, DSNs, superuser grants or BYPASSRLS grants are present.

## Extension points

- Add operator domains as `operator.reference_value` rows with `is_active` and effective dates; do not add a growing CHECK list.
- Store versioned operator configuration in `value_jsonb`/`claims_jsonb` with a documented schema version.
- Add future operator tables with explicit grants to the read/admin/definer roles and an explicit append-only decision where mutation is prohibited.
- PIVOT-003/004 add tenant business/rule tables and forced RLS; PIVOT-005/006 add posted-source immutability and business audit; PIVOT-007 adds audited `SECURITY DEFINER` operator functions owned by `saven_operator_definer`; PIVOT-008 adds RLS coverage; AUTH-001..010 add the canonical auth schema.
- Fully Private omits vendor operator tables and the vendor issuer; the same customer/auth/tenant contracts remain.

## Local gate fixture

`tests/helpers/pg-pivot-fixture.mjs` creates a uniquely named `saven_pivot_*` database on a loopback PostgreSQL instance using credentials supplied at runtime. It rejects non-loopback hosts and non-administrative target-role credentials, applies the two SQL files, creates an ephemeral login role for role-switch tests, and removes the disposable database/roles afterwards. It never connects to a production database, opens an inbound port or stores a credential in the repository.

The contract test is `tests/pivot-002-operator.test.mjs`.
