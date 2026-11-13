# SAVEN — Consolidated Final Owner Mandate v2.3

**Date:** 13 November 2026 (Asia/Karachi)  
**Repository:** `abdullah2711/SAVEN`; work only on `testing-1` unless newly authorized.  
**Status:** Binding owner direction for engineering design and implementation, **not** evidence of completed functionality or authority for destructive migration.  
**Source consolidation:** Incorporates the owner's uploaded v2.1 licensing/UI mandate, v2.2 SQLite-local-first direction, v2.2.1 SQLite authorization/queue clarifications and the specific follow-up requirement to preserve custom Apps and integrations. Those earlier addenda are now **superseded as agent handoff documents**. This mandate is the single active addendum.

**Primary baseline:** The full v2.0 mandate already in the repository at `docs/sources/SAVEN-mandate-v2.md` remains mandatory for all product scope not explicitly superseded here. The owner should send this consolidated v2.3 addendum and its accompanying single handoff prompt, **not the six older overlapping addenda/prompts**. Newest later explicit owner feedback takes precedence after careful reconciliation. Older PostgreSQL and Cloudflare D1 technology decisions are historical implementation references, not the current target.

---

## 1. Non-negotiable decisions

1. **Exactly two commercial deployment models:** (i) SAVEN-operated Cloud/SaaS, and (ii) complete customer-controlled Fully Private. No hybrid SaaS application pointing to a customer-hosted business data node, no accounting-firm/reseller database hosting. The restricted offline operating companion remains a feature of either model, not a third model.
2. **Native SQLite is now the only selected database engine for the next implementation baseline**, including central permanent/control stores and per-tenant/subscriber business stores. **Cloudflare D1 and PostgreSQL are not target dependencies.** D1, other managed SQL services and Cloudflare Workers may be assessed later, behind tested adapters; do not require them to build, test or privately install SAVEN now.
3. **Local-first means development, integration testing and repeatable QA are local by default, NOT that SAVEN is local-only or must be accessed only from localhost.** Develop the frontend, backend, central control services, tenant service, test fixtures, object-storage substitute, local jobs, licensing and diagnostics on the AI agent's authorized development machine or an owner-approved local server. A protected, owner-approved tunnel may publish the test frontend / authenticated testing API to other devices and operating systems for UI acceptance, provided the SQLite files remain on locally attached storage and the tunnel does not expose raw SQL, privileged service interfaces or a public unrestricted test administrator. The planned cloud and private deployment models remain intact. Source, migrations, manifests, documentation and tests synchronize to GitHub `testing-1`. Do **not** commit database files, credentials, secrets, customer records, private licence-signing keys, raw backups or logs containing secrets.
4. **Frontend-first owner review remains the product-development priority.** Improve the current `/design/` workspace in the agreed warm-neutral/charcoal/plum design language, complete the realistic interactive design of each module (accounting and tax first), and do not mistake prototypes for backend features. A bounded SQLite foundation and compatibility spike may proceed in parallel only when it preserves working reference behavior and does not displace the design priority.
5. **Exactly one active ultimate business administrator per subscribed business.** One non-removable, non-renameable, protected role definition, held by one active principal at a time. The business may create unlimited *types* of custom roles (subject to product package and safety restrictions), name them freely, and set granular module, action, record, field, amount, branch, company, approval and AI-tool permissions. The ultimate owner cannot be cloned by creating a similarly named custom role. Owner transfer and recovery require explicit verified workflows.
6. **Monthly signed private licence renewal.** One-month certificate/entitlement validity is the requested commercial default, including for connected and air-gapped installations. No compulsory connection to SAVEN cloud is required to operate a properly licensed private installation; signed certificate transfer and signed acknowledgement must work offline. Grace period, emergency extension, termination rights, clock rollback controls and support/upgrade policies require a documented explicit policy proposal; never invent an approved number of grace days.
7. **Private package excludes SAVEN global commercial operator services.** It includes private business administration, local identity, local licence verification, accounting/ERP engine and private infrastructure tools. Licence signing keys and global subscription/charging/customer registry remain exclusively with SAVEN. The same underlying ERP modules, security contracts, UI design system and schema logic serve both models.
8. **No destructive removal of existing PostgreSQL data, volumes, working deployments, or unrelated server services as an immediate shortcut.** The owner directs PostgreSQL retirement from the target stack, not financial data destruction. Inventory, migrate, reconcile, verify backups and rollback/recovery, obtain explicit authorization for destructive service decommissioning, and only then remove abandoned SAVEN-specific dependencies. Do not touch `main`, production, unrelated server databases or infrastructure without separately explicit permission.

## 2. Target logical architecture — native SQLite throughout

### 2.1 SAVEN Cloud (initially built and tested entirely locally)

```text
SAVEN hosted frontend / gateway (local deployment at this stage)
  -> Central control services and authorization
      -> SQLite identity & membership domain
      -> SQLite commerce, applications, subscriptions & entitlement domain
      -> SQLite tenant fleet, nodes, migration & placement domain
      -> optional separate SQLite metering/audit-coordination domains only when justified
  -> Business command router (never expose SQL/file handles)
      -> SAVEN-owned node process beside tenant SQLite files
          -> One SQLite file per subscribed business (may contain multiple legal companies)
  -> Durable jobs, local object storage and separately retained audit/telemetry
```

A control domain owns its transactions, idempotency ledger and outbox atomically. Do not split an operation across files and pretend it is an ACID transaction. Activation and provisioning use explicit durable state transitions, retry/reconciliation and idempotency. Purpose-separated central SQLite files should be based on transaction and recovery boundaries, not arbitrary fragmentation. Native SQLite's one-writer-per-file property, busy-timeouts, checkpointing and WAL monitoring must be engineered and benchmarked.

### 2.2 Fully Private

```text
Customer-managed SAVEN frontend, API, admin, ERP commands and local identity
  -> Local native SQLite control-store implementation
  -> Tenant/company SQLite business data (typically one subscriber file)
  -> Local object store, workers, backup and support desk
  -> Local signed licence verifier + licensed-seat enforcement
         (no SAVEN issuer, billing portal or global fleet/customer registry)
```

