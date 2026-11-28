# Tax period closing and unidentified differences — proposal

Status: **closing entries implemented; period snapshots and lock not.** The Tax entry page
posts adjustments for all six natures, withholding payments and closings, stores
effective/filed dates and closing allocations, and moves sales tax to final sales
payable. Period snapshots, filing state, lock and annual carry-forward remain a
discussion draft.

## 1. What the tax balance is

Every tax entry carries:

```
nature, party, authority, document, taxable base, rate, tax amount, period
```

The same entries are viewed three ways:

- **Control account** — one GL account per nature. It is the total of the nature.
- **Authority sub-account** — the total for one authority inside that control.
- **Party balance** — the total for one party inside that nature. It is a tax-ledger
  dimension, not another GL account.

The six natures are never merged. Input, output, advance income, advance sales,
withholding income and withholding sales each close and carry forward separately.

## 2. Closing is not zeroing

Period close should mean:

1. **Lock** the tax subledger for the period.
2. **Snapshot** opening, entries, adjustments, settlements and closing for each
   authority and nature.
3. **Reconcile** the control, authority and party views.
4. **File** the return with the authority and retain the acknowledgement/evidence.
5. **Settle** the filed amount by payment, refund, credit or write-off.
6. **Carry forward** whatever remains, automatically, into the next period.

A closing journal that simply repeats the balance is not needed. Balances already sit in
the control accounts and carry forward through the ledger. Journals are created only when
value actually moves: payment, refund, credit, write-off, reclassification or correction.

## 3. Nature lifecycle

The policy has to be explicit per authority and nature. A proposed default:

| Nature | Normal side | Carries forward? | Settled by | Annual action |
|---|---|---|---|---|
| Input tax | asset | yes, until claimed/refunded/expired | return claim, inter-nature offset, refund, credit, write-off | review ageing and expiry |
| Output tax | liability | yes, until paid/credited | return payment, inter-nature offset, credit note | final return and payment |
| Advance income tax | asset | yes, until adjusted/refunded | income-tax assessment, inter-nature offset, refund | adjust against annual liability |
| Advance sales tax | asset | yes, until adjusted/refunded | sales-tax return, inter-nature offset, refund | review expiry |
| Withholding income tax | liability | yes, until deposited | deposit/return | final deposit reconciliation |
| Withholding sales tax | liability | yes, until deposited | deposit/return | final deposit reconciliation |

An expired asset is not silently deleted. It is written off or reclassified by an approved
adjustment with a reason and evidence.

## 4. Period close record

A `TaxPeriod` should be one authority + one nature + one date range:

```
authority, nature, from, to, due date
state: open → prepared → filed → paid/settled → locked
```

The snapshot stores:

```
opening balance
period entries (documents, returns)
adjustments
payments/refunds/credits
closing balance
filed amount, filing reference, acknowledgement/evidence
prepared by, reviewed by, locked at
rule/version metadata
```

The snapshot is immutable after locking. Backdated entries are not allowed into a locked
period; a correction is posted in the next open period and linked to the snapshot.

## 5. Reconciliation at close

For each authority and nature:

1. Control account balance from the ledger.
2. Sum of authority sub-account balances.
3. Sum of party tax balances.
4. Authority return/statement figure, if available.
5. Difference, by cause.

Every difference needs one of these treatments:

- **Document/party error** — correct in an open period with a linked adjustment; do not
  edit the posted document.
- **Timing** — uncleared payment, receipt, credit or return; clear it in the next period.
- **Unallocated authority difference** — roundings, opening differences, penalty/interest,
  filing differences not attributable to one party; post to an explicit unallocated row.
- **Write-off/reclassification** — approved adjustment with evidence.

A tolerance (for example 0.01 rounding) can auto-pass only with an audit record and a
named approver. It cannot hide a real difference.

### 5.1 Inter-nature offset and settlement

The six controls stay separate, but a return may legally net one against another. That is
a **settlement journal**, not a merge of balances:

```
Dr Output tax control        claim allowed against output
Cr Input tax control         input claimed in the return

Dr Income tax payable        advance adjusted against the assessment
Cr Advance income tax        advance used
```

The journal is linked to the tax period and return. It does not edit the original tax
entries. Unclaimed input, unused advance or unpaid liability remains in its own control
and carries forward.

A payment or refund is a separate settlement:

```
Dr Output/withholding control   Cr Bank
Dr Bank                         Cr Input/advance control
```

Penalties, interest and fines are not tax control items; they go to their own expense and
payable accounts and are shown beside the tax reconciliation, not hidden inside it.

### 5.2 Actual versus system difference — first classify, then post

Do not post a blind adjustment. The difference must be classified:

1. **Missing document** — enter the invoice, bill, return or payment; then reconcile.
2. **Timing** — uncleared payment/receipt; clear in the next period.
3. **Party error** — adjust the known party with a linked voucher.
4. **Authority-level or unidentified** — use the explicit Unallocated row/suspense.
5. **Penalty/interest** — separate expense/payable, not the tax control.
6. **Rounding** — tolerance with audit and approval.

