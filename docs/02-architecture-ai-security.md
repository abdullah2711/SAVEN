# SAVEN Architecture AI and Security

> Current owner revision: [Accounting-first scope](48-accounting-first-owner-revision.md), [compatible tenant upgrades](49-compatible-tenant-upgrades.md), and [small-action checklist](TASKS.md) govern conflicting sequence and expanded depth. Historical implementation claims below remain dated evidence, not completion of the new scope.

> Historical baseline: target architecture and development ordering are superseded where conflicting by [owner mandate v2](sources/SAVEN-mandate-v2.md) and [reconciliation](26-owner-decisions-2026-11-13-v2.md). Existing implementation evidence remains valid for its recorded environment.

Prepared for Abdullah Nauman and Economic Systems Consulting

11 November 2026 | Technical proposal 1.1

## 1 Architecture decision

Build a modular application with a deterministic accounting core, one authorized business-command layer, asynchronous workers, and a separately isolated extension runtime. Shared SaaS and private deployment use the same release and configuration contracts. This is a recommended starting architecture, subject to the delivery team's capabilities and a foundation spike; no production stack has yet been implemented.

Avoid starting with many microservices or a separate database for each module. Accounting, stock, and approvals need coordinated transactional integrity. Clear module ownership inside one deployable application permits later extraction when actual load or organizational needs justify it. A platform intended to grow cannot honestly guarantee that no future change will require foundational work.

## 2 Recommended stack and alternatives

| Concern | Recommendation | Reason and tradeoff |
| --- | --- | --- |
| Web application | React and TypeScript with a shared accessible component system | Strong UI ecosystem; enforce design discipline and bundle budgets |
| Backend | Python Django with a typed service layer and API framework | Mature migrations and business tooling; keep money in Decimal and CPU work off request paths |
| Transaction database | Managed supported PostgreSQL release | Transactions, constraints, mature recovery and row security; operations still need expertise |
| Background work | Durable queue plus Python workers and transactional outbox | Visible retries and dead-letter handling; at-least-once execution needs idempotent effects |
| Files | S3-compatible object storage with versioning and retention capabilities | Large files remain outside database rows; reconcile metadata and objects |
| Cache and limits | Redis-compatible service where justified | Rebuildable cache and rate counters; never the accounting source of truth |
| Identity | Maintained OIDC identity service and secure application sessions | MFA and lifecycle integration; validate hosting and private-deployment licence terms |
| Reports | Governed query service and PostgreSQL read models initially | Built-in BI without mandatory external tools; isolate heavy jobs |
| AI | Provider adapter and application-owned orchestration | Models can change after evaluation; provider equivalence is not assumed |
| Deployment | Containers, managed database, infrastructure as code | Reproducible setup; avoid Kubernetes until operating needs justify it |

TypeScript with a mature server framework is a viable alternative if the permanent team is stronger there. The foundation spike must demonstrate decimal handling, transaction boundaries, tenant isolation under connection pooling, migrations, OpenAPI generation, worker recovery, and private packaging. Select exact supported versions at implementation time, pin dependencies, and maintain a patch schedule. Do not choose a stack merely because AI can generate code for it.

## 3 Components and ownership

The application portal owns application submissions and payment evidence. The operator portal owns provisioning, entitlement, subscription administration, and operational workflows. The company application owns business records. They may share infrastructure but use separate routes or origins, authorization boundaries, and session audiences. Operator access requires MFA and tighter session policy.

Business modules own their records and expose commands: identity and organization, configuration, accounting, parties and trade, stock and production, assets, workforce and payroll, projects and CRM, finance, reporting, documents, Apps, and AI. Modules do not update one another's tables casually. The command layer coordinates cross-module transactions; events communicate committed results to projections and external adapters.

The AI orchestrator reads a scoped context, proposes a command, and invokes the same command interface as forms and integrations. The policy engine, permission checks, validation, approvals, and journal engine execute outside the model. Reporting and search have separate read interfaces, bounded query plans, and field-level redaction.

