# Backend contract — what the UI expects from the database and API

Written for the point where these screens are connected to real data. The UI in
this repository runs on fixtures; this document is the contract that replaces them.
It is deliberately written before the backend exists, so the screens and the schema
grow together instead of being reconciled later.

One section per entity, one table per screen, and a set of rules that apply
everywhere. If a screen is built that this document does not cover, the document is
wrong and gets updated first.

---

## 1. Conventions

**Money.** Stored and transported as decimal strings with two decimals
(`"1284930.00"`), never floats. Arithmetic on the server is decimal; the client
never computes a posted amount.

**Quantity.** Decimal with up to three places. **Dates.** ISO `YYYY-MM-DD`;
timestamps ISO 8601 UTC.

**Identity.** Every record has `id` (opaque, stable), `created_at`, `created_by`,
`updated_at`, `updated_by`, `version` (integer, optimistic concurrency). Document
numbers are separate from ids and never reused.

**Scope.** Every business record carries `tenant_id` and `company_id`; postings carry
`location_id` and optional `project_id`. The books are company-wide: location is a
dimension, never a separate ledger.

**Immutability.** A posted document is immutable. Corrections are new documents
that reference the original. The ledger is append-only.

**Deletion.** Soft delete only: `deleted_at`, `deleted_by`, `delete_reason`.
Deleted rows are excluded from lists and totals, remain in audit and remain
queryable by an administrator.

**Idempotency.** Every command that creates a document takes a client-generated
`request_id`. Repeating the same request returns the original result, never a
second document.

**Concurrency.** Updates send the `version` they read. Mismatch returns `409` with
the current record; the client shows the conflict instead of overwriting.

**Periods.** Every posting command carries the posting date; the server checks the
period is open. An administrator may override with a reason, which is logged.

**Money and totals.** Control totals (party balance, inventory value, tax position)
are always recomputable from source rows. A stored total is a cache with a
verification endpoint, never the only truth.

---

## 2. Entities

### 2.1 Account

| Field | Type | Rules |
|---|---|---|
| code | string | unique per company, immutable after first posting |
| name | string | required |
| nature | enum | asset, liability, equity, income, expense |
| group | reference | statement group; drives report placement |
| control_type | enum | none, receivable, payable; requires party on posting |
| tax_kind | enum | none, output_tax, input_tax, wht_sales_vat, wht_purchase_vat, wht_sales_income, wht_purchase_income |
| inventory_flag | boolean | true when the account carries stock value |
| bank_details | object | null unless nature is asset with bank or cash type |
| active | boolean | archive blocked when postings exist |
| opening | decimal | only through the opening-balance command |

Invariants: an account that has postings cannot change nature, code or control
type; a tax account cannot also be a control account; an inventory-flagged account
must be an asset.

### 2.2 Party

`id, code, type (customer, supplier, both), name, legal_name, tax_id, group,
currency, payment_terms_days, credit_limit, opening_balance, status (active, hold,
blocked), billing_address, contact, notes, custom fields`.

Invariants: `type` cannot be narrowed once documents exist; balance is derived, not
stored as truth; blocking does not change history.

### 2.3 Item

`id, code, name, type (service, stock, non_stock), unit, group, income_account,
expense_account, inventory_account, tax_defaults, costing_method, reorder_point,
tracked (boolean), status, custom fields`.

Invariants: `tracked` may be turned on only while the item has no movements; turning
it off is refused while quantity exists. A stock item needs an inventory account.

### 2.4 Document (invoice, bill, journal, payment, credit note, stock document)

Common: `id, number, type, date, posting_date, party_id, currency, exchange_rate,
reference, source_document_id, state (draft, submitted, approved, posted, cancelled,
reversed), narration, totals {net, tax, gross}, created_by, approved_by, posted_at`.

Invariants: number is assigned at submission, not at draft creation; posting is
one transaction; a cancelled document keeps its number; a reversal references the
original and carries the opposite effects.

### 2.5 Document line

`id, document_id, line_no, account_id, item_id, description, quantity, rate,
discount, net, tax_group_id, tax_override, project_id, location_id, cost_centre_id,
warehouse_id, against_voucher_id, supplier_invoice_no, custom fields`.