Private deployment may be network-connected, local-network-only or air-gapped with no change in commercial product. A private instance can contain multiple legal entities where licensed; do not assume all private installations have one legal company. Ordinary financial operations may not depend on continuous contact with SAVEN's central platform.

### 2.3 Shared product boundary

Define stable entitlement, identity, permission, business-command, storage, migration, event, report and support interfaces. Only their deployment-specific providers differ. Provide reproducible local development profiles and future cloud/private installers from one release family. Cloudflare Workers cannot directly open arbitrary native SQLite files on the agent's/server's filesystem; future Cloudflare frontends/gateways must call supported authenticated API services hosted beside database files. Native SQLite files remain on local reliable disk, not shared network mounts. Use API-level routing to move between nodes.

### 2.4 Object storage and operations

Build an object-store interface and local-first storage profile now. Preserve support for future S3-compatible storage and Cloudflare R2 by provider adapters and operator-configured profiles, but do not make either cloud service mandatory to develop locally. A SaaS operator console should eventually configure approved node pools, storage profiles/buckets, secrets references, customer groups, plan/policy cohorts, entitlements, migration waves, backup destinations and capacity without editing source. Such controls orchestrate verified workflows and cannot bypass financial or security restrictions.

High-volume diagnostics and telemetry must not write every event to a scarce high-contention central file. Keep immutable financial audit with its owning transaction; durable security/operator/licence audit with appropriate outbox; billable AI events with reconciled reservations; noncritical logs in bounded redacted files/queues/rotated archives. Never discard evidence needed for accountability simply to save storage.

### 2.5 Local testing, remote device previews and secure tunnels — clarification

- **Build, execute and verify locally by default; preview and test remotely when useful.** A development machine may expose an HTTPS test URL through an authorized Cloudflare Tunnel or comparable reverse proxy. This is a QA access arrangement, not a business architecture restriction or authorization to activate production.
- The frontend, backend and local SQLite databases may remain on the development machine while phones, desktops, tablets and owner reviewers access the test UI through an authenticated tunnel. Do not force the agent to use SSH for development when the environment is local.
- Tunnel access must use an authenticated gate where practicable, TLS, restricted ingress, environment separation, test identities, rate limits, CSRF protections where applicable and access logging. Do not expose SQLite files, debug consoles, unprotected operator functions, unrestricted API routes or source secrets. Do not depend on a permanent tunnel for local test success; localhost tests must continue to run without it.
- No public URL, DNS change, tunnel route, production deployment or port-forwarding to a shared server may be created without owner authorization. Explicitly record whether a result is from source, local tests, tunneled QA, hosted test or production.

## 3. Protected ultimate business owner and freely configurable roles

- Each **subscribed business/tenant** has a globally unique business ID and exactly one protected ultimate owner identity at all times after activation. Multiple legal companies beneath the subscriber retain company-scoped administration and permissions, but may not duplicate or bypass the subscriber ultimate owner.
- The `ultimate_business_admin` system role/authority is immutable, non-deletable, non-delegable by ordinary roles, and cannot be changed or hidden by renaming; only one active holder. Changing the actual owner requires an atomic ownership-transfer protocol with both identity checks and auditable approvals. Suspended owner/account recovery uses a strictly defined exceptional process; never fall back to a secret vendor superuser.
- The owner can construct customer-specific roles, e.g. an accountant in one customer has payroll access and in another only bank reconciliation. Each role can express allow/deny for modules, records, actions, resources, reports, exports, AI tools, projects, cost centres, branches, conditions, amounts, posting versus preparation, approval tiers, attendance-only HR, sensitive fields and data retention. Explicit deny takes priority as defined by the policy compiler.
- Custom role authority is bounded by paid entitlements, company membership and protected system invariants. A role named `Owner` is not the protected ultimate owner. Permission denial must apply to APIs, queries, BI, search, exports, AI execution, background jobs and document previews; UI hiding alone is insufficient.
- SaaS global user identities and tenant memberships belong to central identity; tenant/company-specific grants and business policy belong to the relevant tenant SQLite database. Private local identity belongs to the private control store; private business grants belong to local tenant SQLite. Enforce both central/local entitlements and tenant policy through a shared command authorization engine. Token/epoch revocation and stale claims require conformance tests.
- Ultimate owner may administer permitted roles and users up to licensed seat limits, subject to explicit protections for the owner role itself. Separate business owner authority from server/root administrator and from SAVEN commercial operators.

### 3.1 SQLite-compatible RLS-equivalent authorization: ownership, storage and enforcement

**SQLite has no built-in PostgreSQL RLS policies.** SAVEN must reproduce the externally visible access constraints through a centrally maintained, fail-closed **authorization and scoped-query service**; ordinary users and integrations must never connect to the business SQLite file directly. SQLite's connection authorizer, views and constraints are defense-in-depth tools, not a substitute for complete row-level business authorization. A filesystem/root administrator can bypass app-level protections; private deployment documentation must state that limitation.

**Authority sources and storage locations**

| Authority | SaaS storage | Private storage | Who can change it? |
| --- | --- | --- | --- |
| Global identity, credential hashes, MFA/session state, subscription-to-user membership and session revocation epoch | SAVEN central **identity SQLite** | Installation **local identity SQLite** | Authenticated user for own credentials; delegated identity administrators; high-risk changes audited |
| Subscription, paid module entitlement, licensed seat ceilings, commercial suspension, AI commercial limits | SAVEN **commerce/control SQLite** | Verified SAVEN-signed licence cached in private control store; private local seat assignments | SAVEN licence issuer; private local administrators only allocate within valid entitlement |
| Tenant placement, node ownership/generation and migration state | SAVEN central **fleet SQLite** | Installation registry/local control SQLite | SAVEN operator/approved infrastructure admin |
| Business/company/branch, custom role definitions, scoped grants and denies, record/field/amount conditions, approval flows, document/AI permissions, role-assignment history and ultimate-owner identity linkage | Owning **tenant SQLite business file** | Owning **private tenant SQLite business file** | Protected ultimate business admin / properly delegated business admins, bounded by entitlements and non-delegable invariants |
| Operator assistance and support grants | Audited central support case + scoped tenant-side delegation/acceptance | Customer-authorized local grant; optional exported case evidence | Customer approver and authenticated named support staff within explicit case/time/scope |
| Audit of changes | Atomic local audit/outbox with the affected control or tenant transaction; external sealed retention | Same local rule plus optional independent archive | Application only; never ordinary user-controlled editing |

