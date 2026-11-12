import {requireThat} from './errors.mjs';
import {minor,decimal} from './money.mjs';
import {companyAccess} from './auth.mjs';

export const extendedKinds=['bill','receipt','payment','journal','cash_transfer','cash_expense','cash_income','reversal','credit_note','supplier_credit'];
const common=['kind','date','reference','description'];
function object(value,allowed){requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k)),422,'INVALID_DOCUMENT','Provide only the supported document fields.');}
function text(value,label,max=160){requireThat(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max&&!/[\u0000-\u001f]/.test(value),422,'INVALID_FIELD',`Provide a valid ${label}.`);return value.trim();}
export function normalizeExtended(input){
  requireThat(extendedKinds.includes(input?.kind),422,'INVALID_KIND','Choose a supported transaction type.');
  const extra=input.kind==='bill'?['partyId','amount','expenseAccountId','dueDate']:input.kind==='journal'?['lines']:input.kind==='reversal'?['originalDocumentId']:input.kind==='cash_transfer'?['fromAccountId','toAccountId','amount']:['credit_note','supplier_credit'].includes(input.kind)?['targetDocumentId','amount','partyId']:['cash_expense','cash_income'].includes(input.kind)?['cashAccountId','counterAccountId','amount']:['targetDocumentId','partyId','amount','cashAccountId'];
  object(input,[...common,...extra,...(input.kind==='journal'?['recurrence']:[])]);
  requireThat(typeof input.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.date)&&!Number.isNaN(Date.parse(input.date))&&new Date(input.date).toISOString().slice(0,10)===input.date,422,'INVALID_DATE','Choose a valid accounting date.');
  const base={kind:input.kind,date:input.date,reference:text(input.reference,'reference',60),description:text(input.description,'description',500)};
  if(input.kind==='reversal')return {...base,originalDocumentId:text(input.originalDocumentId,'original transaction')};
  if(input.kind==='cash_transfer'){requireThat(input.fromAccountId!==input.toAccountId,422,'INVALID_ACCOUNT','Choose different source and destination accounts.');return {...base,fromAccountId:text(input.fromAccountId,'source account'),toAccountId:text(input.toAccountId,'destination account'),amount:decimal(minor(input.amount,{positive:true}))};}
  if(['cash_expense','cash_income'].includes(input.kind))return {...base,cashAccountId:text(input.cashAccountId,'cash or bank account'),counterAccountId:text(input.counterAccountId,'income or expense account'),amount:decimal(minor(input.amount,{positive:true}))};
  if(input.kind==='bill'){const dueDate=input.dueDate??base.date;requireThat(typeof dueDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(dueDate)&&!Number.isNaN(Date.parse(dueDate))&&new Date(dueDate).toISOString().slice(0,10)===dueDate&&dueDate>=base.date,422,'INVALID_DATE','The due date must be a valid date on or after the bill date.');return {...base,partyId:text(input.partyId,'supplier'),amount:decimal(minor(input.amount,{positive:true})),expenseAccountId:text(input.expenseAccountId,'expense account'),dueDate};}
  if(input.kind==='journal'){
    requireThat(Array.isArray(input.lines)&&input.lines.length>=2&&input.lines.length<=40,422,'INVALID_LINES','A journal needs 2 to 40 lines.');
    let debit=0n,credit=0n;
    const lines=input.lines.map(row=>{object(row,['accountId','debit','credit']);const d=BigInt(minor(row.debit)),c=BigInt(minor(row.credit));requireThat(d>0n&&c===0n||c>0n&&d===0n,422,'INVALID_LINE','Each line must contain one debit or one credit.');debit+=d;credit+=c;return {accountId:text(row.accountId,'account'),debit:decimal(d),credit:decimal(c)};});
    requireThat(debit===credit,422,'UNBALANCED_JOURNAL','Total debits and credits must match.');
    minor(decimal(debit),{positive:true});
    let recurrence;
    if(input.recurrence!==undefined){object(input.recurrence,['scheduleId','index','attempt']);const r=input.recurrence;requireThat(Number.isInteger(r.index)&&r.index>=0&&r.index<120&&Number.isInteger(r.attempt)&&r.attempt>=1&&r.attempt<=1000,422,'INVALID_OCCURRENCE','Choose a valid schedule occurrence.');recurrence={scheduleId:text(r.scheduleId,'schedule',80),index:r.index,attempt:r.attempt};}
    return {...base,lines,...(recurrence?{recurrence}:{})};
  }
  return {...base,targetDocumentId:text(input.targetDocumentId,'invoice or bill'),...(input.partyId?{partyId:text(input.partyId,'contact')}:{}),amount:decimal(minor(input.amount,{positive:true})),...(!['credit_note','supplier_credit'].includes(input.kind)?{cashAccountId:text(input.cashAccountId,'cash or bank account')}:{})};
}

