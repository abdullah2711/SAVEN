# SAVEN Architecture Decision Register

11 November 2026 | Proposed decisions for review

## ADR 001 One modular transaction core

Use a modular application and PostgreSQL transaction boundary for accounting and connected subledgers. Shared business commands coordinate effects. This reduces distributed reconciliation work at the start. Modules must own records and expose contracts so later extraction remains possible. Revisit when measured bottlenecks or team structure justify the operating cost of services.

## ADR 002 Shared command authority

Forms APIs integrations and AI use the same permission validation approval and posting services. No AI SQL path is permitted. Approval binds payload and evidence versions. This constrains the model's effect without assuming its interpretation is always correct. Revisit tool coverage as modules grow, preserving the authority boundary.

## ADR 003 Company scope with database defense

Begin with a shared database in bounded tenant cells, explicit company keys and PostgreSQL row security as defense in depth. Runtime users cannot bypass row security. Cross-company and maintenance paths are explicit and tested. A separate database per private deployment is supported. Revisit cell size and high-isolation offerings from measured requirements rather than assumed billion-user load.

## ADR 004 App isolation and one registry

One Apps area governs UI apps connectors and workflow actions. Their execution mechanisms differ: isolated origin UI or isolated workers with scoped APIs. Arbitrary customer code cannot run in the accounting runtime. This limits freedom to protect other customers. Revisit additional extension points only after a threat model and compatibility contract.

## ADR 005 Application owned AI memory

Store permissioned structured facts and summaries with provenance and lifecycle controls. Embeddings are optional derived indexes. Model providers are replaceable through evaluated adapters. Customer information is not automatically reusable across tenants or for model training. Revisit memory retention and regional storage by customer and country requirements.

Revision 1.1 adds an optional company knowledge model beyond chat memory. Link facts and relationships to exact source versions and supporting locations; retain business effective time and observation time. Shared knowledge preserves source sensitivity. Customer and operator controls govern capture and use, while disablement, retention, deletion and reactivation are separate operations. See [Company knowledge and memory](10-company-knowledge-and-memory.md). Historical knowledge and inferred summaries cannot override current authoritative records or published policies.

## ADR 006 Change with historical meaning preserved

Use versioned policies schemas reports and posting rules, with effective dates and expand-migrate-contract migrations. A new release may require core work; it must preserve historical interpretation and have rehearsed recovery. Revisit compatibility windows when real integration support costs are known.

## ADR 007 No automatic financial AI execution initially

Financial AI prepares and submits. A human explicitly executes through configured approvals. Later automatic routines require a separate authority policy and task evidence. This is a recommended launch default for decision D03; the user's vision of broad tool coverage remains intact.

## ADR 008 Recommended stack subject to foundation evidence

Recommend React TypeScript Django PostgreSQL object storage and durable workers. The permanent team and a foundation spike must validate migrations tenant scope decimal arithmetic contracts private packaging and recovery. Exact versions remain implementation decisions. This recommendation is not evidence that a production scaffold exists.

## ADR 009 Cloudflare foundation experiment - 11 November 2026

The owner's new input prefers Cloudflare Workers, database and buckets while preserving a self-hosted path. The first foundation now uses native Worker ES modules, D1-compatible prepared statements and batches, fixed-point BigInt financial calculation, a local Node/SQLite adapter, and a buildless browser workspace. This supersedes ADR 008 as the immediate spike choice, not as an irrevocable production database decision. ADR 003's PostgreSQL row-level security is not available in D1 and has not been claimed. The complete suite still requires a database/capacity/security decision supported by measured evidence. See [foundation implementation](12-foundation.md).

## ADR 010 PostgreSQL restored as the transaction database - 12 November 2026

The owner explicitly confirmed PostgreSQL and authorized installing it on the personal server temporarily. D1 was a foundation activation shortcut and is not the selected MVP database. Keep the command boundary while moving its storage to native PostgreSQL with non-owner runtime privileges, transactional pooled scope, row security and native control triggers. Host the API beside PostgreSQL initially; Cloudflare serves the frontend and reaches only the private HTTP API through a VPC Service/Tunnel. Do not expose PostgreSQL publicly or reuse the server administration password as a database credential. Never fall back to D1 after PostgreSQL failure. The [hosting and migration runbook](13-hosting-postgresql-and-migration.md) governs cutover, responsibility, portability and recovery evidence. This supersedes ADR 009's immediate database choice. Native PostgreSQL tests, migration reconciliation and recovery rehearsal are required; SQLite checks cannot substitute for them.



## ADR 011 Two commercial models and offline companion ? accepted target, 13 November 2026

Cloud and Fully Private only. No SaaS attachment of customer-provided business databases, accounting-firm hosting or reseller fleet. Offline is a restricted synchronized companion. This supersedes conflicting earlier prompts; see docs/27-deployment-models-and-portability.md.

## ADR 012 All-SQLite target with bounded D1 control aggregates ? accepted target

