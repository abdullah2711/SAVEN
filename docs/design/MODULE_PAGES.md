# Module pages

Generated from `docs/design/save/ui/pages-map.js` by
`docs/design/build/make-page-docs.mjs`. The rail reads the same file, so this page
and the application cannot disagree. Do not edit by hand.

States: **built** working screen · **partial** working, covers part of the page ·
**planned** mapped, not built.


## Accounting (accounting)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | built | Position and work waiting: four figures with their basis, what needs action, one real trend, recent journals. |
| 2 | General ledger `ledger` | built | One account or all accounts, running balance, column view and full record, import. |
| 3 | Journal entries `journals` | built | Register of every journal with state, source, party and totals; new journal opens a full page form. |
| 4 | Parties `parties` | built | Customers and suppliers with terms, credit limits, balances and status; a row opens the party page with its statement and access. |
| 5 | Cash & bank `cash` | built | Register of cash and bank sub-accounts with balances, and a form that records the bank reference and the projects and locations each one may be used on. |
| 6 | Payment / Receipts `payments` | built | Register of receipts and payments with type, party and method filters; a document may use bank, cash or an existing advance, is allocated oldest-first and keeps the remainder as an advance. |
| 7 | Advances `advances` | built | Customer advances received and supplier advances paid, with balances, vouchers and adjustment against open documents. |
| 8 | Sales invoices `sales-invoices` | built | Invoice register with filters and no statistics, a Returns tab, row menu to open or return, and balances that follow partial or complete returns. |
| 9 | Purchase bills `purchase-invoices` | built | Supplier bills with a Returns tab, row menu open/return, item rows, optional stock receipt and balances updated by returns. |
| 10 | Chart of accounts `coa` | built | Accounts and accounting groups: account register with head, group, control, currency, state and closing balance; group register and form; both open their own form. |

## Inventory (inventory)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | built | Stock value, value by warehouse, below reorder, movements today, movers. |
| 2 | Items `items` | built | The shared item master with stock fields: tracked, costing, reorder point. |
| 3 | Default accounts `defaults` | built | Default inventory, cost-of-sales, income and expense accounts by event and item group. |
| 4 | Item groups `groups` | built | Tree for reporting, default accounts and tax defaults. |
| 5 | Warehouses & locations `warehouses` | built | Stores and bins with their balances, branch mapping and accounts. |
| 6 | Stock balances `balances` | built | Quantity and value per item and warehouse, last movement, average cost. |
| 7 | Stock movements `movements` | built | Every in and out line with source document and reason. |
| 8 | Goods receipt `receipts` | built | Receive against a bill or order; posts movement and clearing entry. |
| 9 | Delivery note `delivery` | built | Issue against an invoice; cost leaves at the item method. |
| 10 | Transfers `transfers` | built | Move quantity between warehouses at unchanged total value. |
| 11 | Stock count `counts` | built | Count sheet, variance, approval; variance becomes an adjustment. |
| 12 | Adjustments & write-offs `adjustments` | built | Every adjustment with reason, account, approval and evidence. |
| 13 | Valuation & costing `valuation` | built | Costing method, revaluation, NRV write-down, impairment, landed cost. |
| 14 | Reorder & alerts `reorder` | built | Items below reorder point with suggested quantities. |
| 15 | Reports `reports` | built | Stock ledger, movement summary, valuation, ageing, margin by item. |
| 16 | Settings `settings` | built | Default accounts per movement type, units, costing, negative stock. |

