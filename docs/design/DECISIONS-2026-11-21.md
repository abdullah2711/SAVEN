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
