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

# AUTH-006-R2 revision — 17 November 2026

Verdict and review: `docs/contractor/reviews/AUTH-006-R1-tenant-context.md` at `d9e2bb1`.
Implementation `09ce585`; report + checkpoint follow. This round implements the
within-TOUCH validation protocol and supplies the concrete bounded amendment requested by
the review. No migration/grant/RLS/owner change was made.

## Remaining HIGH correction — role provenance and final admission

Status: **corrected within current TOUCH; true membership locking remains the requested
amendment.**

- `withAuthority` freezes the exact selected `roleId` from the resolved membership row.
  Every admission check now compares the freshly read `selectedNow.role_id` with that
  frozen role in addition to membership id/tenant/epoch/usability. A role change without an
  epoch bump therefore fails closed with `TENANT_SELECTION_STALE` instead of leaving an
  earlier role in the context.
- Admission runs twice: before the handler and again immediately before the business
  COMMIT. The second check re-reads the complete membership/role authority set, recomputes
  MFA requirements (including newly added associations), rechecks the exact selected role
  and time-bound assurance, and discards the business transaction if anything changed.
  This proves a role change committed after the first admission cannot let effects commit
  under the earlier role.
- Tests:
  - non-MFA role change with no epoch bump during a pause → `TENANT_SELECTION_STALE`, no
    handler, no effect;
  - the same role change committed **during handler execution** → pre-commit revalidation
    rolls the inserted effect back;
  - a newly activated MFA-requiring membership association during a pause → `MFA_REQUIRED`,
    no handler/effect;
  - an ineffective selected role (`auth.roles.is_active = false`) → stale, no handler.

Residual: a membership/role change that commits between the final pre-commit check and
COMMIT is not DB-serialized. True serialization requires the amendment below; this is not
claimed as complete membership locking.

## Concrete bounded amendment proposal (not authorized, not implemented)

Requested from the engineer as the next contract amendment. It adds no permissive
membership UPDATE authority to the auth-service runtime and no RLS relaxation.

**Additive path:** one additive migration (e.g.
`db/postgres/migrations/033-membership-admission-lock.sql`) plus two trigger functions and
their triggers. No table/column change, no grant to runtime roles, no policy change.

**Lock keys (transaction-scoped advisory locks):**

- per user: `pg_advisory_xact_lock(hashtext('saven.auth.membership:' || user_id))`
- global role authority: `pg_advisory_xact_lock(hashtext('saven.auth.roles'))`

**Admission side:** `withAuthority`, after binding the verified principal and before reading
memberships, takes the user key and the roles key on the auth transaction. The transaction
stays open through the business transaction, so the locks are held until business work
completes. Keys are derived from the verified server-side user only; no client id, session
`SET`, or new privilege is used.

**Writer side (DB-enforced):**

- `auth.tenant_membership` AFTER INSERT/UPDATE/DELETE trigger takes the per-user key for
  `NEW.user_id` and `OLD.user_id` (covering new associations and promotions).
- `auth.roles` AFTER INSERT/UPDATE/DELETE trigger takes the global roles key (covering
  `requires_mfa`, `is_active`, and effective-date changes).
- Trigger functions: `SECURITY INVOKER`, `SET search_path = pg_catalog`, body only takes
  the advisory locks (no table reads/writes). Owned by the offline migration/DDL role;
  no runtime EXECUTE grant is required for trigger invocation.

**Ordering:** admission takes user then roles; membership triggers take one user key; role
triggers take the roles key. No writer takes roles then user, so no lock-order cycle is
introduced.

**RLS/privileges:** unchanged. Forced RLS, admission-owner authority and the
auth-service/customer-app separation are preserved. No `BYPASSRLS`, no table ownership, no
permissive membership UPDATE grant.

**Caller/context validation:** locks are taken only inside the owned auth transaction after
`app.current_user_id` is bound and the session/principal is verified; the key is the
verified user, never a request value.

**Affected fixture/tests (once authorized):** add `033` to the AUTH-006 fixture migration
list; prove both orderings with real restricted roles and smallest separate auth/business
pools: (a) a role/membership change wins before admission → no handler/effects; (b) business
admission wins and the writer blocks until completion; (c) role change without epoch bump,
role policy/effectiveness change, new membership/promotion affecting MFA, and revocation/
epoch change. Preserve the existing uncertain-COMMIT semantics: the auth and business
transactions are not a distributed atomic commit, so an auth commit failure after a
business commit is reported as uncertain, not undone.

Until authorized, the R2 validation protocol is the boundary: committed authority changes
are detected at admission and again before COMMIT; no full membership serialization is
claimed.

## Evidence

