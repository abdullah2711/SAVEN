# PIVOT-008 delivery — target PG RLS/privilege coverage gate (REVISION R2)

Date: 20 November 2026 (Asia/Karachi). Worker A. Status: R2 corrections delivered, awaiting codex re-review. Not merged.

## Identity

- Contract: `docs/contractor/contracts/PIVOT-008-rls-coverage.md`
- Reviews: `719034b` (R0 REVISE), `3b23f41` (`docs/contractor/reviews/PIVOT-008-R1-rls-coverage.md`, R1 REVISE)
- Base: `testing-1` @ `fae227b`
- Prior rounds: R0 implementation `2bb9dec`/`6ec3efa`; R1 implementation `c6eb6ab`/`80978be`
- R2 implementation: `f003af7acbaaaa1082b15733f77eb26cbf3d41f8`
- Branch: `opencode/pivot-008-rls-coverage`; worktree `/home/esc/saven/wt-pivot-008`
- Environment: Node `v24.19.0`, PostgreSQL `18.6`, disposable loopback cluster `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`, administrative test role `esc`, `PGADMIN_DATABASE=postgres`
- Working tree: only untracked `node_modules` (local symlink, not committed)

## Files changed in R2 (all within TOUCH)

| File | Change |
| --- | --- |
| `db/postgres/99-ci-rls-coverage.sql` | Object-kind enforcement, installation source checksums, exact canonical policy contracts, schema ACL/profile checks, superuser associated-login classification, external-schema function coverage, capability-based role-switch checks, tainted mixed-owner view paths, write-only child protections, exact dedicated-owner privilege/column/ownership manifests. Still one read-only statement. |
| `tests/pivot-008-coverage.test.mjs` | CLI object-kind and checksum negatives; exact weak-policy CLI refusal; schema/elevated-login/external-function/capability cases; mixed-owner, write-only and column-only child cases; exact owner extra-column/wrong-operation/missing/owned-function cases. |
| `db/postgres/README.md` | Gate behavior and extension-point documentation updated. |

No applied migration bytes, native/reference source, runtime roles, grants or catalog state were changed by the product code. Delivery report and checkpoint remain the only process artifacts outside TOUCH.

## Per-finding disposition (review `3b23f41`)

Finding 6 is CLOSED and preserved. Findings 1–5 are **PARTIAL**: the named correction is implemented and proven, but a residual scope/limit remains as stated; this report does not claim all six DONE.

