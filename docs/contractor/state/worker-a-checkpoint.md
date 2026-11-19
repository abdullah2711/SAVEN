# WORKER-A checkpoint — AUTH-009 revision 2: PARTIAL (finding 1), findings 2-3 done

Date: 19 November 2026 (Asia/Karachi). Written under the owner checkpoint directive; this
file is outside any contract TOUCH.

## Exact contract

- `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Base: `testing-1` @ `c543ef7`; prior delivery `eb6830a`; verdict `87b7977` (REVISE).
- Branch/worktree: `opencode/auth-009-audit` @ `/home/esc/saven/wt-auth-009`.
- Revision 2 implementation commit: `9b7bc425608b8f7430918a522693b628d90d4115`.
- Status: **PARTIAL delivery, not complete, not merged.**

Ruling context: the dispatcher's initial Q2 answer (defer the three role/membership
producers) was withdrawn under D-010. Nothing in code/tests encodes that deferral. The three
remain REQUIRED. Resolution must come from Codex amending the finding on the record or an
explicit Principal acceptance.

## Three interlocking changes — separate status

### 1. Real producers for the four ADR03 events — PARTIAL

- `password_changed` — **DONE.** Producer: `POST /v1/auth/password/change` (session + CSRF +
  current password, Argon2id-policy hash, credential generation +1, revoke all sessions,
  atomic `password_changed` + `sessions_revoked`, cookie cleared; not pre-MFA allowed).
  Proving tests (exact runner names):
  - `AUTH-009 password_changed is produced by the authenticated credential-change flow`
  - `AUTH-009 a wrong current password is a durable, single refusal and changes nothing`
  - `AUTH-009 a failed password_changed audit rolls the credential change and revokes back`
- `role_changed` — **UNTOUCHED / NO PRODUCER / NO TEST.** Missing test: none exists; required
  test would have to exercise a real role-change transition.
- `membership_invited` — **UNTOUCHED / NO PRODUCER / NO TEST.** Missing test: none exists.
- `membership_accepted` — **UNTOUCHED / NO PRODUCER / NO TEST.** Missing test: none exists.
- They remain `status: 'required'` in `ADR03_REQUIRED_EVENTS`; catalog `producer: null`; no
  synthetic rows. Implementing them would invent invitation/role policy that the review did
  not authorize.

### 2. Early-refusal failure coverage — DONE

Every authentication/assurance/session decision that exits before a route's own recorder is
recorded exactly once by the central safety net (verified actor only; otherwise NULL/unknown;
`unknown` realm only for pre-realm origin refusals; malformed JSON unrecorded). Proving tests:

- `AUTH-009 pre-reservation login refusals are recorded once with the correct attribution`
- `AUTH-009 assurance, CSRF and session refusals are classified and recorded exactly once`
- `AUTH-009 email verification request/verify refusals are recorded without secrets`
- `AUTH-009 composed refusals run under the real non-owner auth-service login`
- `AUTH-009 MFA route guards that precede the factor try block are recorded`
- `AUTH-009 operator guard refusals are audited before the assertion is exchanged`

### 3. External JSON reference/configuration catalog — DONE

New `src/auth/audit-catalog.v1.json` (approved remedy), validated/frozen by
`validateAuditCatalog`, injected through `createAuditWriter`/`createAuthServer`; unknown event
and invalid configuration fail closed; per-event actors/outcomes/detail allow-lists; clients
cannot register schemas; the required map is independent. Proving tests:

- `AUTH-009 event domain is an external, versioned, validated configuration`
- `AUTH-009 the required-event map stays independent of the configurable catalog`

## Gate / failure evidence

- Active failures: **none** in the focused gate. `node scripts/check.mjs` → PASS (172 files).
  `node --test tests/auth-009-audit.test.mjs` → 21 tests / 21 pass / 0 fail.
- Serial regression: AUTH-002 18/18, 003 27/27, 004 21/21, 005 27/27, 006 27/27, 007 22/22.
  Combined 163/163.
- Known pre-existing transient: AUTH-004 intermittently reports
  `terminating connection due to administrator command` in shared-fixture teardown. Reproduced
  identically on unmodified base `c543ef7` in a separate worktree; serial reruns green. Not
  attributed to AUTH-009; disclosed in the delivery report.
- Environment: Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster (port 55439),
  `SAVEN_AUTH_TEST_CLUSTER=1`/`SAVEN_PIVOT_TEST_CLUSTER=1`.

## Exact next step

1. Codex reviews `9b7bc42` and must resolve finding 1 for the three missing producers
   (amend the finding with reasons, or the Principal explicitly accepts the dependency).
2. Do not describe AUTH-009 as complete/ACCEPT-ready while `role_changed`,
   `membership_invited` and `membership_accepted` have no producer and no test.
3. Never merge; the dispatcher relays the human-approved merge command.
