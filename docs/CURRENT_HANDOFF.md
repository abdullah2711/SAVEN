# Current agent and Codex CLI handoff

15 November 2026, Asia/Karachi. This is the authoritative present-state summary. Older BUILD_STATE entries are historical and may describe superseded branches, schemas or priorities.

## Start here

Read AGENTS.md, docs/50-accounting-dashboard-and-mvp1-revision.md, docs/51-codex-cli-and-engineer-operating-model.md, docs/52-project-skills-and-ai-configuration.md, docs48, docs49 and contracts/delivery-checklist.json. Follow source mandates where nonconflicting. The requested pre-implementation checkpoint was published first as 2bff157f44de1a6aed665a274b0b2a004b07f0e3, with all 309 intended file hashes verified. Both workflows passed for that checkpoint (Native 43659574337, Verify 43659574334). The follow-up source fixes and final evidence described here are the latest continuation. Credentials from chat are not part of either checkpoint.

## Exact source/live boundary

- Repository: abdullah2711/SAVEN. Work branch: testing-1. Check its fresh head with git; this handoff is included in the checkpoint commit and cannot embed its own final SHA.
- Checkpoint parent: 367cb2a38d23cc61daa1f706846b2404f9775e1a, tree 9755a6bcf0b54a89c27a1364824ee2a89e9b6b6a. It records the prior deployed release.
- Main and last verified live application source: b9bdf75824b017cd813f55245f3c352d786fa864. Image tag saven-native:accounting-b9bdf758; image sha256:7eaf5d401fb503e3a5d33277cb8af69a6e1a8e2f559631867246c7be149ee5a2. This new checkpoint is NOT deployed and must not be promoted without its remaining gates.
- Live app https://app.economicsystems.cc and ops https://ops.economicsystems.cc use owner-server native SQLite and the Cloudflare tunnel. Container saven-native-candidate binds 127.0.0.1:8790; data /var/lib/saven-native-staging/data mounted to /data. Nine internal QA tenant stores, tenant schema 9 and identity schema 3 were last verified. No actual client onboarding is claimed.
- Prior release: 138 local tests, 69 Linux tests and both CI workflows passed. Independent recovery preserved 227 original tenant tables, 13 stores and 4 original objects; all tenant integrity/foreign-key checks passed. Backup service saven-native-backup.service passed before/after that deployment. Last stopped snapshot /var/backups/saven-native/cutover-20261114T200519Z/snapshot. Reverify current state before any new deployment.
- Retained old container saven-native-retained-pre-accounting-20261114T200519Z, PostgreSQL/reference services, frozen saventesting frontend, Nextcloud, Listmonk, scanner, Ollama and tunnel are not cleanup targets.

## Current checkpoint: source WIP, not released

New source in public/live/pages.js provides the MVP1 page map and truthful planned destinations. workspace.js/app.js add separate module navigation/disclosure, collapsible rail, mobile drawer, standalone Approvals and an Accounting overview. accounting.js adds a real authorized dashboard, a mixed-state journal register and New journal-only editor. Native runtime/http/documents add /api/journal-register and audited recoverable removal of own unsubmitted drafts. No new migration; schema remains9. Applied migration bytes are untouched.

Register states include draft, approval pending, returned/correction pending, rejected, submitted and cancelled. Drafts have no GL effects. A posted reversal marks the original source cancelled while retaining GL history. Only authorized company/resource scope and the actor's own editable private drafts are visible. Soft removal is audit-based, not SQL deletion; posted sources cannot be removed through it.

Seventeen project-local skills from all four requested repositories and pinned optional agent-browser/Astryx CLI manifests are included. See docs52 for exact pins, scope, limitations and actual use. Personal account-wide install did not complete. The owner selected OpenRouter nvidia/nemotron-3.5-lightning:free. Server-only integration now exists in src/local/model-config.mjs and scripts/native-server.mjs, using a named tool envelope because the selected endpoint does not advertise JSON-schema response formatting. The private key is stored only in ignored var/secrets/openrouter.key on this workstation with access restricted to the current Windows principal; it is absent from Git and must be provisioned separately on another host. Live activation is blocked: the synthetic request returned 404, no endpoint matching the data policy (free model training). Do not change privacy settings, send business records, choose a paid model or silently relax routing. The synthetic probe did not invoke any business action. No server deployment or runtime activation has happened in this continuation.

## Verification of current source

All 145 Node tests pass, including the removed-draft direct edit/submit/cancel regression and three provider configuration/request/failure contracts. All 144 JavaScript files parse. Generators retain 269 specified requirements. Skill validation checks 17 entry points, four pinned sources, licenses, local guide links and 271 file checksums. Planning/checklist validation passes. Tested follow-up source e348422410d09d5556b3262d965f55bb80a44b1a passed Native SQLite43660392119 and Verify SAVEN43660392085. The subsequent portable-preview/evidence checkpoint does not deploy anything; inspect its own CI as usual. Its new launcher was syntax checked and returned HTTP200 from its fresh isolated fixture.