## 4 Data model and isolation

Every tenant-owned entity has an enforceable tenant boundary; company-owned entities also carry company identity. Membership connects users to companies with scoped roles. Tenant-wide subscription configuration never implicitly grants access to all company ledgers. Cross-company operations require explicit authority in each company.

Core records include legal company, membership, role grant, accounting period, account, business document and version, journal and lines, stock movement and cost layers, production order and consumption, asset and depreciation schedule, employee and payroll run, approval case, policy version, attachment and object version, AI task, memory fact, app installation, outbox event, and audit event.

Use composite foreign keys or equivalent enforced constraints to prevent a record in company A referencing a supplier or journal in company B. Unique document numbers are scoped correctly. Carry actor, effective date, created time, source reference, policy version, and concurrency version where needed. Store timestamps in UTC with business timezone and local effective date preserved. Money, quantity, unit conversion, metal purity, and rounding have separately specified precision and range limits.

PostgreSQL row-level security supplements application authorization. Runtime roles must not be database owners, superusers, or BYPASSRLS roles. Apply FORCE ROW LEVEL SECURITY where appropriate, use transaction-local verified scope, and test pooled-connection reuse, raw SQL, migrations, workers, and maintenance paths. The database documentation explicitly describes owner and privileged-role exceptions; enabling RLS alone is not proof of isolation. [R1]

Apply tenant scope to object keys, signed downloads, caches, search indexes, analytics, exports, AI retrieval, job payloads, and webhooks. Reauthorize at execution time for queued work. A tenant identifier supplied by a client or queue message is a selector, not proof of authority. Global reporting for operators uses operational metadata or separately authorized support paths. [R2]

## 5 Business command and posting contract

**Implementation note:** [the first foundation](12-foundation.md) now implements a limited version of this command contract with a Cloudflare Worker/D1-compatible adapter and local Node/SQLite tests, following the owner's [additional input](11-additional-input.md). This does not establish the complete architecture or PostgreSQL row-security controls described elsewhere in this baseline. See ADR 009 in the [decision register](07-architecture-decisions.md).

Each mutating command contains a schema version, company, authenticated actor, source channel, idempotency key, expected record version, structured payload, and correlation identifier. Server-side authority derives from the session or scoped credential, not an editable actor field. Money and quantity are decimal strings at API boundaries.

Execution resolves membership and entitlement, validates the document and current policy, checks concurrency and locks, calculates financial effects, and either saves a draft or creates an approval case. Approval binds the exact payload digest, relevant policy version, and evidence version. Any material edit invalidates approval. Execution rechecks authority, accounting period, stock availability, and relevant business constraints.

The posting transaction writes document state, balanced journal, stock or other subledger effects, approval result, audit reference, and outbox event atomically. A database-enforced constraint trigger or tightly restricted posting function ensures journal balance at commit; application checks alone are insufficient. Posted lines are append-only to runtime actors. Corrections produce new linked entries. Outbox consumers may run repeatedly but record deduplication identifiers before causing external effects.

Idempotency is scoped to company, command, and key. Reuse with a different payload returns a conflict. Exact retry returns the original result. Optimistic versions stop stale overwrites; row locks or serializable sections protect contested stock and numbering. Deadlocks and serialization failures have bounded retry with unchanged command identity.

## 6 Example stock approval and external invoice

For approval-before-release stock, submission reserves the requested quantity and records a pending issue. Approval authorizes release; physical release records the movement and its accounting effect under the configured operating policy. Rejection releases the reservation. A reserved item cannot be consumed by another command. If immediate issue with subsequent review is enabled, posting follows actual release and the review queue clearly states that stock has already left.

