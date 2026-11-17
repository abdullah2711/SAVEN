# `src/db` — PostgreSQL transaction boundary and tenant context

Status: AUTH-006 adapter module. Nothing here is imported by an active entry point yet;
the SQLite `/api` runtime remains the production path. The module is the gate every future
PG business feature and both parity contracts must use.

## `tenant-context.mjs`

`createTenantContext({connect, resolveAuthority})` returns `withTenantContext(session,
handler, options)`. For each call it:

1. Enters the injected authoritative admission protocol (`tenant-selection.mjs`
   `withAuthority`). That protocol takes the shared authority gate, opens ONE auth-service
   transaction, row-locks the principal, factor and session, validates the selected
   membership and exact current role, and keeps the transaction and the shared gate open
   for the whole call. Membership/role writers take the gate exclusively, so a concurrent
   authority change either wins before admission or waits until the business transaction
   ends.
2. Checks out exactly ONE business client from a separate pool and opens one transaction.
3. Binds context with parameterized, transaction-local calls on that same client:

   ```sql
   SELECT set_config('app.current_user_id',   $1, true);
   SELECT set_config('app.current_tenant_id', $2, true);
   ```

4. Verifies the bindings with `current_setting(..., true)`, calls
   `tenant_data.session_admitted(tenant, user)` and then re-runs the admission check
   (`assertAdmission`) as the final linearization point before business work.
5. Runs `handler(client, context)` on that client only.
6. COMMITs the business transaction, then the auth transaction releases its locks. A lost
   business COMMIT acknowledgement or failed ROLLBACK destroys the business connection; an
   auth commit/lock-release failure is reported as uncertain rather than claimed safe.

The handler receives the client and a frozen context; there is no `pool.query` escape and
no second checkout from the already-owned business pool.

## Why transaction-local

`set_config(..., true)` is equivalent to `SET LOCAL`: values live only for the current
transaction and cannot leak across COMMIT/ROLLBACK or into the next borrower of a pooled
connection. Session-level `SET` is forbidden. This is what makes the boundary safe behind
PgBouncer in **transaction mode**: every statement of one transaction must run on the same
backend, and no session state is assumed. Direct or session-pooling connections are also
supported.

RLS is the second line of defence, not a replacement for binding: `tenant_data` tables
carry forced RLS with a tenant predicate plus `session_admitted()` for the customer
runtime. Missing, empty or malformed context yields zero rows/writes, not a fallback.

## Relationship to business authorization

Forced tenant isolation answers **which tenant's rows may be touched**. It does not
implement company/branch/resource permissions, approval thresholds, separation of duties
or owner protections. Those are the shared business authorization layer: application
services evaluate configurable per-tenant policy data (`tenant_data.business_rule`,
approval policy, assignments and denials) inside the same transaction and before writes.
Configurable per-tenant rules must stay in versioned policy data — never encoded into RLS
policies. This wrapper supplies the verified tenant context that layer compiles onto; it
is not itself the full business policy engine.

## Failure modes

| Condition | Result |
| --- | --- |
| No verified session / no selection | `401` or `409 TENANT_SELECTION_REQUIRED`; no business client is checked out |
| Revoked, expired, disabled or credential-stale session | refused while the admission transaction holds its locks |
| Operator-realm session | refused (admission requires the customer realm) |
| Selection epoch changed / membership revoked, suspended or role-expired | `409 TENANT_SELECTION_STALE` or `403 TENANT_ACCESS_DENIED` |
| MFA required (active/effective role with `requires_mfa`) but session/factor not verified | `403 MFA_REQUIRED` |
| Requirement/authority cannot be resolved | `503 TENANT_AUTHORITY_UNAVAILABLE` (fail closed) |
| Mismatched expected tenant | `403 TENANT_ACCESS_DENIED` |
| Context binding does not round-trip | `403 TENANT_CONTEXT_DENIED` |
| `session_admitted` false inside the transaction | `403 TENANT_ACCESS_DENIED` |
| COMMIT outcome unknown / ROLLBACK failed | `503 TENANT_CONTEXT_UNCERTAIN`; client destroyed |

## Authority gate (migration 033)

`db/postgres/migrations/033-membership-admission-lock.sql` (administrator-applied,
additive) installs one fixed transaction-scoped advisory gate:

- admission takes `pg_advisory_xact_lock_shared(hashtextextended('saven.auth.authority_gate', 0))`
  on the auth transaction before reading or locking authority, and holds it until the
  business transaction completes;
- BEFORE STATEMENT INSERT/UPDATE/DELETE triggers on `auth.tenant_membership` and
  `auth.roles` take the same key exclusively, before row writes.

Concurrent admissions share the gate; membership/role writers (new associations,
activations, revocations, epochs, `requires_mfa`/`is_active`/effective-date changes) wait
for admitted business work to finish. The deliberate cost is global authority-write
contention; a later amendment may refine per-scope keys with a reviewed order. The trigger
functions are SECURITY INVOKER, fixed `search_path = pg_catalog`, owned by the offline DDL
authority, and grant nothing to runtime roles. The runtime verifies the gate is installed
and fails closed (`TENANT_AUTHORITY_GATE_UNAVAILABLE`) if 033 is omitted or misinstalled.

Ordering is: authority gate -> users -> factor -> session -> membership/role reads ->
business client/transaction. Future transactions combining authority writes with
principal/session/factor mutations must take the gate first. Arbitrary administrative SQL
that violates this order can still deadlock; the runtime fails closed and destroys its
client rather than bypassing or silently retrying. The auth and business transactions are
distinct: a late auth commit failure never implies the business commit was undone.

## Extension points

- Company/branch/resource/approval restrictions belong to the shared business
  authorization layer, evaluated inside the same transaction against versioned policy data.
  They must not replace or bypass this tenant boundary, and configurable per-tenant rules
  must not be encoded into RLS policies.
- A different business role can be supplied through `connect`, provided it has the accepted
  tenant_data grants and no auth.* or BYPASSRLS authority.
- `resolveAuthority` is an injected admission protocol, so the module has no concrete
  dependency on the auth service and can be driven by another verified authority in tests.
- Operational metrics/statement timing can wrap `connect`; they must not introduce a
  second checkout or session-level state.

## Non-claims

- No active entry point, HTTP server or business feature is wired here.
- This is not the business policy engine: company/branch/resource permissions, approval
  thresholds, separation of duties and owner protections belong to the shared business
  authorization layer evaluated inside this transaction.
- No production load, PgBouncer instance or RLS coverage claim is made by this module.
