# Session checkpoint — 28 November 2026

**Scope:** the fixture accounting UI on branch `opencode/design-theme-v1`, worktree
`/home/esc/saven/wt-design-theme`. This is a design/session build. It does **not**
change `main`, the live native app, the database schema, production configuration or
any client data. Reload returns the fixtures.

Read this after `CONTEXT_HANDOFF.md` and before changing the tax workflow. It records
the owner requirements, the implemented behaviour, the exact code locations, the test
evidence and the remaining gaps so a compacted session can continue without guessing.

## 1. Source state

- Branch: `opencode/design-theme-v1`.
- Latest application commits before this documentation checkpoint:
  - `c8d5bcd` — default the tax-entry date to today after future dates were blocked.
  - `2ab7f5b` — align every account group with its six-digit group segment.
  - `eca93d2` — six-digit demo chart, filing-date guard, richer sample data and rules.
  - `77c5cd1` — remove the stale “combined” tax-entry subtitle.
  - `bf4a9ea` — adjustment supports all six tax natures; authority/offset follow the
    nature; generated module pages regenerated; round 65 recorded.
  - `08ab592` — three entry types, final sales tax closing, final sales payable
    control, effective/filed dates, sample June/July tax data, initial tax controls.
- The chart/filing/data increment is committed as `eca93d2` and the group alignment as
  `2ab7f5b`. This documentation checkpoint follows them; the final documentation commit hash is visible in `git log`.
- Live preview: <https://savenuitest.economicsystems.cc>. Local:
  `http://savenuitest.localhost:8795/`. The preview server serves the working tree
  directly; reload after changing a module. This is not a production deployment.
- Tax entry test route:
  `http://savenuitest.localhost:8795/#module=tax&tab=adjustments&mode=editor&form=entry`.
  The form defaults to Adjustment; choose Withholding payment or Closing in the first
  field.

## 2. Owner requirements retained from the 27–28 November review

These are explicit owner instructions. Do not silently change them.

- Prices are always **tax-exclusive**. There is no inclusive-price mode.
- Accounting heads are only **asset, liability, equity, income, expense**. Accounting
  groups tag accounts for statements.
- The Tax module pages are **Rules, Authorities, Tax ledger, Parties, Tax entry,
  Default accounts**.
- Authorities are global, multi-nature records. There is **no jurisdiction field**.
- Rules are system-numbered, support several item groups or several items, and block
  overlapping specific scopes. A rule carries no authority or account.
- Tax entry has exactly **three clear windows**:
  1. **Adjustment**
  2. **Withholding payment**
  3. **Closing**
- Adjustment must work for **all six tax natures**, for the amount the user chooses, at
  the date the user chooses. The remaining balance carries forward. It must not force a
  full settlement.
- Closing has three kinds: **Sales tax return**, **Final sales payment**, **Income tax
  closing**. Withholding payment is a separate entry type, not a closing kind.
- Sales tax closing uses this owner example:
  - output balance 34, input balance 14, advance sales tax already paid 10;
  - expense/subtotal is 20, payable is 10;
  - entry: **Dr output 34 · Cr input 14 · Cr advance sales 10 · Cr final sales payable
    10**.
  - It is not a sales-tax expense. The payable is a control account because the
    authority and the party/dimension must be identified and later paid.
- **202006 Final sales tax payable** is a control account with authority sub-accounts and
  a party or **Unallocated** dimension. **102006 Final sales tax receivable** handles a
  negative net. The Authorities and Parties pages each gained a seventh tab for final
  sales tax payable.
- **202007 Income tax payable** is non-control. A business has a single income tax
  authority. **503001 Income tax expense** is the expense target. Closing applies open
  advance income tax to 202007 or 503001; the remainder carries forward.
- Closing asks for both dates:
  - **period end / effective date** — the date the balances are zeroed and the negative
    entries are dated, e.g. 30 June;
  - **filed on** — the actual filing date, e.g. 5 July.
  - A party with 50 at the current date, of which 35 accumulated to 30 June, closes 35
    effective 30 June and shows 15 after that date. July activity is not touched.
- Withholding payment is a separate **bank/cash payment**, not a period-specific offset
  against output or input.
- Healthy synthetic June/July 2026 data and the required accounts must exist before the
  logic can be tested.
- No unverified client onboarding, destructive data change or claim of real ledger
  posting. The UI is a session fixture.

## 3. Implemented behaviour

### 3.1 Adjustment

- The nature dropdown contains the six natures: input, output, advance income, advance
  sales, withholding income, withholding sales.
