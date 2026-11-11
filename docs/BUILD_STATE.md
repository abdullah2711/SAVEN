# SAVEN build checkpoint

## Authority and branch

The owner authorized construction on 11 November 2026 after supplying the additional input. All changes go to testing-1. Promotion to main requires the owner's release decision. Testing domain: https://saventesting.economicsystems.cc/ . Production domain: https://app.saven.economicsystems.cc/ . Marketing domain: https://saven.economicsystems.cc/ .

## Current work

First foundation implemented and locally tested: shared commands; fixed-point accounting previews; company membership; invitation sessions; invoice and approved stock issue; append-only posted journals; audit and retry protection; browser workspace; local SQLite adapter and Cloudflare Worker/D1 entry. The catalog has 239 requirements; partial foundations are in progress, not marked release-verified.

## Resume procedure

1. Read AGENTS.md, this file, docs/11-additional-input.md, and docs/12-foundation.md.
2. Inspect current testing-1 head and local changes. Do not overwrite another contributor's work.
3. Run `node scripts/check.mjs`, `node --test tests/*.test.mjs`, and `python tools/validate_plan.py`.
4. Inspect remaining work and recorded verification limits before extending the implementation.
5. Record changed files, passed and failed checks, deployment state and next action here before each handoff. Commit source and tests together. Never commit local database files or access tokens.

## Remaining release work

The broad launch catalog remains required. This first foundation is not the commercial release. Password/passkey identity and MFA, full operator provisioning, document storage and malware scanning, tax localization, offline sync, comprehensive modules, AI providers/evaluations, PostgreSQL adapter or a validated D1 capacity decision, production recovery, independent security testing, and real-user usability/performance evidence remain unfinished. No customer data is authorized for initial fixtures.

## Last verified state

Source baseline: d0f63d3e08fc7f7d55eab26acd667ce99b9b51f4. The repository previously contained planning only. GitHub reports failed Cloudflare build checks on that baseline; deployment is not assumed healthy. Local Git network access is unavailable; authenticated GitHub connector operations preserve the branch lease and existing tree.

Local evidence: 22 automated tests pass, including an HTTP Request/Response journey through the actual Worker handler, financial/security cases and agent tool denial. Source syntax and planning/reference checks pass. Generated catalog is reproducible. The reference runtime is Node 24.19.0 and SQLite 3.53.3; no runtime dependency download was needed. D1/workerd execution, independent-process load, restoration, browser rendering, mobile, keyboard and print remain unverified.

Browser blockers: in-app browser navigation timed out, shell loopback connections were denied, and the desktop-browser approval request expired. No claim of screenshot or visual verification is made. A local synthetic server was started for attempted QA; stop the owned process after checks. No browser screenshot is included as a deliverable.

Publication: this source snapshot targets testing-1 only, using a lease against the inspected branch head. Inspect GitHub checks for the current head; a source commit does not establish a working live environment. No main update, customer import, production binding, live database provisioning or billing action has been performed.

Next actions: confirm testing Worker branch and DB binding, run D1 contract tests and provision isolated test identities through a controlled operator path; complete browser QA; then implement real operator onboarding, identity/MFA, company setup/opening reconciliation and protected attachments. Preserve all other catalog requirements.
