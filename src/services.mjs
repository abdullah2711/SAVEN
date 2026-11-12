import {authenticate,companyAccess} from './auth.mjs';
import {body,json,securityHeaders} from './api.mjs';
import {AppError,requireThat} from './errors.mjs';
import {fileRecord,listFiles,uploadFile,retryScan,attachFile,removeFile,withdrawAttachment} from './files.mjs';

export async function servicesApi(request,{db,bucket,scanner,assistant}){
 const url=new URL(request.url),path=url.pathname;
 const match=path.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/(files(?:\/.*)?|assistant(?:\/.*)?|notifications|documents\/[a-zA-Z0-9_-]{1,80}\/attachments(?:\/.*)?)$/);
 if(path!=='/api/services'&&!match)return null;
 try{
  const actor=await authenticate(db,request);
  if(!['GET','HEAD'].includes(request.method))requireThat(request.headers.get('origin')===url.origin&&['same-origin','none',null].includes(request.headers.get('sec-fetch-site')),403,'ORIGIN_DENIED','Open this action from your SAVEN workspace.');
  if(path==='/api/services'&&request.method==='GET')return json({schemaReady:db.schemaVersion>=5,storage:!!bucket,scanner:!!scanner,assistant:!!assistant?.provider,model:assistant?.provider?.model??'',vision:!!assistant?.provider?.visionModel});
  requireThat(db.schemaVersion>=5,503,'UPGRADE_REQUIRED','Files and the assistant require the server upgrade. No records have been changed.');
  const [,companyId,rest]=match;await companyAccess(db,actor,companyId);
  if(rest==='files'&&request.method==='GET')return json(await listFiles(db,actor,companyId,url.searchParams.get('document')));
  if(rest==='files'&&request.method==='POST'){requireThat(bucket&&scanner,503,'STORAGE_UNAVAILABLE','Private storage and virus scanning must be running before files can be uploaded.');return json(await uploadFile(db,actor,companyId,request,{bucket,scanner}),201);}
  const file=rest.match(/^files\/([a-f0-9-]{36})\/(download|scan|remove)$/);
  if(file){const [,id,action]=file;
   if(action==='download'&&['GET','HEAD'].includes(request.method)){requireThat(bucket,503,'STORAGE_UNAVAILABLE','Private storage is unavailable.');const record=await fileRecord(db,actor,companyId,id),bytes=await bucket.get(companyId,id,record);return new Response(request.method==='HEAD'?null:bytes,{headers:{...securityHeaders,'content-type':'application/octet-stream','content-length':String(bytes.length),'content-disposition':"attachment; filename=\"download\"; filename*=UTF-8''"+encodeURIComponent(record.name),'X-Saven-SHA256':record.sha256}});}
   if(action==='scan'&&request.method==='POST'){requireThat(bucket&&scanner,503,'STORAGE_UNAVAILABLE','Storage and virus scanning are unavailable.');return json(await retryScan(db,actor,companyId,id,{bucket,scanner}));}
   if(action==='remove'&&request.method==='POST')return json(await removeFile(db,actor,companyId,id,await body(request)));
  }
  const attachment=rest.match(/^documents\/([a-zA-Z0-9_-]{1,80})\/attachments(?:\/([a-f0-9-]{36})\/withdraw)?$/);
  if(attachment&&request.method==='POST')return json(attachment[2]?await withdrawAttachment(db,actor,companyId,attachment[1],attachment[2],await body(request)):await attachFile(db,actor,companyId,attachment[1],await body(request)),201);
  if(rest==='notifications'&&request.method==='GET')return json({notifications:(await db.prepare('SELECT id,event_type,record_id,message,created_at,read_at FROM notifications WHERE company_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50').bind(companyId,actor.id).all()).results});
  if(rest==='assistant/tasks'&&request.method==='POST'){requireThat(assistant,503,'AI_UNAVAILABLE','The assistant service is unavailable.');return json(await assistant.create(db,actor,companyId,await body(request),request.headers.get('idempotency-key')),202);}
  const task=rest.match(/^assistant\/tasks\/([a-f0-9-]{36})$/);
  if(task&&request.method==='GET'){requireThat(assistant,503,'AI_UNAVAILABLE','The assistant service is unavailable.');return json(await assistant.get(db,actor,companyId,task[1]));}
  throw new AppError(405,'METHOD_NOT_ALLOWED','This endpoint does not support that action.');
 }catch(error){if(error instanceof AppError)return json({error:{code:error.code,message:error.message}},error.status);
  for(const [code,status,message]of [['STORAGE_QUOTA',409,'The retained storage quota has been reached.'],['EVIDENCE_PROTECTED',409,'Transaction evidence cannot be removed through Drive.'],['FILE_NOT_READY',409,'The file is quarantined or is not available as company evidence.'],['FORBIDDEN',403,'Your access does not permit this action.']])if(String(error.message).includes(code))return json({error:{code,message}},status);
  console.error(JSON.stringify({event:'service_request_failed',requestId:crypto.randomUUID()}));return json({error:{code:'INTERNAL_ERROR',message:'The service request could not be completed.'}},500);
 }
}
