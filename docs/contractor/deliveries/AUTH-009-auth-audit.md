# AUTH-009 delivery (revision 3) — PARTIAL: finding 1 escalated, findings 2-3 corrected

## Identity

- Contract: `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Branch: `opencode/auth-009-audit`; worktree `/home/esc/saven/wt-auth-009`
- Base `testing-1` SHA: `c543ef7`
- Prior reviewed delivery: `eb6830a` (verdict `87b7977`; re-issued as `8804078` against
  `eb6830a`)
- Revision 2 (returned by the dispatcher for this round): `de7d470`
- Revision 3 implementation commit: `5639403802ec22e6d7685f285339ef678850d48e`
  (`app: map ADR03 producers and prove catalog/refusal boundaries [contract:AUTH-009]`)
- Report/checkpoint commit: this commit

**Status: PARTIAL, not complete.** Finding 1 is escalated to the Principal and not decided;
`role_changed`, `membership_invited` and `membership_accepted` remain REQUIRED with no
producer and no test. Findings 2 and 3 are corrected and tested. No role/invitation/credential
policy was invented for the escalated items.

Routing note: verdict `8804078` reproduces the review text that inspected `eb6830a`
(revision 1). Revision 2 (`de7d470`) already contained the finding 2 and finding 3
corrections; this revision adds the reviewer-required producer/transition map, a
route-family refusal inventory test, composition-wiring proof for the catalog boundary, and
this report's explicit map.

## 1. Producer/transition map (required; finding 1 escalated)

`ADR03_PRODUCER_MAP` in `src/auth/audit.mjs` — source-level, catalog-independent, and tested
by `AUTH-009 producer/transition map is precise, catalog-independent and reports unresolved
requirements`.

| Required event | Status | Intended transition | Real flow / route | Absent |
| --- | --- | --- | --- | --- |
| `login_success` | live | Verified credential or asserted operator identity creates a session | `POST /v1/auth/login`; `POST /v1/auth/operator/access` | — |
| `login_failure` | live | Attempt reserved, denied, or refused before reservation | same routes + central refusal path | — |
| `logout` | live | Authenticated principal revokes the current session | `POST /v1/auth/logout`; `POST /v1/auth/operator/logout` | — |
| `mfa_enrolled` | live | TOTP enrollment starts/completes/replaces | `POST /v1/auth/mfa/enroll`, `.../enroll/verify` | — |
| `mfa_verified` | live | TOTP/recovery code verifies and raises assurance | `POST /v1/auth/mfa/verify` | — |
| `mfa_disabled` | live | Factor disablement after reauthentication | `POST /v1/auth/mfa/disable` | — |
| `password_changed` | live | Authenticated current-password reauthentication sets a new credential | `POST /v1/auth/password/change` | — |
| `password_reset_requested` | live | Reset challenge reserved and, when configured, issued | `POST /v1/auth/forgot-password` | — |
| `password_reset_completed` | live | Single-use reset token consumes to a new credential generation | `POST /v1/auth/reset-password` | — |
| `sessions_revoked` | live | Bulk revocation by reset or password change | reset/password-change routes | — |
| `role_changed` | **unresolved** | Tenant membership role reassigned with current authority | **none** | No authenticated role-administration adapter; authority/epoch/session effects belong to the membership/role contract. |
| `membership_invited` | **unresolved** | Administrator issues a pending membership invitation | **none** | No invitation adapter; PIVOT-004 records invitation/acceptance policy ownership stays with a future contract. |
| `membership_accepted` | **unresolved** | Invited identity authenticates and explicitly accepts | **none** | No acceptance adapter; issuer revalidation, token lifetime and acceptance semantics are owned by the membership contract (AUTH-006 records selection is not acceptance). |

No test treats the three unresolved rows as complete coverage. `ADR03_REQUIRED_EVENTS` marks
all 13 `required`; the map marks the three `unresolved` with the absence stated; the catalog
has their schemas with `producer: null`. Resolution is the escalated engineer/Principal
amendment.

## 2. Early-refusal failure coverage (DONE)

Every security decision that can exit before a route recorder is routed into exactly one
durable classified event by the central safety net, and routes that record locally mark the
error so no duplicate row is produced. Full route-family inventory (test:
`AUTH-009 every route family records its early security decision exactly once`):

| Exit | Classified event |
| --- | --- |
| Customer login on operator origin; login wrong/unrecognized origin (421, `unknown` realm) | `login_failure` |
| Forgot-password operator realm / wrong origin | `password_reset_requested` |
| Reset operator realm / wrong origin / invalid/stale token | `password_reset_failed` |
| Password change operator realm / wrong origin / session / CSRF | `password_change_failed` / `session_denied` |
| Email verification operator realm / origin / invalid token | `email_verification_requested` / `email_verification_failed` |
| Common pre-MFA assurance gate | `assurance_denied` (verified actor + session) |
| Session missing/expired/revoked or CSRF failure on any authenticated route | `session_denied`; actor only from a verified session, otherwise NULL/`unknown` |
| Tenant selection policy denial | `tenant_selection_failed` |
| MFA route realm/origin guards before the factor try block | `access_denied` |
| Operator exchange guards (already accepted) | `login_failure` |
| Any other route-level security refusal | `access_denied` |

Malformed JSON stays unrecorded (asserted). Login/reset/password-change reservations remain
before KDF work and are not duplicated. Tests (all pass):

- `AUTH-009 pre-reservation login refusals are recorded once with the correct attribution`
- `AUTH-009 assurance, CSRF and session refusals are classified and recorded exactly once`
- `AUTH-009 email verification request/verify refusals are recorded without secrets`
- `AUTH-009 composed refusals run under the real non-owner auth-service login`
- `AUTH-009 MFA route guards that precede the factor try block are recorded`
- `AUTH-009 operator guard refusals are audited before the assertion is exchanged`
- `AUTH-009 every route family records its early security decision exactly once`

Denial/permitted pairing: the CSRF denial is paired with a successful selection in the same
test file (`tenant selection and clearing are audited atomically`) and the MFA gate denial is
paired with the same user's permitted paths after verification; refusals are asserted to
create no session and no success mutation.

## 3. Reference/configuration catalog through the writer boundary (DONE)

The event domain is `src/auth/audit-catalog.v1.json` (`catalogVersion: 1`), consumed and
validated only through `audit.mjs`. Boundary wiring, proven by
`AUTH-009 server composition validates and forwards the configured catalog`:

1. `createAuthServer({auditCatalog})` forwards the deployment catalog to
   `createAuditWriter(pool, {auditCatalog})`.
2. `createAuditWriter` calls `validateAuditCatalog` once; an invalid/unsupported catalog throws
   `AUDIT_CATALOG_INVALID` at composition (asserted: invalid actors config refused).
3. A valid deployment catalog (with an extra `probe_event`) composes and serves; the login
   failure writes through the same writer.
4. Each write calls `prepareAuditRow(event, {catalog})`: per-event actor/outcome/detail
   allow-lists plus the global credential-name guard.
5. Unknown events fail closed with `AUDIT_EVENT_UNKNOWN`; no fallback writer exists.
6. `ADR03_REQUIRED_EVENTS` and `ADR03_PRODUCER_MAP` are source constants and do not read the
   catalog.

Proving tests:

- `AUTH-009 event domain is an external, versioned, validated configuration` — separately
  configured event writes through the same writer and versioning; same redaction rejects
  credential-shaped detail; unknown event and six invalid configurations refused.
- `AUTH-009 server composition validates and forwards the configured catalog` — composition
  wiring and fail-closed behavior, not just the file.
- `AUTH-009 the required-event map stays independent of the configurable catalog`.
- `AUTH-009 producer/transition map is precise, catalog-independent and reports unresolved
  requirements`.

Adding an event needs no writer change: add the entry to the JSON (or supply an equivalent
validated catalog through `createAuthServer`), keep `catalogVersion` compatible, and extend
`detail_schema_version` for a payload change. HTTP clients cannot register or select a
catalog.

## Files changed vs TOUCH

TOUCH: `src/auth/audit.mjs`; `src/auth/routes.mjs`; `src/auth/server.mjs`;
`src/auth/session-store.mjs`; `src/auth/password-policy.mjs`; `src/auth/rate-limit.mjs`;
`src/auth/factors.mjs`; `src/auth/recovery.mjs`; `src/auth/tenant-selection.mjs`;
`src/auth/access.mjs`; `src/auth/README.md`; `tests/auth-009-audit.test.mjs`.

This round: `src/auth/audit.mjs` (producer map), `src/auth/README.md` (map + wiring),
`tests/auth-009-audit.test.mjs` (3 new tests, 24 total), plus this report/checkpoint. The
approved new file `src/auth/audit-catalog.v1.json` and the revision-2 source changes are
unchanged. No migration, grant, role, accepted-migration or SQLite change.

## Gate

Node **v24.19.0**, PostgreSQL **18.6**, disposable loopback cluster `127.0.0.1:55439`,
`SAVEN_AUTH_TEST_CLUSTER=1` (+ `SAVEN_PIVOT_TEST_CLUSTER=1` for AUTH-006).

```
$ node scripts/check.mjs
PASS: 172 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-009-audit.test.mjs
ℹ tests 24
ℹ pass 24
ℹ fail 0
```

Serial regression in the full loop: AUTH-002 18/18, 003 27/27, 005 27/27, 007 22/22; AUTH-004
and AUTH-006 each showed the **pre-existing** shared-fixture transient
`terminating connection due to administrator command` once. Isolated reruns are green
(AUTH-004 5/5 and AUTH-006 6/6 consecutive). The same error was reproduced on unmodified base
`c543ef7`, so it is not attributed to AUTH-009. Excluding that transient, combined focused
evidence is 24/24 plus 142/142 prior; the honest full-loop total is reported as 165/166 in
that one run, not silently rounded up.

## Limits

- Finding 1 remains PARTIAL pending the escalated decision. No producer is fabricated.
- The three unresolved events have schemas only; `producer: null`.
- Failure durability is best-effort under a total ledger outage (counted/exposed).
- No UI, active entry point, deployment, migration, cutover or merge; no live Access/IdP,
  SMTP, pooler or load claim. Reviewer reproduction remains external.
