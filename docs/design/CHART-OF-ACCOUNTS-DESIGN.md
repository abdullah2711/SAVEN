# Chart of accounts — agreed design

Status: target agreed; group tagging and the tax module are implemented, the six-digit
codes and full chart migration are not. Owner decision 26 November 2026. This document
is the contract for the chart rebuild.

## Implementation status (26 November 2026)

- **Implemented:** accounting heads (five classes), **accounting groups** register and
  form in the Chart page, group sequence per class, group selection and validation on
  the account form, tax module with six natures, authorities as records, system-numbered
  rules with multi-group scopes and conflict checks, entries, six party-balance tabs,
  three tax-entry types (adjustment for all six natures, withholding payment, closing),
  final sales tax payable/receivable controls, income tax payable/expense, and sample
  June/July tax data.
  Prices are tax-exclusive; the default authority per nature is set under Default
  accounts.
- **Still target, not implemented:** the six-digit account codes and full fixture
  migration; account codes remain the four-digit demo codes for now. Groups already
  carry the two-digit segment that will become the middle of the code.
- **Authorities:** the UI treats authorities as sub-accounts conceptually; the current
  demo derives authority balances from tax entries. Real chart sub-accounts are part of
  the six-digit rebuild.
- **Demo tax accounts:** 2200 output, 1300 input, 2150 withholding income, 2210
  withholding sales, 1400 advance income, 1024 advance sales, 2220 final sales payable,
  1220 final sales receivable, 2160 income tax payable and 5400 income tax expense are
  used until the migration. The adjustment P&L accounts are **5300 Tax adjustment
  expense** and **4200 Tax adjustment income**. The six-digit codes in the migration
  table are the target; 2220/1220/2160/5400 are already mapped there.

## 1. Code structure — six digits

```
D GG AAA
│ │  └── account number inside the group: 001–999
│ └───── group number inside the class: 01–99
└─────── class: 1 assets, 2 liabilities, 3 equity, 4 income, 5 expenses
```

Examples:

| Code | Meaning |
|---|---|
| 101001 | Cash control |
| 101002 | Bank control |
| 102001 | Trade receivables |
| 103001 | Inventory control |
| 105001 | Fixed assets — cost, buildings |
| 201001 | Trade payables |
| 202001 | Output tax — authority A |
| 202005 | Income tax withholding payable |
| 301001 | Owner capital |
| 401001 | Sales — goods |
| 501001 | Cost of sales |

- 99 groups per class, 999 accounts per group.
- Group numbers and account numbers are allocated in Settings in sequence; deleted
  numbers are never reused.
- Codes are immutable after posting. Moving an account to another group later must not
  renumber it.
- Six digits replace the current four-digit demo chart outright. Demo data is remapped;
  there is no real data to preserve at this stage.

## 2. Group catalogue (seed)

Groups are created in **Chart of accounts → Accounting groups**, not in Settings. These are the standard starting groups.

### Assets — class 1
| Group | Name | Accounts |
|---|---|---|
| 01 | Cash and bank | 001 Cash control, 002 Bank control, 003 Petty cash control |
| 02 | Receivables and advances | 001 Trade receivables, 002 Advance income tax receivable, 003 Advance sales tax receivable, 004 Supplier advances |
| 03 | Inventory | 001 Inventory control |
| 04 | Tax assets | 001 Input tax control (authorities are sub-accounts) |
| 05 | Fixed assets — cost | 001 Buildings, 002 Vehicles, 003 Equipment, … |
| 06 | Accumulated depreciation | 001 Buildings, 002 Vehicles, 003 Equipment, … |
| 07 | Other assets | generated as needed |

### Liabilities — class 2
| Group | Name | Accounts |
|---|---|---|
| 01 | Payables | 001 Trade payables |
| 02 | Tax liabilities | 001 Output tax control, 002 Sales tax withheld control, 003 Income tax withholding payable (authorities are sub-accounts) |
| 03 | Advances | 001 Customer advances |
| 04 | Clearing | 001 Goods received clearing |
| 05 | Loans and other | generated as needed |

### Equity — class 3
| Group | Name | Accounts |
|---|---|---|
| 01 | Capital and reserves | 001 Owner capital, 002 Opening balance equity, 003 Retained earnings, 004 Revaluation surplus |

