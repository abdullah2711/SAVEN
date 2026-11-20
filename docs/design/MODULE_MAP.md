# Module map — Accounting, Inventory, Taxes (revision 2)

Plain text for review. Section numbers are stable; comment as “2.4”.
Every comment from your review is answered in §0, then the map is rewritten to
match.

States: **built** · **partial** · **planned**.

---

## 0. What changed from your comments

### Navigation

| Your comment | Decision |
|---|---|
| Dashboard and “Accounting” open the same screen but differ | Bug, fixed. Clicking the module now normalises to `dashboard` before the first render, so the heading, the highlighted sub-item and the content always agree. |
| New journal should not be in the sidebar | Removed. It is a button on **Journal entries**; the form is a full page reached from there, not a nav item. |
| Party detail is not a nav item | Correct. **Parties** is a register. Opening a row opens the party page. The register is reachable by filtering, never duplicated as a sub-item. |
| What would Receivables and Payables even have? | Removed as pages. Their balances live in the **party register** (balance, overdue, oldest) and their ageing lives in **Reports**. The dashboard keeps the two totals. |
| Ageing belongs in reports; by-document not needed | Ageing moves into **Reports → Ageing & schedules**. It is party-wise with an expandable per-party document detail, so you get invoice-level detail inside the one report without a second page. |
| Why a separate Registers page? | Removed. Each list is its own register: journal entries, payments, sales invoices, purchase invoices, stock movements. Cross-type “everything with this party” is the party page. |
| Statements should be a Reports sub-module | Coffee replaced by **Reports** inside Accounting: ageing, schedules, P&L, financial position, cash flow (direct and indirect), equity, trial-derived packs. Custom reports stay in the separate Reports & BI module. |
| Approvals should be its own module | Agreed. Approvals leaves Accounting and becomes a top-level module, because any module can raise one. |
| Period close must be complete | Expanded in 2.2.16, with the full checklist and the reopening rules. |

### Banking & cash — my recommendation

You asked for a view. My recommendation: keep **Cash & bank** as one page with two
tabs — **Accounts** (list, balances, cash position) and **Reconciliation** — and do
not build a separate “account register” page, because the ledger already gives the
bank account register with a running balance.

- Account creation stays in **Chart of accounts**, and the new-account form reveals
  bank-specific fields when the type is Cash or Bank (bank name, account number,
  branch, currency, reconciliation on/off). Nothing is created twice.
- Cash flow moves to **Reports**.
- The payment register lives in **Payments**, not here.

### This round

- General ledger moved directly under Dashboard in the rail.
- The ledger now carries the full column set, including description, against
  account, party type, project, cost centre, against voucher and supplier invoice
  number, with a column picker.
- Project and cost centre are dimensions on every posting line.
- Projects became its own module with a working list and per-project totals.
- Setup became an accounting page holding organisation, numbering, default
  accounts, dimensions, approvals and periods.
- Payments, Cash & bank, Sales and Purchases stay inside Accounting.
- Taxes is one Accounting page with five tabs, not five rail entries:
  rules, registers, withholding, advance tax, reconciliation & adjustments.
- Certificates and Returns are removed from scope.

### Rules

| Your comment | Decision |
|---|---|
| Control account flag on the account form | Added. An account carries a control type (none, receivable, payable). A control account requires a party on every posting **unless** the entry type is *Adjusting*, which is itself permission-gated. |
| When is a party/control difference an error? | Defined in 2.3: it is an error only when the subledger total and the control balance differ with no documented bridge (opening migration, adjusting entry, or posted-but-unallocated item). The bridge is visible, not silent. |
| Closed period posting by administrator | Allowed for an administrator, with a permanent log entry naming the period, the reason and the actor. The document stays dated in the period it belongs to. |
| Corrections and deletion | Reversal is the normal route for both journals and invoices. A soft delete exists for administrators: the document stays in the database and the audit log, and is hidden from screens. |
| Reversing an invoice | Opening the invoice and choosing Reverse/Cancel creates the reversing document, reverses its allocations, reverses its tax lines, and returns stock where the invoice moved it. |

