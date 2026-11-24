# Decision log — 21 November 2026 review

Every instruction from the latest review, what was decided, what is implemented in
the prototype, and where the detail lives for the backend. Status: **done** in the
UI · **mapped** means specified here and in the map, not built · **deferred** with a
reason.

| # | Decision | Status | Where |
|---|---|---|---|
| 1 | Ledger filters are dropdowns, and every dropdown is a **multi-select with tick boxes** (five accounts, three parties, two projects, three cost centres at once) | done | §1 |
| 1a | The column chooser uses the same dropdown control, not a settings strip | done | §1 |
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

The control is one component used by every filter **and** by the column chooser:

- A label above, like every other field in the bar, so it lines up with the date
  inputs.
- A trigger styled exactly like the other inputs, showing the current state:
  `All` · a single value · `3 selected` · `All columns` · `4 of 8`.
- The panel opens below the trigger with a **search field** at the top, then a header
  with **Select all**, a live count (`1 of 9`) and **Clear**, then a scrollable list of
  rows with plum checkboxes and a hover state per row. Search filters the list as you
  type; Select all applies to the filtered list only, so choosing 20 of 300 accounts is
  search, Select all, clear the search, done. No matches shows an empty line, not a
  blank panel.
- Opens on click, closes on outside click or Escape, and only one panel is open at a
  time. The trigger keeps a visible focus ring and `aria-expanded`.
- The column chooser is the same control, labelled **Columns**, and it never changes
  what is filtered — only what is displayed.

Empty means **all**. Combinations are AND
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

---

# Round 2 — journal entry form

## 12. Form layout

- **Journal review sits at the bottom of the page**, full width, under the form. It
  is not a right-hand sidebar. It shows the state badge, any blocking problems as a
  list, then Debit / Credit / Difference / Workflow.
- The form is one column, max 1180px, so long narration and a nine-column line table
  both fit without competing for width.

## 13. Numbering

- Numbers are assigned from a series, not typed: `JV-11-2026-0001` — prefix, month,
  year, four-digit sequence. Same pattern for `SI-`, `PI-`, `PV-` (payment) and
  `RV-` (receipt).
- The sequence and format are **fixed once the first entry exists**. A custom format
  can only be set in Setup before that point; afterwards the field is read-only and
  Setup refuses the change.
- Month and year come from the posting date at submission, not from the creation
  date, and a reversal gets its own number in the same series.
- The number is shown read-only on the form so the preparer can quote it.

## 14. Posting time

- The database stores a full timestamp. The form carries a date and a time field;
  the time defaults to now and is recorded at posting.
- The preparer may override the time for a genuinely earlier entry.
- Guards: no future date or time, nothing before the business creation date, and
  nothing inside a closed period. Each refusal names the reason and the boundary.
- The same timestamp rule applies to POS and any other back-dated capture.

## 15. Narration

A multi-line textarea (five rows, resizable), not a single-line input. It prints on
the voucher and is required.

## 16. Entry subtype

Journal entry, bank entry, cash entry, contra entry, expense entry, debit note,
credit note, depreciation, accrual, prepayment, write off, opening entry,
adjustment, reversal. The voucher type stays "Journal entry"; subtype is the
classification the ledger and reports group by.

## 17. Account, party and sub-account

- The account picker is a searchable single-select in the same visual language as
  the filter dropdowns: search field, filtered list, keyboard focus.
- The column is labelled **Party / sub-account**.
- A **control account** (receivables, payables) requires a party.
- A **bank account** requires the bank account record; a **cash account** requires
  the cash custodian or cash location. They appear in the same column because they
  are the same concept: the subledger entry that the control balance is made of.
- Options are grouped by kind (customer, supplier, bank, cash) and are always
  present, so enabling the field on an account change actually offers choices.

## 18. Location, not branch — decision

There is **one** dimension: **Location**. A location has a kind — head office,
branch, outlet, warehouse, project site. We do not keep a separate "branch" field
beside it.

Reasons: two parallel dimensions invite contradictory data (branch Karachi with
location Lahore), double the filtering and reporting permutations, and every
downstream module (stock, POS, projects) then has to decide which one to trust. One
list with a kind gives the same information, one validation, one filter.

- Every posting line carries a location; the header also sets a default that the
  lines inherit.
- The top-bar branch selector is gone: the books are company-wide and location is a
  field, not a set of books.

## 19. Accounts versus project-specific accounts

Do **not** bake the project into the account name (`Cash in hand — Quetta Tunnel`).
That multiplies the chart, breaks comparatives, and makes every new project a chart
migration.

- Keep accounts generic. Use the **project** and **location** dimensions on the line.
- If a balance must be separated operationally, that is what the party/sub-account
  subledger is for — parties, banks and cash custodians.
- Reports filter by dimension; the chart stays stable.
- Project-scoped access is a permission on the dimension, not a different account.

## 20. Actions and states

- The page heading carries only **Back to register**. Print is an icon in the form
  header; the overflow **⋮** menu holds the rest.
- Menu: Save draft · Submit · Submit for approval · Duplicate · Cancel entry ·
  Delete.
- What is shown depends on state and permission: a draft can be edited, submitted,
  duplicated or deleted; a submitted entry can be withdrawn or duplicated; a posted
  entry can be duplicated, printed, reversed (a new document) and, for an
  administrator, soft-deleted.
- Opening an existing entry uses the same form. A posted entry renders read-only with
  the reversal and duplicate actions.
- No placeholder text remains in the UI: no "Print design example", no "sample
  draft" badges. The header shows the real voucher number and its state.

## 21. Still to build in this area

- Quick entry grid (compact two-line, Enter advances) using the same validation.
- The menu's state machine against real permissions.
- The forms register in Setup (duplicate/edit/activate), which is what makes fields
  like "weather" appear in the register and ledger as columns.

---

# Round 3 — pickers, sub-accounts, identity fields

## 22. One picker everywhere

Every dropdown in the journal form now uses the same component as the filters:
searchable where the list can be long, keyboard reachable, same trigger height,
same panel.

- Account, party/sub-account, project, location, cost centre, entry subtype, entry
  type.
- Panels are positioned **fixed** to the viewport when opened, so a scrolling table
  can no longer clip them. The panel follows the trigger's box and flips when it
  would leave the screen.
- The raw native `<select>` is gone from this form.

## 23. Party / sub-account options follow the account

The list is filtered by what the selected account actually requires:

| Account kind | Options offered |
|---|---|
| receivable control | customers only |
| payable control | suppliers only |
| bank account | the business's bank accounts only |
| cash account | cash custodians and cash locations only |
| anything else | field disabled |

A customer can never be chosen on a bank line. The label stays "Party /
sub-account" because it is one concept: the entry inside the control balance.

## 24. Identity fields

Every document records two identities, because they are often different people:

- **Created by** — who prepared the draft; also created at, and the source
  (User or AI).
- **Submitted by** — who submitted it for posting or approval; also submitted at.
- Approval adds **Approved by** and the decision time.

A preparer may submit their own entry when policy allows; otherwise the entry waits
for an approver. An AI-originated draft names the model as source and still requires
a human submitter. All five fields print on the audit trail of the voucher and are
filterable in registers.

## 25. More info tab

Holds what is not part of the double entry: entry type, the audit strip (created by,
created at, submitted by, source) and **any custom field added to this form in
Setup**. On a fresh install it shows the audit strip and a note; it is never empty
by accident.

## 26. Accounts, projects, locations, branches — how they relate

- **Account** — a line in the chart. It says *what* the money was (rent, sales,
  receivables). Balances live here and only here.
- **Control account** — an account whose balance is the total of a **sub-account**
  ledger: trade receivables (customers), trade payables (suppliers), and the bank
  and cash accounts (bank accounts, cash custodians). The chart shows one balance;
  the sub-account shows who or where.
- **Location** — *where* it happened: head office, branch, outlet, warehouse, site.
  One list with a kind, not a separate "branch" dimension.
