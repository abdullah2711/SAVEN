# System logic map — SAVEN accounting and settings

This is the single map of **what the system does, why, and where it was decided**.
Read it before adding anything. If a new instruction contradicts something here, the
conflict is listed in §11 first, so the two can be discussed instead of silently
overridden.

Rule of precedence: **newest explicit owner feedback wins**, and the decision log is
amended to say what it superseded. Nothing is deleted from the log.

Companion documents:

| Document | Purpose |
|---|---|
| `DECISIONS-2026-11-21.md` | every decision, in the order it was made |
| `CONTEXT_HANDOFF.md` | how to resume work in a new session |
| `MODULE_MAP.md` | module and page descriptions |
| `MODULE_PAGES.md` | generated page register with states |
| `ACCOUNTING_WORKFLOWS.md` | workflow detail |
| `BACKEND_CONTRACT.md` | command, identity and audit contract |
| `FORMS_AND_VIEWS.md` | form and view inventory |

---

## 1. The shape of the product

- One business per session. The business is chosen at **sign-in**; the topbar shows
  its name, never a switcher.
- Books are **company-wide**. Locations and projects are data fields that slice the
  same ledger; they never hold balances of their own.
- Every financial effect is a **balanced journal**; there is no other way to change a
  balance.
- A **control account** is an account whose balance is the sum of its sub-accounts
  (parties, bank accounts, cash custodians). Ordinary accounts have no sub-accounts.
- Two doors to the same data: a **register** lists records, a **form page** creates or
  edits one. There is no inline create form on a register.

---

## 2. Page map and state

### Accounting

| Page | State | Owns |
|---|---|---|
| Dashboard | complete | position, cash trend, ageing, attention, recent journals |
| General ledger | complete | every posting line; filters, columns, totals, export |
| Journal entries | complete | journal register; row opens the journal form |
| Parties | complete | customers and suppliers, statements, access |
| Cash & bank | complete | cash and bank sub-accounts, balances at a date |
| Payment / Receipts | complete | receipts and payments, several methods, oldest-first allocation |
| Items | complete | item master for accounting |
| Sales invoices | complete | invoice register, returns tab, open/return menu |
| Purchase invoices | complete | bill register, returns tab, open/return menu |
| Chart of accounts | complete | heads, groups, controls, balances |
| Chart of accounts | complete | account register with account form page |
| Reports | complete | ageing, trial balance, P&L, position, cash flow, equity |
| Reports | complete | ageing, P&L, position, cash flow, equity |

### Operations

| Module | State | Covers |
|---|---|---|
| Inventory | working | warehouses, balances, movements, receipts, deliveries, transfers, counts, adjustments, valuation, reorder, reports, module settings |
| Manufacturing | working | BOMs, routings, work centres, planning, work orders with release/issue/produce/close, scrap, costing, reports; subcontracting described |
| Assets | working | categories, register, acquisitions, depreciation run, impairment, transfers, disposals, reports |

All three are derived from one stock/asset ledger: balances are computed, never stored,
so the pages cannot disagree. Links: the shared item master, warehouses → accounting
locations, movements carrying project and location, production changing stock value.

### Settings (Workspace settings)

Company · Accounting · People & access · Periods · Forms & fields · Saved views ·
Print & templates.

Settings → Accounting is tabs of registers, each with a form page (or a configuration
form where it edits one object):

| Tab | Kind |
|---|---|
| Numbering | configuration form |
| Default accounts | configuration form |
| Accounting heads | register + form page |
| Projects | register + form page |
| Locations | register + form page |
| Cost centres | register + form page |
| Party groups | register + form page |
| Item groups | register + form page |
| Taxes and withholding | rules register + form page, withholding configuration |
| Approvals | configuration form |

Settings → Periods owns the period lock: closing a past period locks it, and only an
administrator may lock or reopen.

Settings also holds **Inventory** and **Manufacturing** defaults (costing, negative
stock, accounts, warehouses; issue policy, BOM requirement, work centre, accounts) and
a **print register with one template per document**.

`FORM_AUDIT.md` records the form/register audit: every page and editor renders, the
fields added this round, and the bounded items still open.

---

## 3. Registers and forms — the universal interaction