### Inventory

- Dashboard shows statistics, not just a heading.
- Warehouses show their balances.
- Stock count produces an adjustment with a reason (count discrepancy, expiry,
  damage), the reason maps to a GL account, and the adjustment appears in the
  adjustment register.
- Valuation & costing covers NRV write-down and impairment.
- One item master shared by Accounting and Inventory; each module shows the fields
  it owns.

### Taxes

- Withholding split four ways: sales VAT withholding, purchase VAT withholding,
  sales income-tax withholding, purchase income-tax withholding.
- Tax rules attached to items are **defaults only**; any invoice line can override
  the rate, switch tax off, or add a custom tax line with a chosen account.
- The module works without the Tax module: chart-of-accounts flags mark tax
  accounts, and a line can carry a manual tax amount.
- Certificates explained in 4.2.10.

---

## 1. How the three modules connect

- A **document** (sales invoice, purchase invoice, journal, payment) is the only
  thing that moves money.
- Accounting owns the ledger. Inventory and taxes post through journals, so every
  balance has a document behind it.
- Inventory owns quantity and cost. Taxes own tax lines; a return is a query over
  them.
- The chart of accounts is the configuration hub: an account declares whether it is
  a control account, a tax account (and which kind), or an inventory account. That
  is what lets the business run without the Inventory or Tax module at all.

```
Sales invoice    -> receivable open item -> party balance -> ageing
                 -> income              -> ledger
                 -> output tax line     -> tax register -> return
                 -> stock issue         -> COGS (if item tracked)

Purchase invoice -> payable open item    -> party balance -> ageing
                 -> expense / clearing  -> ledger
                 -> input tax line      -> tax register -> return
                 -> stock receipt       -> inventory value

Payment          -> bank or cash         -> ledger
                 -> allocation          -> consumes open items
                 -> components          -> discount, withholding, retention, write-off

Journal          -> ledger
                 -> control account: party balance + oldest open item
```

---

## 2. Accounting

### 2.1 Navigation

```
Accounting
├── Dashboard
├── General ledger             (the detailed book of every posting)
├── Journal entries            (register; "New journal" is a button here)
├── Parties                    (register; a row opens the party page)
├── Cash & bank                (Accounts · Reconciliation)
├── Payments                   (register; "New payment" is a button here)
├── Items                      (register, item page, item reports)
├── Sales invoices             (register; a row opens the invoice)
├── Purchase invoices          (register; a row opens the bill)
├── Chart of accounts
├── Trial balance
├── Reports                    (ageing, schedules, P&L, position, cash flow, equity)
├── Taxes                      (5 horizontal tabs: rules, registers, withholding, advance tax, adjustments)
├── Setup                      (accounting configuration)
└── Period close
```

Approvals is a separate top-level module. Receivables, Payables, Ageing, Registers
and Statements are no longer pages.

### 2.2 Pages

**2.2.1 Dashboard — built, being reworked**
Position and work waiting: four figures with their basis, what needs action, one
real trend, recent journals. Specified in §10.2.

**2.2.2 Journal entries — built**
Register of every journal: date, number, narrative, source, state, debit, credit,
net. Filters: state, source, period, party, text. Footer totals. A row opens the
entry with its lines; the page-level action is **New journal**.

**2.2.3 New journal — built, needs the party field**
Full page. Header: date, journal, reference, narrative, currency, branch, entry
type (Normal / Adjusting / Opening), workflow. Lines: account, party (required on
control accounts), description, debit, credit, cost centre. Running totals,
imbalance warning, posting blocked until balanced, evidence attachment. Posting
writes the ledger, the party balance and consumes the oldest open item.