An invoice is canonical inside SAVEN. A tax adapter creates a submission record with an external idempotency reference and payload version. Dispatch follows committed outbox processing. Timeout means unknown external outcome, so the adapter queries or reconciles before resubmitting. Persist external identifier, QR data, authority response, and status. Tax rejection or correction follows the legally applicable cancellation or credit process; never silently rewrite a posted or accepted invoice. An app that begins an invoice must use the same canonical command, avoiding a second financial sale.

## 7 AI execution and model portability

Maintain adapters for text, structured output, tool calls, document vision, streaming, and usage reporting. Provider capabilities, data retention, regional processing, rate limits, and availability differ. A replacement model runs the same task evaluations and shadow comparisons before promotion. Retain prompt, schema, tool, policy, retrieval, and model versions sufficient to reproduce the decision inputs without storing unnecessary secrets or hidden reasoning.

The orchestrator builds a minimal context from current authorized records, approved policies, selected memory, and source evidence. It exposes a task-relevant subset of tools, rather than the entire product schema on every request. Each step has token, cost, runtime, tool-call, and iteration budgets. The task can stop, resume, or escalate without repeating completed effects. Provider outage leaves manual functions available.

AI output is an untrusted proposal. JSON schemas can reject malformed fields but cannot establish that the selected account, supplier, tax treatment, or date is economically correct. Financial calculations, permissions, posting rules, availability, and limits are deterministic. Missing evidence requires clarification or review. Prompt filters and a second model can help detect attacks but are not security boundaries. [R3]

| Risk band | Examples | Default execution rule |
| --- | --- | --- |
| Read | Navigation and permitted explanations | Execute scoped reads and show evidence |
| Prepare | Invoice draft, import mapping, report specification | Validate and show a reversible preview |
| Configure | Workflow, role, form, print or COA change | Authorized administrator confirms simulated impact |
| Post | Financial or stock effect | Explicit user action plus configured approvals |
| Exceptional | Period reopening, payroll release, destructive retention changes | Step-up authority and independent review where policy requires |

User equivalence means no additional AI privilege, not automatic permission to execute every possible action without review. High-risk customer administration and operator infrastructure actions remain separate tool catalogs. AI cannot approve its own prepared transaction where segregation applies, even if the initiating user has multiple roles.

### Document processing and import

Uploads enter quarantine, type and size checks, malware scanning, hash calculation, and source retention. OCR or vision extracts fields with page or region evidence. Classification distinguishes supplier bill, receipt, statement, credit note, journal support, and opening information. Unknown document types abstain. Duplicate checks combine hashes and business keys; a different scan of the same invoice must still be detected.

Field candidates enter staging with original and normalized values, confidence signals, and validation results. The assistant cannot invent missing dates, rates, tax identifiers, units, approvals, or balancing amounts. Preview shows accounting treatment and unresolved fields. Imports commit validated batches with checkpoint and idempotency records; partial completion is explicit. Reconciliation compares imported trial balance and control accounts to accepted subledger totals before cutover.

### Memory owned by SAVEN

Store structured memory facts and action summaries in PostgreSQL with tenant, company, user or team scope, provenance, sensitivity, owner, effective time, expiry, and correction history. Store permitted conversation or document bodies as protected objects where appropriate. An optional vector index is a derived retrieval aid, never the authoritative record.

Separate private preferences, shared business facts, approved accounting policies, and transaction evidence. A user's preference cannot become a company policy automatically. Facts inferred from conversation remain marked as proposals until accepted where material. Current approved records override stale summaries. Permission changes and deletion must affect retrieval immediately, including caches and embeddings. No cross-tenant memory or model training on customer information without a separate explicit agreement. Customers can inspect and correct retained memories subject to evidence retention requirements.

Extend this to a company knowledge model with stable entity and relationship identifiers, fact versions, valid-from and valid-to dates, recorded-at times, review states and supersession links. Evidence records identify the actual document or business record, immutable version, content hash, type, date and business reference, and exact supporting page, clause, region, table, cell or timestamp. Preserve protected excerpts or structured values sufficient to inspect support. Filename changes must not alter provenance; direct user assertions remain explicitly attributed when no documentary source exists.

