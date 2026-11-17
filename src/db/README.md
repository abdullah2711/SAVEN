# `src/db` — PostgreSQL transaction boundary and tenant context

Status: AUTH-006 adapter module. Nothing here is imported by an active entry point yet;
the SQLite `/api` runtime remains the production path. The module is the gate every future
PG business feature and both parity contracts must use.

## `tenant-context.mjs`

`createTenantContext({connect, resolveAuthority})` returns `withTenantContext(session,
handler, options)`. For each call it:

1. Enters the injected authoritative admission protocol (`tenant-selection.mjs`
   `withAuthority`). That protocol opens ONE auth-service transaction, row-locks the
   principal, factor and session, validates the selected membership and role authority,
   re-reads membership/role/epoch state at admission, and keeps the transaction open for
   the whole call. A concurrent logout/rotation/credential reset/factor change either wins
   before those locks or blocks until the business transaction ends; a committed
   membership/role/epoch change is observed by the admission re-read and fails closed.
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

## Known dependency (requested amendment)

`auth.tenant_membership` carries forced RLS with SELECT policies only for the auth
service, so a runtime row-locking `SELECT … FOR SHARE/UPDATE` is filtered/denied and cannot
serialize membership changes. The current protocol row-locks the principal, factor and
session, binds the exact selected role, and re-reads the full membership/role authority
both at admission and immediately before the business COMMIT, so a committed change fails
closed before effects may commit. The residual window is a membership/role change that
commits between that last check and COMMIT.

A concrete bounded amendment is proposed in
`docs/contractor/deliveries/AUTH-006-tenant-context.md` (AUTH-006-R2 section): additive
advisory-lock triggers on `auth.tenant_membership` and `auth.roles`, plus the same
transaction-scoped locks in admission. It requires no permissive membership UPDATE grant,
no RLS relaxation and no BYPASSRLS. It is **not authorized or implemented** until the
engineer issues the corresponding contract amendment.

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
