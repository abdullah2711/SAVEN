CONTRACT: docs/contractor/contracts/AUTH-002-sessions.md
STATUS: DONE — versioned `/v1/auth` login/logout/me routes and the hash-at-rest PostgreSQL session adapter are implemented and gated; the active SQLite `/api` path is unchanged.

## Identity

- Branch: `opencode/auth-002-sessions`, base `testing-1` at `d0a50cd8405724ab21a2fe2306b2803f01938569`.
- Commit: `50eab39` (implementation and tests), plus this report commit.
- Worktree: `/home/esc/saven/wt-auth-002`.
- Node `v24.19.0`; disposable PostgreSQL 18.6 cluster on loopback `127.0.0.1:55440` (stopped and deleted after the gate).

## Files changed

- `src/auth/session-store.mjs` — the single write path to `auth.sessions`: token minting, digest-only persistence, verified-server-session reads, idle refresh capped by the absolute ceiling, rotation that preserves the ceiling, revoke/revoke-all by `UPDATE`, credential-epoch and user-status checks, realm/role validation from reference data.
- `src/auth/routes.mjs` — `/v1/auth/login`, `/v1/auth/me`, `/v1/auth/logout` as a Web-API `Request → Response` handler with exact-origin checks, JSON/body bounds, unknown-field refusal, constant-time CSRF digest comparison, host-only realm cookies and non-enumerating failures.
- `src/auth/server.mjs` — composition root wiring the store, the injected PostgreSQL pool, the retained scrypt verifier and the append-only audit writer. Holds no credential, DSN or DDL.
- `src/auth/README.md` — routes, invariants, database requirements, extension points, Better Auth adaptation requirements and explicit non-claims.
- `tests/auth-002-sessions.test.mjs` — 8 disposable-cluster tests.

No file outside TOUCH plus this report changed. `src/local`, `postgresql`, `archive`, `public`, migrations and `package.json` are untouched, and no existing `/api` route was modified.

## Invariant coverage

| Invariant | Evidence |
| --- | --- |
| Random opaque token, SHA-256 only at rest | 32 random bytes base64url; row stores `sha256(token)`; a spy on the database boundary proves no live token or CSRF value ever appears in SQL text or parameters across create/read/refresh/rotate/revoke. `row_to_json` over the session and audit rows contains neither. |
| 30-day idle / 90-day absolute | Creation writes exactly 30/90-day spans. Activity refreshes idle only and caps it at the absolute ceiling; a direct SQL attempt to extend the ceiling is refused by the AUTH-001 trigger; day 91 fails closed. |
| Rotate/revoke with epochs | Rotation issues a new token, revokes the old row with reason `privilege_change`, keeps the original ceiling; `revokeAllSessions` invalidates every live token; a changed `credential_version`, `status = 'disabled'` or revocation invalidates an existing session on its next read. |
| Host-only secure realm cookies, origin/CSRF | `__Host-saven_session`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, no `Domain`; operator realm is `SameSite=Strict` on a distinct cookie name; exact-origin checks on writes; unrecognised origin `421`; missing/wrong `X-CSRF-Token` `403`; local non-TLS fixtures use an obviously separate name without `__Host-`/`Secure`. |
| No cookie-only cached authority | The cookie carries only an opaque token; every `/me` re-reads the server-side row, so a revocation in the database takes effect immediately. No session data is written to a cookie and no cache layer exists. |
| No client-derived authority | Login accepts only `email` and `password`; `userId`/`tenantId`/`roleId`/`credentialVersion` in the body return `400 UNKNOWN_FIELDS` and create no session. User id, status and credential epoch come from the verified row. Tenant selection is AUTH-006 work; the store only accepts a server-resolved selection object. |
| Append-only audit | `login_success`, `login_failure` and `logout` rows are written; failures for unknown identities are recorded with no invented attribution; audit rows contain no password, token, CSRF value or email; `UPDATE`/`DELETE` on `auth.auth_audit` are refused. An audit write failure fails the request instead of reporting an unrecorded success. |
| No runtime superuser/ownership/BYPASSRLS | The module issues no DDL and requires no elevated privilege; it takes an injected pool and documents that production must use a `saven_auth_service` principal. The current gate runs against the fixture's administrative connection, so privilege enforcement is proven by AUTH-001, not re-proven here. |
| No hardcoded growing domains | Realms are validated against `auth.reference_value` (domain `realm`); assurance roles against `auth.roles`; audit events are reference rows. No realm/role/event list is hardcoded in code. |
| Realm isolation | A customer token does not resolve in the operator realm; operator login returns `403 OPERATOR_ASSERTION_REQUIRED` and creates no row; operator `/me` fails closed before session resolution (AUTH-007 owns asserted access). |