- Changing the nature:
  - rebuilds the authority list from **active authorities that handle that nature**;
  - selects the nature default when the current authority is invalid:
    FBR for input/output/advance income/withholding income, SRB for advance
    sales/withholding sales;
  - changes the default offset with the control side:
    - **503002 Tax adjustment expense** for input, advance income, advance sales;
    - **403001 Tax adjustment income** for output, withholding income, withholding sales;
  - preserves a manually chosen offset.
- The custom dropdown is a wrapper around the native `<select>`. Programmatic value
  changes dispatch `change`, so the visible label and the underlying value cannot
  disagree. This was the cause of the “stuck on 503002/input” appearance.
- Entry lines are built by `taxAdjustmentEntry(kind, party, direction, amount,
  offsetAccount, authority, offsetSub)`:
  - asset nature, decrease: Dr offset / Cr control;
  - asset nature, increase: Dr control / Cr offset;
  - liability nature, decrease: Dr control / Cr offset;
  - liability nature, increase: Dr offset / Cr control.
- The control line carries the authority name and the party or `Unallocated`; the offset
  line carries the party or bank/cash sub-account.
- The register row shows date, `ADJ-2026-0001`, entry type, nature, party, authority,
  period, amount, offset/target and reason. A row expands to the illustrated entry.
- The adjustment offset cannot be a tax control account. If the offset is a bank or cash
  control, a sub-account is required.

### 3.2 Withholding payment

- Natures: withholding income, withholding sales.
- The authority must handle the selected nature.
- The amount is blank = all open, or a chosen partial amount.
- Pays FIFO by entry date, creates negative tax entries per source party/period, and
  debits the withholding control / credits the selected bank or cash sub-account.
- A remainder stays open.
- The entry is recorded in `TAX_CLOSINGS` with `kind: 'withholding'`.
- It is not period-specific and is not offset against output tax.

### 3.3 Sales tax closing

- Authority must handle input, output, advance sales and final sales.
- The closing uses **net control balances after adjustments**, not the gross positive
  entries:
  - `input = min(open input, net input balance)`;
  - `output = min(open output, net output balance)`;
  - `advance = min(open advance sales, net advance sales balance)`.
- A negative net control balance blocks the closing; adjust it first.
- It closes all open entries dated on or before the effective date.
- `net = output - input - advance`.
- Entry:
  - Dr output control;
  - Cr input control;
  - Cr advance sales control;
  - if net > 0: Cr **202006 Final sales tax payable** (party `Unallocated`, authority) or
    Cr bank/cash when “pay now” is ticked;
  - if net < 0: Dr **102006 Final sales tax receivable** or Dr bank/cash when paid.
- Negative tax entries are generated per allocation, so party and authority balances
  fall to zero from the effective date while the original entries remain.
- The closing record stores `effectiveDate`, `filedOn`, `reference`, `amounts`,
  `allocations`, the GL entry and an optional `finalEntry` tax entry for 202006/102006.
- When not paid immediately, the final payable is paid by the separate **Final sales
  payment** closing:
  - Dr 202006 Final sales tax payable;
  - Cr bank/cash.
- `TAX_CLOSING_ACCOUNTS` holds the account choices: `finalPayable: '202006'`,
  `finalReceivable: '102006'`, `incomeTaxPayable: '202007'`,
  `incomeTaxExpense: '503001'`. Default accounts can change the first two and the income
  tax targets for the session.

### 3.4 Income tax closing

- Authority must handle advance income tax.
- Amount is blank = all open, or a chosen partial amount; it cannot exceed the open/net
  advance.
- Entry: Dr selected 202007/503001 target · Cr advance income tax control, authority.
- The remainder carries forward. It is not a full income-tax return computation.

### 3.5 Dates, parties and balances

- All closing entries and negative tax entries use the effective date.
- `filedOn` is retained separately and shown in the register.
- Party balances are the sum of entry amounts for a party/nature, filtered by the
  as-at date. A full closing removes the current party row; the same party still appears
  at an as-at date before the close.
- Authority balances are the sum for an authority/nature. The final sales tab uses the
  202006 control and `Unallocated` pooled party.
- `Unallocated` is a system party, not a customer or supplier.

### 3.6 Sample data and accounts

The tax ledger now contains **193 entries** across all six natures, three authorities
(FBR, SRB, PRA) and January–November 2026:

- **SRB June:** output 20,000 + 14,000 = 34,000; input 8,000 + 6,000 = 14,000;
  advance sales 6,000 + 4,000 = 10,000. This exact closing test is preserved.
- **SRB July:** output 5,000; input 2,000; advance sales 1,000.
- **FBR and PRA** cover every month January–November, including advance income/withholding
  income and advance sales/withholding sales.
