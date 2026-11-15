import {canonical,transaction} from './sqlite.mjs';
import {normalizedJournal} from './engine.mjs';
import {minor,decimal} from '../money.mjs';
const check=(value,message)=>{if(!value){const error=Error(message);if(message.startsWith('Draft changed')||message==='Draft cannot be submitted')error.status=409;throw error;}};
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);



// Called inside the same owning-tenant transaction as draft creation/acceptance.
export function allocateNumber(db,id,company,kind='JRN'){
 const old=db.prepare('SELECT * FROM document_numbers WHERE id=?').get(id);
 if(old){check(old.company===company&&old.kind===kind,'Number belongs to another document');return old.number;}
 db.prepare('INSERT INTO document_sequences VALUES(?,?,1) ON CONFLICT DO NOTHING').run(company,kind);
 const sequence=db.prepare('UPDATE document_sequences SET next_number=next_number+1 WHERE company=? AND kind=? RETURNING next_number-1 AS n').get(company,kind).n;
 const number=kind+'-'+String(sequence).padStart(6,'0');
 db.prepare('INSERT INTO document_numbers VALUES(?,?,?,?,?)').run(id,company,kind,sequence,number);
 return number;
}
export function commandKind(db,id){
 if(db.prepare('SELECT 1 FROM stock_operations WHERE command_id=?').get(id))return 'STK';
 const trade=db.prepare('SELECT payload FROM trade_operations WHERE command_id=?').get(id);
 if(trade){const kind=JSON.parse(trade.payload).kind;return ({invoice:'INV',bill:'BILL',receipt:'RCPT',payment:'PAY',credit:'CRN',invoice_credit:'CRN',bill_credit:'DBN'})[kind]??'TRD';}
 return 'JRN';
}
function draftPayload(input){
 check(input&&Object.keys(input).every(k=>['company','branch','date','narrative','project','lines'].includes(k)),'Unknown draft fields');
 check(validId(input.company)&&validId(input.branch),'Company and branch required');
 check(typeof input.date==='string'&&input.date.length<=10&&typeof input.narrative==='string'&&input.narrative.length<=1000,'Invalid draft header');
 check(input.project===undefined||typeof input.project==='string'&&input.project.length<=80,'Invalid project reference');
 check(Array.isArray(input.lines)&&input.lines.length<=200,'At most 200 draft lines');
 for(const line of input.lines){check(line&&Object.keys(line).every(k=>['account','debit','credit'].includes(k))&&typeof line.account==='string'&&(line.account===''||validId(line.account)),'Invalid draft account');for(const side of ['debit','credit']){check(typeof line[side]==='string','Draft amounts must be decimal text');if(line[side]!=='')minor(line[side]);}}
 return JSON.parse(canonical(input));
}
function authority(engine,tenant,actor,input,action='journal.prepare'){
 engine.policy(tenant,actor,action,{company:input.company,branch:input.branch,lines:input.lines.filter(l=>l.account).map(l=>({account:l.account,debit:l.debit===''?0:minor(l.debit),credit:l.credit===''?0:minor(l.credit)}))});
}
export function saveDraft(engine,tenant,actor,id,input,revision=0,{sourceId=null}={}){
 check(validId(id)&&Number.isSafeInteger(revision)&&revision>=0,'Draft identity and revision required');
 const payload=draftPayload(input);authority(engine,tenant,actor,payload);
 const db=engine.tenant(tenant);
 return transaction(db,()=>{
  const old=db.prepare('SELECT * FROM journal_drafts WHERE id=?').get(id);
  if(old){check(old.actor===actor&&old.company===input.company&&old.branch===input.branch,'Draft unavailable');check(old.state==='DRAFT'&&old.revision===revision,'Draft changed or was submitted; reload before editing');db.prepare('UPDATE journal_drafts SET payload=?,revision=revision+1,updated_at=? WHERE id=?').run(canonical(payload),engine.clock(),id);}
  else{check(revision===0&&!db.prepare('SELECT 1 FROM command_inbox WHERE id=?').get(id),'Draft already exists or command ID is in use');db.prepare("INSERT INTO journal_drafts VALUES(?,?,?,?,?,1,'DRAFT',?,?,?)").run(id,actor,input.company,input.branch,canonical(payload),sourceId,engine.clock(),engine.clock());}
  const number=allocateNumber(db,id,input.company);engine.audit(db,null,actor,'JOURNAL_DRAFT_SAVED',{id,number,revision:revision+1,sourceId});return {id,number,revision:revision+1,state:'DRAFT'};
 });
}
export function listDrafts(engine,tenant,actor,company,branch){
 engine.policy(tenant,actor,'journal.prepare',{company,branch});
 return engine.tenant(tenant).prepare("SELECT d.*,n.number FROM journal_drafts d JOIN document_numbers n ON n.id=d.id WHERE d.actor=? AND d.company=? AND d.branch=? AND d.state='DRAFT' ORDER BY updated_at DESC").all(actor,company,branch).flatMap(row=>{const payload=JSON.parse(row.payload);try{authority(engine,tenant,actor,payload);const event=engine.tenant(tenant).prepare("SELECT event FROM audit WHERE command_id=? AND event IN('JOURNAL_REMOVED','JOURNAL_RESTORED') ORDER BY id DESC LIMIT 1").get(row.id)?.event;if(event==='JOURNAL_REMOVED')return [];return [{...row,payload}];}catch{return [];}});
}
export function submitDraft(engine,tenant,actor,id,revision,evidence=[]){
 const db=engine.tenant(tenant),row=db.prepare('SELECT * FROM journal_drafts WHERE id=?').get(id);check(row?.actor===actor,'Draft unavailable');
 check(row.revision===revision,'Draft changed; reload before submitting');
 const payload=JSON.parse(row.payload);authority(engine,tenant,actor,payload);
 const journal={...payload,lines:payload.lines.map(l=>({...l,debit:l.debit||'0.00',credit:l.credit||'0.00'})),...(evidence.length?{evidence}:{})};normalizedJournal(journal);
 if(row.state==='SUBMITTED'){const receipt=db.prepare('SELECT state,payload FROM command_inbox WHERE id=?').get(id);check(receipt&&canonical(JSON.parse(receipt.payload))===canonical(normalizedJournal(journal)),'Submitted draft differs');return {id,state:receipt.state,replayed:true};}
 check(row.state==='DRAFT','Draft cannot be submitted');
 return engine.accept(tenant,actor,id,journal,{draftRevision:revision,record(store){const current=store.prepare('SELECT state,revision FROM journal_drafts WHERE id=?').get(id);check(current.state==='DRAFT'&&current.revision===revision,'Draft changed during submission');store.prepare("UPDATE journal_drafts SET state='SUBMITTED',updated_at=? WHERE id=?").run(engine.clock(),id);engine.audit(store,id,actor,'DRAFT_SUBMITTED',{revision});}});
}
export function cancelDraft(engine,tenant,actor,id,revision){
 const db=engine.tenant(tenant),row=db.prepare('SELECT * FROM journal_drafts WHERE id=?').get(id);check(row?.actor===actor,'Draft unavailable');authority(engine,tenant,actor,JSON.parse(row.payload));
 return transaction(db,()=>{check(row.state==='DRAFT'&&row.revision===revision,'Draft changed or submitted');db.prepare("UPDATE journal_drafts SET state='CANCELLED',updated_at=? WHERE id=?").run(engine.clock(),id);engine.audit(db,null,actor,'DRAFT_CANCELLED',{id,revision});return {id,state:'CANCELLED'};});
}
export function decideCommand(engine,tenant,actor,id,{decision,reason,replacementId}={}){
 check(['REJECTED','RETURNED'].includes(decision)&&typeof reason==='string'&&reason.trim().length>0&&reason.length<=800,'Decision and reason required');
 const db=engine.tenant(tenant),row=db.prepare('SELECT * FROM command_inbox WHERE id=?').get(id);check(row,'Command unavailable');const payload=JSON.parse(row.payload),stock=db.prepare('SELECT 1 FROM stock_operations WHERE command_id=?').get(id);
 engine.policy(tenant,actor,stock?'inventory.approve':'journal.approve',payload);check(actor!==row.actor,'Independent review required');
 const prior=db.prepare('SELECT * FROM command_decisions WHERE command_id=?').get(id);if(prior){check(prior.actor===actor&&prior.decision===decision&&prior.reason===reason.trim()&&(prior.replacement_id??null)===(replacementId??null),'Review already decided differently');return {id,state:decision,replacementId:prior.replacement_id,replayed:true};}
 check(row.state==='AWAITING_APPROVAL'&&db.prepare("SELECT 1 FROM approval_requests WHERE command_id=? AND state='PENDING' AND payload_digest=?").get(id,row.digest),'No pending review');
 check(row.lease_until===null||row.lease_until<=engine.clock(),'Command currently being processed');
 if(decision==='RETURNED')check(!stock&&!db.prepare('SELECT 1 FROM trade_operations WHERE command_id=?').get(id)&&validId(replacementId),'Return to draft currently supports manual journals only');
 return transaction(db,()=>{
  if(decision==='RETURNED'){
   check(!db.prepare('SELECT 1 FROM journal_drafts WHERE id=?').get(replacementId)&&!db.prepare('SELECT 1 FROM command_inbox WHERE id=?').get(replacementId),'Replacement ID already in use');
   const copy={...payload,lines:payload.lines.map(l=>({account:l.account,debit:decimal(l.debit),credit:decimal(l.credit)}))};delete copy.evidence;
   db.prepare("INSERT INTO journal_drafts VALUES(?,?,?,?,?,1,'DRAFT',?,?,?)").run(replacementId,row.actor,payload.company,payload.branch,canonical(copy),id,engine.clock(),engine.clock());allocateNumber(db,replacementId,payload.company);
  }
  db.prepare("UPDATE command_inbox SET state='FAILED',error=?,lease_token=NULL,lease_until=NULL WHERE id=?").run(decision+': '+reason.trim(),id);
  db.prepare('INSERT INTO command_decisions VALUES(?,?,?,?,?,?)').run(id,decision,actor,reason.trim(),replacementId??null,engine.clock());
  engine.audit(db,id,actor,'REVIEW_'+decision,{reason:reason.trim(),replacementId:replacementId??null});return {id,state:decision,replacementId:replacementId??null};
 });
}