The closing snapshot records the classification, the amount, the evidence and who
approved it.

## 6. What if the party is not identifiable?

Do not force the difference onto a real party. Add an explicit **Unallocated** dimension:

- The adjustment still carries the nature and authority.
- The party is marked `Unallocated` (a system value, not a customer/supplier).
- The control line carries the authority; the offset account is the selected account.
- The party balance register shows an **Unallocated** row for that nature.
- Then:

```
control = sum of identified party balances + unallocated
```

When the party is later identified, post a second adjustment that moves the amount from
Unallocated to that party. Never edit the first adjustment.

For money received or paid before identification, use a **tax suspense** account or a
dedicated unallocated tax row, not a real party. Clear it when evidence arrives.

Permissions: unallocated adjustments should need a reason, evidence and an independent
review above a threshold.

## 7. Annual close

Annual close is a stricter version of period close:

- Use the authority's tax year, which may differ from the accounting fiscal year.
- File the final return per authority and nature.
- Reconcile control, authority and party views.
- Settle or carry forward each balance according to the nature table.
- Reclassify expired advances or write them off with approval.
- Lock the annual snapshot and open the next year with the closing balances.
- Keep rule versions and effective dates; a rate change does not rewrite history.

Annual close does not merge the six natures and does not zero a balance that still exists.

## 8. UI status for the period model

Built in the fixture UI:

- **Parties** — as-at balances by nature, Unallocated row, Verified/Unverified.
- **Tax ledger** — every tax entry, including the negative entries created by closings.
- **Tax entry** — adjustment, withholding payment and closing; the register shows all
  vouchers and their entries.
- **Default accounts** — control accounts, default authorities and closing accounts.

Not built:

- **Tax periods** — register of authority/nature periods and states.
- **Tax return/snapshot** — opening, entries, adjustments, settlements, closing,
  difference and evidence.
- **Close checklist** — reconcile, review, file, pay, lock.
- **Reports** — authority reconciliation, party-to-control reconciliation, carry-forward
  and ageing by nature.
- **Permissions** — prepare, review, file, settle, lock, unallocated adjustment.

## 9. Settlement entries and where they are posted

Period-end filings and payments are **settlements**, not one-sided adjustments. They move
two balances and must create the matching tax entries so the control, authority and party
views stay tied together.

### 9.1 Input claimed against output at filing

Example: output tax 200, input tax 100, but only 90 input is claimable.

The current closing does **not** offer a “claim 90 of 100” selector. It closes the net
control balance after adjustments. First post an adjustment for the unclaimable 10
against the appropriate expense or Unallocated row, so the input control net becomes 90.
Then close the authority:

```
Dr 202001 Output tax control       200   Unallocated · FBR
Cr 104001 Input tax control         90   Unallocated · FBR
Cr 202006 Final sales tax payable  110   Unallocated · FBR
```

Tax entries created with the closing:

- output tax decrease 200 (authority FBR);
- input tax decrease 90 (authority FBR);
- final sales payable increase 110 (authority FBR, Unallocated).

The 10 unclaimable input remains visible as the adjustment voucher and its party/
Unallocated detail. If output is less than the claimable input, the closing produces a
negative net and moves it to **102006 Final sales tax receivable**; there is no refund
payment flow yet.

### 9.2 Withholding paid to the authority

Example: withholding income tax payable 50, paid from bank:

```
Dr 202005 Withholding tax payable   50   Unallocated · FBR (or one supplier)
Cr 101002 Bank                    50
```

Tax entry: withholding income tax decrease 50 (authority FBR).

If the payment covers several suppliers, the tax side is Unallocated. If it is one
supplier, use that party. A remaining unpaid amount stays as a liability and carries
forward. This is a deposit/payment, not an expense.

### 9.3 Advance tax applied against the actual tax expense

Example: advance income tax asset 100, annual income tax expense 80.

If the expense has not yet been recorded:

```
Dr Income tax expense             80
Cr 102002 Advance income tax        80   Unallocated or the customer
```

If the expense was already recorded as a liability:

```
Dr Income tax payable             80
Cr 102002 Advance income tax        80
```

The remaining advance 20 stays as an asset, is refunded, or is written off only with
approval. The demo chart now carries **503001 Income tax expense** and **202007 Income tax
payable**. The advance is reduced with the party whose customer deducted it, or
Unallocated if the annual assessment is pooled.

### 9.4 Where these are done

These are posted from the **Tax → Tax entry** page. The form has three entry types —
Adjustment, Withholding payment and Closing — and the Closing type has three kinds:

| Entry type / closing kind | Debit | Credit |
|---|---|---|
| Adjustment (any of six natures) | Chosen offset/expense | Chosen tax control, or reverse |
| Withholding payment | Withholding control | Bank / cash |
| Sales tax closing | Output control | Input control, advance sales, final payable |
| Final sales payment | Final sales payable | Bank / cash |
| Income tax closing | Income tax expense/payable | Advance income tax |

