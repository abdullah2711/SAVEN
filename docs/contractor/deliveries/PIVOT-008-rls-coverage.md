# PIVOT-008 delivery — target PG RLS/privilege coverage gate

Date: 20 November 2026 (Asia/Karachi). Worker A. Status: COMPLETE, awaiting Codex review. Not merged.

## Identity

- Contract: `docs/contractor/contracts/PIVOT-008-rls-coverage.md`
- Base: `testing-1` @ `fae227b` (verified current)
- Branch: `opencode/pivot-008-rls-coverage`
- Worktree: `/home/esc/saven/wt-pivot-008`
- Implementation SHA: `2bb9dec528ff60ce60ca8e3df2d19c2105532abb` (includes this report). Report follow-up commit records this identity only.
- Environment: Node `v24.19.0`, PostgreSQL `18.6`, disposable loopback cluster `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`, administrative test role `esc`, `PGADMIN_DATABASE=postgres`.
- PIVOT-007 authority surface verified at merged head `550d120`/`fae227b`.

## Files changed vs TOUCH

TOUCH was: `db/postgres/99-ci-rls-coverage.sql`, `scripts/verify-pg-rls.mjs`, `scripts/check.mjs`, `.github/workflows/postgres-pivot.yml`, `tests/pivot-008-coverage.test.mjs`, `db/postgres/README.md`.

| File | Change |
| --- | --- |
| `db/postgres/99-ci-rls-coverage.sql` | New. Single read-only catalog query; every returned row is a violation. |
| `scripts/verify-pg-rls.mjs` | New. Installs the accepted stack into a private temporary database (or targets `--database`), runs the query and exits nonzero on any row or unavailable gate. |
| `scripts/check.mjs` | Existing parser check preserved; `--postgres` spawns the verifier and propagates its exit status. No PostgreSQL requirement without the flag. |
| `.github/workflows/postgres-pivot.yml` | New mandatory pivot-path job on `postgres:18` running `check.mjs --postgres` and the focused test. |
| `tests/pivot-008-coverage.test.mjs` | New. Static contract, healthy-stack non-vacuity, seeded negative coverage cases, CLI exit/fail-closed behavior. |
| `db/postgres/README.md` | Run-order step 15, gate section, extension points and test/command documentation. |

Process artifacts outside TOUCH (required by `CONTRACTOR_ROLE.md` protocol steps 5–6): this report and `docs/contractor/state/worker-a-checkpoint.md`. No other files changed. `node_modules` is an untracked local symlink and is not committed.

No applied migration bytes, native/reference source, roles, grants or catalog state were modified. The gate is read-only and performs no repair.

## Contract requirements — per-item status

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Missing `ENABLE`/`FORCE`/policy fails nonzero | **DONE** | `MISSING_ENABLE_RLS`, `MISSING_FORCE_RLS`, `MISSING_POLICY`, permissive/restrictive checks; seeded isolation test |
| 2 | Unsafe partition/child/view/function path fails | **DONE** | `UNSAFE_PARTITION_PATH`, `UNSAFE_VIEW_OWNER`, `UNSAFE_MATERIALIZED_VIEW`, definer search-path/owner/PUBLIC/row-security/membership checks; seeded isolation and authority tests |
| 3 | Runtime ownership/BYPASS and forbidden grants fail | **DONE** | `SAVEN_BYPASS_OR_SUPER`, `RUNTIME_OWNS_OBJECT`, `RUNTIME_OWNS_FUNCTION`, `RUNTIME_SCHEMA_CREATE`, `RUNTIME_ASSUMES_PRIVILEGED_ROLE`, `FORBIDDEN_RUNTIME_PRIVILEGE`, cross-schema checks, `PUBLIC_*`; seeded authority/grant test |
| 4 | Negative behavioral tests supplement catalog presence | **DONE** | 21 seeded cases across two tests, each proving the exact violation kind; healthy test also asserts the scanned surface is populated so a zero-row pass cannot be vacuous |
| 5 | Unavailable required gate fails, never silently skips | **DONE** | Missing opt-in → exit 2; connection failure → exit 2; `check.mjs --postgres` propagates; CLI test asserts both |
| 6 | Zero-row SELECT translated into nonzero process outcome | **DONE** | CLI test commits `NO FORCE RLS`, verifies exit 1 and the exact `MISSING_FORCE_RLS tenant_data.accounts` line, restores, verifies exit 0 |
| 7 | Native/offline parser checks remain runnable without PG | **DONE** | `node scripts/check.mjs` without PostgreSQL env: `PASS: 176 JavaScript files parsed; package manifest valid.` |
| 8 | No new runtime superuser/BYPASSRLS or client-authoritative context | **DONE** | Gate checks both; no role, grant or policy was created or altered by this contract |
| 9 | No growing hardcoded domains or concrete cross-module coupling | **DONE** | Role classes derive from the stable `saven_` prefix + bootstrap suffixes; no business-role enum; no new imports across module boundaries |
| 10 | Preserve native/reference source and applied migration bytes | **DONE** | `git status` shows only TOUCH + process docs; no migration file edited |

D-016/D-018: no identity allocator, mapping incarnation, IAM flow or legacy event was created, reused or renumbered. The gate reads existing catalogs only; it neither allocates identities nor changes live legacy auth paths.

## Gate evidence (exact commands and results)