An isolated synthetic browser confirmed Accounting dashboard, register/form separation, submitted and saved-draft register rows, desktop rail collapse and standalone Approvals. Follow-up desktop/320px observation confirms grouped amounts, no split metric text, icon Back/Forward controls, correct Open/Close drawer labels and Escape from a sidebar control returning focus to the toggle. No real client records were touched. Full keyboard/focus trapping, print, RTL, all review transitions and complete accessibility audits remain open.

The installed agent-browser 0.43.0 CLI serves its core guide and reports its version. Astryx CLI 0.7.16 version/search/navigation docs work; optional Core/component search could not install its matching registry package. No Astryx framework was adopted. Hallmark's source-only lint was run; it reports existing typography/token/stamp/spacing findings. It is NOT a clean Hallmark redesign or rendered/full review. All 17 source guides and their licenses/local linked files are present. Personal account-wide installation and Chromium provisioning remain incomplete. See docs52 for the exact limitations.

## Fixed since initial checkpoint

- Audited removed drafts now reject direct save, submit and cancel until explicitly restored, including the acceptance-time check. The regression proves no GL/inbox/revision change while removed, then normal same-number submission after restoration.
- Dashboard values use grouping and a one-column metric layout below 400px. Mobile labels/expanded state match drawer state on render/toggle. Icon history buttons have accessible names.
- Explicit local/compatible provider configuration supports a protected key file or environment secret. OpenRouter pins the selected free model, zero price caps, no provider fallback and data collection denied. Structured tool arguments pass the existing response allowlist before any business action. Oversized prompts and malformed/provider-error replies fail closed. Three new tests cover these contracts.

## Exact next actions for Codex CLI

1. Inspect latest git head/status and both exact-commit CI runs. Preserve the complete pre-implementation checkpoint and follow-up commits. Verify source/skill integrity using docs51 commands. Do not copy ignored databases or secrets into Git.
2. Finish keyboard/drawer focus and breakpoint-change behavior; mobile sidebar is visually hidden by CSS and still needs a complete focus/inert/trap audit. Display authorized actor labels instead of opaque UUIDs where appropriate. Review source-only Hallmark findings within the approved visual system; do not fabricate a clean audit or force an unrelated framework rewrite.
3. For deployment: build/test the exact Linux source; create a fresh stopped/consistent backup; independently restore/reconcile existing tenant rows and objects; inspect schema compatibility; retain the current image and original files. Deploy only after those gates, verify app/ops served hashes and authenticated scoped reads, then synchronize main to the deployed source. Current changes are NOT live.
4. OpenRouter remains blocked by the free endpoint's privacy/data-policy eligibility. Present that specific condition to the owner; do not relax data handling or switch models silently. The key must be provisioned securely outside Git on the target server. After a permitted compatible provider path exists, run a synthetic live response through validation before enabling scoped business use. No paid fallback is authorized.
5. Finish Accounting: opening subledgers/import/reconciliation, recurring journals, accruals/prepayments, bank reconciliation/FX, complete cash flow/equity/statements/notes and forms/print formats. Then Settings (including per-page delegation and versioned custom formats), connected modules, broader ops and the rest of MVP2. All docs48 linkage/recognition/withholding requirements remain active.

## Access and local environment

Use a real git clone for CLI; this Work Mode directory has no .git. Source changes are published through Git Data APIs with an expected-head lease. Preserve unrelated local text differences in docs08 and docs10; they are not part of this change and must not overwrite remote source. CRLF-only local differences are not meaningful changes. Never upload var/, node_modules, databases, backups, credentials or raw private feedback.

Server access must be obtained securely. An existing cached Cloudflare Access session previously worked via ssh.economicsystems.cc; temporary Pinggy endpoints expire. Do not assume the last chat endpoint is alive. Passwords and API keys are deliberately absent. The SSH helper in ignored var/ is not a portable tool contract. Historical local PostgreSQL001 migration differences are also excluded from these commits; applied SQL bytes on GitHub are unchanged. Use standard authorized SSH in CLI and verify the host key. Deployment/root access is only needed after local/source gates.

For ordinary continuation use docs51 and the checklist; no hidden chat state, private memory, Work Mode plugin or another account's token is required. Before acting after interruption, inspect git status, fresh branch heads, CI and live source separately.


## One-command local UI for CLI continuation

Run npm ci --ignore-scripts, then npm run native:preview. Open http://127.0.0.1:4180/#Accounting/Overview and sign in with public synthetic fixture credentials preview@example.invalid / Preview-only-password-2026. scripts/native-ui-preview.mjs creates its own OS-temp business, loopback-only server and sample journals/trade/stock; no production data, private key or hosted AI is connected. Ctrl+C closes and removes its own fixture. The CLI engineer can reproduce the real UI without SSH or copying ignored files from this workstation. Do not confuse this QA setup with deployment or client onboarding.
