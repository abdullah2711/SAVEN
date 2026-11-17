# `src/db` — PostgreSQL transaction boundary and tenant context

Status: AUTH-006 adapter module. Nothing here is imported by an active entry point yet;
the SQLite `/api` runtime remains the production path. The module is the gate every future
PG business feature and both parity contracts must use.

## `tenant-context.mjs`

`createTenantContext({connect, resolveSelection})` returns `withTenantContext(session,
handler, options)`. For each call it:

1. Revalidates the verified session and its selected active membership through
   `resolveSelection` (AUTH-006 `tenant-selection.mjs`) on the auth-service connection.
   The business role cannot read `auth.*` by design, so this authority step happens in its
   own transaction before the business client is checked out.
2. Checks out exactly ONE business client and opens one transaction.
3. Binds context with parameterized, transaction-local calls on that same client:

   ```sql
   SELECT set_config('app.current_user_id',   $1, true);
   SELECT set_config('app.current_tenant_id', $2, true);
   ```

4. Verifies the bindings with `current_setting(..., true)` and calls
   `tenant_data.session_admitted(tenant, user)`, so a membership/principal revocation that
   happened after resolution still fails closed.
5. Runs `handler(client, context)` on that client only.
6. COMMITs, or ROLLBACKs on any error. A lost COMMIT acknowledgement or failed ROLLBACK
   destroys the connection instead of returning it to the pool.

The handler receives the client and a frozen context; there is no `pool.query` escape and
no second checkout while the transaction is open.

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

## Failure modes

| Condition | Result |
| --- | --- |
| No verified session / no selection | `401` or `409 TENANT_SELECTION_REQUIRED`; no business client is checked out |
| Revoked, expired, disabled or credential-stale session | refused during `resolveSelection` |
| Selection epoch changed / membership revoked or suspended | `409 TENANT_SELECTION_STALE` or `403 TENANT_ACCESS_DENIED` |
| Mismatched expected tenant | `403 TENANT_ACCESS_DENIED` |
| Context binding does not round-trip | `403 TENANT_CONTEXT_DENIED` |
| `session_admitted` false inside the transaction | `403 TENANT_ACCESS_DENIED` |
| COMMIT outcome unknown / ROLLBACK failed | `503 TENANT_CONTEXT_UNCERTAIN`; client destroyed |

## Extension points

- Company/branch/resource restrictions belong in additional RLS policies and policy tables
  evaluated inside the same transaction; they must not replace or bypass this boundary.
- A different business role can be supplied through `connect`, provided it has the accepted
  tenant_data grants and no auth.* or BYPASSRLS authority.
- `resolveSelection` is an injected function, so the module has no concrete dependency on
  the auth service and can be driven by another verified authority in tests.
- Operational metrics/statement timing can wrap `connect`; they must not introduce a
  second checkout or session-level state.

## Non-claims

- No active entry point, HTTP server or business feature is wired here.
- This is not a substitute for approval, company or resource policy, nor for business
  permission and owner-protection rules.
- No production load, PgBouncer instance or RLS coverage claim is made by this module.