A sales tax closing closes **all open input, output and advance sales** for the authority
up to the effective period-end date. The net is:

```
output - input - advance sales = final payable
```

and it moves to **202006 Final sales tax payable** (control, authority sub-accounts,
Unallocated party) or to **102006 Final sales tax receivable** if negative. Filing date and
effective date are separate: the balance is zeroed from the effective date. The form
rejects a filed-on date before the period end, a period end after today and a filed-on
date after today; the same guard applies to income-tax closing.

The negative tax entries are generated per source party and period, so party and
authority balances fall to zero while the original entries remain for history. Adjustments
remain available for partial changes; the remainder carries forward.

### 9.5 Why the general journal is not the place

The general journal does not know the tax **authority** dimension, and its party picker is
driven by ordinary control flags, not by tax nature. Posting a tax control there would
move the GL balance without creating the authority/party tax entry, so the control would
no longer reconcile to its subledger.

The correct fix is not to loosen the journal. It is to:

1. block tax control accounts from manual journal lines, with a message pointing to
   Tax → Tax entry; and
2. post tax-entry vouchers that create the journal and the tax entries in one operation.

The journal now blocks tax control lines with that message. The Tax entry page creates
adjustment, withholding-payment and closing vouchers.

### 9.6 Multi-period and catch-up filing

A closing uses one **effective period-end date**. It closes all open entries dated on or
before that date. Allocation is FIFO by entry date; every negative tax entry keeps its
source period. Filing January to March in May is one closing effective 31 March; if the
filing needs one snapshot per month, post one closing per month.

Adjustments can be made for any amount and any date before the closing. The remainder
carries forward. A closing does not force a full adjustment; it only closes what the
system still shows as open.

### 9.7 Effective date, filed date and closing selection

The closing form has:

- **Effective period-end date** — the date balances are zeroed and negative entries are
  dated. It cannot be after today.
- **Filed on** — the actual filing date retained on the record. It must be on or after
  the effective date and cannot be after today.

A party with current 50, of which 35 accumulated to 30 June, closes 35 effective 30 June
and shows 15 after that date. July activity is not touched by a June closing.

The sales tax closing computes the entire open input/output/advance sales position up to
the effective date, using the **net control balance after adjustments**, not the gross
positive entries. A partial adjustment therefore reduces the closing amount and the
remaining party/Unallocated detail carries forward; the control itself reaches zero.
The final sales payable control has its own authority tab (**Final sales tax payable**) so
the authority sub-account can be identified and later paid through **Final sales
payment**. A negative net moves to final sales tax receivable.

### 9.8 What “party balance zero” means

The closing creates a negative tax entry against each source entry it settles. Therefore:

- a party whose entries are fully settled has a zero current balance and disappears from
  the current register;
- the same party still appears at an as-at date before the closing;
- the original entries and the negative closing entries remain in the tax ledger.

If an adjustment is posted to **Unallocated**, the unidentified amount remains as an
Unallocated row. The control and authority can still be zero, but the real party rows
cannot all be forced to zero without allocating that difference to a party. That is the
correct representation of an unidentified difference. Allocate it later with a second
adjustment when the party is known.

### 9.9 Withholding and advances

- **Withholding** is paid in cash/bank; it is never offset against output. The amount is
  blank = all open, or a chosen partial amount. There is no period selection.
- **Advance income tax** is applied to income tax expense/payable (202007 or 503001) and the
  advance entries are reduced per customer or Unallocated. The remainder carries forward.
- **Advance sales tax** is part of the sales tax closing:
  `output - input - advance sales = final payable`. It is not a separate offset form. If
  part of the advance is not claimable, adjust that part first; the closing then uses the
  net advance balance.
- **Output tax** is closed into the final payable (202006) or paid immediately from
  bank/cash. **Final sales payment** later pays any remaining 202006.

## 10. Decisions needed from the owner

1. Which natures carry forward indefinitely, which expire, and after how long?
2. Is the tax year the calendar year, the fiscal year, or per authority?
3. Does the system record the authority return manually, import a file, or both?
4. Who may post an Unallocated adjustment, and above what amount is a second reviewer
   required?
5. What rounding tolerance is acceptable, and who owns it?
6. Are tax payments/refunds ordinary payment/receipt documents, or separate tax
   settlement vouchers linked to a period?
7. Should closing be blocked when any party row is still Unverified, or only warned?
8. Do advance income and advance sales expire at the annual close, or continue until
   the authority confirms the claim?

Until these are answered, the implemented UI derives balances from tax entries and posts
adjustment, withholding-payment and closing vouchers, including the final sales payable
and its payment. It does not claim a filed return, a locked tax period, a carry-forward
snapshot or an annual close; those remain the proposal above.
