# WORKER-A checkpoint — AUTH-006-R3 delivered, authority gate implemented

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-006 branch/worktree: `opencode/auth-006-context` at
  `/home/esc/saven/wt-auth-006`, based on `testing-1 @ 1b9ff78`.
- Round just delivered: **AUTH-006-R3**, implementing the ENGINEER R2 AMENDMENT from
  `docs/contractor/reviews/AUTH-006-R2-tenant-context.md` at `3c28d89`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-006-tenant-context.md` — bind verified
  selected membership to every PG business transaction on one checked-out client.
- Amended TOUCH: `db/postgres/migrations/033-membership-admission-lock.sql` (new additive
  authority serialization), `src/db/tenant-context.mjs`, `src/db/README.md`,
  `src/auth/tenant-selection.mjs`, `src/auth/routes.mjs`,
  `src/auth/session-store.mjs`, `src/auth/README.md`,
  `tests/auth-006-context.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`.
- Implementation commit: `bbe9bdb` (`app: serialize membership and role authority with
  admission gate [contract:AUTH-006-R3]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`db/postgres/migrations/033-membership-admission-lock.sql` (new),
`src/auth/tenant-selection.mjs`, `src/auth/README.md`, `src/db/README.md`,
`tests/auth-006-context.test.mjs`, delivery report and this checkpoint. No changes to
routes/session-store this round; no other migration, grant, RLS or owner change.

## What was delivered

1. **Authority gate migration 033**
   - One fixed transaction-scoped advisory key `saven.auth.authority_gate`.
   - Admission takes it SHARED before authority reads/locks and holds it through business
     completion; BEFORE STATEMENT INSERT/UPDATE/DELETE triggers on
     `auth.tenant_membership` and `auth.roles` take it EXCLUSIVELY before row writes.
   - Trigger functions `SECURITY INVOKER`, `search_path=pg_catalog`, owned by the offline
     DDL/migration authority; PUBLIC EXECUTE revoked; no runtime grant, no SECURITY
     DEFINER, no RLS/policy/table change, no BYPASSRLS, no dynamic SQL.
   - Conflict guard rejects pre-existing gate function/triggers.
2. **Admission integration**
   - `tenant-selection.loadAuthority` first verifies the gate is installed (6 triggers +
     function) and acquires the shared gate before user/factor/session locks and
     membership/role reads.
   - Missing/misinstalled gate → `503 TENANT_AUTHORITY_GATE_UNAVAILABLE`; failed
     acquisition → `503 TENANT_AUTHORITY_UNAVAILABLE`; pool remains reusable.
   - Exact selected-role binding retained and extended: session `selectedRoleId` must
     equal the current membership role.
   - Order: gate -> users -> factor -> session -> membership/role reads -> business
     client/transaction.
3. **Docs** — DB README now documents the implemented gate, global contention, ordering,
   failure/cleanup and future extension; auth README documents gate, SECURITY INVOKER
   ownership and gate-installation refusal. Earlier proposal wording removed.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`
  → PASS, 25/25, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55432`, accepted PIVOT-004/031/032 + 033 stack, real non-owner
  auth-service/customer-app logins.
- Pause-after-final-validation writers prove blocking through business COMMIT for:
  membership revocation, epoch change, existing-role `requires_mfa` change, activation of
  a revoked membership, selected-role change, actual new MFA-requiring membership INSERT.
- Mixed role+membership writer transactions block in both table orders.
- Catalog/privilege/conflict-guard checks; missing/failed gate fail-closed and pool reuse;
  smallest separate auth/business pools (`max:1` each).
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27.
- Combined serial run (`--test-concurrency=1`): 118 tests, 118 pass, 0 fail.
- Findings 2 (realm/MFA) and 3 (same-tenant company composition) remain closed.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-006 not merged; `testing-1` remains `1b9ff78`.

## Where I stopped

Last completed step: committed `bbe9bdb`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started.

## Exact next step

1. Await the Codex verdict on AUTH-006-R3.
2. On **ACCEPT**: nothing further from me for AUTH-006; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE within TOUCH**: fetch the rulings branch, apply only scoped corrections,
   re-run focused plus AUTH-002..005, update the report, commit/push on
   `opencode/auth-006-context`, and stop without merging.

Open items/limits: the gate is deliberately global for authority writes (no throughput/SLA
claim); arbitrary administrative SQL violating the order can still deadlock and the
runtime fails closed; migration 033 is administrator-applied, not executed in production by
this session; auth/business transactions remain distinct (late auth commit failure is
uncertain, not an undo); AUTH-009 tenant-selection audit vocabulary; production company/
resource authorization engine; no load/PgBouncer-instance claim.
