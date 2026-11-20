VERDICT: REVISE

WHY: The explicitly partial R2 delivery addresses most specific R1 corrections. A remaining child-policy validation defect can certify a directly reachable, non-isolating child despite the new traversal. The broader disclosed limits need a bounded ruling, not a blanket demand to implement an arbitrary SQL/program analyzer.

Recorded from date: 2026-11-20 08:09:54 PKT (+0500).
Delivery: `opencode/pivot-008-rls-coverage @ a742bfcaf969bcb3f52cb09b31a51b8e1615cc6e`; implementation `f003af7acbaaaa1082b15733f77eb26cbf3d41f8`; declared base `testing-1 @ fae227b`; delta from `80978be`.
Worktree: `/home/esc/saven/wt-rev-pivot-008-r2`.
Report: `docs/contractor/deliveries/PIVOT-008-rls-coverage.md`.
Prior review: [PIVOT-008 R1](PIVOT-008-R1-rls-coverage.md), `3b23f41`.
MERGE RISK: HIGH / Tier 1 — database security/release evidence.
ROUTING: no ACCEPT, BMR or merge authorization. No engineer dispatch. Preserve PIVOT-008-before-slice-rebase sequencing on eventual acceptance/integration; PIVOT-007's ACCEPT is unaffected.

## Per-finding disposition and residual rulings

| Finding | Engineer disposition | Source and named evidence |
| --- | --- | --- |
| 1 — exact installed contract | Specific R1 object-kind/source-binding corrections ADDRESSED within the declared manifest | Required table/view/sequence kind and function kind are checked. `required_installation_bindings` compares 14 normalized program-body hashes. `installed surface: complete stack passes, empty or single-missing installs fail via CLI` adds wrong-kind warehouses and tampered current_user_id body negatives, restored to CLI success. This is a reviewed installed-program binding, not proof that every byte of every payload or all delegated helpers are fingerprinted. |
| 2 — canonical policies and real behavioral evidence | Core policy correction ADDRESSED; evidence/role-exactness residual below | Canonical tenant policy hashes replace substring matching, unknown policy names are rejected, membership has a reviewed expression contract, and the weakened-policy state now makes the actual CLI nonzero. Restricted tenant/membership positives remain. The test still expects the diagnostic leak rather than actually running the reusable normal no-leak assertion to red; distinguish that fact in the final evidence. |
| 3 — complete authority profiles | Specific R1 regressions ADDRESSED within the reviewed authority classes | Schema CREATE/USAGE/ownership checks return, superuser associated logins are classified before rejection, external-schema functions owned/granted to required principals are included, and capability-based role-switch diagnostics are added. `effective authority: column ACLs, operator/auth boundary, EXECUTE allow-list and logins` supplies the corresponding schema, external-function, elevated-login and dangerous-target negatives. |
| 4 — transitive paths and child operations | PARTIAL / OPEN — blocker below | Mixed-owner view taint, ancestor traversal, write/column endpoints and mixed-owner/write-only tests improve coverage. The child policy checks still permit non-isolating policies and mix command representations. This is within the original requested relation/child protection, not a request for procedural whole-program analysis. |
| 5 — exact dedicated-owner granularity | Specific R1 privilege/column correction ADDRESSED within the accepted release profile | `owner_privilege_contract` and actual column aggregation compare operation and exact column sets; schema and owned-function profiles are checked. Named negatives add audit-column UPDATE, missing operator SELECT column and extra auth-owned function. NULL/default ACL and accepted operator protocol validation remain. |
| 6 — owned cleanup | Remains CLOSED for the previously reported paths | Runner source is unchanged in R2; collision, post-CREATE failure, residue and unavailable-gate tests remain. Do not reopen this finding solely because the injection is not a real lost connection acknowledgement. |

## Required bounded corrections