**2.2.4 Parties — planned**
Register of customers and suppliers: type, group, tax identity, currency, terms,
credit limit, opening balance, current balance, overdue, oldest item, status.
Filters by type, group, balance, overdue. Opening a row opens 2.2.5. This is the
only party list; there is no separate receivables or payables list.

**2.2.5 Party page — planned**
Header: identity, terms, limit, status. Body: statement-style ledger with opening,
documents, allocations and closing; ageing strip; outstanding documents; credit
limit usage. Actions: new invoice, new payment, edit terms, hold, block, print
statement.

**2.2.6 Cash & bank — partial**
**Accounts** tab: every bank and cash account with balance, currency, last
reconciliation and a cash-position strip; physical cash locations shown as cash
accounts. **Reconciliation** tab: statement import, suggested matches, unmatched
lines, difference; cannot close with a difference. Account creation happens in
2.2.11 and returns here.

**2.2.7 Payments — planned**
Register of receipts and payments: date, reference, party, account, amount,
allocated, unallocated, state. Filters by party, direction, account, period,
amount. **New payment** opens the allocation form: party, date, bank or cash
account, amount, then an allocation table across one or many documents with
components per line — settlement, discount, withholding, retention, write-off — so
a 100 invoice settled with 90 cash, 5 discount and 5 withheld is three visible
rows, not a hidden difference. Unallocated remainder stays as an advance.

**2.2.8 Items — planned**
Item register with code, name, type (service / stock / non-stock), unit, item
group, income account, expense account, inventory account, tax defaults, costing
method, reorder point, status. Item page adds stock balances per warehouse, last
movements, price history, tax defaults and per-item statistics. Item reports
(sales by item, purchase by item, margin by item, movement history) live here, not
in Reports. The same item master is shown in Inventory with the stock fields.

**2.2.9 Sales invoices — planned**
Register then document. Register: number, date, customer, amount, outstanding,
days overdue, state, source reference. Document: lines (item or free text), tax per
line with override, due date, terms, reference to a quotation or order when the
Selling module is on. Posting creates the receivable open item, party balance,
ledger and tax lines. Submit, reverse/cancel with a full reversal, print, credit
note.

**2.2.10 Purchase invoices — planned**
Supplier mirror of 2.2.9, including the outstanding-days column, the source
reference to an order or receipt, and posting to expense or inventory clearing.
Works with Buying off (direct entry) or on (referenced to a purchase order).

**2.2.11 Chart of accounts — built, import planned**
Tree by statement section with code, name, nature, group, flags and balance. Flags:
control account (receivable / payable), tax account (output tax, input tax,
withholding variants), inventory account, bank or cash. New-account form reveals
the fields for the chosen type, including bank details and reconciliation settings.
Add, rename, regroup, archive (blocked with history), import a chart.

**2.2.12 General ledger — built**
Two modes: **column view** and **full record**. The column set follows the
reference book: posting date, account, description, debit, credit, balance,
voucher type, voucher subtype, voucher no, against account, party type, party,
project, cost centre, against voucher type, against voucher, supplier invoice no.
Columns beyond the core can be switched off; the choice re-renders the table and
the export. Filters: date range, account (one or all), party, project, cost centre,
voucher type, free text. Opening, debit, credit and closing sit above the table and
the footer states the arithmetic. Clicking a row expands the source document with
all of its lines, project and cost centre per line.

**2.2.13 General ledger (previous note) — superseded**
Account (one or all), period, party, text search. Opening, every posted line with
running balance, closing, and the proof line. Two modes: **column view** (choose the
columns) and **full record** (expand a line to every field of the source document).
Views are saveable per person or shared. Import for opening balances and history
with a dry-run preview.

**2.2.13 Trial balance — built**
Opening Dr/Cr, movement, closing Dr/Cr, group subtotals, difference must read 0.00.
Period filter, hide-zero, drill-through, export.