```text
$ node scripts/check.mjs
PASS: 166 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-006-context.test.mjs
tests 20  pass 20  fail 0
```

Combined serial run (`--test-concurrency=1`, disposable PostgreSQL 18.6, accepted
PIVOT-004/031/032 RLS stack, real non-owner auth-service and customer-app logins):

```text
AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27, AUTH-006 20/20
combined 113 tests, 113 pass, 0 fail
```

## Boundaries

- The amendment above is the only open serialization dependency; it is not authorized or
  implemented. No schema/grant/RLS change was made.
- Findings 2 (realm/MFA) and 3 (same-tenant company composition) remain closed from R1.
- No tenant-selection audit event (AUTH-009/reference-data), no active entry point/UI, no
  PgBouncer instance or production load claim. SQLite remains production.

## GIT (R2)

branch=opencode/auth-006-context commit=`09ce585`,report+checkpoint commit pushed=yes

# AUTH-006-R3 revision — 17 November 2026

Verdict and amendment: `docs/contractor/reviews/AUTH-006-R2-tenant-context.md` at
`3c28d89`, with the ENGINEER R2 AMENDMENT in
`docs/contractor/contracts/AUTH-006-tenant-context.md`. Implementation `bbe9bdb`; report +
checkpoint follow.

## HIGH — true authority serialization (implemented)

The remaining gap was a check-then-COMMIT race: after the final re-read, a membership/role
writer could still commit before the business COMMIT. This is now serialized by the
authorized additive authority gate.

- **Migration `db/postgres/migrations/033-membership-admission-lock.sql`** (administrator
  applied, additive). It installs one fixed transaction-scoped advisory key
  `saven.auth.authority_gate`:
  - admission takes it **shared** before any authority read or row lock and holds it until
    the auth transaction ends after business completion;
  - BEFORE STATEMENT INSERT/UPDATE/DELETE triggers on `auth.tenant_membership` and
    `auth.roles` take it **exclusively**, before row writes.
  - Trigger functions are `SECURITY INVOKER`, `SET search_path = pg_catalog`, owned by the
    offline DDL/migration authority, PUBLIC EXECUTE revoked; no runtime EXECUTE/UPDATE
    grant, no SECURITY DEFINER, no RLS change, no policy change, no BYPASSRLS, no dynamic
    SQL, no business data mutation.
  - A guard rejects pre-existing conflicting gate function/triggers instead of repairing
    foreign authority silently.
- **Admission** (`tenant-selection.withAuthority`) verifies the six triggers and function
  are installed, then acquires the shared gate before the principal/factor/session locks
  and membership/role reads. If 033 is omitted or misinstalled it fails closed with
  `TENANT_AUTHORITY_GATE_UNAVAILABLE`; a failed acquisition returns
  `TENANT_AUTHORITY_UNAVAILABLE` and leaves the pool usable.
- **Ordering** is gate -> users -> factor -> session -> membership/role reads -> business
  client/transaction. Concurrent admissions share the gate; authority writers contend
  globally and wait for admitted business work. Mixed role+membership writer transactions
  in either table order take the same exclusive gate at their first authority statement,
  avoiding the earlier proposed user-key/role-key inversion.
- Exact selected-role binding is retained and strengthened: the session's stored
  `selectedRoleId` must match the current membership role, in addition to the frozen role
  comparison on every admission attempt.
- The final pre-COMMIT revalidation remains as a backstop; it is no longer the
  serialization mechanism.

## Evidence

