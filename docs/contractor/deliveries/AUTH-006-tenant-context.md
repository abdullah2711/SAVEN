CONTRACT: docs/contractor/contracts/AUTH-006-tenant-context.md
STATUS: DONE — verified selected membership is bound to a single business transaction client with transaction-local, parameterized context; tenant selection is server-resolved and session-bound; the active SQLite path is untouched.

## Identity

- Branch: `opencode/auth-006-context`, base `testing-1` at
  `1b9ff78a1a29b994a6d77389b035f6b8cd692e76` (the AUTH-005 merge; AUTH-004 merge was
  `a81ce59`).
- Implementation commit: `dc690f5`. Report + checkpoint commit follows.
- Worktree: `/home/esc/saven/wt-auth-006`.
- Node `v24.19.0`; disposable PostgreSQL 18.6 on loopback `127.0.0.1:55432`
  (created for this round, removed afterwards).

## Files changed

- `src/db/tenant-context.mjs` (new) — the business transaction boundary: one checked-out
  client, `BEGIN`, parameterized `set_config(..., true)` for user/tenant, round-trip check,
  `tenant_data.session_admitted` recheck, handler on that client, COMMIT/ROLLBACK, and
  destroy-on-uncertainty.
- `src/db/README.md` (new) — guarantees, failure modes, PgBouncer transaction-mode safety,
  extension points and non-claims.
- `src/auth/tenant-selection.mjs` (new) — preselect/list/select/clear/resolve against the
  verified principal's own active memberships under transaction-local user context; binds
  the selection to the session row.
- `src/auth/session-store.mjs` — `readSessionById`, `setSessionSelection`,
  `clearSessionSelection`; selection fields exposed by the public session shape.
- `src/auth/routes.mjs` — versioned `/v1/auth/tenants`, `/v1/auth/tenant/select`,
  `/v1/auth/tenant/clear`; selection service wiring.
- `src/auth/README.md` — AUTH-006 routes, invariants, extension points, non-claims.
- `tests/auth-006-context.test.mjs` (new) — 8 focused tests on the accepted PIVOT-004 RLS
  stack with real non-owner auth-service and customer-app logins.
- `docs/contractor/deliveries/AUTH-006-tenant-context.md` — this report.

No path outside TOUCH plus report/checkpoint changed. No schema, migration, grant,
dependency, server entry point, native/reference source or production data was changed.

## Invariant coverage

| Invariant | Evidence |
| --- | --- |
| Verified session user and server-resolved selected membership only | `select` accepts exactly one of `tenantId`/`membershipId`, resolves it against the session principal's own active memberships inside a locked session transaction and binds id/tenant/epoch. A client-supplied `userId` is an unknown field; query and header tenant values are ignored. A fabricated session object claiming another selection is ignored; the locked session row is authoritative. |
| Parameterized transaction-local set_config on the same client | `withTenantContext` runs `SELECT set_config($1,$2,true)` for `app.current_user_id`/`app.current_tenant_id` on the one checked-out business client, verifies both with `current_setting(...,true)`, runs the handler on that client and COMMIT/ROLLBACKs. No session `SET` is used. |
| No raw selected-id trust or pool.query escape | The module exposes only the client and a frozen context to the handler; it never calls `pool.query`. Selection values are revalidated by `resolve` before checkout. |
| Revoked/mismatched/no-context fail closed | Revoked, expired, disabled, credential-stale sessions are refused. Missing selection gives `409 TENANT_SELECTION_REQUIRED`; epoch change gives `409 TENANT_SELECTION_STALE`; nonmember/revoked/suspended membership gives `403 TENANT_ACCESS_DENIED`. |
| RLS admission inside the business transaction | After binding, the boundary calls `tenant_data.session_admitted(tenant,user)` on the same client, so a membership/principal revocation after resolution still denies. Foreign-tenant reads return zero; a foreign-tenant write is refused by RLS. |
| No operator/admin shortcut | The routes refuse the operator realm; the auth-service pool is a real non-owner login with the accepted auth grants, and the customer app has no `auth.*` privileges. |
| No context leakage / PgBouncer transaction-mode safety | After commit and after rollback, a pooled business query without context returns zero tenant rows. The README documents why transaction-local `set_config` is mandatory and session `SET` forbidden. |
| Destroy-on-uncertainty | A lost COMMIT acknowledgement returns `503 TENANT_CONTEXT_UNCERTAIN` and releases the client with `destroy=true`; a failed ROLLBACK also destroys. |
| No nested checkout on an owned lease | `resolveSelection` completes before the business client is checked out; the boundary then uses only that client. A `max:1` business pool completes in bounded time. |
| Tenant B nonmember / company-resource denial | U2 cannot list or select T1/T3; within a T1 context, T2 company profiles and accounts are invisible and a T2 write is refused. |
| Stale membership / session state | Membership epoch change, revocation, active-principal dependence, credential-epoch change and read-valid-then-revoked session are all refused before business access. |
| No hardcoded growing domain / no concrete coupling | Selection uses `auth.roles`/membership reference data; the DB boundary receives an injected `resolveSelection` function rather than importing the auth service. |

