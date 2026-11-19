# WORKER-A checkpoint — AUTH-009 revision 4: narrowed scope resubmitted

Date: 19 November 2026 (Asia/Karachi). Written under the owner checkpoint directive; outside
any contract TOUCH.

## Exact contract

- `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Base `testing-1` @ `c543ef7`; prior revisions `eb6830a`, `de7d470`, `606c4e3`.
- Branch/worktree: `opencode/auth-009-audit` @ `/home/esc/saven/wt-auth-009`.
- Revision 4 implementation: `2d673b045cbc0d861afd95c4d91fa56e052e7331`.
- Principal decision 19 Nov: narrowing APPROVED for `role_changed`, `membership_invited`,
  `membership_accepted`. No role/invitation policy in AUTH-009. All four remain REQUIRED.
  Codex is recording it in `DECISION_LOG`; `BUSINESS_ROLE_SAVED` carried forward.

## Three interlocking changes — separate status

### 1. Producers — DONE FOR NARROWED SCOPE

- `password_changed` — **DONE (live + tested).** Tests:
  `AUTH-009 password_changed is produced by the authenticated credential-change flow`,
  `... a wrong current password is a durable, single refusal and changes nothing`,
  `... a failed password_changed audit rolls the credential change and revokes back`.
- `role_changed` — **PRODUCER-DEFERRED (IAM), per Principal.** Required map keeps it
  `required` with `producerDeferredTo: 'IAM/membership administration contract'`. No producer
  test (deferred by decision). Legacy producer named: `src/local/administration.mjs
  BUSINESS_ROLE_SAVED`.
- `membership_invited` — **PRODUCER-DEFERRED (IAM).** Legacy: `src/operating.mjs`
  `invite()`/`membershipInvitation()` via `src/api.mjs`.
- `membership_accepted` — **PRODUCER-DEFERRED (IAM).** Legacy: `src/operating.mjs`
  `membershipInvitation()` via `src/api.mjs`.
- Corrected premise: the flows are LIVE on the legacy data layer; they are not covered by the
  audited PostgreSQL surface, and porting them is an IAM contract. No policy invented.
- Proving test: `AUTH-009 producer/transition map is precise and records the
  Principal-approved producer deferral`; required-map test asserts all four required + marker.

### 2. Early-refusal failure coverage — DONE

Tests:
`AUTH-009 pre-reservation login refusals are recorded once with the correct attribution`;
`AUTH-009 assurance, CSRF and session refusals are classified and recorded exactly once`;
`AUTH-009 email verification request/verify refusals are recorded without secrets`;
`AUTH-009 composed refusals run under the real non-owner auth-service login`;
`AUTH-009 MFA route guards that precede the factor try block are recorded`;
`AUTH-009 operator guard refusals are audited before the assertion is exchanged`;
`AUTH-009 every route family records its early security decision exactly once`.

### 3. Catalog writer-boundary wiring — DONE

Tests:
`AUTH-009 event domain is an external, versioned, validated configuration`;
`AUTH-009 server composition validates and forwards the configured catalog`;
`AUTH-009 the required-event map stays independent of the configurable catalog`;
`AUTH-009 producer/transition map is precise and records the Principal-approved producer
deferral`.

## Gate / failure evidence

- Focused: `node scripts/check.mjs` PASS (172); `node --test tests/auth-009-audit.test.mjs`
  24/24 pass, 0 fail.
- Final clean serial regression: 002 18/18, 003 27/27, 004 21/21, 005 27/27, 006 27/27,
  007 22/22 (166/166 combined).
- Earlier runs intermittently hit the pre-existing shared-fixture transient
  `terminating connection due to administrator command` in AUTH-004/006; reproduced on
  unmodified base `c543ef7`; isolated reruns green.
- Environment: Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster 55439,
  `SAVEN_AUTH_TEST_CLUSTER=1`/`SAVEN_PIVOT_TEST_CLUSTER=1`.

## Exact next step

1. Codex reviews `2d673b0` on the narrowed scope and records the decision in `DECISION_LOG`.
2. Do not implement role/invitation policy; keep the producer-deferred markers.
3. Never merge; the dispatcher relays the human-approved merge command.