## Manufacturing (manufacturing)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | built | Open work orders, material shortages, capacity load, cost variance. |
| 2 | Bills of material `boms` | built | Versioned components and operations per finished item. |
| 3 | Routings `routings` | built | Operation sequence, work centres and standard times. |
| 4 | Work centres `work-centres` | built | Capacity, cost rate and calendar per centre. |
| 5 | Planning `planning` | built | Demand, shortages, suggested production and purchase. |
| 6 | Work orders `orders` | built | Release, material issue, production receipt, close. |
| 7 | Scrap & rework `scrap` | built | Loss, rework loops and their cost effect. |
| 8 | Subcontracting `subcontracting` | built | Send material out, receive the finished item, reconcile cost. |
| 9 | Costing `costing` | built | Standard versus actual, variance analysis per order. |
| 10 | Reports `reports` | built | Order status, material consumption, efficiency, yield. |

## Point of sale (pos)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Sales today, till status, top items, voids and discounts. |
| 2 | Checkout `checkout` | planned | Fast sale: items, quantity, price, tender, receipt. |
| 3 | Till sessions `tills` | planned | Open, count, close and reconcile a till against its sales. |
| 4 | Tenders `tenders` | planned | Cash, card and mixed tender handling with change. |
| 5 | Discounts & overrides `discounts` | planned | Rules, limits and who may approve an override. |
| 6 | Returns `returns` | planned | Return a sale line, refund or credit, with receipt reference. |
| 7 | Cash counts `counts` | planned | Physical count per till, variance and sign-off. |
| 8 | Profiles `profiles` | planned | Receipt identity, tax defaults, price list and permitted actions. |

## Fixed assets (assets)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | built | Net book value, depreciation this period, assets due, disposals. |
| 2 | Asset register `register` | built | Every asset with cost, accumulated depreciation and location. |
| 3 | Categories `categories` | built | Depreciation method and accounts per class of asset. |
| 4 | Acquisitions & CWIP `acquisitions` | built | Capitalise cost, including capital work in progress. |
| 5 | Depreciation `depreciation` | built | Run the period charge, review before posting. |
| 6 | Impairment & revaluation `impairment` | built | Write down or revalue with evidence and approval. |
| 7 | Transfers `transfers` | built | Move custody between branches or people. |
| 8 | Disposals `disposals` | built | Sell or scrap, with gain or loss posted. |
| 9 | Reports `reports` | built | Register, movement schedule, depreciation forecast. |

## People & payroll (people)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Headcount, payroll due, attendance exceptions, leave. |
| 2 | Employees `employees` | planned | Employee record, contract, pay, bank and documents. |
| 3 | Organisation `organisation` | planned | Departments, positions and reporting lines. |
| 4 | Recruitment `recruitment` | planned | Vacancies, candidates and offers. |
| 5 | Attendance `attendance` | planned | Shifts, punches, exceptions and adjudication. |
| 6 | Leave `leave` | planned | Balances, requests, approvals and calendar. |
| 7 | Payroll `payroll` | planned | Run, review, approve and post a payroll period. |
| 8 | Payslips `payslips` | planned | Individual payslip with earnings, deductions and employer cost. |
| 9 | Separation `separation` | planned | Exit checklist, final settlement and access removal. |
| 10 | Reports `reports` | planned | Cost by department, headcount movement, statutory returns. |

## Projects (projects)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Projects `projects` | built | Every project with its code, status, manager, accounts and ledger totals. |
| 2 | Dashboard `dashboard` | planned | Project profit, cost against budget, unbilled work, overdue deliverables. |
| 3 | Project accounts `accounts` | planned | Which accounts belong to which project, and which are head office. |
| 4 | Budget `budget` | planned | Cost and revenue budget per project against actual. |
| 5 | Project access `access` | planned | Which people may see or post to which projects. |

## CRM (crm)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Pipeline value, win rate, activities due. |
| 2 | Leads `leads` | planned | Unqualified contacts and their source. |
| 3 | Opportunities `opportunities` | planned | Qualified deals with stage, value and owner. |
| 4 | Contacts `contacts` | planned | People and their organisations. |
| 5 | Activities `activities` | planned | Calls, meetings and follow-ups with outcomes. |

