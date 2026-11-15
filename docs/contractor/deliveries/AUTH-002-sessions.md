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
