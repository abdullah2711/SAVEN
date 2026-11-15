# Current agent and Codex CLI handoff

15 November 2026, Asia/Karachi. This is the authoritative present-state summary. Older BUILD_STATE entries are historical and may describe superseded branches, schemas or priorities.

## Start here

Read AGENTS.md, docs/50-accounting-dashboard-and-mvp1-revision.md, docs/51-codex-cli-and-engineer-operating-model.md, docs/52-project-skills-and-ai-configuration.md, docs48, docs49 and contracts/delivery-checklist.json. Follow source mandates where nonconflicting. The latest owner instruction is to checkpoint everything needed for a CLI engineer BEFORE further implementation. Credentials from chat are not part of the checkpoint.

## Exact source/live boundary

- Repository: abdullah2711/SAVEN. Work branch: testing-1. Check its fresh head with git; this handoff is included in the checkpoint commit and cannot embed its own final SHA.
- Checkpoint parent: 367cb2a38d23cc61daa1f706846b2404f9775e1a, tree9755a6bcf0b54a89c27a1364824ee2a89e9b6b6a. It records the prior deployed release.
- Main and last verified live application source: b9bdf75824b017cd813f55245f3c352d786fa864. Image tag saven-native:accounting-b9bdf758; image sha256:7eaf5d401fb503e3a5d33277cb8af69a6e1a8e2f559631867246c7be149ee5a2. This new checkpoint is NOT deployed and must not be promoted without its remaining gates.
- Live app https://app.economicsystems.cc and ops https://ops.economicsystems.cc use owner-server native SQLite and the Cloudflare tunnel. Container saven-native-candidate binds127.0.0.1:8790; data /var/lib/saven-native-staging/data mounted to /data. Nine internal QA tenant stores, tenant schema9 and identity schema3 were last verified. No actual client onboarding is claimed.
- Prior release:138 local tests,69 Linux tests and both CI workflows passed. Independent recovery preserved227 original tenant tables,13 stores and4 original objects; all tenant integrity/foreign-key checks passed. Backup service saven-native-backup.service passed before/after that deployment. Last stopped snapshot /var/backups/saven-native/cutover-20261114T200519Z/snapshot. Reverify current state before any new deployment.
- Retained old container saven-native-retained-pre-accounting-20261114T200519Z, PostgreSQL/reference services, frozen saventesting frontend, Nextcloud, Listmonk, scanner, Ollama and tunnel are not cleanup targets.

## Current checkpoint: source WIP, not released

New source in public/live/pages.js provides the MVP1 page map and truthful planned destinations. workspace.js/app.js add separate module navigation/disclosure, collapsible rail, mobile drawer, standalone Approvals and an Accounting overview. accounting.js adds a real authorized dashboard, a mixed-state journal register and New journal-only editor. Native runtime/http/documents add /api/journal-register and audited recoverable removal of own unsubmitted drafts. No new migration; schema remains9. Applied migration bytes are untouched.

Register states include draft, approval pending, returned/correction pending, rejected, submitted and cancelled. Drafts have no GL effects. A posted reversal marks the original source cancelled while retaining GL history. Only authorized company/resource scope and the actor's own editable private drafts are visible. Soft removal is audit-based, not SQL deletion; posted sources cannot be removed through it.

Seventeen project-local skills from all four requested repositories and pinned optional agent-browser/Astryx CLI manifests are included. See docs52 for exact pins, scope, limitations and actual use. Personal account-wide install did not complete. The owner selected OpenRouter nvidia/nemotron-3.5-lightning:free and supplied a private key; do not commit or reproduce it. Integration is not implemented or activated yet. Record it as a next action, not a working feature.

## Verification of this WIP

The focused frontend startup checks and13 document tests passed during development (three new register/removal/scope cases). Full suite and final CI for this checkpoint have NOT yet been run. Do not reuse prior138/69 pass numbers as evidence for current source.

An isolated synthetic local browser confirmed: Accounting dashboard landing; desktop rail collapse/expand; register with submitted JRN-000001 and newly saved incomplete draft JRN-000002; separate New journal form; standalone Approvals views; mobile drawer opening and closing on navigation at320px. No real client records were touched. Whole-page keyboard, print, review transitions, RTL and full accessibility audits remain unverified.

## Known defects and precise next actions

1. Close the removed-draft direct-API gap: list/register hide an audited removed draft, but existing save/submit/cancel code must also reject it until explicitly restored. Add regression for direct submit/save after removal; preserve number, source and audit. Do this before deployment.
2. Fix320px dashboard amount wrapping (19000.00 splits across lines), add readable grouped values, and make mobile toggle aria-label/expanded state match actual drawer state. Restore accessible icon Back/Forward controls (current WIP displays words). Optionally display authorized actor labels instead of opaque UUIDs.
3. Validate installed skill guides/frontmatter/references/licenses, CLI versions and portable tooling prerequisites. Do not adopt Astryx/React or silently claim Hallmark's full workflow. Clean up only the Git credential prompt/process initiated by the failed personal-skills clone if still present; do not kill unrelated Git tasks.
4. Run syntax check, full Node tests, both generators, checklist check and plan validation; record actual results. Run browser regressions at desktop and320px after fixes. Use tools/checklist.py for small actions.
5. Publish fixes to testing-1, inspect both CI workflows for the exact commit, build/test exact Linux source, make a fresh backup and independently restore/reconcile it. Deploy only after all gates; preserve services and original data. Then synchronize main with the actually deployed reviewed source and record source/image/run IDs.
6. Implement OpenRouter provider configuration securely, verify official model/API compatibility, add meaningful safe request/error tests and a synthetic live probe. No paid/model fallback without owner instruction. Model output remains untrusted and cannot post outside normal controls.
7. Finish Accounting: opening subledgers/import/reconciliation, recurring journals, accruals/prepayments, bank reconciliation/FX, complete cash flow/equity/statements/notes and full forms/print formats. Then Settings (including per-page delegation and custom immutable-versioned formats), then connected modules, broader ops and the rest of MVP2. All docs48 financial/linkage requirements remain active.

## Access and local environment

Use a real git clone for CLI; this Work Mode directory has no .git. Source changes are published through Git Data APIs with an expected-head lease. Preserve unrelated local text differences in docs08 and docs10; they are not part of this change and must not overwrite remote source. CRLF-only local differences are not meaningful changes. Never upload var/, node_modules, databases, backups, credentials or raw private feedback.

Server access must be obtained securely. An existing cached Cloudflare Access session previously worked via ssh.economicsystems.cc; temporary Pinggy endpoints expire. Do not assume the last chat endpoint is alive. Passwords and API keys are deliberately absent. The SSH helper in ignored var/ is not a portable tool contract. Use standard authorized SSH in CLI and verify the host key. Deployment/root access is only needed after local/source gates.

For ordinary continuation use docs51 and the checklist; no hidden chat state, private memory, Work Mode plugin or another account's token is required. Before acting after interruption, inspect git status, fresh branch heads, CI and live source separately.