1. A register page shows only the list, with:
   search (instant, caret preserved), filters relevant to that record, a
   **permanent horizontal scroll indicator above the table**, “shown of total” count,
   and a footer total that follows the filters.
2. Creation is the **page action** at the top right. There is no second create button
   inside the panel.
3. **Clicking anywhere on a row** opens that record.
4. The form opens on its **own page**: `mode=editor` and, when editing, `code=<id>`.
   The URL is therefore bookmarkable, refreshable and back-button friendly.
5. Save returns to that record’s register; Cancel returns without saving.
6. One form component serves create and edit — never a separate edit dialog.

State decides the actions:

| Document state | Form | Allowed |
|---|---|---|
| Draft | editable | save, submit, submit for approval, duplicate, delete |
| Returned from approval | editable | same as draft |
| Posted | read-only | cancel, duplicate, delete once cancelled |
| Cancelled | read-only, no ledger effect | delete, duplicate |

---

## 4. Master data — who owns which field

| Record | Fields that matter | Access fields | Notes |
|---|---|---|---|
| Party (customer/supplier) | code, name, type, group, contact, phone, email, currency, terms, credit limit, opening, tax id, status, address, notes | allowed projects, allowed locations | the sub-account of 1100 or 2100 |
| Cash / bank sub-account | code, name, control head, kind, bank, branch, IBAN/reference, currency, opening, status, notes | allowed projects, allowed locations | the sub-account of a bank or cash control |
| Item | code, name, group, unit, description, income head, expense head, tax rule, tracked flag, sale/purchase price, status | — | shared with Inventory; quantity lives there |
| Tax rule | code, name, kind, rate, basis, account, scope, effective from/to, status, line override, description | allowed projects, allowed locations | a default, never a posting |
| Project | code, name, manager, state, start, end, budget, description | — | data field, no balance |
| Location | code, name, kind, address, contact, phone, notes | — | a branch is a location kind |
| Accounting head | code, name, class, control type, description | — | control type drives the party requirement |

Access lists are **not** permissions. They narrow what can be picked; they never
restrict the ledger and never change a balance.

---

## 5. Journals

### Header
date, posting time, voucher number, subtype, **one location for the whole voucher**,
narration, evidence, audit strip (created by/at, source, submitted by), custom fields.

### Lines
**account → project → party / sub-account → cost centre → debit / credit.**

- Account is first because it decides whether a party is required and which parties
  are offered.
- Project and location are chosen before the party so the party list can be narrowed
  by what that party is allowed on.
- Cost centre comes after the party; amount last.

### Rules
- A line must have a source account and one positive debit or credit.
- Debits must equal credits before submission.
- **Every control line needs a party or sub-account, with no exception.** Adjustment
  no longer bypasses it (decision 81).
- Party options are filtered by the account kind (customer, supplier, bank, cash) and
  by the party’s allowed projects and locations.
- Changing the project or location clears a party that is no longer allowed.
- Posting guards: no future time, nothing before the business was created, nothing in
  a closed period.
- The number series is frozen after the first document; numbers are never reused.

### Lifecycle
Draft → (submit) → Posted. Submitted for approval → Posted or Returned (editable).
**Cancel** removes the ledger effect and keeps the register row; **Delete** removes it
from the register (draft or cancelled only); **Reversal is optional** and only used
when the correction must stay visible. The audit log keeps everything.

---

## 6. Balances and control accounts

- Balances exist only on accounts.
- A control account’s balance equals the sum of its sub-accounts. The register pages
  show the sub-account detail; the chart shows the head balance.
- **Profit and loss by project or location works** because every line carries the
  dimension.
- **Balances are not sliced by project or location.** That would need the dimension on
  documents and open items, with an unallocated bucket; it is deferred until the party
  subledger is the source (decision 48).
- Cash & bank can be read **at any date**: current, or the close of a chosen day, with
  the current figure kept underneath (decision 82).

---

## 7. Payments, invoices, taxes

- **Returns** are documents against an invoice or bill. A return is numbered `SR-` or
  `PR-`, reduces the original's balance (partially or completely) and leaves the
  original posted with its number. The Returns tab lists them and can create one
  without opening the invoice first.
- **Payments** settle the oldest open documents first; the remainder is an advance.
  A single document may use bank, cash or an existing advance, and an invoice can
  record its own payment while it is created.
