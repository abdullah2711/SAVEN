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

# AUTH-003-R1 revision — 16 November 2026

Verdict and corrections: `docs/contractor/reviews/AUTH-003-passwords-and-limits.md` at
`56b1955` on `codex/pivot-003-rulings`. Contract executed: its Required corrections 1–5,
on branch `opencode/auth-003-passwords`. Implementation commit `2f7cc80`, plus this
report commit. TOUCH stayed exact; `server.mjs` and PIVOT-004 were not edited.

## Finding 1 — admission covers every derivation, with absolute caps

- `createPasswordPolicy` now routes hash, Argon2id verify, retained scrypt verify and
  dummy verification through one `derive()` admission gate. The gate is `async` and
  releases the counter only after the awaited derivation, so concurrent work is truly
  bounded; overload throws `429 PASSWORD_BUSY` before any native job starts.
- Absolute protocol caps (`ABSOLUTE_KDF_LIMITS`) bound memory (262144 KiB), passes (10),
  parallelism (8), tag (64) and salt (64). Policy values and verification caps may only
  lower these; `validatePolicy` rejects attempts to raise them, and the verification path
  re-checks stored parameters plus decoded salt/tag lengths before native allocation.
- Oversized, non-string and NUL input is replaced by a fixed bounded dummy input, so raw
  bytes never reach a KDF buffer.
- Instrumented evidence records every derivation (`kind`, memory, passes, parallelism,
  input bytes): absent, malformed, unknown and valid-but-wrong verifiers all produce the
  same configured workload and bounded input, and a mixed burst under `maxConcurrentKdfs:
  1` yields exactly one fulfilled and two `PASSWORD_BUSY` rejections, with the counter
  unwinding and a later verification succeeding.

## Finding 2 — dummy path normalized and comparable

- The dummy derivation uses the normal configured memory/passes/parallelism (not one
  pass), so unknown, absent, malformed and hostile stored verifiers do comparable work to
  a real wrong-password verification.
- Hostile verifier parameters, malformed base64 salt/tag, and native provider throws are
  normalized to a bounded `valid: false`; they no longer escape as 503s. Provider failure
  is injected in tests and proven to return a credential failure.
- Compatibility limit documented honestly: retained scrypt performs different work than
  the Argon2id dummy, so a legacy scrypt account's failure timing differs until the
  successful upgrade replaces it; both paths share the same admission gate.

## Finding 3 — exceptional attempts are durably accounted; ingress sanitized

- Verification, rehash, session and success-audit failures roll the attempt transaction
  back (no session, no cookie) and are then recorded on an independent autocommit path
  carrying the post-lock order, so they consume the budget. Tests inject verifier,
  rehash and busy failures and assert `503`, no `Set-Cookie`, zero new sessions, a
  `login_failure` row with `provider_or_store_error`/`password_busy`/`transaction_uncertain`,
  and `429` on the next attempt at limit 1.
- An audit-store failure is distinguished (`AuditWriteError`) and fails closed with
  `503 AUTH_ACCOUNTING_UNAVAILABLE` without claiming durable accounting — the stated
  evidence limit. A store-level commit-uncertainty keeps its `SESSION_TRANSACTION_UNCERTAIN`
  code after accounting.
- Ingress is sanitized at the trusted boundary: only an explicitly configured header with
  a syntactically valid IP is used (scope, session row, audit). All socket headers
  (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, `forwarded`, …) are stripped from
  the request view passed to the retained audit writer. Tests prove a malformed untrusted
  `cf-connecting-ip` cannot break the failure audit, an untrusted valid IP is stored
  nowhere, a trusted valid IP is stored on session and audit, and an invalid trusted value
  is discarded without error.

## Finding 4 — authoritative post-lock ordering

- Throttle counting no longer uses PostgreSQL `occurred_at` (transaction-start time).
  Every accounted attempt stores the application-clock time sampled *after* the scope
  lock (`attempt_at`) and `pg_current_xact_id()` sampled at the same point
  (`attempt_order`). Counting orders failures against the latest success by
  `attempt_order` and windows by `attempt_at`; the transaction id resolves equal
  timestamps unambiguously. No append-only row is updated or rewritten.
- Tests cover: a lower-order failure with equal time is reset by a later success; two
  equal-time failures after a success reach the limit; a correctly ordered failure older
  than the window does not count; and concurrent login/reset attempts each carry a unique
  post-lock order.

