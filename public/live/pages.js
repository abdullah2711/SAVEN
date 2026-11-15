// One navigable scope map. A planned page is never a successful-looking command.
export const moduleMap={
 Accounting:['Overview','Journal entries','General ledger','Trial balance','Chart of accounts','Financial position','Profit or loss','Cash flow','Changes in equity','Notes & schedules','Opening balances','Recurring journals','Accruals & prepayments','Corrections','Period close'],
 Approvals:['To review','My requests','Returned for correction','Rejected','Approved'],
 Selling:['Overview','Quotations','Sales orders','Invoices','Delivery notes','Service completions','Returns & credits'],
 Buying:['Overview','Supplier quotations','Purchase orders','Bills','Goods received','Service acceptance','Returns & debits'],
 Payments:['Overview','Receipts','Supplier payments','Advances & allocations','Refunds'],
 'Customers & suppliers':['Overview','Customers & suppliers','Receivables','Payables','Ageing','Statements','Follow-ups'],
 Inventory:['Overview','Stock balances','New movement','Items','Item groups','Warehouses','Goods received','Delivery notes','Batches & serials','Stock counts','Damage & write-offs','NRV adjustments','Returns','Valuation','Setup'],
 Taxes:['Overview','Registrations & rules','Sales tax','Income tax','Income tax withholding','Sales tax withholding','Certificates','Reconciliation & returns'],
 'Cash & bank':['Overview','Accounts','Cashbook','Bankbook','Transfers','Statement imports','Bank reconciliation'],
 Assets:['Overview','Asset register','Categories','Acquisitions & CWIP','Available for use','Depreciation','Valuation & impairment','Transfers','Disposals'],
 POS:['Overview','Checkout','Profiles','Till sessions','Returns','Cash counts'],
 Settings:['Overview','Business','Branches & locations','Financial years & currencies','Dimensions','People','Roles','Add staff','Link an account','Role assignments','Settings access','Approval policies','Module configuration','Document defaults','Numbering','Print configuration','Print formats','Letterheads','My workspace']
};
export const livePages={Accounting:['Overview','Journal entries','General ledger','Trial balance','Chart of accounts','Financial position','Profit or loss','Corrections','New journal'],Approvals:moduleMap.Approvals,Selling:['Invoices'],Buying:['Bills'],Payments:['Receipts','Supplier payments'],'Customers & suppliers':['Customers & suppliers'],Inventory:['Stock balances','New movement','Items','Warehouses','Setup'],Settings:['Business','Print configuration','Period close','People','Roles','Add staff','Link an account','Role assignments']};
export const planned=(page,tab)=>moduleMap[page]&&!livePages[page]?.includes(tab)&&!tab.startsWith('Draft ')&&!tab.startsWith('Entry ');
export function plannedView(content,{el,card,page,tab}){
 content.append(card(tab,el('span',{class:'badge'},'MVP 1 · Planned'),el('p',{},'This page is part of the agreed scope for your managed accounting clients. Its working workflow is still to be built.'),el('p',{class:'small'},'Accounting is being completed first. This page does not create transactions or change your records.')));
}
