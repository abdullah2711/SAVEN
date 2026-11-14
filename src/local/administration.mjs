import {randomUUID} from 'node:crypto';
import {normalizedRole,nativeActions} from './engine.mjs';
import {transaction,canonical,digest} from './sqlite.mjs';
import {encodePassword,verifyPassword} from '../passwords.mjs';
const check=(value,message)=>{if(!value)throw Error(message);};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
const reason=value=>typeof value==='string'&&value.trim().length>0&&value.length<=800;

export function requireOwner(runtime,tenant,actor,writing=false){
 runtime.engine.policy(tenant,actor,writing?'roles.manage':'journal.read');
 const db=runtime.engine.tenant(tenant);
 check(db.prepare("SELECT user_id FROM assignments WHERE role_id='ultimate_business_admin'").get()?.user_id===actor,'Business administration requires the protected business owner');
 return db;
}

export function businessAdministration(runtime,tenant,actor){
 const db=requireOwner(runtime,tenant,actor),identity=runtime.engine.central.identity;
 const members=db.prepare('SELECT * FROM members ORDER BY user_id').all().map(member=>{
  const directory=identity.prepare('SELECT c.email,m.active FROM credentials c JOIN memberships m ON m.user_id=c.user_id WHERE m.tenant_id=? AND c.user_id=?').get(tenant,member.user_id);
  return {userId:member.user_id,email:directory?.email??'',active:member.active===1&&directory?.active===1,roles:db.prepare('SELECT role_id FROM assignments WHERE user_id=? ORDER BY role_id').all(member.user_id).map(row=>row.role_id)};
 });
 return {members,roles:db.prepare('SELECT * FROM roles ORDER BY protected DESC,name').all().map(role=>({id:role.id,name:role.name,protected:role.protected===1,permissions:JSON.parse(role.permissions),digest:digest({name:role.name,permissions:JSON.parse(role.permissions)})})),actions:[...nativeActions],companies:db.prepare('SELECT id,name,branch,currency FROM company_profiles ORDER BY name').all(),accounts:db.prepare('SELECT code,title FROM accounts ORDER BY code').all(),items:db.prepare('SELECT id,company,name FROM stock_items WHERE active=1 ORDER BY name').all(),warehouses:db.prepare('SELECT id,company,branch,name FROM warehouses WHERE active=1 ORDER BY name').all(),permissionManagement:'PROTECTED_OWNER_ONLY'};
}

export function saveBusinessRole(runtime,tenant,actor,input){
 const db=requireOwner(runtime,tenant,actor,true);
 check(input&&Object.keys(input).every(k=>['role','reason'].includes(k))&&reason(input.reason),'Role and an audit reason are required');
 const role=normalizedRole(input.role),companies=new Set(db.prepare('SELECT id FROM company_profiles').all().map(c=>c.id)),branches=new Set(db.prepare('SELECT branch FROM company_profiles').all().map(c=>c.branch)),accounts=new Set(db.prepare('SELECT code FROM accounts').all().map(a=>a.code));
 for(const [key,available]of [['companies',companies],['branches',branches],['accounts',accounts]])check(role.permissions[key].every(value=>value==='*'||available.has(value)),'Role references an unavailable '+key+' scope');
 return transaction(db,()=>{
  db.prepare('INSERT INTO roles VALUES(?,?,0,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,permissions=excluded.permissions').run(role.id,role.name,canonical(role.permissions));
  runtime.engine.audit(db,null,actor,'BUSINESS_ROLE_SAVED',{role,reason:input.reason.trim()});return {id:role.id};
 });
}

