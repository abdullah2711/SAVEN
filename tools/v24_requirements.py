"""Owner's Accounting-first revision; extends scope without retiring old IDs."""
ADDITIONS = {
 'FND': '''
Permanent document lifecycle|Server drafts with optimistic revisions immutable submitted versions retained rejection/return duplicate-as-new and nonreused system numbering across modules|Cancelled voucher two is retained and the next voucher is three; draft saving creates no GL stock or tax effects
Source attribution|Every source and GL row retains preparer actual poster company branch optional project and linked corrections|Filtered reports and exports reconcile and identify the authorized source and actors
''',
 'SAL': '''
Bill and hold custody|Recognized control transfer can precede dispatch with substantive request segregated ready goods and no resale; customer custody is separate from owned stock|Recognize revenue and cost once at supported control transfer then dispatch custody without second revenue cost or owned-stock effects
Multi-source returns|Partial full and multi-invoice goods/service returns consideration refunds or credit notes with linked source and return statistics|Repeat returns cannot exceed remaining quantities values tax or refundable balances across POS and standard sales
''',
 'PUR': '''
Flexible source conversion|Direct quotations orders bills goods receipts and service acceptance with partial before/after invoicing matching|Quotation can become order or bill directly and goods/service documents generate correct reconciled clearing effects
''',
 'TAX': '''
Expected and actual withholding|Separate income-tax and sales-tax withholding expected versus actually deducted accounts configured defaults overrides and linked journal adjustments|Gross settlement equals net cash plus valid deductions and adjustments reconcile certificate tax source and GL at each date
''',
 'CFG': '''
Settings page delegation|One Settings module with named-user or role page grants configured independently of normal business role authority|Direct API calls enforce page grants without granting transaction owner or other protected powers
Immutable print originals|Per-document built-in immutable formats with duplicate-to-custom versioned letterhead image restricted HTML fields margins and defaults|Custom format can omit header footer or selected fields while original remains identical and authorized historical output is reproducible
''',
 'POS': '''
POS profiles and invoice identity|User location product/group payment-method profiles with separate immutable POS invoice series unified filterable selling register and denomination records|Restricted cashier cannot sell excluded products; received and change denominations reconcile to tenders and returns
''',
 'INV': '''
Physical and owned stock distinction|Separate owned inventory customer custody supplier ownership and in-transit positions with GRN GDN invoice links|Physical custody counts and owned stock valuation reconcile without overstating assets or duplicate dispatch posting
Damage and NRV selection|Item warehouse batch or serial damage and separate value-only NRV write-down with supported capped reversal|Physical loss changes selected quantity once while value-only write-down retains units and reversal cannot exceed restored cost
''',
 'AST': '''
Asset lifecycle and identity|System number plus optional custom identity acquisition and later available-for-use date categories common locations individual/group prospective estimate changes revaluation and impairment|Depreciation begins on available-for-use date and schedule GL and carrying value reconcile through all supported changes
''',
 'OPS': '''
Compatible tenant release waves|Explicit schema read/write ranges expand backfill switch contract durable per-file cursors canary waves fencing pause and recovery|Old data and accepted commands survive tested upgrades with measured tenant downtime; no billion-database or zero-outage claim without evidence
''',
 'UX': '''
Expandable module pages|Accounting first then unified Settings then Selling Buying Payments Parties Taxes CashBank Inventory Assets POS; each module expands its focused pages under the sidebar|One selected page loads its authorized real workflow with usable forms document actions and print; crowded hidden-all-pages layouts do not count as completion
'''
}
OVERRIDES = {
 'FND-005':'System-allocated immutable scoped document series with atomic high-water counters; cancellation rejection and correction never reuse a number; external reference is separate',
 'UX-002':'Expandable left-sidebar modules with their subpages beneath; separate Selling Buying Payments Customers and suppliers Taxes Cash and bank Accounting Inventory Assets POS and unified Settings',
 'UX-007':'Build working Accounting first then Settings then linked transactional modules then broader ops and remaining market MVP; use coherent focused registers forms drafts review evidence and print',
 'CFG-007':'Immutable standard print formats per document type; duplicate/create custom version with logo letterhead restricted HTML/image headers footers field/column toggles paper margins and default selection',
 'TAX-003':'Separate income-tax and VAT withholding at invoice-time or later payment; expected versus actual balances defaults overrides certificates partial settlements and linked adjustment journals',
 'SAL-002':'Optional quotations and sales orders with direct quote-to-order or quote-to-invoice; direct goods or service invoices remain possible',
 'INV-008':'Batch serial item/location identification with custody and invoice/GRN/GDN links; damage and value adjustments select valid units or batches explicitly'
}
