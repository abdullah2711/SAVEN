# WORKER-A checkpoint — AUTH-009 revision 5: bounded round-2 correction

Date: 19 November 2026 (Asia/Karachi). Checkpoint directive; outside any contract TOUCH.

## Exact contract

- `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Base `testing-1` @ `c543ef7`; prior revisions `eb6830a`, `de7d470`, `606c4e3`, `08f335c`.
- Branch/worktree: `opencode/auth-009-audit` @ `/home/esc/saven/wt-auth-009`.
- Round-2 implementation: `0afeb5002d57806c058daa793ad323538181820f`.
- Review state: finding 2 CLOSED, finding 3 CLOSED, finding 1 AMENDED (D-018: three producers
  mandatory, owned by future IAM contract, not an AUTH-009 blocker).

## Three interlocking changes — separate status

### 1. Producers — AMENDED / CLOSED ON NARROWED SCOPE

- `password_changed` — live and tested (3 tests; unchanged).
- `role_changed` / `membership_invited` / `membership_accepted` — REQUIRED, explicit
  `producerDeferredTo: 'IAM/membership administration contract'`; legacy flows named
  (`BUSINESS_ROLE_SAVED`; `src/operating.mjs invite()/membershipInvitation()`). No producer,
  per Principal amendment. Test: `AUTH-009 producer/transition map is precise and records the
  Principal-approved producer deferral`.

### 2. Early-refusal coverage — CLOSED, no regression

Tests: `pre-reservation login refusals...`, `assurance, CSRF and session refusals...`,
`email verification request/verify refusals...`, `composed refusals run under the real
non-owner auth-service login`, `MFA route guards...`, `operator guard refusals...`,
`every route family records its early security decision exactly once`.

### 3. Catalog writer boundary — CLOSED, no regression

Tests: `event domain is an external, versioned, validated configuration`, `server composition
validates and forwards the configured catalog`, `required-event map stays independent`,
`producer/transition map...`.

## Round-2 bounded correction — DONE

Password-change mutation now: acquires the shared authority gate first; locks principal ->
factor -> session; re-reads the locked session and required-MFA authority/enrollment;
fails closed (503 unresolved, 403 MFA_REQUIRED) and records `assurance_denied` after rollback;
holds the gate through credential/audit commit; preserves no-selected-tenant, customer-only,
pre-KDF durable accounting, epoch/expiry/realm checks, atomic success audit and denied
evidence.

Proving test: `AUTH-009 password change revalidates required MFA assurance inside its owned
boundary` (bypasses the pre-route gate with a falsified snapshot; the owned boundary refuses;
credential unchanged; exactly one `assurance_denied`; non-owner auth-service composition with
033 installed).

## Gate / failure evidence

- `node scripts/check.mjs` PASS (172); focused `25/25` pass, 0 fail.
- Serial regression: 002 18/18, 003 27/27, 005 27/27, 006 27/27, 007 22/22. AUTH-004 once hit
  the pre-existing fixture transient `terminating connection due to administrator command`;
  isolated rerun 21/21 and reproduced on unmodified base `c543ef7`.
- Environment: Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster 55439,
  `SAVEN_AUTH_TEST_CLUSTER=1`/`SAVEN_PIVOT_TEST_CLUSTER=1`.

## Exact next step

1. Codex reviews `0afeb50` for the bounded correction.
2. Do not implement role/invitation policy; keep the producer-deferred markers.
3. Never merge; the dispatcher relays the human-approved merge command.
