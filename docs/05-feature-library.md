# SAVEN Feature and Acceptance Library

11 November 2026 | Baseline 1.2

239 requirements across 20 families. The JSON tracks specified and in-progress work. In-progress work is partial, not release verification; see docs/BUILD_STATE.md and the evidence links in each JSON record for current limits. This catalog and decisions D01 to D12 define supported scope for review.

Dependencies identify foundation prerequisites; complete domain dependencies must be refined during implementation. Commercial scope is required unless an explicit reviewed decision changes it. AI exposure may remain internal or opted in until its task gates pass.

## Business foundation

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| FND-001 | Tenant and company identity: Organization subscription and explicit legal-company membership | A user in company A cannot read or reference company B records |
| FND-002 | Dimensions: Branches departments projects stores and cost centres | A report filters and reconciles each permitted dimension |
| FND-003 | Currencies and precision: Decimal money quantities exchange rates and rounding policies | Boundary and conversion examples agree to independently calculated results |
| FND-004 | Periods and dates: Financial years business dates timezones and locks | Every entry route rejects a locked period |
| FND-005 | Numbering: Scoped unique document series with concurrency control | Simultaneous submissions cannot duplicate a document number |
| FND-006 | Membership lifecycle: Invite suspend revoke recover and switch companies | Revocation blocks new requests queued actions and downloads |
| FND-007 | Permissions: Roles row scopes field sensitivity and effective-access preview | Preview agrees with allow and deny tests |
| FND-008 | Delegated administration: Company superadmin and module administrator grants | Delegation cannot exceed grantor authority or cross companies |
| FND-009 | Workspace configuration: Role navigation quick actions and personal preferences | Hidden menus do not grant or revoke business authority |
| FND-010 | Localization packs: Versioned language reporting tax and employment configuration | Unsupported pack rules are visible before activation |
| FND-011 | Ultimate business ownership: One protected ultimate owner and controlled delegated administration | Delegated administrators cannot remove the ultimate owner or create other administrators without the owner's authority |
| FND-012 | Resource-level controls: Customer supplier item account store and action-specific grants with preview and execution checks | A forbidden resource remains forbidden through forms APIs AI approvals and offline synchronization |

## Accounting and close

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| ACC-001 | Chart of accounts: Templates hierarchy account types control accounts and effective-dated changes | Used accounts cannot be deleted or retyped without controlled treatment |
| ACC-002 | Opening position: Trial balance dimensions evidence and subledger links | Opening control accounts agree without duplicate recognition |
| ACC-003 | Journal preparation: Manual recurring accrual prepayment allocation and reversal | Required evidence and allowed dimensions are validated |
| ACC-004 | Posting kernel: Balanced atomic immutable effects and linked correction | Failure produces no partial journal and retries post once |
| ACC-005 | Period controls: Close checklist lock authorized reopening and subsequent adjustment | Reopening leaves reason actor approval and previous report version |
| ACC-006 | Cash and bank: Cashbooks transfers petty cash receipts and payment records | Both sides of a transfer reconcile without duplicate cash |
| ACC-007 | Bank reconciliation: Statement import matching exceptions and duplicate checks | Statement balance agrees to reconciled book balance with explained items |
| ACC-008 | Foreign currency: Transaction rates settlement gains and period remeasurement | Realized and unrealized balances reproduce from stored rates |
| ACC-009 | Intercompany: Reciprocal documents and due-to due-from reconciliation | Authorized cross-company process detects unmatched reciprocal balances |
| ACC-010 | Consolidation: Mapped group reports eliminations and translation in agreed scope | Consolidated totals reconcile to companies plus approved eliminations |
| ACC-011 | Close controls: Control accounts suspense unusual entries and missing evidence | Reviewer can resolve or explain every close blocker |
| ACC-012 | Correction history: Reversal credit adjustment and audit references | Original entry remains readable and all later effects are traceable |
| ACC-013 | Revenue and contract balances: Milestones deferred income retention and approved recognition schedules | Recognition and contract balances reproduce from supported policy examples |
| ACC-014 | Provisions and credit losses: Receivable impairment provisions estimates and authorized reversals | Estimate inputs approval and later utilization remain traceable |
| ACC-015 | Lease schedules: Supported lessee contracts interest depreciation modifications and disclosures | Schedule agrees to approved reporting-policy examples and GL |
| ACC-016 | Tax accounting schedules: Current and deferred tax workpapers temporary differences and reviewed entries | Schedules reconcile to approved tax calculations without an automatic compliance claim |
| ACC-017 | Financial and equity schedules: Supported investments debt equity movements and distributions | Classification measurement basis and approval are explicit for each supported instrument |
| ACC-018 | Accounting effects preview: Every journal-producing action previews debits credits and affected subledgers using current selected options | Credit invoice full receipt and bypass-receivable sale show different correct entries and stale previews cannot execute |
| ACC-019 | Locked-entry correction oversight: Ultimate-owner controlled period exceptions with reason immutable correction history customer notification and email outbox | A locked entry cannot be silently overwritten and interrupted notification delivery cannot lose the audit event |

