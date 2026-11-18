CONTRACT: docs/contractor/contracts/AUTH-007-operator-access.md
STATUS: DONE — Cloud operator Access JWT validation and scoped local subject mapping are implemented without local Cloud operator passwords/TOTP; the active SQLite path is untouched.

## Identity

- Branch: `opencode/auth-007-operator-access`, base `testing-1` at
  `0df990a73c883b67e22dbfacfcb4f90162eef910` (AUTH-006 merge).
- Implementation commit: `a67feed`. Report + checkpoint commit follows.
- Worktree: `/home/esc/saven/wt-auth-007`.
- Node `v24.19.0`; disposable PostgreSQL 18.6 on loopback `127.0.0.1:55433`
  (created for this round, removed afterwards; 55432 was occupied by a stale listener).

## Files changed

- `src/auth/access.mjs` (new) — fixed-issuer/audience/algorithm/key Access JWT validator
  (RS256/384/512, time/skew, fixed-source refresh with cooldown, jku/x5u ignored) and the
  operator exchange service (scoped mapping, MFA-assurance policy, one-time nonce, session).
- `db/postgres/06-operator-identity.sql` (new) — additive `operator.access_identity`
  subject mapping and `operator.access_exchange` one-time nonce ledger; narrow auth-service
  SELECT/INSERT grants; no update/delete, no RLS change, no local credential columns.
- `src/auth/routes.mjs` — versioned `/v1/auth/operator/access`, `/me`, `/logout`; operator
  realm/origin guards; success/failure audit; no password fields accepted.
- `src/auth/README.md` — AUTH-007 routes, invariants, configuration/extension points,
  non-claims.
- `tests/auth-007-access.test.mjs` (new) — 7 focused tests with mocked RSA keys/assertions.
- `docs/contractor/deliveries/AUTH-007-operator-access.md` — this report.

No path outside TOUCH plus report/checkpoint changed. No local SQLite/reference code,
existing entry point, production data or applied migration was changed.

## Invariant coverage

| Invariant | Evidence |
| --- | --- |
| Fixed trusted issuer/JWKS/algorithm/audience/time | Validator requires explicit issuer, audience and allowed RS algorithms; verifies signature against the configured key set; checks exp/nbf/iat with bounded skew, exact issuer and audience membership. Wrong issuer/audience/algorithm/expired/not-yet-valid/tampered tests refuse. |
| Active authorized subject + MFA-assurance policy | `operator.access_identity` must be active/effective, map to an active local identity and an active/effective `auth.roles.is_operator` role. The verified claim-derived assurance must equal both the mapping class and policy (`access_mfa`). A signed token without MFA evidence is refused (`OPERATOR_MFA_REQUIRED`); stale/`access_asserted` mapping class is refused. |
| No attacker-directed key fetch | `jku`/`x5u` are ignored; only the injected fixed key set/refresh callback is used. Refresh is called with no token/URL input, once per cooldown; unknown keys fail closed. Tests cover unknown kid, fixed-source rollover, attacker `jku`, and no-refresh fail-closed. |
| No local Cloud operator password/TOTP | Operator login remains rejected (`OPERATOR_ASSERTION_REQUIRED`); exchange rejects body fields (including `password`); `operator.access_identity` has no password/TOTP columns. The local auth path is unchanged and Fully Private administration remains independent. |
| No new universal support access | Mapping rows are explicit per-subject; no wildcard/default subject. Unmapped, revoked, expired, suspended-user and non-operator-role mappings are denied. |
| Scoped session | Successful exchange creates a host-only `SameSite=Strict` operator session with `access_asserted` assurance and the mapped operator role. No tenant context is created; operator reads still require PIVOT-007 grants/audit. |
| Captured-token / replay semantics | Ordinary unexpired bearer validation is reusable (asserted). A one-time exchange nonce (SHA-256 of `identity_nonce`, else the assertion) is INSERT-once; a second exchange is `409 OPERATOR_EXCHANGE_REPLAY` with no second session. Raw assertions are never stored. No impossible replay-proof claim is made. |
| Append-only audit, no secrets | Success `login_success`/`logout` rows commit with the session transition; failures are audited independently with generic reason codes. No assertion, nonce raw value or password appears in audit/response. |
| No client authority / no runtime superuser | Subject comes from the verified assertion; user/role/tenant never come from request ids. The auth-service login is a real non-owner role with narrow `operator.access_identity` SELECT and `operator.access_exchange` SELECT/INSERT only; no UPDATE/DELETE, superuser, BYPASSRLS or table ownership. |
| SQLite/reference unchanged | No native/reference source or applied migration byte changed; the active SQLite auth path remains production. |