- **Project** — *for what* it happened: a job, a client engagement, a new brand,
  an internal initiative. Optional; empty means no project.
- **Item** — *what was sold or bought*, when the line is about goods or services
  rather than an account.

Where each one is a log, and where it gives statistics:

| Dimension | Journal log | Statistics |
|---|---|---|
| Account | every line | ledger, trial balance, statements |
| Party / sub-account | every control line | party ledger, ageing, statements, credit exposure |
| Location | every line | sales and cost by location, stock by location, cash by custodian |
| Project | every line, optional | project P&L, cost against budget, margin |
| Item | invoice and stock lines | item sales, purchase, margin, movement history |

The rule: **balances are only ever on accounts**. Dimensions never carry a balance
of their own; they slice the account balances. That is why a project report and the
trial balance can never disagree, and why no account is ever renamed for a project.

## 27. Still open in this form

- Quick entry grid.
- The action menu's state machine against real permissions.
- Custom fields appearing in the register and ledger as columns (needs the forms
  register in Setup).

---

# Round 4 — selection bug, files, cancellation

## 28. Dropdown selection bug (fixed)

Selecting an option set the field to `undefined` and relabelled the trigger to "All".
Two causes: the option handler read `data-code` after the component moved to
`data-value`, and the multi-select text updater reacted to the hidden input's change
event and recomputed the label from an empty checkbox set. Fixed by reading the right
attribute and ignoring non-checkbox change events. Verified: selecting an option in
line 1 changes only line 1.

## 29. File upload

Choosing files now records name, size and type on the draft and renders them with a
remove action. The bytes are still not uploaded in this build; the field exists so
the contract is visible.

## 30. Journal line scrollbar

The line grid always shows a horizontal scrollbar (`overflow-x: scroll`, stable
gutter) so a wide grid never hides columns silently.

## 31. Entry type placement

Entry type belongs to the entry, so it sits on the **Entry** tab beside the subtype.
More info holds only the audit strip and the note about custom fields.

## 32. Cancellation and deletion — corrected logic

Reversal is **a choice, not a requirement**.

| Action | Ledger | Register | Number | Log |
|---|---|---|---|---|
| Cancel | effect removed | stays, marked cancelled | kept, never reused | cancel recorded |
| Delete (after cancel, or a draft) | already out | removed | kept, never reused | delete recorded with the full previous state |
| Reverse | opposite entry added | both stay | new number | reversal recorded |

- A deleted entry is gone from every screen, but the audit log keeps what it was,
  who deleted it, when, and the values it had. The log is the permanent record.
- The sequence never reuses a number: if entry 3 is deleted, the next entry is 4.
- Delete is offered only for drafts and cancelled entries. A posted entry must be
  cancelled first, which is what guarantees the ledger is never silently changed.
- The record page shows the current state and only the actions valid for it.

---

# Round 5 — line fields, dimensions, balances

## 33. Journal lines

The line grid is now: **Account · Party/sub-account · Project · Location · Cost
centre · Debit · Credit · remove**. The per-line description is gone — the narration
at the header says what the entry is, and repeating it on every line was noise.

The grid keeps a **permanent horizontal scrollbar** by holding a fixed minimum width
(1120px) inside a scroll container, so a column can never disappear unnoticed.

## 34. Entry type is gone

The voucher is a journal entry by definition; the classification the ledger needs is
the **subtype** (bank, cash, contra, expense, debit/credit note, depreciation,
accrual, prepayment, write off, opening, adjustment, reversal). The old "adjusting"
entry type is replaced by the **adjustment** subtype, which is the only case where a
control line may omit the party.

## 35. Location lives on the line only

- No header location field: a single journal may move balance between locations, so
  each line carries its own.
- There is **no branch concept anywhere**. A branch is a location whose kind is
  `branch`. One list, one filter, one dimension.
- Projects and locations are the only two business dimensions. Balances can be
  viewed by either.

## 36. Balances by project or location — how it actually works

Profit and loss by dimension is easy: every line carries the dimension, so summing
income and expense lines by project or location gives the result directly.

A **balance** is different: it is a property of an account, and it can only be sliced
by a dimension if every posting that moves it carries that dimension. Three cases:

1. **Ordinary accounts** (rent, sales, fixed assets, loans). The dimension is on the
   ledger line, so balance by project/location = sum of the lines tagged that way.
   Works immediately.
2. **Control accounts** (receivables, payables). The account balance is the sum of
   party open items, and an open item is created by a document. So the dimension must
   be captured **on the document header** and copied to the open item. Then
   "payables for location X" = sum of open items tagged X. Tagging only the ledger
   line is not enough, because the line nets to zero against the control account.
3. **Unallocated amounts** (advance received, payment on account). They belong to a
   party but not to a project or location. They must either carry a dimension at the
   time of receipt or be reported as "unallocated" so the totals still reconcile.

**Rule to build by:** dimension on the document, inherited by every line and every
open item; report balances by dimension only where every posting carries one; always
show an "unallocated" column so the slice totals equal the account total. If a
mandatory-dimension policy is switched on in Setup, no posting can be saved without
it, and the slice is always complete.

## 37. Evidence upload

- The evidence area is a drop zone: drag files onto it or choose them; names, sizes
  and types appear immediately with a remove action.
- Bytes are not stored in this build. The field, the validation and the list are in
  place so the contract is visible.
- Handing over the two icon files: put the SVGs in
  `docs/design/save/ui/icons/` in the repository (or paste their markup in chat);
  chat attachments are not readable by this session. Once they are in the repo, they
  replace the two drawn glyphs in `icons.js`.

---

# Round 6 — one location per entry, dimension pages, setup heads, membership

## 38. The journal scrollbar is part of the page, not of the desktop

The line grid holds a fixed minimum width, so it always overflows its container.
The native scrollbar is hidden and a **custom track is drawn below the grid at all
times**; the thumb can be dragged and the track clicked, and it follows the grid
when the grid scrolls.

Reason: Firefox on Linux (and most touchpads) hide the overlay scrollbar until the
user starts scrolling, so an overflowing grid looked like it had no horizontal
scroll at all. The indicator is now always present, independent of the desktop's
scrollbar setting.

## 39. One location for the whole entry (supersedes §35)

- Location is a **single field on the journal header**: where this entry was made.
- Lines carry account, party/sub-account, project, cost centre, debit, credit.
- A **branch is a location whose kind is `branch`**. There is no branch table, no
  branch field and no branch report anywhere in Accounting.
- A movement of balance between two locations is therefore **two entries** — one
  issued at the origin location, one received at the destination — or two separate
  vouchers. The ledger stays company-wide and balanced.

Why this replaced the per-line location: the owner wants location to answer "where
was this entry made", not to be a second project-like dimension tracked line by
line. Project stays line-level because work is often split across projects inside
one document; location rarely is.

## 40. Balances sliced by project or location — deliberately not built

§36 explains how such a slice would have to work. The decision is now to **skip
it**:

- Profit and loss by project or location already works, because every line carries
  the dimension; the Projects and Locations dashboards show it.
- Balances are not sliced by dimension. Instead, a party or sub-account can record
  **which projects and locations it belongs to** (§43). Blank means all.
- Membership is a data field for picking and filtering. It carries no balance, it
  never restricts the ledger, and it is not an access control.

This keeps one rule: **balances live on accounts; dimensions slice activity.**

## 41. Switching business happens at sign-in, not in the topbar

The company dropdown is gone. The topbar shows the active business name as text.
A person who belongs to several businesses signs out and chooses the business at
sign-in, from the businesses they are a member of.

Backend consequence: a session is bound to exactly one company. Switching issues a
new session scope; every command carries the company it was authorised for. The
role selector that remains in the shell is the retained preview control, not a
company switcher.

## 42. Projects and Locations are accounting pages with a dashboard

Two new pages, each with two tabs:

| Tab | Contents |
|---|---|
| Projects / Locations | register of every row with code, name, manager or kind, state, postings, revenue, cost, net; footer totals; a create form |
| Dashboard | five figures (count, postings, revenue, cost, net), then one panel per project/location containing its ledger sliced by **accounting head**: postings, debit, credit, net, with a footer of revenue, cost and net |

- Every figure derives from the fixture ledger lines tagged with the dimension.
- Rows with no dimension are shown as **No project assigned / No location
  recorded**, so the panels add back to the whole ledger instead of quietly
  dropping postings.
- A new project or location appears immediately in the journal pickers, because the
  option lists are built per render instead of once.
- The standalone **Projects** module in Operations remains the delivery workspace.
  These two pages are the accounting view of the same dimension. Having both rail
  entries named “Projects” is noted as an open naming decision in §46.

## 43. Accounting heads are created in Setup

Setup now lists every accounting head (code, name, class, control, state) and has a
create form: code, name, class, control type.

- A new head appears immediately in the chart of accounts, the journal account
  picker, the default-account panel and the Projects/Locations head statistics.
- Codes are validated for uniqueness and shape (4–8 digits).
- A **receivable** or **payable** control head makes the party field mandatory on
  every line that uses it; that is what keeps the chart balance equal to its
  subledger.
- Party & sub-account **membership** is edited in the same page: for every customer,
  supplier, bank account and cash custodian, the projects and locations it belongs
  to. Blank means all. Stored per session in this build.

## 44. The footer sentence is gone

“Posted entries are immutable; corrections are reversals” was removed from the
journal form. It contradicted the agreed cancellation rule and repeated a policy
the record page already states. The form footer now reads
`Voucher · date time · location`.

The record page keeps the accurate rule: cancel removes the ledger effect and keeps
the register row, delete removes it from the register, the number is never reused,
the audit log keeps everything, and a reversal is optional.

## 45. Party / sub-account identity and membership are different fields

- **Identity** (round 3): who created, when, from which source (User or AI), and who
  submitted. Audit only.
- **Membership** (this round): which projects and locations the sub-account belongs
  to. Selection convenience only.

Neither of them moves a balance.

## 46. Open

- Two rail entries called “Projects” (Accounting dimension page and Operations
  module). Decide whether the accounting one becomes “Project ledger”, or the
  module one is removed from the rail.
- Membership is display-only until party and sub-account records exist in storage.
- Quick entry grid; custom fields as register columns; bank/cash reconciliation;
  payments allocation; invoices; period lock enforcement.
- Every figure is still a fixture. No posting, allocation or persistence.

---

# Round 7 — projects and locations as data fields, ledger totals

## 47. Project and location are plain data fields

Both are now treated the same way:

- they are created in **Setup** (Projects panel, Locations panel), next to the
  accounting heads;
- their pages are **read-only registers with a dashboard**, not editors;
- a journal line carries **project** (optional) and the voucher carries one
  **location**;
- a new code is visible in the journal form immediately, because the option lists
  are built on render;
- neither one holds a balance. They slice activity; balances stay on accounts.

A branch is a location whose kind is `branch`. There is no branch table, field or
report.

## 48. Balances by project — what is possible and what is not

This is the honest answer to “can I see which payables belong to project X”.

**Profit and loss by project or location: yes, already built.** Every line carries
the dimension, so summing income and expense lines per project gives a result that
adds back to the trial balance. The Projects and Locations dashboards show exactly
that, by accounting head.

**A balance by project: not from the ledger alone.** Three different cases:

1. **Ordinary accounts** (rent, sales, fixed assets, loans, owner capital). The
   balance is the sum of the tagged lines, so slicing it works today. Nothing to
   build.
2. **Control accounts** (trade receivables, trade payables, bank and cash
   sub-accounts). Their balance is **not** the sum of their ledger lines: the
   control line and the party line net to zero. “Receivables by project” read from
   the ledger would therefore be meaningless. To get it you need the dimension on
   the **document** (the invoice, the bill, the payment), copied to the **open
   item**, with allocations inheriting it. The report then comes from the
   open-item subledger, not from the general ledger. Required pieces:
   documents, open items, allocations, a mandatory-dimension policy if the owner
   wants complete coverage, and an **unallocated** bucket for advances and
   on-account money so the slice still equals the control balance.
3. **Unallocated money** (advance, payment on account, unapplied credit). It
   belongs to a party but maybe not to a project or a location. It must either
   carry a dimension at receipt or be reported as unallocated.

So the decision is: **do not slice balances by project or location in this build.**
We do not have invoices, parties or open items yet, and inventing a project balance
from the ledger would produce a number that cannot reconcile. Revisit this only
after the party subledger exists, and then only as a subledger report with an
unallocated column.

What is explicitly forbidden as a shortcut: splitting a control balance across
projects by percentage, tagging only the control line and calling it a balance, or
letting different screens compute a balance differently.

## 49. General ledger totals at the top

A totals strip now sits between the panel heading and the table, so the numbers are
visible without scrolling:

| Field | Meaning |
|---|---|
| Lines | lines currently shown, and the whole-period count when a filter is active |
| Total debit | sum of the debit column, filtered |
| Total credit | sum of the credit column, filtered |
| Net debit | debit minus credit; labelled “in balance” when they agree, “one-sided view” when an account filter makes them differ |
| Whole period | only when filters are active: lines, debit and credit with no filters |

The table footer keeps its total row; the strip is the same figure, placed where it
is seen first.

## 50. Open

- The party subledger (parties, invoices, allocations) is the prerequisite for any
  project balance report; decide after it exists.
- Two rail entries are called “Projects” (Accounting data-field page and the
  Operations module). Decide whether to rename one.
- Membership set in Setup is still display-only until party records exist.

## 51. Supplied icons

The owner supplied two Flaticon glyphs — print (`print_3917119`) and vertical menu
(`menu-dots-vertical_3917764`). They are stored as source files in
`docs/design/save/ui/icons/`, inlined into `ui/icons.js` with `fill="currentColor"`
so they follow the theme, and used in the journal header for print and the overflow
menu. No network request is made. Attribution and licence terms are recorded in
`docs/design/ASSETS.md`; the free licence requires it, so it must travel with the
design if it is published.

---

# Round 8 — data fields only, tabbed Setup, filtered totals

## 52. Ledger totals, corrected

- The extra “Whole period, no filters: …” sentence is gone. It repeated what the
  strip already says and appeared only to explain a number nobody asked for.
- The fourth figure is **dynamic**:
  - debits larger → **Net debit**, positive value;
  - credits larger → **Net credit**, positive value;
  - equal → **Net**, 0.00, “in balance”.
  The old version always said “Net debit” and printed a negative number when the
  credit side was larger.
- The strip still shows lines shown versus lines in the period when a filter is on.

## 53. Projects and locations are data fields, not pages

The two accounting pages for Projects and Locations are **removed**. They were a
half-measure: the owner wants them to behave exactly like any other data field.

- They are created in **Setup → Projects & locations**.
- They are chosen on the journal: **project per line** (optional), **one location
  per voucher**.
- They slice reports; they never carry a balance.
- The standalone **Projects module** in Operations stays as the delivery workspace.
  The duplicate rail entry is therefore gone.

## 54. Setup is tabbed

One page, six tabs, one section each, so nothing is crowded:

| Tab | Contents |
|---|---|
| Organisation | legal name, base currency, fiscal year, current period, terms, credit behaviour |
| Numbering | document prefixes and the next journal number |
| Default accounts | control and default accounts, read from the chart flags |
| Accounting heads | head table plus the create form |
| Projects & locations | project table and form, location table and form, cost centres |
| Approvals & periods | review threshold, self approval, period lock, correction route |

## 55. Membership belongs to the party, not to Setup

The membership editor in Setup is removed. Which projects and locations a party or
sub-account may be used on is a field **on that party or sub-account form**, exactly
as the owner described:

- creating a customer or supplier asks for the projects and locations it is allowed
  on;
- creating a bank or cash sub-account asks the same;
- blank means all.

