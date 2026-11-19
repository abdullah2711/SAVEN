# WORKER-A checkpoint — AUTH-009 revision 3: PARTIAL (finding 1 escalated)

Date: 19 November 2026 (Asia/Karachi). Written under the owner checkpoint directive; outside
any contract TOUCH.

## Exact contract

- `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Base: `testing-1` @ `c543ef7`; prior reviewed delivery `eb6830a`; revision 2 `de7d470`;
  verdict `8804078` (same review text that inspected `eb6830a`).
- Branch/worktree: `opencode/auth-009-audit` @ `/home/esc/saven/wt-auth-009`.
- Revision 3 implementation: `5639403802ec22e6d7685f285339ef678850d48e`.
- Status: **PARTIAL, not complete, not merged.** Finding 1 escalated to Principal; do not
  implement role/invitation policy.

## Three interlocking changes — separate status

### 1. Real producers for the four ADR03 events — PARTIAL (escalated)

- `password_changed` — **DONE.** Producer `POST /v1/auth/password/change`; atomic
  `password_changed` + `sessions_revoked`; tests:
  `AUTH-009 password_changed is produced by the authenticated credential-change flow`,
  `... a wrong current password is a durable, single refusal and changes nothing`,
  `... a failed password_changed audit rolls the credential change and revokes back`.
- `role_changed` — **UNRESOLVED / NO PRODUCER / NO TEST.** Missing test: no real role-change
  transition test exists. Map says: no authenticated role-administration adapter; authority
  belongs to the membership/role contract.
- `membership_invited` — **UNRESOLVED / NO PRODUCER / NO TEST.** Missing test: no invitation
  transition test exists. PIVOT-004 owns invitation/acceptance policy.
- `membership_accepted` — **UNRESOLVED / NO PRODUCER / NO TEST.** Missing test: no acceptance
  transition test exists. AUTH-006 records selection is not acceptance.
- Precise producer/transition map now in source: `ADR03_PRODUCER_MAP`, tested by
  `AUTH-009 producer/transition map is precise, catalog-independent and reports unresolved
  requirements`. Required map keeps all 13 `required`; no deferral encoded; delivery carries
  the full map table.

### 2. Early-refusal failure coverage — DONE

Central classified safety net + local recorders, no duplicate rows, verified-actor-only
attribution, `unknown` realm only for pre-realm origin, malformed JSON unrecorded. Proving
tests:

- `AUTH-009 pre-reservation login refusals are recorded once with the correct attribution`
- `AUTH-009 assurance, CSRF and session refusals are classified and recorded exactly once`
- `AUTH-009 email verification request/verify refusals are recorded without secrets`
- `AUTH-009 composed refusals run under the real non-owner auth-service login`
- `AUTH-009 MFA route guards that precede the factor try block are recorded`
- `AUTH-009 operator guard refusals are audited before the assertion is exchanged`
- `AUTH-009 every route family records its early security decision exactly once` (new: forgot,
  reset, logout, password-change, operator/me families)

### 3. External JSON catalog through the writer boundary — DONE

`src/auth/audit-catalog.v1.json` (versioned) validated by `validateAuditCatalog`; forwarded by
`createAuthServer({auditCatalog})` to `createAuditWriter`; writes use
`prepareAuditRow(event,{catalog})`; invalid config and unknown events fail closed; required
map independent; no client registration. Proving tests:

- `AUTH-009 event domain is an external, versioned, validated configuration`
- `AUTH-009 server composition validates and forwards the configured catalog` (new: boundary
  wiring + fail-closed composition)
- `AUTH-009 the required-event map stays independent of the configurable catalog`
- `AUTH-009 producer/transition map is precise, catalog-independent and reports unresolved
  requirements`

## Gate / failure evidence

- Focused gate: `node scripts/check.mjs` PASS (172 files);
  `node --test tests/auth-009-audit.test.mjs` → 24/24 pass, 0 fail.
- Serial regression: 002 18/18, 003 27/27, 005 27/27, 007 22/22. AUTH-004 and AUTH-006 each
  showed the pre-existing shared-fixture transient
  `terminating connection due to administrator command` once in the full loop; isolated
  reruns green (004 5/5; 006 6/6). Same error reproduced on unmodified base `c543ef7`.
- Environment: Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster port 55439,
  `SAVEN_AUTH_TEST_CLUSTER=1`/`SAVEN_PIVOT_TEST_CLUSTER=1`.

## Exact next step

1. Principal decision on finding 1 arrives as a scoped amendment:
   - implement the reviewed authenticated role/invitation transitions, or
   - explicit narrowing/dependency acceptance.
2. On amendment: implement only the authorized transitions, add real-flow tests, update the
   producer map and this checkpoint.
3. Do not describe AUTH-009 as complete; do not implement role/invitation policy before the
   amendment. Never merge.