## Finding 5 — restricted role and real composition

- Tests create a real non-owner login granted only the fixture's `auth_service` role and
  drive the retained `createAuthServer` composition root: a retained scrypt sign-in
  returns 200, the conditional rehash `UPDATE` upgrades the verifier to Argon2id, the
  session is inserted, audit reads/inserts succeed, and the composed default policy
  throttles on the ninth failure.
- The same connection is proven unable to `ALTER TABLE auth.sessions` (`42501`) and
  unable to read `operator.tenant` (`42501`), with the role identity asserted as the
  restricted login.

## Dispositions and remaining limits

- Thresholds remain deployment-controlled and versioned; no numeric value here is
  claimed as production policy. The retained `createAuthServer` forwards neither rate
  policy nor trusted-ingress configuration, so its defaults are not reviewed deployment
  policy: a narrow `server.mjs` composition contract is required before activation. That
  file is outside this TOUCH and was not edited.
- Audit-ledger scope scans are Phase-1; indexed storage/performance needs a separate
  migration contract with measured evidence.
- `forgot-password` remains a generic, throttled, mail-free route for AUTH-005 to extend.
- `.nvmrc = 24.19.0` and `node >=24.13 <25` are preserved; Argon2id uses the pinned Node
  24 `crypto.argon2` API.
- PIVOT-004 full-suite failure remains pre-existing and untouched (reproduced from the
  base worktree earlier); it is routed to the engineer and the full suite is not claimed
  green.

## DONE WHEN evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs && node --test tests/auth-003-passwords.test.mjs
PASS: 158 JavaScript files parsed; package manifest valid.
✔ AUTH-003 password policy prefers Argon2id and retains bounded scrypt (1699.458501ms)
✔ AUTH-003 KDF concurrency is bounded and overload is refused (205.894151ms)
✔ AUTH-003 a successful sign-in upgrades a retained scrypt verifier (1135.367398ms)
✔ AUTH-003 login throttling is deterministic, durable and non-enumerating (1937.594112ms)
✔ AUTH-003 a successful sign-in resets the failure window (1507.913322ms)
✔ AUTH-003 concurrent failures cannot slip past the configured limit (1124.458378ms)
✔ AUTH-003 throttle scopes ignore spoofed forwarding headers unless configured (1920.504827ms)
✔ AUTH-003 password-reset requests share the throttle policy and send nothing (474.732876ms)
✔ AUTH-003 audit records throttle digests and never raw secrets (887.540744ms)
✔ AUTH-003 rate policy rejects unsafe configuration (0.622877ms)
✔ AUTH-003-R1 every verification path is admitted and uses comparable work (1449.294428ms)
✔ AUTH-003-R1 admission covers dummy and mixed paths and recovers after overload (612.153358ms)
✔ AUTH-003-R1 provider failures are normalized, never escaped (0.679009ms)
✔ AUTH-003-R1 exceptional attempts are durably accounted and publish nothing (1103.088758ms)
✔ AUTH-003-R1 accounting failure fails closed and reports the evidence limit (625.811692ms)
✔ AUTH-003-R1 untrusted ingress headers never reach audit or session storage (1359.207937ms)
✔ AUTH-003-R1 ordering follows serialized post-lock attempts, with ties resolved (520.102524ms)
✔ AUTH-003-R1 restricted auth-service role and composition path (2338.378202ms)
ℹ tests 18
ℹ pass 18
ℹ fail 0
ℹ skipped 0
```

Exit `0`. Without the dedicated-cluster opt-in: exit `1`, six database-independent
passes (policy, admission, provider normalization, rate policy validation and the
bounded-input units) and twelve refusals.

Full branch suite on the same runtime/cluster: `223` tests, `222` pass, `1` fail —
the pre-existing `PIVOT-004 resists an extra permissive policy and an attacker permissive
policy on auth` (`role "saven_customer_app" does not exist`) reproduced from the
untouched base. Not claimed green, not attributed to this patch.

Environment: disposable PostgreSQL 18.6 on loopback `127.0.0.1:55443`, fixture objects
and per-test auth-service logins removed, cluster stopped and deleted, no `saven_auth_%`
objects left.

## GIT (R1)

branch=opencode/auth-003-passwords commits=`2f7cc80`,report commit pushed=yes
