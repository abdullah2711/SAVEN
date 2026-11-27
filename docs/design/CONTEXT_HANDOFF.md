# Design session handoff — SAVEN accounting UI

Paste this file at the start of a new session. It is the whole context.

## What this is

A working design build of the SAVEN/SA7EN accounting UI, served from the owner's
machine. No database, no backend, no posting. Fixtures only. The owner reviews it
through the live tunnel and gives feedback; every decision is recorded here and in
`DECISIONS-2026-11-21.md`.

- Repository: `/home/esc/saven/wt-design-theme`, branch **`opencode/design-theme-v1`**
  (never merge; push to origin after every change).
- App: `docs/design/save/` — the **exact** saventesting build (shell, rail, search,
  theme toggle, dialogs, toasts) plus added screens.
- Library: `docs/design/docs/` — module catalogue, rendered at savenui.
- Live: **https://savenuitest.economicsystems.cc** (app) and
  **https://savenui.economicsystems.cc** (library), through a Cloudflare tunnel
  (`savenui-design`, config `~/.cloudflared/savenui-design.yml`, origin
  `127.0.0.1:8795`, server `~/saven-preview/server.mjs`).

Run locally: `node /home/esc/saven-preview/server.mjs`, then
`http://savenuitest.localhost:8795/`. Host routing picks the root: `Host:
savenuitest.localhost` → `docs/design/save`.

## Hard rules

