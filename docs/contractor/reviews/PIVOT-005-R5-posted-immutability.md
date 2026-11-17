VERDICT: ACCEPT

WHY: At dc32978, policy versions are resolved within each applicable identity, then all current identities in the selected role/global scope combine conservatively. Unequal version numbers on independent keys can no longer suppress the lower threshold. The decision retains every contributing identity/version, and the new runtime-role regressions cover the outstanding 191baeb counterexamples. This accepts the bounded database mechanism, not application activation or operational accounting parity.

Date: 17 November 2026 (Asia/Karachi).
Delivery/implementation: `opencode/pivot-005-immutability @ dc32978614999cea9c037cb03966bc294aed2490`; worktree HEAD verified.
Baseline: `testing-1 @ 70dde6b`; correction delta from `3dd8d92`.
Reviewed worktree: `/home/esc/saven/wt-rev-pivot-005-r5`.
Governing review: [PIVOT-005-R4](PIVOT-005-R4-posted-immutability.md), `191baeb`; earlier reviews remain historical. D-013/D-014 and ADR04 apply.
MERGE RISK: HIGH — financial lifecycle, immutable history and approval authority.
ROUTING: queue for a human Business Merge Request. No merge performed; this file does not itself create or approve that request.

Reviewed the four-path correction delta: 042 policy resolver, focused tests, README and delivery report, against the accepted closure accounting in the preceding reviews. No grant, owner, schema, dependency, 040, dispatcher, native/application or out-of-scope fixture change is introduced in R5. Contract TOUCH is respected. The unchanged R4 approver resource/account/maxMinor correction remains closed.

Closure of 191baeb finding 1:

- For each matching current role, documented role-specific precedence selects that scope or the global fallback. `GROUP BY ap.policy_key` resolves the highest current effective version inside each identity before combining identities. Independent keys are no longer ordered by version, nor rejected solely because their numeric versions coincide.
- Each selected identity contributes its exact threshold and different-approver flag. Lowest threshold and conservative combination across matching roles remain deterministic; ordered role/key iteration stabilizes the retained snapshot. The controlling key/version is summary metadata; the full policy set remains in `policies[]` and the decision digest.
- Real customer-role void calls with unequal-version keys in the same role and global fallback now require approval and leave no void/audit effects. Same-key version supersession has a positive execution case. Changing a contributing version or adding an independent key after approval invalidates the snapshot. Earlier unrelated-role, resource-scoped reviewer, authority-revocation, correction, terminal protection, rollback and activation cases remain present.

Evidence boundary: worker reports Node 24.19.0/PostgreSQL 18.6, syntax check and **18/18** focused tests. Full branch result is **222/223**, not green: the unchanged PIVOT-004 literal global-role prerequisite fails on the pristine namespaced cluster. No global SAVEN roles were created to mask it. That out-of-TOUCH fixture issue remains an integration/evidence follow-up; this ACCEPT neither repairs it nor waives a required release gate. Policy setup/revocation and catalog/retention probes use administrator queries; customer-role transactions exercise approval/void/isolation paths. Earlier evidence qualifications, including limited concurrent correction arrival coverage, remain. Reviewer ran no contractor gate, test, SQL mutation, migration, restore or deployment; no independent green-suite claim is made.

Can a client-supplied header, query param, or body value influence tenant_id or user_id? Explicit actor/tenant inputs are constrained by transaction context, admitted member mapping and actor-bound approval. This schema fixture is not server-side application provenance: AUTH-006 remains the application-context prerequisite and is separately REVISE in this batch. ACCEPT here does not authorize shipping business features around that prerequisite.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. Policy identity/scope/version and exact minor-unit conventions are documented and retained. D-014 role-agnostic void-history reads remain intact; future application RBAC owns fine-grained visibility. Sources, evidence, numbering, audit and terminal void history remain retained. Preserve any actually applied migration bytes; corrected-in-place disposable/unapplied payload evidence is not permission to rewrite deployed lineage.

Limits remain binding: plain journals only; unsupported trade/stock posting and linked operational voids fail closed until reviewed PIVOT-013 reconciliation. No application routes, Delete/Voided page, UI/RBAC configuration, Private packaging, production deployment or cutover is accepted. Locked-period voiding remains refused; denial auditing requires the separate kernel transaction; generic audit is PIVOT-006. SQLite remains production. D-015's sample-only data confirmation reduces live-data migration risk but does not waive security/parity/quality gates. Human merge authorization and later integration evidence remain required.
