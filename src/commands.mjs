import { AppError, requireThat } from './errors.mjs';
import { canonical, hash } from './crypto.mjs';
import { decimal, minor, quantity, multiplied } from './money.mjs';
import { now, companyAccess, canPrepare, canReview } from './auth.mjs';
import {extendedKinds,normalizeExtended,extendedEffect} from './extended-accounting.mjs';

function fields(value, allowed) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 422, 'INVALID_DOCUMENT', 'Provide a document object.');
  requireThat(Object.keys(value).every(key => allowed.includes(key)), 422, 'UNKNOWN_FIELD', 'The document contains an unsupported field.');
}
function text(value, field, max = 160) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001f]/.test(value), 422, 'INVALID_FIELD', `Provide a valid ${field} (up to ${max} characters).`);
  return value.trim();
}
export function normalize(input) {
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
  let amount, stock = null,allocation=null;
  if(extendedKinds.includes(document.kind)){
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
  if(allocation)effects.allocation=allocation;
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
      ['SESSION_EXPIRED',401,'Your session is no longer active. Sign in again.'],
      ['FORBIDDEN',403,'Your access changed. This action is no longer allowed.'],
      ['RESOURCE_DENIED',403,'Your access does not include this customer, item, or account.'],
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
  fields(input,['document','previewDigest','expectedRevision','assistantTaskId']);
  const company=await companyAccess(db,actor,companyId);
  requireThat(canPrepare(company.role),403,'PREPARATION_DENIED','Your role cannot prepare transactions.');
  const payloadHash=await hash(canonical(input));
  const retry=()=>retryResult(db,actor,companyId,'submit',key,payloadHash);
  const prior=await retry(); if(prior) return prior;
  if(input.assistantTaskId){
    requireThat(db.schemaVersion>=5&&typeof input.assistantTaskId==='string',422,'AI_TASK_REQUIRED','Use a validated assistant proposal.');
    const task=await db.prepare("SELECT response_json FROM assistant_tasks WHERE company_id=? AND id=? AND user_id=? AND status='complete'").bind(companyId,input.assistantTaskId,actor.id).first();
    requireThat(task?.response_json?.proposal&&canonical(task.response_json.proposal.document)===canonical(input.document),409,'AI_PROPOSAL_CHANGED','This document no longer matches the assistant proposal. Prepare and review it again.');
  }
  const effect=await preview(db,actor,companyId,input.document);
  requireThat(input.expectedRevision===effect.revision && input.previewDigest===effect.digest,409,'STALE_PREVIEW','Review a fresh accounting preview before submitting.');
  const id=crypto.randomUUID(), operationId=crypto.randomUUID(), time=now(), document=effect.document;
  const result={id,status:'pending',version:1};
  const statements=[guard(db,actor,companyId,'submit',key,payloadHash,effect.revision,result,operationId,time,input.assistantTaskId??null),
    db.prepare('INSERT INTO documents(company_id,id,kind,date,reference,description,party_id,item_id,quantity,amount_minor,payload_json,payload_hash,preview_json,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(companyId,id,document.kind,document.date,document.reference,document.description,document.partyId??null,document.itemId??null,document.quantity?Number(document.quantity):null,minor(effect.amount),JSON.stringify(document),await hash(canonical(document)),JSON.stringify(effect),actor.id,time)
  ];
  if(document.kind==='stock_issue') statements.push(db.prepare('UPDATE items SET reserved=reserved+? WHERE company_id=? AND id=?').bind(Number(document.quantity),companyId,document.itemId));
  if(effect.allocation)statements.push(db.prepare('INSERT INTO document_allocations(company_id,settlement_id,target_id,amount_minor) VALUES(?,?,?,?)').bind(companyId,id,effect.allocation.targetDocumentId,minor(effect.amount)));
  statements.push(...finish(db,actor,companyId,operationId,id,'submitted',time));
  return await transact(db,statements,retry)??result;
}
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
  if(document.party_id) allowedResource(denials,'party',document.party_id);
  if(document.item_id) allowedResource(denials,'item',document.item_id);
  for(const line of effect.lines) allowedResource(denials,'account',line.accountId);
  if(effect.allocation){
    const target=await db.prepare('SELECT preview_json FROM documents WHERE company_id=? AND id=?').bind(companyId,effect.allocation.targetDocumentId).first();
    requireThat(target,409,'SETTLEMENT_TARGET','The underlying invoice or bill is unavailable.');
    for(const line of JSON.parse(target.preview_json).lines)allowedResource(denials,'account',line.accountId);
  }
  requireThat(await hash(canonical(JSON.parse(document.payload_json)))===document.payload_hash,409,'PAYLOAD_CHANGED','The stored document does not match its approved payload.');
  const operationId=crypto.randomUUID(),time=now(),status=action==='approve'?'posted':'rejected';
  const result={id:documentId,status,version:document.version+1};
  const statements=[guard(db,actor,companyId,action,key,payloadHash,company.revision,result,operationId,time)];
  if(document.kind==='stock_issue') statements.push(db.prepare(action==='approve'?'UPDATE items SET on_hand=on_hand-?,reserved=reserved-? WHERE company_id=? AND id=?':'UPDATE items SET reserved=reserved-? WHERE company_id=? AND id=?').bind(...(action==='approve'?[document.quantity,document.quantity,companyId,document.item_id]:[document.quantity,companyId,document.item_id])));
  if(action==='approve') {
    const journalId=crypto.randomUUID();
    statements.push(db.prepare('INSERT INTO journals(company_id,id,document_id,date) VALUES(?,?,?,?)').bind(companyId,journalId,documentId,document.date));
    effect.lines.forEach((line,index)=>statements.push(db.prepare('INSERT INTO journal_lines(company_id,journal_id,line_no,account_id,debit_minor,credit_minor) VALUES(?,?,?,?,?,?)').bind(companyId,journalId,index+1,line.accountId,minor(line.debit),minor(line.credit))));
    statements.push(db.prepare("UPDATE journals SET status='posted' WHERE company_id=? AND id=?").bind(companyId,journalId));
  }
  statements.push(db.prepare('UPDATE documents SET status=?,reviewed_by=?,version=version+1 WHERE company_id=? AND id=?').bind(status,actor.id,companyId,documentId),...finish(db,actor,companyId,operationId,documentId,action==='approve'?'posted':'rejected',time));
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
  const visibleDocs=documents.results.filter(row=>!deniedSet.has(`party:${row.party_id}`)&&!deniedSet.has(`item:${row.item_id}`)&&[...JSON.parse(row.preview_json).lines,...(row.target_preview_json?JSON.parse(row.target_preview_json).lines:[])].every(line=>!deniedSet.has(`account:${line.accountId}`)));
  const docIds=new Set(visibleDocs.map(row=>row.id));
  return {company,permissions:{prepare:canPrepare(company.role),review:canReview(company.role)},
    parties:parties.results.filter(row=>!deniedSet.has(`party:${row.id}`)),
    items:items.results.filter(row=>!deniedSet.has(`item:${row.id}`)),
    accounts:accounts.results.filter(row=>!deniedSet.has(`account:${row.id}`)),
    documents:visibleDocs.map(row=>({id:row.id,kind:row.kind,date:row.date,reference:row.reference,description:row.description,status:row.status,version:row.version,evidenceRevision:row.evidence_revision??0,preparedBy:row.prepared_by,preparer:row.preparer_name,reviewer:row.reviewer_name,amount:decimal(row.amount_minor),preview:JSON.parse(row.preview_json)})),
    audit:audit.results.filter(row=>docIds.has(row.document_id)).map(row=>({id:row.id,documentId:row.document_id,reference:row.reference,actor:row.actor_name,action:row.action,time:row.created_at}))
  };
}

function allocationVisibility(db){return db.schemaVersion>=4?'(SELECT t.preview_json FROM document_allocations a JOIN documents t ON t.company_id=a.company_id AND t.id=a.target_id WHERE a.company_id=d.company_id AND a.settlement_id=d.id) AS target_preview_json,':'';}
export async function documentDetail(db,actor,companyId,id){
  await companyAccess(db,actor,companyId);
  const row=await db.prepare('SELECT d.*,'+allocationVisibility(db)+(db.schemaVersion>=5?'coalesce((SELECT v.revision FROM document_evidence_versions v WHERE v.company_id=d.company_id AND v.document_id=d.id),0) AS evidence_revision,':'')+'u.name AS preparer_name,r.name AS reviewer_name FROM documents d JOIN users u ON u.id=d.prepared_by LEFT JOIN users r ON r.id=d.reviewed_by WHERE d.company_id=? AND d.id=?').bind(companyId,id).first();
  requireThat(row,404,'NOT_FOUND','The transaction is unavailable.');
  const restrictions=await denied(db,companyId,actor.id),effect=JSON.parse(row.preview_json);
  if(row.party_id)allowedResource(restrictions,'party',row.party_id);
  if(row.item_id)allowedResource(restrictions,'item',row.item_id);
  for(const line of effect.lines)allowedResource(restrictions,'account',line.accountId);
  if(row.target_preview_json)for(const line of JSON.parse(row.target_preview_json).lines)allowedResource(restrictions,'account',line.accountId);
  let related=[];
  if(db.schemaVersion>=6){const parent=effect.document.originalDocumentId??effect.allocation?.targetDocumentId??null;const rows=(await db.prepare("SELECT d.id,d.kind,d.date,d.reference,d.description,d.status,d.amount_minor,d.party_id,d.item_id,d.preview_json FROM documents d WHERE d.company_id=? AND(d.id=? OR(d.kind='reversal' AND d.payload_json::jsonb->>'originalDocumentId'=?) OR EXISTS(SELECT 1 FROM document_allocations a WHERE a.company_id=d.company_id AND a.settlement_id=d.id AND a.target_id=?)) ORDER BY d.date,d.created_at,d.id LIMIT 200").bind(companyId,parent,id,id).all()).results;
   related=rows.filter(d=>!restrictions.some(r=>r.resource_type==='party'&&r.resource_id===d.party_id||r.resource_type==='item'&&r.resource_id===d.item_id||r.resource_type==='account'&&JSON.parse(d.preview_json).lines.some(l=>l.accountId===r.resource_id))).map(d=>({id:d.id,kind:d.kind,date:d.date,reference:d.reference,description:d.description,status:d.status,amount:decimal(d.amount_minor),relationship:d.id===parent?'original':'related'}));
  }
  return {id:row.id,kind:row.kind,date:row.date,reference:row.reference,description:row.description,status:row.status,version:row.version,evidenceRevision:row.evidence_revision??0,preparedBy:row.prepared_by,preparer:row.preparer_name,reviewer:row.reviewer_name,amount:decimal(row.amount_minor),preview:effect,related};
}
