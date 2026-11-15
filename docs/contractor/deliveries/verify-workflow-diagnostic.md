# Verify workflow and check.mjs diagnostic

Date: 15 November 2026 (Asia/Karachi)
Branch: `opencode/pivot-002`
Scope: blocker 3 and blocker 4 diagnosis only. No additional change was made to `scripts/check.mjs` or `.github/workflows/verify.yml` for this diagnostic; the PIVOT-002b change remains exactly as diagnosed.

## Blocker 3 — `scripts/check.mjs` now requires PostgreSQL

### Which change and file

- File: `scripts/check.mjs`
- Commit: `d5b7aaab12755ae7c835f4f158253f405bc736e3`
  (`db: correct PIVOT-002 isolation, CI and immutability [contract:PIVOT-002b]`)
- That commit added an unconditional `SAVEN_PIVOT_TEST_CLUSTER=1` check, a `PGHOST`/`PGUSER` check, and a `spawnSync` invocation of `node --test tests/pivot-002-operator.test.mjs`.
- `package.json` maps both `check` and `build` to `node scripts/check.mjs`:
  - `"check": "node scripts/check.mjs"`
  - `"build": "node scripts/check.mjs"`

### SQLite-only path before the change

At `9799ced94db422e1f3328561dd70a3bf0ef6b377` (and its parent baseline), `scripts/check.mjs` was database-independent. It parsed every `src`, `scripts`, `tests`, `public` and `reference` JavaScript file with `node --check`, validated `package.json` as JSON, and printed:

```text
PASS: 146 JavaScript files parsed; package manifest valid.
```

The complete baseline file was:

```js
import { readdir,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
let count=0;
async function checkDirectory(dir){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=resolve(dir,entry.name);
  if(entry.isDirectory())await checkDirectory(path);
  else if(/\.(mjs|js)$/.test(entry.name)){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}count++;}
 }
}
for(const dir of ['src','scripts','tests','public','reference'])await checkDirectory(resolve(root,dir));
JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
console.log(`PASS: ${count} JavaScript files parsed; package manifest valid.`);
```

The native/SQLite test path was `node --test tests/*.test.mjs`; it did not receive PostgreSQL settings in the old workflow and did not need them. The PIVOT-002 test did not exist before the PostgreSQL pivot work.

### Current behavior

- `node scripts/check.mjs` with no `SAVEN_PIVOT_TEST_CLUSTER=1` exits 1 with a clear refusal message.
- With the opt-in but without `PGHOST`/`PGUSER`, it exits 1 with a clear configuration message.
- With a dedicated disposable PostgreSQL configuration, it parses the JavaScript files and runs the focused `tests/pivot-002-operator.test.mjs`; a failing database test fails the command.
- Therefore ordinary `npm run check` and `npm run build` now require a PostgreSQL test environment. This is reported, not reverted, per the owner instruction.

Observed no-PostgreSQL output on this branch:

```text
PASS: 146 JavaScript files parsed; package manifest valid.
PIVOT-002 PostgreSQL gate requires SAVEN_PIVOT_TEST_CLUSTER=1 for a dedicated disposable cluster. Refusing to skip.
```

Exit status: `1`. With a dedicated local cluster and the explicit environment, the same command passed and ran the focused PIVOT-002 suite (5/5); that is separately recorded in the PIVOT-002c delivery report.

## Blocker 4 — Verify SAVEN workflow evidence

### Does `verify.yml` trigger on `opencode/pivot-002`?

No. The exact trigger block is:

```yaml
on:
  push:
    branches: [testing-1, main]
  pull_request:
    branches: [testing-1, main]
```

- A direct push to `opencode/pivot-002` does not match either branch list.
- An unmerged pull request targeting `testing-1` (or `main`) would match `pull_request` and run the workflow. No such pull request exists for this branch at diagnostic time.
- No direct push to `testing-1` or `main` was performed; the branch is unmerged.

### Referenced `verify-*.mjs` scripts on this branch

All references extracted from `.github/workflows/verify.yml`:

| Script | Exists on branch |
| --- | --- |
| `scripts/verify-accounting-cycles.mjs` | yes |
| `scripts/verify-accounting-workspace.mjs` | yes |
| `scripts/verify-approval-conditions.mjs` | yes |
| `scripts/verify-approval-policies.mjs` | yes |
| `scripts/verify-assets.mjs` | yes |
| `scripts/verify-exports-evidence.mjs` | yes |
| `scripts/verify-invoice-taxes.mjs` | yes |
| `scripts/verify-opening.mjs` | yes |
| `scripts/verify-operating.mjs` | yes |
| `scripts/verify-party-accounting.mjs` | yes |
| `scripts/verify-payments.mjs` | yes |
| `scripts/verify-postgres.mjs` | yes |
| `scripts/verify-recurring.mjs` | yes |
| `scripts/verify-services.mjs` | yes |

The workflow also runs `node scripts/check.mjs` and `node --test tests/*.test.mjs`; those steps now carry the explicit PostgreSQL service environment added in PIVOT-002b. The workflow's later PostgreSQL verification steps and Python/generated-document checks remain part of the same job.

### Is `gh` available and authenticated?

No. `gh` is not installed or on `PATH` in this environment:

```text
gh: The term 'gh' is not recognized as a name of a cmdlet, function, script file, or executable program.
```

Because `gh` is unavailable, `gh auth status` and `gh run list --workflow=verify.yml --limit 10` could not be run. There is therefore no `gh` run-list output to paste. The prior engineer review reported a GitHub API query for branch `opencode/pivot-002` returning zero workflow runs at review time; that is review evidence, not new CLI evidence from this session.

### Current conclusion

- The workflow has no successful run for `opencode/pivot-002` because it does not trigger on that branch.
- The only normal way to obtain the required run is an unmerged pull request targeting `testing-1` (or a controlled integration event that does not merge). No pull request was opened as part of this diagnostic, and no workflow file was modified.
- The three Node commands can be run locally against a dedicated disposable cluster; that is local gate evidence, not a substitute for the required Verify SAVEN run.
