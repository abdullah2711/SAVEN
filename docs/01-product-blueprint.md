# SAVEN Product Blueprint

Prepared for Abdullah Nauman and Economic Systems Consulting

11 November 2026 | Product baseline 1.1 | Pronounced seven

## 1 Purpose and product commitment

SAVEN will bring accounting, financial management, common business operations, reporting, and an AI assistant into one configurable system. Its central promise is less work to establish reliable records, complete daily tasks, change processes, and understand the business. A pleasant interface supports that promise; it cannot substitute for correct records or usable workflows.

The first commercial release is a broad suite, rather than a small accounting MVP. It includes POS, inventory, assets, manufacturing, HR and payroll, projects, basic CRM, finance, built-in BI, professional financial statements, company document storage, configurable forms, approvals, and an Apps platform. Internal delivery stages divide the engineering work. They do not remove these families from the requested commercial scope.

The companion feature catalog gives each requirement an identifier, supported boundary, dependency, and acceptance condition. It is the finite baseline against which completion must be assessed. New discoveries enter change control; the word complete must never become a promise of every possible industry process or every feature of every ERP.

Software implementation follows review of this package. The existing SIMBA interface is a visual prototype, with simulated data and actions. It establishes neither a production ledger nor working AI, authentication, integrations, or tenant isolation.

## 2 Customers and business fit

Eligibility spans professional services, trading and distribution, contractors, manufacturing, logistics, healthcare, education, training, and other organizations using the shared functions. Large turnover is compatible with SAVEN; unsupported operational complexity is a reason to qualify the engagement carefully. The buyer may be an owner or CFO while the everyday user is an accountant, clerk, storekeeper, supervisor, or the owner themselves.

Specialist clinical care, patient records, student administration, securities dealing, and advanced fleet dispatch remain external systems. SAVEN accounts for their financial events through supported interfaces. Manufacturing is included: its supported processes must be tested explicitly, including a small jeweller, rather than dismissed because the business is small or assumed to be covered by a generic production screen.

Commercial discovery records legal entities, branches, users, transaction peaks, stock units, production routes, payroll rules, approvals, tax obligations, migration quality, devices, connectivity, reporting, and integrations. Industry labels alone are insufficient. A salesperson cannot promise unsupported depth to secure a sale.

## 3 Shared foundation and accounting rules

An organization subscription may contain multiple legal companies. Membership and authority are explicit for each company. Branches, stores, departments, projects, and cost centres are dimensions within a company. Company switching is always visible; a hidden browser context must not determine where money is posted.

All monetary calculations use decimal arithmetic, currency-specific rounding, and preserved exchange rates. A business event creates balanced journal lines and any associated subledger movement in one transaction. A failed operation leaves neither a partial journal nor an orphaned movement. Retrying a command cannot duplicate its effect.

Posted entries are corrected through controlled reversals or adjustments with linked evidence. Period locks apply to forms, imports, integrations, and AI equally. Draft editing, authorization, accounting posting, physical release, external reporting, and settlement are distinct facts. A balanced journal is necessary but does not establish correct accounting treatment or completeness.

The accounting family covers chart of accounts, recurring entries, accruals, prepayments, allocations, FX remeasurement, intercompany records, period and year end, reconciliations, and control-account restrictions. Revenue and contract balances, provisions and credit losses, leases, current and deferred tax workpapers, and supported financial instruments need policy-specific schedules and acceptance examples. Consolidation includes elimination entries and reconciliation within an explicitly agreed company and currency scope; complex ownership changes require separately specified cases before claiming support.

## 4 Functional breadth and supported depth

| Family | First commercial release contract | Important boundary |
| --- | --- | --- |
| Accounting | GL, subledgers, close, controls, multi-company reporting | Accounting policy and country packs are versioned |
| Sales and purchases | Direct documents or optional quotation, order, receipt and matching routes | Service invoices need no stock delivery step |
| POS | Barcode entry, till sessions, discounts, returns, tenders, receipts and reconciliation | Record payment methods; no autonomous transfer of funds |
| Inventory | Multiple stores, batches, serials, expiry, counts, landed cost and valuation | No unreviewed retrospective costing changes |
| Assets | Register, components, depreciation, transfer, impairment and disposal | Activation reconciles to existing GL balances |
| Manufacturing | BOM versions, routes, WIP, actual costs, subcontracting, scrap and rework | Special processes require worked examples and acceptance |
| HR and payroll | Employment, attendance, leave, compensation, benefits, hiring and performance | Country and employment rules need explicit validation |
| Projects and CRM | Leads, quotations, tasks, budgets, time, costs, milestones and profitability | Specialist CRM remains a separate future product |
| Finance | Liquidity, working capital, facilities, debt, scenarios, capital and performance | Advice and assumptions remain reviewable |
| Reports and BI | Governed metrics, dashboards and statement packs with notes | Freshness and report basis are visible |
| Platform | Forms, workflows, permissions, Apps, APIs, Drive and audit | Core financial and security rules remain mandatory |