## Sales and receivables

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| SAL-001 | Customer records: Contacts terms credit limits addresses and tax identity | Duplicate and credit-policy checks run before submission |
| SAL-002 | Quotations and orders: Optional acceptance and order steps | A company can invoice services without order or delivery paperwork |
| SAL-003 | Service and goods invoices: Direct and linked invoices with tax discounts and dimensions | One invoice creates the expected receivable revenue tax and stock effects |
| SAL-004 | Fulfilment: Partial delivery backorders reservations and returns | Delivered billed and remaining quantities agree |
| SAL-005 | Recurring billing: Schedules end dates pauses and exception review | A retry cannot create a second invoice for the same period |
| SAL-006 | Credit and refund: Linked credit notes returns and authorized refund records | Credit cannot silently exceed permitted original value or quantity |
| SAL-007 | Receipts and allocation: Partial receipts advances withholding and unapplied balances | Customer balance agrees to invoices credits and allocations |
| SAL-008 | Receivables oversight: Ageing statements collection tasks and disputed balances | Ageing agrees to control account at the stated as-of date |

## Purchases and payables

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| PUR-001 | Supplier records: Terms bank details tax identity and controlled bank changes | A sensitive bank-detail change has authority and an audit record |
| PUR-002 | Requisitions and orders: Optional purchase request approval and order commitments | Unapproved requests do not create approved commitments |
| PUR-003 | Goods and service receipt: Physical receipts and service acceptance are distinct | Service acceptance does not invent stock movements |
| PUR-004 | Supplier bills: Direct or matched bills duplicate checks and evidence | Duplicate supplier reference is flagged before a second liability |
| PUR-005 | Matching: Configurable two-way and three-way quantity price and tolerance rules | Out-of-tolerance bills enter the configured exception route |
| PUR-006 | Adjustments: Supplier credits returns landed costs and price differences | Inventory or expense and payable adjustments reconcile |
| PUR-007 | Payment proposals: Due-date priorities cash constraints approvals and export | A proposal does not itself transfer funds or mark settlement |
| PUR-008 | Payable oversight: Ageing statements advances retention and reconciliation | Supplier schedule agrees to the payable control account |

## Point of sale

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| POS-001 | Fast sale: Barcode keyboard search touch quantity pricing and receipt | Cashier completes a normal sale without AI or ledger selection |
| POS-002 | Till sessions: Cashier assignment opening float cash movements and close | Expected cash agrees to tenders and reviewed count differences |
| POS-003 | Tenders: Cash bank card reference split tenders and change | Tender total agrees to sale and external settlement differences are visible |
| POS-004 | Discount and override: Threshold authority price overrides and reason | Unauthorized discounts are denied by API as well as UI |
| POS-005 | Returns: Original-sale lookup refund limits and stock return | A repeated return cannot refund or receive the same quantity twice |
| POS-006 | Tax receipt: Applicable tax identifiers QR and fiscal status | Required tax data and acceptance state appear on receipt |
| POS-007 | Connectivity: Connected operation draft recovery and safe retry | Interrupted submission cannot duplicate sale stock or tender |
| POS-008 | Offline scope decision: Offline operating contract subject to D05 review | No offline promise is made before tax sync tender and oversell policies pass |
| POS-009 | Recipe-linked production sales: POS sale consumes designated recipe inputs records production and sells finished output in one controlled process | A burger sale consumes the correct ingredients once and insufficient ingredients or retry cannot partially post |
| POS-010 | Device connectors: Configured barcode scanners scales counters printers and other supported store or POS devices through scoped adapters | Duplicate or malformed device events cannot bypass quantity unit authority or posting validation |

