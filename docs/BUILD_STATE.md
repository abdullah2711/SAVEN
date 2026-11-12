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

## Testing activation update - 12 November 2026 (Asia/Karachi)

The logged-in Helium session became accessible after the owner selected Cloudflare. Verified the testing Worker builds testing-1, and confirmed it had no database bindings. Created a separate empty D1 database, saven-testing-db, ID 42a1463c-40d9-4f23-9ecb-50265eb07bb1, within the existing free database quota. Ran a read-only console connection/batch query successfully. No pre-existing database was modified.

The execution environment then disconnected, Notepad access approval expired, and browser tools were removed. The database schema import did NOT complete. No hosted user, invitation, session, journal, or customer record has been created. Do not issue a local token as if it were valid on the hosted site.

The source now declares the actual DB binding and centers the ESC logo, SAVEN name, caption and introductory copy on one axis. Added a separate sign-in stylesheet, a health readiness distinction, and an activation-pending state so an uninitialized database does not present a misleading invitation form. The private bootstrap preparer writes schema/fixture SQL plus token hashes and a separate private invitation handoff under ignored var/. It is not called by the Worker and exposes no public bootstrap endpoint.

Resume: restore an execution environment; pull the latest testing-1 source; verify the empty database schema and console state; generate fresh invitations with node scripts/prepare-testing.mjs; import the SQL into THIS testing database; verify all tables/triggers and user membership; confirm /api/health schemaReady; test hosted login, invoice payment variants and stock approval/retry. Do not reuse expired private output files or duplicate an uncertain import. Then hand the owner a fresh hosted invitation. The production-named Worker's additional build trigger remains unresolved.

Visual rendering, schema import and hosted login remain unverified. CI must verify the additional readiness test and source syntax before reporting them as passed. Main remains the owner's later promotion decision.

Deployment evidence: Cloudflare reported a successful saven-testing deployment for 64cc239a020d191eaeba033d4640e66b3818c6f3, including the DB binding and sign-in branding source. The schema is still uninitialized. Activation readiness also covers anonymous startup: a missing cookie returns 401 before touching the database, so readiness must be checked on that path as well. Browser rendering remains unverified; the new GitHub Actions run was still queued at the last inspection.

## Hosted testing activation completed - 12 November 2026

This section supersedes the earlier activation blockers. The owner also signed into Cloudflare in the in-app browser. Used the existing isolated saven-testing-db only. Before import, sqlite_master showed only Cloudflare's internal table. Imported the canonical schema and synthetic fixtures plus hashed single-use invitations through its SQL console. Verified 16 application tables, 18 control triggers, two companies, five users and six memberships.

All 23 local tests, syntax checks and the 239-record planning validator pass against the current source. Hosted browser checks succeeded for preparer sign-in, company switching, the credit/full-receipt/direct-cash accounting variants, invoice submission, stock reservation and the preparer's lack of approval authority. Signed into the independent reviewer and posted the invoice and one stock issue; returned a second two-box issue.

Independent D1 reconciliation: two posted journals, six journal lines, total debits and credits both 275100 minor units, six audit events, one returned request, tissue on-hand 119 and reserved zero. These are synthetic QA-INV-001, QA-ISS-001 and QA-ISS-002 records, retained for the owner to inspect. No customer data was imported.

Browser testing exposed two UI issues now fixed in source: same-page invitation fragments must be consumed on hashchange; and successful submission/review keeps the modal disabled until workspace refresh completes before closing. Posted and returned entries now show state-appropriate accounting captions. Reverify these small changes after the source deployment.

Verified the testing Worker has the two testing-domain aliases (.cc and .com) and its production branch is testing-1. The production-named saven Worker's configured production branch is main. Its extra failed checks did not demonstrate a main promotion; no production configuration, routing or code was changed.

Private owner/preparer/reviewer invitations are generated under ignored var/ and remain unused for the owner's handoff. QA invitations are separate. Do not commit or print raw invitations into this checkpoint. Initial invitations work once and expire after 24 hours; sessions last eight hours. Persistent identity/recovery and operator onboarding remain required release work.