### Income — class 4
| Group | Name | Accounts |
|---|---|---|
| 01 | Sales — goods | 001 … |
| 02 | Sales — services | 001 … |
| 03 | Other income | 001 … |
| 04 | Sales returns (contra income) | 001 … |

### Expenses — class 5
| Group | Name | Accounts |
|---|---|---|
| 01 | Cost of sales | 001 … |
| 02 | Operating expenses | 001 … |
| 03 | Payroll | 001 … |
| 04 | Impairment, tax and other | 001 … |
| 05 | Purchase returns (contra expense) | 001 … |

The exact names may change; the numbering and control flags are the contract.

## 3. Control accounts

A control account is one GL account whose balance must equal a named subledger. Only
these get control flags.

| Control | Code (seed) | Subledger | Line must carry |
|---|---|---|---|
| Cash | 101001 | cash tills | cash sub-account |
| Bank | 101002 | bank accounts | bank sub-account |
| Trade receivables | 102001 | customer ledger | party |
| Supplier advances | 102003 | supplier advance ledger | party |
| Inventory | 103001 | item + warehouse quantity/value | item, warehouse |
| Input tax | 104001 | tax authority sub-accounts | document authority (default or override); party dimension |
| Fixed assets cost — class | 10500x | asset register | asset |
| Accumulated depreciation — class | 10600x | asset register | asset |
| Trade payables | 201001 | supplier ledger | party |
| Output tax | 202001 | tax authority sub-accounts | document authority (default or override); party dimension |
| Sales tax withheld | 202002 | tax authority sub-accounts | party |
| Income tax withholding payable | 202005 | supplier ledger + authority sub-account | party |
| Advance income tax receivable | 102002 | customer ledger + authority sub-account | party |
| Advance sales tax receivable | 102004 | customer/supplier ledger + authority sub-account | party |
| Customer advances | 203001 | customer advance ledger | party |
| Goods received clearing | 204001 | open goods receipts / bills | document, party |

- **One AR and one AP control per company** (see §5). Additional controls only for a
  separately reconciled segment, never per party.
- Bank and cash are separate controls; a bank account is a sub-account, not a GL
  account.
- Inventory is one control with item/warehouse subledger; valuation lives there.
- Fixed assets use class-level cost and accumulated-depreciation accounts, with the
  asset register as subledger.
- Tax controls are split by **tax nature**, with the authority as a sub-account. The
  default authority per nature is set in Default accounts and can be changed on a document.

## 4. Not control accounts

- **Sales** — no sales control. Revenue is an income account; the party balance is
  controlled by AR. Item/customer sales statistics come from invoice lines.
- **Cost of sales** — one or a few expense accounts; item cost comes from stock and
  invoice-line cost.
- **Items** — not a balance. The item is a subledger dimension; inventory is the
  control.
- **Expenses** — ordinary accounts with dimensions (party, item, project, location).
- **Tax rates/rules** — not accounts; they point at control accounts.

## 5. AR/AP segmentation (the point that was unclear)

One AR control and one AP control for the whole company means every customer and
supplier reconciles to one total. That is the simplest and is what we should start
with.

A **segment** is a second AR or AP control for a group of parties that must reconcile
separately, for example:

- domestic vs foreign customers (different currency/legal reporting),
- group companies vs third parties,
- a specific business line with its own balance-sheet presentation.

Each segment needs a rule that assigns a party to exactly one control. A party cannot
sit under two AR controls. Segment reporting is a dimension on the party; it does not
need a new account unless the balance must be presented or reconciled separately.

Decision: **one AR and one AP control for now** (102001 / 201001). Add segments later
only if a legal/currency reporting need appears. Party type, country, currency and
group remain dimensions for statistics.

## 6. Tax controls and authorities

There are **six tax natures**: input tax, output tax, advance income tax, advance sales
tax, withholding income tax and withholding sales tax. Advance income and advance sales
are separate controls because one is income tax and one is sales tax.

An authority does **not** need its own GL control account. One control account per tax
nature, with each authority as a **sub-account**, is the better model. It matches bank/
cash (one control, many bank accounts) and avoids a chart that grows every time a
provincial or local authority is added.

