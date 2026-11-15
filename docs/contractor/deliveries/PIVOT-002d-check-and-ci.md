CONTRACT: docs/contractor/contracts/PIVOT-002d-check-and-ci.md
STATUS: DONE — database-independent check/build restored; the unchanged Verify SAVEN workflow passed on the unmerged pull request. The accepted PIVOT-002c role/bootstrap fixes were retained without modification.

## Identity

- Branch: `opencode/pivot-002`
- Implementation/head SHA: `e1b8e345fbe963a8efbca2181490105247f8e604`
- Base SHA (`testing-1`): `9799ced94db422e1f3328561dd70a3bf0ef6b377`
- Tested PR merge SHA: `3ea42b0833d3fb2af4eb6da26a2880a3a3b2dd32`
- Pull request: https://github.com/abdullah2711/SAVEN/pull/1 — open, unmerged, base `testing-1`, head `opencode/pivot-002`
- Verify SAVEN run: https://github.com/abdullah2711/SAVEN/actions/runs/43704773022 — conclusion `success`, event `pull_request`, run attempt 1
- Native SQLite release candidate run for the same PR: https://github.com/abdullah2711/SAVEN/actions/runs/43704773201 — conclusion `success`

The implementation commit changes only `scripts/check.mjs` (exact restoration) and `db/postgres/README.md` (instructions). This delivery report is a report-only follow-up commit; its SHA is identified in the final delivery message and the PR body. It changes no executable, workflow or generated-check input.

## Files changed by the implementation commit

- `scripts/check.mjs` — restored exactly to its `9799ced` blob. The PIVOT-002 PostgreSQL gate added by `d5b7aaa` was removed, so ordinary syntax/build checks are database-independent again.
- `db/postgres/README.md` — corrected the general check/build versus explicit PostgreSQL-test instructions. Only the explicit tests require the dedicated-cluster environment.
- `docs/contractor/deliveries/PIVOT-002d-check-and-ci.md` — this report (report-only follow-up).

No workflow, package, lockfile, SQL, schema, fixture, test, contract or applied-migration change is included. The PIVOT-002c runtime/migration separation, validation-only bootstrap, offline migrator ownership, immutable ledgers and cleanup safeguards are unchanged.

## Blocker 3 — check.mjs restoration proof

```text
$ git rev-parse 9799ced:scripts/check.mjs
e734d20e1b8c160e0c727ad4b6800bb023f01636

$ git hash-object scripts/check.mjs
e734d20e1b8c160e0c727ad4b6800bb023f01636

$ git diff 9799ced -- scripts/check.mjs
(no output)
```

The restored file parses every JavaScript file under `src`, `scripts`, `tests`, `public` and `reference`, validates `package.json`, and prints `PASS: 146 JavaScript files parsed; package manifest valid.` It has no database connection, no `PGHOST` requirement and no test-spawn side effect.

The PostgreSQL-specific gate was removed rather than moved to a new command: the contract's TOUCH list authorizes only the exact `scripts/check.mjs` restoration and the README correction, and the PIVOT-002c review decision C3 explicitly says "Do not add a new command, change package scripts or rebuild the accepted fixture." The explicit PostgreSQL tests remain mandatory in their own right.

## Local no-PostgreSQL gate

All `PG*`, `CONTRACT_DATABASE` and `SAVEN_PIVOT_TEST_CLUSTER` variables were removed from the shell before these commands.

```text
=== node scripts/check.mjs ===
PASS: 146 JavaScript files parsed; package manifest valid.
EXIT=0
=== npm run check ===

> saven@0.1.0 check
> node scripts/check.mjs

PASS: 146 JavaScript files parsed; package manifest valid.
EXIT=0
=== npm run build ===

> saven@0.1.0 build
> node scripts/check.mjs

PASS: 146 JavaScript files parsed; package manifest valid.
EXIT=0
```

## Local explicit PostgreSQL gate

Environment: a dedicated disposable local PostgreSQL 18.6 cluster created with `embedded-postgres` 18.6.0-beta.19, loopback `127.0.0.1:55432`, `SAVEN_PIVOT_TEST_CLUSTER=1`, and a private generated postgres credential. No owner-server, SSH, production or shared-cluster access was used. The fixture created only `saven_pivot_*` objects and removed them.

Command:

```text
node scripts/check.mjs && node --test tests/pivot-002-operator.test.mjs && node --test tests/*.test.mjs
```

Verbatim gate result (excerpt; full log at `context/pivot-002d-gate.log`):

```text
PASS: 146 JavaScript files parsed; package manifest valid.
✔ PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (9459.8549ms)
✔ PIVOT-002 fixture refuses pre-existing cluster roles before mutation (340.9199ms)
✔ PIVOT-002 checked-in role bootstrap refuses incompatible pre-existing roles atomically (1608.6469ms)
✔ PIVOT-002 fixture namespaces isolate concurrent runs (2986.773ms)
✔ PIVOT-002 fixture reports run and cleanup failures together (1.5413ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14858.6806
```

