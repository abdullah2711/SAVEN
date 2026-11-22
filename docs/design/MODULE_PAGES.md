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
| 6 | Payments `payments` | built | Receipts and payments with oldest-first allocation across open documents and the remainder kept as an advance. |
| 7 | Items `items` | built | Item register with unit, income and expense heads, tax default and the inventory-tracked flag; a form creates a new item. |
| 8 | Sales invoices `sales-invoices` | built | Customer invoices with item or service lines, tax, due date and totals; session register until posting exists. |
| 9 | Purchase invoices `purchase-invoices` | built | Supplier bills mirroring the sales invoice, posting to expense and input tax; session register until posting exists. |
| 10 | Chart of accounts `coa` | built | Two tabs: the trial balance and the chart register, with code, class, head, opening, movement and closing; the account form opens on its own page. |
| 11 | Reports `reports` | built | Ageing, profit or loss, financial position, cash flow and equity, all derived from the same ledger. |

## Inventory (inventory)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Stock value, value by warehouse, below reorder, movements today, movers. |
| 2 | Items `items` | planned | The shared item master with stock fields: tracked, costing, reorder point. |
| 3 | Item groups `groups` | planned | Tree for reporting, default accounts and tax defaults. |
| 4 | Warehouses & locations `warehouses` | planned | Stores and bins with their balances, branch mapping and accounts. |
| 5 | Stock balances `balances` | planned | Quantity and value per item and warehouse, last movement, average cost. |
| 6 | Stock movements `movements` | planned | Every in and out line with source document and reason. |
| 7 | Goods receipt `receipts` | planned | Receive against a bill or order; posts movement and clearing entry. |
| 8 | Delivery note `delivery` | planned | Issue against an invoice; cost leaves at the item method. |
| 9 | Transfers `transfers` | planned | Move quantity between warehouses at unchanged total value. |
| 10 | Stock count `counts` | planned | Count sheet, variance, approval; variance becomes an adjustment. |
| 11 | Adjustments & write-offs `adjustments` | planned | Every adjustment with reason, account, approval and evidence. |
| 12 | Valuation & costing `valuation` | planned | Costing method, revaluation, NRV write-down, impairment, landed cost. |
| 13 | Reorder & alerts `reorder` | planned | Items below reorder point with suggested quantities. |
| 14 | Reports `reports` | planned | Stock ledger, movement summary, valuation, ageing, margin by item. |
| 15 | Settings `settings` | planned | Default accounts per movement type, units, costing, negative stock. |

## Manufacturing (manufacturing)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Open work orders, material shortages, capacity load, cost variance. |
| 2 | Bills of material `boms` | planned | Versioned components and operations per finished item. |
| 3 | Routings `routings` | planned | Operation sequence, work centres and standard times. |
| 4 | Work centres `work-centres` | planned | Capacity, cost rate and calendar per centre. |
| 5 | Planning `planning` | planned | Demand, shortages, suggested production and purchase. |
| 6 | Work orders `orders` | planned | Release, material issue, production receipt, close. |
| 7 | Scrap & rework `scrap` | planned | Loss, rework loops and their cost effect. |
| 8 | Subcontracting `subcontracting` | planned | Send material out, receive the finished item, reconcile cost. |
| 9 | Costing `costing` | planned | Standard versus actual, variance analysis per order. |
| 10 | Reports `reports` | planned | Order status, material consumption, efficiency, yield. |

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
| 1 | Dashboard `dashboard` | planned | Net book value, depreciation this period, assets due, disposals. |
| 2 | Asset register `register` | planned | Every asset with cost, accumulated depreciation and location. |
| 3 | Categories `categories` | planned | Depreciation method and accounts per class of asset. |
| 4 | Acquisitions & CWIP `acquisitions` | planned | Capitalise cost, including capital work in progress. |
| 5 | Depreciation `depreciation` | planned | Run the period charge, review before posting. |
| 6 | Impairment & revaluation `impairment` | planned | Write down or revalue with evidence and approval. |
| 7 | Transfers `transfers` | planned | Move custody between branches or people. |
| 8 | Disposals `disposals` | planned | Sell or scrap, with gain or loss posted. |
| 9 | Reports `reports` | planned | Register, movement schedule, depreciation forecast. |

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

## Reports & BI (reports)

| # | Page | State | Specification |
|---|---|---|---|
| 1 | Dashboard `dashboard` | planned | Saved reports, scheduled jobs, recent exports. |
| 2 | Report library `library` | planned | Built-in and saved reports by module. |
| 3 | Report builder `builder` | planned | Choose a data source, columns, filters and grouping. |
| 4 | Statement packs `packs` | planned | Bundle statements with notes for a period. |
| 5 | Scheduled jobs `jobs` | planned | Run and deliver a report on a schedule. |
| 6 | Exports `exports` | planned | What was exported, by whom, with which view. |

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
| 2 | Accounting `accounting` | built | Tabs of registers with their own forms: numbering, default accounts, accounting heads, projects, locations, party groups, item groups, taxes and withholding, approvals. |
| 3 | People & access `people` | built | Users, roles, scope and invitations for this business. |
| 4 | Periods `periods` | built | Every period with its state; the lock is the same switch as the close checklist. |
| 5 | Forms & fields `forms` | built | Standard field counts per form and the custom fields added to them. |
| 6 | Saved views `views` | built | Named list views with their filters, columns and sorting. |
| 7 | Print & templates `print` | built | Letterheads, paper sizes and what prints on a document. |

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

**20 modules · 144 pages · 19 built · 0 partial · 125 planned.**