| # | Disposition | Correction control | Failing diagnostic and process outcome | Residual |
| --- | --- | --- | --- | --- |
| 1 | **PARTIAL** | The manifest enforces declared relkind for required tables/views/sequences and `prokind` for functions. 14 reviewed immutable source checksums bind the 033/06/040/041/042/50 program bodies, normalized by the reviewed role prefix. Complete stack CLI exits 0. | View occupying `tenant_data.warehouses` → `REQUIRED_OBJECT_KIND_MISMATCH tenant_data.warehouses` and table-policy gaps; CLI exit 1. Tampered `current_user_id()` body → `INSTALLATION_BINDING_MISMATCH tenant_data.current_user_id()`; CLI exit 1. Missing table/role/function → specific `MISSING_REQUIRED_*`; CLI exit 1. Restored controls → exit 0. | Checksums are reviewed source hashes, not a signed migration-version ledger; the accepted stack has no populated `operator.pg_schema_migrations` rows, so payload versions are bound by source/trigger/constraint fingerprints. A new accepted payload version requires a manifest update. |
| 2 | **PARTIAL** | Exact canonical policy contract per tenant table: names, permissive/restrictive class, `FOR ALL`, exact PUBLIC/customer role, and normalized `USING`/`WITH CHECK` hashes for isolation, scope and admission. Membership requires the exact four principal-bound policies. Unknown variants fail closed. | `SELECT`-only restrictive → `POLICY_OPERATION_GAP` for `a/w/d`; dropped membership preselect → `AUTH_MEMBERSHIP_POLICY_GAP`; added permissive policy → `UNEXPECTED_POLICY`; nonliteral weakened policy → `POLICY_OPERATION_GAP`/`UNEXPECTED_POLICY` and CLI exit 1. Behavioral control: foreign rows 0 on accepted policies; weak-policy probe reads 1 foreign row; restore makes it 0 and CLI exit 0. | The gate recognizes the reviewed canonical expressions and explicitly reviewed variants; it is not a general SQL theorem prover. An arbitrary unknown predicate fails closed, and the restricted-login test is supplementary behavioral evidence, not the red/green proof itself. |
| 3 | **PARTIAL** | Effective schema USAGE/CREATE/ownership for runtime roles and logins; superuser associated-login classification; external-schema functions by owner/ACL/PUBLIC-definer dependency; capability-based role-switch targets; existing table/column/sequence/function and EXECUTE allow-list retained. | `GRANT CREATE` → `RUNTIME_SCHEMA_CREATE` + `RUNTIME_SCHEMA_PRIVILEGE`; customer auth USAGE → `RUNTIME_SCHEMA_PRIVILEGE`; superuser runtime login → `LOGIN_ROLE_ATTRIBUTE`; external definer → `FORBIDDEN_RUNTIME_EXECUTE` + `UNSAFE_FUNCTION_PUBLIC_EXECUTE` + owner excess; BYPASSRLS target → `ROLE_SWITCH_TO_PRIVILEGED_CAPABILITY`; all CLI/in-process outcomes nonzero. Unrelated offline superuser is not flagged. | Database/tablespace ownership, role settings and default-privilege entries are not exhaustively profiled; schema/relation/column/sequence/function and membership-switch authority are covered. |
| 4 | **PARTIAL** | Reachability now carries taint: a bypass-owned inner view taints a non-bypass outer wrapper; matviews are stored-row unsafe; endpoint ancestry is traced. Runtime write endpoints include table/column INSERT/UPDATE/DELETE; cross-schema children require forced RLS and command-specific `USING`/`WITH CHECK`. | Mixed-owner wrapper → `UNSAFE_VIEW_PATH` on inner and outer; write-only child → `UNSAFE_PARTITION_WRITE_PATH ...:INSERT` for table and column grants; multi-level column-only child → `UNSAFE_PARTITION_PATH`; safe `security_invoker` view → no violation. | Execution paths through functions called by views, rules/triggers, and security-definer function bodies are not analyzed; the gate proves reachable relation/view/child paths and their ACL/taint properties, not arbitrary procedural execution. |
| 5 | **PARTIAL** | Exact dedicated-owner table/column/sequence privilege manifest (63 rows), exact schema privilege contract, exact owned-function manifest, and the accepted operator-definer validator. NULL ACL defaults and trigger/protocol probes retained. | Audit definer extra column UPDATE → `DEFINER_OWNER_EXCESS_AUTHORITY`; void definer wrong operation → excess; operator definer missing column → `DEFINER_OWNER_PRIVILEGE_MISSING`; auth definer owning an extra function → excess; all nonzero. Healthy stack zero. | Database/tablespace ownership, role-level settings and default ACL entries are not enumerated; table/column/sequence/function/schema ownership is exact for the accepted release. |
| 6 | **CLOSED — preserved** | Ownership-tracked cleanup, centralized exit, collision/uncertain CREATE handling, residue evidence, protocol probes, deterministic failure probes. | Collision exit 2 and pre-existing database retained; injected post-CREATE failure exit 1 and owned database removed; injected DROP failure exit 1 with `RESIDUE` target retained; unavailable cluster exit 2. | None for the reported failure paths. The runner injection still occurs before the second connection attempt; the throwing connection path reaches the same cleanup boundary. |

## Gate evidence (exact commands, Node 24.19.0 / PG 18.6 / port 55435)

Contract DONE WHEN, run after `f003af7`:

```text
$ node scripts/check.mjs && node --test tests/pivot-008-coverage.test.mjs && node scripts/check.mjs --postgres
PASS: 176 JavaScript files parsed; package manifest valid.
✔ PIVOT-008 static contract: manifest, effective checks and fail-closed runner wiring (8.3ms)
✔ PIVOT-008 installed surface: complete stack passes, empty or single-missing installs fail via CLI (2022.7ms)
✔ PIVOT-008 effective isolation: per-command catalog gaps and real restricted-login behavior (1250.3ms)
✔ PIVOT-008 effective authority: column ACLs, operator/auth boundary, EXECUTE allow-list and logins (1350.5ms)
✔ PIVOT-008 transitive paths, default ACLs, owner excess and installed authority protocol (1757.7ms)
✔ PIVOT-008 runner failure paths: ownership-tracked cleanup, collision, residue and fail-closed (7948.2ms)
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

Transient disclosure: the first regression run produced one failure in the timing-sensitive `PIVOT-007 adapter refuses post-preflight source-age boundary crossing with a permitted control` test; the immediate full rerun passed 122/122 and no source in this delta touches that adapter. Treated as a transient, not masked.

Representative CLI diagnostics observed during development (all restored to green):

```text
REQUIRED_OBJECT_KIND_MISMATCH tenant_data.warehouses
INSTALLATION_BINDING_MISMATCH tenant_data.current_user_id()
POLICY_OPERATION_GAP tenant_data.accounts:a:permissive
UNEXPECTED_POLICY tenant_data.accounts.p8_widen
RUNTIME_SCHEMA_CREATE saven_customer_app -> tenant_data
LOGIN_ROLE_ATTRIBUTE p8_elevated_login
FORBIDDEN_RUNTIME_EXECUTE saven_customer_app -> p8_ext()
UNSAFE_VIEW_PATH public.p8_outer
UNSAFE_PARTITION_WRITE_PATH public.p8_write_child:INSERT
DEFINER_OWNER_EXCESS_AUTHORITY saven_audit_definer -> tenant_data.audit_event:UPDATE
DEFINER_OWNER_PRIVILEGE_MISSING operator_definer -> tenant_data.accounts:SELECT
```

## Coverage and limits

Proven:

- Complete accepted stack passes; each reviewed surface, policy, owner and installation binding is exact.
- Empty and single-missing installs, wrong-kind objects and conflicting checksums fail through the CLI with specific diagnostics.
- Exact per-command policy contracts; selective, weakened, extra and wrong-role policies fail; a nonliteral weakening makes the actual CLI nonzero; behavioral no-leak positive control holds and the weak probe leaks.
- Effective schema, relation, column, sequence, function, login and role-switch authority matches the accepted profile, including external-schema definers and elevated associated logins.
- Mixed-owner nested publication and write-only/column-only cross-schema children are rejected; safe invoker control passes.
- Dedicated owner privileges are exact at operation and column granularity; owner schema and owned-function profiles are exact.
- Accepted AUTH/PIVOT writer gates and definer validators are enforced read-only; disabled/replica-only/misbound/reprofiled gates turn red.
- Runner cleanup remains ownership-tracked and fail-closed (finding 6 preserved).

Excluded / not claimed:

- No production/client database contact; no deployment, cutover, role provisioning or grant change.
- Application-level approval, company/branch, amount and RBAC authority remain outside a catalog/RLS gate.
- Auth-side RLS beyond `auth.tenant_membership` is not claimed.
- Arbitrary procedural execution paths, database/tablespace ownership and default ACL/role settings are residual limits as stated.
- GitHub-hosted execution and branch protection were not run here.

Depends on later contracts: PIVOT-010 parity runner, PIVOT-014 vertical slice, release/cutover authorization.

## Deviations and notes

1. The exact reviewed policy/owner/installation manifests are release contracts, not business-domain enums. A new accepted policy expression, owner column, required object or payload version is a deliberate manifest update; an unrecognized variant fails closed.
2. Source checksums are normalized by the reviewed role prefix so the disposable fixture (`saven_pivot_<suffix>_`) and deployment (`saven_`) produce the same binding without rewriting accepted bytes.
3. Test-only runner seams remain (`--temporary-name`, `--inject-failure-after-create`, `--inject-drop-failure`), behind the disposable-cluster opt-in.
4. D-016/D-018 unchanged: no allocator, mapping incarnation, IAM flow or legacy event was created, reused or renumbered.
5. `scripts/check.mjs` remains shared with PIVOT-014; this revision did not change the existing wiring block.
