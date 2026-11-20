# Forms, fields and list views — customisation model

Two separate things, often confused:

- **Forms** — which fields a document asks for, in what order, and which are
  required. Configured per company and per form, versioned, audited.
- **Views** — which columns a register or ledger shows, in what order, with what
  filters and sorting. Saved per person or shared with the business.

Both are configuration, not code. Neither may change what a document *does*.

---

## 1. What may and may not be customised

| Allowed | Not allowed |
|---|---|
| Hide an optional field | Hide a field the ledger needs (posting date, account, debit/credit, party on a control account) |
| Add a custom field | Add a field that changes posting logic |
| Make an optional field required | Make a system-required field optional |
| Change order and grouping | Change the meaning of an existing field |
| Add help text | Rename a field in a way that contradicts the contract |
| Set a default value | Default a value that must be chosen per document (e.g. party) |
| Add validation to a custom field | Validate against data the client cannot see |

A custom field is information, not behaviour. It can carry a reference, a code, a
note or a dimension, and it can be shown in lists and reports. It cannot change an
account, a tax rate, a price or a posting.

---

## 2. Field states

Every field in every form has one state per profile:

- **required** — must be filled before submit.
- **optional** — visible, may be empty.
- **hidden** — not shown, not sent, not validated.
- **locked** — shown, read-only, with a reason on hover.
- **system** — always present, cannot be hidden or made optional.

The system state list is fixed by the backend contract. A profile can promote
optional to required; it can never demote required to optional or hide a system
field. Attempting it is refused with the field name.

---

## 3. Profiles

A profile is scoped to a **company** and a **form** (`invoice.sales`,
`journal.new`, `party.new`, `item.new`, `payment.new`, …). It has:

- a version, so a change is auditable and reversible;
- an ordered list of sections, each with fields and their state;
- a set of custom fields, in the order they appear;
- defaults applied to new documents;
- a status: draft, active, retired.

Only one active version per company and form. Activating a new version does not
rewrite existing documents; it changes what the next document asks for.

---

## 4. Custom fields

| Type | Use | Notes |
|---|---|---|
| text | codes, notes, references | optional max length and pattern |
| number | counts, percentages | optional min/max |
| money | additional monetary information | stored as decimal string |
| date | reference dates | ISO, no time |
| select | a small fixed list | options versioned with the profile |
| boolean | flags | |
| reference | link to party, item, account, project | filtered by company |

Rules:

- Key is unique per entity and never reused after retirement.
- A field used in a saved view cannot be deleted; it can be retired, which keeps
  the stored values.
- Values are indexed only when the profile marks the field as filterable.
- Fields appear in the document's **Details** section by default, not mixed into
  the financial fields.

---

## 5. List views, registers and ledgers

Every list page (journals, payments, invoices, parties, items, stock movements,
general ledger, trial balance, tax registers) has a **view**:

- **Columns** — chosen from the available field set, ordered, with width and format
  (money, date, percentage, text, badge).
- **Sort** — one primary key, optional second.
- **Filters** — period, party, account, state, amount range, text, plus any
  filterable custom field.
- **Grouping** — optional (by party, by month, by state), with subtotals where the
  data supports it.
- **Density** — comfortable or compact.
- **Totals** — which numeric columns sum, and whether totals show on screen, in
  print and in export.

Scope:

- **System views** — shipped defaults, read-only, always present as a fallback.
- **Shared views** — created by an administrator for everyone in the company.
- **Personal views** — created by a user, private by default, shareable.

Each page opens on the last view used by that person, or the shared default.

---

## 6. General ledger: full record versus columns

The ledger is the page that most needs this, so it has an explicit rule:

- **Column view** shows the chosen columns per line (date, entry, account, party,
  description, debit, credit, balance, dimensions…).
- **Full record** expands a line in place, or opens the transaction, showing every
  field of the source document: entry type, source, source reference, created by,
  approved by, posted at, reason, attachments, custom fields.
- Switching between the two never changes the numbers, only how much of each line is
  shown.
- A full record is always reachable from a line, even if every column is hidden —
  the row itself is the way in.

The same rule applies to invoice, payment and stock registers: a column view for
scanning, a full record for the one document being questioned.

---

## 7. Behaviour that must not vary

Whatever the profile or view says:

- Totals always equal the sum of the rows in scope, and the scope is stated
  (“Nov 2026, all branches”).
- Exports use the current view, including hidden columns being absent, and the file
  records which view produced it.
- Print uses the print view, not the screen view, and never prints a hidden field.
- Validation runs on the server against the active profile version at the moment of
  submission, not the version the client had when it opened the form.
- A document is always readable after a profile changes; missing fields simply do
  not appear.

---

## 8. Form behaviour (independent of configuration)

- Labels above fields, always visible; placeholders never replace labels.
- Required fields marked once, consistently, and reflected in the field state list.
- Validation messages under the field, in words, with the offending value quoted.
- A form-level summary appears when more than one field is wrong.
- Unsaved changes are guarded: leaving asks first; drafts can be saved explicitly.
- Long forms (invoice, journal) keep the totals visible while scrolling.
- Keyboard: tab order follows reading order; the last field before the actions is a
  sensible stopping point; Enter does not submit from a multi-line field.
- Every form has a read-only state for posted documents, with the correction
  actions next to the state, not hidden in a menu.

---

## 9. What this means for the backend

- Field and view definitions are data, not code, and are versioned.
- The server validates against the active profile, not the client payload.
- Hidden required-by-ledger fields are a configuration error, rejected when the
  profile is activated.
- A saved view is a portable definition, not a stored query: it names fields,
  filters and sorting, and the server composes the query from it.
- Anything a view can display must be reachable through the documented entity
  contract, including custom fields.
