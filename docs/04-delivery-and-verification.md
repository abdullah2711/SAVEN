# SAVEN Delivery and Verification Plan

Prepared for Abdullah Nauman and Economic Systems Consulting

11 November 2026 | Delivery baseline 1.1

## 1 Current state and next authorized step

The connected GitHub repository is abdullah2711/SAVEN. The verified branches are main and testing-1. The original 1.0 baseline began with both branches at bdf418ca3bf6ebac49115f45119cbe0f6548e907; subsequent planning updates are committed only to testing-1. No merge to main, production deployment, database creation, paid infrastructure purchase, or working accounting implementation is represented by these documents.

The supplied discussion explicitly requests the documents before software construction and review before coding. The next step after review is a foundation implementation on testing-1. Unresolved choices below have recommended defaults so review can be concrete; they are not silently treated as approved commercial commitments.

The documents supersede the old SIMBA blueprint where the feedback changes it. SAVEN is the product name, pronounced seven. The feature catalog records broad commercial scope, supported boundaries, dependencies, and acceptance conditions. Requirement status begins as specified, not implemented. A requirement moves to verified only with linked evidence.

## 2 Delivery order and gates

| Stage | Deliverable | Exit evidence |
| --- | --- | --- |
| 0 Review baseline | Product, architecture, commercial plan, catalog and decisions | Recorded scope and policy review |
| 1 Foundation | Identity, tenant and company, permissions, command layer, journals and audit | Isolation, decimal, concurrency and posting tests |
| 2 First connected workflows | Direct service invoice and stock issue with approvals and import staging | End-to-end records and reconciliation |
| 3 Operating suite | Sales, purchases, POS, assets, projects, CRM, manufacturing and workforce | Catalog cases for supported depth |
| 4 Finance and platform | Finance, statement packs, BI, Drive, forms, Apps and portals | Reproducible reports and secure integration cases |
| 5 AI capability completion | Setup, extraction, entry, reports, configuration, personal memory and evidence-linked company knowledge | Task evaluations, source-version and change-history checks, toggle behaviour and permission regression |
| 6 Controlled validation | Internal operation, opted-in pilots, migration rehearsal and security assessment | Pilot, recovery, usability and quality gates |
| 7 Commercial release | Agreed suite and supported rollout | No unresolved release blocker and explicit release decision |

AI interfaces are designed alongside every module from Stage 1; Stage 5 completes and evaluates the full launch tool coverage. Delivery order is not permission to announce an accounting-only commercial MVP. If scope, resources, or evidence make the requested release impractical, present an explicit choice between scope, investment, and timing. Do not conceal the tradeoff by relabelling missing requirements as future expansion.

No responsible date or budget can be committed until the foundation spike, prototype task tests, localization inventory, manufacturing examples, permanent team capacity, and independent security work are estimated. Software generation speed is not a substitute for accounting validation and operating support.

## 3 Branch release and environment policy

All code, migrations, configurations, tests, and documentation first enter testing-1. Keep commits small enough to review, with requirement identifiers and meaningful validation. A pull request proposes promotion from testing-1 to main after checks and review; do not push production work directly to main. If parallel work later requires short-lived branches, those merge into testing-1 first under a separately agreed convention.

Branches do not isolate customer data or servers. Maintain development, testing and production credentials, databases, buckets, domains, model keys, and access policies separately. Use synthetic or expressly authorized sanitized data in tests. Never put secrets, payment evidence, payroll, production database dumps, or customer documents in Git.

Recommended repository rules require pull requests and passing checks on main, restrict force pushes and deletion, and prevent unreviewed bypass. These settings must be checked and configured through an authorized repository administration action; this document does not claim they are already enabled. Deployment credentials use least privilege and environment controls. Build one immutable artifact and promote its digest, rather than rebuilding different code for production.

CI should check types, linting, dependency and secret scans, command contracts, migrations, financial tests, tenant boundaries, and meaningful browser journeys. Release evidence identifies commit, artifact digest, schema version, feature flags, supported app versions, model and tool versions, and recovery procedure. Passing checks are necessary but do not automatically authorize a commercial release.

## 4 Foundation backlog

The first implementation should prove two real workflows rather than extend the dashboard simulation. A direct service invoice establishes receivable, revenue, tax handling, evidence, approval, and ledger drill-through. A stock issue establishes quantity, reservation or release policy, costing, project or expense mapping, approval, concurrency, and retry. Both run across two isolated companies with users of different authority.

| Work item | Acceptance before moving on |
| --- | --- |
| Repository and local setup | Reproducible environment, pinned dependencies, no secrets, documented test command |
| Organization and identity | Company switching and membership enforced server-side |
| Permission engine | Effective-access preview agrees with allowed and denied command tests |
| Posting kernel | Balanced atomic journal, locked-period rejection, decimal rounding and reversal |
| Command protocol | Idempotent retries and conflicting payload rejection |
| Policy and approval | Versioned rules, payload-bound approval and no prohibited self-approval |
| Stock kernel | Opening reconciliation, availability, safe concurrent issue and mapped cost |
| Service invoice | No compulsory delivery workflow and one correct accounting effect |
| Audit and evidence | Initiator, source, outcome and protected evidence are traceable |
| First AI tool adapter | Proposes and submits using the same scoped commands; cannot bypass denial |

