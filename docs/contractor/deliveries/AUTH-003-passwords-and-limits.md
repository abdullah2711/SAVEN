CONTRACT: docs/contractor/contracts/AUTH-003-passwords-and-limits.md
STATUS: DONE — versioned Argon2id/scrypt password policy, upgrade-on-success and durable non-enumerating throttling are implemented and gated; the SQLite `/api` path is untouched.

## Identity

- Branch: `opencode/auth-003-passwords`, base `testing-1` at `70dde6bfe030a34c27ad2fa97073f452d1d4299d`.
- Commit: `42899ec` (implementation and tests), plus this report commit.
- Worktree: `/home/esc/saven/wt-auth-003`.
- Node `v24.19.0`; disposable PostgreSQL 18.6 on loopback `127.0.0.1:55443` (stopped and deleted after the gate). Native `crypto.argon2` is used, so no package change and no new dependency.

## Files changed

- `src/auth/password-policy.mjs` — versioned policy, Argon2id hashing/verification through Node's native binding, retained bounded scrypt compatibility, upgrade-on-success, fail-closed dummy work for absent/unknown verifiers, bounded input and KDF concurrency.
- `src/auth/rate-limit.mjs` — durable throttle ledger over `auth.auth_audit`, pseudonymous scopes, advisory-locked atomic attempt accounting, configurable validated policy, trusted-ingress handling.
- `src/auth/routes.mjs` — sign-in now runs throttle lock, limit check, verification, conditional rehash, session creation and audit in one transaction; adds `/v1/auth/forgot-password` sharing the policy and sending nothing.
- `src/auth/README.md` — policy, throttling semantics, trusted ingress, reset deferral, extension points and D-012 digest-only statement.
- `tests/auth-003-passwords.test.mjs` — 10 focused tests.
- `docs/contractor/deliveries/AUTH-003-passwords-and-limits.md` — this report.

No path outside TOUCH plus the report changed. `src/local`, `public`, `postgresql`, `archive`, `package.json`, migrations and schema files are untouched.

## Invariant coverage

| Invariant | Evidence |
| --- | --- |
| Argon2id preferred, bounded scrypt retained | New verifiers are `$argon2id$v=19$m=65536,t=3,p=1$…` through native `crypto.argon2`; retained `scrypt$1$32768$8$1$…` verifiers still verify. |
| No bcrypt / plaintext | `bcrypt$…` and plaintext verifiers fail closed; stored and returned verifiers never contain the password; audit rows contain neither password nor hash. |
| Timing-safe dummy verification | Unknown account, absent verifier, unknown scheme and absurd stored Argon2 parameters all run bounded dummy work and return the same generic failure. |
| Bounded KDF/input | Input bounds (12–128 chars, ≤512 bytes, no NUL); Argon2 parameters re-bounded before verification; at most two concurrent derivations, extra work refused `429 PASSWORD_BUSY`. |
| Upgrade on success | A retained scrypt login is rehashed to Argon2id inside the same transaction, conditional on an unchanged verifier; the success audit records `rehashed: true`; a current verifier is not rehashed again. |
| Trusted-ingress rate identity | Scopes are realm + account digest, plus a network digest only when a deployment explicitly names the trusted header. A spoofed `x-forwarded-for` does not create a scope by default; with `cf-connecting-ip` named, the network scope blocks another account, while a different trusted address is a separate scope. |
| Deterministic configurable lockout | Validated policy (limit 1–1000, window 1 min–24 h). Tests use 3/60 s and 2/60 s deterministically; windows expire by the injected clock; Retry-After is bounded by the window. |
| Concurrent failures cannot bypass limits | Eight simultaneous wrong attempts against limit 3 produce exactly three `401`s, five `429`s and exactly three failure rows — the lock, count and attempt row share one transaction per scope. |
| Shared audited login/reset policy | Both endpoints use the same limiter, ledger and audit family; reset requests record `password_reset_requested` with `delivery: deferred_to_auth_005`, create no verification token and send no mail. |
| Non-enumeration | Known and unknown accounts produce identical failure bodies and throttle their own histories identically; throttled known/unknown bodies are identical; no reset response reveals existence. |
| No secret logging | Audit rows contain no password, no raw email and no raw ingress value; only 64-hex scope digests and generic reasons. |
| Append-only audit / no new grants / no ownership | Counters are append-only `auth.auth_audit` rows; no schema, grant, migration or ownership change; the module issues no DDL. |