## Gate evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs && node --test tests/auth-002-sessions.test.mjs
PASS: 153 JavaScript files parsed; package manifest valid.
✔ AUTH-002 login persists only a digest and issues a host-only secure cookie (539.173388ms)
✔ AUTH-002 sessions fail closed on expiry, revocation, disablement and credential epochs (961.327561ms)
✔ AUTH-002 activity extends idle expiry but never the absolute ceiling (447.456635ms)
✔ AUTH-002 rotation and revocation keep history and invalidate old tokens (460.651583ms)
✔ AUTH-002 CSRF, origin, content-type and field boundaries refuse client authority (451.844977ms)
✔ AUTH-002 failures are non-enumerating and audited without secrets (631.626972ms)
✔ AUTH-002 the plaintext token never crosses the database boundary (445.446944ms)
✔ AUTH-002 cookie policy distinguishes realms and local fixtures (0.507629ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
ℹ skipped 0
```

Exit status `0`. Full suite on the same runtime and cluster: `177` tests, `177` pass, `0` fail, `0` skipped. Without the dedicated-cluster opt-in: exit `1`, one database-independent pass (cookie policy) and seven refusals before mutation.

Environment: `SAVEN_AUTH_TEST_CLUSTER=1`, loopback-only admin, disposable database created and dropped by the fixture; post-gate query reported no `saven_auth_%` roles and no `saven_auth_%` databases; the cluster was then stopped and its data directory deleted.

## Questions for engineer

1. **Better Auth scope.** The pinned library is not imported or activated: this contract supplies the adapter boundary that keeps tokens hash-only, and the README records what a Better Auth adapter must do (hash-map token lookups, revoke by `UPDATE`, disable cookie cache, enforce 30/90 ceilings, map model/field names). If the intended reading of "prove library hooks/adapter keep tokens hash-only" was to instantiate the library now, that needs a follow-up contract, because activation would also require schema/field mapping and its own schema validation.
2. **Retained verifier import.** `server.mjs` wires the existing bounded scrypt verifier from `src/passwords.mjs` as the explicit ADR03 compatibility path; unknown schemes fail closed after the same dummy derivation. AUTH-003 replaces this with the versioned password-policy module. Confirm that transient concrete import is acceptable, or that AUTH-003 should introduce an interface module first.
3. **Operator realm.** `/v1/auth` refuses local operator login with `403 OPERATOR_ASSERTION_REQUIRED`; operator sessions are asserted-identity work in AUTH-007. Confirm no temporary local operator password path is wanted.
4. **No rate limit.** Brute-force throttling is not implemented here (AUTH-003 owns login/reset throttles), and the retained native `auth_limits` logic was deliberately not ported. Confirm this split.
5. **`/auth` aliases.** None were added: only `/v1/auth/*` exists, so no compatibility surface is implied before the cutover decision.

## Deviations from contract

- None in the code or gate. One process deviation to disclose: the dispatcher had already created `/home/esc/saven/wt-auth-002`, and my first write landed in it before I registered the worktree. I moved that single new file aside, removed and re-added the worktree, and restored it; the branch ref was never rewritten and remains based on `d0a50cd`. No pre-existing work was present in that directory beyond the clean `testing-1` checkout, and nothing else was lost.
- The session adapter is implemented as a first-party module rather than a Better Auth plugin instance (question 1). Rotation is exposed on the store (used by privilege/credential change paths) and audited by callers; AUTH-009 owns full event coverage.

## EXTENSIBILITY

compliant — realms, assurance roles and audit events are reference rows, not code lists; the store is behind an interface with no concrete module imports except the explicit retained password adapter; the routes are versioned (`/v1/auth`); nothing narrows the existing SQLite path, and the Better Auth activation remains additive through the documented adapter boundary.

## GIT

branch=opencode/auth-002-sessions commit=`50eab39` pushed=yes

# AUTH-002-R1 revision — 15 November 2026

Verdict and corrections: `docs/contractor/reviews/AUTH-002-sessions.md` delivered at
`a253807` on `codex/pivot-003-rulings`. Contract executed: the `IF REVISE` block of
that review, on branch `opencode/auth-002-sessions` (base `d0a50cd`). Implementation
commit `a788861`, plus this report commit.

Scope stayed exactly on TOUCH. No package, schema, migration, native route, connector,
MFA or rate-limit change was made.

## Finding 1 — atomic successful transitions

The store now requires a pool with `connect()` and exposes `withTransaction`, which
runs `BEGIN`/`COMMIT`/`ROLLBACK` on one checked-out client. Login creates the session
and writes `login_success` through that same client and only returns the cookie after
commit. Logout locks and validates the session, revokes and writes `logout` in one
transaction. Failed-login audit is intentional autocommit, so a refused attempt is
still recorded.

Evidence (`AUTH-002 success and audit commit atomically while failure audit stays durable`):

- injected `login_success` audit failure → HTTP 503, no cookie, zero session rows, zero
  success audit rows (rollback observed in stored state, not just the response);
- injected `logout` audit failure → HTTP 503, `revoked_at` still NULL, session still
  usable, zero logout audit rows;
- failed login still leaves exactly one durable `login_failure` row.

## Finding 2 — race-safe, non-resurrectable lifecycle

- `rotateSession` selects the source `FOR UPDATE`, re-validates revoked, idle, absolute,
  user status and credential epoch at the mutation boundary, inserts one successor with
  the original absolute ceiling, consumes the source with a conditional `UPDATE`, and
  rolls back if the source cannot be consumed.
- `refreshSession` is a guarded `UPDATE … FROM auth.users` that only matches a live,
  unexpired, active, current-epoch row; it can never revive an idle-expired row.
  `/v1/auth/me` fails closed when the refresh matches nothing (no stale success and no
  blanket-suppressed rejection).

Evidence:

- two concurrent `rotateSession` calls → exactly one successor, one live session, source
  revoked with `privilege_change`, second call returns `null`;
- rotation after revoke → `null`; rotation after idle expiry (before absolute) → `null`,
  row untouched;
- refresh after idle expiry → `null`;
- a rolled-back rotation (thrown after successor insert) leaves the source live, no
  successor, and the returned successor token does not resolve.

## Finding 3 — bounded configuration and effective dates

`resolveSessionConfig` now rejects non-integer, non-positive, reordered or
over-ceiling values (`idleMs ≤ 30 days`, `absoluteMs ≤ 90 days`), and requires 32–64
random token bytes. Shorter policies remain supported and are exercised (1h idle / 2h
absolute spans asserted). Realm and assurance-role lookups now check both
`effective_from <= now` and `effective_to` using the same injected application clock as
session expiry; a future-dated realm and a future-dated role are both refused. The
README states that the injected clock is authoritative and that the database supplies
structural constraints and the immutable ceiling only.

## Finding 4 — pinned-library adapter proven

`createBetterAuthSessions` (in `server.mjs`) instantiates the pinned `better-auth`
with a custom adapter over the canonical schema. It hashes the raw token before every
SQL statement, maps the library's session `expiresAt` to `idle_expires_at` capped by
the immutable `absolute_expires_at`, converts library delete/deleteMany into
revocation `UPDATE`s, joins `auth.users` for session validation, disables cookie cache
and disables library schema validation. The gate drives the library's own
`internalAdapter.createSession` / `findSession` / `updateSession` / `deleteSession` and
asserts: strong token, digest-only row, wrong token unresolved, refresh cannot move the
ceiling, revoke is a revocation row, revoked token unresolved, and no plaintext token
in any SQL text or parameter.

This is still an isolated composition path: no entry point, connector, MFA/passkey
plugin or profile was activated, and no pin changed. Accounts/verification/plugin model
parity remains future work, which the README now states explicitly along with the fact
that a working realm needs the fixed `REALMS` cookie/request map and exact origin, not
just a reference row.

## Finding 5 — real runtime role and corrected spy

Every lifecycle, race, failure, rotation and library test now runs through a real
non-owner login created for the test and granted only the fixture's namespaced
`auth_service` role; fixture administration is used only for setup and observation.
The SQL-boundary spy wraps that real-role pool. The spy case now calls
`revokeAllSessions(userId)` with the verified user id (previously a session id).
Assertions include: the auth-service principal cannot `ALTER TABLE auth.sessions`
(SQLSTATE 42501), and the observation connection remains administrative.

## DONE WHEN evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs && node --test tests/auth-002-sessions.test.mjs
PASS: 153 JavaScript files parsed; package manifest valid.
✔ AUTH-002 login persists only a digest and issues a host-only secure cookie (559.045588ms)
✔ AUTH-002 sessions fail closed on expiry, revocation, disablement and credential epochs (982.127344ms)
✔ AUTH-002 activity extends idle expiry but never the absolute ceiling (468.624353ms)
✔ AUTH-002 rotation is serialized, preserves the ceiling and cannot be replayed (547.087405ms)
✔ AUTH-002 rotation and refresh cannot revive an idle-expired session (512.347902ms)
✔ AUTH-002 success and audit commit atomically while failure audit stays durable (689.326712ms)
✔ AUTH-002 CSRF, origin, content-type and field boundaries refuse client authority (472.51555ms)
✔ AUTH-002 failures are non-enumerating and audited without secrets (657.592929ms)
✔ AUTH-002 plaintext tokens never cross the database boundary on the real role (495.857234ms)
✔ AUTH-002 configuration enforces ADR ceilings and effective dates (385.206055ms)
✔ AUTH-002 lifecycle and failure paths run under the real auth-service role (510.900505ms)
✔ AUTH-002 pinned Better Auth drives the digest-only session lifecycle (743.262916ms)
✔ AUTH-002 cookie policy distinguishes realms and local fixtures (0.490829ms)
ℹ tests 13
ℹ pass 13
ℹ fail 0
ℹ skipped 0
```

Exit `0`. Full suite on the same runtime/cluster: `182` tests, `182` pass, `0` fail,
`0` skipped. Without the dedicated-cluster opt-in: exit `1`, one database-independent
pass and twelve refusals.

Environment: Node `v24.19.0`; dedicated disposable PostgreSQL 18.6 cluster on loopback
`127.0.0.1:55441`; fixture-created `saven_auth_*` objects and the per-test auth-service
login were removed; post-gate queries returned no `saven_auth_%` roles or databases;
the cluster was stopped and its data directory deleted.

## R1 questions, deviations and cleanup

- Questions: none blocking. The library adapter covers sessions only; accounts,
  verification, 2FA/passkey and OIDC remain later contracts, as the review's scope
  allows. If the engineer wants the library's account/verification models mapped now,
  that is a separate contract, not an AUTH-002 change.
- Deviations: the test clock starts at real current time so seeded `effective_from`
  rows are effective while remaining advanceable; the test login is created with
  `INHERIT` (not `NOINHERIT`) so it actually receives the auth-service grants while
  still owning nothing; both are test scaffolding choices and are documented above.
- Cleanup: cluster stopped, data directory and `var/` logs deleted, `node_modules`
  symlink removed, no cluster objects left.

## GIT (R1)

branch=opencode/auth-002-sessions commits=`a788861`,report commit pushed=yes
