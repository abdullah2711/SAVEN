# First implementation: commands, accounting and workspace

12 November update: PostgreSQL supersedes D1 as the selected transaction database. This page describes the original limited spike. Current hosting, native database controls and migration procedures are in [the PostgreSQL runbook](13-hosting-postgresql-and-migration.md), with actual execution status in [BUILD_STATE](BUILD_STATE.md). The owner has explicitly required continued construction of the complete agreed MVP.

11 November 2026. Foundation work, not a commercial release. The [additional input](11-additional-input.md) and all original catalog families remain required. [BUILD_STATE](BUILD_STATE.md) is the handoff checkpoint.

## Run locally

Use Node 24.19.0 (Node 24.13 or newer in the 24.x line supports this adapter). No runtime packages are installed.

```sh
node scripts/check.mjs
node --test tests/*.test.mjs
python tools/validate_plan.py
node scripts/server.mjs --demo
```

The demo command provisions synthetic Northstar and Cedar companies and prints short-lived single-use links for a preparer, reviewer, owner, viewer and a separate company's owner. Open the printed 127.0.0.1 address in a local browser. Use the preparer to submit an entry, sign out, then use the reviewer to approve it. Each link expires in 15 minutes. Restart the demo command to obtain new links; persistent synthetic records live in the ignored var directory. A regular start does not seed data or print access tokens.

No sample credentials or shared demo login are deployed. The invitation mechanism is a foundation identity adapter, not the completed operator onboarding/password/MFA system. Redeeming a new invitation replaces that account's prior session. One active server session does not establish physical hardware identity.

The container uses the same Node adapter, with var mounted on durable storage and PUBLIC_ORIGIN set to the external HTTPS origin behind a trusted TLS proxy. Its default localhost HTTP origin is for local evaluation. Container build, proxy setup and restore have not been verified here.

## Implemented paths

| Path | Behaviour and evidence |
| --- | --- |
| Invitation and session | Random 256-bit single-use grants; only SHA-256 hashes stored; HttpOnly Strict cookie; new login replaces old; foundation session tests |
| Company selection | Server derives membership from authenticated user; paused companies hidden; company-scoped queries and composite foreign keys; isolation tests |
| Permissions | Owner/admin/preparer preparation; separate owner/admin/approver review; viewers cannot prepare; customer/item/account denials apply to preview, submit, review and document reads |
| Invoice preview | Credit: receivable/revenue. Full receipt: those lines plus bank-or-cash/receivable. Direct cash: bank-or-cash/revenue. Decimal strings and checked BigInt arithmetic |
| Stock issue | Whole positive units; fixed fixture unit cost; reserve on submission; physical release and expense/inventory journal on approval; rejection releases reservation |
| Approval | Second person required; immutable submitted payload and digest; version check and current authority; transaction-level company revision guard |
| Posting | Document, journal, stock effects, audit, outbox and retry record in one database batch; database balance/period checks and append-only posted lines |
| Safe retry | Company/command/key scope; exact retry returns original result; changed payload or actor conflicts; concurrent last-unit test |
| Workspace | Separate Sales, Purchases, Inventory, Accounting, Approvals, Reports & BI, Planning & Finance, Projects, Drive and Apps; collapse and theme preferences; transaction detail and basic print view |
| Agent boundary | Tool adapter exposes the same preview/submission functions with trusted server context; cannot approve, grant privileges or supply its own actor |
| Resumption | Tracked build state and explicit catalog statuses; CI verifies source, financial/security cases and catalog generation |

Code: src/commands.mjs, src/auth.mjs, src/api.mjs, src/tools.mjs, migrations/0001_foundation.sql. Financial/security tests: tests/foundation.test.mjs and tests/tools.test.mjs. These are synthetic tests with independently stated expected journal amounts; no customer records were imported.

All mutations use same-origin JSON requests. The API streams and bounds bodies, derives user identity from sessions, avoids SQL interpolation, and returns private no-store responses. Static responses include CSP, clickjacking, content-type and referrer protections. The request error logger records a correlation reference and category without documents, SQL errors or credentials.

## Adapter decision

The earlier React/Django/PostgreSQL stack was a proposal. The owner's preference for Cloudflare motivates a dependency-free Worker ES-module foundation and D1-compatible prepared/batched statements, paired with a local Node SQLite adapter. This is an explicit foundation experiment, not a finding that D1 replaces PostgreSQL for the complete suite.

SQLite/D1 does not provide PostgreSQL row-level security or equivalent database roles. Application scope, composite foreign keys and command guard triggers are implemented, but a privileged database credential remains powerful. Production database selection, tenant cells, capacity, backup/restore, migration checks and independent isolation review remain open. A PostgreSQL adapter must reproduce the same contracts if selected; it has not been implemented.

Cloudflare documents batch statements as sequential SQL transactions that roll back on failure. The local adapter uses BEGIN IMMEDIATE and the same schema. The tests prove local SQLite behaviour; a D1/workerd run is still required before claiming platform or concurrency equivalence. Relevant vendor references:

- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

## Cloudflare setup and release safeguards

wrangler.jsonc targets **saven-testing** only. The Worker uses static assets from public and a D1 binding named DB. No production ID, secret or invented database ID is committed. The build guard rejects another CI branch for this iteration. Cloudflare's Worker-name matching provides an additional target check; actual dashboard mapping has not been verified.

External setup still required before using financial functions on the testing domain:

1. Confirm the saven-testing Worker builds only testing-1 and the production Worker builds main.
2. Bind a separate testing database as DB, apply migrations/0001_foundation.sql with the vendor migration mechanism, and verify the complete schema.
3. Provision test companies/users and single-use invitations through a controlled operator procedure. The deployed Worker deliberately has no public bootstrap or seed endpoint.
4. Run the Worker/D1 contract tests, authorized browser journeys and recovery checks against that environment.

Without DB, the static sign-in surface can load but financial endpoints return SETUP_REQUIRED. This is fail-closed behaviour, not a completed live environment. No production deployment, binding, database creation, billing change or main promotion is part of the first implementation.

## Verification and remaining work

Local financial/security tests pass; the final check count and CI/deployment results are recorded in BUILD_STATE. Browser verification was blocked by in-app navigation timeouts and an expired desktop-app approval request. Light/dark layout, refraction, mobile, keyboard and print rendering are therefore **unverified**, even though syntax and server tests pass. No load-test, usability, penetration-test or accessibility compliance claim is made.

The initial business scope is deliberately exact: PKR only; non-taxable service invoices; full-receipt choices; whole-unit stock issues from synthetic fixed-cost inventory; approvals always required; immutable postings; latest 100 visible documents. It does not yet implement opening-balance reconciliation, partial receipts, taxes, valuation layers, corrections, period-administration UI, attachments, notification delivery, MFA, customer onboarding, offline operation, or the other catalog modules. Empty module pages identify their planned status. No provider AI is connected.

The next implementation extends controlled operator provisioning and identity, followed by company setup/opening balances and evidence attachments, then supplier bills/tax configuration and stock costing. Runtime/model integration must use the shared command boundary rather than create another posting path. Full commercial scope remains governed by the catalog and release gates.
