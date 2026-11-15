# PIVOT-003 worker questions: engineering decisions

Date: 15 November 2026 (Asia/Karachi)
Engineer branch: `codex/pivot-003-rulings`, based on `testing-1` at `6c8bc25`.
Reviewed question source: `opencode/pivot-003` at `62405d2`, delivery report and relevant schema/README; AUTH-001 schema inspected separately at `opencode/auth-001` (`09b1898`). That auth branch is not assumed integrated.

This is a technical decision note requested by the human relay. It is not an ACCEPT of the PIVOT-003 delivery, an implementation contract execution, merge authorization or release evidence. Full delivery acceptance still requires its own diff/invariant review. No contracts, migrations, tests or deployments were executed here.

## 1. Branch convention

D-008 already settles this: workers use `opencode/<slug>`, engineers use `codex/<slug>`. The human authorizes merges to `testing-1`. Do not reopen the naming decision or merge this note automatically. The role and decision-log files were absent on the worker base and were read from `codex/orchestrator-bootstrap`; they were not copied into this branch.

## 2. Access ownership: grants land with policies

Yes. PIVOT-004 owns explicit least-privilege grants in `30-rls-policies.sql`, in the same atomic migration as ENABLE/FORCE RLS and isolation policies. No intermediate committed state may grant tenant access without those guards. Preserve PIVOT-003's default-deny skeleton and applied SQL bytes.

`saven_customer_app` is the only direct tenant **runtime** grantee at this stage. Neither `saven_auth_service` nor `saven_auth_definer` needs tenant reads to authenticate or select canonical membership; that authority is in `auth.*`. After selection, the customer business path checks the tenant principal and business permissions. PUBLIC and operator runtime roles retain no direct tenant access. Offline migrator ownership is separate from runtime grants. Later PIVOT-007 must specify narrowly scoped definer-owner privileges and audited functions explicitly; this decision does not grant them now.

Use a per-table privilege matrix, not blanket ALL/default privileges. Never grant runtime CREATE, TRUNCATE, REFERENCES, TRIGGER, ownership or privileged role membership. Audit/revision/accepted-source permissions must respect their append-only/immutable contracts; no UPDATE/DELETE grant on audit or revision rows. Trigger-only audit_event insertion must not become a customer-controlled evidence path. PIVOT-005/006 and AUTH-006 still gate business serving. RLS alone does not protect whole-table TRUNCATE or replace business authorization. See [PostgreSQL row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).

## 3. Principal mapping: stored, constrained UUID projection

Choose an additive `tenant_data.members.user_uuid uuid NOT NULL`, keeping native `members.user_id text` and all historical references unchanged. `auth.users` remains the sole identity authority, and `auth.users.legacy_id` remains the canonical native-text mapping. The new column is a constrained projection, never a second independently editable identity registry.

PIVOT-004 must enforce all three conditions with database constraints:

- Unique `(tenant_id, user_uuid)` in members.
- `(tenant_id, user_uuid)` references `auth.tenant_membership(tenant_id, user_id)` with restrictive deletion/update behavior.
- `(user_uuid, user_id)` references `auth.users(id, legacy_id)`, with an additive unique target key on that exact pair in `30-rls-policies.sql`. Separate independent FKs to UUID and text would permit mismatched identities and are insufficient.

Do not edit the already delivered AUTH-001 or PIVOT-003 bootstrap files. The additive auth key is within the existing PIVOT-004 SQL path; no new auth bootstrap ownership is assigned. A principal projected into members must have a stable nonblank `legacy_id`; new UUID-native identities need an explicitly assigned stable compatible text identifier before projection. Do not infer identity from email, cast old text IDs to UUID, generate a replacement for an unmapped historical user, or leave unresolved mappings nullable. Disposable fixture mapping may resolve through `auth.users.legacy_id`; production migration remains separately gated. Foreign keys require a suitable unique referenced key; see [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html).

FK existence does not establish active admission. Isolation must also reject missing user context, inactive/missing canonical membership and inactive/missing business principal. Verified transaction-local user context is the canonical auth UUID; native text actor attribution is resolved server-side. Test mismatched UUID/text pairs, same user in different tenants, revoked membership, and dangling mappings. Do not grant the customer role broad SELECT on auth.users or credential/session tables to make policy lookups work. Any narrow auth lookup function added in the allowed SQL must use a fixed safe search_path, restricted EXECUTE and least privilege, avoid RLS recursion, and resist extra permissive policies.

## 4. Reference domains: retain the existing mechanism

