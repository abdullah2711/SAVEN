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

Remote evidence for implementation commit c0dc98aa73905b98247bf55499ef46052da3fbc1: GitHub foundation job passed all 22 tests plus source/catalog checks; Cloudflare Workers Builds saven-testing completed successfully. Main was independently checked and remained bdf418ca3bf6ebac49115f45119cbe0f6548e907. The production-named saven Worker also triggered a build from the testing commit and failed. Its dashboard branch mapping needs review before further deployment work. The successful testing build does not prove DB binding/migrations or live financial availability; HTTP/visual inspection of the custom domain was unavailable.

CI maintenance: the first remote run warned that older action versions used deprecated Node 20 entrypoints. The workflow now pins the official checkout v7.0.1, setup-node v7.1.0 and setup-python v7.1.0 commit SHAs and disables checkout credential persistence. The financial application code is unchanged from the tested implementation commit. The local QA server has been stopped.

Next actions: confirm testing Worker branch and DB binding, run D1 contract tests and provision isolated test identities through a controlled operator path; complete browser QA; then implement real operator onboarding, identity/MFA, company setup/opening reconciliation and protected attachments. Preserve all other catalog requirements.

## Testing activation update — 12 November 2026 (Asia/Karachi)

The logged-in Helium session became accessible after the owner selected Cloudflare. Verified the testing Worker builds testing-1, and confirmed it had no database bindings. Created a separate empty D1 database, saven-testing-db, ID 42a1463c-40d9-4f23-9ecb-50265eb07bb1, within the existing free database quota. Ran a read-only console connection/batch query successfully. No pre-existing database was modified.

The execution environment then disconnected, Notepad access approval expired, and browser tools were removed. The database schema import did NOT complete. No hosted user, invitation, session, journal, or customer record has been created. Do not issue a local token as if it were valid on the hosted site.

The source now declares the actual DB binding and centers the ESC logo, SAVEN name, caption and introductory copy on one axis. Added a separate sign-in stylesheet, a health readiness distinction, and an activation-pending state so an uninitialized database does not present a misleading invitation form. The private bootstrap preparer writes schema/fixture SQL plus token hashes and a separate private invitation handoff under ignored var/. It is not called by the Worker and exposes no public bootstrap endpoint.

Resume: restore an execution environment; pull the latest testing-1 source; verify the empty database schema and console state; generate fresh invitations with node scripts/prepare-testing.mjs; import the SQL into THIS testing database; verify all tables/triggers and user membership; confirm /api/health schemaReady; test hosted login, invoice payment variants and stock approval/retry. Do not reuse expired private output files or duplicate an uncertain import. Then hand the owner a fresh hosted invitation. The production-named Worker's additional build trigger remains unresolved.

Visual rendering, schema import and hosted login remain unverified. CI must verify the additional readiness test and source syntax before reporting them as passed. Main remains the owner's later promotion decision.