## Gate evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs && node --test tests/auth-003-passwords.test.mjs
PASS: 158 JavaScript files parsed; package manifest valid.
✔ AUTH-003 password policy prefers Argon2id and retains bounded scrypt (1261.975459ms)
✔ AUTH-003 KDF concurrency is bounded and overload is refused (211.979624ms)
✔ AUTH-003 a successful sign-in upgrades a retained scrypt verifier (1173.673102ms)
✔ AUTH-003 login throttling is deterministic, durable and non-enumerating (1708.309542ms)
✔ AUTH-003 a successful sign-in resets the failure window (1553.242233ms)
✔ AUTH-003 concurrent failures cannot slip past the configured limit (1151.024878ms)
✔ AUTH-003 throttle scopes ignore spoofed forwarding headers unless configured (1691.015998ms)
✔ AUTH-003 password-reset requests share the throttle policy and send nothing (486.642102ms)
✔ AUTH-003 audit records throttle digests and never raw secrets (925.238405ms)
✔ AUTH-003 rate policy rejects unsafe configuration (0.699447ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
ℹ skipped 0
```

Exit `0`. Without the dedicated-cluster opt-in: exit `1`, three database-independent passes (policy, concurrency-bound unit, policy validation) and seven refusals before mutation.

Full branch suite on the same runtime and cluster (215 tests): 214 pass, 1 fail — **pre-existing and outside TOUCH**: `PIVOT-004 resists an extra permissive policy and an attacker permissive policy on auth` fails with `role "saven_customer_app" does not exist` when run alone against a fresh disposable cluster. I reproduced the identical failure from the untouched `testing-1` worktree, so it is not caused by this delivery; it needs an engineer decision on the PIVOT-004 fixture/cluster prerequisite.

Environment: fixture objects and databases removed; post-gate queries returned no `saven_auth_%` roles or databases; cluster stopped and data directory deleted; `node_modules` symlink removed.

## Questions for engineer

1. **Throttle storage.** TOUCH excludes schema files, so durable counters use the append-only audit ledger (documented extension point for a dedicated indexed table later). Confirm that is acceptable for Phase 1, or schedule the rate-limit table in a migration contract.
2. **Policy values.** `RATE_LIMIT_DEFAULTS` (8 login failures / 5 reset requests per 15 min) are bootstrap values, explicitly not approved production policy. Which configuration surface should carry reviewed per-deployment limits — environment, a versioned JSON policy file, or a policy table?
3. **Forget-password stub.** `/v1/auth/forgot-password` answers `202`, audits `password_reset_requested` with `delivery: deferred_to_auth_005`, and sends nothing. Confirm AUTH-005 keeps this route and replaces only the delivery internals.
4. **Trusted ingress.** The header is default-off and must be named explicitly. Confirm the operator tunnel/proxy header name (`cf-connecting-ip` in tests is illustrative) and that default-off remains correct for Fully Private deployments.
5. **Node floor.** Argon2id relies on native `crypto.argon2`, which requires the pinned Node `>=24.13 <25` already declared in `package.json`/`.nvmrc`. Confirm that floor is fixed for deployment, since an older runtime would lose the preferred KDF.
6. **PIVOT-004 full-suite failure.** As above — reproduced on `testing-1`; not touched by AUTH-003.

## Deviations from contract

- None in scope or TOUCH. Design notes: the upgrade-on-success rehash executes one parameterized `UPDATE auth.users` inside the sign-in transaction from `routes.mjs`, because `server.mjs`/`session-store.mjs` are outside this contract's TOUCH; it is conditional on the unchanged verifier and covered by tests.
- The rate limiter intentionally serialises attempts per scope by holding the advisory lock across the bounded KDF; this bounds concurrency to the configured limit instead of allowing burst overshoot. It is documented in the README.

## EXTENSIBILITY

compliant — KDF schemes, parameters, thresholds and trusted headers are explicit configuration with validation; no hardcoded growing business domains; no cross-module concrete coupling beyond the auth boundary; the audit-ledger storage is a reversible Phase 1 choice with a documented indexed-table path.

## GIT

branch=opencode/auth-003-passwords commit=`42899ec` pushed=yes
