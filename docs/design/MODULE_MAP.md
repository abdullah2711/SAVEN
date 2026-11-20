# Module map — Accounting, Inventory, Taxes

Plain-text version, for reviewing and commenting. Section numbers are stable, so
comment as “2.6” or “3.4”.

States: **built** (working screen in the design build) · **partial** (works, covers
part of the page) · **planned** (mapped, not built).

---

## 1. How the three modules connect

- A **document** (sales invoice, purchase invoice, journal, payment) is the only
  thing that moves money.
- Accounting owns the ledger. Nothing else writes to it directly; inventory and tax
  post through journals so every balance has a document behind it.
- Inventory owns quantity and cost. It posts the value it consumed or added.
- Taxes own the tax lines. A return is a query over those lines, not a rebuild.

Flow in words:

```
Sales invoice   -> receivable open item  -> party balance -> ageing
                -> income                -> ledger
                -> output tax line       -> tax register -> return
                -> stock issue (if item is tracked) -> COGS

Purchase invoice -> payable open item    -> party balance -> ageing
                 -> expense or clearing  -> ledger
                 -> input tax line       -> tax register -> return
                 -> stock receipt        -> inventory value

Payment          -> bank or cash         -> ledger
                 -> allocation           -> consumes open items

Journal          -> ledger
                 -> if the account is a control account: party balance + oldest open item
```

---

## 2. Accounting

### 2.1 Navigation

```
Accounting
├── Dashboard
├── Journal entries
│   ├── Register
│   └── New journal (full page, not a dialog)
├── Parties
│   ├── Party register
│   └── Party detail (ledger, documents, limits)
├── Receivables
├── Payables
├── Aging
│   ├── By party
│   └── By document
├── Registers
├── General ledger
├── Chart of accounts
├── Trial balance
├── Statements
├── Payments
├── Banking & cash
│   ├── Accounts and cash flow
│   ├── Account register
│   └── Reconciliation
├── Items
├── Sales invoices
├── Purchase invoices
├── Approvals
└── Period close
```

### 2.2 Pages

**2.2.1 Dashboard — built, being reworked**
Position and work waiting. Four figures with their basis, what needs action,
one real trend, recent journals, shortcut links. No decoration. See §8.

**2.2.2 Journal entries (register) — built**
Every journal with date, number, narrative, source, state, debit, credit and net.
Filter by state, source, period and text; totals in the footer. Row opens the entry
with its lines; "New journal" opens the form.

**2.2.3 New journal (form) — built, needs the party field**
Full page. Header: date, journal, reference, narrative, currency, branch, workflow.
Lines: account, party (only on control accounts), description, debit, credit. Running
totals, imbalance warning, posting blocked until balanced. Evidence attachment.
Posting writes the ledger, the party balance and consumes the oldest open item.

**2.2.4 Parties — planned**
One register for customers and suppliers: type, group, tax identity, currency,
payment terms, credit limit, opening balance, current balance, overdue, status.
Filters by type, group, balance and overdue. Opening a party opens 2.2.5.

**2.2.5 Party detail — planned**
Statement view: opening balance, then every document and allocation in date order,
running balance, closing. Actions: new invoice, new payment, edit terms, hold or
block. A credit-limit breach is shown before a new document is saved.

**2.2.6 Receivables — built**
Exposure by customer: current, overdue, oldest item, balance, share of total.
Actions: open party ledger, record receipt, send statement. Total equals the
receivables control account.

**2.2.7 Payables — built**
Supplier mirror of 2.2.6, focused on due dates rather than collection. Actions:
prepare payment, hold payment, open party ledger.

**2.2.8 Aging — built for parties, planned by document**
Two views. By party: the bucket matrix (current, 1–30, 31–60, 61–90, 90+). By
document: every open invoice or bill with its own due date, age and bucket.
Filters by party, type, bucket, date and amount; export.

**2.2.9 Registers — planned**
Document registers by type (sales, purchase, payment, journal) filtered by party,
date range, amount and state. This is where "show me every transaction with this
party in this period" is answered without opening the ledger.

**2.2.10 General ledger — built, import planned**
Account selector (one or all), period, party, text search. Opening balance, every
posted line with a running balance, closing balance, and a line that proves
opening + debits − credits = closing. Import for opening balances and history, with
a dry-run preview before commit.

**2.2.11 Chart of accounts — built, import planned**
The full tree by statement section, with code, name, nature (asset, liability,
equity, income, expense), control flag and balance. Add, rename, regroup, set
nature, archive (blocked when the account has history), import a chart. Control
accounts are marked and cannot be posted to directly.

