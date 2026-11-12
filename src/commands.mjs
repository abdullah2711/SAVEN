import {normalizeLineInvoice,lineInvoiceEffect} from './bookkeeping.mjs';
import {assetKinds,normalizeAsset,assetEffect} from './assets.mjs';
import {paymentKinds,normalizePayment,paymentEffect} from './payments.mjs';
import { AppError, requireThat } from './errors.mjs';
import { canonical, hash } from './crypto.mjs';
import { decimal, minor, quantity, multiplied } from './money.mjs';
import { now, companyAccess, canPrepare, canReview } from './auth.mjs';
import {extendedKinds,normalizeExtended,extendedEffect} from './extended-accounting.mjs';
import {normalizeOpening,openingEffect} from './opening.mjs';
import {validateRecurring} from './recurring.mjs';
import {approvalDecision} from './approval.mjs';

function fields(value, allowed) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 422, 'INVALID_DOCUMENT', 'Provide a document object.');
  requireThat(Object.keys(value).every(key => allowed.includes(key)), 422, 'UNKNOWN_FIELD', 'The document contains an unsupported field.');
}
function text(value, field, max = 160) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001f]/.test(value), 422, 'INVALID_FIELD', `Provide a valid ${field} (up to ${max} characters).`);
  return value.trim();
}
export function normalize(input) {
  if(['invoice','bill'].includes(input?.kind)&&input.lines!==undefined)return normalizeLineInvoice(input);
  if(assetKinds.includes(input?.kind))return normalizeAsset(input);
  if(paymentKinds.includes(input?.kind))return normalizePayment(input);
  if(input?.kind==='opening_balance')return normalizeOpening(input);
  if(extendedKinds.includes(input?.kind))return normalizeExtended(input);
  fields(input, ['kind','date','reference','description','partyId','amount','settlement','cashAccountId','itemId','quantity','dueDate']);
  requireThat(['invoice','stock_issue'].includes(input.kind), 422, 'INVALID_KIND', 'Choose a service invoice or stock issue.');
  requireThat(typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) && !Number.isNaN(Date.parse(input.date)) && new Date(input.date).toISOString().slice(0,10) === input.date, 422, 'INVALID_DATE', 'Choose a valid accounting date.');
  const base = { kind: input.kind, date: input.date, reference: text(input.reference,'reference',60), description: text(input.description,'description',500) };
  if (input.kind === 'invoice') {
    if(input.dueDate!==undefined)requireThat(typeof input.dueDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)&&!Number.isNaN(Date.parse(input.dueDate))&&new Date(input.dueDate).toISOString().slice(0,10)===input.dueDate&&input.dueDate>=input.date,422,'INVALID_DATE','The due date must be a valid date on or after the invoice date.');
    requireThat(input.itemId === undefined && input.quantity === undefined, 422, 'INVALID_FIELD', 'A service invoice cannot include stock-issue fields.');
    requireThat(['credit','receipt','cash'].includes(input.settlement), 422, 'INVALID_SETTLEMENT', 'Choose credit, invoice with receipt, or direct cash sale.');
    requireThat(input.settlement === 'credit' ? input.cashAccountId === undefined : typeof input.cashAccountId==='string'&&input.cashAccountId.length>0&&input.cashAccountId.length<=160, 422, 'INVALID_ACCOUNT', 'Choose the cash or bank account for this receipt.');
    return { ...base, partyId: text(input.partyId,'customer'), amount: decimal(minor(input.amount,{positive:true})), settlement: input.settlement, ...(input.dueDate?{dueDate:input.dueDate}:{}),...(input.settlement !== 'credit' ? {cashAccountId:input.cashAccountId}: {}) };
  }
  requireThat(['partyId','amount','settlement','cashAccountId','dueDate'].every(key=>input[key]===undefined),422,'INVALID_FIELD','A stock issue cannot include invoice fields.');
  return { ...base, itemId: text(input.itemId,'item'), quantity: String(quantity(input.quantity)) };
}
async function denied(db, companyId, userId) {
  return (await db.prepare('SELECT resource_type,resource_id FROM resource_denials WHERE company_id=? AND user_id=?').bind(companyId,userId).all()).results;
}
function allowedResource(denials, type, id) {
  requireThat(!denials.some(row=>row.resource_type===type && row.resource_id===id),403,'RESOURCE_DENIED','Your access does not include this customer, item, or account.');
}
export async function preview(db, actor, companyId, raw) {
  const company = await companyAccess(db,actor,companyId);
  requireThat(canPrepare(company.role),403,'PREPARATION_DENIED','Your role cannot prepare transactions.');
  const document = normalize(raw), lines = [], denials = await denied(db,companyId,actor.id);
  await validateRecurring(db,actor,companyId,document);
  if(db.schemaVersion>=8&&document.kind!=='opening_balance')requireThat(!(await db.prepare("SELECT id FROM documents WHERE company_id=? AND kind='opening_balance' AND status='pending' LIMIT 1").bind(companyId).first()),409,'OPENING_PENDING','An opening snapshot is awaiting review. Complete or reject it before preparing other transactions.');
  if(db.schemaVersion>=8&&document.kind!=='opening_balance'){const domains=(await db.prepare('SELECT domain,cutoff FROM opening_domains WHERE company_id=?').bind(companyId).all()).results;const full=await db.prepare("SELECT date FROM documents WHERE company_id=? AND kind='opening_balance' AND status='posted' AND payload_json::jsonb->>'mode'='post'").bind(companyId).first();requireThat(!(full&&document.date<=full.date)&&!domains.some(d=>document.date<=d.cutoff&&(d.domain==='receivables'&&['invoice','receipt','credit_note'].includes(document.kind)||d.domain==='payables'&&['bill','payment','supplier_credit'].includes(document.kind)||d.domain==='inventory'&&document.kind==='stock_issue')),409,'OPENING_DATE_CLOSED','Opening snapshots are closing balances for their cutoff date. Prepare subsequent transactions from the following day.');}
  const period = await db.prepare('SELECT locked FROM periods WHERE company_id=? AND ? BETWEEN start_date AND end_date').bind(companyId,document.date).first();
  requireThat(period && !period.locked,409,'PERIOD_LOCKED','This accounting date is outside an open period.');
  const accounts = (await db.prepare('SELECT id,code,name'+(db.schemaVersion>=3?',kind,category':'')+(db.schemaVersion>=6?',active':'')+' FROM accounts WHERE company_id=?').bind(companyId).all()).results;
  function line(accountId, debit, credit) {
    const account = accounts.find(row=>row.id===accountId);
    requireThat(account,422,'ACCOUNT_MAPPING','An accounting mapping is missing. Ask your administrator.');
    requireThat(account.active!==false||document.kind==='reversal',409,'ACCOUNT_INACTIVE','This account is archived. Choose an active account.');
    allowedResource(denials,'account',accountId);
    lines.push({accountId,code:account.code,name:account.name,debit:decimal(debit),credit:decimal(credit)});
  }
  let amount, stock = null,allocation=null,opening=null,payment=null,asset=null,invoice=null,resourceAccounts=[];
  if(['invoice','bill'].includes(document.kind)&&document.lines){const effect=await lineInvoiceEffect(db,actor,companyId,document,line,(type,id)=>allowedResource(denials,type,id));amount=effect.amount;invoice=effect.invoice;resourceAccounts=effect.resourceAccounts;}
  else if(document.kind==='opening_balance'){const effect=await openingEffect(db,actor,companyId,document,line);amount=effect.amount;opening=effect.opening;}
  else if(assetKinds.includes(document.kind)){const effect=await assetEffect(db,actor,companyId,document,line,(type,id)=>allowedResource(denials,type,id));amount=effect.amount;asset=effect.asset;allocation=effect.allocation??null;resourceAccounts=effect.resourceAccounts;payment=effect.payment??null;}
  else if(paymentKinds.includes(document.kind)){const effect=await paymentEffect(db,actor,companyId,document,line,(type,id)=>allowedResource(denials,type,id));amount=effect.amount;payment=effect.payment;}
  else if(extendedKinds.includes(document.kind)){
    requireThat(db.schemaVersion>=4,503,'UPGRADE_REQUIRED','This accounting workflow is being activated.');
    const effect=await extendedEffect(db,companyId,document,line,(type,id)=>allowedResource(denials,type,id));amount=effect.amount;allocation=effect.allocation??null;
  } else
  if(document.kind==='invoice') {
    allowedResource(denials,'party',document.partyId);
    const party = await db.prepare('SELECT name'+(db.schemaVersion>=3?',kind':'')+' FROM parties WHERE company_id=? AND id=?').bind(companyId,document.partyId).first();
    requireThat(party&&party.kind!=='supplier',422,'CUSTOMER_NOT_FOUND','Select a customer in this company.');
    amount = minor(document.amount,{positive:true});
    if(document.settlement!=='credit')requireThat(db.schemaVersion>=3?accounts.some(a=>a.id===document.cashAccountId&&a.kind==='asset'&&a.category==='cash_bank'):['cash','bank'].includes(document.cashAccountId),422,'INVALID_ACCOUNT','Choose an actual cash or bank account.');
    if(document.settlement==='cash') { line(document.cashAccountId,amount,0); line('revenue',0,amount); }
    else {
      line('receivable',amount,0); line('revenue',0,amount);
      if(document.settlement==='receipt') { line(document.cashAccountId,amount,0); line('receivable',0,amount); }
    }
  } else {
    allowedResource(denials,'item',document.itemId);
    const item = await db.prepare('SELECT * FROM items WHERE company_id=? AND id=?').bind(companyId,document.itemId).first();
    requireThat(item,422,'ITEM_NOT_FOUND','Select an item in this company.');
    const units=quantity(document.quantity);
    requireThat(item.on_hand-item.reserved>=units,409,'INSUFFICIENT_STOCK','The requested quantity is not available.');
    amount=multiplied(item.unit_cost_minor,units);
    line(item.expense_account,amount,0); line(item.inventory_account,0,amount);
    stock={name:item.name,store:item.store,unit:item.unit,quantity:document.quantity,available:String(item.on_hand-item.reserved),cost:decimal(amount)};
  }
  const effects={document,lines,amount:decimal(amount),stock,revision:company.revision};
  const approval=await approvalDecision(db,actor,companyId,document.kind,minor(effects.amount),{document,lines});
  if(approval){requireThat(approval.mode!=='denied',403,'PREPARATION_DENIED','The configured document permission does not allow your role to submit this transaction type.');effects.approval=approval;}
  if(allocation)effects.allocation=allocation;
  if(opening)effects.opening=opening;
  if(payment)effects.payment=payment;
  if(asset)effects.asset=asset;
  if(invoice)effects.invoice=invoice;
  if(resourceAccounts.length)effects.resourceAccounts=resourceAccounts;
  return {...effects,digest:await hash(canonical({companyId,...effects}))};
}
async function retryResult(db, actor, companyId, kind, key, payloadHash) {
  requireThat(typeof key==='string' && /^[a-zA-Z0-9_-]{16,128}$/.test(key),422,'IDEMPOTENCY_REQUIRED','Provide a stable command key to safely retry this request.');
  const row=await db.prepare('SELECT actor_id,payload_hash,result_json FROM operations WHERE company_id=? AND kind=? AND idempotency_key=?').bind(companyId,kind,key).first();
  if (!row) return null;
  requireThat(row.actor_id===actor.id && row.payload_hash===payloadHash,409,'IDEMPOTENCY_CONFLICT','This command key was already used with different data or by another user.');
  return {...JSON.parse(row.result_json),replayed:true};
}
function guard(db,actor,companyId,kind,key,payloadHash,revision,result,operationId,time,assistantTaskId=null) {
  return db.prepare('INSERT INTO operations(id,company_id,actor_id,session_hash,kind,idempotency_key,payload_hash,expected_revision,result_json,created_at'+(db.schemaVersion>=5?',assistant_task_id':'')+') VALUES(?,?,?,?,?,?,?,?,?,?'+(db.schemaVersion>=5?',?':'')+')').bind(operationId,companyId,actor.id,actor.sessionHash,kind,key,payloadHash,revision,JSON.stringify(result),time,...(db.schemaVersion>=5?[assistantTaskId]:[]));
}
function finish(db,actor,companyId,operationId,documentId,action,time) {
  return [
    db.prepare('INSERT INTO audit_events(id,company_id,operation_id,actor_id,action,document_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),companyId,operationId,actor.id,action,documentId,time),
    db.prepare('INSERT INTO outbox(id,company_id,operation_id,event_type,document_id,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),companyId,operationId,`document.${action}`,documentId,time),
    db.prepare('UPDATE companies SET revision=revision+1 WHERE id=?').bind(companyId)
  ];
}
async function transact(db, statements, retry) {
  try { await db.batch(statements); }
  catch(error) {
    const existing=await retry();
    if(existing) return existing;
    const message=String(error.message);
    if(error.code==='23505')throw new AppError(409,'DUPLICATE_REFERENCE','This reference or command key is already in use.');
    if(['23514','23503','42501'].includes(error.code))throw new AppError(error.code==='42501'?403:409,'CONSTRAINT_CONFLICT','The access or financial constraints changed. Refresh and review this action.');
    for(const [code,status,description] of [
      ['STALE_PREVIEW',409,'The company changed after this preview. Review a fresh preview and try again.'],
      ['PERIOD_LOCKED',409,'The accounting period is locked.'],
      ['BANK_PERIOD_CLOSED',409,'This cash or bank account has a closed reconciliation or a fixed opening baseline. Use a later open accounting date.'],
      ['OPENING_PENDING',409,'Resolve pending activity before applying this opening snapshot.'],
      ['FILE_NOT_READY',409,'A supporting file is no longer available or has not passed scanning.'],
      ['EVIDENCE_REQUIRED',409,'This transaction requires retained clean supporting evidence under the company policy.'],
      ['SCHEDULE_CHANGED',409,'The recurring schedule or occurrence changed. Prepare a fresh occurrence.'],
      ['OPENING_DATE_CLOSED',409,'The date is covered by an opening closing snapshot. Use a subsequent accounting date.'],
      ['OPENING_ALREADY_SET',409,'This opening subledger already has an approved or pending baseline.'],
      ['OPENING_EVIDENCE_REQUIRED',409,'Attach retained clean source evidence before opening approval.'],
      ['OPENING_CONTROL_DIFFERENCE',409,'The control balance changed. The opening breakdown no longer agrees.'],
      ['OPENING_INVENTORY_DIFFERENCE',409,'The inventory control no longer agrees to the item breakdown.'],
      ['OPENING_STOCK_DIFFERENCE',409,'The physical stock count changed after the opening preview.'],
      ['OPENING_STOCK_COVERAGE',409,'The stock baseline must cover all existing items and reservations must be resolved.'],
      ['SESSION_EXPIRED',401,'Your session is no longer active. Sign in again.'],
      ['FORBIDDEN',403,'Your access changed. This action is no longer allowed.'],
      ['RESOURCE_DENIED',403,'Your access does not include this customer, item, or account.'],
      ['ASSET_HAS_ACTIVITY',409,'This asset has posted activity. Use a controlled adjustment rather than cancelling its original acquisition.'],
      ['ASSET_HAS_SETTLEMENTS',409,'This acquisition has a pending or posted settlement. Correct the settlement before cancellation.'],
      ['ASSET_INACTIVE',409,'This asset is not posted or has already been disposed.'],
      ['ASSET_PENDING',409,'Resolve the pending asset event before another event.'],
      ['ASSET_DATE',409,'The event must follow the latest posted asset event.'],
      ['ASSET_CHANGED',409,'The asset changed. Review a fresh preview.'],
      ['NO_DEPRECIATION',409,'No additional depreciation is due through that date.'],
      ['ADVANCE_EXCEEDED',409,'An advance balance changed after another pending or posted application.'],
      ['ADVANCE_SOURCE',409,'The selected advance sources no longer agree with this payment.'],
      ['ALLOCATION_REQUIRED',409,'The payment references must agree exactly and commit with the document.'],
      ['OVER_ALLOCATION',409,'The invoice or bill balance changed. Review a fresh settlement preview.'],
      ['SETTLEMENT_TARGET',409,'The invoice or bill is no longer available for this settlement.'],
      ['DOCUMENT_IMMUTABLE',409,'The transaction was already reviewed or changed.'],
      ['UNIQUE constraint failed: documents',409,'This reference is already in use.'],
      ['CHECK constraint failed',409,'The stock or financial constraints changed. Refresh and review the transaction.']
    ]) if(message.includes(code)) throw new AppError(status,code.startsWith('UNIQUE')?'DUPLICATE_REFERENCE':code.startsWith('CHECK')?'CONSTRAINT_CONFLICT':code,description);
    throw error;
  }
  return null;
}
export async function submit(db,actor,companyId,input,key) {
  fields(input,['document','previewDigest','expectedRevision','assistantTaskId','fileIds']);
  const company=await companyAccess(db,actor,companyId);
  requireThat(canPrepare(company.role),403,'PREPARATION_DENIED','Your role cannot prepare transactions.');
  const payloadHash=await hash(canonical(input));
  const retry=()=>retryResult(db,actor,companyId,'submit',key,payloadHash);
  const prior=await retry(); if(prior) return prior;
  const fileIds=input.fileIds??[];
  requireThat(Array.isArray(fileIds)&&fileIds.length<=10&&new Set(fileIds).size===fileIds.length&&fileIds.every(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)),422,'INVALID_EVIDENCE','Attach up to ten distinct supporting files.');
  if(fileIds.length)requireThat(db.schemaVersion>=5,503,'UPGRADE_REQUIRED','Supporting files require private storage.');
  for(const fileId of fileIds){
    const file=await db.prepare("SELECT id FROM stored_files f WHERE company_id=? AND id=? AND visibility='company' AND scan_state='clean' AND NOT EXISTS(SELECT 1 FROM file_removals r WHERE r.company_id=f.company_id AND r.file_id=f.id)").bind(companyId,fileId).first();
    requireThat(file,409,'FILE_NOT_READY','Every supporting file must belong to this company, pass scanning and remain available.');
    const links=(await db.prepare('SELECT document_id FROM document_attachments WHERE company_id=? AND file_id=?').bind(companyId,fileId).all()).results;
    for(const link of links)await documentDetail(db,actor,companyId,link.document_id);
  }
  if(input.assistantTaskId){
    requireThat(db.schemaVersion>=5&&typeof input.assistantTaskId==='string',422,'AI_TASK_REQUIRED','Use a validated assistant proposal.');
    const task=await db.prepare("SELECT response_json FROM assistant_tasks WHERE company_id=? AND id=? AND user_id=? AND status='complete'").bind(companyId,input.assistantTaskId,actor.id).first();
    requireThat(task?.response_json?.proposal&&canonical(task.response_json.proposal.document)===canonical(input.document),409,'AI_PROPOSAL_CHANGED','This document no longer matches the assistant proposal. Prepare and review it again.');
  }
  const effect=await preview(db,actor,companyId,input.document);
  requireThat(input.expectedRevision===effect.revision && input.previewDigest===effect.digest,409,'STALE_PREVIEW','Review a fresh accounting preview before submitting.');
  const id=crypto.randomUUID(), operationId=crypto.randomUUID(), time=now(), document=effect.document;
  requireThat(!effect.approval?.requiresEvidence||fileIds.length>0,409,'EVIDENCE_REQUIRED','Attach clean supporting evidence before submitting under this company policy.');
  const direct=effect.approval?.mode==='direct';
  const result={id,status:direct?'posted':'pending',version:direct?2:1,...(effect.approval?{approval:effect.approval}:{})};
  const statements=[guard(db,actor,companyId,'submit',key,payloadHash,effect.revision,result,operationId,time,input.assistantTaskId??null),
    db.prepare('INSERT INTO documents(company_id,id,kind,date,reference,description,party_id,item_id,quantity,amount_minor,payload_json,payload_hash,preview_json,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(companyId,id,document.kind,document.date,document.reference,document.description,document.partyId??null,document.itemId??null,document.quantity?Number(document.quantity):null,minor(effect.amount),JSON.stringify(document),await hash(canonical(document)),JSON.stringify(effect),actor.id,time)
  ];
  if(document.kind==='stock_issue') statements.push(db.prepare('UPDATE items SET reserved=reserved+? WHERE company_id=? AND id=?').bind(Number(document.quantity),companyId,document.itemId));
  if(effect.allocation)statements.push(db.prepare('INSERT INTO document_allocations(company_id,settlement_id,target_id,amount_minor) VALUES(?,?,?,?)').bind(companyId,id,effect.allocation.targetDocumentId,minor(effect.amount)));
  if(paymentKinds.includes(document.kind)){for(const r of document.allocations)statements.push(db.prepare('INSERT INTO document_allocations(company_id,settlement_id,target_id,amount_minor) VALUES(?,?,?,?)').bind(companyId,id,r.targetDocumentId,minor(r.amount)));for(const r of document.sources)statements.push(db.prepare('INSERT INTO payment_sources(company_id,consumer_id,source_id,amount_minor) VALUES(?,?,?,?)').bind(companyId,id,r.paymentId,minor(r.amount)));}
  for(const fileId of fileIds)statements.push(db.prepare('INSERT INTO document_attachments(company_id,document_id,file_id,actor_id,created_at) VALUES(?,?,?,?,?)').bind(companyId,id,fileId,actor.id,time),db.prepare('INSERT INTO file_events(id,company_id,file_id,actor_id,action,reason,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),companyId,fileId,actor.id,'attached',id,time));
  if(direct){
    if(document.kind==='stock_issue')statements.push(db.prepare('UPDATE items SET on_hand=on_hand-?,reserved=reserved-? WHERE company_id=? AND id=?').bind(Number(document.quantity),Number(document.quantity),companyId,document.itemId));
    statements.push(...journalStatements(db,companyId,id,document.date,effect.lines));
    statements.push(db.prepare("UPDATE documents SET status='posted',reviewed_by=?,version=version+1 WHERE company_id=? AND id=?").bind(actor.id,companyId,id));
  }
  statements.push(...finish(db,actor,companyId,operationId,id,direct?'posted_direct':'submitted',time));
  return await transact(db,statements,retry)??result;
}
function journalStatements(db,companyId,documentId,date,lines){const id=crypto.randomUUID();return [db.prepare('INSERT INTO journals(company_id,id,document_id,date) VALUES(?,?,?,?)').bind(companyId,id,documentId,date),...lines.map((line,index)=>db.prepare('INSERT INTO journal_lines(company_id,journal_id,line_no,account_id,debit_minor,credit_minor) VALUES(?,?,?,?,?,?)').bind(companyId,id,index+1,line.accountId,minor(line.debit),minor(line.credit))),db.prepare("UPDATE journals SET status='posted' WHERE company_id=? AND id=?").bind(companyId,id)];}
export async function review(db,actor,companyId,documentId,input,key,action) {
  fields(input,['expectedVersion','expectedEvidenceRevision']);
  requireThat(Number.isSafeInteger(input.expectedVersion) && input.expectedVersion>0,422,'VERSION_REQUIRED','Provide the transaction version you reviewed.');
  const company=await companyAccess(db,actor,companyId);
  requireThat(canReview(company.role),403,'APPROVAL_DENIED','Your role cannot review transactions.');
  const payloadHash=await hash(canonical({documentId,action,...input}));
  const retry=()=>retryResult(db,actor,companyId,action,key,payloadHash);
  const prior=await retry(); if(prior) return prior;
  const document=await db.prepare('SELECT * FROM documents WHERE company_id=? AND id=?').bind(companyId,documentId).first();
  requireThat(document,404,'NOT_FOUND','The transaction is unavailable.');
  requireThat(document.prepared_by!==actor.id,403,'SELF_APPROVAL_DENIED','Another authorized person must review the transaction you prepared.');
  requireThat(document.status==='pending' && document.version===input.expectedVersion,409,'STALE_DOCUMENT','The transaction has already been reviewed or changed.');
  if(db.schemaVersion>=5){const evidence=await db.prepare('SELECT revision FROM document_evidence_versions WHERE company_id=? AND document_id=?').bind(companyId,documentId).first();requireThat((input.expectedEvidenceRevision??0)===(evidence?.revision??0),409,'STALE_EVIDENCE','The attached evidence changed. Reopen and review the current evidence before deciding.');}
  const effect=JSON.parse(document.preview_json), denials=await denied(db,companyId,actor.id);
  if(document.kind==='opening_balance')requireThat(denials.length===0,403,'OPENING_ACCESS','Full resource access is required to review an opening snapshot.');
  if(document.party_id) allowedResource(denials,'party',document.party_id);
  if(document.item_id) allowedResource(denials,'item',document.item_id);
  for(const line of effect.lines) allowedResource(denials,'account',line.accountId);
  for(const id of effect.resourceAccounts??[])allowedResource(denials,'account',id);
  if(effect.allocation){
    const target=await db.prepare('SELECT preview_json FROM documents WHERE company_id=? AND id=?').bind(companyId,effect.allocation.targetDocumentId).first();
    requireThat(target,409,'SETTLEMENT_TARGET','The underlying invoice or bill is unavailable.');
    for(const line of JSON.parse(target.preview_json).lines)allowedResource(denials,'account',line.accountId);for(const id of JSON.parse(target.preview_json).resourceAccounts??[])allowedResource(denials,'account',id);
  }
  if(paymentKinds.includes(document.kind))for(const r of [...effect.document.allocations.map(a=>a.targetDocumentId),...effect.document.sources.map(a=>a.paymentId)]){const target=await db.prepare('SELECT preview_json FROM documents WHERE company_id=? AND id=?').bind(companyId,r).first();requireThat(target,409,'SETTLEMENT_TARGET','A payment reference is unavailable.');for(const line of JSON.parse(target.preview_json).lines)allowedResource(denials,'account',line.accountId);for(const id of JSON.parse(target.preview_json).resourceAccounts??[])allowedResource(denials,'account',id);}
  requireThat(await hash(canonical(JSON.parse(document.payload_json)))===document.payload_hash,409,'PAYLOAD_CHANGED','The stored document does not match its approved payload.');
  if(document.kind==='opening_balance'&&action==='approve'){
    const currentLines=[],current=await openingEffect(db,actor,companyId,effect.document,(accountId,debit,credit)=>currentLines.push({accountId,debit:decimal(debit),credit:decimal(credit)}),{review:true,excludeId:documentId});
    requireThat(canonical(current.opening)===canonical(effect.opening)&&canonical(currentLines)===canonical(effect.lines.map(l=>({accountId:l.accountId,debit:l.debit,credit:l.credit}))),409,'STALE_OPENING','Opening sources changed after submission. Return the snapshot and prepare it again.');
    requireThat(await db.prepare("SELECT a.file_id FROM document_attachments a JOIN stored_files f ON f.company_id=a.company_id AND f.id=a.file_id WHERE a.company_id=? AND a.document_id=? AND f.scan_state='clean' AND NOT EXISTS(SELECT 1 FROM attachment_withdrawals w WHERE w.company_id=a.company_id AND w.document_id=a.document_id AND w.file_id=a.file_id) LIMIT 1").bind(companyId,documentId).first(),409,'OPENING_EVIDENCE_REQUIRED','Attach retained clean source evidence before approving opening balances.');
  }
  const operationId=crypto.randomUUID(),time=now(),status=action==='approve'?'posted':'rejected';
  const result={id:documentId,status,version:document.version+1};
  const statements=[guard(db,actor,companyId,action,key,payloadHash,company.revision,result,operationId,time)];
  if(document.kind==='stock_issue') statements.push(db.prepare(action==='approve'?'UPDATE items SET on_hand=on_hand-?,reserved=reserved-? WHERE company_id=? AND id=?':'UPDATE items SET reserved=reserved-? WHERE company_id=? AND id=?').bind(...(action==='approve'?[document.quantity,document.quantity,companyId,document.item_id]:[document.quantity,companyId,document.item_id])));
  if(action==='approve'&&!(document.kind==='opening_balance'&&effect.document.mode==='reconcile')) {
    const journalId=crypto.randomUUID();
    statements.push(db.prepare('INSERT INTO journals(company_id,id,document_id,date) VALUES(?,?,?,?)').bind(companyId,journalId,documentId,document.date));
    effect.lines.forEach((line,index)=>statements.push(db.prepare('INSERT INTO journal_lines(company_id,journal_id,line_no,account_id,debit_minor,credit_minor) VALUES(?,?,?,?,?,?)').bind(companyId,journalId,index+1,line.accountId,minor(line.debit),minor(line.credit))));
    statements.push(db.prepare("UPDATE journals SET status='posted' WHERE company_id=? AND id=?").bind(companyId,journalId));
  }
  statements.push(db.prepare('UPDATE documents SET status=?,reviewed_by=?,version=version+1 WHERE company_id=? AND id=?').bind(status,actor.id,companyId,documentId));
  if(action==='approve'&&document.kind==='opening_balance')statements.push(db.prepare('SELECT saven_apply_opening(?,?)').bind(companyId,documentId));
  statements.push(...finish(db,actor,companyId,operationId,documentId,action==='approve'?'posted':'rejected',time));
  return await transact(db,statements,retry)??result;
}

export async function workspace(db,actor,companyId) {
  const company=await companyAccess(db,actor,companyId), denials=await denied(db,companyId,actor.id);
  const deniedSet=new Set(denials.map(row=>`${row.resource_type}:${row.resource_id}`));
  const [parties,items,documents,accounts,audit]=await Promise.all([
    db.prepare('SELECT id,name FROM parties WHERE company_id=? ORDER BY name').bind(companyId).all(),
    db.prepare('SELECT id,name,store,unit,on_hand,reserved,unit_cost_minor FROM items WHERE company_id=? ORDER BY name').bind(companyId).all(),
    db.prepare('SELECT d.*,'+allocationVisibility(db)+(db.schemaVersion>=5?'coalesce((SELECT v.revision FROM document_evidence_versions v WHERE v.company_id=d.company_id AND v.document_id=d.id),0) AS evidence_revision,':'')+'u.name AS preparer_name,r.name AS reviewer_name FROM documents d JOIN users u ON u.id=d.prepared_by LEFT JOIN users r ON r.id=d.reviewed_by WHERE d.company_id=? ORDER BY d.created_at DESC,d.id DESC LIMIT 100').bind(companyId).all(),
    db.prepare('SELECT id,code,name FROM accounts WHERE company_id=? ORDER BY code').bind(companyId).all(),
    db.prepare('SELECT a.*,u.name AS actor_name,d.reference FROM audit_events a JOIN users u ON u.id=a.actor_id JOIN documents d ON d.company_id=a.company_id AND d.id=a.document_id WHERE a.company_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 100').bind(companyId).all()
  ]);
  const visibleDocs=documents.results.filter(row=>!(row.kind==='opening_balance'&&denials.length)&&!deniedSet.has(`party:${row.party_id}`)&&!deniedSet.has(`item:${row.item_id}`)&&[...JSON.parse(row.preview_json).lines,...(JSON.parse(row.preview_json).resourceAccounts??[]).map(accountId=>({accountId})),...(row.target_preview_json?JSON.parse(row.target_preview_json).lines:[])].every(line=>!deniedSet.has(`account:${line.accountId}`)));
  const docIds=new Set(visibleDocs.map(row=>row.id));
  return {company,permissions:{prepare:canPrepare(company.role),review:canReview(company.role)},
    parties:parties.results.filter(row=>!deniedSet.has(`party:${row.id}`)),
    items:items.results.filter(row=>!deniedSet.has(`item:${row.id}`)),
    accounts:accounts.results.filter(row=>!deniedSet.has(`account:${row.id}`)),
    documents:visibleDocs.map(row=>({id:row.id,kind:row.kind,date:row.date,reference:row.reference,description:row.description,status:row.status,version:row.version,evidenceRevision:row.evidence_revision??0,preparedBy:row.prepared_by,preparer:row.preparer_name,reviewer:row.reviewer_name,amount:decimal(row.amount_minor),preview:JSON.parse(row.preview_json)})),
    audit:audit.results.filter(row=>docIds.has(row.document_id)).map(row=>({id:row.id,documentId:row.document_id,reference:row.reference,actor:row.actor_name,action:row.action,time:row.created_at}))
  };
}

function allocationVisibility(db){if(!(db.schemaVersion>=4))return '';if(db.schemaVersion<11)return '(SELECT t.preview_json FROM document_allocations a JOIN documents t ON t.company_id=a.company_id AND t.id=a.target_id WHERE a.company_id=d.company_id AND a.settlement_id=d.id) AS target_preview_json,';return "(SELECT jsonb_build_object('lines',coalesce(jsonb_agg(x.line),'[]'::jsonb))::text FROM(SELECT l AS line FROM document_allocations a JOIN documents t ON t.company_id=a.company_id AND t.id=a.target_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.preview_json::jsonb->'lines','[]')||coalesce((SELECT jsonb_agg(jsonb_build_object('accountId',r)) FROM jsonb_array_elements_text(coalesce(t.preview_json::jsonb->'resourceAccounts','[]')) r),'[]')) l WHERE a.company_id=d.company_id AND a.settlement_id=d.id UNION ALL SELECT l AS line FROM payment_sources a JOIN documents t ON t.company_id=a.company_id AND t.id=a.source_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.preview_json::jsonb->'lines','[]')||coalesce((SELECT jsonb_agg(jsonb_build_object('accountId',r)) FROM jsonb_array_elements_text(coalesce(t.preview_json::jsonb->'resourceAccounts','[]')) r),'[]')) l WHERE a.company_id=d.company_id AND a.consumer_id=d.id) x) AS target_preview_json,";}
export async function documentDetail(db,actor,companyId,id){
  await companyAccess(db,actor,companyId);
  const row=await db.prepare('SELECT d.*,'+allocationVisibility(db)+(db.schemaVersion>=5?'coalesce((SELECT v.revision FROM document_evidence_versions v WHERE v.company_id=d.company_id AND v.document_id=d.id),0) AS evidence_revision,':'')+'u.name AS preparer_name,r.name AS reviewer_name FROM documents d JOIN users u ON u.id=d.prepared_by LEFT JOIN users r ON r.id=d.reviewed_by WHERE d.company_id=? AND d.id=?').bind(companyId,id).first();
  requireThat(row,404,'NOT_FOUND','The transaction is unavailable.');
  const restrictions=await denied(db,companyId,actor.id),effect=JSON.parse(row.preview_json);
  if(row.kind==='opening_balance')requireThat(restrictions.length===0,403,'OPENING_ACCESS','Full resource access is required to inspect an opening snapshot.');
  if(row.party_id)allowedResource(restrictions,'party',row.party_id);
  if(row.item_id)allowedResource(restrictions,'item',row.item_id);
  for(const line of effect.lines)allowedResource(restrictions,'account',line.accountId);
  for(const id of effect.resourceAccounts??[])allowedResource(restrictions,'account',id);
  if(row.target_preview_json)for(const line of JSON.parse(row.target_preview_json).lines)allowedResource(restrictions,'account',line.accountId);
  let related=[];
  if(db.schemaVersion>=6){const parent=effect.document.openingDocumentId??effect.document.originalDocumentId??effect.allocation?.targetDocumentId??null;const rows=(await db.prepare("SELECT d.id,d.kind,d.date,d.reference,d.description,d.status,d.amount_minor,d.party_id,d.item_id,d.preview_json FROM documents d WHERE d.company_id=? AND(d.id=? OR d.payload_json::jsonb->>'openingDocumentId'=? OR(d.kind='reversal' AND d.payload_json::jsonb->>'originalDocumentId'=?) OR EXISTS(SELECT 1 FROM document_allocations a WHERE a.company_id=d.company_id AND a.settlement_id=d.id AND a.target_id=?)) ORDER BY d.date,d.created_at,d.id LIMIT 200").bind(companyId,parent,id,id,id).all()).results;
   related=rows.filter(d=>!restrictions.some(r=>r.resource_type==='party'&&r.resource_id===d.party_id||r.resource_type==='item'&&r.resource_id===d.item_id||r.resource_type==='account'&&[...JSON.parse(d.preview_json).lines,...(JSON.parse(d.preview_json).resourceAccounts??[]).map(accountId=>({accountId}))].some(l=>l.accountId===r.resource_id))).map(d=>({id:d.id,kind:d.kind,date:d.date,reference:d.reference,description:d.description,status:d.status,amount:decimal(d.amount_minor),relationship:d.id===parent?'original':'related'}));
  }
  return {id:row.id,kind:row.kind,date:row.date,reference:row.reference,description:row.description,status:row.status,version:row.version,evidenceRevision:row.evidence_revision??0,preparedBy:row.prepared_by,preparer:row.preparer_name,reviewer:row.reviewer_name,amount:decimal(row.amount_minor),preview:effect,related};
}