// Identity and tenant files deliberately use a durable resumable operation,
// rather than claiming a transaction spans both stores. No password is kept in
// the operation record; only the existing scrypt credential verifier is stored.
export async function createBusinessMember(runtime,tenant,actor,operation,input){
 let db=requireOwner(runtime,tenant,actor,true);
 check(validId(operation),'A stable staff operation ID is required');
 check(input&&Object.keys(input).every(k=>['email','password','roleId','roleDigest','reason'].includes(k))&&reason(input.reason),'Invalid staff setup fields or audit reason');
 check(typeof input.email==='string'&&input.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email),'Valid staff email required');
 check(typeof input.password==='string'&&input.password.length>=14&&input.password.length<=128,'Initial password must contain 14 to 128 characters');
 check(validId(input.roleId)&&input.roleId!=='ultimate_business_admin','Choose an ordinary business role');
 const role=()=>{const r=db.prepare('SELECT * FROM roles WHERE id=? AND protected=0').get(input.roleId);check(r&&digest({name:r.name,permissions:JSON.parse(r.permissions)})===input.roleDigest,'Role changed; refresh the role and review its permissions');return r;};
 const identity=runtime.engine.central.identity,address=input.email.toLowerCase(),payloadDigest=digest({email:address,roleId:input.roleId,roleDigest:input.roleDigest,reason:input.reason.trim()});
 let receipt=identity.prepare('SELECT * FROM business_member_operations WHERE id=?').get(operation);
 if(receipt){
  check(receipt.tenant_id===tenant&&receipt.actor===actor&&receipt.digest===payloadDigest,'Staff operation ID belongs to another request');
  const credential=identity.prepare('SELECT encoded FROM credentials WHERE user_id=?').get(receipt.user_id);
  check(await verifyPassword(input.password,credential?.encoded),'Staff operation does not match its original credential');
  db=requireOwner(runtime,tenant,actor,true);
  if(receipt.state==='COMPLETED')return {userId:receipt.user_id,state:'COMPLETED',replayed:true};role();
 }else{
  role();const encoded=await encodePassword(input.password);db=requireOwner(runtime,tenant,actor,true);role();
  receipt={user_id:randomUUID()};
  transaction(identity,()=>{
   check(!identity.prepare('SELECT 1 FROM credentials WHERE email=? COLLATE NOCASE').get(address),'This identity already exists; use the existing-identity assignment workflow');
   identity.prepare('INSERT INTO users VALUES(?,1)').run(receipt.user_id);
   identity.prepare('INSERT INTO credentials(user_id,email,encoded) VALUES(?,?,?)').run(receipt.user_id,address,encoded);
   identity.prepare('INSERT INTO memberships VALUES(?,?,1)').run(tenant,receipt.user_id);
   identity.prepare("INSERT INTO business_member_operations VALUES(?,?,?,?,?,'PREPARED',?)").run(operation,tenant,actor,receipt.user_id,payloadDigest,runtime.clock());
  });
 }
 try{
  db=requireOwner(runtime,tenant,actor,true);const selected=role();
  runtime.engine.grantRole(tenant,actor,{id:selected.id,name:selected.name,permissions:JSON.parse(selected.permissions)},receipt.user_id,input.reason.trim());
  identity.prepare("UPDATE business_member_operations SET state='COMPLETED' WHERE id=?").run(operation);
  return {userId:receipt.user_id,state:'COMPLETED',replayed:false};
 }catch(error){identity.prepare("UPDATE business_member_operations SET state='NEEDS_RETRY' WHERE id=?").run(operation);throw error;}
}

export function setBusinessMemberActive(runtime,tenant,actor,input){
 const db=requireOwner(runtime,tenant,actor,true);
 check(input&&Object.keys(input).every(k=>['userId','active','reason'].includes(k))&&validId(input.userId)&&typeof input.active==='boolean'&&reason(input.reason),'Member, active state and audit reason are required');
 check(input.userId!==actor&&!db.prepare("SELECT 1 FROM assignments WHERE user_id=? AND role_id='ultimate_business_admin'").get(input.userId),'The protected business owner cannot be suspended');
 check(db.prepare('SELECT 1 FROM members WHERE user_id=?').get(input.userId),'Member is not in this business');
 return transaction(db,()=>{db.prepare('UPDATE members SET active=? WHERE user_id=?').run(input.active?1:0,input.userId);runtime.engine.audit(db,null,actor,input.active?'BUSINESS_MEMBER_REACTIVATED':'BUSINESS_MEMBER_SUSPENDED',{userId:input.userId,reason:input.reason.trim()});return {userId:input.userId,active:input.active};});
}

