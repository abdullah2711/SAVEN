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

# AUTH-003-R2 revision — 16 November 2026

Verdict and corrections: `docs/contractor/reviews/AUTH-003-R1-passwords-and-limits.md` at
`ce520d0`. Contract executed: its three Required corrections, on branch
`opencode/auth-003-passwords`. Implementation commit `1223f95`, plus this report commit.
TOUCH stayed exact; `server.mjs`, schema, grants, dependencies and PIVOT-004 untouched.

## Finding 1 — invalid input can never authenticate

- Input validity is now a separate `inputValid` flag. Non-string, empty, oversized and
  NUL-containing input performs the same bounded admitted dummy derivation and then
  returns `valid: false`, `needsRehash: false`, `inputValid: false` unconditionally — it
  is never compared with the stored verifier. The dummy string is not banned.
- Adapter regression: a verifier deliberately created from the exact public dummy string
  rejects `undefined`, `null`, numeric, empty, 20 000-character and NUL-bearing input for
  both Argon2id and retained scrypt, never requests a rehash, and still accepts the real
  dummy string (with scrypt still flagged for upgrade).
- Route regression: a user whose password is the dummy string gets `401` and no cookie
  for each ill-formed body, zero sessions, an unchanged verifier, and `200` only for the
  actual valid string. A short string is treated as a well-formed wrong credential, not
  an invalid shape.

## Finding 2 — reservation before work, serialized with admission

- `createRateLimiter.attempt` now: takes a **session-scoped** advisory lock per scope on
  one checked-out client; in a short transaction re-checks the budget and commits either
  a denied row or a reservation row carrying the post-lock time/order; only then calls
  the caller's action (verification plus its own atomic success transaction); releases
  the lock at the end. The reservation is durable before any KDF starts, a waiting
  concurrent attempt cannot observe an unrecorded attempt, and a crash after the
  reservation leaves a counted attempt while a crash before it leaves none.
- Successful rehash + session + success audit remain one atomic transaction; the success
  row's later transaction order resets the reservation for that scope.
- Audit-store failure during reservation fails closed with
  `503 AUTH_ACCOUNTING_UNAVAILABLE` and opens a cooldown breaker; requests during the
  cooldown are refused **before** any KDF admission. Tests assert zero derivations across
  three consecutive audit-down requests and recovery after the cooldown with a healthy
  store.
- A later success-audit failure leaves the durable reservation counted, withholds the
  cookie, rolls the session transaction back, and cools down admission; after cooldown
  the next attempt is throttled.
- Paused-reservation test: while the first reservation's audit write is paused, a
  concurrent same-scope request starts no KDF (derivations 0); with limit 1 exactly one
  request is evaluated, one is throttled, one admitted derivation runs and exactly one
  durable attempt row exists.
- Commit ambiguity is documented rather than denied: a lost commit acknowledgement
  withholds all credentials but is not evidence that the row does not exist.
- Ordering: `attempt_at`/`attempt_order` are sampled after the lock; the real
  delayed-lock/closing interleaving is covered by the paused-reservation test plus the
  synthetic order/ties/window test. Transaction identifiers reflect allocation order, so
  the post-lock/no-earlier-allocation precondition is stated rather than generalised.

## Finding 3 — one canonical ingress identity everywhere

- `canonicalizeIp` validates and canonicalises once (IPv4 dotted decimal, IPv6 compressed
  and lower-cased through the URL parser) and returns null for anything invalid.
- The same canonical value feeds the limiter scope for **both** login and forgot-password,
  the session row and audit metadata; `throttleScopes` no longer receives a raw request.
- Tests: invalid configured values create no network scope and cannot break the failure
  audit; equivalent IPv6 spellings share one budget across login and reset; default-off
  headers stay ignored; untrusted addresses are stored nowhere.

## Dispositions and remaining limits

- Thresholds and the trusted-ingress header remain deployment-controlled and versioned;
  no numeric production policy or header is approved. The retained `createAuthServer`
  still cannot forward rate policy/trusted header (needs a narrow `server.mjs` contract).
- Audit-ledger scope scans remain Phase-1; indexed storage/load evidence needs its own
  contract. Mail/reset tokens remain AUTH-005. `.nvmrc`/Node pins and native Argon2id
  preserved.
- `operator.tenant` denial is an operator-directory negative, not a financial-table test;
  the auth-schema negative grants from AUTH-001 remain the broader evidence.

## Out-of-TOUCH test expectations that now need an engineer update

The corrected semantics intentionally change two accepted AUTH-002 assertions, which are
outside this TOUCH and were not edited:

1. `tests/auth-002-sessions.test.mjs:368` — after an injected success-audit failure the
   next attempt is now `503 AUTH_ACCOUNTING_UNAVAILABLE` during the accounting cooldown
   (fail-closed admission), not `401`. The test needs to advance the clock/cooldown or
   use a fresh server before expecting `401`; its later "exactly one failure row"
   assertion also predates durable reservations.
2. The same file's commit-uncertainty case expects `SESSION_TRANSACTION_UNCERTAIN`, but
   the intercepted COMMIT is now the reservation commit, which fails closed as
   `AUTH_ACCOUNTING_UNAVAILABLE` (no session work had begun). The assertion needs to
   target the success-transaction commit or accept the accounting code.

Full branch suite on the corrected source: `227` tests, `224` pass, `3` fail — the two
stale AUTH-002 assertions above plus the pre-existing PIVOT-004 fixture prerequisite
(`role "saven_customer_app" does not exist`), which is not attributed to this patch. The
suite is not claimed green and PIVOT-004 was not touched.

## DONE WHEN evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs && node --test tests/auth-003-passwords.test.mjs
PASS: 158 JavaScript files parsed; package manifest valid.
✔ AUTH-003 password policy prefers Argon2id and retains bounded scrypt (1722.015908ms)
✔ AUTH-003 KDF concurrency is bounded and overload is refused (203.321278ms)
✔ AUTH-003 a successful sign-in upgrades a retained scrypt verifier (1140.225525ms)
✔ AUTH-003 login throttling is deterministic, durable and non-enumerating (1977.559025ms)
✔ AUTH-003 a successful sign-in resets the failure window (1557.29112ms)
✔ AUTH-003 concurrent failures cannot slip past the configured limit (1116.970346ms)
✔ AUTH-003 throttle scopes ignore spoofed forwarding headers unless configured (1933.257141ms)
✔ AUTH-003 password-reset requests share the throttle policy and send nothing (484.471304ms)
✔ AUTH-003 audit records throttle digests and never raw secrets (971.897017ms)
✔ AUTH-003 rate policy rejects unsafe configuration (0.710728ms)
✔ AUTH-003-R1 every verification path is admitted and uses comparable work (1419.151917ms)
✔ AUTH-003-R1 admission covers dummy and mixed paths and recovers after overload (615.983584ms)
✔ AUTH-003-R1 provider failures are normalized, never escaped (0.805123ms)
✔ AUTH-003-R1 exceptional attempts are durably accounted and publish nothing (1406.673128ms)
✔ AUTH-003-R1 audit-store failure fails closed before KDF admission and recovers (694.113098ms)
✔ AUTH-003-R1 reservations are serialized: paused logging blocks concurrent work (734.114314ms)
✔ AUTH-003-R1 a post-reservation audit failure keeps the attempt counted and withholds credentials (676.996755ms)
✔ AUTH-003-R1 untrusted ingress headers never reach audit or session storage (1316.621487ms)
✔ AUTH-003-R1 ordering follows serialized post-lock attempts, with ties resolved (505.330311ms)
✔ AUTH-003-R1 restricted auth-service role and composition path (2344.596264ms)
✔ AUTH-003-R1 invalid input never authenticates through the dummy substitution (5666.054679ms)
✔ AUTH-003-R1 ingress identity is canonical, validated and shared by both endpoints (917.083159ms)
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ skipped 0
```

Exit `0`. Without the dedicated-cluster opt-in: exit `1`, six DB-free unit passes and
sixteen refusals.

Environment: disposable PostgreSQL 18.6 on loopback `127.0.0.1:55443`; fixture objects
and per-test auth-service logins removed; cluster stopped and deleted; no `saven_auth_%`
objects remain.

## GIT (R2)

branch=opencode/auth-003-passwords commits=`1223f95`,report commit pushed=yes

# AUTH-003-R3 revision — 16 November 2026

Verdict and corrections: `docs/contractor/reviews/AUTH-003-R2-passwords-and-limits.md` at
`dcd801a`, with the engineer's narrow extra TOUCH amendment in the AUTH-003 contract
(`session-store.mjs` client/transaction helpers; affected AUTH-002 atomic-audit and
transaction-uncertainty cases). Implementation commit `370b671`, plus this report commit.
No `server.mjs`, schema, grant, dependency or PIVOT-004 change.

## Finding 1 — no nested pool checkout while locks are held

- The throttling lease now owns one client for the whole attempt. After the reservation
  commits, the caller runs its success transaction **on that same client**
  (`store.withClientLease` + `lease.transaction`, backed by `transactionOn`), so a
  correct login never asks the pool for a second connection while holding its locks.
- `transactionOn` preserves atomic rehash + session + success audit and still maps a
  lost COMMIT to `SESSION_TRANSACTION_UNCERTAIN` with the credential withheld.
- Real-role bounded-time tests: a restricted auth-service login on a **max=1** pool
  completes a correct login (15 s bound, measured ~0.7 s); a **max=2** saturated pool with
  three same-scope concurrent successes completes all three (30 s bound, measured ~1.1 s).
  The prior wrong-password-only concurrency tests are no longer the only coverage.

## Finding 2 — locks and uncertain clients are destroyed, not recycled

- `rate-limit.attempt` tracks every acquired scope lock from the first acquisition,
  unwinds in reverse, and checks each `pg_advisory_unlock` result.
- The leased client is destroyed when: the second (or later) lock acquisition fails,
  an unlock errors or returns non-true, the acquired count does not match the expected
  scope count, the reservation COMMIT outcome is unknown (even when ROLLBACK succeeded),
  or the reservation ROLLBACK fails. No contaminated connection is returned to the pool.
- Tests with an instrumented real-role pool assert `release(true)` for each of those
  cases and then prove a **subsequent borrower is uncontaminated** (401/200 as expected,
  no hang) on the same size-one pool. Another test covers a failed ROLLBACK after a
  reservation audit failure, again followed by a healthy borrower.
- Session advisory locks require a pinned backend: the limiter refuses
  `poolingMode: 'transaction'` at construction and documents direct/session pooling only.
  This is lock lifecycle, not tenant session state.

## Finding 3 — AUTH-002 reconciliations (authorized)

- `AUTH-002 success and audit commit atomically…` now distinguishes the durable
  reservation from the later success transaction: success-audit failure yields
  `503 AUTH_ACCOUNTING_UNAVAILABLE`, no cookie, zero sessions, zero success rows, one
  durable reservation; after advancing past the accounting cooldown the following failed
  login is evaluated and both attempts remain counted. Logout rollback assertions are
  unchanged.
- `AUTH-002-R2 unknown commit outcomes…` now injects at distinct boundaries:
  reservation COMMIT uncertainty → `503 AUTH_ACCOUNTING_UNAVAILABLE`, no session work,
  destroyed client; success COMMIT uncertainty → `SESSION_TRANSACTION_UNCERTAIN`, no
  cookie, destroyed client, reservation still durable, with the ambiguity documented;
  failed ROLLBACK after success-audit failure → destroyed client; a healthy control run
  still succeeds. Raw-token SQL protections, D-012 outward digest-only data and logout
  rollback remain untouched.

## Documentation reconciliation

Removed the obsolete `durableExceptional` path/comments and rewrote README/routes text
that still described a single combined transaction or a post-rollback autocommit write.
The README now states one design: committed reservation under a session lock, then the
success transaction on the same leased client, with destroy-on-uncertainty and the
pooling-mode requirement. Retained honest statement: an uncertain COMMIT withholds
credentials but may have persisted rows.

## DONE WHEN evidence (AUTH-003 plus the amended AUTH-002 gate)

```text
$ node --version
v24.19.0
$ node scripts/check.mjs && node --test tests/auth-003-passwords.test.mjs
PASS: 158 JavaScript files parsed; package manifest valid.
ℹ tests 26
ℹ pass 26
ℹ fail 0
ℹ skipped 0
$ node --test tests/auth-002-sessions.test.mjs
ℹ tests 18
ℹ pass 18
ℹ fail 0
ℹ skipped 0
```

Exit `0` for both. Without the dedicated-cluster opt-in, the AUTH-003 file exits `1`
with 6 database-independent passes and 20 refusals.

Combined branch suite on the same runtime/cluster: `231` tests, `230` pass, `1` fail —
only the pre-existing PIVOT-004 fixture prerequisite (`role "saven_customer_app" does not
exist`), which remains out of scope and untouched. The earlier AUTH-002 regressions are
closed; no new suite failure is introduced.

Environment: disposable PostgreSQL 18.6 on loopback `127.0.0.1:55443`, fixture and
per-test auth-service objects; earlier interrupted runs had left fixture databases/roles
on the throwaway cluster, and the whole cluster (including those objects) was stopped and
deleted after the gate. `node_modules` symlink removed.

## Evidence boundaries

- Fault/cleanup injections run on real restricted auth-service logins for the pool
  starvation and principal tests; some injected-error cases still use the administrative
  fixture connection purely to force failures (release/destroy assertions are on the
  actual pool). Stated rather than generalised.
- Pool/backend requirements are explicit: direct or session pooling only; transaction
  pooling is refused. No deployment runtime upgrade is claimed.
- Thresholds and trusted ingress remain deployment-controlled; `createAuthServer` still
  cannot forward them (needs the narrow `server.mjs` contract). Mail/reset remains
  AUTH-005; indexed rate-limit storage/load evidence remains a later contract.

## GIT (R3)

branch=opencode/auth-003-passwords commits=`370b671`,report commit pushed=yes