- **SRB activity resumes in August–November**, so the June 34/14/10 example stays clean.
- **Six seeded adjustments** `ADJ-2026-0001` to `ADJ-2026-0006` cover input, output,
  advance income, advance sales, withholding income and withholding sales.
- **Eight tax rules** cover all six natures, including specific `Services` and
  `Packaging` group scopes.
- The demo chart has **40 six-digit accounts**, including fixed assets, accumulated
  depreciation, WIP, raw materials, labour clearing and overhead applied. Every code's
  group segment matches its seeded accounting group; the Chart page shows the group
  name, not the head.

Key accounts:

| Code | Account |
|---|---|
| 104001 | Recoverable input tax |
| 202001 | Output tax payable |
| 102002 | Advance income tax receivable |
| 102004 | Advance sales tax receivable |
| 202005 | Withholding tax payable |
| 202002 | Sales tax withheld |
| 202006 | Final sales tax payable (control) |
| 102006 | Final sales tax receivable |
| 202007 | Income tax payable (non-control) |
| 503001 | Income tax expense |
| 503002 | Tax adjustment expense |
| 403001 | Tax adjustment income |

No four-digit demo account code remains. The chart register, account form, journal
defaults, bank controls, tax defaults and fixture ledger all use six digits.

## 4. Code map

| File | What matters |
|---|---|
| `docs/design/save/ui/screens.js` | `TAX_KINDS`, `TAX_AUTHORITY_KINDS`, `TAX_CLOSING_ACCOUNTS`, `TAX_NATURE_META`, `TAX_DEFAULTS`, `TAX_DEFAULT_AUTHORITIES`, `TAX_OPENING_ENTRIES`, `TAX_ADJUSTMENTS`, `TAX_CLOSINGS`, `TAX_ADJUSTMENT_OPEN`; `taxAdjustmentEntry`, `taxControlAccount`, `suggestedOffsetAccount`, `netTaxBalance`, `openTaxEntries`, `allocateOpen`; `buildSalesClosing`, `buildWithholdingClosing`, `buildFinalSalesPayment`, `buildIncomeTaxClosing`; `taxEntryEditor`, `syncAdjustmentAuthority`; `taxEntryPanel`, `taxAuthoritiesPanel`, `taxPartyBalancesPanel`, `taxDefaultsPanel`; `taxEntries()` composes invoices, fixture documents, opening entries, returns, adjustments, legacy settlements and closings |
| `docs/design/save/ui/accounting-model.js` | 40-account six-digit chart, including tax, final sales, income tax, fixed assets and WIP; fixture ledger |
| `docs/design/save/ui/accounting-ui.js` | editor route metadata for `taxes` / `entry`; six-digit account-code pattern; journal guard that blocks tax control lines and points to Tax → Tax entry |
| `docs/design/save/ui/pages-map.js` | Tax page labels and descriptions |
| `docs/design/save/ui/screens.js` `enhanceSelects()` | native select plus visible `.ss` trigger; the native select keeps the value, the visible label must be synced on programmatic changes |
| `docs/design/TAX-PERIOD-CLOSING.md` | closing design, effective/filed dates, balances, remaining period model |
| `docs/design/CHART-OF-ACCOUNTS-DESIGN.md` | chart, final sales controls, target mapping |
| `docs/design/DECISIONS-2026-11-21.md` | decisions; rounds 64–67 cover this flow |
| `docs/design/SYSTEM_LOGIC_MAP.md` | page map and pending work |

Legacy: `TAX_SETTLEMENTS` and `TAX_SETTLEMENT_SEQ` still exist and `taxEntries()` reads
them, but the current Tax entry form does not create them. They are retained history from
the earlier combined-settlement UI. Do not revive them without a decision; the three
entry types are the current contract.

## 5. Verification performed

Commands:

```text
node --check docs/design/save/ui/*.js                  # all pass
node docs/design/build/make-page-docs.mjs              # 21 modules, 154 pages, 68 built
python3 tools/build_design_library.py                  # 269 requirements, 25 modules, 282 mappings
node docs/design/build/annotate-inventory.mjs          # 282 screens; PLANNED 267, IN_BUILD 15
node docs/design/build/make-catalog.mjs
python3 tools/build_feature_catalog.py                 # 269 requirements
python3 tools/validate_plan.py                         # PASS
git diff --check                                       # clean
```

Behaviour probes (temporary pages under `docs/design/save/`, deleted after the run):

- All six natures selected through the visible custom dropdown, then saved:
  input, output, advance income, advance sales, withholding income, withholding sales.
  Result: 6 saved, 6 register rows, no errors, no `undefined`.