## Finance (finance)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Cash position, runway, working capital, covenant headroom. |
| 2 | Cash position `cash-position` | planned | Balances, committed outflows and available cash. |
| 3 | Liquidity forecast `forecast` | planned | Rolling forecast from open items and commitments. |
| 4 | Working capital `working-capital` | planned | Receivable days, payable days, inventory days. |
| 5 | Credit & collection `credit-control` | planned | Exposure, limits, promises to pay, escalation. |
| 6 | Budgets & variance `budgets` | planned | Budget versus actual by account and period. |
| 7 | Profitability `profitability` | planned | Margin by customer, product and project. |
| 8 | Debt & facilities `facilities` | planned | Drawdowns, repayments, interest and covenants. |

## Taxes (tax)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Tax rules `rules` | built | System-numbered rules register and form: nature, several item groups or several items, rate and effective dates. Overlapping specific rules are blocked. Prices are tax-exclusive; control accounts and authorities come from Default accounts. |
| 2 | Authorities `authorities` | built | Authority register with six tax natures plus final sales tax payable; multi-nature form, registration, frequency, search, balances as at a date and sorting. |
| 3 | Tax ledger `entries` | built | All tax entries from invoices, bills, returns, adjustments and closings, filterable and sortable; a row opens its source or voucher. |
| 4 | Parties `parties` | built | Party balances for the six tax natures plus final sales tax payable, with as-at balances and Verified/Unverified. |
| 5 | Tax entry `adjustments` | built | Three clear entry types: adjustment, withholding payment and closing. Adjustment covers all six natures; the authority list and offset follow the nature. Closing works at the effective period-end date and transfers sales tax to final payable or pays it. |
| 6 | Default accounts `defaults` | built | Six tax control accounts, six default authorities, closing accounts and the sales-tax calculation basis. |

## Reports & BI (reports)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Revenue `revenue` | built | Revenue dashboard with sales by customer and sales by item, from the same documents. |
| 2 | Ageing `ageing` | built | Receivable and payable ageing by bucket, from open documents and party balances. |
| 3 | Trial balance `trial` | built | Every account with opening, period debit, period credit and closing balance. |
| 4 | Profit or loss `profit` | built | Income and expenses for the period from the same ledger. |
| 5 | Financial position `position` | built | Assets, liabilities and equity with the balance check. |
| 6 | Cash flow `cashflow` | built | Direct cash movement from the cash and bank accounts. |
| 7 | Equity `equity` | built | Capital and accumulated result. |
| 8 | Report library `library` | planned | Saved reports and scheduled jobs; the report builder is a later increment. |

## Documents (drive)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Storage used, recent files, expiring links. |
| 2 | Folders `folders` | planned | Folder tree with access rules per folder. |
| 3 | Files `files` | planned | Upload, version and classify a file. |
| 4 | Evidence links `evidence` | planned | Attach evidence to a document with hash and type. |
| 5 | Quotas `quotas` | planned | Space per company and per folder. |
| 6 | Retention `retention` | planned | How long each class of file is kept and what deletes it. |

## Integrations (apps)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Connected apps, failing webhooks, recent calls. |
| 2 | App registry `registry` | planned | Registered applications with scopes and owner. |
| 3 | API keys `keys` | planned | Issue, rotate and revoke keys with scope. |
| 4 | Webhooks `webhooks` | planned | Subscriptions, delivery log and retries. |
| 5 | Sandbox `sandbox` | planned | Test data and a safe place to call the API. |
| 6 | Logs `logs` | planned | Request log with correlation and outcome. |

## Assistant (assistant)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Usage, cost, refusals and tasks in progress. |
| 2 | Chat `chat` | planned | Ask a question against authorised records, with citations. |
| 3 | Actions & approvals `actions` | planned | Proposals that need a human decision before they run. |
| 4 | Knowledge `knowledge` | planned | What the assistant may read, and the fresh date. |
| 5 | Usage `usage` | planned | Tokens, cost and limits per seat. |
| 6 | Settings `settings` | planned | Model routing, privacy boundaries, retention. |