`project_id` is mandatory on every posting line; head office is a project record like
any other, so "no project" does not exist. `against_voucher_id` records what a payment
settles; `supplier_invoice_no` records the supplier's own number on a bill.

Invariants: a line posts to exactly one account; a stock line requires a warehouse;
tax is computed per line from base, rate and account, and stored on the tax line.

### 2.6 Tax line

`id, document_line_id, tax_code_id, base, rate, amount, account_id, jurisdiction,
recoverable, withholding_kind`.

Invariants: amount = base × rate rounded per the tax settings; the account comes
from the tax code or the manual override; a tax line never exists without a base.

### 2.7 Open item and allocation

`open_item: id, document_id, party_id, amount, due_date, outstanding, bucket
(derived)`. `allocation: id, open_item_id, payment_id, amount, date, component
(settlement, discount, withholding, retention, write_off), created_by`.

Invariants: sum of allocations on an open item never exceeds its amount; a
component other than settlement requires a reason and, above a threshold, approval;
deleting a payment reverses its allocations.

### 2.8 Journal entry and ledger line

`journal: number, date, entry_type (normal, adjusting, opening), source, state`.
`ledger_line: entry_id, account_id, party_id, debit, credit, period_id, dimensions`.

Invariants: debits equal credits per entry; a control account line requires a party
unless entry_type is adjusting; ledger lines are append-only.

### 2.9 Stock movement and balance

`movement: id, item_id, warehouse_id, direction (in, out), quantity, unit_cost,
value, source_document_id, reason, posted_at`.
`balance: item_id, warehouse_id, quantity, value` — derived, cached, verified.

Invariants: value = quantity × cost at the item's method; a movement always has a
source document and a reason; balance equals the sum of movements.

### 2.9A Project and cost centre

`project: id, code, name, manager_id, status (active, on hold, closed), opens_on,
closes_on`. `cost_centre: id, code, name, active`.

`account.project_id` is nullable. `project` on a line is nullable: empty means no
project. `location_id` is mandatory on a line and is a branch, outlet or warehouse, so
"where" is always known even when "for which project" is not.
Access is `user_project_scope(user_id, project_id[])`, applied to every query, not
only to lists: a ledger row from another project must never leave the server.

### 2.10 Tax code, group, period, approval, attachment

`tax_code: code, rate, inclusive, kind, output_account, input_account, valid_from,
valid_to`. `tax_group: name, members[]`. `period: company_id, from, to, state
(open, locked), locked_by, locked_at, reopen_reason`. `approval: document_id,
policy_id, decision, decided_by, decided_at, note`. `attachment: id, document_id,
filename, sha256, size, content_type, uploaded_by`.

### 2.11 Configuration: custom fields, form profiles, saved views

`custom_field: id, entity, key, label, type (text, number, money, date, select,
boolean, reference), options, required, unique, indexed, active, created_by`.
`form_profile: id, company_id, form_key, version, definition (JSON), active`.
`saved_view: id, page_key, owner_id, company_id, scope (personal, shared, system),
name, definition (JSON)`.

Definitions are versioned; changing one never rewrites stored documents, only how
they are displayed and what new documents validate against.

---

## 3. Screen contracts

For every page: what it reads, what it writes, and what it must refuse.

