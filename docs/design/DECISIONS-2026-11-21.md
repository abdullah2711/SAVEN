# Decision log — 21 November 2026 review

Every instruction from the latest review, what was decided, what is implemented in
the prototype, and where the detail lives for the backend. Status: **done** in the
UI · **mapped** means specified here and in the map, not built · **deferred** with a
reason.

| # | Decision | Status | Where |
|---|---|---|---|
| 1 | Ledger filters are dropdowns, and every dropdown is a **multi-select with tick boxes** (five accounts, three parties, two projects, three cost centres at once) | done | §1 |
| 2 | Tax page is one rail entry with horizontal tabs | done | §2 |
| 3 | Certificates and Returns dropped; **Reconciliation & adjustments** replaces them | done | §2 |
| 4 | Tax rules replace "codes and rates", with scope (all items, a group, a single item) and per-line override | done | §2 |
| 5 | Purchase-side withholding is **Withholding**; sales-side deduction is **Advance tax** | done | §2 |
| 6 | Opening/debit/credit/closing strip removed from the ledger; the stat component itself redesigned as cards where it is used | done | §3 |
| 7 | Favicon: plum mark in light browser themes, ivory in dark | done | §4 |
| 8 | Journal register: columns mirror the form, filters equal columns plus a column chooser, sortable headers | done | §5 |
| 9 | Duplicate "New journal" removed; the page action is the only one | done | §5 |
| 10 | Clicking a voucher opens the **complete record**, with actions by state | done | §6 |
| 11 | Journal form: Entry / More info tabs, entry subtype, project + location + cost centre per line | done | §7 |
| 12 | Quick entry mode (ERPNext style) | mapped | §7 |
| 13 | Form register in Setup: duplicate, edit, activate a form | mapped | §8 |
| 14 | Bank/cash line requires the bank account or cash custodian in the party field | mapped | §7 |
| 15 | Columns for fields added to a form appear in the register and ledger automatically | mapped | §8 |
| 16 | Projects and **Locations** are dimensions on every line; project may be empty ("None") | done | §9 |
| 17 | Branch selector removed from the top bar — the books are company-wide, branch is a field | done | §9 |
| 18 | Items, warehouses and branches can belong to one or more projects, for access scoping | mapped | §9 |
| 19 | Cash & bank scope: link accounts and custodians, reconcile, keep a reconciliation register; adjustments go through journals | mapped | §10 |
| 20 | Sub-module navigation uses horizontal tabs rather than more rail entries | done | §2, §10 |
| 21 | Payments may be made from Payments or from a journal entry; a journal payment does not allocate invoices | mapped | §11 |

---

## 1. Multi-select ledger filters

Each filter is a dropdown of tick boxes; empty means **all**. Combinations are AND
across filters and OR inside one filter:

```
(date range) AND (account IN […]) AND (party IN […]) AND (project IN […])
AND (location IN […]) AND (cost centre IN […]) AND (voucher type IN […])
AND (text matches)
```

- Account, party, project, location, cost centre and voucher type are multi-select.
- Empty set = no restriction, not "nothing selected".
- The column chooser is separate from the filters; it changes what is shown, never
  what is selected.
- Backend: filters map to `IN` lists on indexed columns; a saved view stores the
  arrays, not the SQL.
- Sorting is server-safe: sort key and direction are parameters, and the sort is
  applied before pagination.

## 2. Taxes — one page, five tabs

Rail entry: **Taxes**. Tabs: `Rules` · `Registers` · `Withholding` · `Advance tax` ·
`Reconciliation & adjustments`.

- **Rules** replaces "codes and rates". A rule has a kind (sales tax, purchase tax,
  withholding, advance tax), a rate, inclusive or exclusive, an account per side, a
  scope (all items, a group, or one item/service) and an effective range. Rules are
  defaults; any line may override the rate or switch tax off.
- **Registers** holds output and input tax lines with their reconciliation against
  the control accounts.
- **Withholding** is purchase-side only: tax we deduct from a supplier and owe to the
  authority. It is a liability from the moment of withholding.
- **Advance tax** is sales-side only: tax a customer deducts from our invoice and
  pays on our behalf. It is our asset until the return claims it.
- **Reconciliation & adjustments** covers recorded versus actual differences:
  rounding, a late rate, a credit note, a filing adjustment. Each adjustment carries
  a reason, a period, an account and evidence.
- **Certificates** and **Returns** are removed from the product. Certificates are an
  MVP-3 concern; a return is a report produced from the registers, not a workflow.
- The business can run without this page: a document line may carry a custom tax
  amount with any account flagged as a tax account.

## 3. The stat strip

- Removed from the general ledger entirely. A ledger has no "closing balance" card;
  the first and last row, or the trial balance, answer that.
- The component itself is redesigned as bordered cards with a label, a figure and a
  basis line, and is used on the dashboard only.
- Any future use of it states the period and links to the page that explains the
  number.

## 4. Favicon

`favicon.svg` uses the SA7EN mark, plum `#4A2935` by default and ivory `#F7F3EA`
under `prefers-color-scheme: dark`, so it reads on light and dark browser chrome. It
is independent of the application theme.

