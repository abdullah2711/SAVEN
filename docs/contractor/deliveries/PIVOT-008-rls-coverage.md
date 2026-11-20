# PIVOT-008 delivery — target PG RLS/privilege coverage gate (REVISION R1)

Date: 20 November 2026 (Asia/Karachi). Worker A. Status: REVISE corrections delivered, awaiting Codex re-review. Not merged.

## Identity

- Contract: `docs/contractor/contracts/PIVOT-008-rls-coverage.md`
- Review: `719034b` (`docs/contractor/reviews/PIVOT-008-rls-coverage.md`, REVISE, six findings)
- Base: `testing-1` @ `fae227b`
- Prior delivery: `6ec3efa` (implementation `2bb9dec`)
- Revision implementation: `c6eb6ab57b7d61b7418035e382d3811b6261e68f`
- Branch: `opencode/pivot-008-rls-coverage`; worktree `/home/esc/saven/wt-pivot-008`
- Environment: Node `v24.19.0`, PostgreSQL `18.6`, disposable loopback cluster `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`, administrative test role `esc`, `PGADMIN_DATABASE=postgres`

## Files changed in R1 (all within TOUCH)

| File | Change |
| --- | --- |
| `db/postgres/99-ci-rls-coverage.sql` | Installed-surface manifest, per-command effective policy contract, effective ACLs (table/column/sequence/function), login and role-switch authority, transitive reachability, NULL-ACL defaults, definer owner manifests, installed authority protocol bindings. Still one read-only statement. |
| `scripts/verify-pg-rls.mjs` | Ownership-tracked database lifecycle, centralized exit after cleanup, collision/uncertain-creation handling, residue evidence, test seams, and the two accepted read-only protocol validators. |
| `tests/pivot-008-coverage.test.mjs` | Six focused tests: static contract; installed-surface CLI failures; real restricted-login isolation; effective authority; transitive/default-ACL/protocol; runner failure paths. |
| `db/postgres/README.md` | Gate contract, runner lifecycle and extension points updated. |

No applied migration bytes, native/reference source, roles, grants or catalog state were changed by the product code. The only committed out-of-TOUCH files remain the delivery report and checkpoint required by the contractor protocol.

## Finding dispositions

| # | Finding | Status | Named proving tests |
| --- | --- | --- | --- |
| 1 | Missing installed surface can produce an empty success | **DONE** | `PIVOT-008 installed surface: complete stack passes, empty or single-missing installs fail via CLI` — empty database, single missing table, single missing role, single missing function all exit nonzero with specific diagnostics; complete stack exits 0. The reviewed manifest requires schemas, 10 role classes, 49 tenant + 11 auth + 15 operator relations, 2 views, 10 sequences, 14 function signatures, 21 triggers and the read-policy shape/constraint. |
| 2 | Policy presence/counts do not establish effective isolation; no runtime behavioral tests | **DONE** | `PIVOT-008 effective isolation: per-command catalog gaps and real restricted-login behavior` — `SELECT`-only restrictive policy yields per-command gaps; missing membership policy yields a membership gap; extra `USING (true)` yields constant-true and still cannot widen real reads. Real `customer_app` login with two tenants: own reads/writes, foreign and no-context denials, retained foreign rows after denied update/delete, auth-service preselection and refused membership write. A nonliteral always-true predicate the catalog cannot semantically disprove is shown to leak foreign rows at runtime; restoring the accepted guard restores isolation and green coverage. |
| 3 | Effective forbidden grants/role assumptions incomplete | **DONE** | `PIVOT-008 effective authority: column ACLs, operator/auth boundary, EXECUTE allow-list and logins` — operator column read on tenant, operator column read on `auth.users`, customer column read on auth, auth-service column read on tenant, runtime extra/wrong-service/missing `EXECUTE`, runtime→definer and runtime→other-class switch, arbitrary-name privileged principal, login direct covered privilege. Healthy stack keeps the narrow operator disclosure/audit and legitimate auth privileges. |
| 4 | Child/view reachability only one hop deep | **DONE** | `PIVOT-008 transitive paths, default ACLs, owner excess and installed authority protocol` — nested view, nested view with column-only grant, materialized-view wrapper, two-level cross-schema inheritance child with column-only grant, and a safe `security_invoker` control. Recursive traversal is cycle-guarded and evaluates grants at the published endpoint in any schema. |
| 5 | NULL ACL defaults and accepted authority protocol not verified | **DONE** | Same test — definer function with NULL `proacl` is reported as PUBLIC-executable; definer owner widened to a new relation is reported; disabled, replica-only, misbound and reprofiled writer gates are reported; the runner's accepted protocol probes fail when a gate trigger is disabled. |
| 6 | Runner failure paths leak or delete unowned database | **DONE** | `PIVOT-008 runner failure paths: ownership-tracked cleanup, collision, residue and fail-closed` — deterministic pre-existing name exits 2 and remains untouched; injected post-CREATE failure exits 1 and the owned database is removed; injected DROP failure exits 1, prints `RESIDUE` with the target and leaves it for the operator; unavailable cluster exits 2; `check.mjs --postgres` propagates. |