| Control account | Code | Sub-accounts |
|---|---|---|
| Output sales tax | 202001 | each output tax authority/registration |
| Input tax | 104001 | each input tax authority/registration |
| Sales tax withheld | 202002 | each withholding authority/registration |
| Income tax withholding payable | 202005 | the entity's income-tax authority (one per entity) |
| Advance income tax receivable | 102002 | the entity's income-tax authority |
| Advance sales tax receivable | 102004 | each sales-tax authority/registration |

Rules:

- A tax rule points at a tax nature, rate and scope. The **control account** and
  **default authority** for that nature are set once under Taxes → Default accounts; a
  document can override the authority. Rules are system-numbered.
- The control balance = sum of its authority sub-account balances.
- Authority sub-accounts are the reconciliation point for each return. A separate
  control is used only if a separate legal entity or currency must reconcile
  independently; within one entity, sub-accounts are enough.
- A taxable supply's output tax belongs to the authority of the supplier's
  registration; input tax belongs to the authority of the purchase registration.
  **Prices are always exclusive of tax.** The line price is net; tax is added. There is
  no inclusive-price mode.
- A tax authority registration is a first-class record: name, registration number, tax
  natures, filing frequency and status. Jurisdiction is not asked on the form. It is a
  sub-account of the control for each nature it handles.

### 6.1 Party tracking for tax

The party is a **dimension on tax entries**, not a control account. Every tax entry
stores:

```
document, document line, party, authority, tax rule, direction,
taxable base, rate, amount, period, certificate/reference,
filed state, paid state, claim state
```

This gives the reports the owner asked for without a chart explosion:

- **Input tax by supplier** — claimed input tax per supplier, authority and period.
  Compare it with authority filing/payment data or the supplier's certificate; flag
  “supplier has not reported/paid”, “mismatch”, “claim unmatched”, “matched”.
- **Output tax by customer** — what the customer may claim; supports customer queries
  and certificates.
- **Sales tax withheld** — by customer/supplier, authority, certificate and period.
- **Withholding** — by supplier, authority, certificate, deposited/filed state.
- **Advance tax** — by customer, authority, certificate, claimed state.

A supplier charging input tax while not filing output tax is detected by reconciling
**our tax entries** with **authority data** and **supplier certificates**. The system
cannot know a supplier failed to file without that data; it records the claim, the
evidence and the reconciliation status honestly.

### 6.1a How the tax balances are measured

Every tax entry carries six things that make the statistics possible: **nature**, **party**,
**authority**, **taxable base**, **rate** and **tax amount**. From the same entries:

- **Control account balance** — sum of the tax entries for one nature. There is one
  control per nature, not one per party or one per authority.
- **Authority balance** — sum of the entries for that authority inside the nature's
  control. The control is the total of its authority sub-accounts.
- **Party balance** — sum of the entries for that party inside the nature. This is a
  tax-ledger view, not a separate GL control account.
- **Reconciliation** — control = sum of authorities = sum of parties, with an explicit
  unallocated bucket if an entry has no party or authority. All three views are built
  from the same tax entries, so they cannot disagree.

The six natures are always kept separate: input, output, advance income, advance sales,
withholding income, withholding sales. There is no single merged “tax balance”. In this
prototype the balances are derived from tax entries; a live posting writes the control
line, the authority sub-account and the party tax entry in one transaction.

| Nature | Demo control | Side | What the balance means |
|---|---|---|---|
| Input tax | 1300 Recoverable input tax | asset | tax we can recover from the authority |
| Output tax | 2200 Output tax payable | liability | tax we owe the authority |
| Advance income tax | 1400 Advance tax receivable | asset | income tax a customer deducted and paid for us |
| Advance sales tax | 1024 Advance sales tax receivable | asset | sales tax a customer deducted and paid for us |
| Withholding income tax | 2150 Withholding tax payable | liability | income tax we deducted and owe |
| Withholding sales tax | 2210 Sales tax withheld | liability | sales tax we deducted and owe |

### 6.2 Tax adjustments

