# Payments workspace and reference lifecycle

Part of ACC-006, ACC-004, ACC-011, ACC-018, SAL-007 and PUR-006. This is a separate operating workspace, sharing the posting kernel with accounting. It is not completion of all payment, sales, purchasing or banking requirements.

## Supported lifecycle

Receive or pay money against a customer, supplier or other party. Capture the bank/cash account, method, instrument/bank reference, date, purpose and supporting files. One customer receipt or supplier payment may allocate amounts across up to fifty posted invoices/bills or supported opening positions for that same party and basis. Posting does not recognize the original revenue/expense again.

Any excess ordinary customer receipt becomes a customer advance liability. Excess supplier payment becomes a supplier advance asset. The two protected mappings are created for existing and future companies without posting balances. These advances do not alter invoice control balances until applied.

An advance application identifies prior posted advance sources and unpaid invoice references. Both sides must total exactly. It reclassifies advance value into the relevant receivable/payable control without posting cash/bank again. The original payment and bank reference are retained. Customer advance refunds and supplier advance recoveries consume identified available sources; they cannot consume an unposted or exhausted advance. Other-party cash movements use an active general account, for example an expense, loan or contribution, with the party recorded.

Invoice allocation capacity and advance-source capacity include pending consumers. PostgreSQL uses the shared company lock and durable reference rows to prevent concurrent over-allocation. Rejecting a pending application releases its capacity while retaining its history. Posted original records and their reference rows are immutable. Correcting already posted allocations needs its governed unreconciliation/reallocation workflow; ordinary deletion is not supported.

Receivable/payable ageing, party control statements and close review include the new allocations. Statements use the relevant actual control-account movement, so multi-invoice payments do not duplicate a payment and advances do not masquerade as invoice settlement. The payment register searches across stored records with date/party/reference filters and pagination. Complete matching CSV export is independent of the page and retains party, direction, method, bank reference, allocations and source references.

## Independent expected scenario

Customer invoices 100 and 60, followed by receipt 200 allocated 160, leave advance 40. A later invoice 30, application 20 and advance refund 10 leave AR 10 and customer advances 10.

Supplier bill 100, payment 150 allocated 100, later bill 40, advance application 30 and advance recovery 5 leave AP 10 and supplier advances 15. Paying an other-party expense of 15 makes bank 30, assets 55 and profit 35. The balance sheet agrees. Advance application journals must contain no bank line.

Native tests also cover competing claims, rejection and release, reference visibility, company boundaries, factory owner authority and policy-authorized direct refund posting. Check BUILD_STATE for actual server and hosted evidence before treating deployment as verified.

## Required remaining depth

Current supported money is PKR. This workspace records money received/paid; it does not initiate a bank transfer. Foreign exchange, withholding and other deductions, payment discounts/write-offs, paid-invoice refunds, allocation corrections, cheque clearing/status, payment batches, gateway integrations and aggregate/split bank matches remain required. Goods/service-expense and inventory purchase/sale references depend on the corresponding complete operating documents; the current non-taxable service/expense invoice examples do not establish those modules.

The interactive complete workspace currently requires full company resource access. Individual records inherit party/account/reference restrictions. Larger staged reference selection, general imports, finer scoped register views and asynchronous exports remain required. Current commands bound each references/source array to fifty rows and supported reports fail explicitly rather than silently truncating a requested complete export. Existing single-reference legacy receipts/payments retain their document history and sales/purchases access.
