import {minor,decimal,MAX_MINOR} from '../money.mjs';
import {canonical,digest,transaction} from './sqlite.mjs';
import {normalizedJournal} from './engine.mjs';
import {id} from './inventory.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const text=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const control=kind=>kind==='customer'?'1100':'2000';
const documentKinds=['invoice','bill'];
function party(db,p){const row=db.prepare('SELECT * FROM trade_parties WHERE company=? AND branch=? AND id=?').get(p.company,p.branch,p.party);check(row,'Party unavailable in this company/branch');return row;}
function outstanding(db,document){return document.total-db.prepare('SELECT coalesce(sum(amount),0) AS n FROM trade_allocations WHERE document_id=?').get(document.command_id).n;}
function validateTargets(engine,tenant,actor,p,action='journal.read'){
 const db=engine.tenant(tenant);
 for(const a of p.allocations??[]){const d=db.prepare('SELECT d.*,i.payload FROM trade_documents d JOIN command_inbox i ON i.id=d.command_id WHERE d.command_id=?').get(a.document);check(d&&d.company===p.company&&d.branch===p.branch&&d.party_id===p.party,'Allocation must belong to the same party/company/branch');check(d.posting_date<=p.date,'Settlement cannot precede its invoice/bill');check(d.kind===(p.kind==='receipt'?'invoice':'bill'),'Settlement direction does not match the source');engine.policy(tenant,actor,action,JSON.parse(d.payload));check(a.amount<=outstanding(db,d),'Allocation exceeds the current unpaid balance');}
}
function journalFor(engine,tenant,actor,p){
 const db=engine.tenant(tenant),customer=['invoice','receipt'].includes(p.kind),who=party(db,p);check(who.kind===(customer?'customer':'supplier'),'Party type does not match this transaction');
 const total=p.lines?p.lines.reduce((n,l)=>n+BigInt(l.amount),0n):p.allocations.reduce((n,a)=>n+BigInt(a.amount),0n);check(total>0n&&total<=BigInt(MAX_MINOR),'Trade total exceeds the supported range');
 const lines=[],add=(account,debit,credit)=>lines.push({account,debit:decimal(debit),credit:decimal(credit)});
 if(documentKinds.includes(p.kind)){
  for(const l of p.lines){const profile=db.prepare('SELECT kind FROM account_profiles WHERE code=? AND active=1').get(l.account);check(profile&&(customer?profile.kind==='income':['expense','asset'].includes(profile.kind)),'Choose an income account for invoices or an expense/asset account for bills');check(!['1100','2000'].includes(l.account)&&!db.prepare('SELECT 1 FROM inventory_controls WHERE account=?').get(l.account),'Use the dedicated trade or stock source for control accounts');}
  if(customer){add('1100',total,0n);for(const l of p.lines)add(l.account,0n,BigInt(l.amount));}else{for(const l of p.lines)add(l.account,BigInt(l.amount),0n);add('2000',0n,total);}
 }else{
  check(db.prepare("SELECT 1 FROM account_profiles WHERE code=? AND kind='asset' AND active=1").get(p.cashAccount)&&!['1100','2000'].includes(p.cashAccount)&&!db.prepare('SELECT 1 FROM inventory_controls WHERE account=?').get(p.cashAccount),'Choose a cash/bank asset account, not a control account');
  validateTargets(engine,tenant,actor,p);
  if(customer){add(p.cashAccount,total,0n);add('1100',0n,total);}else{add('2000',total,0n);add(p.cashAccount,0n,total);}
 }
 return {company:p.company,branch:p.branch,date:p.date,narrative:p.reference+' - '+who.name,...(p.evidence?{evidence:p.evidence}:{}),lines};
}
export function createTradeParty(runtime,tenant,actor,input){
 check(input&&Object.keys(input).every(k=>['company','branch','id','kind','name'].includes(k)),'Unknown party fields');const {company,branch,kind,name}=input;
 runtime.scope(tenant,actor,company,branch,'accounts.manage');check(id(input.id)&&['customer','supplier'].includes(kind)&&text(name,160),'Party code, type and name required');
 const db=runtime.engine.tenant(tenant),account=control(kind);runtime.engine.policy(tenant,actor,'accounts.manage',{company,branch,lines:[{account,debit:0,credit:0}]});
 return transaction(db,()=>{
  if(!db.prepare('SELECT 1 FROM trade_controls WHERE company=? AND branch=? AND account=?').get(company,branch,account)){
   const balance=db.prepare('SELECT coalesce(sum(l.debit-l.credit),0) AS n FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.company=? AND j.branch=? AND l.account=?').get(company,branch,account).n;
   check(balance===0&&!db.prepare('SELECT 1 FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.company=? AND j.branch=? AND l.account=? LIMIT 1').get(company,branch,account),'Existing control history needs an opening-subledger reconciliation before trade activation');
   db.prepare('INSERT INTO trade_controls VALUES(?,?,?)').run(company,branch,account);
  }
  db.prepare('INSERT INTO trade_parties VALUES(?,?,?,?,?)').run(company,branch,input.id,kind,name.trim());runtime.engine.audit(db,null,actor,'TRADE_PARTY_CREATED',{...input,name:name.trim()});return {id:input.id};
 });
}
export function prepareTrade(runtime,tenant,actor,commandId,input){
 check(id(commandId)&&input&&Object.keys(input).every(k=>['kind','company','branch','party','date','dueDate','reference','lines','allocations','cashAccount','evidence'].includes(k)),'Invalid trade fields or operation identifier');
 check(['invoice','bill','receipt','payment'].includes(input.kind)&&id(input.company)&&id(input.branch)&&id(input.party)&&date(input.date)&&text(input.reference,160),'Transaction type, party, date and reference required');runtime.scope(tenant,actor,input.company,input.branch,'journal.prepare');
 let p={kind:input.kind,company:input.company,branch:input.branch,party:input.party,date:input.date,reference:input.reference.trim(),...(input.evidence!==undefined?{evidence:input.evidence}:{})};
 if(documentKinds.includes(p.kind)){
  check(date(input.dueDate)&&input.dueDate>=input.date&&input.allocations===undefined&&input.cashAccount===undefined,'Valid due date required; invoices cannot contain settlements');check(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=100,'Use 1 to 100 invoice/bill lines');
  p={...p,dueDate:input.dueDate,lines:input.lines.map(l=>{check(l&&Object.keys(l).every(k=>['description','account','amount'].includes(k))&&text(l.description,300)&&id(l.account),'Line description and account required');return {description:l.description.trim(),account:l.account,amount:minor(l.amount,{positive:true})};})};
 }else{
  check(input.lines===undefined&&input.dueDate===undefined&&id(input.cashAccount)&&Array.isArray(input.allocations)&&input.allocations.length>0&&input.allocations.length<=50,'Select a cash account and 1 to 50 invoice/bill allocations');
  p={...p,cashAccount:input.cashAccount,allocations:input.allocations.map(a=>{check(a&&Object.keys(a).every(k=>['document','amount'].includes(k))&&id(a.document),'Source invoice/bill required');return {document:a.document,amount:minor(a.amount,{positive:true})};})};check(new Set(p.allocations.map(a=>a.document)).size===p.allocations.length,'Duplicate source allocation');
 }
 const db=runtime.engine.tenant(tenant),inputDigest=digest(p);
  const old=db.prepare('SELECT o.*,i.actor,i.state,i.payload AS journal FROM trade_operations o JOIN command_inbox i ON i.id=o.command_id WHERE o.command_id=?').get(commandId);
  if(old){check(old.input_digest===inputDigest&&old.actor===actor,'Operation identifier reused with a different trade request');runtime.engine.policy(tenant,actor,'journal.prepare',JSON.parse(old.journal));return {id:commandId,state:old.state,replayed:true};}
  check(!db.prepare('SELECT 1 FROM command_inbox WHERE id=?').get(commandId),'Operation identifier belongs to another command');
  const journal=journalFor(runtime.engine,tenant,actor,p);return runtime.engine.accept(tenant,actor,commandId,journal,{record(store){check(digest(normalizedJournal(journalFor(runtime.engine,tenant,actor,p)))===digest(normalizedJournal(journal)),'Trade source changed during acceptance');store.prepare('INSERT INTO trade_operations VALUES(?,?,?)').run(commandId,inputDigest,canonical(p));runtime.engine.audit(store,commandId,actor,'TRADE_ACCEPTED',{kind:p.kind,inputDigest});}});
}
export const tradeExtension={plan(engine,tenant,row){
 const db=engine.tenant(tenant),op=db.prepare('SELECT * FROM trade_operations WHERE command_id=?').get(row.id);if(!op)return null;
 const p=JSON.parse(op.payload),journal=journalFor(engine,tenant,row.actor,p);check(!db.prepare("SELECT 1 FROM trade_operations o JOIN command_inbox i ON i.id=o.command_id WHERE i.state='POSTED' AND json_extract(o.payload,'$.company')=? AND json_extract(o.payload,'$.branch')=? AND json_extract(o.payload,'$.party')=? AND json_extract(o.payload,'$.kind')=? AND json_extract(o.payload,'$.reference')=? LIMIT 1").get(p.company,p.branch,p.party,p.kind,p.reference),'This party already has a posted transaction with that reference and type');check(digest(normalizedJournal(journal))===row.digest,'Trade source no longer matches the accepted journal');
 return {authority:{prepare:'journal.prepare',post:'journal.post',approve:'journal.approve'},validateApprover(actor){validateTargets(engine,tenant,actor,p,'journal.approve');},apply(){
  if(documentKinds.includes(p.kind)){const total=p.lines.reduce((n,l)=>n+l.amount,0);db.prepare('INSERT INTO trade_documents VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,p.company,p.branch,p.party,p.kind,p.reference,p.date,p.dueDate,total);p.lines.forEach((l,i)=>db.prepare('INSERT INTO trade_lines VALUES(?,?,?,?,?)').run(row.id,i+1,l.description,l.account,l.amount));}
  else for(const a of p.allocations)db.prepare('INSERT INTO trade_allocations VALUES(?,?,?)').run(row.id,a.document,a.amount);
 }};
}};
export function tradeReport(runtime,tenant,actor,{company,branch,asOf=new Date(runtime.clock()).toISOString().slice(0,10)}={}){
 runtime.scope(tenant,actor,company,branch,'journal.read');check(date(asOf),'Valid report date required');const db=runtime.engine.tenant(tenant),canRead=p=>{try{runtime.engine.policy(tenant,actor,'journal.read',p);return true;}catch{return false;}};
 const operations=db.prepare('SELECT o.command_id,o.payload,i.payload AS journal,i.state FROM trade_operations o JOIN command_inbox i ON i.id=o.command_id WHERE json_extract(o.payload,\'$.company\')=? AND json_extract(o.payload,\'$.branch\')=? ORDER BY json_extract(o.payload,\'$.date\'),o.command_id').all(company,branch).filter(r=>canRead(JSON.parse(r.journal)));
 const documents=db.prepare('SELECT d.*,p.name AS party_name,i.payload FROM trade_documents d JOIN trade_parties p ON p.company=d.company AND p.branch=d.branch AND p.id=d.party_id JOIN command_inbox i ON i.id=d.command_id WHERE d.company=? AND d.branch=? AND d.posting_date<=? ORDER BY d.posting_date,d.command_id').all(company,branch,asOf).filter(r=>canRead(JSON.parse(r.payload))).map(r=>{
  const paid=db.prepare("SELECT coalesce(sum(a.amount),0) AS n FROM trade_allocations a JOIN journals j ON j.id=a.command_id WHERE a.document_id=? AND j.posting_date<=?").get(r.command_id,asOf).n;const {payload,...d}=r;return {...d,total:decimal(r.total),paid:decimal(paid),outstanding:decimal(r.total-paid),overdue:r.due_date<asOf&&r.total>paid,lines:db.prepare('SELECT line_no,description,account,amount FROM trade_lines WHERE command_id=? ORDER BY line_no').all(r.command_id).map(l=>({...l,amount:decimal(l.amount)}))};
 });
 const parties=db.prepare('SELECT * FROM trade_parties WHERE company=? AND branch=? ORDER BY name,id').all(company,branch).filter(p=>canRead({company,branch,lines:[{account:control(p.kind),debit:0,credit:0}]}));
 let reconciliation=null;
 if(db.prepare("SELECT user_id FROM assignments WHERE role_id='ultimate_business_admin'").get()?.user_id===actor){reconciliation=['invoice','bill'].map(kind=>{const account=kind==='invoice'?'1100':'2000',subledger=documents.filter(d=>d.kind===kind).reduce((n,d)=>n+BigInt(minor(d.outstanding)),0n),gl=BigInt(db.prepare('SELECT coalesce(sum(l.debit-l.credit),0) AS n FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.company=? AND j.branch=? AND l.account=? AND j.posting_date<=?').get(company,branch,account,asOf).n)*(kind==='invoice'?1n:-1n);return {account,subledger:decimal(subledger),ledger:decimal(gl),difference:decimal(gl-subledger)};});}
 return {asOf,parties,documents,reconciliation,operations:operations.map(r=>{const p=JSON.parse(r.payload);return {id:r.command_id,kind:p.kind,date:p.date,reference:p.reference,party:p.party,state:r.state,total:decimal((p.lines??p.allocations).reduce((n,l)=>n+BigInt(l.amount),0n))};})};
}