## Settings (settings)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Company `company` | built | Legal identity, addresses, base currency, fiscal year and the active period. |
| 2 | Accounting `accounting` | built | Tabs of registers with their own forms: numbering, control accounts, projects, locations, cost centres, party groups, item groups, approvals. Tax defaults and authorities live in the Taxes module. Accounting heads are only the five classes; accounts and groups live in the Chart page. |
| 3 | Inventory `inventory` | built | Costing method, negative stock, default warehouse and the inventory accounts. |
| 4 | Manufacturing `manufacturing` | built | Material issue policy, BOM requirement, default work centre and the manufacturing accounts. |
| 5 | People & access `people` | built | Users, roles, scope and invitations for this business. |
| 6 | Periods `periods` | built | Every period with its state; the lock is the same switch as the close checklist. |
| 7 | Forms & fields `forms` | built | Standard field counts per form and the custom fields added to them. |
| 8 | Saved views `views` | built | Named list views with their filters, columns and sorting. |
| 9 | Print & templates `print` | built | Letterheads, paper sizes and what prints on a document. |

## Administration (admin)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Sign-ins, failures, sessions, open incidents. |
| 2 | Authentication `auth` | planned | Password policy, sessions and second factor. |
| 3 | Audit log `audit` | planned | Every state change with actor, before and after. |
| 4 | Data export `export` | planned | Export a company or the tenant, with scope and evidence. |
| 5 | Backups `backups` | planned | Schedule, verify and restore. |
| 6 | Security `security` | planned | Tenant isolation proof, key handling, incidents. |

## Subscription (subscription)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Your plan `plan` | planned | Modules enabled, seats and renewal date. |
| 2 | Usage `usage` | planned | What is consumed this period against the plan. |
| 3 | Invoices `invoices` | planned | SA7EN invoices for the subscription. |
| 4 | Payment method `payment` | planned | Card or manual settlement record. |
| 5 | Certificates `certificates` | planned | Monthly signed entitlement certificates. |

## Commerce (commerce)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Applications `applications` | planned | New business applications and their state. |
| 2 | Verification `verification` | planned | Identity and business checks before provisioning. |
| 3 | Provisioning `provisioning` | planned | Create the tenant, company and first user. |
| 4 | Subscriptions `subscriptions` | planned | Plans, changes and proration. |
| 5 | Entitlements `entitlements` | planned | What the tenant is entitled to, signed. |

## Operator (operator)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Fleet health, failed jobs, releases, alerts. |
| 2 | Businesses `businesses` | planned | Every tenant store with version, size and last backup. |
| 3 | Backups & restore `backups` | planned | Run, verify and restore a business store. |
| 4 | Releases `releases` | planned | Version, migrate and roll back with evidence. |
| 5 | Telemetry `telemetry` | planned | Errors, slow queries and queue depth. |
| 6 | Support access `support` | planned | Time-boxed access with an audit trail. |
| 7 | Nodes `nodes` | planned | Hosts, capacity and placement. |

## Offline (offline)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Connectivity `connectivity` | planned | What is reachable and what is queued. |
| 2 | Queue `queue` | planned | Commands waiting to sync, with conflicts. |
| 3 | Conflicts `conflicts` | planned | Two versions of the same record, resolved explicitly. |
| 4 | Offline scope `scope` | planned | Which screens may work offline and for how long. |

## Design system (design)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Themes `themes` | planned | Tokens, colour roles and contrast checks. |
| 2 | Navigation `navigation` | planned | Module and page structure used by every screen. |
| 3 | Brand `brand` | planned | Mark, wordmark and usage rules. |
| 4 | Components `components` | planned | Every component with its states. |
| 5 | Accessibility `accessibility` | planned | Focus, keyboard, contrast and screen readers. |

---

**21 modules · 154 pages · 68 built · 0 partial · 86 planned.**