## DONE WHEN evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 169 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-007-access.test.mjs
tests 7  pass 7  fail 0
```

Combined serial run (`--test-concurrency=1`, disposable PostgreSQL 18.6 on
`127.0.0.1:55433`, accepted auth/PIVOT-004/031/032/033/06 fixtures, real non-owner
auth-service login):

```text
AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27, AUTH-006 27/27, AUTH-007 7/7
combined 127 tests, 127 pass, 0 fail
```

One combined attempt hit the known disposable-fixture teardown transient
(`terminating connection due to administrator command`) in an unchanged AUTH-004 case; the
immediate serial rerun was 127/127. Reported honestly.

## Boundaries and open items

- No live Access policy, DNS/tunnel change, network key fetch, production key or
  credential is included; tests use mocked RSA keys/assertions.
- Operator data reads and complete operator audit taxonomy remain PIVOT-007/AUTH-009 work;
  this module creates the session only.
- A captured unexpired bearer can be exchanged once by whoever presents it first; ordinary
  bearer validation cannot promise attack replay prevention.
- Deployment must supply the fixed issuer/audience/key source and an Access/IdP deployment
  that emits the configured MFA-assurance claim; no production profile is activated.
- SQLite remains production; no cutover, client onboarding or profile activation.

## EXTENSIBILITY

compliant — issuer/audience/algorithms/keys/assurance are deployment configuration; operator
roles and subject mappings are data; the validator/exchange are injected behind the auth
adapter; no hardcoded growing business domains or cross-module concrete coupling. Session
tokens stay digest-only (D-012).

## GIT

branch=opencode/auth-007-operator-access commit=`a67feed`,report+checkpoint commit pushed=yes

# AUTH-007-R1 revision — 18 November 2026

Verdict: `docs/contractor/reviews/AUTH-007-operator-access.md` at `26f8263`.
Implementation `b458b55`; report + checkpoint follow. Five corrections; no local SQLite/
reference source or applied migration byte changed.

## Findings closed

1. **CRITICAL — single methods no longer satisfy MFA; policy cannot weaken it.** Status:
   **closed.** Default assurance requires the explicit RFC 8176 `mfa` AMR value; `otp`,
   `hwk`, `swk`, `pwd` and `pwd+otp` alone are denied. A reviewed issuer-controlled
   `mfaEvidence` predicate may be configured for a signed custom claim. The operator policy
   is fixed to `access_mfa`; constructing the service with any other label throws. The
   mapping's assurance class must equal `access_mfa`. Tests cover each single method, absent/
   malformed AMR, the explicit `mfa` positive, custom-policy positive/negative, mapping
   `access_asserted`, and misconfigured policy.
2. **HIGH — mapping authority reserved and bound for subsequent use.** Status: **closed.**
   Exchange and operator admission take the accepted AUTH-006 shared authority gate before
   mapping/role reads, then lock the local principal in gate -> user -> session order.
   Mapping writers take the same gate exclusively through new BEFORE STATEMENT triggers in
   06; the AUTH-006 033 auth-role triggers cover role changes. The exact verified
   issuer/subject/audience, mapping epoch/role/assurance and source assertion expiry are
   stored in `operator.access_session_binding`; every current operator use revalidates them.
   Tests cover post-issuance revocation, role/effective/assurance changes, mapping epoch
   change, same-user/different-subject isolation, source expiry, invalidation-first and
   exchange/admission-first interleavings (writer blocks until completion), and audit/
   nonce/session rollback. Future PIVOT-007 reads consume `admitSession(session, {tx})`.
3. **HIGH — canonical replay identity.** Status: **closed.** JOSE segments must be canonical
   base64url; noncanonical encodings (unused final bits/padding) are refused. The fallback
   identity is derived from issuer/audience/subject-scoped `identity_nonce` or the canonical
   verified assertion digest, never raw JWT text. Tests alter unused signature bits (same
   decoded bytes), assert rejection, and run simultaneous no-nonce exchanges with at most one
   exchange/session/binding committed.
4. **HIGH — freshness at the owned admission boundary.** Status: **closed.** Validation
   checks signature/time; exchange rechecks source expiry, mapping/role windows and configured
   max age with the trusted clock sampled inside the owned transaction after the gate/user
   lock; a configured max age requires a finite usable `iat`. Paused-checkout tests prove
   expiry/staleness refuse with zero nonce/session/binding/success-audit commits. Operator
   admission also enforces the bound source-expiry ceiling.
5. **MEDIUM — concurrency-safe key refresh.** Status: **closed.** Refresh admission is
   reserved before awaiting, in-flight refreshes coalesce, failure keeps known-good keys and
   starts a retry cooldown. Tests cover cached keys, simultaneous unknown kids (one callback),
   a rejected refresh with recovery after cooldown, and no token/URL-directed fetch.

## Evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 169 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-007-access.test.mjs
tests 13  pass 13  fail 0
```

