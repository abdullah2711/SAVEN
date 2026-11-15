VERDICT: REVISE

WHY: Read both PIVOT-002c-operator-schema-fixes.md and verify-workflow-diagnostic.md at opencode/pivot-002 head def55b12fd40265a24be007907a865a92a0f1987, checked corrective commit 942ae550bc6ac26f89db5a734bf1a298e77fbeb9 and the combined diff against testing-1 at 9799ced94db422e1f3328561dd70a3bf0ef6b377. Blockers 1 and 2 are closed for this bootstrap scope: the actual role SQL validates before creating, compatible re-entry preserves definitions/memberships, runtime logins are separate from migration, and tests now assert owners and denied runtime escalation/DDL. The reported dedicated-local-cluster gate has five focused tests and 150 full-suite tests passing with no skips/failures; it was not independently rerun here. The owner's diagnosis-only instruction explains why blockers 3 and 4 were left unchanged and is accepted as a scope exception, not a contractor failure. My decisions are to restore the database-independent general check/build command and retain the complete existing Verify SAVEN workflow, requiring its successful unmerged-PR run before acceptance. The full branch is therefore not yet approved for integration; no new schema fix is requested.

EXTENSIBILITY: compliant — no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. Growing domains remain reference rows, JSON policy enforcement/activation remains explicitly deferred and non-authoritative, and the role/bootstrap corrections preserve later tenant/auth extension. Restoring the general check avoids imposing an unnecessary database dependency on native/offline build checks.

## Closed findings: blockers 1 and 2

- 00-roles.sql validates all existing target role attributes before creation, refuses incompatible definitions without ALTER ROLE, and leaves compatible existing roles/memberships unchanged. The fixture executes this checked-in SQL with only disposable role-name substitution.
- Customer, auth-service, operator-read and operator-admin have separate constrained login principals, each granted only its own runtime role. A separate login holds the migration role. Membership/SET checks cover direct and transitive escalation to migrator and both definer roles.
- Tests assert schema/table/index/sequence/function ownership by the offline migrator, zero runtime relation/function ownership, denied role assumption and runtime ALTER/DROP, and actual-bootstrap fresh/no-op/refusal behavior with before/after attribute and membership snapshots.
- The previously accepted entitlement immutability, append-only TRUNCATE guards, local dedicated-cluster isolation and deferred-policy wording remain unchanged. Offline saven_migrator ownership is still intentional. Historical owner-server cleanup is not newly certified, and no SSH credential transition is added to this task.

These conclusions are based on the source diff plus clearly identified contractor-reported gate output. They close the specified bootstrap findings; they are not deployment approval or a review of downstream implementations.

## C3 — Revert the general check.mjs PostgreSQL requirement

Decision: **restore scripts/check.mjs exactly to its 9799ced baseline**, through the bounded contract below. The diagnostic confirms that d5b7aaa added both mandatory PG configuration and a focused database-test launch to a parser/build command. package.json routes npm run check and npm run build to that command. The observed no-PG exit status of 1 establishes the regression; the requirement is unnecessary because the explicit PostgreSQL tests already enforce dedicated-cluster opt-in and CI supplies their configuration.

Restore the parser/build behavior without making database tests optional. Correct the README's current claim that check.mjs requires PG. Keep the explicit focused/full-suite tests and their fail-closed fixture behavior. Do not add a new command, change package scripts or rebuild the accepted fixture. Existing PG environment entries on the workflow's parser step may remain harmlessly unused; no workflow edit is needed for this restoration.

## C4 — Retain the workflow; a successful PR run is the ACCEPT precondition

Decision: **do not trim Verify SAVEN**. The diagnostic identifies a trigger/evidence gap, not an observed failing verification step. All 14 referenced verify scripts exist. Their presence and the local Node-suite pass do not prove the complete workflow passes, but provide no basis for discarding existing coverage. Lack of gh in the contractor environment does not prevent a PR created through GitHub web/API.

During this review, the GitHub API returned zero branch workflow runs and no open PR from opencode/pivot-002 into testing-1. The existing pull_request trigger can run before any integration merge. A successful real run, after C3 is fixed, remains the precondition for a subsequent ACCEPT verdict. **This review is not a conditional ACCEPT and does not authorize merging before that run.**

### Exact CI acceptance conditions

