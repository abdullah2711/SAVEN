VERDICT: REVISE

WHY: The implementation addresses the password-change authority gap, and the new real-role stale-assurance test is useful. The specifically required concurrent writer/commit-boundary and failure-cleanup evidence from 8804078/63ef83c is still missing. This is a bounded evidence completion request, not a newly identified bypass or reopening of D-018.

Date: 19 November 2026 (Asia/Karachi).
Delivery: `opencode/auth-009-audit @ ba948cf14eb452c090e0bc3920111c1150213b53`; implementation `0afeb5002d57806c058daa793ad323538181820f`.
Base: `testing-1 @ c543ef7`; correction delta from `08f335c`.
Reviewed HEAD verified in `/home/esc/saven/wt-rev-auth-009-r2`.
Report: `docs/contractor/deliveries/AUTH-009-auth-audit.md`, revision 5.
Prior review: [AUTH-009-R2](AUTH-009-R2-auth-audit.md), `63ef83c`; governing correction detail also at `8804078`.
MERGE RISK: HIGH — shared authentication and credential lifecycle.
ROUTING: correction/evidence required; no ACCEPT or human Business Merge Request. PIVOT-014 remains staged until AUTH-009 is accepted AND integrated; no dispatch or merge performed.

Per-finding disposition:

- D-018 producer narrowing remains CLOSED/approved: password_changed stays real; role_changed/membership_invited/membership_accepted remain REQUIRED with explicit IAM producer-deferred markers and preserved live legacy references/BUSINESS_ROLE_SAVED carry-forward. No IAM policy invention or synthetic producer is requested.
- Early-refusal and external configuration findings remain CLOSED for their reviewed scope.
- Password-change authority implementation is ADDRESSED in source; required verification remains OPEN as detailed below. No claim is made that the original bypass persists unchanged.

Source assessment: the route now imports the existing authority helper, acquires the validated shared authority gate before principal/factor/session lifecycle locks, revalidates session/principal authority, locks/re-reads the current session with post-query expiry checking, and rereads required MFA and factor enrollment through the owned transaction. Unresolved requirements fail closed; required MFA with missing assurance/enrollment raises MFA_REQUIRED and is classified as assurance_denied. Credential mutation, all-session revocation and success audit remain inside that transaction, so the shared gate is transaction-scoped through its completion. No selected tenant is introduced for password change. The helper extraction preserves the accepted catalog/trigger checks and gate key; no SQL payload or grant changes. Existing durable reservation precedes KDF work.

## Remaining finding — MEDIUM: complete the previously required boundary evidence

The only added authority test uses wrapStore.readSession to report mfa_verified for an actually pending single-factor session. It proves the transaction rereads stored assurance and produces a specific MFA_REQUIRED refusal with unchanged credential and no success audit. It does not run a concurrent membership INSERT, role requires_mfa writer or factor/assurance lifecycle change, pause after final validation, observe writer blocking through credential COMMIT, or inject new-route COMMIT uncertainty. The three existing password-change success/wrong-password/audit-fault tests now use the real restricted auth-service login, which closes the prior privilege-evidence limitation; moving them to that login does not create the missing interleavings or size-one/failure probes.

Complete the exact bounded scenarios requested at 8804078/63ef83c:

1. Invalidation-first: let a real MFA-requiring membership insertion or role requirement change commit after the early handler check but before final mutation authority; assert exact MFA_REQUIRED, no password/epoch/revocation/success-audit change and durable, non-duplicated refusal evidence. Include a current factor/session assurance-loss case rather than only returning a false pre-read snapshot.
2. Mutation-first: pause after final authority validation but before credential/audit COMMIT; start the cooperating real membership/role writer and prove it cannot commit until this transaction ends, then assert correct subsequent-request authority. Use bounded barriers/observable writer progress; a sleep alone cannot establish the boundary. Include authorized current-MFA and ordinary-user positive controls.
3. Owned-client and failure boundary: exercise the new route with a size-one auth pool; inject success-audit failure and success-COMMIT/rollback uncertainty at the actual mutation transaction, with checkout-specific release/destruction and a clean subsequent borrower. Distinguish a durable reservation from the later credential commit, and never claim an uncertain commit certainly rolled back. Retain exact attempt accounting and no nested checkout during the owned lease.

Reuse existing helpers/accepted writer protocol within TOUCH; no new membership policy, privilege, schema change or production operation is authorized. No need to repeat unrelated catalog/producer work. If delivery is partial, enumerate these unperformed cases and the exact named completed tests rather than describing the shared gate's intended behavior as executed concurrency proof. Worker owns these bounded tests/corrections; engineer reviews the next exact SHA.

Evidence boundary: worker reports Node 24.19.0/PostgreSQL 18.6, syntax check and **25/25** focused. Serial AUTH-002/003/005/006/007 are reported green; AUTH-004 hit the disclosed pre-existing teardown transient once and passed its isolated rerun, with prior reproduction on c543ef7. This is not an all-green uninterrupted combined run or a universal flake-free gate. Password-change success/refusal/audit-rollback and the new stale-assurance case now use real non-owner auth-service composition with 033 installed. Reviewer inspected all six changed paths and relevant session/factor helper semantics and ran no contractor gate, test, SQL mutation, migration, restore or deployment. No live IdP, mail, pooler, production load, cutover or restore-completeness evidence is claimed.

Can a client-supplied header, query param, or body value influence tenant_id or user_id? Session verification supplies identity; the route now rereads current required assurance under its authority gate. The fake pre-read test is fixture instrumentation, not a client-authority interface. Preserve exact origins, CSRF, default-off trusted ingress and accepted lifecycle ordering.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. Reusing the exported authority boundary avoids a second lock protocol; closed catalog and producer findings remain closed. Keep D-012 digest-only display, D-016 advance-only identity with permitted non-reusable gaps, D-017 inventory bases, D-018 legacy preservation and Private independence. SQLite remains production. No merge, release, activation or PIVOT-014 dispatch is approved.