| Page | Reads | Writes | Refuses |
|---|---|---|---|
| Dashboard | account balances, open items, approvals, periods, ledger | nothing | — |
| Journal entries (register) | documents of type journal, filtered | nothing | — |
| New journal | accounts, parties, periods, tax codes | journal, ledger lines, party effects | imbalance, closed period, control account without party, adjusting without reason |
| Parties | party rows with derived balances | party master | duplicate tax id, narrowing type, deleting with history |
| Party page | party, open items, documents, ageing | nothing | — |
| Cash & bank | bank accounts, balances, reconciliations | reconciliation, imported statement lines | closing with a difference |
| Payments | documents of type payment, allocations | payment, allocation, ledger, party effects | allocation above outstanding, cross-party allocation |
| Items | item master, stock balances | item master | changing tracked flag with stock |
| Sales / purchase invoices | items, tax codes, parties, source documents | invoice, tax lines, open item, ledger, stock movement | credit limit exceeded without override, closed period, untracked stock line |
| Chart of accounts | accounts with balance, flags and project | account master, opening balances | changing nature with postings, deleting with postings, moving a project with postings |
| Projects | ledger grouped by project dimension | project master | deleting a project with postings, duplicate code |
| Setup | account flags, numbering, periods | configuration | numbering an already-used series backwards |
| General ledger | ledger lines with account, party, project, cost centre, voucher and against voucher | nothing | — |
| Trial balance | ledger grouped by account | nothing | — |
| Reports | ledger, open items, stock, tax lines | nothing (exports only) | — |
| Period close | checklist evidence, trial balance, reconciliation | period state, sign-off | lock with open steps unless waived with reason |
| Inventory screens | items, movements, balances, counts | movement, count, adjustment | negative stock unless allowed, untracked item movement |
| Tax screens | tax lines, codes, returns | tax code, return, adjustment, certificate | overlapping effective rates, deleting used code |

---

## 4. Posting transaction

One server transaction, in this order. Any failure rolls back everything.

1. Validate: permissions, period, document state, required fields (including
   configured ones), credit limit, stock availability.
2. Assign the number from the series.
3. Insert the document and its lines.
4. Compute and insert tax lines.
5. Insert the journal entry and ledger lines.
6. Update subledger: party balance and open item, or allocation.
7. Post stock movements and value, if any line is a tracked item.
8. Write the audit record with the actor, reason, source and correlation id.
9. Commit, then emit the event for downstream readers.

Reversal repeats 1–9 with opposite signs and a link to the original. Deletion of a
posted document is not a step; it is a reversal plus, for an administrator, a soft
delete flag on the original.

---

## 5. Derived data and reconciliation

| Derived value | Source | Verification |
|---|---|---|
| Party balance | sum of open items | control-account reconciliation report |
| Control account balance | sum of ledger lines on the account | must equal party balance; bridges listed |
| Ageing bucket | due date vs report date | recomputed per request |
| Trial balance | sum of ledger lines per account | difference must be 0.00 |
| Stock balance | sum of movements | inventory control account reconciliation |
| Tax position | sum of unreconciled tax lines | tax control account reconciliation |

Each of these has a verification endpoint that recomputes from source and reports a
difference with the offending rows. Cached totals are refreshed in the same
transaction that changes the source.

---

## 6. Permissions and field-level access

- Actions are permission-checked on the server per document type: create, submit,
  approve, post, cancel, reverse, delete, view cost, view margin.
- Closing periods, adjusting entries, overriding credit limits and posting into a
  locked period are separate permissions, not role shortcuts.
- Field-level access is a property of the field profile, not the caller's screen:
  a hidden field is never sent to the client.
- Every refused action returns a reason code the UI can display verbatim.

---

## 7. Audit

Every state change records: actor, timestamp, action, document, before and after
values for the changed fields, reason where required, request id and source IP or
session. The audit log is append-only and queryable by document and by actor. A
soft delete is an audit event, not a missing row.

---

## 8. Import contracts

| Import | Stages | Rules |
|---|---|---|
| Chart of accounts | upload → validate → preview → commit | codes unique, control flags consistent, opening balances must balance |
| Opening balances | upload → validate → preview → commit | one entry, balanced, into an opening period |
| Historical ledger | upload → validate → preview → commit | account must exist, period must be open, totals must reconcile |
| Parties and items | upload → validate → preview → commit | duplicates by code or tax id refused |
| Bank statement | upload → parse → suggest matches → reconcile | unmatched lines remain visible |

Nothing imports directly into posted state. Every import creates draft documents
that go through the same posting rules.

---

## 9. Non-goals for this contract

Multi-currency revaluation, consolidation, intercompany elimination, deferred tax,
payroll statutory calculations and manufacturing costing. They will need their own
sections before those screens are built, and this document will link to them.
