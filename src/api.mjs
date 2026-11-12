import { AppError, requireThat } from './errors.mjs';
import { authenticate, redeemGrant } from './auth.mjs';
import { preview, submit, review, workspace } from './commands.mjs';

const LIMIT=16_384;
async function body(request) {
  requireThat(request.headers.get('content-type')?.split(';')[0]==='application/json',415,'JSON_REQUIRED','Send this request as JSON.');
  const reader=request.body?.getReader();
  requireThat(reader,400,'BODY_REQUIRED','Provide a request body.');
  const chunks=[];let length=0;
  while(true) {
    const {value,done}=await reader.read();if(done) break;
    length+=value.byteLength;
    if(length>LIMIT){await reader.cancel();throw new AppError(413,'BODY_TOO_LARGE','This request exceeds the supported size.');}
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
      return json({service:'saven',stage:'foundation',database:env.DB?.dialect??'sqlite',databaseConfigured:!!env.DB,schemaReady,environment:env.ENVIRONMENT??'local'});
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
    if(url.pathname==='/api/session' && method==='DELETE') {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(actor.sessionHash).run();
      return json({signedOut:true},200,{'Set-Cookie':`saven_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${url.protocol==='https:'?'; Secure':''}`});
    }
    if(url.pathname==='/api/me' && method==='GET') {
      const companies=await env.DB.prepare("SELECT c.id,c.name,c.currency,m.role FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=? AND c.status='active' ORDER BY c.name").bind(actor.id).all();
      return json({user:{id:actor.id,name:actor.name,email:actor.email},companies:companies.results});
    }
    const match=url.pathname.match(/^\/api\/companies\/([a-zA-Z0-9_-]{1,80})\/(workspace|preview|documents)(?:\/([a-zA-Z0-9_-]{1,80})\/(approve|reject))?$/);
    requireThat(match,404,'NOT_FOUND','This endpoint does not exist.');
    const [,companyId,area,documentId,action]=match;
    if(area==='workspace' && !documentId && method==='GET') return json(await workspace(env.DB,actor,companyId));
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