## Inventory

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| INV-001 | Item masters: Stock service variants categories units and conversions | Invalid or ambiguous unit conversion is rejected |
| INV-002 | Stores and locations: Multiple warehouses bins custody and transfer routes | Stock ownership and location remain separate and traceable |
| INV-003 | Stock transactions: Opening receipt issue return adjustment and transfer | Each event produces the correct quantity and accounting effect once |
| INV-004 | Quick issue: Default store unit cost mapping destination and scan | An unfamiliar user issues one tissue box without choosing accounts |
| INV-005 | Reservation and release: Approval-before-release or authorized immediate issue policy | Pending release does not silently consume physical stock |
| INV-006 | Cost formulas: Specific identification FIFO and weighted average under policy | Similar nature and use checks prevent arbitrary formula selection |
| INV-007 | Cost policy transition: Effective date impact preview authorized migration and reconciliation | Historical valuation remains reproducible after an approved change |
| INV-008 | Traceability: Batch serial expiry genealogy and recall queries | A selected lot traces to receipts transfers production and issues |
| INV-009 | Counts and adjustments: Blind count variance review and cut-off | Count differences post only through authorized adjustment |
| INV-010 | Landed cost and valuation: Cost allocation NRV review slow stock and ageing | Inventory valuation agrees to GL with explained timing differences |
| INV-011 | Availability controls: Negative-stock policy concurrency and reservations | Two users cannot release the same last unit under no-negative policy |
| INV-012 | Replenishment: Minimum levels lead times reorder proposals and commitments | Proposed supply accounts for approved open orders and reservations |
| INV-013 | Retroactive costing: Explicit item policy for provisional issue costs later purchase costs and traceable cost adjustments | Later costs reconcile by linked adjustments with closed-period and historical-report handling rather than silent rewrites |
| INV-014 | Item valuation selection: Company defaults and item-category policies for FIFO weighted average and a requested separately governed LIFO option | Unsupported reporting-policy combinations are blocked and policy changes retain reproducible history |

## Fixed assets

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| AST-001 | Register activation: Existing assets cost depreciation and GL mapping | Opening register agrees without rebooking acquisition |
| AST-002 | Acquisition and capitalization: Purchase project cost capital WIP and components | Capitalized amount agrees to source and allowed policy |
| AST-003 | Depreciation: Methods useful lives residual values start date and proration | Schedule agrees to independent examples and period locks |
| AST-004 | Custody and transfer: Location custodian tags and verification counts | Transfers preserve asset history and approved responsibility |
| AST-005 | Subsequent changes: Impairment revaluation repair split and reassessment | Accounting treatment and future schedule are versioned and authorized |
| AST-006 | Disposal: Sale scrap partial disposal gain loss and derecognition | Cost accumulated depreciation proceeds and gain or loss reconcile |
| AST-007 | Retirement controls: Stop new acquisitions while preserving future obligations | Depreciation and historical reporting have an explicit continuing owner |

## Manufacturing

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| MFG-001 | BOM versions: Multi-level BOM yields substitutions units and effective dates | An order preserves the BOM version used at release |
| MFG-002 | Routes and capacity: Operations work centres calendars and feasible capacity views | Plan distinguishes available capacity from assumed capacity |
| MFG-003 | Planning: Demand material requirements supply and work-order proposals | Requirements net approved stock commitments and open supply |
| MFG-004 | Work orders: Release issue progress partial completion closure and reopening | Open WIP and remaining quantities agree to actual movements |
| MFG-005 | Actual costing: Material labour overhead standard comparison and variance | Completed output plus remaining WIP reconciles to inputs and approved variance |
| MFG-006 | Process loss and scrap: By-products recoverable scrap loss limits and treatment | Recovered material cannot be counted twice and excess loss is reviewed |
| MFG-007 | Rework and quality: Hold inspection rework route and permitted disposition | Held output cannot be issued as available finished stock |
| MFG-008 | Subcontracting: Supplier-held material service cost partial receipts and returns | Custody quantities and owned value reconcile at the vendor |
| MFG-009 | Jewellery quantities: Gross fine metal purity stones units and conversion tolerance | Fine-metal reconciliation explains input output scrap and process loss |
| MFG-010 | Jewellery ownership: Customer-owned material repair conversion and making charges | Customer material is tracked without inflating owned inventory |
| MFG-011 | Genealogy and costing review: Lot lineage alternate inputs and closed-order adjustments | Reviewer traces finished cost to actual sources and approved corrections |
| MFG-012 | Process boundaries: Explicit acceptance for each specialized production pattern | Unsupported regulated or optimized process is flagged during fit review |

