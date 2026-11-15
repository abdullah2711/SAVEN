CONTRACT: docs/contractor/contracts/PIVOT-002-operator-schema.md
STATUS: DONE

FILES CHANGED:
- db/postgres/00-roles.sql: constrained NOLOGIN SAVEN roles, idempotent rerun guard, no credentials or login principal.
- db/postgres/10-operator-schema.sql: Purpose A operator schema, reference values, tenant/entitlement/audit/feature/placement/job/AI/migration tables, indexes, append-only triggers and least-privilege grants.
- db/postgres/README.md: run order, role/table map, security boundaries, extension points and fixture notes.
- tests/helpers/pg-pivot-fixture.mjs: loopback-only disposable database fixture with runtime-injected credentials, ephemeral login role and cleanup.
- tests/pivot-002-operator.test.mjs: catalog, privilege, tenant-mapping, append-only and DDL separation contract tests.
- docs/contractor/deliveries/PIVOT-002-operator-schema.md: this delivery report.

GATE EVIDENCE:
Command: `node scripts/check.mjs && node --test tests/pivot-002-operator.test.mjs`

```text
PASS: 146 JavaScript files parsed; package manifest valid.
✔ PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (75681.7386ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 75808.072
```

QUESTIONS FOR ENGINEER:
- none

DEVIATIONS FROM CONTRACT:
- The delivery report path is outside the contract TOUCH list; it is explicitly allowed as the delivery report by the contractor prompt.
- The Purpose A table set follows `docs/pivot-notes/02-three-purposes.md`, not only the four spec examples: `tenant_placement`, `jobs`, `ai_requests`, `migration_events`, `source_store_migrations` and `pg_schema_migrations` are included. `operator.reference_value` is the additive reference table for growing operator domains. No `operator.user_identity` or `operator.tenant_membership` table was created.
- The contract NOTE's separate auth service and non-login definer owners are implemented as `saven_auth_service`, `saven_operator_definer` and `saven_auth_definer`. No auth schema or auth table was created by PIVOT-002.
- The operator schema and tables are owned by `saven_migrator`, the NOLOGIN offline DDL role. Runtime roles own no objects and the disposable database is owned by the private migration admin. This preserves the runtime-role ownership prohibition while giving the DDL role the ownership it needs to alter the schema; no runtime role has SUPERUSER or BYPASSRLS.
- The gate was run against a disposable database on the owner server's loopback PostgreSQL 18.6 through a temporary Cloudflare SSH tunnel and a temporary administrative role. No existing database or role was touched. The temporary database, login role, administrative role and newly created SAVEN roles were removed after the test; only the pre-existing `saven_app` role remains. The fixture itself is loopback-only, rejects non-administrative/SAVEN credentials, and remains CI-compatible.
- The fixture grants its disposable private admin `USAGE` on the `operator` schema only so `has_table_privilege` can resolve `operator.*` names during assertions. This is not a production role grant; `saven_customer_app`, `saven_auth_service` and `saven_auth_definer` remain at zero `operator.*` privileges.
- `00-roles.sql` is idempotent for a CREATEROLE migration login: on an existing role it fails closed if SUPERUSER, BYPASSRLS or REPLICATION is present, and narrows only the attributes safe to alter. This avoided requiring a superuser merely to rerun the bootstrap.
- The test reads `pg_class` for the table set and reads `information_schema.columns` as `saven_operator_read`, because an unprivileged administrative connection cannot see objects it has no privileges on. No application permission is weakened by this test-only choice.

EXTENSIBILITY: compliant — growing operator domains are effective-dated `operator.reference_value` rows, versioned operator claims use `claims_jsonb` with `claims_schema_version`, status/plan/tier/state/action values are not hardcoded CHECK lists, privileges are explicit per role, and the bootstrap is additive without changing native/reference migrations or crossing into tenant/auth modules.

GIT: branch=opencode/pivot-002 commits=244752cff23ab1b78e84755ba9d7c2d527f1cf29 pushed=yes