**2.2.14 Reports — partial**
Built-in reporting for this module: ageing and schedules (receivables, payables,
with per-party document detail), profit or loss, statement of financial position,
cash flow (direct and indirect), changes in equity, and a report pack with the
trial balance proof. Each report has a period selector, a comparison column where
it makes sense, drill-through to the ledger and export. Custom reports belong to
the separate Reports & BI module.

**2.2.15 Period close — partial**
Checklist with evidence per step: all journals posted, bank reconciled, receivables
and payables reviewed, depreciation and accruals posted, tax position agreed,
statements produced, sign-off. A lock requires every step either complete or
explicitly waived with a reason. Reopening needs an administrator, a reason and a
permanent log entry; documents posted afterwards keep their original dates.

### 2.3 Cross-page rules

- **Control accounts.** Set on the account. A posting to a control account requires
  a party, except when the entry type is *Adjusting*, which needs a stronger
  permission and a reason. Documents never post to a control account directly —
  they post through their own subledger entry.
- **Party balance versus control account.** The two must agree. A difference is an
  error only when there is no bridge that explains it; valid bridges are an opening
  balance migration, an adjusting entry with a reason, or a posted amount not yet
  allocated. The reconciliation report lists the bridge lines, so a real gap is
  visible rather than averaged away.
- **Closed periods.** Posting is refused, except for an administrator, who must give
  a reason; the log records the actor, the period and the document.
- **Corrections.** Reversal is the normal route. Administrators may soft-delete a
  document: it disappears from lists but stays in the database and the audit log.
- **Reversing an invoice.** From the document: Reverse/Cancel creates the reversing
  document, reverses allocations, reverses tax lines and returns stock. The
  original and the reversal both remain visible.

---

## 3. Inventory

### 3.1 Navigation

```
Inventory
├── Dashboard
├── Items
├── Item groups
├── Warehouses & locations
├── Stock balances
├── Stock movements
├── Goods receipt
├── Delivery note
├── Transfers
├── Stock count
├── Adjustments & write-offs
├── Valuation & costing
├── Reorder & alerts
├── Reports
└── Settings
```

### 3.2 Pages

**3.2.1 Dashboard — planned**
Stock value, value by warehouse, items below reorder point, movements today, top
movers, slow movers, pending counts. Every tile links into the list or report that
produced it.

**3.2.2 Items — planned**
The same item master as 2.2.8, with the stock fields visible: tracked flag, costing
method, reorder point, default warehouse, batch or serial policy.

**3.2.3 Item groups — planned**
Tree for reporting, default accounts and tax defaults. Changing a group never
reposts history.

**3.2.4 Warehouses & locations — planned**
Stores and bins with their balances, branch mapping, default inventory account, and
a per-warehouse stock value. Transfers do not change total value.

**3.2.5 Stock balances — planned**
Quantity and value per item and warehouse, last movement, average cost. Reconciles
to the inventory control account.

**3.2.6 Stock movements — planned**
Every in and out line: date, item, warehouse, quantity, value, source document,
reason. Filters by item, warehouse, type, period.

**3.2.7 Goods receipt — planned**
Receive against a bill or order, batch or serial optional. Posts the movement and
the clearing entry.

**3.2.8 Delivery note — planned**
Issue against an invoice. Cost leaves at the item's costing method and posts to
cost of sales.

**3.2.9 Transfers — planned**
Move quantity between warehouses at unchanged total value; a two-line movement.

**3.2.10 Stock count — planned**
Count sheet, variance per item, approval. A variance never edits balances directly:
it creates an **adjustment** with the reason *stock count discrepancy*, which
appears in 3.2.11 and posts to the account configured for that reason.

**3.2.11 Adjustments & write-offs — planned**
Register of every adjustment: date, item, warehouse, quantity, value, reason
(discrepancy, expiry, damage, sample, write-off), account, approval, evidence. Each
reason maps to a GL account, so the expense is deliberate rather than implied.

**3.2.12 Valuation & costing — planned**
Costing method per item (weighted average or FIFO), revaluation, NRV write-down,
impairment, landed-cost allocation across items.