**One enforcement path for all access types:** authenticate session or verified service identity -> resolve installation/tenant/company membership and active licence -> verify revocation/authorization epochs -> resolve business roles and explicit deny -> evaluate resource/action/field/amount/branch/approval conditions -> compile mandatory row predicates and masked field projections -> use parameterized SQL in a confined per-tenant database connection -> log sensitive decision/changes and commit transaction. The backend must never accept browser-provided role, company, unrestricted SQL fragment or node location as an authority source. Use a single policy compiler for UI/API, integration, AI tools, searches, aggregates, exports, documents, BI, reports and workers; every execution path must be covered.

**Examples:** a user may view bank payments only for their assigned branch; an accountant may prepare journal drafts but only post amounts below a configured threshold; an attendance-only HR user cannot read wages; AI cannot invoke a tool hidden from its requesting user. Search-hit counts, totals and BI groups must not leak denied records. Secure page navigation and query plans may cache an authorization decision only with explicit short-lived policy version/epoch invalidation; high-risk writes re-check authorization inside or immediately before their owning transaction.

**Database defense in depth:** enable and verify `PRAGMA foreign_keys=ON` on EVERY connection before transactions; use CHECK/UNIQUE/FOREIGN KEY constraints, mandatory tenant/company foreign keys inside each file, protected financial triggers and immutable posted-source rules. Prepare statements with bound parameters. Restrict database file/directory ownership to the service account, prohibit tenant database attachment through user input, and prevent raw SQL endpoints. Assign the SQLite file exclusively to its designated node/generation; configure durable audit and outbox. Deny by default. A policy UI setting is never the enforcement point.

**Ultimate owner correctness:** one protected role definition per tenant and **exactly one active ultimate-owner principal** after activation; uniqueness can be enforced by a partial unique index, but existence and atomic replacement must also be checked by the ownership-transfer transaction and recovery tests. Renaming another custom role to 'ultimate owner' grants no protected authority. Support roles may not silently override protected customer permissions; attributable emergency access requires strict independent procedures.

**Cross-file identity checks:** where central identity/control and tenant business permissions are in different SQLite files, no pretend cross-file ACID transaction. Issue versioned, short-lived signed assertions or equivalent securely authenticated internal claims; check issuer, expiry, audience, installation, business, company, actor, entitlement and policy epoch at the tenant node. Revocation and policy changes must define an explicit bounded stale-claim window and fail closed for sensitive administrative actions; do not promise instant offline revocation. Implement tests for stale tokens, forged tenant/company, IDOR, SQL injection, role escalation, BI totals, CSV export, background execution and support grants.

## 4. Monthly private certificates and anti-piracy realism

1. SAVEN retains exclusive licence-signing private keys; supported private installations embed only a public verifier and verified issuer-key-rotation policy.
2. Each signed licence binds installation ID, subscriber ID, package/edition, maximum active ERP seats, named AI seat conditions, licensed legal-company limits, modules/features, validity start/end (one monthly renewal period), grace/recovery policy, sequence/issue version and allowed software-version constraints.
3. Licensee can inspect entitlement details; confidentiality is optional. The digital signature, not obscurity or encryption alone, prevents forging higher seat counts or later expiry.
4. Private administrator creates/manages employee identities, emails, passwords and custom roles locally. SAVEN is not required to store private employee details or passwords. Count **active licensed assignments**, distinguishing unassigned invited, suspended and disabled accounts, with clear anti-seat-rotation policy for named AI users.
5. Support air-gapped request/import/verification/acknowledgement: installation creates signed challenge; SAVEN returns signed monthly entitlement; installation verifies and stores securely; it creates a signed acceptance receipt to be returned online or manually. Receipt is useful evidence, **not** proof of continued, unmodified use or permanent non-piracy.
6. Do not invent reliable instantaneous revocation, secrecy from a root administrator, an irremovable licence check, perfect clock rollback defense or guaranteed proof of non-use after termination. Consider supported hardware-backed protection only after portability/recovery implications are tested. Contracts and audit terms are part of enforcement.
7. An expired certificate can restrict **new licensed operations** after agreed grace; never delete financial records or silently discard pending offline entries. Maintain historical read-only access, authorized exports and recovery consistent with customer obligations and the signed agreement.
8. Include connected, air-gapped, virtual-machine snapshot, time rollback, expired/new certificate, double activation, offline renewal, lost machine, reinstatement and disconnected customer-support cases in acceptance tests.

## 5. Development workflow and safe PostgreSQL retirement

### Stage A: inspect and freeze

- Reopen `AGENTS.md`, `docs/BUILD_STATE.md`, `docs/sources/SAVEN-mandate-v2.md`, this consolidated v2.3 addendum, feature catalog, design screen inventory, active migrations, native tests and deployment scripts on current `testing-1` head.
- Inventory every SAVEN-specific PostgreSQL dependency: schema/table/trigger/policy/function, driver/config, backup, migration, CI job, Node API, SQL fixture, finance assertion and deployed service. Distinguish them from unrelated databases/services on the same physical host.
- Create a verified backup and restore plan, source checkpoint and unique migration identifier before modifying live financial data or deployment topology. Retain a reference copy of the original PG contracts and expected fixtures until parity is demonstrated.

### Stage B: build SQLite foundation locally, in parallel with frontend refinement

- Configure local development using pinned toolchain, native SQLite control files and a synthetic tenant SQLite file; reproducible start/stop/reset scripts and dev-only seeded data; working API and UI; local object storage; no SSH, external D1 or PostgreSQL required for everyday development.
- Use SQLite WAL, `foreign_keys=ON` verified on each connection, appropriate transaction isolation, bounded one-writer coordination per file, parameterized statements, prepared queries and a central authorization/predicate library. Use exact minor-unit/decimal-safe accounting; do not trust floating-point currency calculations. Ensure constraints, immutability and domain checks preserve finance correctness.
- Implement central identity, commerce, fleet and tenant provisioning as coherent native-SQLite domains. Test cross-domain durable outbox and idempotent workflows. Run node-side single-command posting; never remote-open SQLite files over SMB/NFS/network mount.
- Continue detailed UI/UX prototype work before adding unapproved functional breadth. Prefer owner-approved realistic invoices, credit notes, chart of accounts, GL/notes, stock costing, manufacturing/WIP, POS, tax/withholding and role-builder experiences.

