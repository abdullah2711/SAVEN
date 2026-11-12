import {randomUUID} from 'node:crypto';
import {companyAccess,now} from './auth.mjs';
import {workspace,preview,documentDetail} from './commands.mjs';
import {reports,object,text} from './operating.mjs';
import {fileRecord} from './files.mjs';
import {pdfText} from './assistant-provider.mjs';
import {canonical,hash} from './crypto.mjs';
import {AppError,requireThat} from './errors.mjs';

import {assistantSystem as system} from './assistant-contract.mjs';
export class Assistant{
 constructor({provider,bucket,extractPdf=pdfText}={}){Object.assign(this,{provider,bucket,extractPdf});this.active=new Map();}
 async create(db,actor,companyId,input,key){
  await companyAccess(db,actor,companyId);requireThat(this.provider,503,'AI_UNAVAILABLE','The AI model service has not been configured on the server.');object(input,['message','fileIds']);
  requireThat(typeof input.message==='string'&&input.message.trim().length>0&&input.message.length<=6000,422,'AI_MESSAGE','Enter a message of up to 6,000 characters.');
  const fileIds=input.fileIds??[];requireThat(Array.isArray(fileIds)&&fileIds.length<=2&&new Set(fileIds).size===fileIds.length&&fileIds.every(x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x)),422,'AI_FILES','Choose up to two evidence files.');
  requireThat(typeof key==='string'&&/^[a-zA-Z0-9_-]{16,128}$/.test(key),422,'IDEMPOTENCY_REQUIRED','Provide a stable request key.');
  const request={message:input.message.trim(),fileIds},fingerprint=await hash(canonical(request));
  const existing=await db.prepare('SELECT id,payload_hash FROM assistant_tasks WHERE company_id=? AND user_id=? AND command_key=?').bind(companyId,actor.id,key).first();
  if(existing){requireThat(existing.payload_hash===fingerprint,409,'IDEMPOTENCY_CONFLICT','This request key was already used for another message.');this.kick(db,actor,companyId,existing.id);return {id:existing.id,replayed:true};}
  for(const id of fileIds)await fileRecord(db,actor,companyId,id);
  const id=randomUUID();
  try{await db.prepare('INSERT INTO assistant_tasks(company_id,id,user_id,command_key,payload_hash,request_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(companyId,id,actor.id,key,fingerprint,JSON.stringify(request),now()).run();}catch(error){if(String(error.message).includes('AI_DAILY_LIMIT'))throw new AppError(429,'AI_DAILY_LIMIT','Your daily allowance of 50 assistant requests has been reached.');if(String(error.message).includes('AI_BUSY'))throw new AppError(409,'AI_BUSY','Your previous assistant request is still running.');throw error;}
  this.kick(db,actor,companyId,id);return {id,status:'queued'};
 }
 async get(db,actor,companyId,id){
  await companyAccess(db,actor,companyId);const task=await db.prepare('SELECT id,status,request_json,response_json,error_code,model,input_tokens,output_tokens,created_at,started_at,finished_at FROM assistant_tasks WHERE company_id=? AND id=? AND user_id=?').bind(companyId,id,actor.id).first();requireThat(task,404,'AI_TASK_NOT_FOUND','This assistant request is unavailable.');
  if(task.status==='queued')this.kick(db,actor,companyId,id);
  if(task.status==='running'&&task.started_at<now()-300&&!this.active.has(id)){await db.prepare("UPDATE assistant_tasks SET status='failed',error_code='AI_INTERRUPTED',finished_at=? WHERE company_id=? AND id=? AND status='running'").bind(now(),companyId,id).run();return {...task,status:'failed',error_code:'AI_INTERRUPTED'};}
  return task;
 }
 kick(db,actor,companyId,id){if(this.active.has(id)||this.active.size>=2)return;const promise=this.run(db,actor,companyId,id).catch(()=>{}).finally(()=>this.active.delete(id));this.active.set(id,promise);}
 async run(db,actor,companyId,id){
  const claimed=await db.prepare("UPDATE assistant_tasks SET status='running',started_at=? WHERE company_id=? AND id=? AND user_id=? AND status='queued' RETURNING request_json").bind(now(),companyId,id,actor.id).first();if(!claimed)return;
  let inputTokens=0,outputTokens=0,model='',sources=[],trace=[];
  try{
   requireThat(this.provider,503,'AI_UNAVAILABLE','The model service is unavailable.');
   const company=await companyAccess(db,actor,companyId),current=await workspace(db,actor,companyId);
   // Use the native richer account/contact mapping only after scoping/filtering
   // through workspace's resource denials. No global company records are sent.
   const accountRows=(await db.prepare('SELECT id,code,name,kind,category FROM accounts WHERE company_id=? ORDER BY code').bind(companyId).all()).results.filter(x=>current.accounts.some(a=>a.id===x.id));
   const partyRows=(await db.prepare('SELECT id,name,kind FROM parties WHERE company_id=? ORDER BY name').bind(companyId).all()).results.filter(x=>current.parties.some(p=>p.id===x.id));
   const context={company:{name:company.name,currency:company.currency,role:company.role,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())},accounts:accountRows.slice(0,40),contacts:partyRows.slice(0,40),items:current.items.slice(0,40).map(i=>({id:i.id,name:i.name,store:i.store,unit:i.unit,available:i.on_hand-i.reserved})),recentDocuments:current.documents.slice(0,10).map(d=>({id:d.id,kind:d.kind,reference:d.reference,date:d.date,status:d.status,amount:d.amount})),coverage:'Bounded permitted records; absence from this context does not establish that a record does not exist.'};
   sources.push({id:'workspace',title:'Current permitted company records',asOf:now()});
   const images=[],evidence=[];
   for(const fileId of claimed.request_json.fileIds){requireThat(this.bucket,503,'STORAGE_UNAVAILABLE','Evidence storage is unavailable.');const file=await fileRecord(db,actor,companyId,fileId),bytes=await this.bucket.get(companyId,fileId,file);let content;
    if(file.media_type.startsWith('image/')){requireThat(this.provider.visionModel,409,'VISION_UNAVAILABLE','Image analysis needs a configured vision model.');images.push({mediaType:file.media_type,data:bytes.toString('base64')});content='Image supplied separately.';}
    else if(file.media_type==='application/pdf')content=await this.extractPdf(bytes);
    else content=bytes.toString('utf8').slice(0,12000);
    evidence.push({id:file.id,name:file.name,sha256:file.sha256,content:content.slice(0,Math.floor(12000/claimed.request_json.fileIds.length)),coverage:'Selected source text is bounded to 12,000 characters in total and at most 20 PDF pages; completeness is not assumed.'});sources.push({id:file.id,title:file.name,fileId:file.id,sha256:file.sha256,asOf:now()});
   }
   const recent=(await db.prepare("SELECT request_json,response_json FROM assistant_tasks WHERE company_id=? AND user_id=? AND status='complete' ORDER BY created_at DESC,id DESC LIMIT 2").bind(companyId,actor.id).all()).results.reverse();
   const messages=[{role:'system',content:system+'\n'+JSON.stringify({schema:'reply,tool,arguments,document,configuration,page,citations; every field required',context})}];
   for(const previous of recent)messages.push({role:'user',content:previous.request_json.message.slice(0,1500)},{role:'assistant',content:JSON.stringify({reply:previous.response_json.reply.slice(0,1500),previousUnpostedProposal:previous.response_json.proposal?.document??null})});
   messages.push({role:'user',content:JSON.stringify({message:claimed.request_json.message,evidence})});
   let answer;
   for(let step=0;step<4;step++){
    const result=await this.provider.complete(messages,{images});answer=result.answer;model=result.model;inputTokens+=result.inputTokens;outputTokens+=result.outputTokens;
    requireThat(Number.isSafeInteger(inputTokens)&&Number.isSafeInteger(outputTokens)&&inputTokens>=0&&outputTokens>=0,502,'AI_USAGE','The model returned invalid usage counters.');
    if(answer.tool==='none')break;requireThat(step<3,422,'AI_TOOL_LIMIT','The assistant reached its tool limit. Ask a narrower question.');
    let args;try{args=JSON.parse(answer.arguments||'{}');}catch{throw new AppError(422,'AI_ARGUMENTS','The assistant proposed an invalid read request.');}
    let value,sourceId;
    if(answer.tool==='workspace'){object(args,[]);value=context;sourceId='workspace';}
    else if(answer.tool==='reports'){object(args,['from','to']);const query=new URLSearchParams(args);value=await reports(db,actor,companyId,query);sourceId='report:'+step;sources.push({id:sourceId,title:'Posted financial report '+value.from+' to '+value.to,asOf:now(),snapshotHash:await hash(canonical(value))});}
    else {object(args,['id']);value=await documentDetail(db,actor,companyId,text(args.id,'document ID',80));sourceId=value.id;sources.push({id:sourceId,title:value.reference,documentId:value.id,version:value.version,asOf:now()});}
    trace.push({tool:answer.tool,sourceId});messages.push({role:'assistant',content:JSON.stringify(answer)},{role:'user',content:JSON.stringify({toolResult:{sourceId,value}})});
   }
   await companyAccess(db,actor,companyId);for(const fileId of claimed.request_json.fileIds)await fileRecord(db,actor,companyId,fileId);
   const output={reply:answer.reply,page:answer.page,sources:sources.filter(s=>answer.citations.includes(s.id)),tools:trace,proposal:null,configuration:null,validationError:null};
   if(answer.document){try{output.proposal=await preview(db,actor,companyId,JSON.parse(answer.document));}catch(error){output.validationError=error instanceof AppError?error.message:'The proposed document could not be validated.';}}
   if(answer.configuration){try{const candidate=JSON.parse(answer.configuration);object(candidate,['entity','data']);requireThat(['owner','admin'].includes(company.role)&&['party','item','account','company','period','membership'].includes(candidate.entity),403,'CONFIGURATION_DENIED','Your role cannot propose this setup change.');output.configuration={...candidate,expectedRevision:company.revision};}catch(error){output.validationError=error instanceof AppError?error.message:'The proposed setup could not be validated.';}}
   await db.prepare("UPDATE assistant_tasks SET status='complete',response_json=?,model=?,input_tokens=?,output_tokens=?,finished_at=? WHERE company_id=? AND id=? AND status='running'").bind(JSON.stringify(output),model,inputTokens,outputTokens,now(),companyId,id).run();
  }catch(error){try{await db.prepare("UPDATE assistant_tasks SET status='failed',error_code=?,model=?,input_tokens=?,output_tokens=?,finished_at=? WHERE company_id=? AND id=? AND status='running'").bind(error instanceof AppError?error.code:'AI_FAILED',model,inputTokens,outputTokens,now(),companyId,id).run();}catch{} }
 }
}
