# v2.3 reconciliation and first implementation gates

Governing order: newest explicit owner direction; [consolidated v2.3](sources/SAVEN-mandate-v2.3.md) and its [handoff](sources/SAVEN-agent-handoff-v2.3.md); full [v2 baseline](sources/SAVEN-mandate-v2.md) for remaining product scope. Both attachments and all802lines of the baseline were read. Earlier v2.1/v2.2/v2.2.1 prompts are historical, not additional active deployment modes.

## Fresh evidence before code changes

Inspected testing-1 at82efa086de75d1fd7788e6c1a2c32235eddd2b55. Baseline71tests and98JavaScript parses passed,251requirements validated. Public health and read-only SSH inspection independently confirm PostgreSQL schema13; source schema14 remains unactivated. Existing API/antivirus and backup timer are running. Shared-host ERPNext, Nextcloud and Listmonk services were observed and left untouched. No server deployment, backup mutation, live posting, new tunnel/DNS, main or production change is part of this inspection.

## Supersession matrix

| Previous active assumption | v2.3 decision | Implementation boundary |
| --- | --- | --- |
| Cloud controls require D1 | Native SQLite for identity, commerce, fleet and tenant stores | No new D1 work; keep old working routes as reference |
| Private includes operator/commercial services | Private gets local business admin and public-key verifier only | Build/package allowlist and runtime authority; no vendor issuer/billing/customer directory |
| Local-first means localhost-only product | Local development/QA default; authorized authenticated tunnels optional | No public exposure or route changes implied by local boot |
| Generic immutable owner label | One protected role definition and exactly one active principal per subscriber | Unique index plus activation/transfer existence checks; custom name cannot confer ownership |
| Generic queued success | Durable pending/approval/inbox versus atomic posted versus post-commit outbox | Commit before ACCEPTED_PENDING or POSTED; retries retain operation ID |
| Annual/unspecified private renewal | Monthly signed entitlement, offline challenge/import/receipt | No invented grace days or calendar cutoff; preserve historical access |
| Apps could wait or lose scope in SQLite port | APP-001–APP-010 remain mandatory | Versioned typed APIs, scoped manifest/storage, durable webhook and lifecycle contracts |
| Shared KPI cards count as module UX | Distinct accounting/tax/multi-line/Apps/admin flows; consistent SVGs | Synthetic label and owner review retained; no false live write |

## Local native-SQLite boundary

Local development profile owns identity.sqlite, commerce.sqlite, fleet.sqlite, jobs.sqlite and one generated tenant file per subscribed business. Tenant file may contain several legal companies and owns business roles, resource/field rules, periods, command inbox/approvals, journals, financial audit and outbox. Object bytes reside separately under a protected local store. No user-supplied path or ATTACH/SQL endpoint is accepted. Cross-file provisioning must be a durable idempotent saga, not ACID across files. The bounded proof records intent and quarantines failure; automatic saga resumption remains pending.

The initial bounded foundation proves journal preparation/posting and durable acceptance with synthetic identities only. It is not full PostgreSQL financial parity, a private production installer, encrypted offline client, complete SaaS service or replacement of the running schema13 API. All remaining Payments, invoices/tax, stock/manufacturing, asset, files and report contracts remain required.

## Immediate tasks and acceptance

1. Record supersession, preserve all IDs and APP commitments, update authoritative sources/ADRs/checkpoints.
2. Prioritize readable accounting/ledger/tax/multi-line design and distinct Apps/role/licence/support interactions; no approval inferred.
3. Build bounded native local boot, reusable policy/owner constraints, exact journal and pending/inbox/outbox commits, local storage and snapshot/restore. Tests must prove denial, retry/crash, no half journal, changed authority and no duplicate effects.
4. Demonstrate asymmetric monthly certificate verification, installation binding, sequence, offline challenge and signed acceptance. Vendor issuer remains a separate composition. Expiry policy is explicitly unresolved; no grace value is invented.
5. Run the retained PG regressions independently. Any later live cutover requires full parity, independent restore, reconciliation and explicit authorization. Destructive decommissioning requires separate approval and exact targets.

Open decisions: grace/cutoff/emergency terms; seat reassignment policy; legal-company/offline limits; support consent; RPO/RTO and capacity; actual owner design approval. No universal root-proof licensing or immediate air-gap revocation claim is permitted.