**3.2.13 Reorder & alerts — planned**
Items below their reorder point with suggested quantity and last supplier.

**3.2.14 Reports — planned**
Stock ledger, movement summary, valuation, stock ageing, gross margin by item.

**3.2.15 Settings — planned**
Default accounts per movement type, units, costing default, negative-stock policy,
reason codes and their accounts.

### 3.3 Rules

- Quantities whole or three decimals; value always money with two decimals.
- Inventory control account equals the sum of item balances; a gap is an error.
- Negative stock is refused unless explicitly allowed, then flagged everywhere.
- Only tracked items are valued; untracked items post straight to expense or income.

---

## 4. Taxes

### 4.1 Navigation

Taxes is **one page with five horizontal tabs**, not five sidebar entries:

```
Taxes
├── Rules
├── Registers
├── Withholding          (purchase side: we withhold, we owe the authority)
├── Advance tax          (sales side: customer deducts, our asset)
└── Reconciliation & adjustments
```

### 4.2 Pages

**4.2.1 Dashboard — planned**
Position by period and by tax type: output tax due, input tax recoverable,
withholding receivable and payable, next filing date, unreconciled lines. Each
figure links to its register. Specified in §10.4.

**4.2.2 Registrations & jurisdictions — planned**
Tax identities per company and branch, jurisdiction, effective dates, filing
frequency, return template.

**4.2.3 Tax codes & rates — planned**
Code, rate, inclusive or exclusive, base rule, output and input accounts, kind
(VAT, income tax, withholding receivable, withholding payable), effective range.
Not deletable once used.

**4.2.4 Tax groups — planned**
Combine codes for a document — for example standard VAT plus income-tax
withholding — with the order in which they apply. Groups are defaults for items and
parties; a line can still override.

**4.2.5 Output tax register — planned**
Every sales tax line: date, document, party, base, rate, amount, code. Filter by
period, code, party. Totals agree with the tax control account.

**4.2.6 Input tax register — planned**
Every purchase tax line, with recoverable and blocked portions separated.

**4.2.7 Withholding — planned**
Four registers under one page: tax withheld by customers from us (VAT and income
tax) and tax we withhold from suppliers (VAT and income tax), with expected versus
actual and the document behind each line. Certificates due or received are shown
against the relevant line.

**4.2.8 Reconciliation & returns — planned**
Period return per tax type: output, input, carried forward, payable or refundable.
Locks the period with a snapshot and the evidence that produced it.

**4.2.9 Adjustments & corrections — planned**
Manual adjustment with reason, approval, evidence and effective date. Posts to the
tax control accounts.

**4.2.10 Certificates — planned**
Purpose: a withholding certificate is the document that proves tax was deducted at
source. When a customer withholds income tax from your invoice, their certificate is
what lets you claim the credit; when you withhold from a supplier, you issue one so
they can claim against it. The page issues, receives and links each certificate to
the documents and amounts it covers. If a business never uses withholding, this page
stays empty.

**4.2.11 Settings — planned**
Rounding, inclusive pricing, default accounts, filing periods, whether input tax is
recoverable by default, and whether withholding is enabled per direction.

### 4.3 Rules

- A tax line always stores base, rate, amount and account. Totals derive from lines.
- Inclusive prices are back-calculated; the residual posts to rounding.
- The tax control account equals the sum of unreconciled tax lines for the period.
- A filed return is locked; later corrections are new adjustments with evidence.
- **Running without this module:** accounts flagged as tax accounts in the chart
  (output tax, input tax, withholding variants) still work. A journal or invoice line
  can carry a manual tax line with a rate and one of those accounts, and the return
  is produced from the ledger. The module adds rules, registers, certificates and
  filing — not the ability to record tax.

---

## 5. Shared data

