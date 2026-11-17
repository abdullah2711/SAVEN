# WORKER-B checkpoint — PIVOT-006 delivered, awaiting review

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Current state

- PIVOT-005 is complete and human-merged into `testing-1` at
  `32fef2beac91a73b2c8a5ae9c150603736993e97`; the post-merge checkpoint is `e671882`.
- PIVOT-006 branch: `opencode/pivot-006-audit`.
- Worktree: `/home/esc/saven/wt-pivot-006`, based on `32fef2b`.
- Implementation commit: `9f137387de33861d170ab983cb53f410b5fce773`
  (`db: add actor-bound tenant change audit payload and dispatcher registration
  [contract:PIVOT-006]`).
- This checkpoint is the follow-up commit on the same branch. PIVOT-006 is **not
  merged**; no main/other branch was changed and no force was used.

## Contract

- Contract: `docs/contractor/contracts/PIVOT-006-audit-triggers.md`.
- TOUCH: `db/postgres/40-triggers.sql`,
  `db/postgres/migrations/041-audit.sql` (new),
  `db/postgres/README.md`, `tests/pivot-006-audit.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/pivot-006-audit.test.mjs`.
- Applied bytes of 040/042 were not edited. 041 is a new immutable payload, and
  40-triggers registers it alongside 040/042 per the af333f5 review note.

## Delivered

- `041-audit.sql` defines:
  - `immutability_041_row_key(regclass, jsonb)` — catalog-driven canonical JSON target
    identity from the table primary key.
  - `immutability_041_audit_row()` — `SECURITY DEFINER` (owned by `saven_migrator`,
    fixed `search_path`) audit writer for business-table INSERT/UPDATE/DELETE. It
    records tenant, verified actor, event, target table/id, full before/after JSON,
    audit schema/target version, transaction id, `origin_type='human'`,
    `origin_user_id` and time in `tenant_data.audit_event`, in the same transaction.
  - `immutability_041_audit_append_guard()` and
    `immutability_041_audit_truncate_guard()` — append-only audit storage guards.
- Actor/tenant come only from the transaction-local AUTH-006 context and the
  tenant-local `members` projection. Missing/foreign context raises
  `AUDIT_CONTEXT_REQUIRED`; unmapped/current-tenant-mismatched actors raise
  `AUDIT_ACTOR_UNVERIFIED`; unresolved target raises `AUDIT_TARGET_UNRESOLVED`. The
  business mutation rolls back. No fabricated historical actor is written.
- `40-triggers.sql`:
  - attaches 041 audit writer to the explicit reviewed business-table list;
  - attaches row UPDATE/DELETE guards to `audit` and `audit_event`;
  - attaches statement-level TRUNCATE guards to both audit tables;
  - validates audit coverage, owner/`search_path`, and that the runtime has no direct
    audit write/update/delete/truncate privilege or direct audit-writer EXECUTE;
  - retains every 040/042 binding and refuses installed-but-unregistered payloads.
- 041 is optional for a PIVOT-005-only (040/042) installation so the already-merged
  PIVOT-005 gate remains runnable without editing its test file. PIVOT-006 audit
  coverage and acceptance require 041; when installed, 40-triggers attaches and
  validates it fail-closed. A partially installed 041 payload refuses.
- Native `tenant_data.audit` is preserved and is not rewritten or back-filled. The
  audit writer defensively skips `audit`/`audit_event`, and the dispatcher never attaches
  the change writer there, so no recursive audit loop exists.
- Generic audit excludes audit storage itself, command delivery infrastructure
  (`command_inbox`, `outbox`), imported provenance (`source_store_migrations`) and
  PIVOT-005's own `entry_voids`/`void_denials`; those keep their native audit/denial
  semantics. The reviewed audited-table list is explicit in the dispatcher.
- `README.md` documents the 041 run-order step, the PIVOT-006 audit section, the
  optional-install boundary and the append-only/missing-context rules.
- `tests/pivot-006-audit.test.mjs` covers actor-bound insert/update/delete, before/after
  and target, actor spoof via `created_by`/`updated_by`, missing context, spoofed
  tenant/user, rollback on injected audit failure, concurrent events, tenant-scoped
  visibility, append-only UPDATE/DELETE/TRUNCATE denial, preserved native audit,
  no-recursion, dispatcher registration/re-run, 041 immutability and static contract.

## Evidence

- `node scripts/check.mjs` → PASS, 165 JavaScript files.
- Focused gate `node --test tests/pivot-006-audit.test.mjs` → **6/6 pass**, exit 0.
- PIVOT-005 regression on the same tree → **18/18 pass**.
- Full suite with `--test-concurrency=1` → **303/304 pass**. The only failure is the
  known out-of-TOUCH `PIVOT-004` literal-global-role test on a namespaced pristine
  cluster, unchanged from earlier rounds.
- A parallel full-suite run also showed pre-existing AUTH-003/AUTH-005 timing/teardown
  transients; the serial rerun above is the stable integration evidence. None is in
  PIVOT-006 TOUCH.
- Environment: dedicated disposable PostgreSQL 18.6 on loopback `127.0.0.1:55435`,
  `SAVEN_PIVOT_TEST_CLUSTER=1`, local admin `esc`, Node v24.19.0 via
  `npm exec --yes --package=node@24.19.0`. No global `saven_*` role was created;
  the fixture namespaced and removed every object. Cluster stopped after verification.

## TOUCH used

`db/postgres/40-triggers.sql`, `db/postgres/migrations/041-audit.sql` (new),
`db/postgres/README.md`, `tests/pivot-006-audit.test.mjs`, and this checkpoint. Nothing
outside TOUCH (other than the explicitly requested checkpoint) was changed. 040/042
bytes, native/reference source, archive, production/server entry points and PIVOT-004
fixtures/tests are untouched.

## Where I stopped

Implementation, focused/regression gates, serial full-suite evidence, commit and push
are complete on `opencode/pivot-006-audit`. No review corrections have been started.
PIVOT-006 is not merged.

## Exact next step

1. Await the Codex review/verdict on the PIVOT-006 delivery (expected on
   `origin/codex/pivot-003-rulings`).
2. On **REVISE**: fetch the rulings branch, read the new review in full, apply exactly
   the scoped corrections inside the PIVOT-006 TOUCH, re-run the focused gate plus
   PIVOT-005, update this checkpoint/evidence, commit and push on
   `opencode/pivot-006-audit`; do not merge.
3. On **ACCEPT**: stop and report; a human Business Merge Request is required. Do not
   merge without the dispatcher's explicit merge instruction.
4. Final PIVOT-006 application acceptance still depends on AUTH-006; failed/denied
   access-attempt durability and operational reconciliation remain PIVOT-013 scope.