### Stage C: independent functional parity

- Port PostgreSQL-backed business commands to the shared native-SQLite command core without dropping existing rules. SQL syntax, RLS, numeric handling, triggers, concurrency and foreign keys require deliberate redesign; do not mechanically replace driver names.
- Reproduce original test fixtures and independently compare balanced postings, immutable adjustments, periods, assets, payments, invoice/tax effects, company isolation, role restrictions, evidence, reports and exact rounding. Add SQL injection/IDOR, concurrency, crash, double-post, replay and cross-company access tests.
- Compare source and reference output via durable checksums and exact journal/subledger reconciliations. No feature is marked migrated until tests and representative restored-data flows pass.

### Stage D: cutover and decommission, with explicit owner authorization

- First demonstrate new SQLite-only local installation and a full independently restored backup. Stop relying on PostgreSQL in **new code** immediately; retain the running old reference path until a reviewed migration/cutover plan is approved.
- Only after the SQLite target passes tests, integrity/backup restores and authorized cutover should the agent remove obsolete **SAVEN-specific** PostgreSQL app dependency, scripts/containers and CI references. Leave required reference tests/history documented or archived. Never run broad service-deletion commands affecting unrelated users/databases on shared infrastructure.
- Do not erase PostgreSQL volumes/databases, force a production migration, touch `main`, rotate shared secrets or modify live financial data merely because the owner requested future SQLite-only architecture. Ask for explicit approval before irreversible deletion and document exact targets and backup evidence.

### Stage E: future deployment

- When the owner nominates a separate test server, deploy the same release package from its reproducible local/CI artifact, not a hand-configured fork. Avoid depending on long-lived SSH sessions or server-side editing. Use noninteractive idempotent setup, restartable/resumable installation stages and written checkpoints. If SSH disconnects at roughly 60 minutes, no state should be lost; build and test locally, publish source to `testing-1`, and use short verified remote deployment commands when authorized.
- Server deployment only after the owner supplies the authorized target. No invented address, credentials, or assumption that the agent's local filesystem is durable. Detect ephemeral workspaces, ensure source is pushed and state is backed up before session termination.
- Keep Cloudflare Workers, D1, R2 and customer Cloudflare accounts out of the critical path for current local developer operation. Later evaluate Cloudflare frontend and other adapters based on measured requirements. No D1 migration/reimplementation is authorized at this phase.

## 6. Continuous enhancement, fleet migrations, BI and recovery remain mandatory

- Fleet migrations: a signed/versioned manifest per schema change, independent per-tenant ledger/cursor, backups before invasive changes, canary -> pilot -> bounded waves, pre/post financial reconciliation, backward compatibility windows for offline clients and one writable owner/fenced node placement. Recovery after post-upgrade writes generally requires forward repair, not restoring an old image.
- BI in SQLite: derived typed read models, event-driven durable projection cursor, summary tables indexed by period/company/branch/dimension, permission-safe report compiler, exact source drill-down, backdated correction handling, freshness markers, background heavy report jobs and reconciliation to GL and subledgers. Prove representative 5 million journal-line workload and concurrency under real CPU/disk constraints before making performance claims.
- Data safety: database snapshot through SQLite backup API/`VACUUM INTO` as appropriate, object manifest and key handling, off-machine encrypted retention, tested restore and RPO/RTO tiers; do not simply `cp` a live SQLite DB while WAL is active. No database file or customer backup in GitHub.
- Security: layered entitlement + membership + local resource permission + command-specific guards, prompt-injection-resistant AI tool execution, parameterized SQL, file access confinement, rate limits, user privacy, secrets protection, least-privileged workers and tests for every denial across UI/search/API/export/BI/background jobs.
- Changes in module functionality may add migrations and business rules, but must not require rewriting the entire kernel; maintain bounded context commands, versioned interfaces, feature toggles preserving historical data and cross-version test matrices.

### 6.1 Durable queues, approvals, outbox and offline synchronization — exact storage contract

The system must distinguish **(a) a request saved as pending**, **(b) a canonical transaction posted to ledgers**, and **(c) an asynchronous event waiting for follow-on work**. All three may be persisted in SQLite but they have different authority and UI states. The word 'queued' must not be used to imply an accounting entry has already posted.

| Queue/use case | Durable location BEFORE completion | What finally happens? |
| --- | --- | --- |
| Normal authorized synchronous journal/invoice/payment/stock posting | No preliminary asynchronous queue required; execute the authoritative local transaction beside its tenant SQLite database | Journal + affected subledgers + immutable audit + outbox committed **atomically**; only then return POSTED |
| Approval-required transaction | `pending_commands`/`approval_requests` and versioned payload/evidence hashes **inside the owning tenant SQLite** | Authorized approval triggers re-evaluation and **one** atomic business posting; approval never posts blindly from stale data |
| Accepted asynchronous business command / retry after accepted submission | Durable `command_inbox` in owning tenant SQLite (or an explicitly designed, reconciled durable staging boundary), containing command UUID, actor, tenant, payload digest, state, policy/version, attempts and receipt | Worker claims it, verifies current rules, commits posting once using idempotency key, moves state to POSTED or REJECTED_WITH_REASON |
| Business event after posting (BI, notification, integration, search index) | `outbox_events` inserted **in the same SQLite transaction** as the authoritative business write; derived projection cursor stored durably | Worker processes at least once; consumers deduplicate; failed downstream work does **not** undo already-posted journal |
| Central subscriber activation/billing/node provisioning | Durable job/saga and outbox in the owning central identity/commerce/fleet SQLite file | Resume/reconcile each step; no cross-file ACID claim |
| Routine operational jobs (exports, email, report rendering, maintenance) | Separate SQLite `jobs.db` for worker orchestration where appropriate; **only after a durable source outbox/command record exists** | Lease/heartbeat/retry/dead-letter; distinguish jobs queue availability from financial authority |
| Offline companion operations before server acknowledgment | Encrypted device-local SQLite operation journal, including stable UUID, sequence, version, evidence hashes and sync cursor | Sync inbox deduplicates; server rechecks authoritative policy and acknowledges canonical status; late/lost ACK never causes duplicate posting |
| Telemetry and diagnostic logs | Redacted bounded local append-only spool/files or purpose-specific operational store | Rotated/compressed retained logs; never drop required financial, entitlement or security audit |