## 5. Journal register

- Columns: date, voucher, description, debit, credit, state, voucher type, subtype,
  party, project, location, cost centre — the column chooser controls the optional
  ones.
- Filters: one per column (multi-select where the values repeat) plus text search,
  plus the column chooser. **Filters = columns + column chooser.**
- Headers sort ascending and descending; the sort is shown by an arrow and is
  preserved when filters change.
- A single **New journal** action on the page heading. The duplicate inside the panel
  is gone.
- Clicking a row or voucher opens the record.

## 6. Record page

Opened from the register or the ledger. Shows the document header, every line with
its dimensions, totals, state and the audit line.

Actions by state:

| State | Allowed |
|---|---|
| Draft | Edit, submit for approval, duplicate, delete |
| Awaiting approval | Withdraw, duplicate; edit only after withdrawal |
| Returned | Edit, resubmit, duplicate, delete |
| Posted | Duplicate, print, reverse (a new document); no edit, no delete except an administrator soft delete |

- Duplicate creates a draft copy with a new number reserved, not a linked clone.
- Delete on a posted document is an administrator soft delete: hidden from lists,
  kept in the database and the audit log.
- Reversal is the normal correction for both journals and invoices.

## 7. Journal form

- **Tabs**: `Entry` and `More info`. Entry holds date, reference, narrative and entry
  subtype. More info holds branch, entry type (normal, adjusting, opening), workflow
  decision and the evidence area.
- **Entry subtype** is the ERPNext "entry type" equivalent: journal, expense, payment,
  opening, adjustment. The voucher type stays "Journal entry".
- **Every line carries account, party, project, location, cost centre, description,
  debit, credit.**
- **Party is mandatory when the account is a control account.**
- **Bank or cash accounts require a counterparty in the same column**: the bank
  account for a bank line, the cash custodian or cash location for a cash line. The
  column is labelled Party; the options depend on the account type.
- **Project and location and cost centre can be made mandatory in Setup**, per
  company. When set, an entry without them is refused at submission.
- **Quick entry (mapped)**: a compact single-line grid for repetitive journals —
  date and reference fixed, one debit line and one credit line per row, Enter
  creates the next row, totals in the footer. Same validation as the full form.
- No multi-currency in this phase; the currency field is fixed to the company
  currency until after MVP-2.

## 8. Forms register (Setup)

- Setup holds a register of forms: journal entry, sales invoice, purchase invoice,
  payment, party, item, and any custom form.
- A form can be **duplicated**, edited and activated; the original stays available.
- Editing covers field visibility, required state, order, grouping, defaults and
  custom fields, exactly as `FORMS_AND_VIEWS.md` specifies.
- Required-by-ledger fields cannot be hidden; a configuration that would do so is
  refused when the form is activated.
- **A field added to a form becomes a column in its register and in the ledger**
  (the ledger shows it as an optional column), and can be used in filters and saved
  views. This is how "user adds a weather field" works without code.

## 9. Projects and locations

- **Project is optional**; empty means "no project". The fake Head Office project is
  gone.
- **Location** is a dimension on every line, alongside project and cost centre.
  Branches, outlets and warehouses are locations.
- **Books are company-wide.** The top-bar branch selector is removed: a branch is a
  field on an entry, not a separate set of books.
- **Items, warehouses and locations can belong to one or more projects.** A new-brand
  item can be scoped to that project so another project's accountant cannot post it.
  A location can serve several projects; a project never belongs to a single
  location.
- **Access**: a project accountant holds permissions across modules but is scoped to
  one or more projects. The scope is enforced on every query, not only in lists.
- Project totals (revenue, cost, net) come from the tagged lines and reconcile to the
  unfiltered ledger.

## 10. Cash & bank scope

Cash & bank does not create balances; the ledger does. Its job is:

1. Link each bank account to its control account, and each cash location to a
   custodian and a cash account.
2. Reconcile bank statements against the ledger.
3. Keep a **reconciliation register**: date, account, statement balance, ledger
   balance, difference, reason, who reconciled, evidence.
4. Any difference is corrected by a journal entry, never by editing the
   reconciliation.
5. Show a register/ledger per bank account or cash location, the same way a party
   ledger is shown from the party record.

## 11. Payments

- A payment can be recorded in **Payments** (with allocation against invoices) or as
  a **journal entry** with a payment subtype.
- The journal route does not allocate invoices; the party allocation is created in
  Payments or by the allocation screen. The ledger treats both identically except for
  the source.
- Paying the holding tax to the authority is a payment to the tax authority, not a
  tax adjustment.

---

## What is deferred and why

- **Quick entry** — mapped above; the full form must settle first.
- **Forms register UI** — mapped; the configuration model already exists in
  `FORMS_AND_VIEWS.md`.
- **Bank/cash party options** — the column exists and validates control accounts;
  the bank/custodian option list arrives with the Cash & bank build.
- **Cash & bank tabs and reconciliation register** — mapped in §10.
- **Item/warehouse/location project scoping and access enforcement** — mapped in §9;
  it is a permission layer, not a screen.
- **Certificates, returns, multi-currency** — out of scope for this phase by the
  owner's direction.