Yes. Keep `reference domain: <name>` annotations and `contracts/postgres-business-rules-v1.json` as the canonical checked-in domain/seed and versioned-shape specification. Actual per-tenant configured/effective values live in `tenant_data.reference_values`; annotations and JSON alone are not runtime validation. No replacement domain registry is required.

Keep annotations, seed domains and tests consistent. Adding configured values must not require growing CHECK/enum lists. Reference rows cannot install posting or authorization logic: typed registered handlers, effective-date semantics and versioned JSON validation still require their assigned implementation/evidence. The seed is not permission to overwrite used tenant policy. Extending that JSON file is outside PIVOT-004's current TOUCH list and needs a scoped contract amendment if actually necessary.

## 5. Audit retention: no prerequisite historical backfill

No deduplication or backfill from native `tenant_data.audit` into `audit_event` is required before PIVOT-006. Preserve native ids, command links, actor/detail bytes, epoch-ms times and original row counts/hashes. Never synthesize historical UUID actors, before/after values, origin metadata or timestamps merely to fill the new sidecar.

PIVOT-006 must protect **both** stores from runtime UPDATE/DELETE/TRUNCATE and define prospective event coverage and correlation. Its audit_event record must carry verified actor/tenant, action/target, before/after and version (using a documented versioned JSON shape or additive fields), atomically with the business change, without secret leakage or recursive self-audit. Copying native audit into audit_event for every insert is not required and cannot replace coverage of business mutations. Preserve native command-event semantics alongside change events. Parity must compare native financial audit independently and test the additional change-event stream separately; differing sidecar counts cannot be hidden by deduplicating history or weakening assertions.

Any later historical projection requires a separately reviewed migration contract, explicit source provenance, idempotency, reconciliation and applicable owner data-migration authorization. This note authorizes none.

## PIVOT-004 contract clarification

VERDICT: REVISE — the existing PIVOT-004 contract needs the following explicit clarification before assignment; this is not a verdict on delivery PIVOT-003.

WHY: Default-deny until forced RLS, exact UUID/text binding and least-privilege membership resolution must be explicit and tested without reopening or expanding the worker delivery.

TASK: PIVOT-004 — implement forced tenant isolation, atomic scoped grants and constrained canonical-principal mapping per rulings 2–3 above.
TOUCH: db/postgres/30-rls-policies.sql; db/postgres/README.md; tests/pivot-004-rls.test.mjs
FORBIDDEN: All paths outside TOUCH, including delivered 00/05/10/20 SQL, SQLite/reference code, production data, credentials, archived frontend and protected refs; no merge or deployment.
DONE WHEN: node scripts/check.mjs && node --test tests/pivot-004-rls.test.mjs
INVARIANTS: Original PIVOT-004 invariants remain; atomic default-deny-to-forced-RLS transition, restrictive tenant/user admission guard despite extra permissive policies, no broad auth or operator privileges, exact preserved-text/UUID/composite-membership FKs, no runtime TRUNCATE or mutable audit/revision grants, no client-authoritative context, no superuser/BYPASSRLS or new identity authority.
PATTERN: Existing PIVOT-004 contract, ADR03 Tenant context and Identity table ownership; checked-in disposable fixture with sqlFiles selecting actual prerequisite schemas, not substitute DDL.
NOTES: Depends on PIVOT-003 and accepted/integrated AUTH-001 plus PIVOT-002. Implement ADR01 Data and authority invariants and ADR03 Identity table ownership/Tenant context; preserve original contract negative CRUD/join/aggregate/company-FK tests. Add actual-role tests for this note's grants, mapping mismatches, missing/revoked membership, inactive principal, malformed/missing context and permissive-policy attacks; read-only ownership/privilege assertions are not substitutes for denied operations. AUTH-006 supplies verified context in the application and still gates shipping. Out-of-TOUCH requirements return to engineer; no worker scope expansion.

## Authority, extension and evidence limits

Authority: human-routed questions in this session; D-008/D-009; ADR01 Data and authority invariants/SQLite retirement gate; ADR03 Identity table ownership/Tenant context/Audit and AI constraints; PIVOT-003/004/006; CONVENTIONS extensibility mandate. The older session-bootstrap instruction to recreate all contracts is already complete per project state and is not restarted.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. UUID projection constraints narrow legal mappings deliberately to preserve a single identity; a future identifier model needs an additive reviewed migration/ADR without rewriting historical ids. Reference values remain extensible and any historical audit projection remains separately reviewable.

Only document/Git/source inspection and official documentation lookup were performed. Worker gate claims were read, not independently rerun or accepted. No planning catalogs, BUILD_STATE, checklist completion states, runtime files or applied migrations change. SQLite remains production. Human review and merge authorization remain outstanding.