| Entity | Key fields |
|---|---|
| Party | id, type, name, group, tax id, currency, terms, credit limit, status |
| Document | id, type, date, party, currency, due date, state, source, source reference |
| Document line | account, item, description, quantity, rate, amount, tax group, tax override |
| Tax line | code, base, rate, amount, account, jurisdiction, recoverable, withholding kind |
| Open item | document, party, amount, due date, outstanding, bucket |
| Allocation | open item, payment, amount, date, component (settlement, discount, withholding, retention, write-off), mode |
| Journal entry | number, date, source, entry type, state, lines, reversal of |
| Ledger line | account, party, debit, credit, period, entry |
| Account | code, name, nature, group, control type, tax kind, inventory flag, bank details |
| Item | code, name, type, unit, accounts, tax defaults, tracked, reorder point, costing |
| Stock movement | item, warehouse, quantity, value, direction, source, reason |
| Custom field | entity, key, label, type, options, required, filterable, active |
| Form profile | company, form key, version, sections, field states, defaults, status |
| Saved view | page, owner, scope, columns, sort, filters, grouping, density |

---

## 6. Who writes what

| Action | Accounting | Inventory | Taxes |
|---|---|---|---|
| Sales invoice | receivable, income, party item | stock issue and COGS if tracked | output tax, withholding receivable |
| Purchase invoice | payable, expense or clearing | stock receipt at cost | input tax, withholding payable |
| Payment | bank, allocation, party balance | — | withholding components |
| Journal | ledger, party on control accounts | — | manual tax lines |
| Stock count | adjustment expense | quantity and value | — |
| Tax return | tax control accounts | — | return snapshot and proof |

---

## 7. Build order

1. Chart of accounts with flags (control, tax kind, inventory, bank) — the config
   hub everything else reads.
2. Journal entry form with the party field and entry types.
3. Parties and party page.
4. Payments with allocation components.
5. Sales and purchase invoices (direct entry first, source reference later).
6. General ledger, trial balance and Reports (ageing, P&L, position, cash flow,
   equity).
7. Cash & bank: accounts and reconciliation.
8. Items, then inventory movements, counts, adjustments and valuation.
9. Taxes: codes, registers, withholding, return, certificates.
10. Period close.

---

## 8. Forms, fields and views

Documented separately in `FORMS_AND_VIEWS.md`. Summary:

- **Forms are configured, not hardcoded.** Each form has a profile per company,
  versioned: a field can be required, optional, hidden or locked. A profile can make
  an optional field required; it can never make a required field optional or hide a
  field the ledger needs.
- **Custom fields are information, not behaviour.** Text, number, money, date,
  select, boolean or a reference. They appear in the form's details section, in
  lists, filters and reports. They never change an account, a tax rate, a price or a
  posting.
- **Every list is a view.** Journals, payments, invoices, parties, items, stock
  movements, ledger, trial balance and tax registers choose their columns, order,
  sort, filters, grouping, density and which columns total. Views are system
  (read-only), shared (administrator) or personal.
- **Ledger has two modes.** Column view for scanning; full record for one line —
  entry type, source, source reference, created by, approved by, posted at, reason,
  attachments, custom fields. A line is always the way into its full record.
- Totals always equal the rows in scope, and the scope is stated on screen, in
  print and in the export.

## 9. Backend contract

Documented separately in `BACKEND_CONTRACT.md`. It covers, before any real data is
connected:

- entity fields, types and invariants (account, party, item, document, line, tax
  line, open item, allocation, journal, ledger line, stock movement, account
  configuration, custom fields, profiles, views);
- a per-screen table of what each page reads, writes and must refuse;
- the posting transaction in order, from validation to audit, with reversal and
  soft delete;
- derived data and how each total is verified against its source;
- permissions, field-level access, audit, imports and the non-goals.

The rule for both documents: if a screen is built that they do not cover, the
document is updated first.

## 9A. Projects module

A project is a costing and access boundary, not a document type. Head office is a
project (`HO`), so company overhead has a home and nothing is "unassigned".

