# Invoice lines, configured taxes and bookkeeping defaults

> Current owner revision: [Accounting-first scope](48-accounting-first-owner-revision.md), [compatible tenant upgrades](49-compatible-tenant-upgrades.md), and [small-action checklist](TASKS.md) govern conflicting sequence and expanded depth. Historical implementation claims below remain dated evidence, not completion of the new scope.

This continuation strengthens core bookkeeping before more Drive, planning, BI or AI work. It does not represent the complete sales, purchasing or tax module. Migration 016 is PostgreSQL schema 14; older single-amount invoices and bills retain their original payload, journal and history.

## Connected behavior

- Customer invoices and supplier bills accept 1–20 described service/untracked-expense lines, quantities to six decimal places, PKR unit prices, percentage discounts to four decimal places, per-line tax selection, invoice date, due date and retained footer. These lines do not receive or sell tracked inventory.
- Each line extends quantity × price, applies its discount and calculates inclusive or exclusive tax, rounding half up at each documented step. BigInt application calculations are independently checked with PostgreSQL numeric arithmetic before immutable line projections are accepted. The preview shows both invoice detail and actual debit/credit effects. Shared authority, permissions, period locks, evidence, revision and idempotency controls apply.
- Sales post receivable against line income and output-tax accounts. Purchases post line expenses and fully recoverable input tax against payable. Payments allocates the gross invoice balance through the existing settlement workflow. No second invoice/revenue or expense is posted on settlement.
- Owners/administrators configure company sales/purchase account defaults, payment days, default inclusive/exclusive price basis and invoice footer. An audited, revision-checked command saves these settings. Defaults are copied into a proposed document; later changes do not rewrite submitted financial snapshots.
- Tax codes specify direction, rate, jurisdiction label, effective dates and output-liability/input-asset account. No statutory percentage is preconfigured. Financial rate/mapping definitions are immutable; create a new code when the financial treatment changes. Archive/reactivate controls affect new previews while preserving prior documents and approval snapshots. Scoped preparers receive only tax mappings they may access.
- The Taxes destination shows configured codes and a posted line register by date, with complete CSV export. A consistent PostgreSQL read snapshot compares invoice-register tax against all selected-period movements in mapped tax accounts. Legacy entries, tax adjustments and payments to authorities can therefore appear as reconciliation differences rather than disappearing.
- Sales and Purchases use a permission-filtered, searchable, dated/status-filtered register with 50 records per page and an explicit total. Reference, description and contact searches cover the full matching register. Complete invoice-line CSV export is independent of screen pagination and fails explicitly above 100,000 lines. Legacy amount-only documents remain in the complete transaction register; the line export clearly identifies its basis. Export cells neutralize spreadsheet formulas.
- Printed document detail includes retained invoice lines and tax totals. Uploaded supporting files continue through the original scanning/linking boundary.

## Independent acceptance

The synthetic arithmetic fixture sells two services at 100 less 10% discount and 18% test tax, plus an untaxed 20 line: net 200, tax 32.40, gross 232.40. Three purchased services at 50 plus the same synthetic percentage give expense 150, recoverable input tax 27 and gross payable 177. With opening bank capital 5,000 and both gross invoices settled, bank must be 5,055.40, input tax 27, output tax payable 32.40, profit 50 and assets 5,082.40. These are test percentages, not advice on an applicable legal rate.

The contract checks exact totals, ledger/report agreement, source retention after archiving, foreign tax-code rejection, audited/replayed settings, register searches, export contents and immutable projections. A legacy amount-only credit against a line invoice is rejected because it cannot correctly reverse its line tax. The native contract chains all preceding accounting, approval, Payments and asset checks before this suite. Record actual deployment/hosted/recovery results in BUILD_STATE; source implementation alone is not acceptance.

## Remaining required depth

Linked line/tax credit and debit notes, paid-document refunds, partial line returns, nonrecoverable/partly recoverable input tax, compound/multiple taxes, withholding at invoice/payment, exemptions/reverse charge, tax-inclusive discount alternatives, foreign currency, tax adjustments and authority settlement, tax returns and statutory filing remain required. The simple configured-rate register is not a statutory tax return.

Quotes/orders/delivery/receipts/matching, tracked inventory invoice lines, landed costs, cost layers, purchase and sales returns, credit control, pricing/price lists, customer statements/reminders, document sequences/custom templates/email and full settings breadth also remain required. Manufacturing is not delivered by this increment. Preserve all original catalog requirements and their acceptance gates.