Use committed business events and eligible object-version events to refresh knowledge through idempotent workers. Track source coverage, processing failures, dependency invalidation and last synchronization time. Conflicting evidence creates a review task; a newer upload does not automatically become the operative policy. Queries distinguish current knowledge from authorized historical as-of knowledge. Fetch changing balances and other critical states from their authoritative services.

Evaluate operator availability, company selection, user permissions and source permissions for capture, retrieval, generation, result delivery and tool execution. Company disablement halts indexing and knowledge use, invalidates queued and cached context, and stops or restarts affected in-flight tasks without that context. Personal-memory controls are independent. Retention, deletion and reactivation have distinct workflows; a knowledge purge cannot delete source accounting records. The [company knowledge specification](10-company-knowledge-and-memory.md) defines the enablement authority and full lifecycle contract. Retrieval assembles relevant evidence within task budgets rather than injecting an entire company history into every model call.

## 8 AI cost and quality controls

Measure cost per accepted completed workflow: input and output tokens, vision or OCR, embeddings, retries, guardrails, infrastructure, and human review time. Cheap token rates do not establish cheap reliable outcomes. Route simpler supported tasks to cheaper models only after they meet the same task gate; escalate difficult cases within the customer's budget or stop visibly.

Keep per-user and per-company budgets, concurrency ceilings, document page limits, tool step caps, duplicate request suppression, and cancellation. Cache stable schemas and permitted context with version and permission keys. Usage reports distinguish attempted, failed, and successfully completed work. No promise of unlimited AI is justified before measured usage distributions exist.

Evaluation uses accountant-labelled cases, ambiguous documents, multilingual examples, adversarial instructions, wrong-company references, duplicate scans, stale records, and missing evidence. Track field accuracy, treatment accuracy, abstention, completion, harmful-effect rate, reviewer minutes, latency, and full cost. A passing sample does not prove a zero-error future. New models, prompts, schemas, tools, or retrieval logic trigger regression testing.

## 9 APIs and the Apps platform

Publish versioned business APIs with OpenAPI definitions, examples, typed errors, paging, filters, scopes, idempotency, concurrency, quotas, and test fixtures. Adopt a toolchain-supported OpenAPI version and publish the compatibility policy; the specification is public while SAVEN source remains closed. [R4]

One app registry governs standalone UI apps, connectors, and embedded workflow actions. Manifests declare owner, API version, permissions, events, UI slots, outbound destinations, data retention, quota, and uninstall behaviour. Installation requires an authorized company administrator to review scopes. A connector credential is restricted to its companies and purposes. Rotations and revocation propagate to workers and cached tokens.

Serve untrusted UI apps from isolated origins with a narrow messaging bridge and content security policy. Execute connector code in isolated workers with network allowlists, resource limits, and separate credentials. No arbitrary code runs inside the shared accounting process or accesses its database. Verify app packages, dependency inventory, and compatibility. Restrict URLs to prevent SSRF, including private network targets and redirect tricks.

Webhooks are signed and carry event IDs, timestamps, versions, and correlation IDs. Delivery is at least once, with exponential backoff, bounded retry, dead-letter review, replay protection, and reconciliation. Ordering is guaranteed only where explicitly implemented. Uninstall revokes credentials and future processing while preserving financial documents and required evidence. Provide a developer sandbox, tutorial app, sample tax adapter, and installation diagnostic page before promoting the API as easy to use.

## 10 Security oversight and company files

Threat modelling covers account takeover, tenant escape, malicious documents, prompt injection, app exfiltration, insider misuse, payroll disclosure, forged payments, poisoned imports, ransomware, dependency compromise, and denial of service. Enforce secure cookies, CSRF protections, output encoding, CSP, parameterized queries, upload quarantine, MFA for operators, least privilege, encryption in transit and at rest, and managed secrets with rotation. Exact controls must be verified in implementation rather than asserted from a framework choice.