1. An unmerged PR targets testing-1 from opencode/pivot-002 and includes the corrected implementation. Actions is enabled and allowed to execute that PR's existing Verify SAVEN workflow. Record head, base and tested PR merge SHA; if executable/workflow/check inputs or the integration base change, obtain a run covering the changed candidate.
2. Use the unchanged workflow's ubuntu-latest runner, .nvmrc Node 24.19.0, Python 3.14, pinned action revisions and locked npm ci --ignore-scripts --no-audit --no-fund install. Required actions, runtimes, dependencies and PostgreSQL image must resolve successfully. Do not substitute unreported versions or a shared/owner service to manufacture a result.
3. The job's fresh postgres:18 service becomes healthy on loopback port 5432 with its disposable postgres administrator, the workflow's test-only password and saven_contract_ci database. The explicit Node database tests receive PGHOST=127.0.0.1, PGPORT=5432, PGUSER=postgres, PGADMIN_DATABASE=postgres, SAVEN_PIVOT_TEST_CLUSTER=1 and the service test credential. The 14 later PostgreSQL verifier steps retain their configured loopback connection, same service credential and CONTRACT_DATABASE=saven_contract_ci. No owner-server/SSH access is required.
4. Every existing step completes successfully within the configured ten-minute job timeout: dependency installation, general parser, full Node suite including PIVOT tests, all 14 PostgreSQL verification scripts, skill/checklist/plan validators, both design generators, and their existing clean-diff checks. The scripts are verify-postgres, verify-operating, verify-accounting-cycles, verify-services, verify-accounting-workspace, verify-party-accounting, verify-opening, verify-recurring, verify-exports-evidence, verify-approval-policies, verify-payments, verify-approval-conditions, verify-assets and verify-invoice-taxes. No continue-on-error, removed assertion, selective success claim or newly skipped required check counts as a pass.
5. The report links a completed Verify SAVEN run whose conclusion is success for that candidate. Preserve local focused/full-suite gate and cleanup evidence; distinguish reported local results from observed Actions results. A report-only follow-up commit is permissible only when identified and it does not change executable, workflow or generated-check inputs. Any unrelated failing step must be diagnosed and returned for a scoped decision, not silently deleted or fixed under this limited contract.

These are acceptance conditions, not a prediction that unexecuted assertions will pass. There is currently no observed failing Verify step to fix. This decision expressly declines the workflow-trimming option because removing checks solely to obtain green status would reduce existing coverage without evidence.

## IF REVISE

Execute only [PIVOT-002d-check-and-ci.md](../contracts/PIVOT-002d-check-and-ci.md), authored with this review. It authorizes three paths: exact scripts/check.mjs restoration, the affected README instructions, and a new delivery report. It also authorizes an unmerged PR to obtain the existing workflow result, but no merge or workflow edits. There are no further role/schema changes in this remaining contract. Return the corrected diff and gate/run evidence for review.

IF REJECT: Not applicable. Retain the delivered role/bootstrap and prior schema fixes. Only the general check.mjs regression is to be reverted as specified in PIVOT-002d.

## Integration and downstream status

The full opencode/pivot-002 branch at def55b12 is **not approved to merge yet**. testing-1 is an ancestor, but clean ancestry does not satisfy C3 and C4. The schema/bootstrap concerns reviewed here are closed; no PIVOT-003 or AUTH-001 contract/schema amendment is requested. Their schema work may be prepared in parallel under their existing ownership rules, but this verdict does not clear starting execution on an accepted integrated PIVOT-002 base. Full-branch merge clearance and downstream proceed confirmation will follow the remaining restoration and successful CI evidence at re-review. No AUTH-001 or PIVOT-003 implementation was reviewed or started here.

## Evidence and limits

- Delivery: https://github.com/abdullah2711/SAVEN/blob/def55b12fd40265a24be007907a865a92a0f1987/docs/contractor/deliveries/PIVOT-002c-operator-schema-fixes.md
- Diagnostic: https://github.com/abdullah2711/SAVEN/blob/def55b12fd40265a24be007907a865a92a0f1987/docs/contractor/deliveries/verify-workflow-diagnostic.md
- Corrective implementation: https://github.com/abdullah2711/SAVEN/commit/942ae550bc6ac26f89db5a734bf1a298e77fbeb9
- Prior remaining-fix review: https://github.com/abdullah2711/SAVEN/blob/25a4483394714fa2001e88bfb40e7689265035c4/docs/contractor/reviews/PIVOT-002b-operator-schema-fixes.md
- Workflow and version inputs: .github/workflows/verify.yml, .nvmrc and package.json at def55b12; inspected without modification.
- Live GitHub checks: actions/runs filtered to opencode/pivot-002 returned zero runs; open pulls filtered to that head and testing-1 base returned an empty list at review time.

Review date: 15 November 2026, Asia/Karachi. Wrote only this review and the bounded remaining contract. No implementation fix, database gate, PR creation, SSH connection, deployment or merge was performed.