Environment exported for every command: `PATH` with Node 24.19.0, `SAVEN_PIVOT_TEST_CLUSTER=1`, `PGHOST=127.0.0.1`, `PGPORT=55435`, `PGUSER=esc`, `PGADMIN_DATABASE=postgres`.

Contract DONE WHEN, run as one chain:

```text
$ node scripts/check.mjs && node --test tests/pivot-008-coverage.test.mjs && node scripts/check.mjs --postgres
PASS: 176 JavaScript files parsed; package manifest valid.
✔ PIVOT-008 static contract: read-only single-query gate wired to check --postgres (5.7ms)
✔ PIVOT-008 healthy accepted stack: full surface is present and coverage is empty (592.6ms)
✔ PIVOT-008 seeded isolation breaks each fail with their own violation (771.0ms)
✔ PIVOT-008 seeded authority and grant breaks each fail (736.3ms)
✔ PIVOT-008 CLI translates rows into a nonzero exit and fails closed when unavailable (7206.1ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
PASS: 176 JavaScript files parsed; package manifest valid.
PASS: PIVOT-008 RLS/privilege coverage found no violation in 55435.
DONE_WHEN_EXIT=0
```

Repeated default install (proves re-runnability with pre-existing cluster roles):

```text
$ node scripts/verify-pg-rls.mjs
PASS: PIVOT-008 RLS/privilege coverage found no violation in 55435.
$ node scripts/verify-pg-rls.mjs
PASS: PIVOT-008 RLS/privilege coverage found no violation in 55435.
```

Fail-closed behavior:

```text
$ node scripts/verify-pg-rls.mjs
PIVOT-008 RLS coverage gate: refusing to run without SAVEN_PIVOT_TEST_CLUSTER=1; ...
exit 2
$ SAVEN_PIVOT_TEST_CLUSTER=1 PGPORT=1 node scripts/verify-pg-rls.mjs
PIVOT-008 RLS coverage gate: cannot connect to the administrative database: connect ECONNREFUSED 127.0.0.1:1
exit 2
```

Dependent regression suites (unchanged behavior after the `check.mjs` addition):

```text
$ node --test tests/pivot-004-rls.test.mjs tests/pivot-005-immutability.test.mjs \
      tests/pivot-006-audit.test.mjs tests/pivot-007-operator-access.test.mjs \
      tests/auth-006-context.test.mjs tests/auth-007-access.test.mjs
ℹ tests 122
ℹ pass 122
ℹ fail 0
```

Workflow YAML parsed successfully (`jobs: rls-coverage`, 5 steps, push/PR to `testing-1`/`main`). GitHub Actions itself was not executed from this worktree; the workflow steps are the same commands proven locally.

## Coverage

Proven:

- The accepted full stack (`00`, `05`, `006`, `06`, `10`, `20`, `021`, `30`, `031`, `032`, `033`, `040`, `041`, `042`, `40`, `50`) returns zero violations, while the scanned surface is populated (≥49 tenant tables, ≥3 policies each, ≥5 definer functions).
- Each of 21 seeded defects is reported with its intended kind: missing ENABLE/FORCE/permissive/restrictive, constantly true restrictive policy, policy to a non-runtime role, raw-GUC tenant policy, membership FORCE loss, reachable inheritance child, bypassing view, materialized view, unsafe definer search path, PUBLIC execute, `row_security=off`, runtime-assumable definer owner, PUBLIC relation privilege, runtime TRUNCATE, customer→auth, auth-service→tenant, operator→tenant, and SAVEN BYPASSRLS.
- The process outcome, not only the query result, changes: a committed violation exits 1 with the exact violation line; restoring the stack exits 0.
- The gate fails closed when unavailable and never reports a skip as success.
- The ordinary parser/native check remains database-independent.

Excluded / not claimed:

- No production or client database was contacted; no deployment, cutover, role provisioning or grant change is authorized or performed.
- Application-level approval, company/branch, amount and RBAC authority are not proven by a catalog gate (they remain PIVOT-013/application work).
- Auth-side RLS beyond `auth.tenant_membership` is not claimed; `auth.users`/`auth.sessions` remain separate AUTH-boundary records.
- The gate proves installed catalog state; it is not a runtime monitor and cannot prevent an owner from later altering catalogs. Ownership remains an operational trust boundary.
- GitHub-hosted execution and branch-protection enforcement were not run here.

Depends on later contracts: PIVOT-010 parity runner, PIVOT-014 vertical slice, and the release/cutover authorization gates.

## Deviations and narrowing decisions

1. `scripts/check.mjs` is also modified by PIVOT-014. The dispatcher acknowledged the file overlap and confirmed no overlap with the slice files; this change is an additive tail block that preserves the existing parser check, so a later rebase is mechanical.
2. Delivery report and worker checkpoint are outside TOUCH but are mandated by the contractor protocol (steps 5–6). No other out-of-TOUCH change was made.
3. The gate classifies roles by the stable `saven_` prefix and bootstrap suffixes rather than a hardcoded business-role list; a new runtime class must be added to the bootstrap and this classification together. This narrows nothing: it avoids a growing enum and keeps the gate extensible.
4. The coverage query intentionally treats a superuser-owned runtime-readable view as unsafe even when `security_invoker=true`; this is conservative and can be relaxed only by a reviewed amendment.
