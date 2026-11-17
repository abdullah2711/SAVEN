# WORKER-A checkpoint — AUTH-006-R4 delivered, gate contract validated and atomic

Date: 18 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-006 branch/worktree: `opencode/auth-006-context` at
  `/home/esc/saven/wt-auth-006`, based on `testing-1 @ 1b9ff78`.
- Round just delivered: **AUTH-006-R4**, correcting
  `docs/contractor/reviews/AUTH-006-R3-tenant-context.md` at `5ddb603`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-006-tenant-context.md` (with ENGINEER R2
  AMENDMENT) — verified tenant context and authority serialization.
- Amended TOUCH: `db/postgres/migrations/033-membership-admission-lock.sql`,
  `src/db/tenant-context.mjs`, `src/db/README.md`, `src/auth/tenant-selection.mjs`,
  `src/auth/routes.mjs`, `src/auth/session-store.mjs`, `src/auth/README.md`,
  `tests/auth-006-context.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`.
- Implementation commit: `52c9822` (`app: validate authority gate bindings and make 033
  atomic [contract:AUTH-006-R4]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`db/postgres/migrations/033-membership-admission-lock.sql`,
`src/auth/tenant-selection.mjs`, `src/auth/README.md`, `src/db/README.md`,
`tests/auth-006-context.test.mjs`, delivery report and this checkpoint. No routes/session
store delta this round; no grant/RLS/definer/owner expansion.

## R4 corrections and status

1. **HIGH — exact gate contract validation. Closed.**
   `assertAuthorityGateInstalled` now validates the real binding contract before authority
   work:
   - one zero-argument plpgsql trigger function, `SECURITY INVOKER`, `proconfig` exactly
     `search_path=pg_catalog`, owner NOLOGIN/NOSUPERUSER/NOBYPASSRLS and not reachable from
     the runtime's role memberships;
   - each trigger's exact table, event, BEFORE STATEMENT `tgtype`, function OID,
     unconditional predicate, no arguments/columns/constraint/deferral, firing mode
     origin/always.
   Replica-only/disabled, wrong function, wrong table, wrong event, row-level conditional,
   SECURITY DEFINER and wrong `search_path` profiles all fail closed with
   `TENANT_AUTHORITY_GATE_UNAVAILABLE`; negatives assert no handler/effect, then a valid
   profile recovers with clean pool reuse. Trust boundary documented: catalog flags prove
   installed bindings/configuration, not arbitrary privileged body tampering by the DDL
   owner.
2. **MEDIUM — 033 independently atomic. Closed.**
   Migration now has explicit `BEGIN/COMMIT`, preflight conflict guard before mutation, and
   documented application mode (no ambient transaction; statement-by-statement runners are
   atomic). Tests split the real payload and prove: foreign conflicting objects refused and
   unchanged; injected interruption after DDL rolls back to zero gate objects; clean retry
   installs the function + six triggers; freshly installed protocol composes with a real
   selected context.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`
  → PASS, 27/27, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55432`, accepted PIVOT-004/031/032 + 033 stack, real non-owner
  auth-service/customer-app logins.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27.
- Combined serial run (`--test-concurrency=1`): 120 tests, 120 pass, 0 fail.
- Findings 2 (realm/MFA) and 3 (same-tenant company composition) remain closed from R1.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-006 not merged; `testing-1` remains `1b9ff78`.

## Where I stopped

Last completed step: committed `52c9822`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started.

## Exact next step

1. Await the Codex verdict on AUTH-006-R4.
2. On **ACCEPT**: nothing further from me for AUTH-006; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE within TOUCH**: fetch the rulings branch, apply only scoped corrections,
   re-run focused plus AUTH-002..005, update the report, commit/push on
   `opencode/auth-006-context`, and stop without merging.

Open items/limits: gate is global for authority writes (no throughput/SLA claim); arbitrary
administrative SQL violating the order can still deadlock and the runtime fails closed;
migration 033 is administrator-applied and not executed in production by this session;
auth/business transactions remain distinct; AUTH-009 selection audit vocabulary; production
company/resource authorization engine; no load/PgBouncer-instance claim.
