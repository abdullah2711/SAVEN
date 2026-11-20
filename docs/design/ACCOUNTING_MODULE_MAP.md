# Accounting module — page map

> Expanded with diagrams for Inventory and Taxes in
> `MODULE_MAP_ACCOUNTING_INVENTORY_TAXES.md`. This file keeps the accounting detail.

Status: **proposal, before build.** Two or three lines per page, the behaviour that
crosses pages, and the order I would build them in. Nothing here is implemented
unless marked **built**.

The principle: this module must be usable on its own. Parties, items, sales
invoices and purchase invoices therefore live inside Accounting, the way ERPNext
does it, so a business that never turns on the Selling or Buying module can still
raise an invoice and see the ledger effect. Turning those modules on later adds
workflow around the same documents; it does not replace them.

---

## 1. Navigation

Accounting expands in the left rail into these pages. The rail item stays selected;
the page title in the header changes to the sub-page name.

| # | Page | State |
|---|---|---|
| 1 | Dashboard | built (being reworked) |
| 2 | Journal entries | built |
| 3 | Parties | new |
| 4 | Receivables | built |
| 5 | Payables | built |
| 6 | Aging | built (party only) |
| 7 | Registers | new |
| 8 | General ledger | built |
| 9 | Chart of accounts | built |
| 10 | Trial balance | built |
| 11 | Statements | built |
| 12 | Payments | new |
| 13 | Banking & cash | partly (cash position only) |
| 14 | Items | new |
| 15 | Sales invoices | new |
| 16 | Purchase invoices | new |
| 17 | Approvals | built |
| 18 | Period close | built |

---

## 2. Pages

### 1. Dashboard
Landing page for the module. KPI blocks at the top (cash, receivables, payables,
profit), then work-in-progress: close readiness, approvals waiting, ageing
summary, recent journals. Bottom: shortcut groups (statements, registers, close)
and the module list with action links, in the ERPNext card-break style.

### 2. Journal entries
Register of every journal with state, source, amount and party. Filters by period,
state, journal and text; totals in the footer. "New journal" opens a full page
form, not a dialog.

### 3. New journal (form)
Header fields (date, journal, reference, narrative, currency, branch, workflow),
then lines: account, party, description, debit, credit, cost centre. Running
debit/credit totals, imbalance warning, posting blocked until balanced. Selecting
a control account reveals a party selector; posting updates that party's balance
and consumes its oldest open item first (see §3).

### 4. Parties
One register for customers and suppliers: name, type, group, tax ID, currency,
credit limit, payment terms, default accounts, opening balance, current balance,
overdue, oldest item, status. Filters by type, group, balance and overdue.
Opening a party shows its ledger, invoices, payments and ageing.

### 5. Party detail
Statement-style view: opening balance, every document and allocation in date
order, running balance, closing. Actions: new invoice, new payment, edit terms and
limit, hold or block. Credit limit breach is shown as a warning on new documents.

### 6. Receivables
Ageing and exposure by customer, with current / 1–30 / 31–60 / 61–90 / 90+,
credit limit usage, last activity. Actions: send statement, record receipt, open
party ledger. Total reconciles to the receivables control account.

### 7. Payables
The supplier mirror of receivables, with due-date focus instead of collection
focus. Actions: prepare payment, hold payment, open party ledger.

### 8. Aging
Two views in one page: by party (matrix of buckets) and by document (every open
invoice or bill with its own age, due date and bucket). Filters by party, type,
bucket, date and amount. Export to CSV.

### 9. Registers
Document registers by type — sales invoices, purchase invoices, payments,
journals — with party, date range, amount and state filters. This is where "show
me every transaction with this party in this period" is answered without opening
the ledger.

### 10. General ledger
Account selector (single or all), period, party, text search. Opening balance,
every posted line with running balance, closing balance, and a reconciliation line
that states opening + debits − credits = closing. Import for opening balances and
historical lines, with a dry-run preview before commit.

