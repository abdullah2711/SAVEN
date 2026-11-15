# Codex CLI and engineer operating model

15 November 2026. This is the project working agreement and reproducible process, not a transcript of any assistant's private instructions. It works with an engineer's own Codex account and does not depend on ChatGPT memory or this conversation.

## Obtain a real checkout

```sh
git clone --branch testing-1 https://github.com/abdullah2711/SAVEN.git
cd SAVEN
git status --short
git log -1 --oneline
codex
```

Use your own authorized GitHub credentials. This Work Mode source directory was materialized without .git; a CLI engineer should use the real clone above. Do not copy ignored var/, caches, local SQLite files, SSH credentials or chat transcripts into the checkout. If reusing a checkout, inspect and preserve existing work before fetching and switching branches. Do not reset or force push another engineer's changes.

Paste this starting instruction into Codex CLI:

> Read AGENTS.md and docs/CURRENT_HANDOFF.md first, then docs/50-accounting-dashboard-and-mvp1-revision.md, docs/51-codex-cli-and-engineer-operating-model.md, docs/52-project-skills-and-ai-configuration.md and contracts/delivery-checklist.json. Read the governing mandate and nonconflicting historical sources as AGENTS requires. Compare the current branch and deployed source before changing anything. Continue the exact next-action queue. Finish Accounting before Settings and other modules. Preserve financial/audit data and applied migration bytes. Keep the checklist and handoff current after each useful increment. Do not confuse source-tested, browser-tested, CI-passed and released states. Never commit credentials. Do not force push or change unrelated services.

## Local prerequisites and checks

Use Node24.13+ below25, Python3 and npm. Docker is needed for container/release checks; the retained PostgreSQL integration suite uses its separate disposable fixture. Windows supports Node's native SQLite. Avoid hosting live SQLite on a synced/network directory; use a local, ignored data path for development and local server disk in deployment.

```sh
npm ci --ignore-scripts
node scripts/check.mjs
node --test tests/*.test.mjs
python tools/build_feature_catalog.py
python tools/build_design_library.py
python tools/checklist.py --check
python tools/validate_plan.py
```

The Work Mode sandbox denied loopback sockets; the ordinary authorized Node runtime ran real HTTP tests. Do not weaken application security to bypass a development runner limitation. The test fixtures are synthetic; never point tests at live business files.

Optional UI tooling is separate from runtime dependencies:

```sh
npm ci --ignore-scripts --prefix .tools/ui
```

Read the appropriate .agents/skills/<name>/SKILL.md before using it. Follow its relevant references and host tool policy. This project's current vanilla JavaScript interface is not an Astryx/React application. Installing a guide or CLI does not authorize a framework rewrite. Use the browser tool available on your host and report what you actually checked.

For an isolated native example run node scripts/native-demo.mjs. For an authenticated local app, inspect scripts/native-server.mjs and its required APP_ORIGIN, OPERATOR_ORIGIN and SAVEN_DATA_DIR variables; use distinct local hostnames/origins and provision only a disposable QA business using the public runtime/identity APIs. The ignored var/ui-workspace-preview.mjs used for current visual checks is not a portable or supported production launcher.

## One increment at a time

1. Read current source/live state, select a small checklist action and mark it in progress. Record assumptions and unsupported scope before coding.
2. Inspect the shared command, permission and posting path. Forms, API, AI, approvals and integrations must converge on that path. Use exact decimal/minor-unit financial arithmetic, atomic balanced effects, immutable source bytes and stable idempotency identities.
3. Build a real workflow. Keep source forms, drafts, GL entries and payment/stock/tax allocations distinct. Preserve user, actual poster, company, branch and project metadata. Check current rights again before posting.
4. Run meaningful relevant tests, then required repository checks. Validate real browser paths at desktop and narrow width; test keyboard/focus, empty/loading/failure states and print layouts as applicable. Save concise evidence without private data. Do not assert a holistic accessibility audit from a screenshot.
5. Update contracts/delivery-checklist.json with tools/checklist.py; regenerate docs/TASKS.md. Update scope/traceability when requirements change, and CURRENT_HANDOFF and BUILD_STATE with actual limits and exact next steps. Source, test, CI and release evidence are separate.
6. Publish to testing-1 using a normal non-force push. Fetch/reconcile if the branch advanced. In an API-only materialization, use immutable blob/tree/commit objects and an expected-head lease; never overwrite remote changes. Inspect both Verify SAVEN and Native SQLite workflows for that exact commit.

## Deployment and recovery

Main represents reviewed, actually deployed application behavior. The owner has authorized tested operational increments and controlled main synchronization; that is not permission to publish an unverified WIP or onboard clients before the full gate. Use the latest handoff, not old date-stamped deployment sections.

Before changing the live container: fresh recoverable backup, independent restore/integrity/foreign-key and financial checks, exact-source Linux build/tests, explicit schema compatibility check and retained rollback artifact. Keep all nine existing QA stores and original objects. Verify served source hashes, authenticated scoped reads, both app/ops origins and backup service after cutover. Record actual source/image/run IDs. An old image is not a database rollback after new-format writes. Never restore an old snapshot over newly accepted transactions without a separate reconciled recovery plan.

Native SQLite is the active engine; retained PostgreSQL/reference adapters and the frozen testing deployment are preserved. Do not edit applied migrations. Follow docs49 for additive evolution, compatible readers/writers, bounded per-tenant upgrades, restore evidence and eventual fleet scheduling. The current migrate-on-open connection cache is not a billion-database scheduler or availability guarantee.

## Parallel engineers and interrupted work

Check branch heads and local changes before each new task. Use a dedicated worktree/branch per independent change; agree file ownership when concurrent work is explicitly requested. Do not spawn extra agents by default. Use small coherent commits and review conflicts in financial contracts instead of selecting one side blindly.

After an interruption, read CURRENT_HANDOFF and the checklist; inspect git status/log and the exact last CI run. Resume unfinished gates rather than repeating completed deployment work or assuming old SSH tunnels remain valid. Server access is environment-specific: obtain it securely from the owner or an existing authorized session. No password, token, private key, cached session or one-use tunnel is embedded here.
