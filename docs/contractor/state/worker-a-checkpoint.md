# WORKER-A checkpoint — PIVOT-008 delivered, awaiting Codex review

Date: 20 November 2026 (Asia/Karachi). Round-end checkpoint. Not merged.

## Exact contract

- `docs/contractor/contracts/PIVOT-008-rls-coverage.md`
- Base `testing-1` @ `fae227b`; branch `opencode/pivot-008-rls-coverage` @
  `/home/esc/saven/wt-pivot-008`.
- TOUCH: `db/postgres/99-ci-rls-coverage.sql`, `scripts/verify-pg-rls.mjs`,
  `scripts/check.mjs`, `.github/workflows/postgres-pivot.yml`,
  `tests/pivot-008-coverage.test.mjs`, `db/postgres/README.md`.
- Delivery report: `docs/contractor/deliveries/PIVOT-008-rls-coverage.md`.
- Environment: Node `v24.19.0`, PostgreSQL `18.6`, disposable loopback cluster
  `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`.

## Requirements / findings — status

| # | Requirement | Status | Proving evidence |
| --- | --- | --- | --- |
| 1 | Missing ENABLE/FORCE/policy fails nonzero | **DONE** | five `MISSING_*` kinds + seeded isolation test |
| 2 | Unsafe partition/child/view/function path fails | **DONE** | `UNSAFE_PARTITION_PATH`, `UNSAFE_VIEW_OWNER`, `UNSAFE_MATERIALIZED_VIEW`, definer owner/search-path/PUBLIC/row-security/assumption checks |
| 3 | Runtime ownership/BYPASS and forbidden grants fail | **DONE** | `SAVEN_BYPASS_OR_SUPER`, `RUNTIME_OWNS_*`, `RUNTIME_SCHEMA_CREATE`, `RUNTIME_ASSUMES_PRIVILEGED_ROLE`, `FORBIDDEN_RUNTIME_PRIVILEGE`, cross-schema, `PUBLIC_*` |
| 4 | Negative behavioral tests supplement catalog presence | **DONE** | 21 seeded cases across two tests; healthy test asserts populated surface |
| 5 | Unavailable required gate fails, never skips | **DONE** | exit 2 without opt-in/connection; `check.mjs --postgres` propagates; CLI test |
| 6 | Zero-row SELECT becomes nonzero exit | **DONE** | committed `NO FORCE RLS` → exit 1 + exact line; restore → exit 0 |
| 7 | Offline parser check remains PG-free | **DONE** | `node scripts/check.mjs` without PG env |
| 8 | No new superuser/BYPASSRLS/client-authoritative context | **DONE** | gate checks both; no role/grant/policy created |
| 9 | No hardcoded growing domains / new coupling | **DONE** | suffix-derived role classes; no new module imports |
| 10 | Preserve applied migration/native bytes | **DONE** | only TOUCH + process docs changed |

D-016/D-018: no allocator, mapping incarnation, IAM flow or legacy event was created, reused or renumbered.

## Gate evidence

- `node scripts/check.mjs` → `PASS: 176 JavaScript files parsed; package manifest valid.`
- `node --test tests/pivot-008-coverage.test.mjs` → **5/5** pass, 0 fail.
- `node scripts/check.mjs --postgres` → `PASS: PIVOT-008 RLS/privilege coverage found no violation in 55435.`
- Regression: `pivot-004`, `pivot-005`, `pivot-006`, `pivot-007`, `auth-006`, `auth-007` → **122/122** pass, 0 fail.
- Default verifier installs/drops a private temporary database and is re-runnable; missing opt-in and refused connections exit 2.

## Where I stopped

Delivery complete and pushed on `opencode/pivot-008-rls-coverage`; not merged. No known failing
test and no open in-contract defect. No mid-fix failure evidence to report.

Process artifacts outside TOUCH: this checkpoint and the delivery report, as required by the
contractor protocol. `node_modules` is an untracked local symlink, not committed.

## Exact next step

1. Codex reviews the delivery against the ten contract requirements above.
2. Dispatcher relays any findings; fix rounds stay on this branch.
3. No merge without the human-approved dispatcher command. PIVOT-014 also edits
   `scripts/check.mjs`; rebase mechanically on whichever merges second.