- Authority and offset after switching:
  - input: FBR / 503002;
  - output: FBR / 403001;
  - advance income: FBR / 503002;
  - advance sales: SRB / 503002;
  - withholding income: FBR / 403001;
  - withholding sales: SRB / 403001.
- The custom trigger text was checked, not only the hidden native value: output read
  “Output tax” and “403001 · Tax adjustment income”; advance sales read
  “Advance sales tax”, “SRB — Sindh” and “503002 · Tax adjustment expense”.
- June sales closing for SRB: output 34,000, input 14,000, advance sales 10,000,
  net final payable **10,000**. `CLS-2026-0001` appeared in the register. Authority final
  sales tab showed 10,000; final sales payment cleared it to 0.
- Partial adjustment test: 1,000 input adjustment before closing changed the final
  payable to 11,000 and left the residual party/Unallocated detail visible; the control
  closed to zero net.
- June effective-date test: the tested input party balances zeroed at 30 June while
  July activity remained visible at 31 July.
- Withholding payment cleared the sample withholding income; income tax closing applied
  3,000 of advance income and left 1,000 carrying forward.
- “Pay now” sales closing credited bank/cash instead of 202006 and left the final payable
  at zero.
- General journal blocks tax control lines.
- The chart register shows 40 of 40 accounts, all six digits, no four-digit code in the
  register. The new-account form pattern is `[0-9]{6}` with maxlength 6.
- Filing guard: `2026-07-31` period end with `2026-07-05` filed-on is rejected with
  “Filed-on date cannot be before the period-end date”; a future period end is rejected;
  a future filed-on date is rejected; income-tax closing uses the same guard. Valid
  `2026-06-30` / `2026-07-05` saves the 10,000 June closing.
- The tax ledger has 193 rows across all six natures; the Rules page has 8 rules and the
  Tax entry register has the six seeded adjustments. Trial balance and statements remain
  balanced with the six-digit chart.
- Tax pages render with no `undefined`; Authorities has 7 tabs and Parties has 7 tabs.

These are fixture/session checks, not posted ledger entries.

## 6. Known gaps

- No tax period snapshot, filing state, hard lock or annual carry-forward. The closing
  records exist; the period model in `TAX-PERIOD-CLOSING.md` is still a proposal.
- No real ledger posting; tax vouchers and negative entries are session data and reset
  on reload.
- No final sales tax **receivable/refund payment** flow. A negative net goes to 102006 and
  stops there.
- Final sales payable uses the pooled `Unallocated` party; it is not allocated to
  customers because a net authority liability is not naturally one customer’s balance.
- No full income-tax return computation; income tax closing only applies open advance
  income to 202007/503001.
- No cancel/reverse/delete for tax vouchers, no approval/evidence workflow, no return
  import or acknowledgement attachment.
- Adjustment covers the six tax natures, not `final_sales` (202006/102006) directly.
- Automatic per-item-group rule resolution on every document is not complete; rules
  are configured and conflict-checked, but invoice lines still use the item/default tax
  path.
- Multi-currency, FX, penalties/interest, tax authority statement import and actual
  filing integration remain out of scope.
- `TAX_SETTLEMENTS` is legacy/unused by the current form.
- The demo chart is fully six-digit; a real production chart/data migration is still a
  separate controlled gate with backup, reconciliation and explicit authorization.

## 7. Next actions

1. Owner review of the tax flow, especially the all-six adjustment form, the
   sales-close/final-payment sequence, the six-digit chart and the filing-date guard.
2. Then choose the next tax increment:
   - period snapshot + lock + annual carry-forward; or
   - final sales receivable/refund flow; or
   - adjustment of 202006/102006 if the owner asks for it.
3. If a new nature is added, update all of:
   `TAX_KINDS`, `TAX_AUTHORITY_KINDS`, `TAX_NATURE_META`, `TAX_DEFAULTS`,
   `TAX_DEFAULT_AUTHORITIES`, sample entries, closing builders, authority/party tabs,
   page descriptions and these docs.
4. After every change: `node --check`, both generators, plan validation, a real DOM
   probe for the six natures/closing, `git diff --check`, commit and push.

## 8. Resume order

1. `AGENTS.md`.
2. `docs/design/CONTEXT_HANDOFF.md`.
3. This file.
4. `docs/design/SYSTEM_LOGIC_MAP.md` (pages and pending).
5. `docs/design/DECISIONS-2026-11-21.md` rounds 64–67.
6. `docs/design/TAX-PERIOD-CLOSING.md` and `docs/design/CHART-OF-ACCOUNTS-DESIGN.md`.
7. Inspect `git status`, the fresh branch head and the live page before editing.

Do not merge this branch to `main`, deploy through the native pipeline or call the
fixture a posted ledger. The branch is a design review build.