## Human resources and payroll

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| HR-001 | Organization and employees: Positions grades contracts employment type history and confidentiality | Authorized HR sees history while ordinary users cannot inspect pay data |
| HR-002 | Recruitment: Requisitions applicants interviews offers and hiring conversion | Candidate access and retention follow the approved policy |
| HR-003 | Onboarding and separation: Tasks document checklist probation exit and final settlement | Status changes trigger assigned tasks without silently deleting records |
| HR-004 | Shifts and calendars: Rotating shifts holidays overnight work timezone and rest rules | Overnight and holiday examples produce expected approved attendance |
| HR-005 | Attendance ingestion: Biometric web mobile import and manual source events | Duplicate source events do not duplicate attendance or earnings |
| HR-006 | Attendance adjudication: Missing punches conflicts corrections and manager approval | Payroll consumes the approved result and preserves its sources |
| HR-007 | Leave: Accrual eligibility carry-forward encashment and approval | Balances reconcile through leave year and effective policy changes |
| HR-008 | Compensation: Fixed variable hourly piece-rate overtime allowances and deductions | Formula engine handles independent complex pay examples without code injection |
| HR-009 | Benefits: Eligibility dependants contributions caps and effective dates | Benefit changes preserve prior-period calculations and privacy |
| HR-010 | Payroll engine: Proration arrears retro changes taxes contributions and rounding | Gross-to-net independently reconciles for supported employment cases |
| HR-011 | Payroll approval: Run snapshot variance review segregation payslips and GL | Approval binds exact inputs and a rerun cannot duplicate liabilities |
| HR-012 | Employee finance: Loans advances expenses recoveries and balances | Employee schedules agree to payroll deductions and control accounts |
| HR-013 | Settlement: Payroll payment records final settlement and liability reconciliation | Paid status follows evidence of settlement rather than preparation |
| HR-014 | Performance and learning: Goals appraisal cycles feedback skills and training records | Only permitted participants can view or change confidential feedback |
| HR-015 | Self service: Payslip leave attendance correction and personal details | Employee can access own records without accessing colleagues |
| HR-016 | Localization: Effective-dated Pakistan tax benefit and provincial employment coverage | Current approved rule pack and unsupported cases are visible |
| HR-017 | Long-term benefits: Gratuity pension provident-fund inputs and independently supplied valuations | Payroll and accounts reconcile to the approved benefit calculation basis |
| HR-018 | HR cases and development: Disciplinary cases confidential grievance records learning and succession fields | Sensitive cases remain restricted and retention is policy controlled |

## Projects and basic CRM

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| PRJ-001 | Leads and opportunities: Contacts stages activities quotations and conversion | Conversion preserves references without duplicating the customer |
| PRJ-002 | Projects and tasks: Milestones assignments progress and documents | Users see only their permitted projects and responsibilities |
| PRJ-003 | Time and expenses: Timesheets billable status approvals and cost allocation | Approved entries flow once into project cost or billing |
| PRJ-004 | Budgets and commitments: Project budgets purchasing retention and variations | Actual committed and remaining amounts reconcile by dimension |
| PRJ-005 | Billing and margin: Milestone progress time billing and profitability | Revenue and cost reconcile to the ledger with stated recognition basis |
| PRJ-006 | Project and product financial planning: Tasks milestones project and product budgets forecasts scenarios financials and performance | Forecast changes retain assumption versions and actuals reconcile to posted records without executing investments |

## Financial management

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| FIN-001 | Cash position: Bank cash restricted balances and liquidity visibility | Displayed totals reconcile to source and identify stale bank data |
| FIN-002 | Liquidity forecast: Thirteen-week actual committed and assumed cash scenarios | Stored scenario inputs reproduce the forecast exactly |
| FIN-003 | Working capital: Receivable payable inventory cycles and improvement cases | Metric definitions and denominator periods are visible |
| FIN-004 | Credit and collection: Limits exposure dispute priorities and collection proposals | Authoritative current balances govern limits rather than stale BI |
| FIN-005 | Budget and variance: Versions dimensions drivers approvals and actual comparison | Variance reproduces from approved budget and stated ledger basis |
| FIN-006 | Profitability and pricing: Product customer project contribution and break-even | Allocation assumptions and excluded costs remain visible |
| FIN-007 | Debt and facilities: Drawdown interest repayment fees security and covenant schedules | Schedule agrees to contract inputs and GL liabilities |
| FIN-008 | Trade finance: LC guarantees exposure expiry collateral and settlement tracking | Commitments and actual accounting recognition remain distinct |
| FIN-009 | Risk exposures: FX commodity sensitivity concentration and policy limits | Exposure source prices and rate timestamps are traceable |
| FIN-010 | Capital appraisal: NPV IRR payback scenarios and funding needs | Independent examples pass and ambiguous IRR is flagged |
| FIN-011 | Finance oversight: Decision register assumptions approvals and action follow-up | A financial recommendation has an accountable decision owner |
| FIN-012 | Execution boundary: Record or propose payments and finance actions initially | No funds transfer lending custody or dealing occurs without a separate project |