**2.2.12 Trial balance — built**
Opening debit/credit, movement during the period, closing debit/credit, group
subtotals, and a difference that must read 0.00. Period filter, hide-zero, drill
through to the ledger, export.

**2.2.13 Statements — built**
Profit or loss and statement of financial position from the same ledger, with a
percentage-of-revenue column, a balance check, and links from each line to its
accounts.

**2.2.14 Payments — planned**
Money in and money out: party, date, bank or cash account, reference, amount, and
an allocation table. Allocation can follow oldest first, newest first, or a manual
selection across several invoices, with the remainder kept as an advance. Posting
writes the ledger entry and the allocation together.

**2.2.15 Banking & cash — partial**
Bank and cash accounts with balances and a cash-flow strip; a register per account;
reconciliation with statement import, suggested matches and unmatched lines. A
reconciliation cannot be closed with a difference. Physical cash locations map to
cash accounts.

**2.2.16 Items — planned**
Light item master used by invoices: code, name, unit, income account, expense
account, tax treatment, and an "inventory tracked" flag. No quantities here.

**2.2.17 Sales invoices — planned**
Customer invoice with item or free-text lines, tax, due date, terms. Posting creates
the receivable open item, updates the party balance and writes the ledger and tax
lines. Submit, cancel with reversal, print, credit note.

**2.2.18 Purchase invoices — planned**
Supplier bill mirroring sales, posting to payables and to expense or
inventory-clearing. Used for expenses when Buying is off, and as the accounting
record of a bill when Buying is on.

**2.2.19 Approvals — built**
Queue of documents waiting for review with reason, amount, preparer and lines.
Approve posts; return and reject do not.

**2.2.20 Period close — partial**
Checklist (journals, bank, receivables, depreciation, statements), trial balance
proof, and a lock that requires evidence and sign-off. Reopening is a separate
authorised action and is recorded.

### 2.3 Cross-page rules

- A control account cannot be posted without a party; documents cannot post to it
  directly.
- Party balance equals the sum of its open items. A difference against the control
  account is surfaced as an error on the dashboard.
- A journal dated into a closed period is refused with the reason, never moved.
- Corrections are reversals. A posted document is never edited.

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
Stock value, low-stock items, movements today, slow movers, and value by warehouse.
Every figure links to the report that explains it.

**3.2.2 Items — planned**
Code, name, unit, category, income account, expense account, inventory account, tax
treatment, reorder point, costing method, tracked flag. Untracked items never enter
stock balances.

**3.2.3 Item groups — planned**
Tree used for reporting, default accounts and tax defaults. Changing a group does
not silently repost history.

**3.2.4 Warehouses & locations — planned**
Stores, bins, branch mapping, default inventory account. Transfers between them do
not change total value.

**3.2.5 Stock balances — planned**
Quantity and value per item and warehouse, with last movement date and average cost.
Reconciles to the inventory control account.

**3.2.6 Stock movements — planned**
Every in and out line: date, item, warehouse, quantity, value, source document,
reason. Filter by item, warehouse, type and period.

**3.2.7 Goods receipt — planned**
Receive against a purchase invoice or order, with batch or serial optional. Posts
the movement and the clearing entry.

**3.2.8 Delivery note — planned**
Issue against a sales invoice. Cost leaves at the item's costing method and posts to
cost of sales.

**3.2.9 Transfers — planned**
Move quantity between warehouses without changing total value; a two-line movement.

**3.2.10 Stock count — planned**
Count sheet, variance, approval, adjustment posting. The count never edits balances
directly.

**3.2.11 Adjustments & write-offs — planned**
Damage, expiry, net-realizable-value write-down, each with a reason code, approval
and evidence.

**3.2.12 Valuation & costing — planned**
Costing method per item (weighted average or FIFO), revaluation, landed-cost
allocation across items.

**3.2.13 Reorder & alerts — planned**
Items below their reorder point with suggested quantities and last supplier.

**3.2.14 Reports — planned**
Stock ledger, movement summary, valuation, ageing, gross margin by item.

**3.2.15 Settings — planned**
Default accounts, units, costing default, negative-stock policy.

### 3.3 Rules

- Quantities are whole or three decimals; value is always money with two decimals.
- Inventory control account equals the sum of item balances; a gap is an error.
- Negative stock is refused unless explicitly allowed, and then flagged everywhere.
- Only inventory-tracked items are valued.

---

## 4. Taxes

### 4.1 Navigation