- An invoice balance is **gross − returned − paid**; the register shows all three.
- **Invoices and bills** carry party, dates, terms, reference, location, narration,
  lines with quantity and price, and tax at the rule’s rate. They are session records
  until ledger posting exists.
- **Taxes**: rules are defaults (kind, rate, basis, account, scope, effective dates,
  access). Registers are derived from the tax lines on documents. Withholding is a
  liability that is never ours; advance tax is our asset. Reconciliation compares the
  register total with the tax control balance and shows the difference.
- The fixture records none of the withholding or advance, so those pages show a
  visible gap rather than an invented number.

---

## 8. Reports

Ageing, trial balance, profit & loss, financial position, cash flow and equity are tabs on one page
and are all built from the same ledger, so they cannot disagree with the trial
balance. Statutory presentation, comparatives and indirect cash flow are explicitly
not claimed.

---

## 9. Numbering

- `NUMBERING` in the accounting model is the single source: journal prefix with month
  and year segments, sales, purchase, payment and receipt prefixes, next number and
  padding.
- Journals are generated as `JV-MM-YYYY-0001` (prefix · month · year · padded
  sequence) from those settings.
- Settings → Accounting → Numbering renders and saves the same value. Creating a new
  journal re-reads it. A series is frozen after its first document; numbers are never
  reused.

---

## 10. Settings ↔ documents

- Default accounts, numbering and approval policy are set in Settings and are what the
  document forms refer to.
- Custom fields added in Settings → Forms & fields appear on the journal’s **More info**
  tab and save with the draft.
- The company identity prints on every document.
- The period lock in Settings → Periods and the close checklist share one switch.

---

## 11. Conflicts and supersessions

| Item | Earlier decision | Current rule | Decision |
|---|---|---|---|
| Location on journal lines | per line | one location on the voucher header | 35 → 39 |
| Adjustment may omit the party | allowed | **never allowed**; every control line needs a party | 81 |
| Projects/Locations pages | built as pages with dashboards | removed; data fields created in Settings | 42/53 → 69 |
| Setup inside Accounting | accounting page | Settings module, Accounting tab | 54 → 69 |
| Cash & bank statistics strip | four KPI figures | removed for now | 80 |
| Create button inside register | second “New …” in the panel | page action only | 76 |
| Journal row → record page | inline detail page | journal form page, state-aware | 83 |
| GL row → detail dialog | inline expansion | opens the document in its own page | 88 |
| Back to register | always journals | returns to the register being edited | 87 |
| Journal numbering | `JV-MM-YYYY-0001` in the form vs `JE-2026-` in settings | one source: settings define the series, the form composes it | 89 (resolved) |
| Cash & bank statistics | four KPI figures | removed; the cash flow report answers it for this phase | 90 (resolved) |
| Settings registers | tables with inline forms | registers with form pages; groups added | 93/94 (resolved) |
| Taxes in Accounting | taxes page | moved to Settings → Accounting → Taxes | 97 (resolved) |
| Period close in Accounting | checklist page | Settings → Periods owns the lock | 99 (resolved) |
| Party statement page | party page with statement | Open leads to the GL with the party filter; row opens the form | 95 (resolved) |
| Cash statement page | rows opened the form only | Open leads to the GL with the sub-account filter | 96 (resolved) |
| Chart and trial | split view + separate trial page | one page, two tabs, register and trial | 98 (resolved) |
| Document cancel/delete | journals only | every document uses the same lifecycle; returns get their own flow later | 91 (resolved) |

### Open questions

None of the recorded conflicts is open. The remaining work is a scope list, not a
disagreement: payments and invoices review, every form reviewed field by field, print
formats, settings pages review, then posting, persistence, bank reconciliation and
permissions. See §100 of the decision log.

---

## 12. Decision index