Use financial fixtures that would expose incorrect implementation: simultaneous issues of the last unit, duplicate webhook delivery, a posted document edited after approval, wrong-company foreign keys, a stale period lock, and an interrupted import. Tests that merely repeat the code's own calculations are inadequate evidence.

## 5 Financial and operating acceptance cases

| Case | Required observation |
| --- | --- |
| Service sale | Direct invoice posts once and no stock documents are required |
| Supplier bill and credit | Liability, tax, inventory or expense and adjustments reconcile |
| Opening inventory | Item quantities and value establish breakdown without duplicate GL value |
| Tissue-box issue | New user completes the simple task; correct unit, destination and status |
| Concurrent last-unit issue | Only available stock is released under the configured negative-stock policy |
| Transfer under interruption | No duplicated quantity, cost or in-transit balance after retry |
| Asset activation | Register reconciles to existing cost and accumulated depreciation |
| Depreciation and disposal | Period, residual value, gain or loss and reversal are reproducible |
| Partial manufacturing | Actual inputs, WIP, finished output and loss reconcile |
| Jewellery production | Fine metal, stones, customer-owned metal, scrap and finished cost reconcile |
| Subcontracting | Materials at vendor, service cost and receipts do not double count stock |
| Mixed attendance | Duplicate device events and manual correction produce an approved single result |
| Payroll revision | Effective date, proration, arrears, deductions, payslip and GL agree |
| POS shift and return | Tenders, cash count, refund authority, stock and revenue reconcile |
| FX and close | Remeasurement, control accounts, lock and authorized adjustment are traceable |
| Financial statement pack | Statements, notes, comparatives and supporting ledgers cross-cast |
| Finance scenario | Cash and debt outputs reproduce from the stored assumptions |
| Capability retirement | History and required schedules survive; dependency conflicts are explained |
| Form publication | Old records remain interpretable and core validation cannot be removed |
| External tax timeout | Unknown outcome is reconciled before retry; no duplicate sale |

Each case needs independently calculated expected results, preparer and reviewer roles, starting balances, inputs, policy version, and evidence of actual output. Accounting reviewer ownership is a delivery role, not a third-party approval requirement imposed on every transaction.

## 6 AI evaluation and release controls

Build an accountant-labelled evaluation set with at least 200 representative document cases and 100 adversarial or boundary cases before exposing financial AI to opted-in customers. This is an initial test volume, not statistical proof of universal accuracy. Partition development and held-out cases to avoid tuning against all examples. Add cases from each supported document class, language, currency, manufacturing rule, and permission context.

Measure extraction accuracy on material fields separately from overall field accuracy. Measure treatment selection, missing-information detection, duplicate detection, abstention, reviewer time, completion, harmful effects, latency, and cost. A single blended accuracy percentage hides important failure modes. Record sample counts and uncertainty, and explain that observed zero harmful effects does not prove zero future risk.

| Gate | Proposed release condition |
| --- | --- |
| Authority and tenant tests | All defined denial and isolation cases pass; any unauthorized effect blocks release |
| Deterministic integrity | No invalid or unbalanced committed effects in property, concurrency and failure tests |
| Document extraction | At least 99 percent exact normalized accuracy on required material fields in the stated set, with unresolved fields reviewed |
| Financial treatment | All automatic effects disabled initially; proposed treatments require review and class-specific evaluation |
| Configuration | Permission, schema and workflow simulation tests pass before administrator publication |
| Memory | Revoked access, private scope and correction tests pass across retrieval and caches |
| Company knowledge provenance | Renames, reused filenames, document versions and exact locations resolve to the correct supporting evidence |
| Knowledge change tracking | Effective dates, observation dates, corrected facts, superseded facts, conflicts and incomplete coverage remain distinguishable |
| Knowledge controls | Company, user and operator controls pass authority, disable, in-flight cancellation, retention, deletion and reactivation cases |
| Cost | Task budgets enforced and cost per accepted workflow recorded for each enabled task |
| Provider switch | Same gates pass on held-out cases and supported capability matrix is documented |

The 99 percent extraction target is a proposed benchmark and does not authorize automatic posting. Confidence reported by the model is not a reliable approval mechanism. Initially all financial AI effects need explicit human execution and configured approvals. Later bounded automatic routines require a new reviewed authority policy and stronger task-specific evidence.

Feature states are implemented disabled, internal only, opted-in pilot, generally available, suspended, and retired. Each state has an owner, evaluation version, eligible tenants, fallback, support instructions, and a kill switch. Turning off an AI task must preserve its drafts, audit history, and manual completion path.

Company knowledge has additional acceptance cases in the [company knowledge and memory specification](10-company-knowledge-and-memory.md). The optional capture default is disabled until the company chooses its authorized sources. Knowledge use and refresh stop when disabled; retention and purge follow their separate stated rules. This does not disable mandatory financial audit logging. Include permission changes between retrieval and answer delivery, cached and in-flight context, conflicting contracts, future effective dates, and catch-up after reactivation in the evaluation set.