## Tax and statutory localization

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| TAX-001 | Tax identity and applicability: Company registrations jurisdictions exemptions and effective dates | Applicable pack requirements cannot be disabled through invoice UI |
| TAX-002 | Sales and purchase taxes: Rate versions inclusive exclusive recoverable and nonrecoverable treatment | Independent examples reconcile taxable base rounding and posting |
| TAX-003 | Withholding: Deduction collection certificates party status and settlement schedules | Invoice receipt payment and withholding control accounts agree |
| TAX-004 | Tax reconciliation: Return schedules input output withholding and ledger bridges | Every reported total traces to the relevant accepted documents |
| TAX-005 | E-invoice obligations: Current FBR applicability licensed arrangement and required document status | Supported customer profile passes current sandbox and reconciliation cases |
| TAX-006 | Corrections and cancellations: Authority-specific credit debit cancellation and amendment routes | Accepted tax invoices cannot be silently rewritten |
| TAX-007 | Country pack lifecycle: Reviewed effective-dated rules current source and release notes | A law change preserves prior-period calculation basis |
| TAX-008 | Compliance boundary: Supported entity province tax and employment cases plus missing coverage | Sales and onboarding flag unsupported statutory requirements before go-live |

## Financial statements and BI

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| RPT-001 | Standard reports: GL trial balance cash flow balances ageing and registers | Reports agree to ledger at the specified cutoff |
| RPT-002 | Statement mapping: Account and dimension mapping versions presentation and rounding | Unmapped balances are flagged before publication |
| RPT-003 | Statement packs: Primary statements comparatives notes schedules and cross references | Cross-casts comparative checks and note links pass |
| RPT-004 | Narrative notes: Policies commitments contingencies related parties and subsequent events | Unsubstantiated facts remain completion tasks rather than invented prose |
| RPT-005 | Evidence drill-through: Statement to note to schedule to journal to attachment | Authorized reviewer can trace a selected balance end to end |
| RPT-006 | Publication: Review signoff snapshot revision and reproducibility | A published version can be recreated after later mapping changes |
| RPT-007 | Exports: PDF editable statements and complete data export | Routine statement preparation needs no external spreadsheet |
| RPT-008 | Metric catalog: Governed definitions dimensions filters and calculated measures | Two reports using a metric agree on the same basis |
| RPT-009 | BI builder: Saved dashboards tables charts filters and sharing | Permission checks apply to datasets fields exports and cached results |
| RPT-010 | Report jobs: Scheduling heavy query limits progress and freshness | Large report does not starve posting and shows its as-of time |

## Configuration and workflows

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| CFG-001 | Capability activation: Dependency plan openings effective date and reconciliation | Activation cannot duplicate pre-existing ledger values |
| CFG-002 | Capability retirement: Pending work schedules dependencies history and replacement treatment | Retirement preserves historical links and explains blockers |
| CFG-003 | Policy builder: Thresholds conditions approvers delegation escalation and simulation | Admin previews above-below thresholds and unavailable approver cases |
| CFG-004 | Policy versions: Effective dates and explicit in-flight treatment | Material changes invalidate or migrate prior approvals explicitly |
| CFG-005 | Form builder: Typed fields lists required values visibility defaults and attachments | Core financial or security validation cannot be removed |
| CFG-006 | Schema evolution: Form versions old record interpretation and safe publication | An old document remains readable after a field change |
| CFG-007 | Print layouts: Constrained components image reference preview and sanitization | Generated layout cannot execute script or fetch unauthorized data |
| CFG-008 | Configuration recovery: Preview diff audit rollback for future work and migration plan | Failed publication leaves the last valid configuration active |

