import {encodePassword,verifyPassword} from './passwords.mjs';
export {encodePassword,verifyPassword};
import {hash,token} from './crypto.mjs';
import {authenticate,now} from './auth.mjs';
import {AppError,requireThat} from './errors.mjs';
import {body,json} from './api.mjs';

function sameOrigin(request){const origin=new URL(request.url).origin;requireThat(request.headers.get('origin')===origin&&['same-origin','none',null].includes(request.headers.get('sec-fetch-site')),403,'ORIGIN_DENIED','Open this action from your SAVEN workspace.');}
function cookie(value,request){return `saven_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
async function currentCredential(db,actor,password){const current=await db.prepare('SELECT encoded,version FROM user_credentials WHERE user_id=?').bind(actor.id).first();if(current){const limit=await db.prepare('SELECT saven_auth_limit(?,5,900) AS allowed').bind(await hash('step-up:'+actor.id)).first();requireThat(limit.allowed,429,'STEP_UP_LIMIT','Too many verification attempts. Try again in 15 minutes.');requireThat(await verifyPassword(password??'',current.encoded),401,'CURRENT_PASSWORD','The current password is incorrect.');}return current;}
export async function securityApi(request,db){
  const path=new URL(request.url).pathname;
  if(!['/api/login','/api/security','/api/security/password','/api/security/profile'].includes(path))return null;
  try{
    requireThat(db.schemaVersion>=3,503,'UPGRADE_REQUIRED','Persistent sign-in is being activated.');
    if(path==='/api/login'&&request.method==='POST'){
      sameOrigin(request);const input=await body(request);
      requireThat(input&&Object.keys(input).every(k=>['email','password'].includes(k))&&typeof input.email==='string'&&input.email.trim().length<=254&&typeof input.password==='string',401,'SIGN_IN_FAILED','The email or password is incorrect.');
      const email=input.email.trim().toLowerCase();
      const ipKey=await hash('login-ip:'+String(request.headers.get('cf-connecting-ip')??'local'));
      const ip=await db.prepare('SELECT saven_auth_limit(?,60,900) AS allowed').bind(ipKey).first();
      requireThat(ip.allowed,429,'SIGN_IN_LIMIT','Too many sign-in attempts. Try again in 15 minutes.');
      const limit=await db.prepare('SELECT saven_auth_limit(?,10,900) AS allowed').bind(await hash('login-email:'+email)).first();
      requireThat(limit.allowed,429,'SIGN_IN_LIMIT','Too many sign-in attempts. Try again in 15 minutes.');
      const candidate=await db.prepare('SELECT * FROM saven_auth_candidate(?)').bind(email).first();
      const valid=await verifyPassword(input.password,candidate?.encoded);
      requireThat(candidate&&valid,401,'SIGN_IN_FAILED','The email or password is incorrect.');
      const session=token(),expiresAt=now()+28800;
      await db.prepare('SELECT saven_password_session(?,?,?,?)').bind(email,candidate.encoded,await hash(session),expiresAt).first();
      return json({expiresAt},200,{'Set-Cookie':cookie(session,request)});
    }
    const actor=await authenticate(db,request);
    if(path==='/api/security'&&request.method==='GET'){
      const current=await db.prepare('SELECT version FROM user_credentials WHERE user_id=?').bind(actor.id).first();
      const events=await db.prepare('SELECT event_type,created_at FROM security_events WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20').bind(actor.id).all();
      return json({passwordSet:!!current,events:events.results});
    }
    if(path==='/api/security/password'&&request.method==='POST'){
      sameOrigin(request);const input=await body(request);
      requireThat(input&&Object.keys(input).every(k=>['currentPassword','newPassword'].includes(k)),422,'INVALID_FIELD','Provide your current and new password.');
      const current=await currentCredential(db,actor,input.currentPassword);
      const encoded=await encodePassword(input.newPassword),session=token(),expiresAt=now()+28800;
      await db.prepare('SELECT saven_set_password(?,?,?,?,?)').bind(current?.version??0,encoded,actor.sessionHash,await hash(session),expiresAt).first();
      return json({passwordSet:true,expiresAt},200,{'Set-Cookie':cookie(session,request)});
    }
    if(path==='/api/security/profile'&&request.method==='POST'){
      sameOrigin(request);const input=await body(request);
      requireThat(input&&Object.keys(input).every(k=>['name','email','currentPassword'].includes(k))&&typeof input.name==='string'&&input.name.trim().length>0&&input.name.trim().length<=160&&!/[\u0000-\u001f]/.test(input.name)&&typeof input.email==='string'&&input.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()),422,'INVALID_PROFILE','Provide your name and a valid email address.');
      await currentCredential(db,actor,input.currentPassword);
      const session=token(),expiresAt=now()+28800;
      await db.prepare('SELECT saven_set_profile(?,?,?,?)').bind(input.name.trim(),input.email.trim().toLowerCase(),await hash(session),expiresAt).first();
      return json({updated:true,expiresAt},200,{'Set-Cookie':cookie(session,request)});
    }
    throw new AppError(405,'METHOD_NOT_ALLOWED','This sign-in endpoint does not support that method.');
  }catch(error){if(error instanceof AppError)return json({error:{code:error.code,message:error.message}},error.status);if(error.code==='23505')return json({error:{code:'EMAIL_IN_USE',message:'This email address is already in use.'}},409);if(error.message?.includes('STALE_CREDENTIAL'))return json({error:{code:'STALE_CREDENTIAL',message:'Your access changed. Sign in again before changing credentials.'}},409);console.error(JSON.stringify({event:'security_request_failed',requestId:crypto.randomUUID()}));return json({error:{code:'INTERNAL_ERROR',message:'The security action could not be completed.'}},500);}
}