```text
✔ maintenance and PostgreSQL outages never write to the former D1 database (2.4626ms)
ℹ tests 150
ℹ suites 0
ℹ pass 150
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17364.3502
```

Exit status: `0`. No PIVOT-002 case was skipped or weakened.

## Fail-closed evidence without the dedicated-cluster opt-in

Command, with `SAVEN_PIVOT_TEST_CLUSTER` and all `PG*` variables absent:

```text
node --test tests/pivot-002-operator.test.mjs
```

The four cluster-dependent cases fail before any mutation with the explicit refusal; the fifth case is a pure unit test of cleanup-error aggregation. Verbatim excerpt (full log at `context/pivot-002d-fail-closed.log`):

```text
✖ PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (14.9654ms)
✖ PIVOT-002 fixture refuses pre-existing cluster roles before mutation (3.3126ms)
✖ PIVOT-002 checked-in role bootstrap refuses incompatible pre-existing roles atomically (8.6863ms)
✖ PIVOT-002 fixture namespaces isolate concurrent runs (1.9055ms)
✔ PIVOT-002 fixture reports run and cleanup failures together (1.1185ms)
ℹ tests 5
...
  Error: PIVOT-002 fixture refuses to run: set SAVEN_PIVOT_TEST_CLUSTER=1 for a dedicated disposable PostgreSQL cluster.
...
EXIT=1
```

## Blocker 4 — unchanged Verify SAVEN on the unmerged PR

### Trigger

The workflow's `on:` block is unchanged:

```yaml
on:
  push:
    branches: [testing-1, main]
  pull_request:
    branches: [testing-1, main]
```

Pull request #1 targets `testing-1` from `opencode/pivot-002`. The `pull_request` event ran Verify SAVEN without any merge or workflow edit. No push was made to `testing-1` or `main`.

### PostgreSQL service

The unchanged service definition is `postgres:18`, with `POSTGRES_DB: saven_contract_ci`, the workflow's test-only administrator credential, loopback mapping `5432:5432`, and the `pg_isready` health command. The run log shows the service became healthy before the Node steps:

```text
docker.io/library/postgres:18
postgres service is healthy.
```

The explicit Node tests received `PGHOST=127.0.0.1`, `PGPORT=5432`, `PGUSER=postgres`, `PGADMIN_DATABASE=postgres`, `SAVEN_PIVOT_TEST_CLUSTER=1` and the service test credential. The later verifier steps received `PGHOST=127.0.0.1`, `CONTRACT_DATABASE=saven_contract_ci` and the same service credential. No owner-server or SSH access was required.

### Run identity and conclusion

```text
run id:            43704773022
workflow:          Verify SAVEN
event:             pull_request
run attempt:       1
status:            completed
conclusion:        success
run URL:           https://github.com/abdullah2711/SAVEN/actions/runs/43704773022
head SHA:          e1b8e345fbe963a8efbca2181490105247f8e604
tested merge SHA:  3ea42b0833d3fb2af4eb6da26a2880a3a3b2dd32
base SHA:          9799ced94db422e1f3328561dd70a3bf0ef6b377
created:           2026-11-15 10:34:57 UTC
completed:         2026-11-15 10:35:54 UTC
```

The checkout log confirms the tested merge:

```text
HEAD is now at 3ea42b0 Merge e1b8e345fbe963a8efbca2181490105247f8e604 into 9799ced94db422e1f3328561dd70a3bf0ef6b377
```

Environment identity: GitHub-hosted `ubuntu-latest`; Node 24.19.0 from `.nvmrc`; Python 3.14 from `setup-python`; the pinned `actions/checkout`, `actions/setup-node` and `actions/setup-python` revisions from the unchanged workflow; `postgres:18` image digest `sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc`; `npm ci --ignore-scripts --no-audit --no-fund`.

### Step results

Every step completed successfully, including dependency installation, general parser, full Node suite, all 14 PostgreSQL verifiers, the skill/checklist/plan validators, both design generators and their clean-diff checks:

| Step | Name | Conclusion |
| --- | --- | --- |
| 6 | `npm ci --ignore-scripts --no-audit --no-fund` | success |
| 7 | `node scripts/check.mjs` | success |
| 8 | `node --test tests/*.test.mjs` | success |
| 9 | `node scripts/verify-postgres.mjs --initialize` | success |
| 10 | `node scripts/verify-operating.mjs --migrate` | success |
| 11–13 | `validate_project_skills.py`, `checklist.py --check`, `validate_plan.py` | success |
| 14 | design generators and clean diff | success |
| 15 | `node scripts/verify-accounting-cycles.mjs --migrate` | success |
| 16 | generated catalog clean diff | success |
| 17 | `node scripts/verify-services.mjs --migrate` | success |
| 18 | `node scripts/verify-accounting-workspace.mjs --migrate` | success |
| 19 | `node scripts/verify-party-accounting.mjs --migrate` | success |
| 20 | `node scripts/verify-opening.mjs --migrate` | success |
| 21 | `node scripts/verify-recurring.mjs --migrate` | success |
| 22 | `node scripts/verify-exports-evidence.mjs` | success |
| 23 | `node scripts/verify-approval-policies.mjs --migrate` | success |
| 24 | `node scripts/verify-payments.mjs --migrate` | success |
| 25 | `node scripts/verify-approval-conditions.mjs --migrate` | success |
| 26 | `node scripts/verify-assets.mjs --migrate` | success |
| 27 | `node scripts/verify-invoice-taxes.mjs --migrate` | success |