Cloud control identity/commerce/fleet use D1 with owning-domain audit/outbox and explicit cross-domain sagas. Tenant transactions execute locally on SAVEN-controlled SQLite nodes. Private-local uses native SQLite controls; customer-Cloudflare is a disclosed private profile. ADR 010 describes the retained current runtime and correctness reference, not the new target. No live migration is authorized by this ADR.

## ADR 013 Tenant, legal company and authority ? accepted design contract

Default one file per tenant/subscription containing multiple legal companies. Company foreign keys remain mandatory. Atomic intercompany scope is limited to the file. Central user/session/membership/entitlements intersect with local roles/resources/workflows through signed short-lived assertions, epochs and owner generation. SQLite has no PostgreSQL RLS; application predicates and negative tests plus DB invariants replace that defense explicitly. Lease durations require evidence/policy approval.

## ADR 014 Frontend-first and truthful product states ? accepted ordering

Complete product-wide workflow and design library first, with synthetic isolated prototype and owner review. Preserve working financial routes. Requirement mapping, interactive draft, design approval, tested source and verified live operation are separate evidence states. Most missing backend work follows approved contracts; a bounded synthetic storage/reporting spike is allowed for feasibility.

## ADR 015 Fleet, private release and offline compatibility ? accepted contract

Versioned signed manifests, per-file checksums and durable migration cursor, verified backup, canary batches, expand/backfill/contract, fencing, financial postflight and forward recovery. A container rollback does not reverse data. Shared release contracts support private-local without Cloudflare and explicit offline protocol windows. 1k-tenant chaos/private-install gates remain unpassed.

## ADR 016 Reporting and telemetry ownership ? accepted contract

Tenant-local incremental projections commit cursor with effects. Governed JSON report definitions compile to bound allowlisted reads, filter permissions before aggregates and expose freshness. Financial snapshots stay authoritative and reproducible. Financial/security audit, billable usage and sampled operational diagnostics have distinct durability/retention pipelines. No universal zero-RPO, unlimited scale or tamper-proof claim.


## ADR 017 Native SQLite throughout and local-first QA ? v2.3 accepted target

Supersedes ADR012's D1 control target and all PostgreSQL target assumptions. Native SQLite identity/commerce/fleet and tenant files plus local objects/jobs form the current development baseline. Cloudflare/D1/R2 may be future adapters, not required for local operation. Existing PG schema13 remains the preserved correctness reference; no live cutover or decommission authorized.

## ADR 018 Private composition and monthly certificates ? accepted contract

Private customer builds contain business ERP/local identity/admin/support and public-key licence verification, not vendor issuer/global billing/customer registry. Monthly signed renewal supports connected or manual challenge/certificate/receipt transfer. Exact grace/cutoff/seat reassignment terms remain unapproved; preserve historical read/export/recovery and pending evidence. No hidden universal support owner or absolute root-proof claim.

## ADR 019 Protected owner and shared authorization ? accepted contract

Exactly one immutable ultimate_business_admin definition and active holder per subscriber. Index uniqueness alone is insufficient: activation and transfer enforce existence atomically. Arbitrary custom roles are allowed within entitlement/invariants. Central identity and local tenant policy intersect; explicit denial, row predicates and field masks apply before totals/search/export/AI/worker effects. SQLite is not native RLS.

## ADR 020 Durable receipt, approval, posting and outbox ? accepted contract

ACCEPTED_PENDING requires owning-tenant durable command before ACK. AWAITING_APPROVAL has no journal; final review revalidates current authority/period/evidence. POSTED requires source/journal/audit/dedupe/outbox in one local transaction. Follow-on delivery failure does not undo finance. Jobs are orchestration, not authority; bounded leases, idempotency and unknown-outcome reconciliation are required. No cross-file or SQL/object-byte ACID claim.

## ADR021 - UI-first root frontend and SA7EN brand

Adopt the latest owner feedback: muted ivory/charcoal/plum, restrained dark accent and fewer borders. Visible SA7EN brand, pronounced seven; historical identifiers remain stable. Replace old testing UI at root, archive public legacy files as reference, complete UI/UX module by module before backend expansion, split Projects/CRM and retain offline/sync contracts for later implementation.

## ADR022 - customer versus administration origins

Cloud targets app.saven.economicsystems.cc and operator.saven.economicsystems.cc. The latter hosts commercial subscriptions/onboarding/invoicing AND platform operator sections with separate authorization. Fully Private requires configurable separate application/admin origins, local administration/own-licence status only; vendor global billing and issuer are excluded. Host-only independent sessions, origin/audience checks, server permissions and explicit customer support consent are mandatory. Current testing paths are synthetic walkthroughs, not origin security isolation. See contracts/origins-v1.json and docs/39-ui-first-brand-and-origin-revision.md.

## ADR023 - verified native operational release increments

The 14 November request authorizes progression beyond UI-only work and controlled production increments after verification. Native SQLite/control separation and immutable atomic posting remain. Add authenticated Cloud transport, private original storage, stock valuation through the shared kernel, separate app/operator realms and separate commercial/fleet scopes. Preserve the reference PostgreSQL installation until independent parity/cutover. See docs/42-first-operational-release.md; no feature-complete or client-ready claim follows from a candidate deployment.