### Sales purchases and POS

A sole-owner service invoice needs customer, service, amount, tax treatment, due date, and posting authority. Orders, delivery notes, and matching appear only when the business policy requires them. Partial fulfilment, advances, returns, credit adjustments, allocations, ageing, and statements share one underlying party and transaction history.

POS must remain fast without an AI conversation. Use scan or search, quantity, visible price and discount, tender, and receipt. Each till has opening float, authorized cashier, shift close, counted versus expected cash, and variance review. Returns reference the original sale where available and enforce refund authority. Offline trading is a separate controlled capability: before enabling it, specify local encryption, allowed tenders, tax rules, stock oversell policy, sync conflicts, and duplicate handling. The initial default is connected POS with safe retry and visible connection status; offline POS requires owner review as decision D05.

### Tax and localization

Tax configuration includes sales and purchase tax, inclusive and exclusive pricing, recoverable and nonrecoverable amounts, withholding, certificates, settlement and return reconciliations. Each country pack states jurisdiction, covered entity types, effective dates, source rules, and unsupported cases. Pakistan launch requires validation of the actual federal and provincial requirements for each supported customer profile. No single generic tax percentage or FBR connector establishes complete compliance.

### Inventory and manufacturing

Item creation does not create stock. Opening stock, supplier receipt, count adjustment, transfer, production consumption, and expense issue have different accounting meanings. Existing ledger inventory must be linked to its opening subledger breakdown without recording the value twice.

Cost formulas are selectable only within the applicable accounting policy. For an IAS 2 reporting basis, use specific identification for appropriate non-interchangeable items and FIFO or weighted average for interchangeable inventory. Inventories with similar nature and use require consistent treatment; different item codes alone do not justify different formulas. Changes need an effective date, impact assessment, reconciliation, and authorized accounting treatment. [R1]

A quick issue defaults the permitted store, unit, and consumption mapping. The user chooses item, quantity, and destination, then confirms. A tissue box must not require selecting journal accounts. Approval-before-release reserves stock without pretending it has left; an authorized immediate issue can post on physical release and enter subsequent review if policy allows. These modes cannot be mixed silently.

Manufacturing supports multi-level BOMs, substitutions, operations, work centres, capacity views, planned versus actual consumption, partial completion, WIP, labour and overhead allocation, by-products, scrap, rework, subcontracting, and lot genealogy. A jeweller test tracks gross weight, fine metal content, purity conversions, stones, customer-owned materials, recoverable scrap, process loss, making charges, and finished stock. Customer-owned material is separately identified and cannot inflate owned inventory. Engineering must agree tolerances and costing bases before claiming this scenario works. Advanced optimization, chemical process controls, regulated batch release, or industry-specific compliance require separate acceptance cases; no universal capability claim is authorized.

### Human resources and payroll

The launch family includes employee and position records, employment changes, organization hierarchy, contracts, shifts, calendars, leave, expenses, loans and advances, benefits, salary components, time and piece based earnings, overtime, deductions, arrears, final settlement, recruitment, onboarding, performance, training records, and employee self service. Payroll handles effective-dated rules, proration, retroactive adjustments, approvals, payslips, liability settlement, and GL reconciliation.

Biometric, web, mobile, imported, and manual attendance can coexist. Each raw event retains source, timestamp, timezone, device reference, and deduplication key. Conflicting events enter adjudication; a device event cannot silently overwrite approved attendance. Store attendance events rather than biometric templates unless a justified, consented requirement is separately approved. Payroll consumes approved attendance for a stated period and preserves the input snapshot. HR breadth was benchmarked against Dynamics 365 HR and Frappe HR; that research is a coverage aid, not a claim of feature parity. [R2 R3]

## 5 Finance beyond bookkeeping

Finance workspaces cover cash position, rolling thirteen-week liquidity, collection priorities, supplier payment proposals, working capital cycles, credit exposure and limits, inventory funding, budgets and variance, product and project profitability, pricing and break-even, debt and facility schedules, interest, covenants, letters of credit and guarantees, FX and commodity exposure, capital expenditure appraisal, and funding scenarios.

