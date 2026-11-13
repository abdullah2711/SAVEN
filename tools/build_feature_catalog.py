"""Generate the review catalog from explicit capability and acceptance records."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE_DEPENDENCIES = {
    'AI-017': ['FND-001', 'AI-011', 'DOC-002'],
    'AI-018': ['AI-017', 'DOC-002'],
    'AI-019': ['AI-017', 'AI-018', 'SEC-003'],
    'AI-020': ['AI-018', 'APP-006'],
    'AI-021': ['AI-019'],
    'AI-022': ['AI-011', 'OPS-003', 'FND-007'],
    'AI-023': ['AI-020', 'AI-022', 'DOC-005'],
    'AI-024': ['AI-012', 'AI-018', 'FND-007'],
    'AI-025': ['AI-017', 'AI-019', 'AI-020'],
}
GROUPS = [
('FND', 'Business foundation', None, '''
Tenant and company identity|Organization subscription and explicit legal-company membership|A user in company A cannot read or reference company B records
Dimensions|Branches departments projects stores and cost centres|A report filters and reconciles each permitted dimension
Currencies and precision|Decimal money quantities exchange rates and rounding policies|Boundary and conversion examples agree to independently calculated results
Periods and dates|Financial years business dates timezones and locks|Every entry route rejects a locked period
Numbering|Scoped unique document series with concurrency control|Simultaneous submissions cannot duplicate a document number
Membership lifecycle|Invite suspend revoke recover and switch companies|Revocation blocks new requests queued actions and downloads
Permissions|Roles row scopes field sensitivity and effective-access preview|Preview agrees with allow and deny tests
Delegated administration|Company superadmin and module administrator grants|Delegation cannot exceed grantor authority or cross companies
Workspace configuration|Role navigation quick actions and personal preferences|Hidden menus do not grant or revoke business authority
Localization packs|Versioned language reporting tax and employment configuration|Unsupported pack rules are visible before activation
'''),
('ACC', 'Accounting and close', 'FND-001', '''
Chart of accounts|Templates hierarchy account types control accounts and effective-dated changes|Used accounts cannot be deleted or retyped without controlled treatment
Opening position|Trial balance dimensions evidence and subledger links|Opening control accounts agree without duplicate recognition
Journal preparation|Manual recurring accrual prepayment allocation and reversal|Required evidence and allowed dimensions are validated
Posting kernel|Balanced atomic immutable effects and linked correction|Failure produces no partial journal and retries post once
Period controls|Close checklist lock authorized reopening and subsequent adjustment|Reopening leaves reason actor approval and previous report version
Cash and bank|Cashbooks transfers petty cash receipts and payment records|Both sides of a transfer reconcile without duplicate cash
Bank reconciliation|Statement import matching exceptions and duplicate checks|Statement balance agrees to reconciled book balance with explained items
Foreign currency|Transaction rates settlement gains and period remeasurement|Realized and unrealized balances reproduce from stored rates
Intercompany|Reciprocal documents and due-to due-from reconciliation|Authorized cross-company process detects unmatched reciprocal balances
Consolidation|Mapped group reports eliminations and translation in agreed scope|Consolidated totals reconcile to companies plus approved eliminations
Close controls|Control accounts suspense unusual entries and missing evidence|Reviewer can resolve or explain every close blocker
Correction history|Reversal credit adjustment and audit references|Original entry remains readable and all later effects are traceable
Revenue and contract balances|Milestones deferred income retention and approved recognition schedules|Recognition and contract balances reproduce from supported policy examples
Provisions and credit losses|Receivable impairment provisions estimates and authorized reversals|Estimate inputs approval and later utilization remain traceable
Lease schedules|Supported lessee contracts interest depreciation modifications and disclosures|Schedule agrees to approved reporting-policy examples and GL
Tax accounting schedules|Current and deferred tax workpapers temporary differences and reviewed entries|Schedules reconcile to approved tax calculations without an automatic compliance claim
Financial and equity schedules|Supported investments debt equity movements and distributions|Classification measurement basis and approval are explicit for each supported instrument
'''),
('SAL', 'Sales and receivables', 'ACC-004', '''
Customer records|Contacts terms credit limits addresses and tax identity|Duplicate and credit-policy checks run before submission
Quotations and orders|Optional acceptance and order steps|A company can invoice services without order or delivery paperwork
Service and goods invoices|Direct and linked invoices with tax discounts and dimensions|One invoice creates the expected receivable revenue tax and stock effects
Fulfilment|Partial delivery backorders reservations and returns|Delivered billed and remaining quantities agree
Recurring billing|Schedules end dates pauses and exception review|A retry cannot create a second invoice for the same period
Credit and refund|Linked credit notes returns and authorized refund records|Credit cannot silently exceed permitted original value or quantity
Receipts and allocation|Partial receipts advances withholding and unapplied balances|Customer balance agrees to invoices credits and allocations
Receivables oversight|Ageing statements collection tasks and disputed balances|Ageing agrees to control account at the stated as-of date
'''),
('PUR', 'Purchases and payables', 'ACC-004', '''
Supplier records|Terms bank details tax identity and controlled bank changes|A sensitive bank-detail change has authority and an audit record
Requisitions and orders|Optional purchase request approval and order commitments|Unapproved requests do not create approved commitments
Goods and service receipt|Physical receipts and service acceptance are distinct|Service acceptance does not invent stock movements
Supplier bills|Direct or matched bills duplicate checks and evidence|Duplicate supplier reference is flagged before a second liability
Matching|Configurable two-way and three-way quantity price and tolerance rules|Out-of-tolerance bills enter the configured exception route
Adjustments|Supplier credits returns landed costs and price differences|Inventory or expense and payable adjustments reconcile
Payment proposals|Due-date priorities cash constraints approvals and export|A proposal does not itself transfer funds or mark settlement
Payable oversight|Ageing statements advances retention and reconciliation|Supplier schedule agrees to the payable control account
'''),
('POS', 'Point of sale', 'SAL-003', '''
Fast sale|Barcode keyboard search touch quantity pricing and receipt|Cashier completes a normal sale without AI or ledger selection
Till sessions|Cashier assignment opening float cash movements and close|Expected cash agrees to tenders and reviewed count differences
Tenders|Cash bank card reference split tenders and change|Tender total agrees to sale and external settlement differences are visible
Discount and override|Threshold authority price overrides and reason|Unauthorized discounts are denied by API as well as UI
Returns|Original-sale lookup refund limits and stock return|A repeated return cannot refund or receive the same quantity twice
Tax receipt|Applicable tax identifiers QR and fiscal status|Required tax data and acceptance state appear on receipt
Connectivity|Connected operation draft recovery and safe retry|Interrupted submission cannot duplicate sale stock or tender
Offline scope decision|Offline operating contract subject to D05 review|No offline promise is made before tax sync tender and oversell policies pass
'''),
('INV', 'Inventory', 'ACC-004', '''
Item masters|Stock service variants categories units and conversions|Invalid or ambiguous unit conversion is rejected
Stores and locations|Multiple warehouses bins custody and transfer routes|Stock ownership and location remain separate and traceable
Stock transactions|Opening receipt issue return adjustment and transfer|Each event produces the correct quantity and accounting effect once
Quick issue|Default store unit cost mapping destination and scan|An unfamiliar user issues one tissue box without choosing accounts
Reservation and release|Approval-before-release or authorized immediate issue policy|Pending release does not silently consume physical stock
Cost formulas|Specific identification FIFO and weighted average under policy|Similar nature and use checks prevent arbitrary formula selection
Cost policy transition|Effective date impact preview authorized migration and reconciliation|Historical valuation remains reproducible after an approved change
Traceability|Batch serial expiry genealogy and recall queries|A selected lot traces to receipts transfers production and issues
Counts and adjustments|Blind count variance review and cut-off|Count differences post only through authorized adjustment
Landed cost and valuation|Cost allocation NRV review slow stock and ageing|Inventory valuation agrees to GL with explained timing differences
Availability controls|Negative-stock policy concurrency and reservations|Two users cannot release the same last unit under no-negative policy
Replenishment|Minimum levels lead times reorder proposals and commitments|Proposed supply accounts for approved open orders and reservations
'''),
('AST', 'Fixed assets', 'ACC-004', '''
Register activation|Existing assets cost depreciation and GL mapping|Opening register agrees without rebooking acquisition
Acquisition and capitalization|Purchase project cost capital WIP and components|Capitalized amount agrees to source and allowed policy
Depreciation|Methods useful lives residual values start date and proration|Schedule agrees to independent examples and period locks
Custody and transfer|Location custodian tags and verification counts|Transfers preserve asset history and approved responsibility
Subsequent changes|Impairment revaluation repair split and reassessment|Accounting treatment and future schedule are versioned and authorized
Disposal|Sale scrap partial disposal gain loss and derecognition|Cost accumulated depreciation proceeds and gain or loss reconcile
Retirement controls|Stop new acquisitions while preserving future obligations|Depreciation and historical reporting have an explicit continuing owner
'''),
('MFG', 'Manufacturing', 'INV-003', '''
BOM versions|Multi-level BOM yields substitutions units and effective dates|An order preserves the BOM version used at release
Routes and capacity|Operations work centres calendars and feasible capacity views|Plan distinguishes available capacity from assumed capacity
Planning|Demand material requirements supply and work-order proposals|Requirements net approved stock commitments and open supply
Work orders|Release issue progress partial completion closure and reopening|Open WIP and remaining quantities agree to actual movements
Actual costing|Material labour overhead standard comparison and variance|Completed output plus remaining WIP reconciles to inputs and approved variance
Process loss and scrap|By-products recoverable scrap loss limits and treatment|Recovered material cannot be counted twice and excess loss is reviewed
Rework and quality|Hold inspection rework route and permitted disposition|Held output cannot be issued as available finished stock
Subcontracting|Supplier-held material service cost partial receipts and returns|Custody quantities and owned value reconcile at the vendor
Jewellery quantities|Gross fine metal purity stones units and conversion tolerance|Fine-metal reconciliation explains input output scrap and process loss
Jewellery ownership|Customer-owned material repair conversion and making charges|Customer material is tracked without inflating owned inventory
Genealogy and costing review|Lot lineage alternate inputs and closed-order adjustments|Reviewer traces finished cost to actual sources and approved corrections
Process boundaries|Explicit acceptance for each specialized production pattern|Unsupported regulated or optimized process is flagged during fit review
'''),
('HR', 'Human resources and payroll', 'ACC-004', '''
Organization and employees|Positions grades contracts employment type history and confidentiality|Authorized HR sees history while ordinary users cannot inspect pay data
Recruitment|Requisitions applicants interviews offers and hiring conversion|Candidate access and retention follow the approved policy
Onboarding and separation|Tasks document checklist probation exit and final settlement|Status changes trigger assigned tasks without silently deleting records
Shifts and calendars|Rotating shifts holidays overnight work timezone and rest rules|Overnight and holiday examples produce expected approved attendance
Attendance ingestion|Biometric web mobile import and manual source events|Duplicate source events do not duplicate attendance or earnings
Attendance adjudication|Missing punches conflicts corrections and manager approval|Payroll consumes the approved result and preserves its sources
Leave|Accrual eligibility carry-forward encashment and approval|Balances reconcile through leave year and effective policy changes
Compensation|Fixed variable hourly piece-rate overtime allowances and deductions|Formula engine handles independent complex pay examples without code injection
Benefits|Eligibility dependants contributions caps and effective dates|Benefit changes preserve prior-period calculations and privacy
Payroll engine|Proration arrears retro changes taxes contributions and rounding|Gross-to-net independently reconciles for supported employment cases
Payroll approval|Run snapshot variance review segregation payslips and GL|Approval binds exact inputs and a rerun cannot duplicate liabilities
Employee finance|Loans advances expenses recoveries and balances|Employee schedules agree to payroll deductions and control accounts
Settlement|Payroll payment records final settlement and liability reconciliation|Paid status follows evidence of settlement rather than preparation
Performance and learning|Goals appraisal cycles feedback skills and training records|Only permitted participants can view or change confidential feedback
Self service|Payslip leave attendance correction and personal details|Employee can access own records without accessing colleagues
Localization|Effective-dated Pakistan tax benefit and provincial employment coverage|Current approved rule pack and unsupported cases are visible
Long-term benefits|Gratuity pension provident-fund inputs and independently supplied valuations|Payroll and accounts reconcile to the approved benefit calculation basis
HR cases and development|Disciplinary cases confidential grievance records learning and succession fields|Sensitive cases remain restricted and retention is policy controlled
'''),
('PRJ', 'Projects and basic CRM', 'SAL-001', '''
Leads and opportunities|Contacts stages activities quotations and conversion|Conversion preserves references without duplicating the customer
Projects and tasks|Milestones assignments progress and documents|Users see only their permitted projects and responsibilities
Time and expenses|Timesheets billable status approvals and cost allocation|Approved entries flow once into project cost or billing
Budgets and commitments|Project budgets purchasing retention and variations|Actual committed and remaining amounts reconcile by dimension
Billing and margin|Milestone progress time billing and profitability|Revenue and cost reconcile to the ledger with stated recognition basis
'''),
('FIN', 'Financial management', 'ACC-004', '''
Cash position|Bank cash restricted balances and liquidity visibility|Displayed totals reconcile to source and identify stale bank data
Liquidity forecast|Thirteen-week actual committed and assumed cash scenarios|Stored scenario inputs reproduce the forecast exactly
Working capital|Receivable payable inventory cycles and improvement cases|Metric definitions and denominator periods are visible
Credit and collection|Limits exposure dispute priorities and collection proposals|Authoritative current balances govern limits rather than stale BI
Budget and variance|Versions dimensions drivers approvals and actual comparison|Variance reproduces from approved budget and stated ledger basis
Profitability and pricing|Product customer project contribution and break-even|Allocation assumptions and excluded costs remain visible
Debt and facilities|Drawdown interest repayment fees security and covenant schedules|Schedule agrees to contract inputs and GL liabilities
Trade finance|LC guarantees exposure expiry collateral and settlement tracking|Commitments and actual accounting recognition remain distinct
Risk exposures|FX commodity sensitivity concentration and policy limits|Exposure source prices and rate timestamps are traceable
Capital appraisal|NPV IRR payback scenarios and funding needs|Independent examples pass and ambiguous IRR is flagged
Finance oversight|Decision register assumptions approvals and action follow-up|A financial recommendation has an accountable decision owner
Execution boundary|Record or propose payments and finance actions initially|No funds transfer lending custody or dealing occurs without a separate project
'''),
('TAX', 'Tax and statutory localization', 'ACC-004', '''
Tax identity and applicability|Company registrations jurisdictions exemptions and effective dates|Applicable pack requirements cannot be disabled through invoice UI
Sales and purchase taxes|Rate versions inclusive exclusive recoverable and nonrecoverable treatment|Independent examples reconcile taxable base rounding and posting
Withholding|Deduction collection certificates party status and settlement schedules|Invoice receipt payment and withholding control accounts agree
Tax reconciliation|Return schedules input output withholding and ledger bridges|Every reported total traces to the relevant accepted documents
E-invoice obligations|Current FBR applicability licensed arrangement and required document status|Supported customer profile passes current sandbox and reconciliation cases
Corrections and cancellations|Authority-specific credit debit cancellation and amendment routes|Accepted tax invoices cannot be silently rewritten
Country pack lifecycle|Reviewed effective-dated rules current source and release notes|A law change preserves prior-period calculation basis
Compliance boundary|Supported entity province tax and employment cases plus missing coverage|Sales and onboarding flag unsupported statutory requirements before go-live
'''),
('RPT', 'Financial statements and BI', 'ACC-004', '''
Standard reports|GL trial balance cash flow balances ageing and registers|Reports agree to ledger at the specified cutoff
Statement mapping|Account and dimension mapping versions presentation and rounding|Unmapped balances are flagged before publication
Statement packs|Primary statements comparatives notes schedules and cross references|Cross-casts comparative checks and note links pass
Narrative notes|Policies commitments contingencies related parties and subsequent events|Unsubstantiated facts remain completion tasks rather than invented prose
Evidence drill-through|Statement to note to schedule to journal to attachment|Authorized reviewer can trace a selected balance end to end
Publication|Review signoff snapshot revision and reproducibility|A published version can be recreated after later mapping changes
Exports|PDF editable statements and complete data export|Routine statement preparation needs no external spreadsheet
Metric catalog|Governed definitions dimensions filters and calculated measures|Two reports using a metric agree on the same basis
BI builder|Saved dashboards tables charts filters and sharing|Permission checks apply to datasets fields exports and cached results
Report jobs|Scheduling heavy query limits progress and freshness|Large report does not starve posting and shows its as-of time
'''),
('CFG', 'Configuration and workflows', 'FND-007', '''
Capability activation|Dependency plan openings effective date and reconciliation|Activation cannot duplicate pre-existing ledger values
Capability retirement|Pending work schedules dependencies history and replacement treatment|Retirement preserves historical links and explains blockers
Policy builder|Thresholds conditions approvers delegation escalation and simulation|Admin previews above-below thresholds and unavailable approver cases
Policy versions|Effective dates and explicit in-flight treatment|Material changes invalidate or migrate prior approvals explicitly
Form builder|Typed fields lists required values visibility defaults and attachments|Core financial or security validation cannot be removed
Schema evolution|Form versions old record interpretation and safe publication|An old document remains readable after a field change
Print layouts|Constrained components image reference preview and sanitization|Generated layout cannot execute script or fetch unauthorized data
Configuration recovery|Preview diff audit rollback for future work and migration plan|Failed publication leaves the last valid configuration active
'''),
('DOC', 'Company Drive and evidence', 'FND-007', '''
Folders and access|Company folders role ACL inheritance and sensitivity|Folder sharing cannot expose protected transaction attachments
Object storage|Metadata versions hashes quarantine and signed access|Download is denied after access revocation even with cached metadata
Evidence links|One source object linked to permitted transactions|Deleting a shortcut does not destroy required evidence
Quotas|Plan storage metering retained versions warnings and limits|Quota enforcement is race safe and explains what counts
Deletion and retention|Soft delete holds recovery and authorized purge|Delete preview identifies affected records and legal or evidence holds
Search and retrieval|Permitted metadata content and document versions|Search snippets and AI retrieval respect the same access rules
'''),
('APP', 'APIs and Apps', 'FND-007', '''
API contracts|Versioned OpenAPI business commands examples typed errors and pagination|Developer completes sample invoice integration without reading source
API authority|Scoped credentials rotation revocation and per-tenant limits|Revocation stops queued work and no scope can cross companies
Safe mutation|Idempotency concurrency timeouts and transaction states|Retry with same key returns the original effect and changed payload conflicts
App registry|Standalone connectors and embedded actions with manifests|Installation shows permissions owner version and data use
App isolation|Separate origin UI sandbox worker limits and network restrictions|Malicious app cannot read another tenant or call internal metadata services
Events and webhooks|Signed at-least-once delivery replay control retries and dead-letter review|Duplicate reordered and delayed events reconcile without duplicate effects
Tax adapter|Canonical invoice external reference QR errors and reconciliation|Unknown submission outcome is resolved before a second external invoice
External commerce|Shopify-like orders stock payments refunds and mapping|External identifiers map once and settlement differences enter reconciliation
Developer sandbox|Sample app SDK guide fixtures and install diagnostics|Independent integrator can install test revoke and uninstall a sample app
Lifecycle|Compatibility review migration uninstall and preserved records|Uninstall revokes execution while retaining required financial evidence
'''),
('AI', 'AI tools memory and evaluation', 'FND-007', '''
Tool parity|All supported business functions expose scoped command tools|UI API and AI receive identical denial for the same forbidden action
Setup and COA|Business interview account templates mappings and amendments|Proposed setup shows assumptions dependencies and review before activation
Navigation and guidance|Contextual help against current permitted workspace|Answer never reveals hidden company or payroll information
Document extraction|Invoices receipts credits and journal evidence with source regions|Missing material fields are flagged and duplicate scans do not create drafts twice
Classification and entry|Document meaning account suggestions drafts and submission|Uncertain treatment abstains and configured approvals remain mandatory
Import assistance|Column mapping units normalization staging and reconciliation|Malformed rows stay visible and opening values cannot double post
Forms and workflows|Builder commands simulation and administrator publication|AI cannot weaken invariants or grant itself authority
Print and reports|Reference-based print schema BI and statement specification|Output uses permitted components and metrics and passes preview checks
Reconciliation assistance|Suggested bank matches close checklist and exception priorities|Suggestion cannot conceal unresolved differences or auto-certify correctness
Finance assistance|Scenario inputs commentary and evidence-linked recommendations|Calculations use deterministic engines and distinguish assumptions
Memory scopes|Private team company and approved-policy memories separate from evidence-linked company knowledge|Private facts never enter another user or company's context and shared facts preserve source sensitivity
Memory lifecycle|Inspection correction expiry retention deletion permission revocation and independent personal controls|Retrieval derived indexes cached context and in-flight answers honor current access corrected facts and disabled settings
Provider adapters|Capability matrix prompt tool and model versions regression|A provider switch cannot bypass task quality and permission gates
Cost governance|Tokens pages steps runtime concurrency and full-cost metering|Budget exhaustion stops visibly without leaving partial financial effects
Rollout controls|Internal opted-in general suspended and retired task flags|Kill switch preserves drafts audit and manual completion
Adversarial safety|Untrusted files prompts tool responses and memory injection tests|Injected instructions cannot authorize or expand a business action
Company knowledge model|Business identity activities people products relationships processes agreements decisions obligations and scoped facts|A company profile connects retained facts to permitted sources and identifies unprovided or unknown information
Exact evidence linkage|Stable source ID immutable version hash document identity protected excerpt and precise supporting location|Renaming or reusing a filename cannot redirect a fact's citation to a different document or version
Business change history|Fact versions valid times observation times correction supersession and actor or source history|Current and historical questions distinguish a corrected error from a genuine later business change
Knowledge refresh and coverage|Committed records eligible document versions source selection event retries processing failures and freshness|Changed sources refresh dependent knowledge without duplicate facts and incomplete or stale coverage is visible
Conflicting knowledge|Candidate inferred asserted accepted disputed and superseded facts with authorized review|A newer upload or remembered claim cannot silently override a governing contract or published policy
Knowledge enablement controls|Self-service authorized company controls independent personal controls and audited provider administration|Effective use respects operator availability company selection user authority and evidence permissions without entitlement overriding company-off
Knowledge disable and recovery|Stop capture refresh retrieval and context use with separate retention deletion and reactivation workflows|Disable invalidates queued cached and in-flight use and reactivation reconciles current versions and permissions without deleting source records
Derived knowledge protection|Source-sensitive facts relationships summaries citations and delivery-time authorization|Revoked or restricted evidence cannot leak through answers titles counts excerpts caches or historical knowledge
Knowledge inspection|Permitted company fact source and timeline views correction tasks and coverage diagnostics|Authorized user can inspect what is retained why it is believed and what remains incomplete without operator settings granting content access
'''),
('OPS', 'Portals subscription and operations', 'FND-001', '''
Application portal|Package selection company details bank-transfer evidence and status|Submission or screenshot alone cannot activate an app account
Verification and provisioning|Operator review receipt entitlement and nominated company admin|Provisioning retries cannot create duplicate companies or entitlements
Operator administration|Companies users quotas subscription dates features and support cases|Ordinary operator role cannot silently browse confidential business data
Subscription lifecycle|Renewal due notices grace restrictions and read-export policy|Expiry does not erase ledger attachments or audit history
Backups and restoration|Database objects configuration identity and work queues|Rehearsal demonstrates measured recovery and reconciled totals
Technical telemetry|Structured redacted logs metrics tracing alerts and error queues|Credentials and unnecessary payroll content never appear in routine logs
Support access|Own identity case scope expiry customer history and emergency review|Expired support authority blocks further access
Private deployment|Same artifacts migrations entitlements grace and responsibility matrix|Upgrade and expiry tests match documented supported behaviour
Performance and cells|Per-tenant limits asynchronous BI regional home and capacity measurement|Noisy neighbour and declared-load tests meet agreed budgets
Migration and releases|Expand migrate contract canary compatibility and recovery|Old records remain interpretable and destructive changes have verified recovery
'''),
('SEC', 'Security audit and assurance', 'FND-007', '''
Authentication|MFA operator sessions recovery step-up and secure cookies|Account recovery and privilege actions resist defined takeover tests
Tenant isolation|Database files cache jobs search exports and AI context|Cross-tenant and pooled-connection tests deny all defined attempts
Business audit|Actor initiator source reason before-after reference approval and outcome|Company reviewer traces a sample financial and configuration action
Audit access|Own activity company oversight and operator technical scopes|Sensitive fields remain protected even in logs and exports
Secret management|Server-side keys encryption rotation and redaction|No key enters browser bundle Git or routine diagnostic output
Secure development|Threat model dependency inventory scans and reviewed release artifacts|Material unresolved findings block public release
Incident response|Detection containment evidence recovery reconciliation and communication|A tabletop and restore exercise produces actionable evidence
Independent assurance|Scoped penetration test remediation and certification roadmap|Only obtained assurance is advertised and critical findings are resolved
Export and exit|Structured records attachments mappings and reconciliation|A sample export independently reconstructs accepted balances and evidence
'''),
('UX', 'Interface and accessibility', 'FND-009', '''
Themes and glass|Polished visible glass chrome with readable stable data surfaces|Light and dark review shows no gradient seam or contrast loss
Navigation|Collapsible sidebar separate Sales Purchases Reports BI Planning Finance and Apps|User can locate each destination in both sidebar states
Brand|SAVEN name official ESC emblem plum and ivory tokens|No provisional lion or obsolete product name appears in current application branding
Task interaction|Keyboard scanning touch quick actions drafts and visible states|Frequent small issue requires no AI chat or specialist instruction
Accessibility|WCAG 2.2 AA target focus labels contrast and reduced motion|Keyboard and assistive checks pass defined critical journeys
Responsive and weak network|Small screens long values errors progress and safe retry|Interrupted submissions preserve intent without duplicate effects
'''),
]

ADDITIONAL = {
'FND': '''
Ultimate business ownership|One protected ultimate owner and controlled delegated administration|Delegated administrators cannot remove the ultimate owner or create other administrators without the owner's authority
Resource-level controls|Customer supplier item account store and action-specific grants with preview and execution checks|A forbidden resource remains forbidden through forms APIs AI approvals and offline synchronization
''',
'ACC': '''
Accounting effects preview|Every journal-producing action previews debits credits and affected subledgers using current selected options|Credit invoice full receipt and bypass-receivable sale show different correct entries and stale previews cannot execute
Locked-entry correction oversight|Ultimate-owner controlled period exceptions with reason immutable correction history customer notification and email outbox|A locked entry cannot be silently overwritten and interrupted notification delivery cannot lose the audit event
''',
'DOC': '''
Transaction print templates|Versioned defaults for every transaction with copy edit and AI-assisted format creation|An edited copy preserves the original template and historical prints identify their template version
Email and scheduled delivery|Customer supplier document sharing reminders future delivery and cancellation|A retry sends no duplicate external message and permissions are rechecked at dispatch
Protected transaction evidence|Any allowed support type including spreadsheet workings becomes a protected versioned attachment|Folder delete permission cannot remove attached evidence and an authorized admin deletion logs and notifies the company
Drive space allocation|Business subscription quota user personal allocations and business-admin visibility within the company|Allocations cannot exceed the company limit and user access cannot escape the company
External file sharing|Revocable expiring public or password-protected links with optional download controls|Expired or revoked links fail and download restrictions do not imply protection against screenshots
''',
'POS': '''
Recipe-linked production sales|POS sale consumes designated recipe inputs records production and sells finished output in one controlled process|A burger sale consumes the correct ingredients once and insufficient ingredients or retry cannot partially post
Device connectors|Configured barcode scanners scales counters printers and other supported store or POS devices through scoped adapters|Duplicate or malformed device events cannot bypass quantity unit authority or posting validation
''',
'INV': '''
Retroactive costing|Explicit item policy for provisional issue costs later purchase costs and traceable cost adjustments|Later costs reconcile by linked adjustments with closed-period and historical-report handling rather than silent rewrites
Item valuation selection|Company defaults and item-category policies for FIFO weighted average and a requested separately governed LIFO option|Unsupported reporting-policy combinations are blocked and policy changes retain reproducible history
''',
'PRJ': '''
Project and product financial planning|Tasks milestones project and product budgets forecasts scenarios financials and performance|Forecast changes retain assumption versions and actuals reconcile to posted records without executing investments
''',
'OPS': '''
Submission conversion|Application frontend feeds operator review billing status and idempotent company and nominated-user provisioning|Accepted submitted data converts without re-entry and concurrent provisioning cannot create duplicate accounts
Prorated package changes|Immediate next-period or selected-date plan changes with versioned daily or period allocation rules|A mid-period example reconciles old and new charges using explicit timezone rounding tax and credit treatment
Manual and future card billing|Manual-transfer operation now with payment-adapter boundaries for later mixed card and manual customers|Repeated provider events cannot activate twice and manual receipt review cannot expose payment-card details
Entitlement administration|Operator controls for business user group and global features modules AI access and package gates|Effective access is the intersection of entitlement company choice user permission and operator availability with comprehensive logs
Support identity administration|Case-scoped attributed impersonation reset or invitation flows with customer visibility and no recoverable password access|Support cannot retrieve existing passwords and sensitive actions preserve real operator and represented user identities
Hosting portability|Cloudflare Workers database and buckets behind adapters with a supported self-hosted container path|The same financial contracts run across supported adapters and migration or recovery is rehearsed before production use
Resumable development|Durable build state changed-file records check outcomes blockers and remaining actions|A resumed development agent locates the current branch and incomplete work without repeating completed effects
Controlled offline application|Selected POS accounting inventory assets and manufacturing functions with signed grants scoped master-data creation and bidirectional sync|Replayed or conflicting commands cannot double post and expiry revocation reconciliation and lost-device cases are tested
''',
'AI': '''
Fixed named AI seats|Business seat allocation by named user with reassignment only after membership removal or approved period-end operator change|Four seats cannot be rotated between more than four active named users during the period
User and business usage|Per-request provider-reported tokens costs and separate daily user and company budgets across shared provider keys|Retries failures vision voice and unreported usage are distinguished and limits reserve budget before dispatch
Key and model routing|Platform business or user managed provider credentials multi-model adapters and custom-plan routing|Secrets remain server-side and a provider or customer key cannot expand tool authority or bypass evaluation gates
Document and voice inputs|Raw document and picture evidence plus speech-to-text with operator company and user controls|Transcription and extraction retain source links missing facts are flagged and disabled inputs cannot be invoked
Private operational metrics|Redacted task performance success failure latency cost and model/tool version reporting|Operators can improve the service without routine exposure of complete customer prompts files or payroll
Bounded business tool authority|Agent operations use the same authenticated business commands as the user with deterministic validation and approvals|A model or document instruction cannot inject a different actor company account grant or approval
''',
'SEC': '''
Single active account session|A successful new login replaces the previous active session across companies|The previous cookie fails on its next request and revocation is rechecked when a command executes
Password and login data design|Server-side one-way password hashing or a vetted identity provider secure recovery and no plaintext password storage|Database backups logs operator tools and the browser never expose recoverable user passwords
''',
}
GROUPS = [(prefix,family,dependency,rows+ADDITIONAL.get(prefix,'')) for prefix,family,dependency,rows in GROUPS]
from v2_requirements import ADDITIONS as V2_ADDITIONS, OVERRIDES as V2_OVERRIDES, PARENTS as V2_PARENTS
GROUPS=[(p,f,d,r+V2_ADDITIONS.get(p,'')) for p,f,d,r in GROUPS]
from v23_requirements import ADDITIONS as V23_ADDITIONS, OVERRIDES as V23_OVERRIDES, TITLES as V23_TITLES, PARENTS as V23_PARENTS
GROUPS=[(p,f,d,r+V23_ADDITIONS.get(p,'')) for p,f,d,r in GROUPS]
V2_OVERRIDES.update(V23_OVERRIDES)
V2_PARENTS.update(V23_PARENTS)
IN_PROGRESS = {'FND-001','FND-003','FND-004','FND-006','FND-007','FND-008','FND-009',
               'FND-011','FND-012','ACC-001','ACC-004','ACC-005','ACC-018','SAL-003','SAL-007',
               'INV-003','INV-004','INV-005','INV-011','AI-031','OPS-016','OPS-017','SEC-001',
               'SEC-002','SEC-003','SEC-010','UX-001','UX-002','UX-003','UX-004','UX-006'}
ACCOUNTING_EVIDENCE = {rid: ['docs/16-accounting-delivery.md','docs/17-accounting-requirement-status.md','docs/BUILD_STATE.md'] for rid in
                      ['ACC-001','ACC-002','ACC-003','ACC-004','ACC-005','ACC-006','ACC-007','ACC-011','ACC-012','ACC-018','SAL-006','SAL-007','PUR-004','PUR-006','PUR-008','RPT-001']}
ACCOUNTING_EVIDENCE['ACC-002']=['docs/18-opening-reconciliation.md','docs/17-accounting-requirement-status.md','docs/BUILD_STATE.md']
ACCOUNTING_EVIDENCE.update({rid:['docs/23-fixed-assets.md','docs/24-bookkeeping-module-map.md','docs/BUILD_STATE.md'] for rid in ['AST-002','AST-003','AST-006']})
ACCOUNTING_EVIDENCE.update({rid:['docs/25-invoices-taxes-settings.md','docs/24-bookkeeping-module-map.md','docs/BUILD_STATE.md'] for rid in ['SAL-003','PUR-004','TAX-001','TAX-002','TAX-004']})
ACCOUNTING_EVIDENCE.update({rid:['docs/32-product-wide-ui-ux-library.md','docs/BUILD_STATE.md'] for rid in ['UX-007','UX-008','UX-009']})
ACCOUNTING_EVIDENCE.update({rid:['docs/30-sqlite-bi-and-metric-catalog.md','docs/BUILD_STATE.md'] for rid in ['RPT-011','RPT-012']})
IN_PROGRESS.update(ACCOUNTING_EVIDENCE)

def build():
    requirements=[]
    for prefix,family,dependency,rows in GROUPS:
        for n,line in enumerate((row for row in rows.strip().splitlines() if row.strip()),1):
            title,scope,acceptance=line.split('|')
            scope=V2_OVERRIDES.get(f'{prefix}-{n:03d}',scope)
            title=V23_TITLES.get(f'{prefix}-{n:03d}',title)
            requirements.append(dict(id=f'{prefix}-{n:03d}',family=family,title=title,
                supported_scope=scope,acceptance=acceptance,commercial_release='required',
                design_status='brief mapped',parent_requirements=V2_PARENTS.get(f'{prefix}-{n:03d}',[]),
                governing_source='docs/sources/SAVEN-mandate-v2.3.md',
                status='in progress' if f'{prefix}-{n:03d}' in IN_PROGRESS else 'specified',dependencies=KNOWLEDGE_DEPENDENCIES.get(f'{prefix}-{n:03d}', [dependency] if dependency else []),
                evidence=ACCOUNTING_EVIDENCE.get(f'{prefix}-{n:03d}',['docs/12-foundation.md']) if f'{prefix}-{n:03d}' in IN_PROGRESS else [],approval='Scope includes owner additions of 11 November; unresolved policy decisions remain explicit'))
    data={'product':'SAVEN','display_brand':'SA7EN','pronunciation':'seven','baseline':'2.3','date':'2026-11-13',
          'meaning':'Specified requirements are not implemented features. Public launch requires agreed family gates.',
          'requirements':requirements}
    (ROOT/'docs/feature-catalog.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
    lines=['# SAVEN Feature and Acceptance Library','','13 November 2026 | Baseline 2.3','',
           f'{len(requirements)} requirements across {len(GROUPS)} families. The JSON tracks specified and in-progress work. In-progress work is partial, not release verification; see docs/BUILD_STATE.md and the evidence links in each JSON record for current limits. The v2 mandate supersedes conflicting historical decisions; design_status is separate from implementation status.','',
           'Dependencies identify foundation prerequisites; complete domain dependencies must be refined during implementation. Commercial scope is required unless an explicit reviewed decision changes it. AI exposure may remain internal or opted in until its task gates pass.','']
    for _,family,_,_ in GROUPS:
        lines += ['## '+family,'','| ID | Capability and supported scope | Acceptance condition |','| --- | --- | --- |']
        for r in requirements:
            if r['family']==family:
                lines.append(f"| {r['id']} | {r['title']}: {r['supported_scope']} | {r['acceptance']} |")
        lines.append('')
    (ROOT/'docs/05-feature-library.md').write_text('\n'.join(lines),encoding='utf-8')
    print(f'{len(requirements)} requirements across {len(GROUPS)} families')

if __name__=='__main__':
    build()

