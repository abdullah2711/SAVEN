import {normalizedJournal} from './engine.mjs';
import {digest} from './sqlite.mjs';
import {decimal} from '../money.mjs';
import {id} from './inventory.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
export function previewReversal(engine,tenant,actor,input){
 check(input&&Object.keys(input).every(k=>['originalId','date','reason'].includes(k))&&id(input.originalId),'Original journal required');
 check(typeof input.reason==='string'&&input.reason.trim().length>0&&input.reason.length<=800,'A correction reason of at most 800 characters is required');
 const db=engine.tenant(tenant),original=db.prepare("SELECT j.*,i.payload FROM journals j JOIN command_inbox i ON i.id=j.id WHERE j.id=? AND i.state='POSTED'").get(input.originalId);check(original,'Posted source journal unavailable');
 const source=JSON.parse(original.payload);engine.policy(tenant,actor,'journal.read',source);engine.policy(tenant,actor,'journal.prepare',source);
 check(typeof input.date==='string'&&input.date>=original.posting_date,'A reversal cannot precede its source posting date');
 check(!db.prepare('SELECT 1 FROM stock_operations WHERE command_id=?').get(input.originalId),'Stock must be corrected through an operational stock workflow');
 check(!db.prepare('SELECT 1 FROM trade_operations WHERE command_id=?').get(input.originalId),'Trade documents need their operational credit/refund workflow');
 check(!db.prepare('SELECT 1 FROM journal_corrections WHERE original_id=?').get(input.originalId),'Source already has a recorded correction');
 const journal={company:original.company,branch:original.branch,date:input.date,narrative:'Reversal of '+original.id+': '+input.reason.trim(),lines:source.lines.map(l=>({account:l.account,debit:decimal(l.credit),credit:decimal(l.debit)}))};
 const normalized=normalizedJournal(journal);engine.policy(tenant,actor,'journal.prepare',normalized);
 return {originalId:original.id,reason:input.reason.trim(),journal,previewDigest:digest({originalId:original.id,journal})};
}
export function acceptReversal(engine,tenant,actor,commandId,input){
 check(input&&Object.keys(input).every(k=>['originalId','date','reason','previewDigest'].includes(k)),'Unknown correction fields');
 const db=engine.tenant(tenant),recorded=db.prepare('SELECT c.*,i.actor,i.payload,i.state FROM journal_corrections c JOIN command_inbox i ON i.id=c.command_id WHERE c.command_id=?').get(commandId);
 if(recorded){const p=JSON.parse(recorded.payload);check(recorded.actor===actor&&recorded.original_id===input.originalId&&recorded.reason===input.reason?.trim()&&p.date===input.date&&digest({originalId:recorded.original_id,journal:{...p,lines:p.lines.map(l=>({account:l.account,debit:decimal(l.debit),credit:decimal(l.credit)}))}})===input.previewDigest,'Correction operation identifier reused for a different payload');engine.policy(tenant,actor,'journal.read',p);return {id:commandId,state:recorded.state,replayed:true};}
 check(!db.prepare('SELECT 1 FROM command_inbox WHERE id=?').get(commandId),'Operation ID belongs to another command');
 const preview=previewReversal(engine,tenant,actor,{originalId:input.originalId,date:input.date,reason:input.reason});check(input.previewDigest===preview.previewDigest,'Correction preview changed or was not accepted');
 return engine.accept(tenant,actor,commandId,preview.journal,{record(store){store.prepare('INSERT INTO journal_corrections VALUES(?,?,?)').run(commandId,preview.originalId,preview.reason);engine.audit(store,commandId,actor,'CORRECTION_ACCEPTED',{originalId:preview.originalId,previewDigest:preview.previewDigest});}});
}
