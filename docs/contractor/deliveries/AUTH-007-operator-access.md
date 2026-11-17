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