**Non-negotiable commit and acknowledgement order:**

1. Incoming request receives stable idempotency/operation identifier and complete source context. Check authentication and whether queueing is allowed for that workflow.
2. If accepting for later processing, persist complete immutable command/payload reference, owner and state to **durable local SQLite** and commit with suitable durability settings BEFORE returning `ACCEPTED_PENDING`. Memory-only queues and browser local state cannot be the sole durable record for an accepted server transaction.
3. If posting immediately, begin a local tenant transaction; re-evaluate membership/role/entitlement, approval/period/financial invariants and idempotency; write exact journal/subledger/source/audit/outbox effects; commit; only then return `POSTED` with immutable reference.
4. Workers claim bounded batches through atomic state transitions/leases (including expiry, heartbeat and worker identity), retry idempotently with backoff, and move poison events into an observable dead-letter/exception queue. A duplicate retry must not duplicate a journal, invoice, stock movement, email or usage charge.
5. If network/server is unavailable, do not claim success unless a permitted durable local/offline staging path has acknowledged the operation. An unavailable central gateway does not become an invisible queue for unauthorized financial postings. Distinguish `NOT_RECEIVED`, `ACCEPTED_PENDING`, `AWAITING_APPROVAL`, `POSTED`, `REJECTED`, `CONFLICT` and `DELIVERY_FAILED` in UI and API.
6. Object files use staged upload/hash verification, then transactional metadata and outbox state with cleanup/reconciliation. Do not claim object-file bytes and SQLite rows committed as one ACID transaction.

**Durability / location:** `PRAGMA journal_mode=WAL` on reliable local disks for supported profiles; `PRAGMA synchronous=FULL` for financial/accepted-command commits unless verified contrary durability policy; `PRAGMA foreign_keys=ON` on each connection; bounded busy timeouts, one coordinated writer per tenant DB, periodic checkpoint monitoring, verified backups that include WAL-consistent state. Separate service node owns each writable tenant file; do not put WAL-backed DB on a network-mounted filesystem. `FULL` does not replace replicated/off-node backup or guarantee survival of whole-machine loss.

**Verification:** crash before queue commit (no accepted receipt); crash after accepted receipt/before processing (replay and complete once); crash after ledger commit/before HTTP ACK (idempotent canonical lookup); worker crash during job; out-of-order/repeated offline upload; approval policy changed while queued; expired licence before deferred posting; storage full; stale worker lease; lost outbox publisher; delayed BI projection; 1,000 tenant files and read/write contention. Report queue depth, oldest age, latency, dead-letter count, retries and projection freshness per installation/tenant without exposing data between customers.

## 7. Consolidated commercial administration, licence protocol, Apps, support and UI detail

This section carries forward the specific *non-conflicting* private licensing, anti-tamper, operator-support and UI engineering requirements from the prior v2.1 addendum, incorporates the owner's subsequent decisions, and adds an explicit acceptance contract for custom Apps/modules/integrations (APP-001–APP-010). Where these detailed provisions mention future platform options, **native SQLite remains the sole approved current database engine**.

### 7.1 One ERP product, two separately packaged deployment profiles

- Build a **modular monolith with versioned contracts** for ordinary ERP business modules. Keep one source repository, accounting/stock/approval/permission core, UI component design system, compatible schema definitions and migration framework. Components may be deployed in different package compositions, but do not fork the business engine.
- SAVEN Cloud ships SaaS services: marketing-to-application onboarding, vendor/operator console, global subscriber billing, licence issuer, cloud identity, commercial entitlement service, SaaS-wide node fleet, support coordination, and SAVEN-operated business services/databases.
- SAVEN Fully Private ships the complete *customer-facing* ERP UI/API, local identity and MFA, local business administration, protected ultimate-business-owner governance, all licensed modules, local SQLite control and business stores, installer/updater, object storage, worker/queue, reports, offline-client compatibility, permitted AI provider adapters, support desk and **public-key licence verifier**. It must **not** ship the global SAVEN commercial console, other subscribers' directory, central billing ledger, fleet-wide administrative secrets, SAVEN signing private key, vendor user accounts or master impersonation credentials.
- This separation must be enforced by build/package composition and runtime API authorization; merely hiding vendor menus or checking `deployment=private` in browser JavaScript is insufficient.
- Commercial entitlement interface should be implementation-agnostic. The cloud provider reads its authorized central control-store snapshot; the private provider validates a signed local certificate. Both return the same typed capabilities and denials to every canonical command and sensitive read.
- Private users may connect from the internet, from a local network, or run entirely air-gapped **without switching to a different edition or price plan solely because of connectivity mode**. Their application cannot depend on online SAVEN authentication or licence checks for each normal login or accounting transaction.

### 7.2 Commercial authority, local identity, protected ultimate business ownership and seat assignment

**SAVEN vendor-only commercial authority owns:** applicant/subscriber identity, plan/pricing and billing terms, subscriptions/renewal/proration, installation registry and registered installation public keys, entitlement issuer, monthly certificates, module/user/AI quotas, AI seat-allocation policy, supported build/version ranges, subscription audit and authorized support cases. Do not copy unrelated customers' commercial data into private installations.

**Customer-local private authority owns:** employee names/emails, password verifiers, MFA/recovery methods, staff enrollment, login sessions, local business-specific roles, conditional grants/denials, approvals, document/AI access, company/branch hierarchy, operational audit, local backups and financial data. No automatic private employee directory/password transfer to SAVEN.

A vendor creates *licensed user slots or signed invitation vouchers*, not default reusable employee passwords. The private customer enrolls the single ultimate business administrator locally and assigns the purchased slots to locally created employees. Initial SAVEN-assisted onboarding, if requested, must go through explicit, revocable, attributed customer-authorized support. An optional pseudonymous remote seat roster requires disclosure; named employee sync requires a separately approved connected-identity contract and is **not default**.

