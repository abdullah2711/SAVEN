# AUTH-009 delivery (revision 4) — narrowed scope, resubmitted for review

## Identity

- Contract: `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Branch: `opencode/auth-009-audit`; worktree `/home/esc/saven/wt-auth-009`
- Base `testing-1` SHA: `c543ef7`
- Prior deliveries: `eb6830a` (verdict `87b7977`/`8804078`), `de7d470` (revision 2),
  `606c4e3` (revision 3)
- Revision 4 implementation commit: `2d673b045cbc0d861afd95c4d91fa56e052e7331`
  (`app: record Principal-approved producer deferral for IAM events [contract:AUTH-009]`)
- Report/checkpoint commit: this commit

Principal decision of 19 November 2026: the narrowing amendment is APPROVED. AUTH-009 ships
the vocabulary, validation, required map and an explicit producer-deferred marker for
`role_changed`, `membership_invited` and `membership_accepted`. No role/invitation policy is
implemented here. `password_changed` remains real and tested. All four remain REQUIRED in the
required map. Codex is recording the decision in `DECISION_LOG` (owning contract ID at
authoring; legacy `BUSINESS_ROLE_SAVED` carried forward, not dropped); this delivery does not
edit that file.

## 1. Producer/transition map (narrowed scope)

`ADR03_PRODUCER_MAP` in `src/auth/audit.mjs` — source-level, catalog-independent. Test:
`AUTH-009 producer/transition map is precise and records the Principal-approved producer
deferral`.

| Required event | Status | Intended transition | Real flow / route | Legacy producer / note |
| --- | --- | --- | --- | --- |
| `login_success` | live | Verified credential/asserted identity creates a session | `POST /v1/auth/login`; `POST /v1/auth/operator/access` | — |
| `login_failure` | live | Attempt reserved, denied, or refused before reservation | same + central refusal path | — |
| `logout` | live | Principal revokes the current session | customer/operator logout | — |
| `mfa_enrolled` | live | TOTP enrollment starts/completes/replaces | `POST /v1/auth/mfa/enroll[/verify]` | — |
| `mfa_verified` | live | TOTP/recovery verifies and raises assurance | `POST /v1/auth/mfa/verify` | — |
| `mfa_disabled` | live | Factor disablement after reauthentication | `POST /v1/auth/mfa/disable` | — |
| `password_changed` | live | Authenticated current-password reauthentication sets a new credential | `POST /v1/auth/password/change` | — |
| `password_reset_requested` | live | Reset challenge reserved/issued | `POST /v1/auth/forgot-password` | — |
| `password_reset_completed` | live | Single-use reset token consumes to a new generation | `POST /v1/auth/reset-password` | — |
| `sessions_revoked` | live | Bulk revocation by reset/password change | reset/password-change | — |
| `role_changed` | **producer-deferred (IAM)** | Membership role reassigned with current authority | **none on audited PG surface** | LIVE legacy flow: `src/local/administration.mjs` records `BUSINESS_ROLE_SAVED`. Carried forward, not dropped. |
| `membership_invited` | **producer-deferred (IAM)** | Administrator issues a pending invitation | **none on audited PG surface** | LIVE legacy flow: `src/operating.mjs` `invite()`/`membershipInvitation()`, imported/routed by `src/api.mjs`. |
| `membership_accepted` | **producer-deferred (IAM)** | Invited identity authenticates and accepts | **none on audited PG surface** | LIVE legacy flow: `src/operating.mjs` `membershipInvitation()`, imported/routed by `src/api.mjs`. |

**Corrected premise (important):** the deferral is not because the workflows do not exist.
They are live on the legacy data layer. The accurate reason is that they are **not covered by
the new auth-audited PostgreSQL surface**, and porting them is an IAM contract of its own
(authority, tenant scoping, invitation/acceptance token semantics, role epochs and session
consequences). No producer is fabricated; no legacy behavior is dropped.

Required-map state: all 13 entries are `status: 'required'`; the three carry
`producerDeferredTo: 'IAM/membership administration contract'`. No `deferred` status exists,
and a catalog edit cannot change the map.

## 2. Early-refusal failure coverage (DONE)

Every security decision that can exit before a route recorder is routed into exactly one
durable classified event; local recorders mark the error so no duplicate row is produced.

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
| Operator exchange guards | `login_failure` |
| Any other route-level security refusal | `access_denied` |

Malformed JSON stays unrecorded (asserted). Reservations remain before KDF work and are not
duplicated. Tests (all pass):

- `AUTH-009 pre-reservation login refusals are recorded once with the correct attribution`
- `AUTH-009 assurance, CSRF and session refusals are classified and recorded exactly once`
- `AUTH-009 email verification request/verify refusals are recorded without secrets`
- `AUTH-009 composed refusals run under the real non-owner auth-service login`
- `AUTH-009 MFA route guards that precede the factor try block are recorded`
- `AUTH-009 operator guard refusals are audited before the assertion is exchanged`
- `AUTH-009 every route family records its early security decision exactly once`

## 3. Reference/configuration catalog through the writer boundary (DONE)

`src/auth/audit-catalog.v1.json` (`catalogVersion: 1`) is consumed and validated only through
`audit.mjs`. Wiring (test: `AUTH-009 server composition validates and forwards the configured
catalog`):

1. `createAuthServer({auditCatalog})` forwards to `createAuditWriter(pool, {auditCatalog})`.
2. `createAuditWriter` calls `validateAuditCatalog` once; invalid/unsupported catalog throws
   `AUDIT_CATALOG_INVALID` at composition.
3. A valid deployment catalog composes and serves; a login failure writes through it.
4. Each write calls `prepareAuditRow(event, {catalog})`: per-event actor/outcome/detail
   allow-lists + global credential-name guard.
5. Unknown events fail closed (`AUDIT_EVENT_UNKNOWN`); no fallback writer.
6. `ADR03_REQUIRED_EVENTS` / `ADR03_PRODUCER_MAP` are source constants independent of the
   catalog.

No-code-change path: add the entry to the JSON (or supply an equivalent validated catalog via
`createAuthServer`), keep `catalogVersion` compatible, version payload changes with the
event's detail schema. Clients cannot register or select a catalog.

Proving tests:

- `AUTH-009 event domain is an external, versioned, validated configuration`
- `AUTH-009 server composition validates and forwards the configured catalog`
- `AUTH-009 the required-event map stays independent of the configurable catalog`
- `AUTH-009 producer/transition map is precise and records the Principal-approved producer
  deferral`

## Files changed vs TOUCH

TOUCH: `src/auth/audit.mjs`; `src/auth/routes.mjs`; `src/auth/server.mjs`;
`src/auth/session-store.mjs`; `src/auth/password-policy.mjs`; `src/auth/rate-limit.mjs`;
`src/auth/factors.mjs`; `src/auth/recovery.mjs`; `src/auth/tenant-selection.mjs`;
`src/auth/access.mjs`; `src/auth/README.md`; `tests/auth-009-audit.test.mjs`.

This round: `src/auth/audit.mjs` (required-map marker + producer map), `src/auth/README.md`
(narrowing + corrected premise), `tests/auth-009-audit.test.mjs` (marker assertions), plus this
report/checkpoint. The amendment-approved new file `src/auth/audit-catalog.v1.json` and the
revision-2/3 source changes are unchanged. No migration, grant, role, accepted-migration or
SQLite change; no legacy flow removed.

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

Serial regression: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27,
AUTH-006 27/27, AUTH-007 22/22 (final clean pass). Prior runs occasionally hit the
pre-existing shared-fixture transient `terminating connection due to administrator command`
in AUTH-004/AUTH-006; the same error reproduces on unmodified base `c543ef7`, and isolated
reruns are green. Not attributed to AUTH-009.

## Limits

- The three deferred producers remain absent from the audited PostgreSQL surface by Principal
  decision; their schemas and markers exist, and the legacy flows remain in place.
- Failure durability is best-effort under a total ledger outage (counted/exposed).
- No UI, active entry point, deployment, migration, cutover or merge; no live Access/IdP,
  SMTP, pooler or load claim. Reviewer reproduction remains external.