## Company Drive and evidence

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| DOC-001 | Folders and access: Company folders role ACL inheritance and sensitivity | Folder sharing cannot expose protected transaction attachments |
| DOC-002 | Object storage: Metadata versions hashes quarantine and signed access | Download is denied after access revocation even with cached metadata |
| DOC-003 | Evidence links: One source object linked to permitted transactions | Deleting a shortcut does not destroy required evidence |
| DOC-004 | Quotas: Plan storage metering retained versions warnings and limits | Quota enforcement is race safe and explains what counts |
| DOC-005 | Deletion and retention: Soft delete holds recovery and authorized purge | Delete preview identifies affected records and legal or evidence holds |
| DOC-006 | Search and retrieval: Permitted metadata content and document versions | Search snippets and AI retrieval respect the same access rules |
| DOC-007 | Transaction print templates: Versioned defaults for every transaction with copy edit and AI-assisted format creation | An edited copy preserves the original template and historical prints identify their template version |
| DOC-008 | Email and scheduled delivery: Customer supplier document sharing reminders future delivery and cancellation | A retry sends no duplicate external message and permissions are rechecked at dispatch |
| DOC-009 | Protected transaction evidence: Any allowed support type including spreadsheet workings becomes a protected versioned attachment | Folder delete permission cannot remove attached evidence and an authorized admin deletion logs and notifies the company |
| DOC-010 | Drive space allocation: Business subscription quota user personal allocations and business-admin visibility within the company | Allocations cannot exceed the company limit and user access cannot escape the company |
| DOC-011 | External file sharing: Revocable expiring public or password-protected links with optional download controls | Expired or revoked links fail and download restrictions do not imply protection against screenshots |

## APIs and Apps

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| APP-001 | API contracts: Versioned OpenAPI business commands examples typed errors and pagination | Developer completes sample invoice integration without reading source |
| APP-002 | API authority: Scoped credentials rotation revocation and per-tenant limits | Revocation stops queued work and no scope can cross companies |
| APP-003 | Safe mutation: Idempotency concurrency timeouts and transaction states | Retry with same key returns the original effect and changed payload conflicts |
| APP-004 | App registry: Standalone connectors and embedded actions with manifests | Installation shows permissions owner version and data use |
| APP-005 | App isolation: Separate origin UI sandbox worker limits and network restrictions | Malicious app cannot read another tenant or call internal metadata services |
| APP-006 | Events and webhooks: Signed at-least-once delivery replay control retries and dead-letter review | Duplicate reordered and delayed events reconcile without duplicate effects |
| APP-007 | Tax adapter: Canonical invoice external reference QR errors and reconciliation | Unknown submission outcome is resolved before a second external invoice |
| APP-008 | External commerce: Shopify-like orders stock payments refunds and mapping | External identifiers map once and settlement differences enter reconciliation |
| APP-009 | Developer sandbox: Sample app SDK guide fixtures and install diagnostics | Independent integrator can install test revoke and uninstall a sample app |
| APP-010 | Lifecycle: Compatibility review migration uninstall and preserved records | Uninstall revokes execution while retaining required financial evidence |