- The shell is the owner's: do not restyle it. Change screens inside it.
- No inline `style=` attributes: the build's CSP (`style-src 'self'`) blocks them.
  All layout lives in `theme.css` classes. (Exceptions already in the build are the
  design-system's own.)
- No placeholder copy ("sample", "design example"). Real values only.
- Money: decimal, two places, right-aligned and tabular. Dates ISO in data, short in
  tables.
- Every figure must derive from the fixture; if it cannot, say so on screen.
- Document decisions as they are made (this folder). The docs are the contract.
- Never claim a fixture behaviour is production functionality.
- Chat attachments cannot be read from this session. Files must be placed in the
  repository, or their markup pasted as text. The two supplied Flaticon glyphs
  (print, vertical menu) now live in `docs/design/save/ui/icons/` and are inlined
  in `ui/icons.js`; attribution is in `docs/design/ASSETS.md`.

## Where things live

**Start with `SYSTEM_LOGIC_MAP.md`** — it maps the pages, the rules, the conflicts and
the decision index in one place.

| Path | Contents |
|---|---|
| `docs/design/save/ui/app.js` | shell, rail, routing, page map wiring |
| `docs/design/save/ui/accounting-ui.js` | chart, journal register/editor, trial balance, statements, setup routing, single-select picker (`ss`) |
| `docs/design/save/ui/ops-model.js` | warehouses, stock movements, BOMs, work orders, work centres, asset categories and assets |
| `docs/design/save/ui/inventory.js` | inventory module: views, forms and binds |
| `docs/design/save/ui/manufacturing.js` | manufacturing module |
| `docs/design/save/ui/assets.js` | assets module |
| `docs/design/save/ui/accounting-setup.js` | opening balances, recurring journals |
| `docs/design/save/ui/screens.js` | dashboard, ledger, journal register + record, projects/locations pages, parties, taxes, setup, multi-select (`ms`) |
| `docs/design/save/ui/accounting-model.js` | fixture ledger (~199 documents), chart, numbering, projects, locations, cost centres |
| `docs/design/save/ui/pages-map.js` | module → page map, single source for rail and docs |
| `docs/design/save/ui/theme.css` | their stylesheet plus our component classes at the end |
| `docs/design/*.md` | decision log, module map, workflows, backend contract, forms/views, page register |

## Chart of accounts — groups built, six-digit codes still target

Read `docs/design/CHART-OF-ACCOUNTS-DESIGN.md` before touching the chart. Six-digit
codes `D GG AAA` are the target; groups are tagged in Chart of accounts → Accounting
groups; one AR and one AP control; controls for
cash, bank, inventory, fixed-asset cost/accumulated, advances and clearing; **no sales
control**; statistics from line dimensions and subledgers. Tax has one control per nature
(input, output, advance income, advance sales, withholding income, withholding sales)
with tax authorities as **sub-accounts**, not separate controls. The Tax module pages
are Rules, Authorities (six tabs), Tax ledger (all tax entries), Parties (six
party-balance tabs), Tax entry (adjustment/closing vouchers) and Default accounts
(accounts, authorities and calculation basis). Prices are always tax-exclusive.
Rules apply to all items (fallback), several item groups, or several specific items;
specific scopes must not overlap for the same nature and effective period. Tax entries
open their document; party tax balances are reconciled by party/kind without a tax
sub-account. Party tax claims are dimensions
on tax entries, reconciled against authority data and certificates. The demo four-digit
chart is to be replaced and fixtures remapped.

## Current state

**Built and working**

- Accounting dashboard: KPI cards, cash chart, ageing, attention list, recent
  journals.
- General ledger: multi-select filters with search in every dropdown, column
  chooser, sorting, row expand, CSV, and a totals strip above the table (lines
  shown, total debit, total credit, and a net figure labelled net debit or net
  credit depending on the side).
- Journal register: columns mirror the form, filters, sorting; a row opens the
  journal form. Drafts are editable, posted entries are read-only with
  cancel/duplicate/delete.
- Journal form: auto-numbering (`JV-MM-YYYY-0001`), posting time, guards (no future,
  no date before business start, no closed period), subtype, one **header location**,
  party/sub-account filtered by account kind, project, cost centre, review panel,
  evidence drop zone, print + overflow menu, always-visible horizontal scroll track.
- Cash & bank: register of sub-accounts with balances and a create form carrying the
  allowed projects and locations.
- Items: register and create form with income/expense heads, tax default and tracked
  flag.
- Chart of accounts: group totals, per-head closing balance (Dr/Cr), control badges.
- Trial balance: totals strip, formatted amounts, drill to the ledger.
- Reports: ageing, profit & loss, financial position, cash flow, equity.
- Taxes: Rules (system-numbered), Authorities (six natures), Tax ledger, Parties (six
  party-balance tabs), Tax entry (adjustment/closing register and form) and Default accounts
  (six control accounts, six default authorities and the calculation basis). Prices are
  tax-exclusive.
- **Settings** is a separate module with seven pages: Company, Accounting,
  People & access, Periods, Forms & fields, Saved views, Print & templates.
  Accounting holds numbering, control accounts, projects & locations and approvals.
  Tax rules, authorities and tax default accounts live in the Taxes module.
  Accounts and accounting groups live in the Chart page; heads are the five classes.
- **Parties**: register and party page. Party numbers are system generated
  (`Party-0001`), the group comes from Settings party groups, the control account is
  restricted to receivable heads for customers and payable heads for suppliers,
  terms and credit limit are optional and their changes are logged. An opening
  balance posts an opening journal against 3100 Opening balance equity, keyed by
  party code so an edit replaces rather than duplicates it.
- **Reconciliations**: cash and party tabs each have a register (search, dates,
  column menus, click a row to open) and a form whose difference rows use the full
  width. Saved records can be cancelled (stay with a badge) or deleted.
- **Advances**: register of customer advances received and supplier advances paid,
  separate ADV vouchers, and an adjustment panel that applies an advance to one of
  that party's open documents. Applications reduce both balances.
- **Payments**: register with From/To, search and the common column menus. The form
  settles named invoices or bills: one row per document with the method
  (bank transfer, cheque, cash), the matching cash or bank sub-account, the system
  outstanding and an editable amount, so partial, full and combined settlements are
  all possible. Methods are bank transfer and cash only; a cheque is deposited or
  cashed, not a third channel. A settlement reduces the invoice register's Paid and
  Balance. No tax fields and no header reference. Receipts are numbered
  `RCPT-MM-YYYY-0001` and payments `PAY-MM-YYYY-0001` in separate series.
- **Sales invoices and Bills**: main and returns registers with search, dates and the
  common column menus; rows open the document. The form uses one description and a
  location, item-based rows (item, account, project, qty, price, discount, total, tax %
  and total after tax), totals under the columns (original, discount, net, tax and
  invoice total), gross receivable/payable, withholding rows
  (type, rate or custom, basis, amount), net due after withholding, optional record
  payment rows with total and difference, evidence, and a balanced illustrative entry.
  With a recorded payment, a second preview shows the separate receipt/payment voucher
  entry. Session documents are editable; fixture documents open as complete read-only
  documents with line and withholding detail derived from the posted ledger.
- **Period close**: checklist, sign-off and a session lock shared with Settings →
  Periods.
- Supplied print and vertical-menu glyphs wired into the journal header.
- Every accounting `<select>` is enhanced into one dropdown component: the native
  select keeps the value, validation and FormData, while the visible control and list
  are ours (chevron, tick on the current option, a search box on every list,
  placement capped to the room above or below the field). Scrolling inside the list
  does not close it; a page scroll or window resize does. The shell top bar and
  dialogs stay native.
- Every master-data form is create-or-edit with an Edit action per row; every form
  carries its full field set (see decision log round 11). Settings custom fields
  show on the journal More info tab.
- Registers and forms are separate pages: `mode=editor&code=…` opens the form, Save
  returns to that register, and “Back to register” respects the page. Journal, cash &
  bank, parties, items, tax rules, payments and invoices all work this way. The journal
  register also exports CSV; a GL row opens the document it belongs to.
- Every register has instant search and its own filters. The ledger, journal, party
  and reconciliation registers share one pattern: a top bar with text search, the
  relevant date (From/To, or balances as at) and reset, plus a per-column menu with a
  single sort toggle, value search, select all/clear, checkbox values and **Apply
  filter**. Type, status and balance live in the column menus, not the top bar. The
  state lives outside the page and survives navigation.
- **Taxes** (top-level module; Accounting no longer carries it): **Rules** (system
  number `TAX-0001`, name, nature, rate, several item groups or several items;
  **tax-exclusive** prices, no inclusive mode), **Authorities** (six tabs: input,
  output, advance income, advance sales, withholding income, withholding sales),
  **Tax ledger** (all entries, filterable; a row opens its document or voucher),
  **Parties** (six party-balance tabs with as-at balances and Verified/Unverified),
  **Tax entry** (one form and register for adjustments, closings and combined entries)
  and **Default accounts** (six control accounts, six default authorities and the
  sales-tax calculation basis).
  Rules do **not** carry an authority or account. The control account and default
  authority for each nature are set in Default accounts; an invoice or bill chooses the
  authority for its output/input tax and defaults to that setting. Rules support
  **several item groups** or several specific items. **All items** is a fallback;
  specific group/item rules must not overlap another active specific rule of the same
  nature and overlapping effective dates. A conflict blocks saving and names the rule
  and the overlapping group/item.
  Authorities have a multi-nature register/form (name, registration, frequency, status
  and natures; no jurisdiction) and filters with balances as at a date.
  **Parties → Party balances** has one tab for each of the six natures; each tab shows
  that nature's control account, parties, entries and net tax balance, with a **Balances
  as at** date and Verified/Unverified only. There is no Base column.
  Tax entry has three types: **adjustment** (one tax control against a non-tax account),
  **closing** (settle open tax entries against another tax control or bank) and
  **combined** (adjust, then close). Closing selects open entries by authority/period and
  creates negative settlement tax entries per source, so party/authority balances fall
  to zero while history remains. It supports input↔output offset, withholding payment,
  advance income to income tax expense, advance sales to output or expense, and output
  payment. Bank/cash sub-accounts are selected when the offset is bank/cash. **Unallocated**
  is a system party for authority-level differences; it appears as a row in party
  balances. Authorities are sub-accounts of the tax-nature
  control in the design; the demo derives their balances from tax entries. Party
  balances are reconciled by party/kind without a tax sub-account. All tax registers use
  the standard register top bar and per-column filter menus.
  20 modules and 154 pages mapped; planned pages render their specification.
- **Reports** (top-level module): Revenue (dashboard plus By customer / By item
  registers), Ageing, Trial balance, Profit or loss, Financial position, Cash flow and
  Equity, each a page rather than a tab. Revenue aggregates saved invoice lines by item
  and customer; fixture invoices have no item codes, so item statistics start empty.
- **Items**: the Inventory module is titled Items and its Items page uses the shared
  item master/form; the separate Accounting → Items entry is gone.

**Known gaps**: automatic bank statement matching (the reconciliation is a recording
tool); posting from invoices, payments and tax entries into the ledger; tax period
snapshots, filing state, lock and annual carry-forward (closing entries exist; the
period model is still a proposal in `docs/design/TAX-PERIOD-CLOSING.md`); invoice numbering and
cancelling a saved invoice; per-item-group tax scope; evidence bytes, hashing and
scanning; advances inside the payments form; permissions enforcement; persistence
(reload returns to fixtures).

## Decisions already made (do not re-litigate)

- **Location** is one field on the journal header — where the entry was made. A
  **branch is a location with kind `branch`**; there is no separate branch concept.
  Moving balance between locations is two entries.
- **Project and location are plain data fields**: created in Setup, chosen on the
  journal (project per line, one location per voucher), used to slice reports.
  Accounts stay generic; dimensions never carry a balance. They have no pages.
- **Membership lives on the party or sub-account form** (allowed projects and
  locations, blank = all), not in Setup. Journal order is account → project →
  party/sub-account → cost centre → amount, and the party list follows the account
  kind plus the allowed project and location. Changing project/location clears an
  invalid party.
- **Balances are not sliced by project/location.** P&L by dimension works from
  tagged lines. A control balance can only be sliced from the party/open-item
  subledger, with an unallocated bucket — deferred until that subledger exists.
  Parties and sub-accounts may record which projects/locations they belong to
  (blank = all); it is a data field, not a balance and not access control.
- **No entry type.** A voucher is a journal entry; the **subtype** classifies it
  (bank, cash, contra, expense, debit/credit note, depreciation, accrual,
  prepayment, write off, opening, adjustment, reversal).
- **Every control line needs a party, with no exception.** Adjustment no longer
  bypasses it. Enforced in the line, the review panel, save/submit and the model
  validation.
- **Cancel / delete / reverse.** Cancel removes the ledger effect but keeps the
  register row; delete removes it from the register (draft or cancelled only);
  numbers are never reused; the audit log is the permanent record; reversal is
  optional, used only when the correction must stay visible.
- **Identity fields.** Created by / created at / source (User or AI) and submitted
  by are separate; more than one person may be involved.
- **Accounting heads are the five classes** (asset, liability, equity, income,
  expense). **Accounting groups** are created in Chart of accounts → Accounting groups,
  tagged to accounts and used for statements. Control accounts require a party or the
  appropriate sub-account on every line.
- **Prices are always tax-exclusive.** The line price is net; tax is added. There is no
  inclusive-price mode. The only tax-base policy is the discount setting under Taxes →
  Default accounts.
- **The authority belongs to the document, not the rule.** The default authority for
  each nature is set under Default accounts; an invoice or bill shows that authority and
  can change it. A rule is system-numbered and has no authority field.
- **Parties and Tax entry are separate pages.** Parties has six party-balance tabs; Tax
  entry has the adjustment/closing register and form. Verification is only Verified or
  Unverified. **Unallocated** is the system party for authority-level differences.
- **A tax entry is a separate voucher**, never an edit of the source document. An
  adjustment fixes the tax side by nature (control account, party, authority) and asks
  for an explicit offset account. A closing settles open entries and creates negative
  tax entries per source. The tax control line carries the authority; every line carries
  the party or Unallocated. Tax control accounts are blocked in the general journal and
  must be posted through Tax → Tax entry.
- **Tax balances have three views of the same entries:** the nature control account is
  the total for that nature, the authority sub-account is the total for that authority,
  and the party balance is the total for that party. The six natures are never merged.
- **Business switching happens at sign-in.** The topbar shows the active business as
  text, never a dropdown.
- Posting guards: no future time, nothing before business creation, nothing in a
  closed period.

## How to verify a change

1. `node --check` every edited file.
2. Screenshot:
   `firefox --headless --window-size=1440,1200 --screenshot out.png "http://savenuitest.localhost:8795/#module=accounting&tab=journals&mode=editor"`.
3. For behaviour, build a probe page in `docs/design/save/` that imports the module,
   drives the DOM and prints results into a fixed `<pre>`, screenshot it, then delete
   the probe. This is how the dropdown bug and the setup/membership flows were
   verified.
4. `node docs/design/build/make-page-docs.mjs` after touching the page map.
5. Commit and push.

Known trap: duplicate function definitions silently win (the later one overrides).
Check with `grep -c "function editor"`. Also `grep` for the old identifier after a
rename.

## Next

- Owner is reviewing the data-field treatment of Projects/Locations, the ledger
  totals and Setup heads. Wait for that review before starting another module.
- Open naming question: two rail entries called “Projects” (Accounting dimension page
  and Operations module). Decide whether to rename one.
- Then: parties register (with membership visible on the party page), cash & bank,
  payments, invoices.