| Page | What it is |
|---|---|
| Projects | Every project with code, name, manager, status, its accounts, posting count, revenue, cost and net — derived from ledger lines tagged with that project. New project can be added in-session. |
| Project accounts | Which accounts belong to which project and which are head office. An account can be created here or from the chart, and carries its project. |
| Dashboard | Profit per project, cost against budget, unbilled work, overdue deliverables. Planned. |
| Budget | Revenue and cost budget per project against actual. Planned. |
| Access | Which people may see or post to which project. Planned. |

**Rules**

- Every journal, invoice, payment and stock line carries `project` and `cost_centre`.
- A user's project scope is a permission: an accountant may hold every permission in
  every module and still be restricted to one or more projects. Head office access is
  a scope like any other.
- Reports and the ledger filter by project; totals must reconcile to the same ledger
  with no project filter applied.
- A project is never deleted while it has postings; it is closed.

## 9B. Setup page

Configuration that belongs to accounting, not to the chart of accounts:

| Group | Contents |
|---|---|
| Organisation | legal name, base currency, fiscal year, current period, payment terms, credit-limit behaviour |
| Numbering | series prefixes and next number for journals, sales invoices, purchase invoices, payments, receipts |
| Default accounts | receivables control, payables control, tax accounts, inventory, bank, cash, rounding — all read from the flags on the accounts themselves |
| Dimensions | projects and cost centres |
| Approvals and periods | review threshold, self-approval rule, lock requirements, reopen authority, posting into a closed period, correction route |
| Documents | default terms, print layout per document type, attachment limits |

Nothing here duplicates the chart of accounts: control and tax accounts are declared
on the account, and Setup only shows the result.

## 9C. Locations, projects and access

- **Project is a dimension and may be empty.** There is no Head Office project.
- **Location** (branch, outlet, warehouse) is a dimension on every posting line.
- Books are company-wide: there is no branch selector in the header; a branch is a
  field on the entry.
- Items, warehouses and locations may belong to one or more projects, so an item for
  a new brand can be scoped to that project. A location may serve several projects; a
  project is never owned by one location.
- Access scoping is applied per project on every query, and is a permission, not a
  filter. An accountant with every accounting permission may still be restricted to
  one or more projects.
- See `DECISIONS-2026-11-21.md` §§9–10 for the cash & bank scope and the full
  decision list.

## 10. Dashboards

### 10.1 Shared design rules

- One page, no hero, no decorative imagery, no gradients behind text.
- Every number states its period and links to the page that explains it.
- Maximum two rows of content above the fold at 1280×800; a third row only if it is
  work, not navigation.
- Cards use one surface, one hairline, no shadow stack. Figures are tabular.
- No chart without a source on the same page. No empty chart placeholder.

### 10.2 Accounting dashboard

**Row 1 — position (four figures)**
Cash & bank · Receivables · Payables · Result for the period. Each with the basis
(“PKR, 3 accounts”, “14 customers”, “Nov 2026”) and a link.

**Row 2 — work waiting**
- Documents awaiting approval, with the oldest age.
- Drafts returned for correction.
- Bank accounts not reconciled, with unmatched line count.
- Invoices past due, with the amount over 60 days.
- Period-close steps outstanding.

**Row 3 — evidence**
- Cash movement for the period, from posted entries only.
- Last six journals with amount and state.
- Ageing strip for receivables and payables, five buckets.

Empty state: when there is no data, each block says what it will show and links to
the page that creates the first record. No fake numbers.

### 10.3 Inventory dashboard

Stock value total and by warehouse · items below reorder point · movements today
(in and out) · pending counts · top five movers · slow movers · value change this
period.

### 10.4 Taxes dashboard

Output tax due · input tax recoverable · net position for the period · withholding
receivable · withholding payable · next filing date and period · unreconciled tax
lines. Each links to its register.

### 10.5 Never on a dashboard

Marketing copy, module promo cards, decorative icons at large size, charts without
axes or labels, numbers without a period, anything that looks like a button but does
nothing.
