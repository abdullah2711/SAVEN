# WORKER-A checkpoint — PIVOT-008 R2 corrections delivered, awaiting re-review

Date: 20 November 2026 (Asia/Karachi). Round-end checkpoint. Not merged.

## Exact contract and reviews

- Contract: `docs/contractor/contracts/PIVOT-008-rls-coverage.md`
- Prior reviews: `719034b` (R0), `3b23f41` (`docs/contractor/reviews/PIVOT-008-R1-rls-coverage.md`, R1)
- Base `testing-1` @ `fae227b`; branch `opencode/pivot-008-rls-coverage` @
  `/home/esc/saven/wt-pivot-008`.
- Prior implementations: R0 `2bb9dec`/`6ec3efa`; R1 `c6eb6ab`/`80978be`.
- R2 implementation: `f003af7acbaaaa1082b15733f77eb26cbf3d41f8`.
- TOUCH: `db/postgres/99-ci-rls-coverage.sql`, `scripts/verify-pg-rls.mjs`,
  `scripts/check.mjs`, `.github/workflows/postgres-pivot.yml`,
  `tests/pivot-008-coverage.test.mjs`, `db/postgres/README.md`.
- Delivery report: `docs/contractor/deliveries/PIVOT-008-rls-coverage.md`.
- Environment: Node `v24.19.0`, PostgreSQL `18.6`, loopback cluster `55435`,
  `SAVEN_PIVOT_TEST_CLUSTER=1`.

## Review findings — status and named tests

| # | Finding | Status | Named test / control |
| --- | --- | --- | --- |
| 1 | Installed contract, not names alone | **PARTIAL** (correction proven; checksum/version residual) | `PIVOT-008 installed surface: complete stack passes, empty or single-missing installs fail via CLI` — kind mismatch, checksum conflict, missing table/role/function |
| 2 | Weakened policies must fail the actual gate | **PARTIAL** (exact canonical contract; arbitrary-variant residual) | `PIVOT-008 effective isolation: per-command catalog gaps and real restricted-login behavior` — selective gap, membership gap, unexpected policy, weak-policy CLI exit 1, no-leak/leak/restore |
| 3 | Restore/complete effective authority | **PARTIAL** (schema/logins/external/capability covered; DB/tablespace/default-ACL residual) | `PIVOT-008 effective authority: column ACLs, operator/auth boundary, EXECUTE allow-list and logins` |
| 4 | Whole-path and reachable-write publication | **PARTIAL** (taint + write children; procedural-path residual) | `PIVOT-008 transitive paths, default ACLs, owner excess and installed authority protocol` — mixed-owner wrapper, write-only/column-only child, safe invoker control |
| 5 | Exact owner privilege granularity | **PARTIAL** (table/column/sequence/function/schema exact; DB/role-setting residual) | same test — extra column, wrong operation, missing column, extra owned function |
| 6 | Owned runner cleanup | **CLOSED — preserved** | `PIVOT-008 runner failure paths: ownership-tracked cleanup, collision, residue and fail-closed` |

Per-finding controls, exact failing diagnostics and process outcomes are recorded in the delivery
report. No finding is claimed DONE across the board.

## Gate evidence

- `node scripts/check.mjs` → `PASS: 176 JavaScript files parsed; package manifest valid.`
- `node --test tests/pivot-008-coverage.test.mjs` → **6/6** pass, 0 fail.
- `node scripts/check.mjs --postgres` → `PASS: PIVOT-008 RLS/privilege coverage found no violation in 55435; installed authority protocol accepted.`
- Regression `pivot-004/005/006/007` + `auth-006/007` → **122/122** pass on rerun.
- Transient: one timing-sensitive PIVOT-007 source-age test failed on the first regression run and passed on the immediate full rerun; disclosed, not masked.
- CLI red/green controls include kind mismatch, checksum conflict, weak policy, schema CREATE/extra usage, elevated login, external definer, capability role switch, mixed-owner view, write-only child and exact owner drift.

## Where I stopped

R2 delivered and pushed; not merged. No known failing test in this contract, no in-contract work
left UNTOUCHED; residuals are stated as PARTIAL limits in the report. Process artifacts outside
TOUCH: this checkpoint and the delivery report (protocol steps 5–6).

D-016/D-018 unchanged: no allocator, mapping incarnation, IAM flow or legacy event was created,
reused or renumbered; the gate is read-only.

## Exact next step

1. Codex re-reviews `f003af7` against findings 1–5 and preserves the closed finding 6.
2. Dispatcher relays any remaining findings; fixes stay on this branch.
3. No merge without the human-approved dispatcher command. Rebase `scripts/check.mjs`
   mechanically if PIVOT-014 merges first.
