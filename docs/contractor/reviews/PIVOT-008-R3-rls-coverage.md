VERDICT: REVISE

WHY: Both bounded corrections in `7dee232` are addressed for the tested runtime-role paths. One concrete associated-login path remains outside the child/view access checks, allowing the gate to miss a direct tenant-data path. This is a residual of effective authority/reachable-child coverage, not a demand to add a new deployment-hardening inventory.

Recorded from date: 2026-11-20 08:35:23 PKT (+0500).
Delivery tree: `7f57ea482f8b0a52b9dda2c30599c2901f3294f7`; implementation `cd29914b7b89923ede3a1f85604ebf90f9cb0603`; declared base `testing-1 @ fae227b`; correction delta from `a742bfc`.
Worktree: `/home/esc/saven/wt-rev-pivot-008-r3`.
Delivery: `docs/contractor/deliveries/PIVOT-008-rls-coverage.md`.
Prior review: [PIVOT-008 R2](PIVOT-008-R2-rls-coverage.md), `7dee232`.
MERGE RISK: HIGH / Tier 1 — required database security gate.
ROUTING: no ACCEPT/BMR/merge authorization. Preserve PIVOT-008-before-slice-rebase sequencing on eventual integration. No engineer merge or dispatch.

## Per-finding disposition

| Finding | Disposition |
| --- | --- |
| 1 — installed contract | Remains ADDRESSED within the declared reviewed manifest. Prior object-kind and 14 source-binding controls are unchanged; the bounded exclusions in `7dee232` stand. No signed ledger or whole-payload checksum claim is inferred. |
| 2 — effective policy/evidence | CLOSED for the two bounded R2 residuals. Membership policy targets now compare the complete array to a singleton accepted role; the multi-target mutation is refused. The same `assertNoForeignRows` passes healthy, raises its specific assertion under weak policies, then passes after restoration; CLI red/restored-green is separately asserted. |
| 3 — effective authority | Prior schema/elevated-login/external-function/owner-profile corrections retained; associated-login coverage is still PARTIAL for the reachable paths described below. |
| 4 — child/transitive paths | The normalized command-code and canonical predicate correction is ADDRESSED for runtime-role endpoints; associated-login endpoint omission remains OPEN below. |
| 5 — owner granularity/ACL/protocol | Remains ADDRESSED within the accepted release profile. No changes to the exact owner operation/column, NULL ACL or accepted protocol checks in this delta. |
| 6 — owned cleanup | Remains CLOSED for previously reported paths. Runner unchanged; retain that closure and its stated injection limit. |

The named `effective isolation: per-command catalog gaps and real restricted-login behavior` test now contains the normal-assertion mutation evidence. `transitive paths, default ACLs, owner excess and installed authority protocol` adds forced-RLS true-policy read/write children, canonical child CLI/own-versus-foreign controls, an operation-specific SELECT profile and refusal when INSERT is granted without its write contract. These support the submitted closures; they grant privileges to the runtime class role, which does not exercise the residual below.

## One required bounded correction — HIGH

**Include associated login authority at the actual reachable endpoint.** `actors` contains runtime and associated-login principals, but `runtime_read_endpoints` filters `a.actor_kind = 'runtime'` (`99-ci-rls-coverage.sql:456–469`); `runtime_write_endpoints` does the same (`:471–488`). Consequently child commands, view endpoint ancestry and the new child-policy enforcement do not see a direct grant to a login. The separate `direct_login_relation_privileges`/column branches use ACLs derived from `covered_relations`, restricted to tenant_data/auth/operator, so they do not catch the same direct grant on a reachable public-schema child.

Concrete source-derived counterexample: create a NOINHERIT login associated with customer_app; create `public` child of tenant_data.accounts with forced RLS but permissive/restrictive true policies and retained two-tenant rows; grant SELECT directly to the login, not customer_app. The login needs no SET ROLE or tenant helper for true predicates, and public schema USAGE is normally available. The customer's runtime-role endpoint list sees no grant, the three-schema direct-login check sees no relation, and UNKNOWN_PRIVILEGED_PRINCIPAL excludes the registered runtime login. The direct login can read the child without the parent's policies applying. A write-only direct login/column grant has the analogous omission. No engineer execution of this counterexample is claimed.

Extend the existing effective endpoint/access profiles to associated logins and their usable authority, preserving the policy that such direct authority must not bypass SET ROLE. A direct-login violation is an acceptable fail-closed outcome; simply adding the login to a customer-policy count is insufficient if the login can access a true-policy child as itself. Apply the same handling to reachable view endpoints and to table/column read/write grants. Add a committed actual-CLI negative with a direct login grant to an unsafe cross-schema child, a separate restricted-login read demonstrating the seeded foreign-row risk, restoration and a valid no-direct-grant/normal SET ROLE control. Include write/column coverage and preserve the existing runtime-role and safe invoker cases. Use explicit diagnostic assertions and retained-row postconditions. No new runtime production grant, auth semantic change or additional source module is authorized; this fits the existing SQL/test TOUCH.

## Evidence and limits

Worker reports Node24.19.0/PostgreSQL18.6 on a dedicated disposable loopback cluster, all three DONE WHEN commands passing, 6/6 focused tests and122/122 dependent regressions. The report retains the earlier PIVOT-007 timing-sensitive first-run failure and supplies its assertion location and timing hypothesis; it does not establish a diagnosed cause or flake-free suite. No retry-to-green implementation or adapter source change is present in this correction. Preserve both run outcomes when routing any later out-of-TOUCH test investigation.

Reviewer inspected the exact five changed paths and relevant retained access definitions, executing no contractor gate, SQL mutation, migration, restore, deployment or merge. GitHub execution and protected-branch enforcement remain unproved. Native syntax/explicit PostgreSQL gate wiring and applied migration bytes are unchanged. No broader arbitrary-program analysis or database/tablespace/default-ACL inventory is added by this review; the bounded rulings in `7dee232` remain controlling.

Can a client-supplied header, query param, or body value influence tenant_id or user_id?

This delivery introduces no request identity source. The remaining issue is a database access path that does not require a tenant identity at all when its child predicates are true. Coverage must follow the actual connected principal as well as a switched runtime role.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR.

Worker owns the bounded correction/evidence; engineer owns further scope rulings; Principal owns eventual BMR approval. D-016 advance-only identities and D-018 live legacy IAM/event ownership remain intact. No cutover or production activation is authorized; SQLite remains production.