Every forecast separates actuals, committed flows, and assumptions. A scenario identifies its version, horizon, currency, exchange assumptions, interest assumptions, and responsible reviewer. Deterministic engines calculate projections, NPV, IRR, sensitivities, and covenant measures; the assistant may prepare inputs and explain outcomes. Missing data and ambiguous or multiple IRR results must be visible. Market prices and rates require a licensed or otherwise permitted feed and timestamp, or explicit user entry.

SAVEN initially records and proposes payments and financing decisions. Moving funds, lending, investment execution, securities trading, or custody creates separate legal, commercial, and security obligations and needs its own approved project. Calling the company fintech does not establish permission to offer regulated financial services.

## 6 Professional statements and built in BI

Financial statements are structured report packs, not screenshots of dashboard totals. The pack supports primary statements, comparatives, accounting policies, descriptive notes, numerical notes, supporting schedules, cross-references, signatures and approval metadata. Each reported figure drills through to its mapping, schedule, journal lines, and evidence. Mapping versions, period basis, presentation currency, adjustments, rounding, and eliminated balances are preserved with the pack snapshot.

Templates can reproduce a professional accountant's format. Narrative notes have evidence links and reviewer ownership; the AI must not invent related parties, contingencies, commitments, going-concern conclusions, or events after the reporting period. Missing facts become completion tasks. The statement engine checks cross-casts, note references, comparative agreement, cash-flow reconciliation, and mapping coverage. Publication is a controlled reviewer action. PDF and editable exports are supported; routine production does not require Excel or Google Sheets.

BI uses a governed metric catalog, dimensions, filters, calculated measures, schedules, and dashboards. A builder operates within authorized datasets; it cannot run unrestricted SQL against the production ledger. AI produces a report specification using the same builder. Each result shows data freshness and accounting basis. A stale analytical view cannot authorize a credit limit, payroll posting, or stock release.

## 7 Configuration without breaking history

Five independent controls govern availability: subscription entitlement, business capability state, workflow policy, workspace visibility, and actor permission. AI authority is bounded by all five plus task policy. Hiding Inventory must not stop its cost ledger; cancelling a plan must not delete the customer's history.

Capabilities move through unused, preparing activation, active, preparing retirement, and retired for new work. Activation checks dependencies, opening data, effective date, and reconciliation. Retirement resolves pending work, future schedules, external obligations, and replacement accounting. Asset retirement specifies who continues depreciation. Reactivation reconciles intervening activity. Failed transitions preserve the last valid state. Historical links, statements, and audit evidence remain usable.

Workflow changes use a plain-language builder with examples, threshold bands, approver availability, delegation, escalation, conflict checks, and simulation. Publication creates a policy version and effective date. In-flight documents either retain their version or undergo explicit migration with approvals invalidated where required. An administrator sees effective access before granting it; role changes do not let an approver approve their own preparation where segregation is required.

Forms allow custom typed fields, attachments, required fields, controlled lists, visibility, defaults, and bounded validation expressions. Configurations are versioned, previewed, tested, and reversible for future entry. Existing documents retain their schema interpretation. Required company identity, financial balance, posting controls, evidence retention, and permission checks cannot be removed by a form editor or AI.

## 8 AI at launch and release control

Launch design includes setup and COA changes, navigation, master data, document extraction and classification, imports, transaction preparation, reconciliation suggestions, report and dashboard creation, statement note assistance, workflow and form configuration, and invoice print layout from a reference. Implement these behind task-level flags and assess them internally before access by opted-in customers. A flag controls exposure; it is not a substitute for implementation or testing.

The assistant uses the invoking person's authorized commands. It can prepare what that person may prepare and submit through the same approval route. It cannot manufacture approval, change its own role, bypass locks, or obtain unrestricted database access. Print and form generation use a constrained component schema and sanitized renderer, not arbitrary executable HTML.

Zero hallucinations and identical quality from every cheap model are not achievable guarantees. The design target is prevention of unauthorized or structurally invalid effects, traceable evidence, and reliable handling of uncertainty. High-risk semantics require qualified review. Cost and quality are measured per task, with abstention, escalation, and bounded retries. Provider-managed keys serve shared SaaS; private deployment credentials follow the agreed deployment contract.

## 9 Portals company Drive and Apps

### Company knowledge and memory

The optional company brain extends memory beyond chat history into a structured understanding of the company's supplied business information: identity, activities, people and responsibilities, products, relationships, contracts, processes, approved policies, decisions, obligations and changes. Keep shared business knowledge separate from individual preferences and private memories. Every material fact links to the actual source identity and exact version, with document type, date or business reference, supporting excerpt and page, clause, table, cell or other precise location. A filename alone is insufficient.