Combined serial run (`--test-concurrency=1`, disposable PostgreSQL 18.6 on
`127.0.0.1:55433`, auth fixture plus AUTH-006 033 and operator 06 applied as administrator
with namespaced roles, real non-owner auth-service login):

```text
AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27, AUTH-006 27/27, AUTH-007 13/13
combined 133 tests, 133 pass, 0 fail
```

## Boundaries

- `06-operator-identity.sql` now depends on AUTH-006 migration `033`; deployment must apply
  033 first. No applied 033 bytes were edited.
- The authority gate is global for authority writes, including operator mapping changes;
  rare mapping writes serialize against admitted operator work. No throughput/SLA claim.
- A custom `mfaEvidence` predicate is reviewed deployment code; it is not client input. The
  default AMR policy is explicit `mfa` only.
- A captured unexpired bearer can be exchanged once by the first presenter; ordinary bearer
  validation remains reusable. No impossible replay-proof claim.
- No live Access policy/DNS/tunnel/network key fetch or production credential; operator
  reads and complete audit taxonomy remain PIVOT-007/AUTH-009. SQLite remains production.

## GIT (R1)

branch=opencode/auth-007-operator-access commit=`b458b55`,report+checkpoint commit pushed=yes

# AUTH-007-R2 revision — 18 November 2026

Verdict: `docs/contractor/reviews/AUTH-007-R1-operator-access.md` at `828401b`.
Implementation `9208e60`; report + checkpoint follow. Three bounded corrections; MFA
evidence and canonical replay remain closed from R1.

## Findings closed

1. **HIGH — accepted admission lock order and fresh authority after waits.** Status:
   **closed.** `admitSession` now resolves identity from the pre-read session, takes the
   shared gate, locks `auth.users` first, then re-reads the exact operator session under
   lock and revalidates revocation, both local expiries, status and credential generation.
   Trusted time is sampled only after the user/session locks; source expiry, mapping/role
   effective windows, assurance and the configured source-age ceiling are checked with that
   time. The same gate/principal order keeps reset/lifecycle serialization compatible. Tests
   cover admission-first blocking of a credential update, invalidation-first session
   revocation, a user-lock wait and a session-lock wait with source expiry advanced during
   the wait (both refuse), and clean next-request denial.
2. **HIGH — mapping incarnation cannot be reused.** Status: **closed.**
   `operator.access_identity` now takes a non-reusable sequence generation on every INSERT
   and UPDATE; update-in-place no longer just increments from the old value. Session bindings
   store the generation and a `generation-v1` scheme; legacy/null-scheme bindings fail
   closed. Tests delete/recreate the same subject/user and return after a role reassignment:
   old sessions stay denied, a fresh exchange succeeds, and unrelated subjects are isolated.
3. **MEDIUM — synchronous refresh failure cannot poison single-flight.** Status: **closed.**
   The refresh flight is published before the callback runs and cleared after settlement, so
   a non-async throw is caught without overwriting the flight with a settled promise.
   Failure cooldown, known-good key retention, coalescing and recovery remain. A non-async
   throw-once test with an injected clock proves immediate retry is cooldown-bound and a
   later retry invokes the source and succeeds.

## Evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 169 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-007-access.test.mjs
tests 19  pass 19  fail 0
```

Combined serial run (`--test-concurrency=1`, disposable PostgreSQL 18.6 on
`127.0.0.1:55433`, auth fixture + AUTH-006 033 + operator 06 applied as administrator with
namespaced roles, real non-owner auth-service login):

```text
AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27, AUTH-006 27/27, AUTH-007 19/19
combined 139 tests, 139 pass, 0 fail
```

One combined attempt hit the known disposable-fixture teardown transient in an unchanged
AUTH-004 case; the immediate serial rerun was 139/139.

## Boundaries

- `06-operator-identity.sql` depends on AUTH-006 `033`; apply 033 first. No applied 033
  bytes, native source or production profile changed.
- The authority gate remains global for authority writes; no throughput/SLA claim.
- Mapping generation is data/infrastructure, not a business-role domain. Existing installed
  06 lineage, if any, gets the sequence/default and a nullable scheme column; legacy
  bindings fail closed and require re-exchange.
- A custom MFA predicate remains reviewed deployment code, not client input. Captured bearer
  exchange remains first-presenter-wins. No live Access policy/DNS/tunnel/network fetch.
- Operator reads and full audit taxonomy remain PIVOT-007/AUTH-009; some pre-exchange guard
  failures are not audited. SQLite remains production.

## GIT (R2)

branch=opencode/auth-007-operator-access commit=`9208e60`,report+checkpoint commit pushed=yes

# AUTH-007-R3 revision — 18 November 2026

Verdict: `docs/contractor/reviews/AUTH-007-R2-operator-access.md` at `66aba74`.
Implementation `2821117`; report + checkpoint follow. One remaining HIGH: allocator
reapplication must never reseed issued mapping generations.

## Finding closed

**HIGH — non-reusable allocator survives reapplication and interruption. Closed.**
`06-operator-identity.sql` no longer unconditionally `setval`s the generation sequence.
Reconciliation is advance-only:

- the needed floor is `GREATEST(max(live access_identity.mapping_epoch),
  max(access_session_binding.mapping_epoch)) + 1`, so a generation retained only by a
  session binding after mapping deletion still protects the allocator;
- the sequence's current next value is read from `last_value/is_called`; `setval` runs only
  when the current next value is below the needed floor;
- because `setval` is not rolled back, every adjustment moves forward only. A failed or
  interrupted reapplication can leave the allocator advanced, never regressed.

The 06 install is idempotent for its own objects (`CREATE OR REPLACE FUNCTION`, guarded
`DROP TRIGGER IF EXISTS`/recreate, `CREATE TABLE/SEQUENCE/INDEX IF NOT EXISTS`, guarded
column/default), so reapplication reaches the allocator and completes rather than failing
after reconciliation.

Tests: install, issue a generation, delete the mapping (binding retains it), reapply 06 →
allocator next value does not regress and remains above the issued generation; a recreated
mapping receives a fresh generation; the old session stays denied and a fresh exchange
succeeds. A statement-by-statement reapplication is interrupted after allocator
reconciliation and rolled back → the allocator still never regresses and the issued
generation remains unusable; recovery uses a fresh generation.

## Evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 169 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-007-access.test.mjs
tests 20  pass 20  fail 0
```

Combined serial run (`--test-concurrency=1`, disposable PostgreSQL 18.6 on
`127.0.0.1:55433`, auth fixture + AUTH-006 033 + operator 06 applied as administrator with
namespaced roles, real non-owner auth-service login):

```text
AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27, AUTH-006 27/27, AUTH-007 20/20
combined 140 tests, 140 pass, 0 fail
```

## Boundaries

- `06-operator-identity.sql` still depends on AUTH-006 `033`; apply 033 first. No applied 033
  bytes, native source or production profile changed.
- Allocator reconciliation is administrator-applied and advance-only; it deliberately does
  not promise rollback of sequence state (PostgreSQL semantics), only non-regression and
  non-reuse.
- MFA/realm, canonical replay, lock order, mapping binding and refresh corrections remain
  closed from R1/R2. No live Access policy/DNS/tunnel/network fetch; operator reads and full
  audit remain PIVOT-007/AUTH-009; SQLite remains production.

## GIT (R3)

branch=opencode/auth-007-operator-access commit=`2821117`,report+checkpoint commit pushed=yes
