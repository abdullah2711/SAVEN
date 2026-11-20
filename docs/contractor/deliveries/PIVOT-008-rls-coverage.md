# PIVOT-008 delivery — target PG RLS/privilege coverage gate (REVISION R3)

Date: 20 November 2026 (Asia/Karachi). Worker A. Status: R3 bounded corrections delivered, awaiting codex re-review. Not merged.

## Identity

- Contract: `docs/contractor/contracts/PIVOT-008-rls-coverage.md`
- Reviews: `719034b` (R0), `3b23f41` (R1), `7dee232` (`docs/contractor/reviews/PIVOT-008-R2-rls-coverage.md`, R2)
- Base: `testing-1` @ `fae227b`
- Prior implementations: R0 `2bb9dec`/`6ec3efa`; R1 `c6eb6ab`/`80978be`; R2 `f003af7`/`a742bfc`
- R3 implementation: `cd29914b7b89923ede3a1f85604ebf90f9cb0603`
- Branch: `opencode/pivot-008-rls-coverage`; worktree `/home/esc/saven/wt-pivot-008`
- Environment: Node `v24.19.0`, PostgreSQL `18.6`, loopback cluster `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`, admin `esc`, `PGADMIN_DATABASE=postgres`
- Working tree: only untracked `node_modules` (local symlink, not committed)

## Files changed in R3 (within TOUCH)

| File | Change |
| --- | --- |
| `db/postgres/99-ci-rls-coverage.sql` | Child privileges normalized to PostgreSQL command codes; exact canonical per-operation tenant/admission child contract; complete membership `polroles` target-set comparison. |
| `tests/pivot-008-coverage.test.mjs` | Forced-RLS true-policy child CLI/behavior negatives; canonical and operation-specific child controls; multi-target membership negative; normal no-foreign-row assertion run to red under the weak-policy mutation and restored green. |
| `db/postgres/README.md` | Child command contract, exact role-set binding, evidence wording and bounded-scope limits updated. |

No applied migration bytes, native/reference source, runtime roles, grants or catalog state were changed by the product code.

## Per-finding enumeration (review `7dee232`)

| Finding | Disposition | Evidence in R3 |
| --- | --- | --- |
| 1 — exact installed contract | **ADDRESSED within declared manifest**; residual: source hashes identify reviewed program bodies, not every payload byte | Kind + 14 normalized program-body bindings; CLI negatives `REQUIRED_OBJECT_KIND_MISMATCH`, `INSTALLATION_BINDING_MISMATCH`; restored controls green |
| 2 — canonical policies and behavioral evidence | **ADDRESSED**; residual: exact reviewed contract/fail-closed, not a theorem prover | Exact tenant/membership contracts; weak-policy CLI exit 1; normal `assertNoForeignRows` run under the mutation and observed failing, then restored green; multi-target membership negative |
| 3 — complete authority profiles | **ADDRESSED within reviewed classes**; residual: DB/tablespace/default ACL/role settings excluded by scope ruling | Schema CREATE/USAGE/ownership, elevated login, external function, capability switch, column ACL and EXECUTE cases remain green/red as named |
| 4 — transitive paths and child operations | **ADDRESSED — named blocker corrected**; residual: procedural function/rule analysis excluded by scope ruling | Command-code normalization; exact per-operation child contract; concrete forced-RLS true-policy child rejected by CLI; canonical and operation-specific child controls accepted; own/foreign behavior demonstrated |
| 5 — exact dedicated-owner granularity | **ADDRESSED within accepted release profile**; residual: DB/tablespace/default ACL/role settings excluded | Exact 63-row owner privilege/column manifest, schema and owned-function profile; prior extra-column/wrong-operation/missing/owned-function negatives retained |
| 6 — owned cleanup | **CLOSED — preserved** | Runner unchanged in R3; collision/post-CREATE/residue/unavailable cases remain green |

## Bounded correction 1 — child isolation with one command representation

`runtime_write_endpoints` now emits PostgreSQL command codes (`a/w/d`) with labels only for output; `child_runtime_commands` mixes read (`r`) and write codes without string comparison against uppercase privileges. For every actual child command reachable by a runtime actor, the gate requires:

- `ENABLE` + `FORCE` RLS;
- an exact canonical permissive tenant-isolation policy applicable to the command (canonical normalized `USING` hash `4fb3…`, `WITH CHECK` where the command needs it);
- an exact restrictive tenant-scope partner with the same canonical predicate;
- where a `customer_app` actor has that command, an exact restrictive customer-admission policy with the canonical admission hash `2049…`.

This applies per operation, not by policy existence or substring. `FOR ALL` policies cover every code; operation-specific `FOR INSERT/SELECT` policies cover only their code. A child with both `FOR ALL` policies and true predicates fails; a child with only a `FOR SELECT` contract fails an INSERT grant.

Named outcomes:

- Concrete unsafe profile: child outside `tenant_data`, ENABLE/FORCE RLS, permissive and restrictive `FOR ALL` `USING/WITH CHECK true`, customer INSERT — CLI exits 1: `UNSAFE_PARTITION_WRITE_PATH public.p8_true_live:INSERT`.
- Read-only true-policy child — `UNSAFE_PARTITION_PATH public.p8_true_read:SELECT`.
- Behavior: true-policy child exposes foreign rows (`own 3 / foreign 1`); canonical child gives `own 2 / foreign 0` and CLI exit 0.
- Permitted exact `FOR ALL` canonical child — no violation, CLI green.
- Permitted exact operation-specific `FOR SELECT` child — no violation with SELECT; adding INSERT produces `UNSAFE_PARTITION_WRITE_PATH …:INSERT`.
- Existing no-policy, multi-level and column-only child negatives remain.

## Bounded correction 2 — exact role targets and evidence

`membership_policy_actual` now compares the complete `polroles` array against exactly one accepted role (`auth_service`, `tenant_admission_definer` or PUBLIC); `LIMIT 1` role selection is removed. An expected role plus an extra target resolves to `other` and fails `AUTH_MEMBERSHIP_POLICY_INVALID`; the single-target healthy stack remains green.

Weak-policy evidence, in order:

1. Healthy stack: `assertNoForeignRows` passes (foreign rows 0).
2. Under the weakened nonliteral policy: the **same normal assertion** is run and observed to fail (`foreign rows must remain invisible`); the actual foreign count is then recorded as 1; the actual CLI exits 1 (`POLICY_OPERATION_GAP`/`UNEXPECTED_POLICY`).
3. Restored canonical policies: `assertNoForeignRows` passes again and CLI exits 0.

The exact-hash policy contract is the gate; behavior is supplementary evidence, not a replacement. The report no longer implies behavior alone proves the rejection.

## Gate evidence (commands after `cd29914`)

```text
$ node scripts/check.mjs && node --test tests/pivot-008-coverage.test.mjs && node scripts/check.mjs --postgres
PASS: 176 JavaScript files parsed; package manifest valid.
✔ PIVOT-008 static contract: manifest, effective checks and fail-closed runner wiring
✔ PIVOT-008 installed surface: complete stack passes, empty or single-missing installs fail via CLI
✔ PIVOT-008 effective isolation: per-command catalog gaps and real restricted-login behavior
✔ PIVOT-008 effective authority: column ACLs, operator/auth boundary, EXECUTE allow-list and logins
✔ PIVOT-008 transitive paths, default ACLs, owner excess and installed authority protocol
✔ PIVOT-008 runner failure paths: ownership-tracked cleanup, collision, residue and fail-closed
ℹ tests 6
ℹ pass 6
ℹ fail 0
PASS: 176 JavaScript files parsed; package manifest valid.
PASS: PIVOT-008 RLS/privilege coverage found no violation in 55435; installed authority protocol accepted.
DONE_WHEN_EXIT=0
```

Dependent regressions:

```text
$ node --test tests/pivot-004-rls.test.mjs tests/pivot-005-immutability.test.mjs \
      tests/pivot-006-audit.test.mjs tests/pivot-007-operator-access.test.mjs \
      tests/auth-006-context.test.mjs tests/auth-007-access.test.mjs
ℹ tests 122
ℹ pass 122
ℹ fail 0
```

### Prior transient — exact evidence and hypothesis

The R2 handoff disclosed one first-run failure in `tests/pivot-007-operator-access.test.mjs`:

- Test: `PIVOT-007 adapter refuses post-preflight source-age boundary crossing with a permitted control`
- Failure: `AssertionError` from `assert.rejects` at test line 1799, after the adapter read at `src/operator/support-read.mjs:228`; the awaited promise did not produce the expected rejection.
- Hypothesis: timing-sensitive wall-clock source-age boundary under concurrent suite load in a test that deliberately sleeps past the source-age window; isolated reruns (5/5) and the immediate full rerun (122/122) passed.
- No adapter or retry-to-green change exists in this delta. This remains an out-of-TOUCH potential flake for engineer routing if it recurs; the suite is currently green.

## Scope and limits (per review `7dee232`)

- The 14 source hashes bind reviewed program bodies, not every byte of every payload; no signed migration ledger is invented.
- Database/tablespace ownership, exhaustive future default-privilege entries, arbitrary role-setting inventories and procedural analysis of arbitrary functions/rules/triggers are excluded deployment-hardening limits, not silently proven.
- No production/client contact, deployment, cutover, role provisioning or grant change.
- Application-level approval, company/branch, amount and RBAC authority remain outside this gate; auth-side RLS beyond `auth.tenant_membership` is not claimed.
- GitHub-hosted execution and branch protection remain unproved.

## Deviations

1. Child policy validation uses the reviewed canonical expressions/hashes and accepts exact operation-specific policies; any other profile fails closed.
2. Membership target comparison is exact-array; an additional target is a mismatch, not a widened equivalent.
3. Test-only runner seams remain from prior rounds; no new runtime grants or applied-byte changes.
4. D-016/D-018 unchanged.