The journal now follows that order:

1. choose the **account**,
2. choose the **project** (and the voucher's **location** at the top),
3. choose the **party / sub-account**, filtered to what is allowed for that account
   kind and for the chosen project and location,
4. choose the **cost centre**,
5. enter debit or credit.

Consequences built in this round:

- Column order is Account · Project · Party/sub-account · Cost centre · Debit ·
  Credit.
- The party list is filtered by the account kind **and** by the party's allowed
  projects and locations.
- Changing the project or the voucher location clears a party that is no longer
  allowed, so an invalid combination cannot be saved.
- `PARTY_ACCESS` in `accounting-model.js` holds the sample restrictions used to
  demonstrate the rule (Atlas Studio, Meridian Pharma, Willow Supplies). The other
  parties are unrestricted, which is what “blank means all” looks like.

The party register and the bank/cash sub-account forms do not exist yet; when they
are built they carry these two fields and the journal needs no further change.

## 56. Filter box no longer runs under its neighbour

Selecting two or three values made the filter trigger grow, because the text span
had no `min-width` inside its flex row and refused to shrink. It now truncates with
an ellipsis (`min-width:0`, `max-width:320px` on the filter control), so a long
selection can never overlap the next block.

---

# Round 9 — cash & bank, items, taxes, reports, and the two registers completed

## 57. Cash & bank

One page, exactly like the journal page: a register and a form.

- The register lists every **sub-account** — the party inside the control head —
  with code, name, bank reference, kind, control account, postings and balance.
- The form asks for code, name, kind (bank or cash), reference, and **which projects
  and locations it may be used on**. Blank means all.
- Bank sub-accounts belong to control **1010**, cash sub-accounts to **1000**. The
  journal only offers a bank name on a bank line and a cash custodian on a cash
  line, narrowed by the chosen projects and locations.
- The head keeps the balance. The page shows four figures: bank, cash, the part of
  the controls named to a sub-account, and **unallocated** — the part no document has
  named yet. The fixture leaves 5,110.00 unallocated on purpose, so the concept is
  visible instead of hidden.
- Bank lines in the fixture now name their sub-account, so per-account balances are
  real and add up to the control.

## 58. Items

One page, register plus form, same philosophy.

- Code, name, unit, **income head**, **expense head**, **tax rule**, and the
  **inventory-tracked** flag.
- Accounting stores accounts and the tax default; Inventory owns quantity, valuation
  and movement. Item lines appear in the ledger only when invoices exist, so the
  register says that rather than inventing usage figures.

## 59. Taxes

Five tabs, all built, one page:

| Tab | Contents |
|---|---|
| Rules | register of rules with kind, rate, basis, account, scope, effective date, allowed projects and locations; a form creates a new rule |
| Registers | output and input tax lines derived from documents, with base, tax, effective rate, project and location, and totals |
| Withholding | expected against recorded, from the withholding rules and this period's expense base |
| Advance tax | the same for tax a customer deducts from our invoices |
| Reconciliation | tax account register total against the ledger balance, with a difference per account |

- A rule is a default; a document line may override or switch it off.
- Withholding and advance are zero in the fixture because nothing has been withheld
  or deducted yet. The page says so and shows the expected gap; it does not pretend
  the money moved.

## 60. Chart of accounts

Completed:

- group total on every class row (Assets, Liabilities, Equity, Income, Expenses);
- closing balance of every head, marked **Dr** or **Cr**;
- control badge (`receivable`, `payable`) on the head;
- the detail panel shows control type and closing balance;
- the chart now carries inventory, petty cash, advance tax receivable, withholding
  tax payable and bank charges, so the default-account list points at real heads.

## 61. Trial balance

Completed:

- a totals strip: heads, period debit, period credit, net or difference, balanced
  badge;
- all amounts formatted with thousands separators and two decimals;
- opening net, movement and closing debit/credit per head, click through to the
  ledger.

## 62. Reports

One page, five tabs, every figure from the same ledger:

| Tab | Contents |
|---|---|
| Ageing | receivables and payables by bucket with totals, plus the depreciation schedule |
| Profit & loss | income and expense per head, totals, result for the period |
| Financial position | assets, liabilities, equity, accumulated result, and the equation check |
| Cash flow | opening cash, receipts, payments, net movement, closing, movement by document type |
| Equity | capital accounts, accumulated result, total equity |

None of it presents a statutory statement; each panel says what it does and does not
include.

## 63. What is still not built

- Parties register and party page (with allowed projects and locations on the form).
- Payments with allocation.
- Sales and purchase invoices.
- Bank statement reconciliation.
- Period close with an enforced lock.
- Quick entry grid, forms register, custom fields as columns, persistence.

---

# Round 10 — parties, payments, invoices, close, and a real Settings module

## 64. Cash and bank controls are data, not fixed codes

- The chart marks a head as a **bank control** or a **cash control**; 1010, 1000 and
  1020 now carry that flag.
- The sub-account form **chooses the control head** from every head flagged bank or
  cash, so a business with two cash controls sees both and can attach accounts to
  either.
- The cash & bank page totals are computed from those controls, not from fixed
  codes: bank controls, cash controls, the part named to a sub-account, and what is
  unallocated.
- The journal follows the same flag: a bank control accepts bank sub-accounts, a
  cash control accepts cash ones. No code is hard-coded any more.
- New control heads are created in Settings → Accounting → Accounting heads.

## 65. Parties

- One register of customers and suppliers: code, name, type, group, terms, credit
  limit, control balance, status.
- A row opens the party: balance, terms, limit use, tax identity, group, allowed
  projects and locations, and the statement (date, voucher, source, debit, credit,
  running balance).
- The party form collects the allowed projects and locations at creation; the party
  page can change them later. The journal reads the party record directly, so an
  access change applies immediately.
- Balances come from the party's control account lines, so they agree with the
  receivables and payables control heads by construction.

## 66. Payments

- Register of receipts and payments with direction, party, cash/bank sub-account,
  amount, what it settles and its state.
- The form allocates **oldest open document first** and shows the remainder as an
  advance on account. Open documents are derived from invoices and bills minus
  what already settled them.
- Session documents are numbered `RCT-…` / `PMT-…` and appear in the register. They
  do not write a ledger entry in this build.

## 67. Sales and purchase invoices

- Register of invoices and bills with date, number, party, due date, net, tax, gross
  and state.
- The form has party, dates, narration and three service lines with quantity and
  unit price; **Calculate** refreshes the totals, **Save** adds a session document
  numbered in the `SI-` / `PI-` series.
- The documents say plainly that nothing posts yet. When posting exists, the same
  form writes receivables/payables, income/expense and the tax control.

## 68. Period close

- Checklist with the trial balance proof (computed), tax registers, party control
  schedules, bank proof, drafts and named sign-off.
- **Lock November 2026** requires a sign-off name and a date, then sets a session
  lock; **Reopen** is available with the warning that a real reopen needs an
  administrator and a reason.
- The lock is the same switch as Settings → Periods, so the two pages cannot
  disagree.

## 69. Settings is its own module

Accounting no longer carries a Setup page. Settings (Workspace settings) now holds
seven working pages, reached from the rail:

| Page | Contents |
|---|---|
| Company | legal identity, addresses, base currency, fiscal year, active period |
| Accounting | numbering, default accounts, accounting heads, projects & locations, approvals — the five accounting tabs |
| People & access | users, roles, scope, invitations |
| Periods | every period with its state and the shared lock |
| Forms & fields | standard field counts per form and custom fields added to them |
| Saved views | named list views with their scope and detail |
| Print & templates | letterheads, sizes and what prints |

The journal's "more info" guidance now points at Forms & fields for custom fields.

---

# Round 11 — every form is complete and can be amended

## 70. The same form creates and updates

Every master-data form is now **create-or-edit**: the list has an **Edit** action, the
form loads that record, the heading says which record is being edited, and **Save
changes** updates it in place. **Cancel** returns the form to create mode. There is
no second, separate edit dialog, so the fields cannot drift apart.

This applies to cash and bank sub-accounts, parties, items, tax rules, projects and
locations.

## 71. Field completeness

| Form | Fields |
|---|---|
| Cash / bank sub-account | code, name, control head, kind, bank name, branch, account/IBAN/till, currency, opening balance, status, notes, allowed projects, allowed locations |
| Party | code, name, type, group, contact person, phone, email, currency, terms, credit limit, opening balance, tax identity, status, billing address, notes, allowed projects, allowed locations |
| Item | code, name, group, unit, description, income head, expense head, tax rule, tracked flag, sale price, purchase price, status |
| Tax rule | code, name, kind, rate, basis, account, scope, effective from, effective to, status, line override, description, allowed projects, allowed locations |
| Project | code, name, manager, state, start, end, budget, description |
| Location | code, name, kind, address, contact person, phone, notes |
| Journal entry | date, time, number, subtype, location, narration, lines (account, project, party, cost centre, debit, credit), evidence, audit strip, custom fields |
| Receipt / payment | direction, party, cash/bank account, date, method, reference, instrument number and date, amount, notes |
| Sales invoice / purchase bill | party, date, due date, terms, reference, location, narration, three lines, notes |
| Company settings | legal name, trading name, tax identity, registration, currency, fiscal year, period, week start, time zone, date format, address, city, country, phone, email, website |
| Numbering | prefix and next number for journals, sales, purchases, payments, receipts, plus padding |
| Default accounts | eight real account selectors (receivables, payables, input tax, output tax, inventory, rounding, bank, cash) |
| Approvals | review threshold, self-approval policy, period lock policy, reopen authority, closed-period posting, correction route |
| People | name, email, phone, role, scope, status |
| Forms & fields | form, label, type, required, help text |
| Saved views | name, scope, detail, shared or private |
| Print | name, size, logo, QR, margin, footer |

## 72. Settings and Accounting are one chain

- Custom fields added in Settings → Forms & fields appear on the journal's **More
  info** tab, marked required when they are required, and are saved with the draft.
- Default accounts, numbering and approval policy are edited in Settings → Accounting
  and take effect in the forms that use them.
- The company identity edited in Settings → Company is the identity printed on every
  document.

All of it is still session state: the forms validate with the browser's required and
pattern rules plus the accounting rules (control accounts need a party, allowed
projects and locations narrow the picker), and nothing pretends to persist.

---

# Round 12 — registers and forms are separate pages, everywhere

## 73. A register lists; a form opens on its own page

The inline “New …” form at the bottom of a page is gone. Every accounting register
now behaves like the journal:

- the page is **only the register**;
- the **page action** creates a new record (`New sub-account`, `New party`, `New
  item`, `New tax rule`, `New receipt or payment`, `New invoice`, `New bill`);
- **clicking a row** opens that record in the same form;
- **Save** returns to the register, **Cancel** returns without saving.

The URL carries the mode and the record (`mode=editor&code=…`), so an open form is a
real page: it can be bookmarked, refreshed, reached with the browser back button, and
shared. The heading shows “New …” or “Edit …” and the badge shows which record is
open.

Applied to:

| Page | Create from | Edit from |
|---|---|---|
| Cash & bank | page action, register button | row click |
| Parties | page action | party page “Edit party”, register Edit |
| Items | page action | row click |
| Taxes → Rules | page action, register button | row click |
| Payments | page action, register button | — (documents are fixed once saved) |
| Sales invoices / purchase bills | page action, register button | — |
| Journal entries | page action | record page (draft) |

## 74. One form, two jobs

There is no separate edit dialog. Each record type has **one form component** that
accepts an optional record code: empty renders a blank form, a code loads the record
and switches the labels. That is what keeps create and edit from drifting apart.

The binders are scoped to their own form (`[data-cash-form] [data-form-cancel]`, and
so on), so two editors on the same page cannot capture each other's buttons. Save
navigates back to that register.

## 75. What still uses an inline form

Settings is configuration, not a register: Company, Numbering, Default accounts,
Approvals, People, Forms & fields, Views and Print keep their inline forms because
each edits one settings object. The registers that live *inside* Settings — projects,
locations and accounting heads — still use inline forms; moving them onto the same
page pattern is the next step.

## 76. One create button, not two

The duplicate “New …” button inside the register panel is gone. The page action at
the top right is the single create entry point; rows still open their own record.
This applies to cash & bank, tax rules, payments and invoices.

## 77. Permanent scroll indicator on every table

The always-visible horizontal indicator that started on the journal line grid is now
on **every table**: cash & bank, parties, items, tax rules and registers, payments,
invoices, trial balance, chart, general ledger and the settings tables.

- The native bar is hidden; a custom track sits under the table and is always drawn,
  with a draggable thumb and click-to-jump.
- It follows the table when the table scrolls and recalculates on resize.
- A table that fits shows a full-width thumb; a wide table shows the real proportion,
  so nobody has to guess that columns are cut off.

## 78. A whole row opens its form

Clicking anywhere on a register row opens that record — not just the code or a small
button.

- Cash & bank, items, tax rules: the row opens the editor directly.
- Parties: the row opens the party form; the **Statement** button inside the row
  opens the party page, and its click does not bubble to the row.
- Every clickable row shows a pointer cursor and a highlight on hover.

Document registers (payments, invoices) stay read-only because their records are not
editable after saving; their create action is the page button.

## 79. Every register can be searched and filtered

Each accounting register now has a filter bar above the table:

| Register | Search covers | Filters |
|---|---|---|
| Cash & bank | code, name, reference, kind, control-head name, project, location | kind, control head, status |
| Parties | code, name, group, contact, email, phone | type, status |
| Items | code, name, group, unit, description | — |
| Taxes → Rules | code, name, kind, scope, description | — |
| Payments | reference, party, cash/bank account, against, method | direction |
| Sales and purchase invoices | number, party, date, due date | — |

Details:

- Search is **instant**: typing re-renders the list, and the caret is restored so the
  field stays usable.
- The filter state lives outside the page, so it survives a re-render, opening a
  record and coming back, and switching between register and form.
- **Reset** clears that register's filters only.
- The count in the panel head reads “shown of total”, and the footer total follows the
  filtered rows, so a filtered list never pretends to be the whole book.
- Statistics at the top of the page stay unfiltered: they are control totals, not
  search results.

---

# Round 13 — no cash stats strip, and control accounts always need a party

## 80. Cash & bank loses the statistics strip

The four figures at the top of the page are removed for now. The page opens straight
into the filter bar and the register. The counts and totals that matter are still
there: “4 of 4 accounts” in the panel head and the total of the rows shown in the
footer. The figures can come back when the owner asks for them.

## 81. Every control line needs a party — with no exception

This **revokes the earlier adjustment exception**. A line on a control account can no
longer exist without a party or sub-account, whatever the subtype.

What the rule covers: any head carrying a control flag — receivable, payable, bank,
cash, and any future control such as an asset or inventory control — because the rule
reads the flag, not the account code.

Where it is enforced:

| Place | Behaviour |
|---|---|
| Journal line | The party picker only enables on a control account and its list is limited to that kind |
| Journal review panel | Lists “1100 Trade receivables needs a party or sub-account” and cannot read “Ready to post” |
| Save draft / Submit / Submit for approval | Blocked with a message naming the line, e.g. “1100 Trade receivables on line 1 is a control account. Choose a party or sub-account before continuing.” |
| Model validation (`reviewJournal`) | Throws for any control line without a party, for every caller |

The party itself is the sub-account: a customer for 1100, a supplier for 2100, a bank
sub-account for a bank control, a cash sub-account for a cash control. Those records
carry the allowed projects and locations, so the picker is narrowed by both the
account kind and the access rule.

## 82. Cash & bank can be read at any date

The register has a **Balances as at** date in its filter bar.

- Empty means **current balances** — the badge says so.
- A date shows each sub-account's balance as it stood at the close of that day, and
  the postings count follows the same cut-off.
- Underneath, the small line keeps the **current** balance visible, so the two can be
  compared without switching back.
- The footer total and the “shown of total” count follow the chosen date too.
- **Reset to current** clears the date along with the other filters.

The rule is inclusive: a document dated on the chosen day is included, which is what
“balance at the end of that day” means. If the owner later wants opening-of-day
figures, that is a second option on the same control rather than a different report.

---

# Round 14 — journal opens in its form, GL party/sub-account, scrollbar on top

## 83. A journal entry opens in the form that created it

Clicking a row (or the voucher) in the journal register now opens the **journal form**,
not a separate record view.

- The URL carries `mode=editor&code=<voucher>`; the form loads that document.
- **Draft or returned from approval** → the form is editable: save, submit, submit for
  approval, duplicate, delete.
- **Posted** → the form is read-only: every field is disabled, a banner explains the
  state, and the menu offers only what is valid — **Cancel entry** (removes the ledger
  effect, keeps the row), **Duplicate** (starts a correction), and **Delete** once
  cancelled.
- **Cancelled** → read-only, with Delete and Duplicate.
- Numbers are never reused. Save/Submit return to the register; the row shows the new
  state.

The principle is the same for every document: a register opens the document in its
own form, and the state decides which actions are offered. Documents that are posted
are never edited in place — they are cancelled, duplicated or reversed.

## 84. General ledger: Party / sub-account

- The column formerly called **Party** is **Party / sub-account**, and it shows the
  **line's** party when there is one — so a 1010 line shows *Standard Bank — current
  0123456789*, a 1000 line shows the cash custodian, and a 1100 line shows the
  customer.
- **Party type** follows the account: Bank, Cash, Customer or Supplier.
- The filter is **Party / sub-account** and lists customers, suppliers and every cash
  and bank sub-account. Filtering by one sub-account shows exactly its lines, which
  is the register question “what moved through this account”.
- Sub-account balances themselves stay out of the party register; the cash & bank
  page owns those, and the GL shows their transactions.

## 85. The scroll indicator sits above the table

The permanent horizontal indicator moved from below the table to **above it**, so it
is reachable before scrolling. This matters most in the general ledger, where 470
rows make a bottom bar useless. It is still always drawn, draggable and clickable,
and it recalculates on resize.

---

# Round 15 — journal export, correct back button, GL rows open their document

## 86. Journal register exports

The register has **Export CSV** beside Print. It exports the rows currently shown,
with the columns the register uses: date, voucher, description, debit, credit, state,
voucher type, subtype, party/sub-account, project, location and cost centre. Export
respects the filters and the sort.

## 87. “Back to register” returns to the page you came from

The editor’s back button used a generic `register` route that always resolved to the
journal register, so leaving a cash sub-account form dropped you in Journals. It now
returns to **the register of the page being edited** (`tab` preserved, editor mode
cleared). Cash & bank → cash, parties → parties, items → items, taxes → taxes,
payments → payments, invoices → invoices, journals → journals.

## 88. A ledger row opens the document, not a detail dialog

Clicking a general-ledger row no longer expands an inline detail. It opens the
transaction where it belongs:

| Row source | Destination |
|---|---|
| Journal | journal form at that voucher (`mode=editor&code=…`) |
| Sales invoice | Sales invoices register, filtered to that document |
| Supplier bill | Purchase invoices register, filtered to that document |
| Payment | Payments register, filtered to that document |

The register filter is pre-filled with the voucher, so the document is the only row
shown and its surrounding context is intact.

---

# Round 16 — the four conflicts settled

## 89. Numbering has one source, and it is Settings

The settings page still showed `JE-2026-` / `0201` while the journal form generated
`JV-MM-YYYY-0001`. That was a mistake in the settings page, not two valid choices.

- `NUMBERING` in the accounting model is now the only place a series is defined:
  journal prefix with month and year segments, plus sales, purchase, payment and
  receipt prefixes, the next number and the padding.
- The journal form builds its number from it: prefix, month, year, padded sequence.
- Settings → Accounting → Numbering renders those values and **saves back into them**.
- Creating a new journal re-reads the settings, so a changed prefix or next number is
  used immediately. The number is still frozen once the first document exists, and a
  deleted or cancelled number is never reused.

## 90. No cash and bank statistics

The cash & bank strip stays removed. For this phase the **cash flow report** answers
the question, with opening cash, receipts, payments, net movement and closing cash.
The register keeps its own per-account balances, search, filters and balance-as-at
date.

## 91. Every document follows the same cancel/delete rule

Confirmed: journals, payments, invoices and bills all use the same lifecycle —
draft, submitted, posted, cancelled — with **cancel removing the ledger effect while
keeping the register row**, **delete removing the row** (draft or cancelled only), a
number that is never reused, and an audit log that keeps everything.

Sales and purchase **returns** are the exception that will get their own flow: a
credit note against an invoice and a debit note against a bill, each linked to the
original document. That flow will be built with the invoice modules, not improvised
here.

## 92. Projects, locations and heads inside Settings — explained, still open

The remaining “conflict” is an inconsistency, not a contradiction:

- Every **register** in Accounting opens its form on a separate page.
- Inside **Settings → Accounting**, the three configuration lists (projects,
  locations, accounting heads) still show a table and an inline form on the same tab.

Both are edit-in-place master data; the difference is only the interaction. The
question is whether those three should follow the register + form-page rule too, or
stay inline because they are configuration. **Awaiting the owner’s decision.**

---

# Round 17 — settings registers, parties without a statement page, chart and trial together

## 93. Settings → Accounting is tabs of registers, each with its own form page

The Accounting settings page keeps its tabs, but each list is now a **register** and
its form opens on a **separate page** — the same rule as every other register.

| Tab | Register | Form |
|---|---|---|
| Numbering | series and next numbers | saved in place (configuration form) |
| Default accounts | account selectors | saved in place (configuration form) |
| Accounting heads | code, name, class, control, opening, closing, state | separate page |
| Projects | code, name, manager, state, dates, budget | separate page |
| Locations | code, name, kind, address, contact | separate page |
| Party groups | code, name, applies to, description | separate page |
| Item groups | code, name, description | separate page |
| Taxes | rules register + default withholding | separate page for a rule |
| Approvals | policy fields | saved in place (configuration form) |

The editor URL is `mode=editor&form=<tab>&code=<id>`, Save returns to the tab it
belongs to, and the open tab is remembered for the session. Clicking a row edits it;
the page action in each register creates a new one.

## 94. Party groups and item groups exist

They were missing. Both are now registers with forms:

- **Party groups** — code, name, applies to (customers, suppliers or both) and a
  description. A group classifies customers and suppliers for reporting and defaults.
- **Item groups** — code, name and description; the basis for item reporting and
  default accounts or tax.

## 95. Parties: no statistics, filters and balances, statement goes to the ledger

- The statistics strip is removed.
- Filters: search (code, name, group, contact, email, phone), type, status,
  **balance direction** (debit / credit / zero) and **balances as at** a date, with the
  current balance kept underneath — the same control the cash register uses.
- The party page is gone. **Open** on a row sets the party filter on the **general
  ledger** and goes there; the user chooses the dates. Clicking the row itself opens
  the party form for editing.

## 96. Cash & bank goes to the ledger too

Each sub-account row has **Open**, which sets the party filter to that sub-account and
opens the general ledger. The register stays the place for the balance, the search,
the filters and the balance-as-at date.

## 97. Items carry default sales and purchase tax; tax setup moves to Settings

- The item form now asks for a **default sales tax** and a **default purchase tax**
  (a tax rule each). Both are defaults: an invoice or bill line may change them.
- The register shows the two tax columns instead of one.
- **Taxes leaves Accounting.** Settings → Accounting → Taxes holds the tax rules
  register and its form, plus **default withholding** for sales tax and income tax on
  receipts and on payments. The comprehensive tax module (registers, returns,
  certificates) comes later.

## 98. Chart of accounts and trial balance are one page, two tabs

- The Accounting page is **Chart of accounts**, with tabs **Chart of accounts** and
  **Trial balance**. The separate Trial balance page is gone.
- **Chart register**: a normal table, grouped by class (Assets, Liabilities, Equity,
  Income, Expenses) with a collapsible class row and a class total. Columns: **code**,
  account name, class, head, control, opening, period debit, period credit, closing
  (Dr/Cr). Clicking a row opens the account form; **New account** opens the same form
  empty.
- **Trial balance**: three descriptive columns — **code**, **class**, **head**,
  **account name** — then opening, period debit, period credit and closing debit and
  credit, with totals. Filters: date range, class, head and search. Export CSV.
- The account form is a separate page (`mode=editor&code=…`) that adds or updates a
  head and returns to the register.

## 99. Period close moves to Settings

Accounting no longer has a Period close or a Taxes page. **Settings → Periods** lists
the periods and owns the lock: closing a past period locks it against entries, and
only an administrator may lock or reopen. The close checklist is retired from the rail
and its checks live in the periods page and the reports.

## 100. What is left, explicitly

So nothing is forgotten, this is the current remaining list:

1. **Payments** page review (register, form, allocation, defaults from the tax
   withholding settings).
2. **Sales and purchase invoice** page review, including returns (credit and debit
   notes linked to the original).
3. **Every form reviewed field by field**, with its effect on the register columns.
4. **Print formats** review for every document.
5. **Settings pages and their forms** reviewed (Company, People, Periods, Forms,
   Views, Print).
6. Posting from invoices and payments into the ledger; persistence; bank
   reconciliation; permissions enforcement.

---

# Round 18 — chart and trial corrections, naming, cost centres

## 101. Chart of accounts is a register, not a trial

- The **New journal** page action is gone from the chart page. Its own **New account**
  button is the action; nothing else belongs there.
- The class **collapse/expand** is removed. The tab is a plain register of every
  account, one row each.
- Columns are the account's own information: **code, account name, accounting head,
  accounting group, control, currency, description, state** and its **closing
  balance**. Opening and period movement belong to the trial tab, not here.
- Clicking a row opens the account form page; **New account** opens the same form
  empty.

## 102. Trial balance opening has debit and credit columns

The trial now shows **opening debit** and **opening credit** separately (the net
opening figure split by sign), alongside period debit, period credit, closing debit
and closing credit, with matching totals. The columns before the amounts are code,
accounting head, accounting group and account name.

## 103. Naming: accounting head and accounting group

The names were inverted. From now on:

- **Accounting head** = the class of the account: asset, liability, equity, income,
  expense. This is the `type` field.
- **Accounting group** = the reporting bucket the account sits in: Assets,
  Liabilities, Equity, Income, Expenses. This is the `group` field.

Labels are updated in the settings register, both account forms (which now ask for
the group explicitly), the chart register and the trial balance. Field names in the
data are unchanged (`type` and `group`), so nothing else breaks.

## 104. Cost centres are a register in Settings

Cost centres were a hard-coded list with no page. They are now records with a code,
a name, a description and a state, and Settings → Accounting has a **Cost centres**
tab like Projects and Locations, with its own form page. The journal's cost-centre
picker reads the register and follows the names.

---

# Round 19 — trial to reports, items filters, invoice returns

## 105. Trial balance moves to Reports

The Chart of accounts page is now one thing: the **account register**. The exact trial
balance lives on **Reports** as its own tab (Ageing · Trial balance · Profit & loss ·
Financial position · Cash flow · Equity). The chart keeps no tabs.

## 106. Items: no statistics, real filters

The three figures at the top are removed. The register filters by search (code, name,
group, unit, description), **group**, **stock** (tracked or service) and **status**.
The form stays as it is for now; its field-by-field review is still pending.

## 107. Invoices and bills: returns, filters, no statistics

Both invoice pages follow the same rules.

- **No statistics strip.**
- **Two tabs**: documents and **Returns**.
- Document register filters: search (number, party, date), **party** and reset.
- Columns add **Returned** and **Balance** next to net, tax and gross, and the state
  becomes *posted*, *partly returned* or *returned*.
- Each row has a **menu** with **Open** and **Return**.
  - **Open** loads the document in the invoice form; posted documents are read-only
    with a Return action, session documents remain editable.
  - **Return** opens the return form with that document already chosen and the
    balance prefilled.
- The **Returns** tab lists every return with its original document, party, net, tax,
  gross and reason, and has a **New return** button so a return can be created
  without opening an invoice first.
- A saved return is numbered `SR-2026-…` for sales and `PR-2026-…` for purchases,
  updates the original's **Returned** and **Balance**, and never changes the
  original's number or state beyond the return status.
- Partial returns are allowed; the maximum is the outstanding balance, and the tax is
  split in the same proportion as the original.

---

# Round 20 — Payment / Receipts and paying an invoice at the same time

## 108. The page is Payment / Receipts

- Renamed in the rail and the page title.
- **No statistics.**
- Filters: search (reference, party, account, document), **type** (payments and
  receipts, receipts only, payments only) and **party**.
- Columns: date, reference, **type**, party, **method**, cash/bank account, **against**
  (invoice or advance), amount and state.
- A document may carry **more than one method**: bank, cash, or an **advance already
  paid**. Each row has a method, an account or advance reference, its own reference
  and an amount. The rows make the total.
- The total is allocated across the party's open invoices **oldest first**; anything
  left is kept as an **advance**. Party is mandatory.

## 109. An invoice can record its payment while it is created

- The invoice and bill forms have **Record payment with this document**:
  *No — post the document only* or *Yes — record the money now*.
- Choosing Yes reveals the same payment rows as the payment page (bank, cash,
  advance), each with account, reference and amount.
- Saving the invoice then also creates the receipt (sales) or payment (purchase),
  automatically against that invoice, with the remainder as an advance — so the user
  does not have to post two documents for one transaction.
- The invoice register now shows **Paid** beside **Returned**, and
  **Balance = Gross − Returned − Paid**. Payments already recorded in the fixture are
  counted too, so the balance always reflects what is actually still open.
- Posted documents stay read-only; their payment section is not offered.

## 110. Kept honest

Returns and payments update the register balances immediately, but nothing is posted
to the ledger yet. The balances are the documents' own arithmetic: gross, less what
was returned, less what was paid.

## 111. Every register has filters and an export

- Accounting: cash & bank, parties, items, payments/receipts, invoices/bills and
  returns now carry **Export CSV** alongside their filters. Chart, ledger and the
  journal register already had theirs.
- Settings: accounting heads, projects, locations, cost centres, party groups, item
  groups, tax rules, people, saved views and print templates each gained a **search
  filter** (plus status or kind where it matters) and **Export CSV**.
- The export is table-based: it writes exactly the rows currently on screen, with the
  filters applied, so what is exported is what is seen.

---

# Round 21 — Inventory, Manufacturing and Assets

## 112. Inventory

Fifteen pages, all working on the shared item master and one stock ledger.

- **Dashboard** — stock value, value by warehouse, below reorder and recent
  movements.
- **Items** — the tracked items with on-hand, average cost, value and reorder point.
- **Groups** — links to the shared item groups in Settings.
- **Warehouses** — register and form: code, name, accounting location, address,
  custodian, bins, state.
- **Balances** — quantity, average cost and value per item per warehouse, derived
  from movements only.
- **Movements** — every in/out line with source document, reference, project, reason,
  filters by warehouse and direction.
- **Goods receipt, Delivery note, Transfer, Stock count, Adjustment** — form pages
  that write movements; a transfer writes a matching out and in; a count writes the
  variance as an adjustment.
- **Valuation** — weighted average per item with totals.
- **Reorder** — items below their point with a suggested quantity.
- **Reports** — value by item, movement summary by warehouse.
- **Settings** — costing method, negative stock, default accounts and warehouse.

Balances are **never stored**: quantity and value are computed from the movement
ledger, so the dashboard, balances, valuation and reorder cannot disagree.

## 113. Manufacturing

- **Dashboard** — open orders, produced, scrap, material shortages.
- **Bills of material** — register and form: finished item, output quantity, one
  component with quantity, one operation with work centre and minutes, version.
- **Routings** — the operations of each BOM, with rate and step.
- **Work centres** — register and form: rate, capacity, calendar.
- **Planning** — suggested quantity per active BOM, with a short/ready check on
  components.
- **Work orders** — register and form, with **Release → Issue → Produce → Close**
  actions; issue consumes components and produce receives output as stock movements.
- **Scrap** — recorded against the order and reflected in yield.
- **Subcontracting** — the flow is described and the document is the next increment.
- **Costing** — material (issued × average cost) plus labour (routing minutes × rate)
  per order and per unit.
- **Reports** — order status and material consumption.

## 114. Assets

- **Dashboard** — net book value, cost, accumulated depreciation, monthly charge.
- **Register** — code, asset, category, location, custodian, acquisition date, cost,
  accumulated, NBV, status, with filters and export.
- **Categories** — method, rate, life and the three accounts.
- **Acquisitions** — capitalise an asset (the form is the asset form).
- **Depreciation** — the monthly charge per asset and a **Run November charge** that
  updates accumulated depreciation for the session and records the run.
- **Impairment, Transfers, Disposals** — forms that write down, move custody, or
  dispose with proceeds and gain/loss.
- **Reports** — movement schedule by category and a twelve-month forecast.

## 115. Linking to Accounting

- Items are the same records in Accounting and Inventory; Accounting holds the
  accounts and tax defaults, Inventory holds quantity, cost and reorder.
- Stock movements carry project and location; warehouses point at accounting
  locations.
- Manufacturing issues and receipts are stock movements, so inventory value changes
  follow production.
- Assets use the accounting locations and will post to asset, depreciation and
  expense accounts when posting exists.
- Nothing posts to the ledger yet: every module carries the contract and says so.

## 116. Audit state

Registers all have search, relevant filters, permanent scroll indicator, counts and
CSV export. Forms open on their own page, validate, and return to their register.

Not yet complete, stated plainly:

- Subcontracting document flow.
- Standard-cost comparison on the costing page.
- Inventory and manufacturing defaults are on their module pages, not yet in Settings.
- Field-by-field form audit across every module is still to be done, and the print
  formats review.
- Posting from operations to the ledger, persistence and permissions remain backend
  work.

---

# Round 22 — print register, module settings, and the audit pass

## 117. Print formats are a register per document

Settings → Print & templates now holds **one row per document** — journal, sales
invoice, purchase bill, receipt, payment, delivery note, goods receipt, stock
transfer, stock count, stock adjustment, work order, bill of material, asset register,
depreciation schedule, party statement, trial balance, financial statements — with
paper size, logo, QR, copies, margin and footer. Rows are editable and new templates
can be added.

## 118. Inventory and manufacturing settings pages

Settings gained **Inventory** (costing method, negative stock, default warehouse,
inventory/issue/adjustment accounts, landed cost, count tolerance) and
**Manufacturing** (material issue policy, BOM requirement, default work centre, scrap,
labour, overhead and WIP accounts, auto-close). They are configuration forms saved for
the session.

## 119. Subcontracting and standard costing

- Subcontract: send components (issue movement) and receive the finished item
  (receipt movement), with a register of documents and their status.
- Costing shows **standard** (item purchase price × quantity) and **variance** against
  actual material plus labour.

## 120. Field gaps closed

Journal external reference; party bank name and account; item barcode; asset serial,
supplier and purchase document; invoice project per line; payment withholding rates
with withheld and net shown. Registers gained the columns where a field matters
(invoice project, payment withheld/net, item barcode, asset serial).

## 121. Audit result

`docs/design/FORM_AUDIT.md` records the full pass. Automated probes render every page
and every editor across Accounting, Settings, Inventory, Manufacturing and Assets with
zero failures. Open items are listed there: per-line invoice tax, withholding
allocation, negative-stock enforcement, ledger posting, template-driven print output.

---

# Round 23 — currencies, reconciliations, header filters

## 122. Currency is a choice, not free text

- `CURRENCIES` holds the primary currency and the allowed list.
- Settings → Company now chooses the **primary currency** and the **allowed
  currencies** from a list.
- The cash/bank form and the party form use a currency dropdown; when the currency is
  not the primary one an **exchange rate to the primary** is required.
- Every record stores the currency and the rate it was entered at, while balances stay
  in the primary currency. The rule extends to documents as they are connected.

## 123. Reconciliations are records, not an auto-matcher

Two new pages, one for cash and bank and one for parties.

**Form**: choose the sub-account (or party), the date, and the system shows the
closing balance at that date. Add difference rows (reason, reference, amount), enter
the **original balance** from the statement, attach supporting files, and save.

**Result**: `unreconciled = original − (system + differences)`. Zero means
reconciled; anything else stays visible with its amount.

**Registers** list date, account/party, system balance, differences, original,
unreconciled and state; each row prints, and the whole register prints.

## 124. Excel-style filters in the ledger header

The general ledger has a second header row: date from/to, account, description and
party text filters, and selects for project, location, cost centre, voucher type and
party type. They sit under the column they filter, complement the sort arrows, and
the existing top bar still holds the multi-select filters and reset. This is the trial
layout before making it the standard for every table.

## 125. Dropdowns that no longer fall off the page

The multi-select panel now flips above its trigger when there is not enough room
below, and caps its height to the available space with an inner scroll. This fixes the
clipped dropdowns in the cash/bank and party forms.

## 126. Cash & bank filters completed

Added a **location** filter alongside search, kind, control head, status and balances
as at.

---

# Round 24 — ledger filters live in the headers

## 127. What stays on top, what moves to the header

- **Top bar** keeps the universal, data-level filters: the date range, the free-text
  search, **Reset** and the column chooser.
- **Header row** now carries the per-column filters and the sort. Every column gets
  its own filter box, and every header is sortable.

Why: the per-column filters are generated from the column list itself. When a form is
amended and a new field is added to the register, its column appears with its filter
and its sort automatically — no new top-bar component is required for each field.

## 128. Implementation

- `colValue(row, key)` maps a column key to the value that column shows; sorting and
  filtering both use it.
- Filters live in `GL.cf` keyed by column; the register filters its rows with a
  substring match on the mapped value, so text, numbers, party, project, location,
  voucher, subtype and new fields all behave the same.
- Every header is a sort button; the sort arrow shows the current key and direction.
- The old dimension multi-selects were removed from the top bar; the party shortcut
  from the party register still sets the party filter directly.

## 129. Header filter UI

The filter row is compact: 26px inputs, one per column, aligned under the header, no
date controls in the header (the date range stays on top). The table keeps its
permanent scroll indicator above the rows.

This is applied to the general ledger first. Once approved it becomes the shared
pattern for every register.

---

# Round 25 — reconciliation is a tab, and the form works

## 130. Reconciliation lives inside its page

The separate rail pages are gone. **Cash & bank** and **Parties** each have two tabs:

- **Register** — the accounts/parties.
- **Reconciliation** — the register of reconciliations for that page, with its own
  **New reconciliation** button.

Opening a reconciliation uses the same page with the editor (`tab=cash|parties`,
`form=recon`), and saving returns to the Reconciliation tab.

## 131. The form actually works

- Choosing the account/party **re-renders and pulls the system closing balance** for
  the date; changing the date pulls it again.
- Differences are **rows you add and remove**, not a fixed three.
- The summary (system, differences, original, unreconciled) updates **as you type**
  the amounts or the original balance.
- Supporting files are chosen through a proper button and listed with a remove action.
- Save stores every difference, the system and original balances, the unreconciled
  result, the files and the state; Print prints the document or the register.