Pause-after-final-validation tests (business COMMIT paused) prove each writer class cannot
commit until business completion: membership revocation, membership epoch change,
`requires_mfa` change on an existing role, activation of a revoked membership, selection
role change, and an actual new MFA-requiring membership INSERT. A mixed role+membership
transaction blocks in both table orders. Invalidation-first cases (writer commits before
admission) refuse the handler with no effects; admission-first cases commit the business
effect and the writer applies afterwards. Missing/failed gate, catalog/owner/privilege
checks, conflict guard text, and smallest separate auth/business pools (`max:1` each) are
covered.

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 166 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-006-context.test.mjs
tests 25  pass 25  fail 0
```

Combined serial run (`--test-concurrency=1`, disposable PostgreSQL 18.6, accepted
PIVOT-004/031/032 + 033 stack, real non-owner auth-service and customer-app logins):

```text
AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27, AUTH-006 25/25
combined 118 tests, 118 pass, 0 fail
```

## Boundaries and honest limits

- The authority gate is deliberately global for authority writes: concurrent admissions
  share it, but membership/role writers serialize against all admitted business work. No
  throughput/SLA claim is made. A later reviewed amendment may refine per-scope keys with
  an explicit order.
- Arbitrary administrative SQL that violates the documented gate order can still deadlock.
  The runtime fails closed and destroys owned clients; it never bypasses the gate or
  silently retries a committed business operation.
- Migration 033 is administrator-applied and is not executed by this test session in
  production. The disposable fixture registers it; an omitted/misinstalled gate is refused
  at runtime.
- Auth and business remain distinct transactions; a late auth commit failure does not undo
  a committed business effect and is reported as uncertain.
- Findings 2 (realm/MFA) and 3 (same-tenant company composition) remain closed. No active
  entry point/UI, PgBouncer instance or production-load claim; SQLite remains production.

## EXTENSIBILITY

compliant — the gate key is infrastructure, not a configurable business domain; admission
stays injected, assurance remains reference-driven, and business authorization remains in
versioned policy data outside RLS. The trigger functions carry no business logic.

## GIT (R3)

branch=opencode/auth-006-context commit=`bbe9bdb`,report+checkpoint commit pushed=yes

# AUTH-006-R4 revision — 18 November 2026

Verdict: `docs/contractor/reviews/AUTH-006-R3-tenant-context.md` at `5ddb603`.
Implementation `52c9822`; report + checkpoint follow. Two bounded completion corrections to
the already-accepted gate design; no redesign of admission.

## HIGH — exact authority-gate contract validation (implemented)

`assertAuthorityGateInstalled` no longer counts names. Before any authority read/lock it
validates:

- exactly one zero-argument `auth.lock_authority_gate()` plpgsql trigger function returning
  `trigger`, `SECURITY INVOKER`, `proconfig` exactly `search_path=pg_catalog`, owned by a
  role that is NOLOGIN/NOSUPERUSER/NOBYPASSRLS and **not reachable from the runtime's role
  memberships**;
- each of the six required triggers by exact table (`auth.tenant_membership`/`auth.roles`),
  event (INSERT/UPDATE/DELETE), BEFORE STATEMENT timing (`tgtype` exactly `2|event`),
  function OID, unconditional predicate (`tgqual IS NULL`, no arguments, no column list, no
  constraint, no deferral), and firing mode origin/always. Replica-only (`R`) and disabled
  (`D`) profiles are refused.

Failure is `503 TENANT_AUTHORITY_GATE_UNAVAILABLE`, before any business client or handler.
The negative tests replace required bindings while retaining the expected name/count:
replica-only trigger, wrong function OID, wrong table, wrong event, row-level conditional
trigger, SECURITY DEFINER, and wrong `search_path`. Each refuses admission with no handler
or effect, then a restored valid profile recovers and the pool is reused cleanly.

Trust boundary (documented in both READMEs): catalog validation proves the installed
reviewed bindings and function configuration. It cannot detect arbitrary body tampering by
the privileged DDL owner; that remains a migration/configuration trust boundary.

## MEDIUM — atomic 033 installation (implemented)

`db/postgres/migrations/033-membership-admission-lock.sql` now owns an explicit
`BEGIN/COMMIT`, with the conflict preflight before any persistent mutation. Application
mode is documented: administrator-applied with no ambient transaction; a
statement-by-statement runner is atomic, and the payload must not be pre-wrapped.

Tests read and split the actual migration (dollar-quote/string/comment aware) and apply it
statement by statement to a disposable database without 033:

- a pre-existing foreign gate-like function/trigger is refused by the guard, no new gate
  objects appear, and the foreign objects remain unchanged;
- an injected interruption after some DDL (following `ALTER FUNCTION`) rolls back with zero
  gate function/triggers; a clean retry then installs all six triggers and the function;
- the freshly installed protocol composes with a real selected session/business context.

## Evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 166 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-006-context.test.mjs
tests 27  pass 27  fail 0
```

Combined serial run (`--test-concurrency=1`, disposable PostgreSQL 18.6, accepted
PIVOT-004/031/032 + 033 stack, real non-owner auth-service/customer-app logins):

```text
AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27, AUTH-006 27/27
combined 120 tests, 120 pass, 0 fail
```

## Boundaries

- Gate remains global for authority writes; no throughput/SLA claim. Concurrent admissions
  share it, writers contend globally.
- Arbitrary administrative SQL that violates the documented order can still deadlock; the
  runtime fails closed and destroys owned clients. Auth and business transactions remain
  distinct; a late auth commit failure is uncertain, not an undo.
- Migration 033 is administrator-applied; this session did not execute it in production.
  No non-disposable installation was rewritten.
- Findings 2 (realm/MFA) and 3 (same-tenant composition) remain closed. No active entry
  point/UI, PgBouncer instance or production-load claim; SQLite remains production.

## GIT (R4)

branch=opencode/auth-006-context commit=`52c9822`,report+checkpoint commit pushed=yes