## Gate evidence (exact commands, Node 24.19.0 / PG 18.6 / port 55435)

Contract DONE WHEN, run after `c6eb6ab`:

```text
$ node scripts/check.mjs && node --test tests/pivot-008-coverage.test.mjs && node scripts/check.mjs --postgres
PASS: 176 JavaScript files parsed; package manifest valid.
✔ PIVOT-008 static contract: manifest, effective checks and fail-closed runner wiring (6.4ms)
✔ PIVOT-008 installed surface: complete stack passes, empty or single-missing installs fail via CLI (1639.7ms)
✔ PIVOT-008 effective isolation: per-command catalog gaps and real restricted-login behavior (990.7ms)
✔ PIVOT-008 effective authority: column ACLs, operator/auth boundary, EXECUTE allow-list and logins (1325.6ms)
✔ PIVOT-008 transitive paths, default ACLs, owner excess and installed authority protocol (1723.9ms)
✔ PIVOT-008 runner failure paths: ownership-tracked cleanup, collision, residue and fail-closed (8212.1ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
PASS: 176 JavaScript files parsed; package manifest valid.
PASS: PIVOT-008 RLS/privilege coverage found no violation in 55435; installed authority protocol accepted.
DONE_WHEN_EXIT=0
```

Dependent regression suites (unchanged prior behavior):

```text
$ node --test tests/pivot-004-rls.test.mjs tests/pivot-005-immutability.test.mjs \
      tests/pivot-006-audit.test.mjs tests/pivot-007-operator-access.test.mjs \
      tests/auth-006-context.test.mjs tests/auth-007-access.test.mjs
ℹ tests 122
ℹ pass 122
ℹ fail 0
```

Representative negative evidence observed through the real CLI during development (all restored to green):

```text
disabled gate:  MISSING_REQUIRED_TRIGGER auth.tenant_membership.tenant_membership_authority_gate_insert
                PROTOCOL_PROBE_FAILED operator.assert_read_authority_protocol(): OPERATOR_AUTHORITY_PROTOCOL_INVALID: ...
collision:      exit 2, pre-existing database retained
post-create:    exit 1, owned database removed
drop failure:   exit 1, RESIDUE target printed, database retained for operator
empty install:  MISSING_REQUIRED_SCHEMA / MISSING_REQUIRED_ROLE / MISSING_REQUIRED_RELATION
```

## Coverage

Proven:

- The complete accepted stack passes; every reviewed surface class is present and non-vacuous.
- Empty, single-missing relation, role and function installations fail through the CLI; a missing membership policy is reported.
- Per-command isolation, restrictive/admission scope and membership preselection are validated structurally; real restricted-login behavior proves own-tenant access, foreign/no-context denial, retained rows and a weakened-predicate leak that catalog shape cannot disprove.
- Effective table/column/sequence/function and role-switch authority matches the accepted profile, including login roles, NULL ACL defaults, operator-to-auth, the PIVOT-007 EXECUTE allow-list and non-registered privileged principals.
- Nested views, materialized wrappers and multi-level children are evaluated transitively at the endpoint, with column-only grants.
- The accepted AUTH-006/AUTH-007 and PIVOT-007 writer/consent/policy gates and definer authority validators are enforced read-only; disabling, replica-only, misbinding or reprofiling turns the gate red.
- Runner cleanup is ownership-tracked and fail-closed with residue evidence.

Excluded / not claimed:

- No production or client database was contacted; no deployment, cutover, role provisioning or grant change is authorized or performed.
- Application-level approval, company/branch, amount and RBAC authority remain outside a catalog/RLS gate.
- Auth-side RLS beyond `auth.tenant_membership` is not claimed.
- The gate is not a runtime security monitor; object ownership remains an operational trust boundary.
- GitHub-hosted execution and branch protection were not run here.

Depends on later contracts: PIVOT-010 parity runner, PIVOT-014 vertical slice, release/cutover authorization.

## Deviations and notes

1. The runner adds test-only seams `--temporary-name`, `--inject-failure-after-create` and `--inject-drop-failure` for deterministic failure-path evidence. They remain behind the disposable-cluster opt-in and cannot target production/client databases.
2. The installed-surface manifest is a reviewed release manifest, not a business-domain enum: new release-required relations/functions/triggers are added deliberately; new tenant tables are still covered automatically by catalog checks.
3. Role classes are explicit registrations resolved from the reviewed bootstrap prefix (`saven_` deployment, fixture namespace in tests), not loose suffix matching. Non-registered privileged principals are flagged.
4. The catalog cannot semantically prove an arbitrary nonliteral predicate; the real restricted-login test is the required supplement and demonstrates the exact widening case.
5. `scripts/check.mjs` remains shared with PIVOT-014; this revision did not change the existing wiring block.
