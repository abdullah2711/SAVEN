import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileBody} from '../object-store.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export function createNativeHandler(runtime,{appOrigin,operatorOrigin,publicRoot=resolve('public/live')}={}){
 const origins={app:new URL(appOrigin).origin,operator:new URL(operatorOrigin).origin};if(origins.app===origins.operator)throw Error('Separate customer and operator origins required');
 return async function handle(request){let response;try{
  const url=new URL(request.url),realm=url.origin===origins.app?'app':url.origin===origins.operator?'operator':null;if(!realm)fail(421,'Unrecognized application origin');
  const secure=url.protocol==='https:',cookieName=secure?'__Host-sa7en_'+realm:'sa7en_local_'+realm,cookies=Object.fromEntries((request.headers.get('cookie')??'').split(';').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim()];})),token=cookies[cookieName];
  const writing=!['GET','HEAD'].includes(request.method);if(writing&&request.headers.get('origin')!==url.origin)fail(403,'Origin verification failed');
  let input={};if(writing&&url.pathname!=='/api/evidence'){if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'JSON required');const raw=await request.text();if(Buffer.byteLength(raw)>65536)fail(413,'Request too large');try{input=JSON.parse(raw);}catch{fail(400,'Invalid JSON');}if(!input||Array.isArray(input)||typeof input!=='object')fail(400,'JSON object required');}
  const cookie=value=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict${secure?'; Secure':''}; Max-Age=${value?28800:0}`;
  if(url.pathname==='/health'&&request.method==='GET')response=json({status:'ok',engine:'native-sqlite',release:'acceptance-candidate',clientOnboarding:'not-released'});
  else if(url.pathname==='/api/login'&&request.method==='POST'){if(Object.keys(input).some(k=>!['email','password'].includes(k)))fail(400,'Unknown sign-in fields');const auth=await runtime.login(input.email,input.password,realm,request.headers.get('cf-connecting-ip')??'origin');response=json({csrf:auth.csrf,realm});response.headers.set('Set-Cookie',cookie(auth.token));}
  else if(url.pathname.startsWith('/api/')){
   let session;try{session=runtime.session(token,realm);}catch{fail(401,'Sign in required');}if(writing)try{runtime.csrf(session,request.headers.get('x-csrf-token'));}catch{fail(403,'CSRF verification failed');}
   const actor=session.user_id,method=request.method,path=url.pathname;
   if(path==='/api/session'&&method==='GET')response=json({email:session.email,userId:actor,realm,businesses:realm==='app'?runtime.businesses(actor):undefined,clientOnboarding:'NOT_RELEASED'});
   else if(path==='/api/logout'&&method==='POST'){runtime.logout(token);response=json({ok:true});response.headers.set('Set-Cookie',cookie(''));}
   else if(realm==='operator'){
    if(path==='/api/operator'&&method==='GET')response=json(runtime.operatorState(actor));
    else if(path==='/api/operator/identities'&&method==='POST'){runtime.requireOperator(actor,'commercial.manage');if(Object.keys(input).some(k=>!['email','password'].includes(k)))fail(400,'Unknown identity fields');response=json({userId:await runtime.createIdentity(input.email,input.password)},201);}
    else if(path==='/api/operator/businesses'&&method==='POST')response=json(runtime.provision(actor,input),201);
    else fail(404,'Operator endpoint unavailable');
   }else{
    const tenant=url.searchParams.get('tenant'),company=url.searchParams.get('company'),branch=url.searchParams.get('branch'),options={company,branch,search:url.searchParams.get('search')??'',exporting:url.searchParams.get('export')==='1'},commandId=request.headers.get('idempotency-key');
    if(path==='/api/administration'&&method==='GET')response=json(runtime.administration(tenant,actor));
    else if(path==='/api/administration/roles'&&method==='POST')response=json(runtime.saveRole(tenant,actor,input));
    else if(path==='/api/administration/members'&&method==='POST')response=json(await runtime.createMember(tenant,actor,commandId,input),201);
    else if(path==='/api/administration/existing-members'&&method==='POST')response=json(runtime.addExistingMember(tenant,actor,commandId,input),201);
    else if(path==='/api/administration/member-state'&&method==='POST')response=json(runtime.setMemberActive(tenant,actor,input));
    else if(path==='/api/administration/assignments'&&method==='POST')response=json(runtime.assignRole(tenant,actor,input));
    else if(path==='/api/masters'&&method==='GET')response=json(runtime.masters(tenant,actor,company,branch));
    else if(path==='/api/trade'&&method==='GET')response=json(runtime.trade(tenant,actor,{company,branch,...(url.searchParams.has('asOf')?{asOf:url.searchParams.get('asOf')}:{})}));
    else if(path==='/api/trade/parties'&&method==='POST')response=json(runtime.tradeParty(tenant,actor,input),201);
    else if(path==='/api/trade/prepare'&&method==='POST')response=json(runtime.prepareTrade(tenant,actor,commandId,input),201);
    else if(path==='/api/ledger'&&method==='GET')response=json(runtime.ledger(tenant,actor,options));
    else if(path==='/api/trial'&&method==='GET')response=json(runtime.trial(tenant,actor,options));
    else if(path==='/api/statements'&&method==='GET')response=json(runtime.statements(tenant,actor,options));
    else if(path==='/api/commands'&&method==='GET')response=json({rows:runtime.commands(tenant,actor,company,branch)});
    else if(path==='/api/approve'&&method==='POST'){if(Object.keys(input).some(k=>k!=='commandId'))fail(400,'Unknown approval fields');response=json(runtime.approve(tenant,actor,input.commandId));}
    else if(path==='/api/accounts'&&method==='POST')response=json(runtime.account(tenant,actor,input),201);
    else if(path==='/api/periods'&&method==='POST')response=json(runtime.period(tenant,actor,input));
    else if(path==='/api/settings'&&method==='GET')response=json(runtime.settings(tenant,actor,company,branch));
    else if(path==='/api/settings'&&method==='POST')response=json(runtime.settings(tenant,actor,company,branch,input));
    else if(path==='/api/inventory'&&method==='GET')response=json(runtime.inventory(tenant,actor,options));
    else if(path==='/api/inventory/masters'&&method==='POST')response=json(runtime.configureInventory(tenant,actor,input),201);
    else if(path==='/api/journals'&&method==='POST')response=json(runtime.postJournal(tenant,actor,commandId,input),201);
    else if(path==='/api/reversals/preview'&&method==='POST')response=json(runtime.previewReversal(tenant,actor,input));
    else if(path==='/api/reversals'&&method==='POST')response=json(runtime.reverseJournal(tenant,actor,commandId,input),201);
    else if(path==='/api/journals/prepare'&&method==='POST')response=json(runtime.prepareJournal(tenant,actor,commandId,input),201);
    else if(path==='/api/execute'&&method==='POST'){if(Object.keys(input).some(k=>k!=='commandId'))fail(400,'Unknown execution fields');response=json(runtime.execute(tenant,actor,input.commandId));}
    else if(path==='/api/evidence'&&method==='POST')response=json(await runtime.uploadEvidence(tenant,actor,url.searchParams.get('command'),decodeURIComponent(request.headers.get('x-file-name')??''),await fileBody(request)),201);
    else if(path==='/api/evidence'&&method==='GET'){const {file,bytes}=await runtime.evidence(tenant,actor,url.searchParams.get('file'));response=new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'no-store'}});}
    else if(path==='/api/inventory/movements'&&method==='POST')response=json(runtime.postStock(tenant,actor,commandId,input),201);
    else if(path==='/api/assistant'&&method==='POST')response=json(await runtime.assistant(tenant,actor,company,branch,input));
    else fail(404,'Customer endpoint unavailable');
   }
  }else if(request.method==='GET'&&['/','/app.js','/administration.js','/trade.js','/style.css','/logo.svg'].includes(url.pathname)){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);response=new Response(await readFile(resolve(publicRoot,file)),{headers:{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html','Cache-Control':'no-store'}});}
  else fail(404,'Not found');
  if(url.pathname.startsWith('/api/')&&!['/api/login','/api/logout'].includes(url.pathname))runtime.session(token,realm);
 }catch(error){response=json({error:error.status?error.message:'Request refused; check your scope, values and current operation state.'},error.status??422);}
 response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Frame-Options','DENY');response.headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");return response;
 };
}
