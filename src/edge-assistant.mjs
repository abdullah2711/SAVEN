import {AppError,requireThat} from './errors.mjs';
import {body,json} from './api.mjs';
import {responseSchema,assistantSystem} from './assistant-contract.mjs';
import {hash,canonical} from './crypto.mjs';

// Operational cost coordination only. This stores counters and reservations,
// never a password, prompt, business record, transaction or file. PostgreSQL
// remains the sole business writer and the authority for every tool call.
export class AiBudget{
 constructor(ctx){this.ctx=ctx;}
 async fetch(request){
  const input=await request.json(),day=new Date().toISOString().slice(0,10);
  return this.ctx.storage.transaction(async storage=>{
   let state=await storage.get('daily');if(!state||state.day!==day)state={day,reserved:0,users:{},pending:{}};
   if(input.action==='settle'){
    const reservation=state.pending[input.id];if(!reservation)return json({settled:false});
    const actual=Number.isSafeInteger(input.inputTokens)&&input.inputTokens>=0&&Number.isSafeInteger(input.outputTokens)&&input.outputTokens>=0?Math.min(reservation.cost,Math.ceil(input.inputTokens*0.027+input.outputTokens*0.21)):reservation.cost;
    state.reserved-=reservation.cost-actual;delete state.pending[input.id];await storage.put('daily',state);return json({settled:true});
   }
   if(typeof input.user!=='string'||!/^[a-f0-9]{64}$/.test(input.user)||!Number.isSafeInteger(input.cost)||input.cost<1||input.cost>8000)return json({allowed:false},400);
   const user=state.users[input.user]??{calls:0,minute:0,burst:0},minute=Math.floor(Date.now()/60000);if(user.minute!==minute){user.minute=minute;user.burst=0;}
   if(state.reserved+input.cost>8000||user.calls>=50||user.burst>=8)return json({allowed:false},429);
   const id=crypto.randomUUID();state.pending[id]={cost:input.cost};state.reserved+=input.cost;user.calls++;user.burst++;state.users[input.user]=user;
   await storage.put('daily',state);return json({allowed:true,id});
  });
 }
}
const model='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
async function backend(env,request,path,method='GET',input){
 const origin=new URL(request.url).origin,headers=new Headers({'X-Saven-Public-Origin':origin,origin,'content-type':'application/json'});const cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);
 const response=await env.SAVEN_API.fetch(new Request('http://saven.internal'+path,{method,headers,redirect:'manual',...(input?{body:JSON.stringify(input)}:{})}));
 const result=await response.json();if(!response.ok)throw new AppError(response.status,result.error?.code??'TOOL_FAILED',result.error?.message??'The business service rejected this read.');return result;
}
function scopeFingerprint(workspace){return canonical({role:workspace.company.role,accounts:workspace.accounts.map(x=>x.id).sort(),parties:workspace.parties.map(x=>x.id).sort(),items:workspace.items.map(x=>x.id).sort()});}
function validate(answer){requireThat(answer&&typeof answer==='object'&&!Array.isArray(answer)&&Object.keys(answer).every(k=>responseSchema.required.includes(k))&&responseSchema.required.every(k=>k in answer)&&['reply','tool','arguments','document','configuration','page'].every(k=>typeof answer[k]==='string')&&answer.reply.length<=6000&&responseSchema.properties.tool.enum.includes(answer.tool)&&responseSchema.properties.page.enum.includes(answer.page)&&Array.isArray(answer.citations)&&answer.citations.length<=20&&answer.citations.every(x=>typeof x==='string'&&x.length<=100),502,'AI_RESPONSE','The model response was not valid. No records were changed.');}
async function inference(env,user,messages){
 const bytes=new TextEncoder().encode(JSON.stringify(messages)).byteLength;requireThat(bytes<=80000,422,'AI_CONTEXT','The selected context is too large. Ask a narrower question.');
 const budget=env.AI_BUDGET.get(env.AI_BUDGET.idFromName('testing-global'));
 const reserved=await budget.fetch(new Request('https://budget/reserve',{method:'POST',body:JSON.stringify({user,cost:Math.ceil((bytes+1024)*0.027+1100*0.21)})}));
 requireThat(reserved.ok,429,'AI_BUDGET','The assistant has reached its testing usage limit. No records were changed.');const reservation=await reserved.json();requireThat(reservation.allowed,429,'AI_BUDGET','The assistant usage allowance is temporarily exhausted.');
 let result;try{result=await env.AI.run(model,{messages,stream:false,max_tokens:1100,temperature:0.1,response_format:{type:'json_schema',json_schema:responseSchema}});}catch{throw new AppError(503,'AI_PROVIDER_ERROR','The model service could not finish this request. No business records were changed.');}
 const inputTokens=Number(result.usage?.prompt_tokens??result.usage?.input_tokens),outputTokens=Number(result.usage?.completion_tokens??result.usage?.output_tokens);
 await budget.fetch(new Request('https://budget/settle',{method:'POST',body:JSON.stringify({action:'settle',id:reservation.id,inputTokens,outputTokens})}));
 let answer;try{answer=typeof result.response==='string'?JSON.parse(result.response):result.response;}catch{throw new AppError(502,'AI_RESPONSE','The model returned an unusable response. No records were changed.');}validate(answer);return {answer,inputTokens:Number.isSafeInteger(inputTokens)?inputTokens:0,outputTokens:Number.isSafeInteger(outputTokens)?outputTokens:0};
}
export async function edgeAssistant(request,env){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/assistant\/chat$/);if(!match)return null;
 try{
  requireThat(request.method==='POST',405,'METHOD_NOT_ALLOWED','Send an assistant message as JSON.');
  requireThat(request.headers.get('origin')===url.origin&&['same-origin','none',null].includes(request.headers.get('sec-fetch-site')),403,'ORIGIN_DENIED','Open the assistant from SAVEN.');
  requireThat(env.AI&&env.AI_BUDGET&&env.SAVEN_API,503,'AI_UNAVAILABLE','The Cloudflare model service is not connected.');
  const companyId=match[1],prefix='/api/companies/'+companyId,me=await backend(env,request,'/api/me'),workspace=await backend(env,request,prefix+'/workspace'),scope=scopeFingerprint(workspace);
  const input=await body(request);requireThat(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['message','history'].includes(k))&&typeof input.message==='string'&&input.message.trim().length>0&&input.message.length<=6000,422,'AI_MESSAGE','Enter a message of up to 6,000 characters.');
  const history=input.history??[];requireThat(Array.isArray(history)&&history.length<=4&&history.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.length<=1500&&Object.keys(m).every(k=>['role','content'].includes(k))),422,'AI_HISTORY','The conversation context is invalid.');
  const context={company:{id:companyId,name:workspace.company.name,currency:workspace.company.currency,role:workspace.company.role,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())},accounts:workspace.accounts.slice(0,40),contacts:workspace.parties.slice(0,40),items:workspace.items.slice(0,40),recentDocuments:workspace.documents.slice(0,15).map(d=>({id:d.id,kind:d.kind,reference:d.reference,date:d.date,status:d.status,amount:d.amount})),coverage:'Bounded permitted records only. A missing record may be outside this context.'};
  const sources=[{id:'workspace',title:'Current permitted company records',asOf:Date.now()}],trace=[],messages=[{role:'system',content:assistantSystem+'\nUse this exact JSON schema: '+JSON.stringify(responseSchema)+'\nCurrent context: '+JSON.stringify(context)},...history,{role:'user',content:input.message.trim()}];
  const user=await hash(companyId+':'+me.user.id);let answer,inputTokens=0,outputTokens=0;
  for(let step=0;step<4;step++){
   const result=await inference(env,user,messages);answer=result.answer;inputTokens+=result.inputTokens;outputTokens+=result.outputTokens;if(answer.tool==='none')break;
   requireThat(step<3,422,'AI_TOOL_LIMIT','The assistant reached its tool limit. Ask a narrower question.');let args;try{args=JSON.parse(answer.arguments||'{}');}catch{throw new AppError(422,'AI_ARGUMENTS','The assistant proposed an invalid read.');}requireThat(args&&typeof args==='object'&&!Array.isArray(args),422,'AI_ARGUMENTS','Invalid tool arguments.');
   let value,sourceId;
   if(answer.tool==='workspace'){requireThat(Object.keys(args).length===0,422,'AI_ARGUMENTS','Workspace reads have no selectors.');value=context;sourceId='workspace';}
   else if(answer.tool==='reports'){requireThat(Object.keys(args).every(k=>['from','to'].includes(k))&&['from','to'].every(k=>typeof args[k]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(args[k])),422,'AI_ARGUMENTS','Reports need valid date bounds.');value=await backend(env,request,prefix+'/reports?'+new URLSearchParams(args));sourceId='report:'+step;sources.push({id:sourceId,title:'Posted reports '+value.from+' to '+value.to,asOf:Date.now(),snapshotHash:await hash(canonical(value))});}
   else{requireThat(Object.keys(args).length===1&&typeof args.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(args.id),422,'AI_ARGUMENTS','Choose a permitted document ID.');value=await backend(env,request,prefix+'/documents/'+args.id);sourceId=value.id;sources.push({id:sourceId,title:value.reference,documentId:value.id,version:value.version,asOf:Date.now()});}
   trace.push({tool:answer.tool,sourceId});messages.push({role:'assistant',content:JSON.stringify(answer)},{role:'user',content:JSON.stringify({toolResult:{sourceId,value}})});
  }
  const current=await backend(env,request,prefix+'/workspace');requireThat(scopeFingerprint(current)===scope,409,'ACCESS_CHANGED','Your permitted records changed. Ask again with the current access.');
  for(const source of sources.filter(s=>s.documentId))await backend(env,request,prefix+'/documents/'+source.documentId);
  const output={reply:answer.reply,page:answer.page,sources:sources.filter(s=>answer.citations.includes(s.id)),tools:trace,proposal:null,configuration:null,validationError:null,model,inputTokens,outputTokens,mode:'cloudflare',asOf:Date.now()};
  if(answer.document){try{const document=JSON.parse(answer.document);output.proposal=await backend(env,request,prefix+'/preview','POST',document);}catch(error){output.validationError=error instanceof AppError?error.message:'The proposed document could not be validated.';}}
  if(answer.configuration){try{requireThat(['owner','admin'].includes(current.company.role),403,'CONFIGURATION_DENIED','Only company administrators can apply setup changes.');const candidate=JSON.parse(answer.configuration);requireThat(candidate&&typeof candidate==='object'&&Object.keys(candidate).every(k=>['entity','data'].includes(k))&&['party','account','item','company','period','membership'].includes(candidate.entity),422,'AI_CONFIGURATION','The proposed setup is unsupported.');output.configuration={...candidate,expectedRevision:current.company.revision};}catch(error){output.validationError=error.message;}}
  return json(output);
 }catch(error){if(error instanceof AppError)return json({error:{code:error.code,message:error.message}},error.status);console.error(JSON.stringify({event:'edge_assistant_failed',requestId:crypto.randomUUID()}));return json({error:{code:'AI_FAILED',message:'The assistant could not complete this request. No records were changed.'}},503);}
}
