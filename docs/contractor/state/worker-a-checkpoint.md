# WORKER-A checkpoint — PIVOT-008 R3 bounded corrections delivered, awaiting re-review

Date: 20 November 2026 (Asia/Karachi). Round-end checkpoint. Not merged.

## Exact contract and reviews

- Contract: `docs/contractor/contracts/PIVOT-008-rls-coverage.md`
- Reviews: `719034b` (R0), `3b23f41` (R1), `7dee232` (`docs/contractor/reviews/PIVOT-008-R2-rls-coverage.md`, R2)
- Base `testing-1` @ `fae227b`; branch `opencode/pivot-008-rls-coverage` @
  `/home/esc/saven/wt-pivot-008`.
- Prior implementations: R0 `2bb9dec`/`6ec3efa`; R1 `c6eb6ab`/`80978be`; R2 `f003af7`/`a742bfc`.
- R3 implementation: `cd29914b7b89923ede3a1f85604ebf90f9cb0603`.
- TOUCH: `db/postgres/99-ci-rls-coverage.sql`, `scripts/verify-pg-rls.mjs`,
  `scripts/check.mjs`, `.github/workflows/postgres-pivot.yml`,
  `tests/pivot-008-coverage.test.mjs`, `db/postgres/README.md`.
- Delivery report: `docs/contractor/deliveries/PIVOT-008-rls-coverage.md`.
- Environment: Node `v24.19.0`, PostgreSQL `18.6`, loopback cluster `55435`,
  `SAVEN_PIVOT_TEST_CLUSTER=1`.

## Review findings — per-finding enumeration

| # | Finding | Status | Named test / control |
| --- | --- | --- | --- |
| 1 | Exact installed contract | **ADDRESSED within declared manifest**; source-hash residual disclosed | `PIVOT-008 installed surface: complete stack passes, empty or single-missing installs fail via CLI` |
| 2 | Canonical policies and real behavioral evidence | **ADDRESSED**; exact contract/fail-closed residual | `PIVOT-008 effective isolation: per-command catalog gaps and real restricted-login behavior` — weak-policy normal assertion red, CLI red, restored green; multi-target membership negative |
| 3 | Complete authority profiles | **ADDRESSED within reviewed classes**; DB/tablespace/default-ACL/role-setting excluded by scope | `PIVOT-008 effective authority: column ACLs, operator/auth boundary, EXECUTE allow-list and logins` |
| 4 | Transitive paths / child operations | **ADDRESSED — named blocker corrected**; procedural analysis excluded by scope | `PIVOT-008 transitive paths, default ACLs, owner excess and installed authority protocol` — command-code child contract, true-policy CLI red, canonical/op-specific controls, own/foreign behavior |
| 5 | Exact dedicated-owner granularity | **ADDRESSED within accepted release profile**; DB/tablespace/default-ACL/role-setting excluded | same test — extra column, wrong operation, missing column, extra owned function |
| 6 | Owned cleanup | **CLOSED — preserved** | `PIVOT-008 runner failure paths: ownership-tracked cleanup, collision, residue and fail-closed` |

## Bounded corrections — evidence

1. **Child command representation and effective isolation.** Runtime privileges are
   normalized to policy codes `r/a/w/d`; child policy comparison is per actual operation
   and applicable principal. A forced-RLS child with both `FOR ALL` predicates true and a
   customer INSERT grant fails the CLI with
   `UNSAFE_PARTITION_WRITE_PATH public.p8_true_live:INSERT`; a read child fails with
   `UNSAFE_PARTITION_PATH public.p8_true_read:SELECT`. Canonical and exact
   operation-specific children pass; behavior: true child `own 3 / foreign 1`, canonical
   child `own 2 / foreign 0`. Existing no-policy/multi-level/column-only negatives remain.
2. **Exact membership role set.** `membership_policy_actual` compares the complete
   `polroles` array (no `LIMIT 1`); an expected role plus an extra target fails
   `AUTH_MEMBERSHIP_POLICY_INVALID`; the single-target healthy stack stays green.
3. **Weak-policy evidence order.** Healthy `assertNoForeignRows` passes; under the
   mutation the same normal assertion is run and observed failing, foreign count 1 is
   recorded, and the CLI exits 1; after restoration the normal assertion passes and the
   CLI exits 0. The exact-hash policy contract is the gate.

## Gate evidence

- `node scripts/check.mjs` → `PASS: 176 JavaScript files parsed; package manifest valid.`
- `node --test tests/pivot-008-coverage.test.mjs` → **6/6** pass, 0 fail.
- `node scripts/check.mjs --postgres` → `PASS: PIVOT-008 RLS/privilege coverage found no violation in 55435; installed authority protocol accepted.`
- Regression `pivot-004/005/006/007` + `auth-006/007` → **122/122** pass.
- PIVOT-007 transient: prior first-run `assert.rejects` failure in `adapter refuses post-preflight source-age boundary crossing with a permitted control` (test line 1799, adapter read `support-read.mjs:228`); 5/5 isolated reruns and the full 122 rerun pass; hypothesis is wall-clock boundary under suite load; no adapter change. Out-of-TOUCH if it recurs.

## Where I stopped

R3 delivered and pushed; not merged. No known failing test in this contract. Residual limits are
the review's bounded-scope exclusions, not silently proven. Process artifacts outside TOUCH:
this checkpoint and the delivery report (protocol steps 5–6).

D-016/D-018 unchanged: no allocator, mapping incarnation, IAM flow or legacy event was created,
reused or renumbered; the gate is read-only.

## Exact next step

1. Codex re-reviews `cd29914` against the two bounded corrections and the R2 dispositions.
2. Dispatcher relays any remaining findings; fixes stay on this branch.
3. No merge without the human-approved dispatcher command. Rebase `scripts/check.mjs`
   mechanically if PIVOT-014 merges first.
