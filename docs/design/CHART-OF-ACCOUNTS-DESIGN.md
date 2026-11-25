# Chart of accounts — agreed design

Status: design decision, not implemented. Owner decision 26 November 2026.
This document is the contract for the chart rebuild. Code changes start only after
this record is accepted.

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

Groups are created in Settings; these are the standard starting groups.

### Assets — class 1
| Group | Name | Accounts |
|---|---|---|
| 01 | Cash and bank | 001 Cash control, 002 Bank control, 003 Petty cash control |
| 02 | Receivables and advances | 001 Trade receivables, 002 Advance tax receivable, 003 Supplier advances |
| 03 | Inventory | 001 Inventory control |
| 04 | Tax assets | 001 Input tax — authority A, 002 Input tax — authority B, … |
| 05 | Fixed assets — cost | 001 Buildings, 002 Vehicles, 003 Equipment, … |
| 06 | Accumulated depreciation | 001 Buildings, 002 Vehicles, 003 Equipment, … |
| 07 | Other assets | generated as needed |

### Liabilities — class 2
| Group | Name | Accounts |
|---|---|---|
| 01 | Payables | 001 Trade payables |
| 02 | Tax liabilities | 001 Output tax — A, 002 Output tax — B, 003 Sales tax withheld — A, 004 Sales tax withheld — B, 005 Income tax withholding payable |
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
| Advance tax receivable | 102002 | customer advance-tax ledger | party |
| Supplier advances | 102003 | supplier advance ledger | party |
| Inventory | 103001 | item + warehouse quantity/value | item, warehouse |
| Input tax — authority | 10400x | tax ledger by authority/period | tax rule/authority via document |
| Fixed assets cost — class | 10500x | asset register | asset |
| Accumulated depreciation — class | 10600x | asset register | asset |
| Trade payables | 201001 | supplier ledger | party |
| Output tax — authority | 20200x | tax ledger by authority/period | tax rule/authority via document |
| Sales tax withheld — authority | 20200x | tax ledger by authority/customer | party |
| Income tax withholding payable | 202005 | withholding ledger by supplier | party |
| Customer advances | 203001 | customer advance ledger | party |
| Goods received clearing | 204001 | open goods receipts / bills | document, party |

- **One AR and one AP control per company** (see §5). Additional controls only for a
  separately reconciled segment, never per party.
- Bank and cash are separate controls; a bank account is a sub-account, not a GL
  account.
- Inventory is one control with item/warehouse subledger; valuation lives there.
- Fixed assets use class-level cost and accumulated-depreciation accounts, with the
  asset register as subledger.
- Tax controls are split by **authority** and tax type; a tax rule points at the
  authority's control account.

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

## 6. Tax authorities

- Output tax and input tax may be owed to different authorities (national, provincial,
  local). Each authority gets its own control account per tax type, and a tax rule
  points to that authority and account.
- Sales tax withheld (by customers or from suppliers) follows the same authority split.
- Income tax withholding is one payable control per legal entity: one entity pays one
  income-tax authority even with foreign operations. The supplier is the party
  subledger.
- Tax returns reconcile each authority's control account to its tax ledger for the
  period. Party, item and document are dimensions on tax entries for certificates and
  statistics; they are not separate GL controls.
- Output/input tax GL lines may not carry a party (the document does); sales-tax
  withheld and advance tax lines **must** carry the party.

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
account_groups(id, class, code, name)              -- Settings, next number
tax_authorities(id, name, jurisdiction, registration)
tax_rules(id, authority_id, control_account_id, kind, rate, basis, ...)
parties(id, type, name, segment, control_account_id)
documents(id, type, date, party_id, state)
document_lines(document_id, item_id, account_id, qty, price, discount,
               tax_rule_id, net, tax, gross, cost, project, location)
journal_lines(document_id, account_id, party_id, subaccount_id, item_id,
              tax_rule_id, asset_id, debit, credit, project, location, cost_centre)
tax_entries(document_id, party_id, tax_rule_id, authority_id, base, rate,
            amount, direction, period, certificate, filed_state)
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
- Each tax authority control = sum of its tax ledger for the period.
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
| 1300 | 104001 | Input tax — A |
| 1400 | 102002 | Advance tax receivable |
| 1500/… | 10500x | Fixed asset classes |
| 2100 | 201001 | Trade payables |
| 2150 | 202005 | Income tax withholding payable |
| 2200 | 202001 | Output tax — A |
| 2210 | 202003 | Sales tax withheld — A |
| 2300 | 203001 | Customer advances |
| 2400 | 204001 | Goods received clearing |
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
3. Confirm the demo tax authorities to seed (e.g. two sales-tax authorities plus one
   income-tax authority).
4. Confirm fixed asset classes to seed (buildings, vehicles, equipment).
5. Confirm the migration table.
