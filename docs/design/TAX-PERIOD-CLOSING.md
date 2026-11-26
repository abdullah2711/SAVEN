# Tax period closing and unidentified differences — proposal

Status: **discussion draft, not implemented.** This records the model needed for periodic
and annual tax closing, so the owner can decide the policy before code is added.

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

## 8. UI needed later

- **Parties** — as-at balances by nature, Unallocated row, verified/unverified.
- **Adjustments** — all tax adjustments with party/Unallocated, authority, nature,
  amount, offset account and reason.
- **Tax periods** — register of authority/nature periods and states.
- **Tax return/snapshot** — opening, entries, adjustments, settlements, closing,
  difference and evidence.
- **Close checklist** — reconcile, review, file, pay, lock.
- **Reports** — authority reconciliation, party-to-control reconciliation, carry-forward
  and ageing by nature.
- **Permissions** — prepare, review, file, settle, lock, unallocated adjustment.

## 9. Decisions needed from the owner

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

Until these are answered, the implemented UI only derives balances from tax entries and
shows the reconciliation entry. It does not claim a filed return, a locked tax period, a
carry-forward snapshot or an annual close.