export function addExistingBusinessMember(runtime,tenant,actor,operation,input){
 const db=requireOwner(runtime,tenant,actor,true),identity=runtime.engine.central.identity;
 check(validId(operation),'A stable staff operation ID is required');
 check(input&&Object.keys(input).every(k=>['userId','email','roleId','roleDigest','reason'].includes(k))&&validId(input.userId)&&validId(input.roleId)&&input.roleId!=='ultimate_business_admin'&&typeof input.email==='string'&&reason(input.reason),'Account ID, matching email, ordinary role and reason required');
 const account=identity.prepare('SELECT c.user_id FROM credentials c JOIN users u ON u.id=c.user_id WHERE c.user_id=? AND c.email=? COLLATE NOCASE AND u.active=1').get(input.userId,input.email);
 check(account,'Existing account does not match both the account ID and email');
 const payloadDigest=digest({kind:'EXISTING_BUSINESS_MEMBER',userId:input.userId,email:input.email.toLowerCase(),roleId:input.roleId,roleDigest:input.roleDigest,reason:input.reason.trim()});
 const receipt=identity.prepare('SELECT * FROM business_member_operations WHERE id=?').get(operation);
 if(receipt){check(receipt.tenant_id===tenant&&receipt.actor===actor&&receipt.user_id===input.userId&&receipt.digest===payloadDigest,'Staff operation ID belongs to another request');if(receipt.state==='COMPLETED')return {userId:input.userId,state:'COMPLETED',replayed:true};}
 const role=db.prepare('SELECT * FROM roles WHERE id=? AND protected=0').get(input.roleId);
 check(role&&digest({name:role.name,permissions:JSON.parse(role.permissions)})===input.roleDigest,'Role changed; refresh and review its permissions');
 if(!receipt)transaction(identity,()=>{identity.prepare('INSERT OR IGNORE INTO memberships VALUES(?,?,1)').run(tenant,input.userId);check(identity.prepare('SELECT active FROM memberships WHERE tenant_id=? AND user_id=?').get(tenant,input.userId)?.active===1,'Central business membership is suspended');identity.prepare("INSERT INTO business_member_operations VALUES(?,?,?,?,?,'PREPARED',?)").run(operation,tenant,actor,input.userId,payloadDigest,runtime.clock());});
 try{runtime.engine.grantRole(tenant,actor,{id:role.id,name:role.name,permissions:JSON.parse(role.permissions)},input.userId,input.reason.trim());identity.prepare("UPDATE business_member_operations SET state='COMPLETED' WHERE id=?").run(operation);return {userId:input.userId,state:'COMPLETED',replayed:false};}
 catch(error){identity.prepare("UPDATE business_member_operations SET state='NEEDS_RETRY' WHERE id=?").run(operation);throw error;}
}

export function assignBusinessRole(runtime,tenant,actor,input){
 const db=requireOwner(runtime,tenant,actor,true);
 check(input&&Object.keys(input).every(k=>['userId','roleId','assigned','reason'].includes(k))&&validId(input.userId)&&validId(input.roleId)&&input.roleId!=='ultimate_business_admin'&&typeof input.assigned==='boolean'&&reason(input.reason),'Ordinary role, member, assignment and reason required');
 check(db.prepare('SELECT 1 FROM members WHERE user_id=?').get(input.userId),'Member is not in this business');
 check(db.prepare('SELECT 1 FROM roles WHERE id=? AND protected=0').get(input.roleId),'Ordinary role unavailable');
 return transaction(db,()=>{if(input.assigned)db.prepare('INSERT OR IGNORE INTO assignments VALUES(?,?)').run(input.userId,input.roleId);else db.prepare('DELETE FROM assignments WHERE user_id=? AND role_id=?').run(input.userId,input.roleId);runtime.engine.audit(db,null,actor,'BUSINESS_ROLE_ASSIGNMENT_CHANGED',{userId:input.userId,roleId:input.roleId,assigned:input.assigned,reason:input.reason.trim()});return {userId:input.userId,roleId:input.roleId,assigned:input.assigned};});
}