## AI tools memory and evaluation

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| AI-001 | Tool parity: All supported business functions expose scoped command tools | UI API and AI receive identical denial for the same forbidden action |
| AI-002 | Setup and COA: Business interview account templates mappings and amendments | Proposed setup shows assumptions dependencies and review before activation |
| AI-003 | Navigation and guidance: Contextual help against current permitted workspace | Answer never reveals hidden company or payroll information |
| AI-004 | Document extraction: Invoices receipts credits and journal evidence with source regions | Missing material fields are flagged and duplicate scans do not create drafts twice |
| AI-005 | Classification and entry: Document meaning account suggestions drafts and submission | Uncertain treatment abstains and configured approvals remain mandatory |
| AI-006 | Import assistance: Column mapping units normalization staging and reconciliation | Malformed rows stay visible and opening values cannot double post |
| AI-007 | Forms and workflows: Builder commands simulation and administrator publication | AI cannot weaken invariants or grant itself authority |
| AI-008 | Print and reports: Reference-based print schema BI and statement specification | Output uses permitted components and metrics and passes preview checks |
| AI-009 | Reconciliation assistance: Suggested bank matches close checklist and exception priorities | Suggestion cannot conceal unresolved differences or auto-certify correctness |
| AI-010 | Finance assistance: Scenario inputs commentary and evidence-linked recommendations | Calculations use deterministic engines and distinguish assumptions |
| AI-011 | Memory scopes: Private team company and approved-policy memories separate from evidence-linked company knowledge | Private facts never enter another user or company's context and shared facts preserve source sensitivity |
| AI-012 | Memory lifecycle: Inspection correction expiry retention deletion permission revocation and independent personal controls | Retrieval derived indexes cached context and in-flight answers honor current access corrected facts and disabled settings |
| AI-013 | Provider adapters: Capability matrix prompt tool and model versions regression | A provider switch cannot bypass task quality and permission gates |
| AI-014 | Cost governance: Tokens pages steps runtime concurrency and full-cost metering | Budget exhaustion stops visibly without leaving partial financial effects |
| AI-015 | Rollout controls: Internal opted-in general suspended and retired task flags | Kill switch preserves drafts audit and manual completion |
| AI-016 | Adversarial safety: Untrusted files prompts tool responses and memory injection tests | Injected instructions cannot authorize or expand a business action |
| AI-017 | Company knowledge model: Business identity activities people products relationships processes agreements decisions obligations and scoped facts | A company profile connects retained facts to permitted sources and identifies unprovided or unknown information |
| AI-018 | Exact evidence linkage: Stable source ID immutable version hash document identity protected excerpt and precise supporting location | Renaming or reusing a filename cannot redirect a fact's citation to a different document or version |
| AI-019 | Business change history: Fact versions valid times observation times correction supersession and actor or source history | Current and historical questions distinguish a corrected error from a genuine later business change |
| AI-020 | Knowledge refresh and coverage: Committed records eligible document versions source selection event retries processing failures and freshness | Changed sources refresh dependent knowledge without duplicate facts and incomplete or stale coverage is visible |
| AI-021 | Conflicting knowledge: Candidate inferred asserted accepted disputed and superseded facts with authorized review | A newer upload or remembered claim cannot silently override a governing contract or published policy |
| AI-022 | Knowledge enablement controls: Self-service authorized company controls independent personal controls and audited provider administration | Effective use respects operator availability company selection user authority and evidence permissions without entitlement overriding company-off |
| AI-023 | Knowledge disable and recovery: Stop capture refresh retrieval and context use with separate retention deletion and reactivation workflows | Disable invalidates queued cached and in-flight use and reactivation reconciles current versions and permissions without deleting source records |
| AI-024 | Derived knowledge protection: Source-sensitive facts relationships summaries citations and delivery-time authorization | Revoked or restricted evidence cannot leak through answers titles counts excerpts caches or historical knowledge |
| AI-025 | Knowledge inspection: Permitted company fact source and timeline views correction tasks and coverage diagnostics | Authorized user can inspect what is retained why it is believed and what remains incomplete without operator settings granting content access |
| AI-026 | Fixed named AI seats: Business seat allocation by named user with reassignment only after membership removal or approved period-end operator change | Four seats cannot be rotated between more than four active named users during the period |
| AI-027 | User and business usage: Per-request provider-reported tokens costs and separate daily user and company budgets across shared provider keys | Retries failures vision voice and unreported usage are distinguished and limits reserve budget before dispatch |
| AI-028 | Key and model routing: Platform business or user managed provider credentials multi-model adapters and custom-plan routing | Secrets remain server-side and a provider or customer key cannot expand tool authority or bypass evaluation gates |
| AI-029 | Document and voice inputs: Raw document and picture evidence plus speech-to-text with operator company and user controls | Transcription and extraction retain source links missing facts are flagged and disabled inputs cannot be invoked |
| AI-030 | Private operational metrics: Redacted task performance success failure latency cost and model/tool version reporting | Operators can improve the service without routine exposure of complete customer prompts files or payroll |
| AI-031 | Bounded business tool authority: Agent operations use the same authenticated business commands as the user with deterministic validation and approvals | A model or document instruction cannot inject a different actor company account grant or approval |