A tax balance is never corrected by editing the original invoice or bill. It is
corrected by a **tax adjustment voucher** that carries the nature, party or Unallocated,
authority, and posts to the control and an explicit **offset account** chosen from the
active chart. The authority defaults from Taxes → Default accounts for the
nature and can be changed on the voucher. The tax control line is fixed by the nature;
the offset account receives the opposite debit or credit. Use **Unallocated** as the party
when an authority-level difference cannot be tied to a real party; it is a system row in
party balances, not a customer or supplier:

- **Input tax decrease** (invalid claim / supplier default), loss borne by us:
  Dr Tax adjustment expense · Cr Input tax control. Both lines carry the party;
  the tax control line also carries the authority.
- **Input tax decrease, recovered from the supplier:** Dr Trade payables · Cr Input tax
  control (party offset).
- **Output tax decrease:** Dr Output tax control · Cr Tax adjustment income, or credit
  the customer receivable when the customer is credited.
- **Withholding decrease:** Dr Withholding tax payable · Cr Tax adjustment income, or
  the supplier payable when it is returned to the supplier.
- **Advance tax decrease:** Dr Tax adjustment expense · Cr Advance tax receivable, or
  debit the customer receivable when the customer owes it back. Advance sales tax follows
  the same pattern with its own receivable.
- Increases reverse the direction.

Every line carries the party. Only the tax control line carries the authority
sub-account; the offset line never does.

The common offsets are **5300 Tax adjustment expense**, **4200 Tax adjustment income**,
trade receivables/payables and cash, but the voucher allows any active account. It
updates the party tax balance and the authority sub-account in the same transaction, and
touches AR/AP only when the chosen offset is a receivable/payable. It never edits the
source document; the original tax entry remains for audit.

### 6.3 Worked example — party A input tax falls from 100 to 70

Party A has claimed 100 input tax against authority FBR. A supplier default makes 30
invalid. The accountant records a tax reconciliation: nature input, party A, authority
FBR, direction decrease, amount 30, offset P&L.

```
Dr  5300 Tax adjustment expense        30   party A
Cr  1300 Input tax control             30   party A · authority FBR
```

- **GL:** input tax control falls by 30; tax adjustment expense rises by 30; the voucher
  is balanced. Nothing on the original bill changes.
- **Authority:** FBR's input-tax sub-account falls by 30, so the control and its
  sub-accounts still reconcile.
- **Party:** party A's input tax ledger falls by 30, from 100 to 70. The negative
  adjustment entry remains visible next to the original entries.

If the supplier repays the 30, the same adjustment uses the party offset instead:

```
Dr  2100 Trade payables                30   party A
Cr  1300 Input tax control             30   party A · authority FBR
```

The input control and FBR sub-account still fall by 30, but the other side reduces what
we owe the supplier instead of hitting profit. AR/AP moves only with the party offset.

## 7. Fixed assets

The asset register is the subledger; class-level accounts are the GL.

Each asset records:

- acquisition cost and date, supplier/document,
- capital additions,
- depreciation method, useful life, residual value,
- depreciation expense and accumulated depreciation to date,
- revaluation / impairment events and their effective dates,
- project/location assignment and **depreciation allocation percentages by project**
  with effective dates,
- transfer history between projects/locations,
- disposal date and proceeds.

Postings:

| Event | Entry |
|---|---|
| Acquisition | Dr asset cost · Cr payable/bank |
| Capital addition | Dr asset cost · Cr payable/bank |
| Depreciation run | Dr depreciation expense (split by project) · Cr accumulated depreciation |
| Revaluation increase | Adjust cost/accumulated · Cr revaluation surplus (equity) |
| Revaluation decrease / impairment | Dr impairment expense · Cr accumulated or cost |
| Transfer between projects | Change assignment and future depreciation split; no GL entry unless revaluation |
| Disposal | Dr accumulated depreciation and proceeds · Cr cost · gain/loss to P&L |

Depreciation split: one journal line per project, each carrying `asset_id`, `project`
and the amount. Accumulated depreciation remains asset-level unless project-level
accumulated reporting is requested; if it is, the same dimensions are stored on the
accumulated lines.

## 8. Data model