Next: finish the post-deployment UI confirmation and hand off working testing links; then implement full operator onboarding/identity, company setup and opening reconciliation, protected attachments and the remaining catalog. The completed access setup is not the complete commercial product.


## Final hosted confirmation - 12 November 2026

Cloudflare successfully deployed application commit b5b50ba427fcd3295ab6067e5f9b8890f9db06a0. After deployment, a same-page invitation link signed the separate QA owner into the hosted workspace. Confirmed the posted invoice caption now states its effects are posted, and verified light/dark appearance and sidebar collapse/expand. The sign-in logo, wordmark, caption and introductory text share the same center axis, visually checked and confirmed by rendered geometry. The owner workspace remains open with the synthetic reconciliation records for inspection. All user-handoff invitations remain unused.

Latest GitHub Actions was still queued at inspection; the earlier foundation run passed and all 23 current local tests passed. Do not describe the latest remote CI run as passed without checking it. The next implementation work remains operator onboarding/identity, company setup/openings, protected attachments and the remaining catalog. No main or production change was made.

## PostgreSQL correction and MVP continuation - 12 November 2026

The owner rejected the narrow foundation as the agreed MVP, confirmed PostgreSQL, and authorized temporary installation on the personal server through the supplied browser SSH session. Do not relabel this architecture work as a complete MVP. The full catalog remains required.

Installed native PostgreSQL 18 from Ubuntu's official repository. Created isolated saven_testing, noninteractive saven_app OS account and non-owner, non-superuser runtime role using local peer authentication. Existing Nextcloud, ERPNext and Listmonk containers/databases were inspected and not modified. No public PostgreSQL route or database password was created. The host had about 5.2 GiB available memory and 128 GiB free disk at inspection; this is development capacity, not load evidence.

Created the HTTP-only VPC Service saven-testing-api (01a1cd07-8d47-7bc0-a115-f8bf736614a2), through existing healthy esc-server Tunnel, to 127.0.0.1:8788. No entire-network binding is used. The pinned official Node image digest, npm lockfile, native PostgreSQL adapter, explicit migrations, scope policies and control triggers are now in source. The application image built on the server. A persistent tmux session saven-build holds the server work.

Native PostgreSQL contracts passed in separate saven_contract_20261112_a: eight groups covering non-owner/no-scope denial, single-use grants, company isolation across pooled connections, invoice/idempotency/immutable audit, owner self-approval denial and balanced journals, independently competing last-stock commands, locked-period atomic rollback and revoked-session scope. All 25 current local tests and the 239-record validator pass. PostgreSQL native contracts are added to CI; inspect the new remote run rather than assuming its result.

The initial generated PostgreSQL DDL exposed a residual SQLite trigger fragment on its first native execution. ON_ERROR_STOP plus its transaction rolled back all schema changes; verified the database had zero application tables. Corrected the migration before installing the complete schema/controls and running the passing native contracts. The committed PostgreSQL schema is explicit native SQL.

Preserved a private D1 snapshot under ignored var/: all 16 tables, 66 records, including four documents, two posted journals and six journal lines. D1 currently remains the application's active writer until the maintenance deployment is verified. Cutover must pause writes, recheck revisions/auth records or refresh the snapshot, import only into an empty target, verify every field and journal/reservation reconciliation, and then activate the PostgreSQL route without D1 fallback.

The edge source now supports an explicit maintenance window and a PostgreSQL VPC route. Tests prove it preserves command/cookie/idempotency data, replaces forged routing-origin metadata, and never falls back to D1 after an origin failure. The hosting and migration runbook is docs/13-hosting-postgresql-and-migration.md; ADR 010 restores PostgreSQL as the selected transaction database. No main or production update is authorized or performed. Next: finish controlled cutover, dump/restore rehearsal and real company/master/user/operating functionality.