No step was deleted, commented out, trimmed, skipped or weakened. The full Node suite in the run reports 150 tests passing; the PIVOT-002 tests are part of that suite. The report omits GitHub's post-step cleanup entries from the table; they also succeeded.

## Verifier passability against the current branch state

All 14 `verify-*.mjs` scripts referenced by the workflow exist on the branch and all 14 passed in the PR run. None is blocked by a missing file, missing migration or missing feature.

| Script | Exists | PR result |
| --- | --- | --- |
| `scripts/verify-postgres.mjs` | yes | success |
| `scripts/verify-operating.mjs` | yes | success |
| `scripts/verify-accounting-cycles.mjs` | yes | success |
| `scripts/verify-services.mjs` | yes | success |
| `scripts/verify-accounting-workspace.mjs` | yes | success |
| `scripts/verify-party-accounting.mjs` | yes | success |
| `scripts/verify-opening.mjs` | yes | success |
| `scripts/verify-recurring.mjs` | yes | success |
| `scripts/verify-exports-evidence.mjs` | yes | success |
| `scripts/verify-approval-policies.mjs` | yes | success |
| `scripts/verify-payments.mjs` | yes | success |
| `scripts/verify-approval-conditions.mjs` | yes | success |
| `scripts/verify-assets.mjs` | yes | success |
| `scripts/verify-invoice-taxes.mjs` | yes | success |

Local diagnostic disclosure: in the Windows `embedded-postgres` emulation, `verify-exports-evidence.mjs` exceeded the code's hardcoded 10-second `statement_timeout` on its RLS-scoped accounts aggregate and exited 1. The same export succeeded through the same scoped connection when called directly, and the unchanged workflow's step 22 passed on the GitHub Ubuntu runner. This was an environment-speed artifact of the local Windows cluster, not a missing file/migration/feature or a branch-state dependency. On a clean local database, the other 13 verifier steps passed; the full-suite gate and focused PIVOT gate also passed.

## Deviations and notes

- No workflow edit, no package script change, no new command and no new schema/downstream implementation. The PostgreSQL-specific parser gate was removed, not relocated, because the contract's TOUCH list and the C3 decision forbid adding a command or changing package scripts.
- The review/contract documents were merged from `origin/codex/postgresql-engineering-20261115` at `ba1ef73` into the work branch as `ff00d26aa74512f50512930e5b728328a83f41fb`. That merge changes documentation only and no executable/workflow/generated-check input; the engineer-authored review and contract are preserved.
- The implementation commit preserves all published PIVOT-002/PIVOT-002b/PIVOT-002c history. No rebase, force-push or protected-ref write occurred.
- The PR remains open and unmerged. Merging is not authorized by this contract and was not performed.

## Cleanup

- The local disposable cluster was stopped; loopback port 55432 is closed.
- The temporary data directory `var/pg-test/data-pivot002d-*` and the private credential file were removed.
- No `saven_pivot_*` roles or databases remained after the gate; the fixture's pre-flight/cleanup checks reported `roles []` and `databases []` before shutdown.
- No owner-server, SSH, production or shared-cluster access was used.
- Local evidence logs remain outside the repository under `context/` (`pivot-002d-gate.log`, `pivot-002d-no-pg.log`, `pivot-002d-fail-closed.log`, `pivot-002d-workflow-local.log`, `pivot-002d-clean-replay.log`, `pivot-002d-exports-error.log`). No secret is stored in them.

## Reproduction

```text
git checkout opencode/pivot-002
git rev-parse HEAD                         # e1b8e345fbe963a8efbca2181490105247f8e604
git hash-object scripts/check.mjs          # e734d20e1b8c160e0c727ad4b6800bb023f01636
node scripts/check.mjs                     # database-independent; exit 0
npm run check                              # exit 0
npm run build                              # exit 0
```

With a dedicated disposable PostgreSQL cluster and `SAVEN_PIVOT_TEST_CLUSTER=1`:

```text
node scripts/check.mjs && node --test tests/pivot-002-operator.test.mjs && node --test tests/*.test.mjs
```

Without the opt-in:

```text
node --test tests/pivot-002-operator.test.mjs   # fails clearly before mutation; exit 1
```
