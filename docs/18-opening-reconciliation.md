# Opening balances and subledger reconciliation

Implementation under ACC-002, ACC-004, ACC-011 and ACC-018. Source and CI work do not activate the application database. Check BUILD_STATE for observed deployment and recovery evidence.

## Two accounting modes

**New ledger:** supply a balanced trial balance and its receivable, payable and inventory breakdown. The company must have no posted journal and no other pending work. Approval posts one opening journal and creates linked opening subledger records. Those records do not post the control balance again.

**Existing ledger:** supply the detail missing from an existing control balance. The control must equal existing posted open positions plus the new opening positions. Inventory must match its item count/value. Approval links the opening records and preserves existing GL value; it creates no additional journal. A physical count already present is retained, rather than added again.

No balancing plug is created. A mismatch must be corrected or explained in the source data before the snapshot can proceed. Each selected subledger has one approved opening baseline per company. Reimporting it is rejected; later corrections require controlled adjustments, not an overwritten opening.

## Dates and evidence

The snapshot is a **closing balance at the end of its cutoff date**. Subsequent affected transactions begin on the following day. A new-ledger opening protects all earlier dates; a selected existing-ledger reconciliation protects its control-account history. The date must lie in an open posting period at preparation and approval, including existing-ledger mode that creates no journal. Locking the period after submission prevents approval. A previous-day opening may therefore require the owner to establish the corresponding opening period.

Original invoice/bill dates and due dates are preserved, while the opening recognition date remains the cutoff. Historical activity is not invented. Existing posted activity after the selected cutoff prevents the snapshot. Other pending transactions must be resolved first, and a pending opening temporarily prevents new financial submissions.

A company administrator prepares the snapshot. Another authorized person with full resource access reviews it. Retained clean source evidence must be attached before approval; its revision is checked through the normal approval boundary. Root opening data requires full company resource access, and ordinary folder deletion cannot remove its evidence.

## Supported boundary

PKR, positive unpaid customer/supplier positions, and whole stock units at configured fixed opening item costs. Negative party openings, unapplied credits/advances, FX openings, asset registers, batches/serials, fractional units and FIFO/weighted-average receipt layers need their own supported workflows. Reject unsupported data rather than netting different contacts or silently changing cost policy.

Each section currently supports up to 200 rows within a 128 KiB JSON command. Migration references must be unique within each opening party subledger. Full imports reconcile all three control families, including zero balances. Existing-ledger mode may select only the domains being activated. Additional non-zero receivable/payable controls require explicit mapping support before import.

Opening customer/supplier records participate in normal allocated receipts/payments, ageing and statements. Current-year service credits cannot be applied to an opening position without the separate opening-correction policy. Fixed-cost opening inventory less subsequent approved issues can be reconciled historically to its GL control at the selected cutoff; this does not establish a complete stock valuation engine.

## Verification contract

New-ledger fixture: bank 1,000, receivable 300, stock 50, payable 200 and equity 1,150. Approval must create one journal and two linked party positions; five stock units at 10 each become available. Collecting 100, paying 80 and issuing two units must leave AR 200, AP 120, inventory 30, assets 1,250 and period loss 20.

Existing-ledger fixture: the ledger has AR 100 including an already mapped invoice of 20, AP 40 and inventory 30. Import only AR 80 plus AP 40 and the existing three-unit stock count. Approval must leave the journal count and physical quantity unchanged while making all three subledgers agree. The test also checks evidence, separate review, cutoff protection, deferred all-or-nothing completion and temporary-table shadowing of privileged helpers.