## 7 Usability performance and recovery gates

Observe at least five unfamiliar users per materially different launch persona for formative task tests. That sample finds issues; it does not prove population-wide ease. Test light and dark themes, small screens, keyboard-only use, long amounts, large tables, empty states, permission denials, errors, loading, and interrupted work. A polished dashboard alone is insufficient.

Propose at least 80 percent independent first-use success on defined simple tasks and at least 30 percent lower median human task time versus a documented baseline, without worse material error outcomes. Measure the complete task including corrections and review. Do not compare an expert SAVEN operator with an untrained competitor user and call the result objective.

Performance reports declare active companies, concurrent users, document history size, catalogue size, request mix, payload sizes, geography and network. Test noisy neighbours, report storms, mass payroll, import bursts, cache misses, AI-provider failures and queue backlog. Proposed server p95 budgets are 500 ms for ordinary reads and 800 ms for ordinary commands; heavy work is asynchronous. These are engineering targets pending load evidence.

Recovery rehearsal restores database, attachments, configuration, identity dependencies, and outstanding work into an isolated environment. Reconcile totals and evidence hashes, then exercise selective tenant recovery and resumption without duplicate external effects. Proposed RPO of fifteen minutes and RTO of four hours become contractual only after a costed architecture and measured rehearsal support them.

## 8 Security launch gate and incident response

Before customer production data, complete threat modelling, tenant and role tests, secret and dependency scans, upload and app isolation checks, backup restoration, logging redaction, and operator MFA. Before public launch, obtain an independent scoped penetration assessment and close material findings. These activities reduce risk; they cannot certify that intrusion is impossible.

An incident runbook identifies an incident lead, engineering responder, customer contact, financial reviewer and decision owner. Detect, contain, preserve evidence, assess scope, recover, reconcile financial effects, communicate under applicable obligations, and complete corrective actions. Emergency changes still enter testing-1 with evidence and expedited review. Do not erase logs or manually alter posted records to hide an incident.

Release blockers include cross-tenant disclosure, unauthorized privilege or posting, unexplained financial differences, loss of required evidence, failed restoration, unbounded app execution, a material unresolved security finding, or mandatory tax submission failing in the supported customer profile. Cosmetic issues can be prioritized separately, but no release exception can silently waive financial integrity.

## 9 Decisions and recommended defaults

| ID | Decision | Recommendation for review | Consequence |
| --- | --- | --- | --- |
| D01 | First country and reporting basis | Pakistan first; approved reporting templates and policy packs by entity type | No universal IFRS or tax compliance claim |
| D02 | Technology | Modular Django and PostgreSQL backend with React and TypeScript | Confirm with foundation spike and permanent team |
| D03 | AI financial authority | Human execution and configured approval initially | No autonomous financial posting at public launch |
| D04 | Manufacturing depth | Validate discrete, batch, subcontract and jewellery cases before claiming coverage | Specialist cases need explicit additions |
| D05 | Offline POS | Connected POS first; offline as a separately accepted implementation requirement | Obtain explicit scope decision before commercial promise |
| D06 | Payroll localization | Effective-dated Pakistan pack with documented province and employment coverage | Tax and benefit rules need current validation |
| D07 | Hosting region and recovery | Select region after residency, cost, support and latency review | Budgets and contracts depend on this choice |
| D08 | Initial AI provider | Benchmark at least two providers on labelled tasks | No model or price selected from reputation alone |
| D09 | Subscription expiry | Grace plus protected read and export access, subject to terms | Avoid destructive business-data lockout |
| D10 | Private deployment | Signed entitlement and documented support matrix | Root-level tamper prevention cannot be guaranteed |
| D11 | Pricing and support | Test packages and contribution before setting prices | No invented market rates become commitments |
| D12 | Repository protection | PR and required checks on main with restricted bypass | Verify capabilities and apply through authorized admin action |

The request for every complex process is a direction of breadth, not a finite specification. D04 and the feature catalog make that limitation visible. No rejected or changed default should be implemented silently: record the decision, affected requirements, migration impact, tests, owner and review date.

## 10 Traceability and evidence management

The repository contains the four narrative documents, machine-readable feature catalog, human-readable feature library, feedback traceability, architecture decisions, source references, and a planning validator. The validator checks identifiers, dependencies, document links, and required coverage. It verifies consistency of this planning package; it does not test software that has not been implemented.

Maintain requirement states as specified, in progress, implemented, verified, released, and changed. A verified record links to a test or review result at a commit and relevant environment. Commercial release records the exact included requirement set and known limitations. Add acceptance evidence as software is built rather than backfilling claims after launch.

The scope review should resolve the decisions above and then authorize the Stage 1 foundation. Review does not require approving every screen pixel or predicting every future feature. It must establish financial rules, supported processes, AI authority, data boundaries, operating responsibilities, and the criteria for a safe first customer.
