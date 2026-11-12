import {randomUUID} from 'node:crypto';
import {companyAccess,canPrepare,now} from './auth.mjs';
import {documentDetail} from './commands.mjs';
import {requireThat} from './errors.mjs';
import {object,text} from './operating.mjs';
import {inspectFile,fileBody,fileId} from './object-store.mjs';

const admin=company=>['owner','admin'].includes(company.role);
export async function fileRecord(db,actor,companyId,id,{clean=true}={}){
 await companyAccess(db,actor,companyId);
 const row=await db.prepare('SELECT f.* FROM stored_files f WHERE f.company_id=? AND f.id=? AND NOT EXISTS(SELECT 1 FROM file_removals r WHERE r.company_id=f.company_id AND r.file_id=f.id)').bind(companyId,id).first();
 requireThat(row,404,'FILE_NOT_FOUND','This file is unavailable or outside your access.');
 requireThat(!clean||row.scan_state==='clean',409,'FILE_QUARANTINED','This file has not passed virus scanning.');
 // A file attached to a restricted transaction inherits that transaction's
 // restrictions, even if a person finds its file ID or Drive listing.
 const links=(await db.prepare('SELECT document_id FROM document_attachments WHERE company_id=? AND file_id=?').bind(companyId,id).all()).results;
 for(const link of links)await documentDetail(db,actor,companyId,link.document_id);
 return row;
}
function event(db,actor,companyId,id,action,reason=''){return db.prepare('INSERT INTO file_events(id,company_id,file_id,actor_id,action,reason,created_at) VALUES(?,?,?,?,?,?,?)').bind(randomUUID(),companyId,id,actor.id,action,reason,now());}
export async function listFiles(db,actor,companyId,documentId){
 const company=await companyAccess(db,actor,companyId);if(documentId)await documentDetail(db,actor,companyId,documentId);
 const rows=(await db.prepare('SELECT f.* FROM stored_files f WHERE f.company_id=? AND NOT EXISTS(SELECT 1 FROM file_removals r WHERE r.company_id=f.company_id AND r.file_id=f.id)'+(documentId?' AND EXISTS(SELECT 1 FROM document_attachments a WHERE a.company_id=f.company_id AND a.file_id=f.id AND a.document_id=?)':'')+' ORDER BY f.created_at DESC,f.id DESC LIMIT 201').bind(...(documentId?[companyId,documentId]:[companyId])).all()).results;
 const visible=[];
 for(const row of rows.slice(0,200)){try{await fileRecord(db,actor,companyId,row.id,{clean:false});visible.push(row);}catch(error){if(![403,404].includes(error.status))throw error;}}
 let quota=null;
 if(admin(company))quota=await db.prepare("SELECT coalesce(sum(byte_size),0)::text AS used FROM stored_files WHERE company_id=?").bind(companyId).first();
 return {files:visible,limited:rows.length>200,canUpload:canPrepare(company.role),canAdminister:admin(company),quota:quota?{used:Number(quota.used),companyLimit:1073741824,personalLimit:268435456}:null};
}
async function scanFile(db,actor,companyId,id,bucket,scanner){
 const row=await fileRecord(db,actor,companyId,id,{clean:false});if(row.scan_state==='clean')return {id,scanState:'clean'};
 let state='error';
 try{state=await scanner(await bucket.get(companyId,id,row));}catch(error){await db.batch([db.prepare("UPDATE stored_files SET scan_state='error' WHERE company_id=? AND id=? AND scan_state!='clean'").bind(companyId,id),event(db,actor,companyId,id,'scan_unavailable')]);return {id,scanState:'error',message:'The file is safely quarantined. Virus scanning is currently unavailable; retry later.'};}
 requireThat(['clean','infected'].includes(state),503,'SCANNER_UNAVAILABLE','The scanner returned an invalid result.');
 await db.batch([db.prepare("UPDATE stored_files SET scan_state=? WHERE company_id=? AND id=? AND scan_state!='clean'").bind(state,companyId,id),event(db,actor,companyId,id,state==='clean'?'scan_passed':'scan_infected')]);
 return {id,scanState:state,...(state==='infected'?{message:'This file was quarantined because the scanner detected unsafe content.'}:{})};
}
export async function uploadFile(db,actor,companyId,request,{bucket,scanner}){
 const company=await companyAccess(db,actor,companyId);requireThat(canPrepare(company.role),403,'UPLOAD_DENIED','Your role cannot upload business files.');
 let name;try{name=decodeURIComponent(request.headers.get('x-saven-filename')??'');}catch{requireThat(false,422,'FILE_NAME','Choose a valid filename.');}
 const visibility=request.headers.get('x-saven-visibility')??'company';requireThat(['company','personal'].includes(visibility),422,'FILE_VISIBILITY','Choose company or personal storage.');
 const bytes=await fileBody(request),meta=inspectFile(name,bytes),id=fileId();
 // Objects have no public URL. An object without a committed metadata row is
 // unreachable and is retained for the operator's orphan-reconciliation job.
 await bucket.put(companyId,id,meta,bytes);
 await db.batch([db.prepare('INSERT INTO stored_files(company_id,id,owner_id,name,media_type,sha256,byte_size,visibility,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(companyId,id,actor.id,meta.name,meta.mediaType,meta.sha256,meta.byteSize,visibility,now()),event(db,actor,companyId,id,'uploaded')]);
 return {...await scanFile(db,actor,companyId,id,bucket,scanner),name:meta.name};
}
export async function retryScan(db,actor,companyId,id,services){const company=await companyAccess(db,actor,companyId),row=await fileRecord(db,actor,companyId,id,{clean:false});requireThat(canPrepare(company.role)&&(row.owner_id===actor.id||admin(company)),403,'SCAN_DENIED','Only the uploader or an administrator can retry this scan.');return scanFile(db,actor,companyId,id,services.bucket,services.scanner);}
export async function attachFile(db,actor,companyId,documentId,input){
 object(input,['fileId']);const company=await companyAccess(db,actor,companyId);requireThat(canPrepare(company.role),403,'ATTACHMENT_DENIED','Your role cannot attach evidence.');
 await documentDetail(db,actor,companyId,documentId);const file=await fileRecord(db,actor,companyId,text(input.fileId,'file ID',80));requireThat(file.visibility==='company',409,'PERSONAL_FILE','Upload this evidence to company storage before attaching it to a shared transaction.');
 const existing=await db.prepare('SELECT file_id FROM document_attachments WHERE company_id=? AND document_id=? AND file_id=?').bind(companyId,documentId,file.id).first();if(existing)return {attached:true,replayed:true};
 await db.batch([db.prepare('INSERT INTO document_attachments(company_id,document_id,file_id,actor_id,created_at) VALUES(?,?,?,?,?)').bind(companyId,documentId,file.id,actor.id,now()),event(db,actor,companyId,file.id,'attached',documentId)]);return {attached:true};
}
export async function removeFile(db,actor,companyId,id,input){
 object(input,['reason']);const company=await companyAccess(db,actor,companyId),file=await fileRecord(db,actor,companyId,id,{clean:false}),reason=text(input.reason,'reason',500);
 requireThat(canPrepare(company.role)&&(file.owner_id===actor.id||admin(company)),403,'REMOVAL_DENIED','Only the uploader or an administrator can remove this file.');
 requireThat(!(await db.prepare('SELECT file_id FROM document_attachments WHERE company_id=? AND file_id=? LIMIT 1').bind(companyId,id).first()),409,'EVIDENCE_PROTECTED','This is retained transaction evidence. Ordinary file removal cannot remove it.');
 await db.batch([db.prepare('INSERT INTO file_removals(company_id,file_id,actor_id,reason,created_at) VALUES(?,?,?,?,?)').bind(companyId,id,actor.id,reason,now()),event(db,actor,companyId,id,'removed_from_drive',reason)]);return {removed:true,retained:true};
}
export async function withdrawAttachment(db,actor,companyId,documentId,id,input){
 object(input,['reason']);const company=await companyAccess(db,actor,companyId);requireThat(admin(company),403,'ADMIN_REQUIRED','An administrator must withdraw retained evidence.');await documentDetail(db,actor,companyId,documentId);const reason=text(input.reason,'reason',500);
 const existing=await db.prepare('SELECT file_id FROM attachment_withdrawals WHERE company_id=? AND document_id=? AND file_id=?').bind(companyId,documentId,id).first();if(existing)return {withdrawn:true,retained:true,replayed:true};
 const owner=await db.prepare("SELECT user_id FROM memberships WHERE company_id=? AND role='owner'").bind(companyId).first();
 await db.batch([db.prepare('INSERT INTO attachment_withdrawals(company_id,document_id,file_id,actor_id,reason,created_at) VALUES(?,?,?,?,?,?)').bind(companyId,documentId,id,actor.id,reason,now()),event(db,actor,companyId,id,'evidence_withdrawn',reason),db.prepare('INSERT INTO notifications(id,company_id,user_id,event_type,record_id,message,created_at) VALUES(?,?,?,?,?,?,?)').bind(randomUUID(),companyId,owner.user_id,'evidence.withdrawn',documentId,'Retained evidence was withdrawn by '+actor.name+'. Reason: '+reason,now())]);
 return {withdrawn:true,retained:true,ownerNotified:true};
}
