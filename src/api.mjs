import {paymentsWorkspace} from './payments.mjs';
import { AppError, requireThat } from './errors.mjs';
import { authenticate, redeemGrant } from './auth.mjs';
import { preview, submit, review, workspace,documentDetail } from './commands.mjs';
import {operatingContext,configure,createCompany,invite,reports,membershipInvitation} from './operating.mjs';
import {outstandingBalances} from './extended-accounting.mjs';
import {accountingWorkspace,accountingCommand,bankDetail,partyAccounting,closeChecklist} from './accounting.mjs';
import {openingStatus} from './opening.mjs';
import {recurringList,recurringDetail,recurringDocument,recurringCommand} from './recurring.mjs';
import {accountingExport} from './accounting-export.mjs';
import {approvalPolicies,publishApprovalPolicy} from './approval.mjs';

const LIMIT=16_384;
export async function body(request,limit=LIMIT) {
  requireThat(request.headers.get('content-type')?.split(';')[0]==='application/json',415,'JSON_REQUIRED','Send this request as JSON.');
  const reader=request.body?.getReader();
  requireThat(reader,400,'BODY_REQUIRED','Provide a request body.');
  const chunks=[];let length=0;
  while(true) {
    const {value,done}=await reader.read();if(done) break;
    length+=value.byteLength;
    if(length>limit){await reader.cancel();throw new AppError(413,'BODY_TOO_LARGE','This request exceeds the supported size.');}
    chunks.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try {return JSON.parse(new TextDecoder().decode(bytes));}
  catch {throw new AppError(400,'INVALID_JSON','Provide valid JSON.');}
}
export const securityHeaders={
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options':'DENY',
  'Cache-Control':'no-store'
};
export function json(value,status=200,extra={}) {
  return new Response(JSON.stringify(value),{status,headers:{...securityHeaders,'Content-Type':'application/json; charset=utf-8',...extra}});
}
export async function api(request,env) {
  const requestId=crypto.randomUUID();
  try {
    const url=new URL(request.url),method=request.method;
    if(url.pathname==='/api/health' && method==='GET') {
      let schemaReady=false;
      if(env.DB) {
        try {
          if(env.DB.schemaReady) schemaReady=await env.DB.schemaReady();
          else {
            const schema=await env.DB.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('users','companies','memberships','accounts','parties','periods','items','resource_denials','operations','documents','journals','journal_lines','audit_events','outbox','login_grants','sessions')").first();
            schemaReady=Number(schema?.n)===16;
          }
        }catch{}
      }
      return json({service:'saven',stage:env.DB?.schemaVersion>=3?'operating-core':'foundation',database:env.DB?.dialect??'sqlite',schemaVersion:env.DB?.schemaVersion??1,databaseConfigured:!!env.DB,schemaReady,environment:env.ENVIRONMENT??'local'});
    }
    requireThat(env.DB,503,'SETUP_REQUIRED','The testing database has not been connected. No business data can be read or posted until setup is complete.');
    // Same-origin JSON mutations plus Strict HttpOnly cookies. No CORS grants.
    if(!['GET','HEAD'].includes(method)) {
      requireThat(request.headers.get('origin')===url.origin,403,'ORIGIN_DENIED','This action must originate from your SAVEN workspace.');
      requireThat(['same-origin','none',null].includes(request.headers.get('sec-fetch-site')),403,'ORIGIN_DENIED','Cross-site requests are not allowed.');
    }
    if(url.pathname==='/api/session' && method==='POST') {
      const input=await body(request);
      requireThat(input && Object.keys(input).length===1,422,'INVALID_INVITATION','Provide your invitation token.');
      const result=await redeemGrant(env.DB,input.token);
      return json({expiresAt:result.expiresAt},200,{'Set-Cookie':`saven_session=${result.session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${url.protocol==='https:'?'; Secure':''}`});
    }
    const actor=await authenticate(env.DB,request);
    const paymentsRoute=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/payments$/);if(paymentsRoute&&method==='GET')return json(await paymentsWorkspace(env.DB,actor,paymentsRoute[1],url.searchParams));
    const policyRoute=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/approval-policies$/);
    if(policyRoute){if(method==='GET')return json(await approvalPolicies(env.DB,actor,policyRoute[1]));if(method==='POST')return json(await publishApprovalPolicy(env.DB,actor,policyRoute[1],await body(request),request.headers.get('idempotency-key')),201);throw new AppError(405,'METHOD_NOT_ALLOWED','Unsupported approval policy action.');}
    const exportRoute=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/accounting-export$/);
    if(exportRoute&&method==='GET'){const result=await accountingExport(env.DB,actor,exportRoute[1],url.searchParams);return new Response(result.text,{headers:{...securityHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${result.filename}"`}});}
    const recurring=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/recurring(?:\/([a-zA-Z0-9_-]{1,80})(?:\/(preview))?)?$/);
    if(recurring){const [,cid,id,action]=recurring;if(method==='GET'&&!action)return json(id?await recurringDetail(env.DB,actor,cid,id):await recurringList(env.DB,actor,cid));if(method==='POST'&&action){const p=await body(request);requireThat(p&&Object.keys(p).every(k=>['index','attempt'].includes(k)),422,'INVALID_OCCURRENCE','Provide the occurrence index and attempt.');return json(await preview(env.DB,actor,cid,await recurringDocument(env.DB,actor,cid,id,p.index,p.attempt)));}if(method==='POST'&&!id)return json(await recurringCommand(env.DB,actor,cid,await body(request),request.headers.get('idempotency-key')),201);throw new AppError(405,'METHOD_NOT_ALLOWED','Unsupported recurring schedule action.');}
    const opening=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/opening$/);
    if(opening){if(method==='GET')return json(await openingStatus(env.DB,actor,opening[1]));if(method==='POST'){const input=await body(request,131072);requireThat(input&&['preview','submit'].includes(input.action),422,'INVALID_ACTION','Choose preview or submit.');if(input.action==='preview'){requireThat(input.document?.kind==='opening_balance',422,'INVALID_OPENING','Provide an opening snapshot.');return json(await preview(env.DB,actor,opening[1],input.document));}requireThat(input.data?.document?.kind==='opening_balance',422,'INVALID_OPENING','Provide an opening snapshot.');return json(await submit(env.DB,actor,opening[1],input.data,request.headers.get('idempotency-key')),201);}throw new AppError(405,'METHOD_NOT_ALLOWED','Unsupported opening action.');}
    const closeReport=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/close-review$/);if(closeReport&&method==='GET')return json(await closeChecklist(env.DB,actor,closeReport[1],url.searchParams));
    const partyReport=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/party-ledger$/);if(partyReport&&method==='GET')return json(await partyAccounting(env.DB,actor,partyReport[1],url.searchParams));
    const accounting=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/accounting(?:\/statements\/([a-zA-Z0-9_-]{1,80}))?$/);
    if(accounting){if(method==='GET')return json(accounting[2]?await bankDetail(env.DB,actor,accounting[1],accounting[2]):await accountingWorkspace(env.DB,actor,accounting[1],url.searchParams));if(method==='POST'&&!accounting[2])return json(await accountingCommand(env.DB,actor,accounting[1],await body(request,131072),request.headers.get('idempotency-key')),201);throw new AppError(405,'METHOD_NOT_ALLOWED','Unsupported accounting action.');}
    const join=url.pathname.match(/^\/api\/invitations\/(preview|accept)$/);
    if(join&&method==='POST'){requireThat(env.DB.schemaVersion>=3,503,'UPGRADE_REQUIRED','Company invitations are being activated.');return json(await membershipInvitation(env.DB,actor,await body(request),join[1]));}
    if(url.pathname==='/api/session' && method==='DELETE') {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(actor.sessionHash).run();
      return json({signedOut:true},200,{'Set-Cookie':`saven_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${url.protocol==='https:'?'; Secure':''}`});
    }
    if(url.pathname==='/api/me' && method==='GET') {
      const companies=await env.DB.prepare("SELECT c.id,c.name,c.currency,m.role FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=? AND c.status='active'"+(env.DB.schemaVersion>=3?' AND m.active=1':'')+' ORDER BY c.name').bind(actor.id).all();
      return json({user:{id:actor.id,name:actor.name,email:actor.email},companies:companies.results});
    }
    if(url.pathname==='/api/companies'&&method==='POST')return json(await createCompany(env.DB,actor,await body(request),request.headers.get('idempotency-key')),201);
    const operating=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/(configure|invites|reports|balances)$/);
    if(operating){
      requireThat(env.DB.schemaVersion>=3,503,'UPGRADE_REQUIRED','This company capability is being activated.');
      const [,companyId,area]=operating;
      if(area==='configure'&&method==='POST')return json(await configure(env.DB,actor,companyId,await body(request),request.headers.get('idempotency-key')),201);
      if(area==='invites'&&method==='POST')return json(await invite(env.DB,actor,companyId,await body(request),request.headers.get('idempotency-key')),201);
      if(area==='reports'&&method==='GET')return json(await reports(env.DB,actor,companyId,url.searchParams));
      if(area==='balances'&&method==='GET')return json(await outstandingBalances(env.DB,actor,companyId,url.searchParams.get('party')??''));
      throw new AppError(405,'METHOD_NOT_ALLOWED','This endpoint does not support that method.');
    }
    const detail=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/documents\/([a-zA-Z0-9_-]{1,80})$/);
    if(detail&&method==='GET')return json(await documentDetail(env.DB,actor,detail[1],detail[2]));
    const match=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/(workspace|preview|documents)(?:\/([a-zA-Z0-9_-]{1,80})\/(approve|reject))?$/);
    requireThat(match,404,'NOT_FOUND','This endpoint does not exist.');
    const [,companyId,area,documentId,action]=match;
    if(area==='workspace' && !documentId && method==='GET') {
      const result=await workspace(env.DB,actor,companyId);
      if(env.DB.schemaVersion>=3)Object.assign(result,await operatingContext(env.DB,actor,companyId));
      return json(result);
    }
    if(area==='preview' && !documentId && method==='POST') return json(await preview(env.DB,actor,companyId,await body(request)));
    if(area==='documents' && method==='POST') {
      const input=await body(request),key=request.headers.get('idempotency-key');
      if(!documentId) return json(await submit(env.DB,actor,companyId,input,key),201);
      return json(await review(env.DB,actor,companyId,documentId,input,key,action));
    }
    throw new AppError(405,'METHOD_NOT_ALLOWED','This endpoint does not support that method.');
  } catch(error) {
    if(error instanceof AppError) return json({error:{code:error.code,message:error.message},requestId},error.status);
    // Do not expose SQL, input documents, session tokens or stack traces.
    console.error(JSON.stringify({event:'request_failed',requestId,category:'internal'}));
    return json({error:{code:'INTERNAL_ERROR',message:'The action could not be completed. Your request reference can help support investigate.'},requestId},500);
  }
}
