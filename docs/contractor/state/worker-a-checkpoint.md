# WORKER-A checkpoint — PIVOT-008 R1 corrections delivered, awaiting re-review

Date: 20 November 2026 (Asia/Karachi). Round-end checkpoint. Not merged.

## Exact contract and review

- Contract: `docs/contractor/contracts/PIVOT-008-rls-coverage.md`
- Review: `719034b` `docs/contractor/reviews/PIVOT-008-rls-coverage.md` (REVISE, findings 1–6)
- Base `testing-1` @ `fae227b`; branch `opencode/pivot-008-rls-coverage` @
  `/home/esc/saven/wt-pivot-008`.
- Prior delivery `6ec3efa` (implementation `2bb9dec`); R1 implementation
  `c6eb6ab57b7d61b7418035e382d3811b6261e68f`.
- TOUCH: `db/postgres/99-ci-rls-coverage.sql`, `scripts/verify-pg-rls.mjs`,
  `scripts/check.mjs`, `.github/workflows/postgres-pivot.yml`,
  `tests/pivot-008-coverage.test.mjs`, `db/postgres/README.md`.
- Delivery report: `docs/contractor/deliveries/PIVOT-008-rls-coverage.md`.
- Environment: Node `v24.19.0`, PostgreSQL `18.6`, loopback cluster `55435`,
  `SAVEN_PIVOT_TEST_CLUSTER=1`.

## Review findings — status and named tests

| # | Finding | Status | Named test |
| --- | --- | --- | --- |
| 1 | Missing installed surface could pass empty | **DONE** | `PIVOT-008 installed surface: complete stack passes, empty or single-missing installs fail via CLI` |
| 2 | Policy counts did not prove operation/principal isolation; no runtime behavior | **DONE** | `PIVOT-008 effective isolation: per-command catalog gaps and real restricted-login behavior` |
| 3 | Effective forbidden grants and role assumptions incomplete | **DONE** | `PIVOT-008 effective authority: column ACLs, operator/auth boundary, EXECUTE allow-list and logins` |
| 4 | Child/view reachability one hop deep | **DONE** | `PIVOT-008 transitive paths, default ACLs, owner excess and installed authority protocol` |
| 5 | NULL ACL defaults and installed authority protocol unverified | **DONE** | same test, plus CLI protocol-probe case |
| 6 | Runner failure paths leak or delete unowned database | **DONE** | `PIVOT-008 runner failure paths: ownership-tracked cleanup, collision, residue and fail-closed` |

Per-finding evidence detail is in the delivery report. No finding remains UNTOUCHED or PARTIAL
within the contract; no open in-contract defect is known.

## Gate evidence

- `node scripts/check.mjs` → `PASS: 176 JavaScript files parsed; package manifest valid.`
- `node --test tests/pivot-008-coverage.test.mjs` → **6/6** pass, 0 fail.
- `node scripts/check.mjs --postgres` → `PASS: PIVOT-008 RLS/privilege coverage found no violation in 55435; installed authority protocol accepted.`
- Regression `pivot-004/005/006/007` + `auth-006/007` → **122/122** pass.
- CLI failure paths observed: disabled gate → `MISSING_REQUIRED_TRIGGER` + `PROTOCOL_PROBE_FAILED`; collision → exit 2 and untouched; post-create failure → exit 1 and owned DB removed; drop failure → exit 1 + `RESIDUE` target retained; empty install → missing schema/role/relation.

## Where I stopped

R1 delivered and pushed; not merged. No known failing test, no mid-fix failure evidence to
report. Process artifacts outside TOUCH: this checkpoint and the delivery report (protocol
steps 5–6).

D-016/D-018: no allocator, mapping incarnation, IAM flow or legacy event was created, reused or
renumbered; the gate is read-only.

## Exact next step

1. Codex re-reviews `c6eb6ab` against findings 1–6.
2. Dispatcher relays any remaining findings; fixes stay on this branch.
3. No merge without the human-approved dispatcher command. Rebase `scripts/check.mjs`
   mechanically if PIVOT-014 merges first.