| Round | Sections | Theme |
|---|---|---|
| 1–2 | 1–21 | shell, module map, accounting scope, ledger, journals, taxes |
| 3 | 22–27 | one picker, sub-account filtering, identity, dimensions explained |
| 4 | 28–32 | selection bug, upload, scrollbar, cancel/delete semantics |
| 5 | 33–37 | line fields, subtype only, location on lines (later superseded) |
| 6 | 38–46 | scroll indicator, header location, company switching, dimension pages |
| 7 | 47–51 | projects and locations as data fields, ledger totals, supplied icons |
| 8 | 52–56 | totals simplified, pages removed, tabbed Setup, membership |
| 9 | 57–63 | cash & bank, items, taxes, reports, chart, trial |
| 10 | 64–69 | control heads as data, parties, payments, invoices, close, Settings |
| 11 | 70–72 | complete and editable forms |
| 12 | 73–76 | register/form separation, single create button |
| 13 | 77–82 | table scrollbars, row editing, control-party rule, balances at a date |
| 14 | 83–85 | journal opens in form, GL party/sub-account, scrollbar on top |
| 15 | 86–88 | journal export, back to register, GL rows open documents |
| 16–17 | 89–100 | numbering, cash statistics, settings registers, taxes, period lock, statements |
| 18–20 | 101–115 | controls, balances at a date, register/form split, one create button |
| 21–24 | 116–132 | scroll tracks, row editing, control-party rule, dimensions as data |
| 25–27 | 133–140 | journal register columns, reversal, party reset, custom columns |
| 28 | 141–146 | journal dates, party form corrections, opening journal, reconciliation register |
| 29 | 147–153 | form dropdown row fix, optional policy fields, policy log, recon header menus, field styling |
| 30 | 154–158 | one custom select component, CB numbering, cash and payments register parity |
| 31 | 159–165 | payment module settles documents, PAY/RCPT numbering, no tax on payments |
| 32 | 166–169 | floating lists escape table cells, cheque removed, invoice balances follow settlements |
| 33 | 170–173 | every list searchable, inner scroll keeps it open, placement stays beside the field |
| 34 | 174–182 | debounced search, invoice registers/form, withholding, uploads, previews, tax defaults |
| 35 | 183–185 | Taxes linked into Accounting, invoice register fits, item row widths |
| 36 | 187–193 | tax account subtype/override, withholding defaults and party register, row layout, payment voucher |
| 37 | 194–196 | per-line discount, tax on discounted or original amount, policy version |
| 38 | 197–199 | payment voucher preview, complete read-only opened documents |
| 39 | 200–208 | item statistics, reports and taxes as modules, advances, returns, stock section, one items page |
| 40 | 210–212 | default item account rules, inventory cost entry, cost-of-sales account |
| 41 | 213–217 | advance balance after application, advance entry previews, ADVA application documents |
| 42 | 220–222 | bill inventory receipt/clearing, advance account filtering, document overflow menu |
| 43 | 223 | duplicate preview removed |
| 44 | 224–225 | return entries, inventory reversal, exact invoice price |
| 45 | 226–228 | payment/stock menu actions, stock editor, return stock movement |
| 46 | 229–231 | full logic sweep, menu/return fixes, verification results |
| 47–49 | 232–237 | item row widths, split payments, full-width workspace and table scroll |
| 50 | 238–239 | single Return action, closeable document menu |
| 51 | 240–246 | chart architecture: six-digit codes, controls, tax authorities, fixed assets |
| 52 | 247–250 | tax controls per type, authorities as sub-accounts, party tax reconciliation |

---

## 13. Pending and incomplete

- Every form needs a field-by-field review, and its effect on register columns.
- Subcontracting flow, standard-cost comparison, module defaults moved into Settings.
- Field-by-field form audit and print formats review.
- Posting from operations to the ledger, persistence, permissions.
- Print formats and the remaining settings pages need review.
- Posting: invoices and payments record session documents but do not write the ledger.
- Party balances by project/location (deferred, needs the subledger).
- The chart rebuild follows `docs/design/CHART-OF-ACCOUNTS-DESIGN.md`; no code has
  changed for it yet.
- Permission enforcement; settings are not enforced by the server yet.
- Persistence: every record lives in the browser session and is lost on reload.
- Per-line invoice tax override, withholding allocation and negative-stock
  enforcement are not built.
- The invoice form now has item rows, withholding and a record-payment section; what
  remains is invoice numbering, per-item-group tax scope, per-row tax override,
  multi-currency and cancelling a saved invoice. Payments settle documents; advances,
  editing a saved payment, posting and multi-currency remain.
- Cheque tracking, if required, needs an instrument/reference field or clearing
  account; it is deliberately not a payment method (§167).
- Reconciliation is a recording tool; there is no automatic statement matching.