Financial audit events preserve actor and initiating user, source channel, before and after references, reason, approvals, evidence, command result, and time. AI adds model and tool versions, cited sources, and policy decisions. Do not log hidden model reasoning, credentials, or unnecessary complete payroll documents. Separate business audit, security events, and technical diagnostics with their own access and retention rules.

Users can inspect their own permitted activity; company audit administrators can inspect company activity within sensitive-data rules; operators inspect operational logs. Support access is case-bound, time-limited, attributed, and visible to the customer. Emergency access requires reason, alert, and review. Encryption managed entirely by the operator cannot honestly prove that the operator is technically incapable of access; contractual controls, key access separation, audit, and monitoring address that risk.

Drive object identifiers are unguessable, but obscurity is not authorization. Download checks both record authority and attachment sensitivity before issuing short-lived URLs. Folder permissions cannot broaden access to protected transaction evidence. Use database metadata, object versions, hashes, quarantine status, holds, retention dates, and tombstones. Purge is an asynchronous authorized process with an audit trail; reconcile orphaned objects and metadata without destroying evidence.

## 11 Hosting recovery and measured scale

Start with one regional home for each tenant, redundant application instances, managed database recovery, object storage, and separate workers. Scale stateless requests horizontally; bound worker concurrency and per-tenant queue use. Route heavy report generation away from transactional paths. Add partitions, read replicas, and tenant cells when measured bottlenecks justify them. A tenant cell is a bounded group with its own data and worker capacity; do not implement global multi-master accounting prematurely.

Initial engineering objectives are p95 under 500 ms for ordinary read APIs and under 800 ms for ordinary committed commands, measured server-side at the declared pilot load. Interactive pages target p95 under two seconds on an agreed connection. Heavy reports and AI jobs acknowledge quickly and expose progress. These are proposed budgets, not service promises. Define dataset size, concurrent users, geography, payloads, warm and cold behaviour, error rate, and load mix before reporting a result.

Propose production availability 99.9 percent monthly, recovery point within fifteen minutes for database records, and recovery time within four hours, subject to costed design and measured restore rehearsal. Include object versions, secrets, identity configuration, queued work, and regional failure in recovery planning. Recover a tenant into isolated staging, reconcile, and selectively restore; never overwrite live shared data to recover one customer. Validate backup encryption and actual restoration, not merely successful backup-job messages.

Private deployment uses the same release artifact, migrations, feature contracts, and support matrix. Signed entitlements, activation checks, and a documented offline grace period protect commercial terms. A customer controlling root access can tamper with locally running software; absolute technical lock-in is not a credible promise. Contracts define access after expiry, read and export rights, maintenance responsibility, updates, key ownership, and recovery duties.

## 12 Safe change and operations

Use expand, migrate, and contract for schema changes. New releases read both supported old and new representations during transition. Backfills are checkpointed, bounded, observable, and reconciled. Destructive changes occur only after compatibility windows and verified backups. After an irreversible data transformation, prefer a tested corrective migration or roll-forward; blindly deploying old binaries may corrupt new data.

Every release has an artifact digest, dependency inventory, migration plan, smoke checks, observability, and recovery procedure. Canary flags limit exposure by tenant and task. Financial corrections are business transactions, not database patches hidden as deployment rollback. Major accounting interpretation changes require effective dates and report reproducibility.

Before public launch, commission a scoped independent penetration test, remediate material findings, and rehearse incident response and recovery. ISO 27001 or SOC 2 can become assurance projects when contracts and scale justify them; neither is currently held or implied. Security is continuous risk management, not proof of zero breach probability.

## References

[R1] PostgreSQL row security documentation. https://www.postgresql.org/docs/current/ddl-rowsecurity.html

[R2] OWASP Multi Tenant Security Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html

[R3] OWASP LLM Prompt Injection Prevention Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html

[R4] OpenAPI Specification. https://spec.openapis.org/oas/latest.html