For each subscriber business there is exactly one active ultimate owner principal, one protected immutable role definition, and **no** ordinary custom-role method of creating a second ultimate holder. Owner transfer is atomic, separately verified and audited. The ultimate owner may freely name and define other roles and restrict any allowed module, action, person, report, branch, record, field, approval tier, AI tool or data export within the purchased entitlement and invariant protections.

Seat semantics must distinguish maximum active ERP user accounts, invited/unassigned users, disabled/suspended users, concurrent sessions and *named* AI seats. Never allow a client to evade contracted named AI seats by repeatedly swapping assignments within a billing period. Any exception must be a documented audited commercial policy.

### 7.3 Signed monthly private licences, activation receipts and practical anti-tamper

Version and sign canonical licence claims including: `license_id`, `subscriber_id`, `installation_id`, `installation_public_key_digest`, `edition`, `permitted_modules`, `max_active_users`, `named_ai_seats`, `ai_budgets`, `legal_company_limit`, `offline_device_limit`, `supported_protocol_and_build_ranges`, `not_before`, `valid_until`, `grace_policy_id`, `issuance_sequence`, `key_id`, `algorithm`, `support_entitlement`, `feature_overrides`, and `policy_version`.

- Sign only in SAVEN-operated systems using a well-reviewed asymmetric digital signature (Ed25519 or appropriately supported equivalent), protected signing keys/KMS/HSM, key rotation and compromise procedures. Private install gets public verifying keys, **never the signing private key**. Signature is the authenticity protection; optional encryption is not a substitute for signing and does not magically stop local executable modification.
- **Monthly renewal** is the current commercial direction. A private customer can renew through an outbound mutually authenticated service when connected, or exchange signed request/certificate/acceptance files when air-gapped. No mandatory persistent network connection or distinction in commercial product is authorized.
- During offline activation, the installation creates an installation identity and signed/non-replayable challenge; SAVEN verifies sale/entitlement and returns a signed certificate; the private verifier installs it and emits a signed acceptance receipt tied to installation ID, challenge, certificate digest/sequence and accepted state. Receipt is **evidence of activation**, not conclusive proof of continuing software integrity, no piracy or non-use after cancellation.
- Define `ACTIVE`, `RENEWAL_DUE`, `GRACE`, `RESTRICTED_FOR_NEW_OPERATIONS`, `CANCELLED_WITH_DATA_ACCESS`, `REVOKED_FOR_COMPROMISE`, and `VERIFICATION_ERROR` with explicit customer-visible allowed actions. **Do not invent a grace period or a precise monthly expiry-calendar rule** without owner-approved commercial policy. No financial records, pending offline evidence or encryption keys are destroyed after expiry. Retain lawful historical read/export/backup/recovery and safe later reactivation.
- Protection: signed release images, reproducible builds, SBOM, verified update package, installation-key rotation, optional supported hardware-backed identity, rollback/clock anomaly warnings and protected audit. Root/hypervisor owners can alter binaries, clone VMs and manipulate clocks; an air-gapped system cannot be instantaneously revoked or continuously attested by SAVEN. No unbreakable anti-piracy, hidden backdoors, self-destruct routines or false tamper-certainty claims.
- A termination/deactivation receipt can record that the software reported deactivation. It **cannot prove** that all copies were destroyed or stopped. Licence agreement, renewal process, investigation/audit clauses and commercial remedies require competent legal review.
- Test invalid/mutated entitlement, signature mismatch, cross-installation replay, expired certificate, duplicate registration, rollback, hardware recovery, lost key, online/offline renewal, cancellation, whole-system restore and reactivation without financial-data loss.

### 7.4 Operator portal, customer admin and support tickets

The SAVEN vendor operator portal is hosted only by SAVEN. It should allow authorized staff to manage package/customer groups, subscriptions, private installations, node pools, database placement, migrations, storage profiles/buckets (local, S3-compatible or future R2), resource capacity, secrets *references*, API providers, AI usage/quotas, licence issuance/renewal and support tickets through safe guided controls **without manual SQL or source edits**. This does **not** authorize arbitrary, unverified database-engine switching: current approved storage engine is native SQLite.

The customer business admin portal (identical business capabilities in SaaS and Fully Private) manages employee invitations, local password/MFA settings, company/branch/warehouse context, custom role authoring, permission preview, resource restrictions, approval workflows, named AI seat assignment, Apps/integration grants, licence read-only status and support authorization. The private instance may additionally have an infrastructure-admin surface for backups, service health and configuration, but it **does not** contain SAVEN's vendor billing controls.

Support is a product-wide governed module with internal and SAVEN-escalated tickets. Each business controls whether ordinary users can escalate directly to SAVEN or need owner/administrator approval. A support ticket records requester, immutable text/evidence version, affected installation/tenant, requested action, escalation decision, expiry and correlation ID. **A ticket alone never authorizes support access.**

Customer-authorized support sessions use a named SAVEN employee with MFA, explicit scope/target company/actions, limited duration, local policy enforcement, audit, notification and immediate revocation. High-risk permissions/financial changes require additional protected approval; emergency/break-glass procedures require separate policy and independent review. No hidden global superadmin, password recovery of existing passwords, unbounded impersonation or silent browsing of payroll. Air-gapped support can use an approved signed offline evidence bundle or supervised local service; outbound bridge is optional and disabled by default.

Evidence: log ticket request and changes with identities, timestamp, approval, task/action IDs, before/after diffs where safe, session expiry, customer acknowledgement and independently protected digest/audit records. Logging is **not** a substitute for authorization and least privilege. Minimize confidential data disclosed in SAVEN operator logs.

### 7.5 Apps, user-created modules, APIs, integrations and custom workflows — APP-001 to APP-010

The original requirement IDs **APP-001–APP-010** and all other documented extension commitments in the v2.0 mandate and current feature catalog remain mandatory. SQLite-only development must **not** accidentally convert the ERP into a closed, non-extensible program.

