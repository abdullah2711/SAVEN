# Fixed assets and accounting integration

> Current owner revision: [Accounting-first scope](48-accounting-first-owner-revision.md), [compatible tenant upgrades](49-compatible-tenant-upgrades.md), and [small-action checklist](TASKS.md) govern conflicting sequence and expanded depth. Historical implementation claims below remain dated evidence, not completion of the new scope.

Initial implementation under AST-002, AST-003 and AST-006. The complete AST family remains required. Check BUILD_STATE for source, native, hosted and recovery evidence separately.

## Working lifecycle

An acquisition records the supplier, cost, due date, asset code/name/category, tag, initial location/custodian, in-service date, useful life, residual and ledger mappings. It posts the asset cost and supplier payable together and creates the register projection in the same transaction. The acquisition then appears among supplier balances and can be allocated through the shared Payments workspace. Paying it does not recognize cost again.

Dedicated account uses identify asset cost, accumulated depreciation and depreciation expense. Standard zero-balance mappings are offered when their IDs/codes are available; existing custom codes are not overwritten. Account type/category must agree. Ordinary journals cannot silently post to these controls, and a mapping needed by a pending or active asset cannot be archived. Asset/register and related document access also check mapping restrictions that are not necessarily visible as lines in the current posting.

The first supported depreciation policy is straight line on actual calendar days, from in-service date to the exclusive month-anchored end of useful life. Each cumulative result rounds half-up in integer minor units; an event posts only the difference from depreciation already booked. The final carrying amount cannot fall below residual. The preview shows its coverage and any catch-up charge. A posted or pending competing event prevents duplicate depreciation. Locked periods remain enforced.

A cash sale/scrap event includes depreciation through the disposal date, clears asset cost and accumulated depreciation, records proceeds and posts the exact gain/loss. The cash receipt is also visible in Payments under its actual proceeds; it is not a second bank posting. The source does not create a customer tax invoice.

An unused acquisition can be cancelled through a linked correcting document if it has no posted asset activity or pending/posted supplier settlement. This reverses the acquisition and supplier balance without a bank movement. The original and correction remain; a cancelled unused asset code may be used on a corrected acquisition. Existing settlement/activity requires its proper correction workflow rather than erasure.

## Register and controls

The register has an as-at cutoff, search by code/name/category/tag/location/custodian, retained acquisition and event documents, original depreciation plan, complete matching CSV export and schedule CSV. Its cost and accumulated-depreciation controls reconcile to authoritative GL balances, including in close review. An unexplained control balance is displayed as a difference, not converted into a fabricated asset or balancing plug.

The interactive register currently supports 1,000 assets; larger/staged processing remains required. Register loading aggregates the data rather than issuing a query per asset.

## Independent acceptance example

Start with bank capital 5,000. Acquire equipment on supplier credit for 1,000, residual 100, available 15 January 2026, three-month useful life. Settle the supplier for 1,000 in Payments. The 90-day depreciable interval produces charges of 170, 280, 310 and 140 across the four calendar-month portions. Posting January recognizes 170. Selling on 15 February for 600 adds final depreciation of 150, derecognizes cost 1,000 and accumulated depreciation 320, and recognizes loss 80. Bank/assets finish at 4,600 and period loss is 400. Cost and accumulated-depreciation controls return to zero.

Tests also cover competing depreciation requests, no post-disposal depreciation, unused-acquisition correction, account retirement protection, supplier reconciliation, retained history and current resource/company boundaries.

## Remaining required asset depth

Existing-register opening activation/reconciliation without rebooking, other methods and policies, tax-bearing acquisitions/disposals, WIP/project capitalization, components/splits, partial disposals, impairment, revaluation, useful-life/residual reassessment, approved custody transfers, later-period correction/reversal cases, bulk imports and module-retirement controls remain required. Initial location/custodian fields do not establish a custody-transfer workflow. These gaps are not removed from the commercial requirement catalog.