### 11. Chart of accounts
The full tree grouped by statement section, with codes, nature (asset, liability,
equity, income, expense), control flags and balances. Add, rename, regroup, set
nature, archive (blocked when the account has history), and import a chart. Control
accounts are marked and cannot be posted to directly except through their
subledger.

### 12. Trial balance
Opening debit/credit, movement during the period, and closing debit/credit in one
table, with group subtotals and a difference line that must read zero. Period
filters, hide-zero toggle, drill-through to the ledger, export.

### 13. Statements
Profit or loss and statement of financial position from the same ledger, with a
percentage-of-revenue column and a balance check. Notes and source schedules link
back to the accounts they are built from.

### 14. Payments
Payment entry for money in and money out: party, date, bank or cash account,
amount, reference, and an allocation table. Allocation offers oldest first, newest
first, or manual selection across one or many invoices, with any unallocated
remainder kept as an advance. Posting writes the ledger entry and the party
allocation together.

### 15. Banking & cash
Dashboard of bank and cash accounts with balances and a cash-flow strip, then a
register per account, then reconciliation: statement import, matching suggestions,
unmatched lines, and a reconciliation that cannot close with a difference.
Physical cash locations map to cash accounts.

### 16. Items
Light item master for accounting: code, name, unit, income account, expense
account, tax template, and an "inventory tracked" flag. Items marked tracked are
the only ones the Inventory module will value; untracked items post straight to
expense or income. No stock quantities here.

### 17. Sales invoices
Customer invoice with lines (item or free text), tax, due date, payment terms,
reference, and posting to receivables, income and tax. Submit, cancel with a
reversal, print. Creates the party balance and the ageing item.

### 18. Purchase invoices
Supplier bill mirroring sales: lines, tax, due date, and posting to payables,
expense or inventory-clearing. Used for expenses when Buying is off, and as the
accounting record of a bill when Buying is on.

### 19. Approvals
Queue of submitted documents waiting for review, with the reason, the amount, the
preparer and the lines. Approve, return with a note, or reject. Approval posts;
return does not.

### 20. Period close
Checklist (journals, bank, receivables, depreciation, statements), the trial
balance check, and a lock that requires evidence and sign-off. Reopening needs a
separate authorised action and is recorded.

---

## 3. Behaviour that crosses pages

**Party subledger.** A journal line on a control account (trade receivables, trade
payables) can carry a party. Posting updates the party balance, and the amount is
allocated to that party's oldest open item first. If no open item exists, it
becomes an unallocated advance or credit on account. The control account balance
always equals the sum of party balances; a mismatch is shown as an error, not
hidden.

**Payment allocation.** In Payments the user chooses the allocation rule: oldest
first, newest first, or manual. Manual selection can span several invoices and
leaves any remainder as an advance. The journal entry produced by Payments is the
same shape as a manual journal, so the ledger cannot tell them apart except by
source.

**Aging.** Age is measured from the due date, not the document date. Every posted
document creates one open item; every allocation consumes open items. Party ageing
is the sum of its open items, so party and document ageing can never disagree.

**Periods.** Anything that posts respects the open period. A document dated into a
closed period is refused with the reason, not silently moved.

---

## 4. Build order

1. **Journal entries** — full-page form with party-aware lines and the subledger
   rule. Everything else depends on correct posting.
2. **Chart of accounts** — nature, groups, control flags, import.
3. **Parties + party detail** — because the journal now references them.
4. **Receivables / Payables / Aging** — read the subledger; no new posting.
5. **General ledger + Trial balance** — filters, drill-through, import.
6. **Payments** — allocation against open items.
7. **Sales and purchase invoices** — documents that create open items.
8. **Banking & cash** — reconciliation last, because it needs statements.
9. **Items** — only when invoices need them.

## 5. What this map does not include

Statutory reporting packs, multi-currency revaluation, consolidation,
intercompany, fixed-asset registers, payroll and inventory valuation. Those belong
to their own modules and stay out of the accounting build until it is usable on
its own.