- **APP-001:** Publish typed, versioned OpenAPI (or equivalent) commands and reads, errors, pagination, supported filters and developer fixtures; SDK/sample app should let an independent developer create an invoice integration without reading SAVEN source.
- **APP-002:** Per-tenant/company scoped credentials, least privilege, approved actions, secret storage, rotation/revocation, rate/quota/usage accounting; revoked permissions invalidate in-flight and queued execution at the required reauthorization boundary.
- **APP-003:** Canonical commands from forms, AI, imports, third-party Apps and offline clients use the same exact accounting/stock/tax/period/approval guards, idempotency keys and concurrency semantics. No extension may change posted journals, protected core tables or entitlements directly.
- **APP-004:** One Apps registry represents standalone embedded UI, custom modules, connectors, workflow actions, device adapters and import/export adapters. Signed versioned manifest defines publisher, permissions, target tenant/company, UI slots, supported API/event versions, storage, egress allowlist, secrets refs, quotas, data retention and uninstall policy.
- **APP-005:** Sandboxed execution: untrusted UI on isolated origins or equivalent enforced isolation with narrow messaging; connectors/extensions run in isolated processes/containers/workers with bounded CPU/memory/time, network egress policy and non-root identities. No arbitrary customer code inside the transaction engine; no raw business SQLite file handles. Defend against SSRF, filesystem escape, cross-tenant exfiltration and prompt-injection tool escalation.
- **APP-006:** Signed webhooks and events with durable tenant-local outbox, delivery attempts, event IDs, versioned payloads, retry/backoff, dead letters, replay protection, deduplication and reconciliation; do not assert exact once over a network. Event consumers may resume from committed durable offsets.
- **APP-007:** Canonical tax/e-invoice integrations maintain external reference, submission status, returns/errors and source link; unknown outcome must be queried/reconciled before repeat submission. Jurisdiction-specific legal requirements cannot be disabled through Apps when mandatory.
- **APP-008:** External commerce/POS/bank connectors reliably map external orders, customers, stock, refunds and settlement references to canonical SAVEN documents without duplicate effects.
- **APP-009:** Developer sandbox, tutorial example, test credentials, SDK, manifest validator, install/revoke/uninstall demos and admin diagnostics for SaaS and Private.
- **APP-010:** App version/contract compatibility and per-tenant install/update/migrate/uninstall safety. Custom Apps may own *isolated* per-App SQLite storage or namespaced tables through approved storage APIs, with separately versioned migrations; they cannot freely alter core financial schema. Disabling/uninstalling an App does not delete required business evidence or leave unauthorized webhooks/jobs running.

**Portability matrix:** Every installed App declares whether it supports SaaS, Fully Private, no-network/air-gapped operation and the restricted offline companion. External internet APIs cannot run while air-gapped; queue permissible intents durably and show truthful unavailable/pending states. Apps may not manufacture paid entitlements or license themselves. Custom fields, workflows, role workspaces, tax/account mappings, print formats and configurations must be versioned/effective-dated and supported by stable extension points so future module additions do not require rewriting the kernel. App install/update and uninstall schema changes participate in the same fleet migration and recovery system. UI review must include realistic Apps permissions, installation and integration-error workflows, not merely an Apps menu.

### 7.6 Frontend-first UI/UX correction — specific owner review contract

The `/design/` frontend is a **synthetic review environment**, not a production feature set. Earlier verified source observations: 21 module areas, 251 requirements, 259 mappings, 10 interactive examples, owner design approval absent. Re-check current repository and actual rendered screenshots before claiming updated status. The existing CSS includes warm neutrals and plum; the owner's concern is its overall cramped, repetitive, prototype-like usability and visual finish.

- Design language: warm near-white/ivory surfaces and comfortable charcoal text with restrained plum accents, plus coherent dark mode. Avoid huge pure-white slabs, heavy glass blur, tactical styling, noisy gradients and unnecessary card borders. Wispr Flow is an *aesthetic reference* for calm whitespace and typography; ERPNext is a functional reference for complete workspaces, not copied assets/code/fonts.
- Establish legible type scales: base/body approximately 14–16px according to task and density, ordinary labels approximately 12–13px, tabular numerals for money/quantities, licensed/locally served fonts with predictable fallback. Replace mixed Unicode pseudo-icons with one coherent permitted SVG icon family.
- Workspace: collapsible role-aware grouped sidebar, global Ctrl/Cmd+K search, recents/favorites, company/branch context, clear breadcrumbs, intelligent saved filters/views, one obvious primary action, editable documents and drill-through. Search results and counts must be permission filtered when connected to real data.
- Distinct workflow-specific UX for full accounting/COA, journals, account ledgers and statements with notes; multi-line sales/purchase invoicing, inclusive/exclusive taxes, withholding, advances and payment allocations; cash/bank matching; lot/serial inventory; WIP/BOM/costing/recipe manufacturing; POS shift, split-tender, return and offline; payroll confidentiality; assets; role builder; licence administration; custom Apps; customer support; AI task proposals and evidence.
- Show exact accounting preview and approval/denial reasoning without implying unverified posting. Preserve meaningful error/loading/empty/unsaved/stale/conflict/pending/expired/read-only states. Design mobile/tablet/desktop, dark/light, keyboard focus, screen readers, reduced motion, print and POS touch. Do not plaster the same four KPI cards or generic forms across unrelated modules.
- Every requirement must map to a route, persona, permissions, fields, data model, workflow states and approval/financial effects, clearly identified as `SPEC_ONLY`, `INTERACTIVE_PROTOTYPE`, `OWNER_APPROVED`, `CODE_IMPLEMENTED`, or `LIVE_VERIFIED`. Coverage counts ≠ deeply usable flows. Owner review should include visual before/after screenshots and observed novice task journeys; no automatic approval. Preserve all working live routes while improving the prototype first.

### 7.7 Private installation, platform evolution, SQLite BI and future updates

- Deliver one reproducible versioned signed release family with SaaS and private deployment profiles, a complete private installer, first-admin wizard, local identity, SQLite provisioning, secure secret setup, local storage/optional S3 object profile, background workers, backup/restore, self-diagnostics, upgrade and signed offline update bundles. Private packages must be inspectably free of SAVEN vendor billing databases, signing secrets and other customers' records.
- Dynamic BI must use committed tenant-local domain outbox events, durable projection cursors, indexed typed summary tables, permission-safe dimension/metric DSL, freshness indicators, source drill-down, backdated reversal/recompute support, heavy report background execution, GL/subledger reconciliation and a 5-million-journal-line benchmark gate. A reporting projection is not a second accounting authority.
- Tenant schema changes use signed migration manifests, independent per-tenant ledger/cursor, preflight and verified backup, canary/pilot/rolling waves, expand/backfill/contract, offline client version compatibility, checksums/integrity/reconciliation, crash recovery, forward fix and a single fenced writable database owner. Core modules and Apps may evolve without replacing the entire ERP kernel.
- Offline companion maintains encrypted device-local SQLite pending operations and idempotent sync to its own Cloud or Private authoritative installation. Offline is not a third commercial deployment. Do not declare a private ERP air-gapped solely because its *companion* can work offline; the full private ERP must independently pass no-SAVEN-network tests.
- Retain and independently verify the PostgreSQL reference until exact SQLite financial/security parity, recovery and explicitly approved live cutover. Stop making new target architecture dependent on PostgreSQL now. Do not delete data or unrelated services, touch `main`/production, or automatically migrate a live tenant.

