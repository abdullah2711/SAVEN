import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresDatabase} from './postgres.mjs';
import {issueGrant} from './fixtures.mjs';
import {redeemGrant} from '../src/auth.mjs';
import {hash,token} from '../src/crypto.mjs';
import {api} from '../src/api.mjs';
const database=process.env.CONTRACT_DATABASE;if(!database?.startsWith('saven_contract_'))throw Error('Use an isolated contract database.');
const connection={host:process.env.PGHOST??'/var/run/postgresql',port:Number(process.env.PGPORT??5432),database,user:'postgres',password:process.env.PGPASSWORD};
const admin=PostgresDatabase.connect(connection),runtime=PostgresDatabase.connect({...connection,options:'-c role=saven_app'});let passed=0;const pass=s=>{console.log('PASS recurring: '+s);passed++;};
try{
 if(process.argv.includes('--migrate'))await admin.pool.query(await readFile(new URL('../postgresql/011_recurring_journals.sql',import.meta.url),'utf8'));
 assert(await runtime.schemaReady());assert.equal(runtime.schemaVersion,9);
 const grant=await issueGrant(admin,'outsider'),odb=runtime.scoped({grantHash:await hash(grant)}),os=await redeemGrant(odb,grant),owner={db:odb,raw:os.session};
 async function invoke(who,path,method='GET',input,key){const r=await api(new Request('https://saven.contract'+path,{method,headers:{origin:'https://saven.contract','content-type':'application/json',cookie:'saven_session='+who.raw,...(key?{'idempotency-key':key}:{})},...(!['GET','HEAD'].includes(method)?{body:JSON.stringify(input??{})}:{})}),{DB:who.db});return {status:r.status,value:await r.json()};}
 const cid=crypto.randomUUID(),path=p=>`/api/companies/${cid}/${p}`;assert.equal((await invoke(owner,'/api/companies','POST',{id:cid,name:'Recurring accounting contract',startDate:'2026-01-01',endDate:'2026-12-31'},crypto.randomUUID())).status,201);
 const workspace=async()=>(await invoke(owner,path('workspace'))).value;
 const rg=token(),invited=await invoke(owner,path('invites'),'POST',{name:'Recurring independent reviewer',email:'recurring-'+cid+'@example.invalid',role:'approver',token:rg,expectedRevision:(await workspace()).company.revision},crypto.randomUUID());assert.equal(invited.status,201,JSON.stringify(invited));const rdb=runtime.scoped({grantHash:await hash(rg)}),rs=await redeemGrant(rdb,rg),reviewer={db:rdb,raw:rs.session};
 const p={code:'RENT',name:'Fixed monthly rent',description:'Synthetic rent allocation',firstDate:'2026-01-31',everyMonths:1,occurrences:3,lines:[{accountId:'expense',debit:'125.25',credit:'0.00'},{accountId:'bank',debit:'0.00',credit:'125.25'}]};
 async function command(action,data,key=crypto.randomUUID(),rev){return invoke(owner,path('recurring'),'POST',{action,data,expectedRevision:rev??(await workspace()).company.revision},key);}
 const rev=(await workspace()).company.revision,k=crypto.randomUUID(),created=await command('create',p,k,rev);assert.equal(created.status,201,JSON.stringify(created));const sid=created.value.id;assert.equal((await command('create',p,k,rev)).value.replayed,true);assert.equal((await command('create',{...p,name:'Changed'},k,rev)).status,409);
 assert.equal((await invoke(reviewer,path('recurring'),'POST',{action:'create',data:{...p,code:'BADROLE'},expectedRevision:(await workspace()).company.revision},crypto.randomUUID())).status,403);
 assert.equal((await command('create',{...p,code:'BADCONTROL',lines:[{accountId:'receivable',debit:'125.25',credit:'0.00'},p.lines[1]]})).status,422);
 assert.equal((await admin.prepare('SELECT count(*) AS n FROM journals WHERE company_id=?').bind(cid).first()).n,0);
 let detail=(await invoke(owner,path('recurring/'+sid))).value;assert.deepEqual(detail.occurrences.map(o=>o.date),['2026-01-31','2026-02-28','2026-03-31']);pass('immutable schedule creation is role-limited, balanced, idempotent, month-end anchored and posts no journal');
 const preview=async(index,attempt=1)=>invoke(owner,path('recurring/'+sid+'/preview'),'POST',{index,attempt});
 const submit=async(effect,key=crypto.randomUUID())=>invoke(owner,path('documents'),'POST',{document:effect.document,previewDigest:effect.digest,expectedRevision:effect.revision},key);
 async function review(who,id,action='approve'){const d=await invoke(who,path('documents/'+id));return invoke(who,path('documents/'+id+'/'+action),'POST',{expectedVersion:d.value.version,expectedEvidenceRevision:d.value.evidenceRevision},crypto.randomUUID());}
 let effect=await preview(0);assert.equal(effect.status,200,JSON.stringify(effect));assert.equal((await invoke(owner,path('preview'),'POST',{...effect.value.document,lines:[{...p.lines[0],debit:'125.26'},{...p.lines[1],credit:'125.26'}]})).status,409);
 const keys=[crypto.randomUUID(),crypto.randomUUID()],attempts=await Promise.all(keys.map(key=>submit(effect.value,key)));assert.deepEqual(attempts.map(r=>r.status).sort(),[201,409]);const winner=attempts.findIndex(r=>r.status===201),first=attempts[winner].value;assert.equal((await submit(effect.value,keys[winner])).value.replayed,true);assert.equal((await review(owner,first.id)).status,403);assert.equal((await preview(0)).status,409);
 assert.equal((await admin.prepare('SELECT count(*) AS n FROM journals WHERE company_id=?').bind(cid).first()).n,0);
 await command('pause',{id:sid,reason:'Suspend future preparation'});assert.equal((await preview(1)).status,409);assert.equal((await review(reviewer,first.id)).status,200);await command('resume',{id:sid,reason:'Resume the reviewed template'});
 assert.equal((await admin.prepare('SELECT count(*) AS n FROM journals WHERE company_id=?').bind(cid).first()).n,1);pass('concurrent occurrence claims post at most once; pause blocks preparation but preserves pending independent approval');
 effect=await preview(1);const second=await submit(effect.value);assert.equal(second.status,201,JSON.stringify(second));assert.equal((await review(reviewer,second.value.id,'reject')).status,200);
 assert.equal((await preview(1,1)).status,409);effect=await preview(1,2);assert.equal(effect.status,200,JSON.stringify(effect));const retry=await submit(effect.value);assert.equal(retry.status,201,JSON.stringify(retry));assert.equal((await review(reviewer,retry.value.id)).status,200);
 detail=(await invoke(owner,path('recurring/'+sid))).value;assert.equal(detail.occurrences[1].attempts.length,2);assert.equal(detail.occurrences[1].attempts[0].status,'rejected');assert.equal(detail.occurrences[1].status,'posted');assert.notEqual(second.value.id,retry.value.id);pass('returned occurrences retain rejected evidence and use a new immutable attempt without duplicate active journals');
 await assert.rejects(()=>odb.prepare('UPDATE recurring_schedules SET lines_json=? WHERE company_id=? AND id=?').bind('[]',cid,sid).run(),e=>e.code==='42501');await assert.rejects(()=>odb.prepare('DELETE FROM recurring_runs WHERE company_id=?').bind(cid).run(),e=>e.code==='42501');
 const period={entity:'period',data:{startDate:'2026-01-01',endDate:'2026-12-31',locked:true,reason:'Synthetic close after occurrence preparation'},expectedRevision:(await workspace()).company.revision};
 effect=await preview(2);assert.equal(effect.status,200);const third=await submit(effect.value);assert.equal(third.status,201,JSON.stringify(third));assert.equal((await invoke(owner,path('configure'),'POST',period,crypto.randomUUID())).status,409); // submission changed revision
 period.expectedRevision=(await workspace()).company.revision;assert.equal((await invoke(owner,path('configure'),'POST',period,crypto.randomUUID())).status,201);assert.equal((await review(reviewer,third.value.id)).status,409);assert.equal((await preview(2)).status,409);
 await admin.prepare("INSERT INTO resource_denials(company_id,user_id,resource_type,resource_id) VALUES(?,'outsider','account','bank')").bind(cid).run();assert.equal((await invoke(owner,path('recurring'))).status,403);assert.equal((await invoke(owner,path('recurring/'+sid))).status,403);
 const outside=await invoke(reviewer,'/api/companies/alpha/recurring');assert.equal(outside.status,403);pass('period locks, resource restrictions and company boundaries persist; runtime cannot alter template lines or delete occurrence history');
 assert.equal((await admin.prepare("SELECT count(*) AS n FROM journals j JOIN journal_lines l ON l.company_id=j.company_id AND l.journal_id=j.id WHERE j.company_id=? AND j.status='posted' GROUP BY j.id HAVING sum(l.debit_minor)!=sum(l.credit_minor)").bind(cid).all()).results.length,0);
 console.log('RECURRING CONTRACT PASSED: '+passed+' groups');
}finally{await runtime.close();await admin.close();}
