# WORKER-A checkpoint — AUTH-006-R2 delivered, amendment proposal attached

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-006 branch/worktree: `opencode/auth-006-context` at
  `/home/esc/saven/wt-auth-006`, based on `testing-1 @ 1b9ff78`.
- Round just delivered: **AUTH-006-R2**, correcting the remaining HIGH correction in
  `docs/contractor/reviews/AUTH-006-R1-tenant-context.md` at `d9e2bb1`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-006-tenant-context.md` — bind verified
  selected membership to every PG business transaction on one checked-out client.
- TOUCH: `src/db/tenant-context.mjs`, `src/db/README.md`,
  `src/auth/tenant-selection.mjs`, `src/auth/routes.mjs`,
  `src/auth/session-store.mjs`, `src/auth/README.md`,
  `tests/auth-006-context.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`.
- Implementation commit: `09ce585` (`app: bind exact selected role and revalidate
  admission before commit [contract:AUTH-006-R2]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`src/auth/tenant-selection.mjs`, `src/db/tenant-context.mjs`, `src/db/README.md`,
`tests/auth-006-context.test.mjs`, delivery report and this checkpoint. No routes/session
store delta this round. No schema/migration/grant/RLS/owner change.

## R2 correction and status (review `d9e2bb1`)

**HIGH — exact role provenance + final admission. Corrected within TOUCH; true membership
locking remains the requested amendment.**

- Frozen `resolved.roleId` is now compared with `selectedNow.role_id` on every admission
  check; a role change without an epoch bump fails closed as stale.
- Admission revalidation runs before the handler **and again immediately before the
  business COMMIT**, re-reading the complete membership/role authority set, recomputing MFA
  requirements (including new associations), and discarding business effects if authority
  changed.
- Tests: role change without epoch bump during a pause; role change committed during handler
  execution (effect rolled back); new MFA-requiring membership association during a pause;
  ineffective selected role. All refuse with no handler/effects.
- Residual: a change committing between the last pre-commit check and COMMIT is not
  DB-serialized; not claimed as complete membership locking.

## Concrete bounded amendment proposal (attached, not authorized)

Documented in full in
`docs/contractor/deliveries/AUTH-006-tenant-context.md` (AUTH-006-R2 section). Summary:

- Additive migration only; no table/column change, no runtime grant, no RLS relaxation,
  no BYPASSRLS.
- Transaction-scoped advisory locks: per user
  `pg_advisory_xact_lock(hashtext('saven.auth.membership:'||user_id))` and global role key
  `pg_advisory_xact_lock(hashtext('saven.auth.roles'))`.
- Admission takes both keys on the owned auth transaction and holds them through the
  business transaction.
- DB-enforced writer side: AFTER INSERT/UPDATE/DELETE triggers on
  `auth.tenant_membership` (per-user key for NEW/OLD user) and `auth.roles` (global roles
  key), SECURITY INVOKER, `search_path=pg_catalog`, owned by the offline DDL role.
- Deterministic order: user then roles on admission; writers take one key. No cycle.
- Once authorized, add the migration to the fixture and prove both orderings (invalidation
  wins with no handler/effects; admission wins with writer blocking) plus role-without-epoch,
  role policy/effectiveness, new membership/promotion and revocation/epoch cases.
- Preserve uncertain-COMMIT semantics: the auth/business transactions are not a distributed
  atomic commit.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`
  → PASS, 20/20, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55432`, accepted PIVOT-004/031/032 RLS stack with real non-owner
  auth-service and customer-app logins.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27.
- Combined serial run (`--test-concurrency=1`): 113 tests, 113 pass, 0 fail.
- Findings 2 (realm/MFA) and 3 (same-tenant company composition) remain closed from R1.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-006 not merged; `testing-1` remains `1b9ff78`.

## Where I stopped

Last completed step: committed `09ce585`, then the delivery report (with the amendment
proposal) and this checkpoint. No further code, tests, merges or new contracts started.

## Exact next step

1. Await the engineer's decision on the bounded amendment and/or the Codex verdict on
   AUTH-006-R2.
2. On **ACCEPT/amendment authorized**: implement exactly the authorized additive interface,
   add it to the fixture, prove both orderings and the listed authority-change cases, then
   resubmit; do not merge.
3. On **REVISE within current TOUCH**: fetch the rulings branch, apply only scoped
   corrections, re-run focused plus AUTH-002..005, update the report, commit/push on
   `opencode/auth-006-context`, and stop without merging.

Open items: the requested membership/role locking amendment; AUTH-009 tenant-selection
audit vocabulary; production company/resource authorization engine; business feature
wiring. No load/PgBouncer-instance claim.