### 7.8 Threat/security, testing, traceability and proof of completion

Mandatory security tests include API injection, SQL injection via filters/sort, cross-company/tenant BOLA/IDOR, stale role grants, AI tool escalation, malicious App/manifest, stolen API keys, webhook replay, SSRF, CSV formula injection, malware uploads, forged/expired private licence, root-user tamper limitations, off-node backups, licence issuer key compromise, compromised support session, denial over BI/exports/search and misrouted node requests.

Financial/storage tests include double submission, approval changed while queued, committed journal with failed HTTP acknowledgement, WAL crash and checkpoint, migration interrupt, mixed offline versions, duplicate integration invoice, lost evidence file, disk-full, corruption, restore after backdated correction and node-fencing violation. Track financial and operator audit separately from bounded operational traces. No noncritical log-saving policy may discard required accounting or security evidence.

Every deliverable is classified **specified / prototyped / implemented / tested / deployed / verified** with independent evidence. Do not equate a synthetic screenshot or green CI with live feature completeness. Preserve all original catalog IDs and historic ADRs with supersession notes. Commit only nonsecret source/artifacts to authorized `testing-1`, retain a resumable factual `docs/BUILD_STATE.md` checkpoint for every increment, and do not overwrite other work.

The agent's **first report** must include latest inspected head, conflicts/supersession, existing functional routes and PG reference, exact current SQLite-only local implementation plan, trust boundaries, storage/authorization and queue locations, protected owner and licence policy, UI/Apps design inventory, test gates, SSH/tunnel boundaries, first safe changes and blockers. Subsequent reports must include actual tests and independent restore evidence before any source/live claims.

### 7.9 Unapproved policy decisions to flag, not invent

- Exact grace days, monthly validity cutoffs and emergency extensions for private certificate renewals.
- Commercial terms for offline/air-gapped renewal and termination; legally required read/export windows.
- Numeric seat allocation/reassignment rules for ERP and named AI users; counts of allowed legal companies and offline terminals by package.
- Scope and consent policy for optional private-user roster or remote support bridge; customer retention/backup responsibilities.
- RPO/RTO, disaster recovery and capacity targets, including acceptable reporting freshness and high-volume node availability.

## 8. Final delivery and documentation requirements

The final governing order for agent implementation is:

1. The newest explicit owner messages received after this file, if documented and verified for meaning.
2. **This consolidated SAVEN v2.3 addendum** for topics it resolves, including SQLite-only baseline, private licensing, RLS-equivalent access, durable queues, Apps, UI and local-first QA.
3. The repository's `docs/sources/SAVEN-mandate-v2.md` for every other previously approved product requirement, including broad ERP scope, full financial correctness, offline app, BI, Apps and security.
4. Existing repo feature catalog, contracts, implementation and verified history, reconciled without assuming undocumented functionality is live.

The v2.1, v2.2 and v2.2.1 files from which this was consolidated are **historical inputs**, not separate instructions to send; any historical D1 or customer-hosted-SaaS-data-node language is superseded. This document replaces their combined active instruction for the AI agent.

Required changes after inspecting `testing-1`: update `AGENTS.md`, superseding ADRs (retain history), feature/acceptance catalog including Apps APP-001–APP-010, requirements traceability, risk/security register, private installer/deployment descriptions, control-plane and licence specifications, UI design contracts, SQLite migration/BI/offline docs and `docs/BUILD_STATE.md`. Use non-destructive, separately verified updates. Confirm owner approval before any irreversible live database operation, production/main change or externally exposed service/tunnel.

## 9. Minimum acceptance report requested from the agent

1. Current fresh `testing-1` head, current repository implementation, source/test/live distinctions and unexpected conflicts.
2. Explicit supersession of D1/PostgreSQL target documents, updated ADR, feature traceability and exact-one-owner invariants.
3. Working local SQLite-only boot: central stores, tenant DB, local API, frontend, test object store, seeded synthetic owner and custom roles.
4. Existing financial tests passed under the SQLite implementation plus independent discrepancies, with retained PG reference results.
5. Monthly private licence demo in both online and manually transferred air-gapped modes, including expiry/grace as pending policy approval.
6. Frontend owner-review inventory, revised design direction and actual functional-vs-prototype labels, including authenticated optional tunnel/browser QA and successful localhost-only tests.
7. Evidence of backup/restore, negative authorization tests covering row/field/search/report/AI/worker leakage, durable command acceptance/posting/outbox crash recovery, SQLite migration, concurrency and deployment resumability.
8. Clear separation of completed, partially implemented, merely specified and not yet tested tasks; current blockers; no claims of production migration or successful live rollout without verification.

**Operational boundaries:** Work only on authorized development environment and `testing-1`; no GitHub `main`, production, actual financial posting, external platform changes or destructive server operations without express authorization. After each increment, persist accurate `docs/BUILD_STATE.md` checkpoints and reproducible commands in the repository.

## 10. Why the migration cannot be treated as find-and-replace

SQLite does not provide native PostgreSQL RLS, SECURITY DEFINER, stored procedures or matching numeric/DDL semantics. It allows many concurrent readers but one writer at a time per file. WAL must stay on a single host with coordinated local connections. The financial authorization and accounting posting invariants need independently verified reimplementation, not a connection-string edit. Native SQLite is an acceptable strategic target only after those functional and recovery requirements pass.

**Official references:** https://www.sqlite.org/wal.html ; https://www.sqlite.org/backup.html ; https://www.sqlite.org/pragma.html#pragma_foreign_keys