```
Taxes
├── Dashboard
├── Registrations & jurisdictions
├── Tax codes & rates
├── Tax groups
├── Output tax register
├── Input tax register
├── Withholding
├── Reconciliation & returns
├── Adjustments & corrections
├── Certificates
└── Settings
```

### 4.2 Pages

**4.2.1 Dashboard — planned**
Liability or credit by period, next filing date, unreconciled tax lines, and the
accounts the position sits in.

**4.2.2 Registrations & jurisdictions — planned**
Tax identities per company and branch, jurisdiction, effective dates, filing
frequency, return template.

**4.2.3 Tax codes & rates — planned**
Code, rate, inclusive or exclusive, base amount rule, output and input accounts,
effective range. A code cannot be deleted once used.

**4.2.4 Tax groups — planned**
Combine codes for a document, for example standard rate plus withholding, with the
order in which they apply.

**4.2.5 Output tax register — planned**
Every sales tax line: date, document, party, base, rate, tax, code. Filter by period
and code; totals must agree with the tax control account.

**4.2.6 Input tax register — planned**
Every purchase tax line, with the recoverable and blocked portions separated.

**4.2.7 Withholding — planned**
Withheld from suppliers and by customers, expected versus actual, certificates due.
Links to the documents that caused each line.

**4.2.8 Reconciliation & returns — planned**
Period return: output, input, carried forward, payable. Locks the period with a
snapshot and the evidence that produced it.

**4.2.9 Adjustments & corrections — planned**
Manual adjustment with reason, approval, evidence and an effective date. Posts to
the tax control accounts.

**4.2.10 Certificates — planned**
Issue and receive withholding certificates; link each to the documents it covers.

**4.2.11 Settings — planned**
Rounding, inclusive pricing, default accounts, filing periods, whether input tax is
recoverable by default.

### 4.3 Rules

- A tax line stores base, rate and amount. Totals derive from lines, never the
  reverse.
- Inclusive prices are back-calculated and the residual posts to rounding.
- The tax control account equals the sum of unreconciled tax lines for the period.
- A filed return is locked; later corrections are new adjustments with evidence.

---

## 5. Shared data

| Entity | Key fields |
|---|---|
| Party | id, type, name, group, tax id, currency, terms, credit limit, status |
| Document | id, type, date, party, currency, due date, state, source |
| Document line | account, item, description, quantity, rate, amount, tax group |
| Tax line | code, base, rate, amount, jurisdiction, recoverable |
| Open item | document, party, amount, due date, outstanding, bucket |
| Allocation | open item, payment, amount, date, mode (oldest / newest / manual) |
| Journal entry | number, date, source, state, lines, reversal of |
| Ledger line | account, party, debit, credit, period, entry |
| Item | code, name, unit, accounts, tax, tracked, reorder point, costing |
| Stock movement | item, warehouse, quantity, value, direction, source |

---

## 6. Who writes what

| Action | Accounting | Inventory | Taxes |
|---|---|---|---|
| Sales invoice | receivable, income, party item | stock issue and COGS if tracked | output tax line |
| Purchase invoice | payable, expense or clearing | stock receipt at cost | input tax line |
| Payment | bank, allocation, party balance | — | withholding if applicable |
| Journal | ledger, party on control accounts | — | tax adjustment lines |
| Stock count | COGS or write-off | quantity and value | — |
| Tax return | tax control accounts | — | return snapshot and proof |

---

## 7. Build order

1. Journal entry form with the party field (unblocks everything).
2. Chart of accounts: nature, groups, control flags.
3. Parties and party detail.
4. Receivables, payables, ageing by party and by document.
5. General ledger and trial balance with filters.
6. Payments with allocation.
7. Sales and purchase invoices.
8. Items, then inventory movements and valuation.
9. Taxes: codes, registers, return.
10. Banking reconciliation.

---

## 8. Dashboard contract

**Must show above the fold at 1280×800**

- Four figures with their basis: cash and bank, receivables, payables, result for
  the period. Each links to the page that explains it.
- What needs action: approvals waiting, drafts returned, unreconciled bank lines,
  overdue receivables — each with a count and a link.
- One real trend: cash movement for the period, from posted entries.
- Recent activity: the last journals with amounts and state.

**Rules**

- No hero band, no decorative images, no marketing cards, no gradient behind text.
- No chart without a data source on the same page; no number without a period.
- Nothing may look like a primary action unless it is one.
- Everything on the dashboard is a link into a page that can explain it.
- Two rows of content, not five. If it scrolls, the second screen is work, not
  modules.