export async function extendedEffect(db,companyId,document,line,allow){
  const accounts=(await db.prepare('SELECT id,kind,category'+(db.schemaVersion>=6?',active':'')+' FROM accounts WHERE company_id=?').bind(companyId).all()).results;
  const account=(id,check,message)=>{const a=accounts.find(x=>x.id===id);requireThat(a&&check(a),422,'INVALID_ACCOUNT',message);return a;};
  if(['cash_transfer','cash_expense','cash_income','reversal'].includes(document.kind))requireThat(db.schemaVersion>=6,503,'UPGRADE_REQUIRED','The accounting workspace upgrade is required.');
  if(document.kind==='reversal'){
    const original=await db.prepare('SELECT * FROM documents WHERE company_id=? AND id=?').bind(companyId,document.originalDocumentId).first();requireThat(original?.status==='posted'&&['journal','cash_transfer','cash_expense','cash_income'].includes(original.kind),422,'INVALID_REVERSAL','Select a posted general journal or cash transaction. Invoice, settlement and stock corrections require their subledger workflow.');requireThat(document.date>=original.date,422,'INVALID_DATE','The reversal date cannot precede the original entry.');
    const prior=await db.prepare("SELECT id FROM documents WHERE company_id=? AND kind='reversal' AND status IN('pending','posted') AND payload_json::jsonb->>'originalDocumentId'=?").bind(companyId,original.id).first();requireThat(!prior,409,'ALREADY_REVERSED','This entry already has a pending or posted reversal.');
    for(const entry of JSON.parse(original.preview_json).lines)line(entry.accountId,minor(entry.credit),minor(entry.debit));return {amount:BigInt(original.amount_minor)};
  }
  if(document.kind==='cash_transfer'){const amount=BigInt(minor(document.amount,{positive:true}));for(const id of [document.fromAccountId,document.toAccountId])account(id,a=>a.kind==='asset'&&a.category==='cash_bank','Select two cash or bank accounts.');line(document.toAccountId,amount,0n);line(document.fromAccountId,0n,amount);return {amount};}
  if(['cash_expense','cash_income'].includes(document.kind)){const amount=BigInt(minor(document.amount,{positive:true}));account(document.cashAccountId,a=>a.kind==='asset'&&a.category==='cash_bank','Choose a cash or bank account.');account(document.counterAccountId,a=>a.category==='general'&&a.kind===(document.kind==='cash_expense'?'expense':'income'),'Choose the appropriate expense or income account.');if(document.kind==='cash_expense'){line(document.counterAccountId,amount,0n);line(document.cashAccountId,0n,amount);}else{line(document.cashAccountId,amount,0n);line(document.counterAccountId,0n,amount);}return {amount};}
  if(document.kind==='journal'){
    for(const row of document.lines){account(row.accountId,a=>['general','cash_bank'].includes(a.category)&&!['customer_advances','supplier_advances'].includes(a.id),'Use a normal ledger account. Customer, supplier and inventory control accounts require their own transactions.');line(row.accountId,minor(row.debit),minor(row.credit));}
    return {amount:document.lines.reduce((sum,l)=>sum+BigInt(minor(l.debit)),0n)};
  }
  const amount=BigInt(minor(document.amount,{positive:true}));
  if(document.kind==='bill'){
    allow('party',document.partyId);
    const supplier=await db.prepare("SELECT id FROM parties WHERE company_id=? AND id=? AND kind IN ('supplier','both')").bind(companyId,document.partyId).first();
    requireThat(supplier,422,'SUPPLIER_NOT_FOUND','Choose a supplier in this company.');
    account(document.expenseAccountId,a=>a.kind==='expense'&&a.category==='general','Choose an operating expense account.');
    account('payable',a=>a.kind==='liability'&&a.category==='payable','The supplier control account is missing.');
    line(document.expenseAccountId,amount,0n);line('payable',0n,amount);return {amount};
  }
  const credit=['credit_note','supplier_credit'].includes(document.kind);if(credit)requireThat(db.schemaVersion>=7,503,'UPGRADE_REQUIRED','Credit adjustments require the receivables/payables upgrade.');
  if(!credit)account(document.cashAccountId,a=>a.kind==='asset'&&a.category==='cash_bank','Choose an available cash or bank account.');
  const target=await db.prepare('SELECT * FROM documents WHERE company_id=? AND id=?').bind(companyId,document.targetDocumentId).first();
  const targetKinds=document.kind==='receipt'?['invoice','opening_receivable']:document.kind==='payment'?['bill','opening_payable',...(db.schemaVersion>=13?['asset_acquisition']:[])]:document.kind==='credit_note'?['invoice']:['bill'];
  requireThat(target&&target.status==='posted'&&targetKinds.includes(target.kind),422,'SETTLEMENT_TARGET','Choose a posted invoice/bill or a supported opening balance. Opening corrections require their own controlled treatment.');
  allow('party',target.party_id);
  for(const entry of JSON.parse(target.preview_json).lines)allow('account',entry.accountId);
  requireThat(document.date>=target.date,422,'SETTLEMENT_DATE','The settlement date cannot precede its invoice or bill.');
  const payload=JSON.parse(target.payload_json);
  requireThat(!credit||!payload.lines,409,'LINE_CREDIT_REQUIRED','Line invoices need a linked line-and-tax credit workflow. The legacy amount-only adjustment cannot reverse their tax correctly.');
  requireThat(target.kind!=='invoice'||payload.settlement==='credit',409,'ALREADY_SETTLED','This sale was already recorded with full payment.');
  const used=await db.prepare("SELECT coalesce(sum(a.amount_minor),0)::text AS amount FROM document_allocations a JOIN documents s ON s.company_id=a.company_id AND s.id=a.settlement_id WHERE a.company_id=? AND a.target_id=? AND s.status IN ('pending','posted')").bind(companyId,target.id).first();
  const available=BigInt(target.amount_minor)-BigInt(used.amount);
  requireThat(amount<=available,409,'OVER_ALLOCATION','This amount exceeds the invoice or bill balance available after pending settlements.');
  document.partyId=target.party_id;
  if(document.kind==='credit_note'){line('revenue',amount,0n);line('receivable',0n,amount);}
  else if(document.kind==='supplier_credit'){const expenseId=payload.expenseAccountId;account(expenseId,a=>a.kind==='expense'&&a.category==='general','The original bill expense account is unavailable.');line('payable',amount,0n);line(expenseId,0n,amount);}
  else if(document.kind==='receipt'){line(document.cashAccountId,amount,0n);line('receivable',0n,amount);}
  else{line('payable',amount,0n);line(document.cashAccountId,0n,amount);}
  return {amount,allocation:{targetDocumentId:target.id,reference:target.reference,amount:decimal(amount),availableBefore:decimal(available),availableAfter:decimal(available-amount)}};
}
export async function outstandingBalances(db,actor,companyId,partyId=''){
 await companyAccess(db,actor,companyId);requireThat(db.schemaVersion>=4,503,'UPGRADE_REQUIRED','Settlement reporting needs the accounting upgrade.');
 const denied=(await db.prepare('SELECT resource_type,resource_id FROM resource_denials WHERE company_id=? AND user_id=?').bind(companyId,actor.id).all()).results;
 const rows=(await db.prepare("SELECT d.id,d.kind,d.reference,d.date,d.party_id,d.amount_minor,d.preview_json,p.name AS party_name,coalesce(sum(CASE WHEN s.status='posted' THEN a.amount_minor ELSE 0 END),0)::text AS settled,coalesce(sum(CASE WHEN s.status='pending' THEN a.amount_minor ELSE 0 END),0)::text AS reserved FROM documents d JOIN parties p ON p.company_id=d.company_id AND p.id=d.party_id LEFT JOIN document_allocations a ON a.company_id=d.company_id AND a.target_id=d.id LEFT JOIN documents s ON s.company_id=a.company_id AND s.id=a.settlement_id WHERE d.company_id=? AND (?='' OR d.party_id=?) AND d.status='posted' AND (d.kind IN('bill','opening_receivable','opening_payable'"+(db.schemaVersion>=13?",'asset_acquisition'":'')+") OR (d.kind='invoice' AND d.payload_json::jsonb->>'settlement'='credit')) GROUP BY d.id,d.kind,d.reference,d.date,d.party_id,d.amount_minor,d.preview_json,p.name ORDER BY d.date,d.reference LIMIT 501").bind(companyId,partyId,partyId).all()).results;
 return {limited:rows.length>500,rows:rows.slice(0,500).filter(row=>!denied.some(d=>d.resource_type==='party'&&d.resource_id===row.party_id||d.resource_type==='account'&&[...JSON.parse(row.preview_json).lines,...(JSON.parse(row.preview_json).resourceAccounts??[]).map(accountId=>({accountId}))].some(l=>l.accountId===d.resource_id))).map(row=>{const amount=BigInt(row.amount_minor),settled=BigInt(row.settled),reserved=BigInt(row.reserved);return {id:row.id,sourceKind:row.kind,kind:row.kind==='opening_receivable'?'invoice':['opening_payable','asset_acquisition'].includes(row.kind)?'bill':row.kind,reference:row.reference,date:row.date,partyId:row.party_id,partyName:row.party_name,amount:decimal(amount),settled:decimal(settled),pending:decimal(reserved),open:decimal(amount-settled),available:decimal(amount-settled-reserved)};}).filter(row=>row.open!=='0.00')};
}