## Portals subscription and operations

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| OPS-001 | Application portal: Package selection company details bank-transfer evidence and status | Submission or screenshot alone cannot activate an app account |
| OPS-002 | Verification and provisioning: Operator review receipt entitlement and nominated company admin | Provisioning retries cannot create duplicate companies or entitlements |
| OPS-003 | Operator administration: Companies users quotas subscription dates features and support cases | Ordinary operator role cannot silently browse confidential business data |
| OPS-004 | Subscription lifecycle: Renewal due notices grace restrictions and read-export policy | Expiry does not erase ledger attachments or audit history |
| OPS-005 | Backups and restoration: Database objects configuration identity and work queues | Rehearsal demonstrates measured recovery and reconciled totals |
| OPS-006 | Technical telemetry: Structured redacted logs metrics tracing alerts and error queues | Credentials and unnecessary payroll content never appear in routine logs |
| OPS-007 | Support access: Own identity case scope expiry customer history and emergency review | Expired support authority blocks further access |
| OPS-008 | Private deployment: Same artifacts migrations entitlements grace and responsibility matrix | Upgrade and expiry tests match documented supported behaviour |
| OPS-009 | Performance and cells: Per-tenant limits asynchronous BI regional home and capacity measurement | Noisy neighbour and declared-load tests meet agreed budgets |
| OPS-010 | Migration and releases: Expand migrate contract canary compatibility and recovery | Old records remain interpretable and destructive changes have verified recovery |
| OPS-011 | Submission conversion: Application frontend feeds operator review billing status and idempotent company and nominated-user provisioning | Accepted submitted data converts without re-entry and concurrent provisioning cannot create duplicate accounts |
| OPS-012 | Prorated package changes: Immediate next-period or selected-date plan changes with versioned daily or period allocation rules | A mid-period example reconciles old and new charges using explicit timezone rounding tax and credit treatment |
| OPS-013 | Manual and future card billing: Manual-transfer operation now with payment-adapter boundaries for later mixed card and manual customers | Repeated provider events cannot activate twice and manual receipt review cannot expose payment-card details |
| OPS-014 | Entitlement administration: Operator controls for business user group and global features modules AI access and package gates | Effective access is the intersection of entitlement company choice user permission and operator availability with comprehensive logs |
| OPS-015 | Support identity administration: Case-scoped attributed impersonation reset or invitation flows with customer visibility and no recoverable password access | Support cannot retrieve existing passwords and sensitive actions preserve real operator and represented user identities |
| OPS-016 | Hosting portability: Cloudflare Workers database and buckets behind adapters with a supported self-hosted container path | The same financial contracts run across supported adapters and migration or recovery is rehearsed before production use |
| OPS-017 | Resumable development: Durable build state changed-file records check outcomes blockers and remaining actions | A resumed development agent locates the current branch and incomplete work without repeating completed effects |
| OPS-018 | Controlled offline application: Selected POS accounting inventory assets and manufacturing functions with signed grants scoped master-data creation and bidirectional sync | Replayed or conflicting commands cannot double post and expiry revocation reconciliation and lost-device cases are tested |

## Security audit and assurance

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| SEC-001 | Authentication: MFA operator sessions recovery step-up and secure cookies | Account recovery and privilege actions resist defined takeover tests |
| SEC-002 | Tenant isolation: Database files cache jobs search exports and AI context | Cross-tenant and pooled-connection tests deny all defined attempts |
| SEC-003 | Business audit: Actor initiator source reason before-after reference approval and outcome | Company reviewer traces a sample financial and configuration action |
| SEC-004 | Audit access: Own activity company oversight and operator technical scopes | Sensitive fields remain protected even in logs and exports |
| SEC-005 | Secret management: Server-side keys encryption rotation and redaction | No key enters browser bundle Git or routine diagnostic output |
| SEC-006 | Secure development: Threat model dependency inventory scans and reviewed release artifacts | Material unresolved findings block public release |
| SEC-007 | Incident response: Detection containment evidence recovery reconciliation and communication | A tabletop and restore exercise produces actionable evidence |
| SEC-008 | Independent assurance: Scoped penetration test remediation and certification roadmap | Only obtained assurance is advertised and critical findings are resolved |
| SEC-009 | Export and exit: Structured records attachments mappings and reconciliation | A sample export independently reconstructs accepted balances and evidence |
| SEC-010 | Single active account session: A successful new login replaces the previous active session across companies | The previous cookie fails on its next request and revocation is rechecked when a command executes |
| SEC-011 | Password and login data design: Server-side one-way password hashing or a vetted identity provider secure recovery and no plaintext password storage | Database backups logs operator tools and the browser never expose recoverable user passwords |

## Interface and accessibility

| ID | Capability and supported scope | Acceptance condition |
| --- | --- | --- |
| UX-001 | Themes and glass: Polished visible glass chrome with readable stable data surfaces | Light and dark review shows no gradient seam or contrast loss |
| UX-002 | Navigation: Collapsible sidebar separate Sales Purchases Reports BI Planning Finance and Apps | User can locate each destination in both sidebar states |
| UX-003 | Brand: SAVEN name official ESC emblem plum and ivory tokens | No provisional lion or obsolete product name appears in current application branding |
| UX-004 | Task interaction: Keyboard scanning touch quick actions drafts and visible states | Frequent small issue requires no AI chat or specialist instruction |
| UX-005 | Accessibility: WCAG 2.2 AA target focus labels contrast and reduced motion | Keyboard and assistive checks pass defined critical journeys |
| UX-006 | Responsive and weak network: Small screens long values errors progress and safe retry | Interrupted submissions preserve intent without duplicate effects |