## DONE WHEN evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 166 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-006-context.test.mjs
tests 8  pass 8  fail 0
```

Exit `0`.

Combined serial run (`--test-concurrency=1`, same disposable cluster):

```text
tests/auth-002-sessions.test.mjs   18/18
tests/auth-003-passwords.test.mjs  27/27
tests/auth-004-mfa.test.mjs        21/21
tests/auth-005-recovery.test.mjs   27/27
tests/auth-006-context.test.mjs     8/8
combined                           101 tests, 101 pass, 0 fail
```

The AUTH-006 tests install the accepted `20-tenant-schema`, `021`, `30-rls-policies`,
`031` and `032` files in a disposable database with namespaced roles, create real
non-owner logins granted `saven_customer_app`/`saven_auth_service`, and exercise the
production RLS policies.

## Boundaries and open items

- No active entry point, HTTP server, UI or business feature is wired to the boundary.
- **Epoch window:** `resolveSelection` re-locks and revalidates the session and selected
  membership epoch immediately before the business client is checked out. Between that
  resolution and the business transaction, a revocation/disable/principal deactivation is
  still caught inside the transaction by `session_admitted`; a pure membership-epoch/role
  change without a status change would be caught by the next request, not mid-flight.
  Closing that residual window needs an auth-readable definer function in a later
  migration contract (outside AUTH-006 TOUCH).
- Selection writes no audit row: the canonical `auth_event_type` reference domain has no
  tenant-selection event, and inventing one requires a reference-data/migration change
  owned by AUTH-009. Selection is not conflated with `membership_accepted`/`role_changed`.
- Company/resource policy beyond tenant RLS remains future policy work; this boundary
  supplies the verified tenant context those policies will compile onto.
- No load, PgBouncer instance or full-branch default-concurrency claim is made.
- SQLite remains production; no profile or entry point was activated.

## EXTENSIBILITY

compliant — selection dimensions are reference/policy data, the context boundary is
injected rather than concretely coupled to auth, only protocol GUC names are fixed, and
company/resource rules extend RLS/policy tables inside the same transaction. Session
tokens stay digest-only (D-012).

## GIT

branch=opencode/auth-006-context commit=`dc690f5`,report+checkpoint commit pushed=yes

# AUTH-006-R1 revision — 17 November 2026

Verdict and corrections: `docs/contractor/reviews/AUTH-006-tenant-context.md` at
`dc183a2`. Implementation `e5eb06e`; report + checkpoint follow. TOUCH unchanged; no
schema, migration, grant, dependency, entry point or native source change.

## Findings closed

1. **HIGH — one authoritative admission boundary.** Status: **closed within current
   RLS/role limits, with one explicitly requested amendment.** `withAuthority` no longer
   commits before business work: it opens ONE auth-service transaction, row-locks
   `auth.users`, `auth.two_factor` and `auth.sessions` in AUTH-004 lifecycle order,
   validates the customer realm, principal, credential generation, exact session and
   selected membership identity/tenant/epoch, and keeps the transaction and its locks open
   while the business transaction runs. A concurrent logout/revocation, rotation,
   credential reset or factor disable/change blocks on those locks until business work
   ends; if it committed before the locks, admission fails closed. Membership/role/epoch
   authority is re-read at the admission point, so a change committed during a pause is
   observed and refused before the handler.
   - Tests: a paused admission blocks revocation, credential-generation change and
     selection clearing (each update times out while the boundary holds); the handler runs,
     the business effect commits, and the changes apply afterwards. A membership epoch
     change committed during the pause wins and the handler is not invoked
     (`TENANT_SELECTION_STALE`, no effect). Expiry advanced during the pause is refused
     (`SESSION_REQUIRED`, no effect). A factor disable during the pause blocks; business
     wins and the next admission requires MFA. BEGIN failure, rollback failure and a
     persisted COMMIT whose acknowledgement is lost all destroy the business client, with
     the lost-ack case honestly reported as uncertain and not undone.
   - **Requested narrow amendment (not authorized here):** `auth.tenant_membership` has
     forced RLS with SELECT policies only for the auth service, so a runtime
     `SELECT … FOR SHARE/UPDATE` is filtered/denied and cannot lock membership rows. To
     serialize a membership/role/epoch change for the whole business transaction, a
     narrowly reviewed additive interface is required (for example a SECURITY DEFINER
     membership lock/validation function or a reviewed locking policy). Until that
     amendment, such a change is caught by the admission re-read; a change committing
     after that re-read and during handler execution is caught by the next request. This is
     stated in both module READMEs and is not claimed as full serialization.

2. **CRITICAL — MFA and realm are part of reusable admission.** Status: **closed.**
   `readSessionById` now filters the customer realm by default and exposes
   `mfa_verified_at`; selection and admission derive requirements from active/effective
   assurance-role data (`requires_mfa`), require a currently verified factor plus
   `mfa_verified` session assurance, and fail closed with `503
   TENANT_AUTHORITY_UNAVAILABLE` if requirements cannot be resolved. The checks run inside
   `list`, `select`, `clear` and `withAuthority`, not only in the HTTP pre-MFA guard.
   Tests: pending/enrollment-only admin is denied at both selection and context even with a
   row-forced selection; verified admin is a positive path; member-to-admin promotion
   without an epoch bump is denied; factor disable and assurance downgrade after selection
   are denied; operator-realm session is refused; unresolved role authority fails closed.
   No hardcoded business role names are used.

3. **MEDIUM — same-tenant company/resource evidence and guidance.** Status: **closed.**
   The DB README now states that forced RLS tenant isolation complements the shared
   business authorization layer and never replaces it; configurable per-tenant rules stay
   in versioned policy data (`business_rule`/approval/assignment), not RLS, and the wrapper
   is explicitly not the business policy engine. A new composition test runs inside a T1
   context: a `business_rule` company scope allows company `alpha` and denies company
   `beta` in the same tenant. The allowed warehouse write commits; the denied write throws
   and leaves no row. **Acceptance dependency:** the production company/resource
   authorization module (approval/assignment/denial evaluation) is future shared-layer
   work; this test composes an illustrative authorizer over the canonical `business_rule`
   data and does not claim to implement that engine.

## Evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 166 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-006-context.test.mjs
tests 16  pass 16  fail 0
```

Combined serial run (`--test-concurrency=1`, disposable PostgreSQL 18.6 on
`127.0.0.1:55432`, accepted PIVOT-004/031/032 RLS stack, real non-owner auth-service and
customer-app logins):

```text
AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27, AUTH-006 16/16
combined 109 tests, 109 pass, 0 fail
```

## Boundaries

- The requested membership-lock amendment above is the only open serialization dependency;
  no migration/grant change was made.
- No tenant-selection audit event is emitted (no canonical `auth_event_type` value;
  AUTH-009/reference-data owner).
- No active entry point/UI/feature activation; no PgBouncer instance, production load or
  full-branch default-concurrency claim.
- SQLite remains production.

## EXTENSIBILITY

compliant — requirements are reference-driven, admission is an injected protocol, locks
follow the accepted lifecycle order, and company/resource rules remain versioned policy
data rather than RLS or hardcoded roles.

## GIT (R1)

branch=opencode/auth-006-context commit=`e5eb06e`,report+checkpoint commit pushed=yes
