# AUTH-009 delivery (revision 2) — PARTIAL: two of three findings complete

## Identity

- Contract: `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Branch: `opencode/auth-009-audit`; worktree `/home/esc/saven/wt-auth-009`
- Base `testing-1` SHA: `c543ef7`
- Prior reviewed delivery: `eb6830a` (verdict `87b7977`, REVISE)
- Revision 2 implementation commit: `9b7bc425608b8f7430918a522693b628d90d4115`
  (`app: configure auth audit catalog and record every security refusal [contract:AUTH-009]`)
- Report/checkpoint commit: this commit

**This round is PARTIAL, not complete.** Finding 2 (early-refusal failure coverage) and
finding 3 (external reference/configuration catalog) are DONE with tests. Finding 1 (real
producers for the four ADR03 events) is PARTIAL: `password_changed` is DONE with a real flow
and tests; `role_changed`, `membership_invited` and `membership_accepted` remain REQUIRED
with **no producer and no test**. This delivery must not be accepted as a complete AUTH-009,
and the required-event map does not encode any deferral.

Review ruling context, recorded for the dispatcher: the dispatcher's initial answer to defer
the three role/membership producers was withdrawn as not the dispatcher's to decide under
D-010. No deferral status, owner field or test exemption is encoded anywhere. Resolution must
come from Codex amending its finding on the record or an explicit Principal acceptance.

## Three interlocking changes — status and proving tests

| # | Finding | Status | Proving test(s) | Missing |
| --- | --- | --- | --- | --- |
| 1 | Real producers for the four ADR03 events (`password_changed`, `role_changed`, `membership_invited`, `membership_accepted`) | **PARTIAL** | `AUTH-009 password_changed is produced by the authenticated credential-change flow`; `AUTH-009 a wrong current password is a durable, single refusal and changes nothing`; `AUTH-009 a failed password_changed audit rolls the credential change and revokes back` | `role_changed`, `membership_invited`, `membership_accepted`: no producing flow and **no test** exists. They stay `status: 'required'` in `ADR03_REQUIRED_EVENTS` with catalog `producer: null`. |
| 2 | Security refusals must leave failure history (all early guards) | **DONE** | `AUTH-009 pre-reservation login refusals are recorded once with the correct attribution`; `AUTH-009 assurance, CSRF and session refusals are classified and recorded exactly once`; `AUTH-009 email verification request/verify refusals are recorded without secrets`; `AUTH-009 composed refusals run under the real non-owner auth-service login`; `AUTH-009 MFA route guards that precede the factor try block are recorded`; `AUTH-009 operator guard refusals are audited before the assertion is exchanged` | None known. |
| 3 | Growing event domain must be reference/configuration data | **DONE** | `AUTH-009 event domain is an external, versioned, validated configuration`; `AUTH-009 the required-event map stays independent of the configurable catalog` | None known. |

The focused suite is 21 tests; all 21 pass. Tests are named above exactly as printed by the
runner so a reloaded worker can locate them without re-deriving the work.

## Files changed vs TOUCH

TOUCH: `src/auth/audit.mjs`; `src/auth/routes.mjs`; `src/auth/server.mjs`;
`src/auth/session-store.mjs`; `src/auth/password-policy.mjs`; `src/auth/rate-limit.mjs`;
`src/auth/factors.mjs`; `src/auth/recovery.mjs`; `src/auth/tenant-selection.mjs`;
`src/auth/access.mjs`; `src/auth/README.md`; `tests/auth-009-audit.test.mjs`.

Changed this round:

- `src/auth/audit-catalog.v1.json` — **new, amendment-approved** (dispatcher selected the
  external JSON configuration remedy for finding 3). Versioned event schemas; no writer
  branch per event.
- `src/auth/audit.mjs` — loads and validates the external catalog; `validateAuditCatalog`;
  configurable `auditCatalog` through the writer; `AUDIT_CATALOG_INVALID` / fail-closed
  unknown events; `unknown` realm for pre-realm origin refusals; new refusal events.
- `src/auth/routes.mjs` — new authenticated password-change route; central classified
  refusal safety net for every early guard; assurance-gate recording; actor context from
  verified sessions only; no duplicate rows.
- `src/auth/server.mjs` — passes an optional validated `auditCatalog`.
- `src/auth/rate-limit.mjs` — `password_change` throttle kind on the existing durable
  reservation model (no new store, no policy relaxation).
- `src/auth/README.md` — catalog/password-change/early-refusal documentation; the three
  unresolved required producers are stated as unresolved, not deferred.
- `tests/auth-009-audit.test.mjs` — 21 tests (was 13).

Not changed: `session-store.mjs`, `password-policy.mjs`, `factors.mjs`, `recovery.mjs`,
`access.mjs`, `tenant-selection.mjs` (its prior-round change is unchanged). No migration, no
schema change, no grant or role change, no accepted file edited.

Protocol artifacts outside TOUCH: this report and
`docs/contractor/state/worker-a-checkpoint.md`.

## Gate

Environment: Node **v24.19.0** (engine `>=24.13 <25`), PostgreSQL **18.6** on a disposable
loopback cluster at `127.0.0.1:55439`, `SAVEN_AUTH_TEST_CLUSTER=1` (plus
`SAVEN_PIVOT_TEST_CLUSTER=1` for the AUTH-006 fixture), administrative `PGUSER=postgres`,
fixture-created/dropped databases.

```
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 172 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-009-audit.test.mjs
ℹ tests 21
ℹ pass 21
ℹ fail 0
```

Serial regression (one process per file):

```
auth-002-sessions: tests 18 pass 18 fail 0
auth-003-passwords: tests 27 pass 27 fail 0
auth-004-mfa:       tests 21 pass 21 fail 0
auth-005-recovery:  tests 27 pass 27 fail 0
auth-006-context:   tests 27 pass 27 fail 0
auth-007-access:    tests 22 pass 22 fail 0
```

Combined auth chain: **163/163** (142 prior + 21 new).

Disclosed transient (pre-existing, not introduced here): AUTH-004 intermittently produces
`error: terminating connection due to administrator command` in the shared-fixture
teardown/concurrency path. I reproduced the identical failure on the **unmodified base
`c543ef7`** in a separate worktree on that cluster's first run
(`AUTH-004-R2 locked replacement refuses...`, same message). Parallel execution of several
auth test files also reproduces it. Serial single-file runs were green repeatedly (5+
consecutive AUTH-004 runs plus the full chain above). No focused AUTH-009 test is affected.

## Finding detail

### 1. Real producers (PARTIAL)

`password_changed` now fires from `POST /v1/auth/password/change`: customer origin, verified
session, CSRF, current password, shared hashing policy, `credential_version + 1`, all
sessions revoked (`reason = password_change`), `password_changed` + `sessions_revoked`
committed in the same transaction, cookie cleared. Throttled with the existing durable
reservation model (`password_change` policy kind) before the KDF. Wrong current password
commits one reservation refusal and changes nothing. An injected audit fault rolls the
credential change and every revoke back (test). The route is not pre-MFA allowed, so pending
administrators are stopped by the assurance gate.

`role_changed`, `membership_invited`, `membership_accepted`: **not implemented, not
deferred.** The module has no accepted authority model for who may invite, accept or change
a role; `PIVOT-004` records that invitation/acceptance policy ownership stays with a future
contract, and `AUTH-006` records that tenant selection is not acceptance. Implementing them
here would invent security policy that the review expressly did not authorize. They remain
REQUIRED in `ADR03_REQUIRED_EVENTS`; the catalog has their schema with `producer: null`; there
is **no test** claiming coverage. Codex or the Principal must resolve this finding.

### 2. Early refusals (DONE)

Inventory and disposition:

| Exit | Recorded as |
| --- | --- |
| Customer login with operator origin (local operator-password refusal) | `login_failure`, realm operator, `unknown` actor |
| Login wrong origin / unrecognized origin (421) | `login_failure`; unrecognized origin uses realm `unknown` |
| Forgot/reset wrong origin, operator realm, invalid/stale token | `password_reset_requested` / `password_reset_failed` |
| Email verification operator realm/origin/session/CSRF/invalid token | `email_verification_requested` / `email_verification_failed` / `session_denied` |
| Common pre-MFA assurance gate (`MFA_REQUIRED`) | `assurance_denied` (authenticated actor + session) |
| Session missing/expired/revoked or CSRF failure on any authenticated route | `session_denied`; actor from the verified session only, otherwise NULL/`unknown` |
| Tenant selection policy denial | `tenant_selection_failed` |
| MFA route realm/origin guards before the factor try block | `access_denied` |
| Operator exchange guards (already fixed) | `login_failure` |
| Anything classifiable only as a route refusal | `access_denied` |

Malformed JSON remains unrecorded (request-shape fault, asserted in the login test). Routes
that record their own classified refusal mark the error so the safety net cannot duplicate
the row; the tests assert exact counts. Composed refusals (operator-realm login + assurance
gate) run through a real non-owner `saven_auth_service` login; administrative setup is not
used as privilege proof.

### 3. External catalog (DONE)

The event domain is `src/auth/audit-catalog.v1.json` (`catalogVersion: 1`), validated and
frozen at load/composition. `createAuditWriter`/`createAuthServer` accept an equivalent
validated catalog; clients cannot register or select one. Tests prove:

- a separately configured `probe_event` writes through the same writer and versioning;
- the same redaction guard rejects credential-shaped detail on that configured event;
- unknown events and invalid configuration fail closed (`AUDIT_EVENT_UNKNOWN`,
  `AUDIT_CATALOG_INVALID`);
- unsupported version, empty actors, unknown outcome, sensitive/duplicate detail keys are
  refused;
- the source `ADR03_REQUIRED_EVENTS` map is independent of the catalog and every entry
  remains `required`; changing the catalog cannot make a missing producer look accepted.

## Deviations / limits

- New file `src/auth/audit-catalog.v1.json` is outside the original TOUCH and was approved
  by the dispatcher's external-configuration decision for finding 3.
- No migration or grant change was added; `auth.reference_value` remains the documented
  future reference-data home if a later contract chooses to seed it.
- The three unresolved ADR03 producers are the reason this round is PARTIAL. No synthetic
  event is written from login/reset fixtures for them.
- Password change revokes all sessions including the current one by design (approved
  semantics); the user signs in again.
- Failure durability remains best-effort against a total ledger outage (counted and exposed,
  not claimed as delivered).
- No UI, active entry point, deployment, migration, cutover or merge is included. No live
  Access/IdP, SMTP, pooler or load claim. Reviewer reproduction remains external.