```
accounts(id, code, name, class, group_id, control_type, subtype, active)
account_groups(id, class, code, name)              -- Chart page, next number
tax_authorities(id, name, registration, tax_natures, filing_frequency, active)
tax_authority_accounts(id, control_account_id, authority_id, active)
tax_rules(id, code, name, kind, rate, groups, items, effective_from, effective_to, ...)
tax_periods(...)                                  -- proposed closing snapshot
parties(id, type, name, segment, control_account_id)
documents(id, type, date, party_id, state)
document_lines(document_id, item_id, account_id, qty, price, discount,
               tax_rule_id, net, tax, gross, cost, project, location)
journal_lines(document_id, account_id, party_id, subaccount_id, item_id,
              tax_rule_id, asset_id, debit, credit, project, location, cost_centre)
tax_entries(document_id, line_id, party_id, tax_rule_id, authority_id,
            base, rate, amount, direction, period, certificate,
            filed_state, paid_state, claim_state)
stock_moves(item_id, warehouse_id, qty, value, document_id, direction, layer)
asset_register(asset_id, class_id, cost, accumulated, ...)
asset_events(asset_id, type, date, amount, project, document_id)
```

Money is integer minor units. Indexes on date, account, party, item, document, tax
rule, authority, period.

## 9. Reconciliation invariants

- AR control = sum of customer balances.
- AP control = sum of supplier balances.
- Cash/bank control = sum of sub-account balances.
- Inventory control = sum of item/warehouse values.
- Output/input/sales-tax-withheld controls = sum of their authority sub-accounts.
- Each authority sub-account = its tax entries for the period.
- Income tax withholding and advance tax controls reconcile to their party ledgers.
- Advances controls = sum of unapplied party advances.
- GRNI = received not billed.
- Fixed assets cost − accumulated depreciation = asset register net book value.
- A failed invariant blocks period close; it is not hidden.

## 10. Statistics from dimensions

- Sales by item/customer: invoice lines grouped by item/party.
- Purchases by supplier/item: bill lines.
- Sales tax: tax entries by authority, rule, party, item, period; control per authority.
- Withholding: tax entries by supplier, certificate, period; control payable.
- Advance tax: tax entries by customer; control receivable; customer advances control.
- Cash/bank: journal lines tagged sub-account.
- Fixed assets: asset register and depreciation lines by project.
- Party balances: journal lines tagged party; aging from open documents.

## 11. Migration from four-digit demo codes

| Old | New | Account |
|---|---|---|
| 1000 | 101001 | Cash |
| 1010 | 101002 | Bank |
| 1020 | 101003 | Petty cash |
| 1100 | 102001 | Trade receivables |
| 1200 | 103001 | Inventory |
| 1300 | 104001 | Input tax control |
| 1400 | 102002 | Advance income tax receivable |
| 1024 | 102004 | Advance sales tax receivable |
| 1220 | 102006 | Final sales tax receivable |
| 2160 | 202007 | Income tax payable |
| 2220 | 202006 | Final sales tax payable |
| 1500/… | 10500x | Fixed asset classes |
| 2100 | 201001 | Trade payables |
| 2150 | 202005 | Income tax withholding payable |
| 2200 | 202001 | Output tax control |
| 2210 | 202002 | Sales tax withheld control |
| 2300 | 203001 | Customer advances |
| 2400 | 204001 | Goods received clearing |
| 5400 | 503001 | Income tax expense |
| 3000 | 301001 | Owner capital |
| 3100 | 301002 | Opening balance equity |
| 4000 | 402001 | Service revenue |
| 4100 | 404001 | Sales returns |
| 5000 | 502001 | Operating expenses |
| 5100 | 501001 | Cost of sales |
| 5200 | 505001 | Purchase returns |

All demo fixtures, invoices, payments, taxes and reports are remapped. Account
selectors, seeds and tests must use the new codes. No alias table is kept in the demo;
the replacement is complete.

## 12. Open points before build

1. Confirm the group catalogue names and seeds above.
2. Confirm one AR/AP control (recommended) rather than segments.
3. Confirm the demo tax authorities to seed as sub-accounts (e.g. two sales-tax
   authorities plus one income-tax authority).
4. Confirm fixed asset classes to seed (buildings, vehicles, equipment).
5. Confirm the migration table.
6. Confirm the tax control set: output, input, sales tax withheld, income tax
   withholding, advance income tax and advance sales tax — authorities as
   sub-accounts.