1. **HIGH — make effective child isolation part of the gate, using one command representation.** In `99-ci-rls-coverage.sql`, `runtime_write_endpoints` emits uppercase `INSERT`, `UPDATE`, `DELETE`, while `child_write_gaps` compares `cp.polcmd` and predicate applicability against lowercase PostgreSQL policy codes `a/w/d` (about lines497–530). As written, `w.cmd NOT IN ('a','w')` and `w.cmd NOT IN ('r','w','d')` are always true. A `FOR ALL` permissive policy and a `FOR ALL` restrictive policy therefore satisfy these branches regardless of their predicates. A valid operation-specific `FOR INSERT` policy conversely fails `cp.polcmd = w.cmd`, because `a` is not `INSERT`.

   Concrete unsafe profile: a child outside tenant_data has ENABLE/FORCE RLS, both FOR ALL policies with USING/WITH CHECK true, and a customer INSERT grant. The parent policy is not applied to direct child access; the child is outside `tenant_tables`' canonical policy validation. Both existence tests pass, and no predicate is evaluated by the write-gap conditions. The read branch is weaker still: it accepts any permissive policy on a forced-RLS readable child, with no required tenant predicate/restrictive admission binding. A SELECT grant with permissive true can expose foreign child rows without a child-path violation. These are source-derived counterexamples; no engineer SQL probe was executed.

   Normalize privileges to PostgreSQL command codes before policy comparison, retaining labels only for output. Apply the reviewed effective tenant/admission contract (or explicitly reviewed child equivalent) per actual operation and applicable principal, including USING/WITH CHECK, not substring/existence checks. Add forced-RLS children with true and nonliteral weakened policies, read-only and write-only/column grants; require the actual CLI to reject them and normal own/foreign behavioral controls to demonstrate the protection. Include a permitted exact operation-specific child policy control or explicitly refuse unsupported profiles with an accurate diagnostic. Preserve mixed-owner and existing no-policy child negatives.

2. **Complete the already requested narrow role/evidence controls.** `membership_policy_actual` derives target_kind from any matching required role with LIMIT1; it does not compare the complete `polroles` array. An extra PUBLIC or other role can therefore satisfy an allegedly exact target contract when the expected role is also present. Compare the complete accepted target set and add a multi-target mismatch negative with the correct single-target positive. This is profile exactness, not a claim that every extra policy target currently has a table grant or a proven exploit.

   Retain the now-present weakened-policy CLI red/restored-green evidence. Also run the normal no-foreign-row assertion under the weak-policy mutation and record its actual expected failure before restoration; an assertion that leaked rows equal1 demonstrates the mutation's effect but is not that normal assertion failing. Do not delete or invert the normal assertion to manufacture red. Update the per-finding table and README so they describe the actual final gate and proof without calling an accepted exact-hash rejection something that only behavior exposes.

## Scope rulings on declared PARTIAL limits

The lack of a signed migration ledger is not a requirement to invent one inside this gate. Retain reviewed object/program/protocol bindings, disclose exactly which installations they identify, and do not equate 14 function-body hashes with a checksum of every installed payload byte. No waiver of any existing populated immutable installation binding is granted. The narrowed source-binding design may be used for this correction without writing to the target or rewriting accepted payloads.

Database/tablespace ownership, exhaustive future default-privilege entries and arbitrary role-setting inventories are not new standalone deliverables imposed by this review. Record them as excluded deployment hardening, not silently proven by the gate; they do not excuse any current runtime/owner privilege or installed function path already in the contract. Likewise exhaustive procedural analysis of arbitrary functions/rules/triggers is not required. The known accepted authority protocol and reviewed function/definer surface must continue to be validated, and any concrete unsafe reachable path discovered during implementation must be reported. These rulings accept bounded review scope; they do not change the original tenant/RLS/privilege acceptance conditions or authorize dispatch of another contract.

## Evidence, trust and routing

Worker reports all three DONE WHEN commands passing with 6/6 focused tests on Node24.19.0/PostgreSQL18.6 and a dedicated disposable loopback cluster. The report also truthfully discloses that the first dependent regression run failed the previously timing-sensitive PIVOT-007 source-age boundary test; an immediate full rerun passed122/122. Record both results. The rerun does not establish that the first failure was diagnosed or that the regression suite is flake-free. No source change to that adapter or retry-to-green implementation is present in this delta; no such change is authorized by this review. Supply exact failure evidence/hypothesis at handoff, and route an out-of-TOUCH correction if needed. This is separate from the demonstrable child-gate blocker.

Reviewer inspected the exact five-path correction delta and relevant retained boundaries, with no contractor gate, SQL mutation, migration, restore, deployment or merge executed. GitHub execution and branch protection remain unproved. Existing native syntax checks/explicit --postgres wiring remain intact.

Can a client-supplied header, query param, or body value influence tenant_id or user_id?

The gate adds no request handler. Its restricted fixtures intentionally set test context; the gate must reject installed paths that make that context ineffective as tenant isolation. Direct child access cannot inherit the parent's tenant policy by assumption.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR.

Reviewed security manifests may evolve deliberately; unsupported profiles must fail closed. No new runtime grant, applied payload rewrite, production activation or cutover is authorized. Preserve D-016 advance-only identities, D-018 live legacy IAM/event ownership and native/reference source. SQLite remains production. Worker owns the bounded corrections and per-finding evidence; engineer owns further scope rulings; Principal owns an eventual BMR/merge decision.