Preserve how facts change, when each was effective, when SAVEN learned it, and whether an old fact was corrected or superseded. Track changes from authorized records, documents and user inputs. Show conflicts, incomplete source coverage and stale information; the system cannot know facts the business has not provided. Current accounting records remain authoritative for balances and transaction status.

Authorized company administrators can enable or disable shared knowledge themselves, and users can control their own optional personal memory. Provider administrators can manage the capability under recorded operator authority. Company disablement stops capture, refresh and AI use, including queued work and retained context; retention and deletion are separate controls. Provider availability does not override a company's explicit disabled selection or evidence permissions. See [Company knowledge and memory](10-company-knowledge-and-memory.md) for source linkage, change history, access, operator controls and acceptance cases. This capability is included in launch scope while customer use remains optional.

### Portals storage and extensions

The application portal collects account details, selected package, and bank-transfer evidence. An operator verifies the payment and application before provisioning. Receipt of a payment screenshot never automatically activates a company. The operator portal manages plans, companies, users, nominated company administrators, quotas, AI entitlements, subscription dates, backups, system health, and scoped support access.

A company administrator delegates business roles and module administration within that company. Provider operators have technical duties and exceptional support access under their own identities. Routine operation does not require unrestricted browsing of customer payroll or documents. Customer-visible support history records the authority, reason, scope, and duration.

Company Drive stores folders, versions, access rules, quotas, and retention. Transaction attachments are managed evidence linked to business records. Removing a folder shortcut does not destroy an invoice attachment. Deletion displays the exact affected records, retention consequence, and recovery period; held or required evidence cannot be purged through ordinary deletion. Company quota calculations include retained versions according to published terms, with notices before limits block new uploads.

One Apps area lists private or approved apps, connectors, and workflow extensions, including permissions, owner, status, usage, errors, and version. A standalone task app and an embedded invoice action use the same governed platform. Integration events reconcile external references to the canonical SAVEN document. Mandatory tax reporting cannot become an optional unchecked box. FBR integration requires current applicability, licensed-integration arrangements, sandbox approval, identifiers, QR rules, error handling, and reconciliation before a compliance claim. [R4]

## 10 Brand and experience contract

Use SAVEN consistently, pronounced seven, with Economic Systems Consulting as the maker. Preserve the official Economic Systems emblem from the approved interface asset; no new lion emblem is implied. Validate commercial name and trademark availability before public branding expenditure.

| Token | Value | Intended role |
| --- | --- | --- |
| Deep plum | #24151C | Sidebar and strong surfaces |
| Plum | #4A2935 | Primary light-theme actions |
| Warm neutral | #F6F5F3 | Calm light-theme background |
| Ivory | #F7F3EA | Logo on dark plum |
| Status colours | Defined and contrast tested | Status plus text or icon |

Light and dark themes have equal priority. Glass is visible in chrome, navigation, and overlays through restrained translucency, backdrop blur, edge highlights, and layered shadows. Financial tables and entry surfaces remain stable and readable. Remove abrupt background gradient seams. Use an ordinary filled active-navigation state without the decorative vertical indicator previously rejected by the user.

The left bar collapses and expands with labels and accessible tooltips. Sales and Purchases are separate destinations; Reports and BI are separate from Planning and Finance; Apps has its own page. Role workspaces expose relevant tasks, consistent search, quick actions, approval queues, and clear save or posting states. Keyboard operation, focus visibility, reduced motion, touch targets, and contrast are assessed against WCAG 2.2 AA. [R5]

## 11 What must be reviewed before coding

Approve the supported depth in the feature catalog, the policy defaults and unresolved decisions in the delivery plan, and the proposed architecture. In particular, review offline POS, payroll localization, manufacturing examples, private-deployment terms, and initial AI authority. Commercial launch waits for the agreed breadth and release gates; engineering may progress internally in dependency order after this review.

## References

[R1] IFRS Foundation, IAS 2 Inventories, including cost formulas and policy consistency. https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/ and https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-2-inventories.pdf

[R2] Microsoft, Dynamics 365 Human Resources documentation. https://learn.microsoft.com/en-us/dynamics365/human-resources/

[R3] Frappe HR documentation. https://docs.frappe.io/hr/introduction

[R4] FBR digital invoicing FAQs and technical assistance. https://www.fbr.gov.pk/faqs/173967/173969 and https://fbr.gov.pk/di-technical-assistance/173967/173970

[R5] W3C, WCAG 2.2. https://www.w3.org/TR/WCAG22/
