import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresDatabase} from './postgres.mjs';
import {issueGrant} from './fixtures.mjs';
import {redeemGrant} from '../src/auth.mjs';
import {hash,token} from '../src/crypto.mjs';
import {api} from '../src/api.mjs';
const database=process.env.CONTRACT_DATABASE;if(!database?.startsWith('saven_contract_'))throw Error('Use an isolated contract database.');
const connection={host:process.env.PGHOST??'/var/run/postgresql',port:Number(process.env.PGPORT??5432),database,user:'postgres',password:process.env.PGPASSWORD};
const admin=PostgresDatabase.connect(connection),runtime=PostgresDatabase.connect({...connection,options:'-c role=saven_app'});let passed=0;const pass=s=>{console.log('PASS party accounting: '+s);passed++;};
try{
 if(process.argv.includes('--migrate'))await admin.pool.query(await readFile(new URL('../postgresql/009_party_accounting.sql',import.meta.url),'utf8'));
 assert(await runtime.schemaReady());assert.equal(runtime.schemaVersion,7);
 const grant=await issueGrant(admin,'outsider'),db=runtime.scoped({grantHash:await hash(grant)}),session=await redeemGrant(db,grant),owner={db,raw:session.session},cid=crypto.randomUUID(),path=p=>`/api/companies/${cid}/${p}`;
 async function invoke(who,route,method='GET',input,key){const r=await api(new Request('https://saven.contract'+route,{method,headers:{origin:'https://saven.contract','content-type':'application/json',cookie:'saven_session='+who.raw,...(key?{'idempotency-key':key}:{})},...(input?{body:JSON.stringify(input)}:{})}),{DB:who.db});return {status:r.status,value:await r.json()};}
 assert.equal((await invoke(owner,'/api/companies','POST',{id:cid,name:'Party accounting contract',startDate:'2026-01-01',endDate:'2026-12-31'},crypto.randomUUID())).status,201);
 const workspace=async()=>(await invoke(owner,path('workspace'))).value;
 async function configure(entity,data){const r=await invoke(owner,path('configure'),'POST',{entity,data,expectedRevision:(await workspace()).company.revision},crypto.randomUUID());assert.equal(r.status,201,JSON.stringify(r));return r.value.id;}
 const customer=await configure('party',{name:'Synthetic receivable',kind:'customer'}),supplier=await configure('party',{name:'Synthetic payable',kind:'supplier'});
 const rg=token();assert.equal((await invoke(owner,path('invites'),'POST',{name:'Party reviewer',email:'party-reviewer@example.invalid',role:'approver',token:rg,expectedRevision:(await workspace()).company.revision},crypto.randomUUID())).status,201);
 const rdb=runtime.scoped({grantHash:await hash(rg)}),rs=await redeemGrant(rdb,rg),reviewer={db:rdb,raw:rs.session};let serial=0;const base=(kind,date='2026-11-12')=>({kind,date,reference:'PARTY-'+(++serial),description:'Synthetic party accounting acceptance'});
 const preview=d=>invoke(owner,path('preview'),'POST',d);
 async function submit(p){return invoke(owner,path('documents'),'POST',{document:p.document,expectedRevision:p.revision,previewDigest:p.digest},crypto.randomUUID());}
 async function post(d){const p=await preview(d);assert.equal(p.status,200,JSON.stringify(p));const s=await submit(p.value);assert.equal(s.status,201,JSON.stringify(s));const r=await invoke(reviewer,path('documents/'+s.value.id+'/approve'),'POST',{expectedVersion:1,expectedEvidenceRevision:0},crypto.randomUUID());assert.equal(r.status,200,JSON.stringify(r));return s.value.id;}
 const invoice=await post({...base('invoice','2026-11-01'),partyId:customer,settlement:'credit',amount:'100.00',dueDate:'2026-11-15'});
 await post({...base('receipt','2026-11-10'),targetDocumentId:invoice,cashAccountId:'bank',amount:'40.00'});
 const credit=await post({...base('credit_note'),targetDocumentId:invoice,amount:'20.00'});
 assert.equal((await preview({...base('credit_note'),targetDocumentId:invoice,amount:'40.01'})).status,409);
 assert.equal((await preview({...base('credit_note','2026-10-31'),targetDocumentId:invoice,amount:'1.00'})).status,422);
 await post({...base('receipt','2026-12-01'),targetDocumentId:invoice,cashAccountId:'bank',amount:'10.00'});
 pass('partial customer credits share allocation capacity with receipts and preserve invoice linkage');
 const bill=await post({...base('bill','2026-11-01'),partyId:supplier,expenseAccountId:'expense',amount:'80.00',dueDate:'2026-11-20'});
 await post({...base('supplier_credit'),targetDocumentId:bill,amount:'5.00'});
 await post({...base('payment','2026-11-18'),targetDocumentId:bill,cashAccountId:'bank',amount:'25.00'});
 assert.equal((await preview({...base('supplier_credit'),targetDocumentId:invoice,amount:'1.00'})).status,422);
 pass('supplier credits reverse the original expense and reduce payable without creating cash');
 const report=async(kind,from,to,party)=>invoke(owner,path('party-ledger')+'?'+new URLSearchParams({kind,from,to,party}));
 let r=await report('customer','2026-11-11','2026-11-30',customer);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.value.totals.total,'40.00');assert.equal(r.value.totals.days1to30,'40.00');assert.equal(r.value.ageing[0].daysOverdue,15);assert.equal(r.value.statement.opening,'60.00');assert.equal(r.value.statement.credits,'20.00');assert.equal(r.value.statement.closing,'40.00');assert.equal(r.value.statement.movements[0].originalDocumentId,invoice);
 r=await report('customer','2026-01-01','2026-11-11',customer);assert.equal(r.value.totals.current,'60.00');assert.equal(r.value.statement.closing,'60.00');
 r=await report('supplier','2026-01-01','2026-11-30',supplier);assert.equal(r.value.totals.total,'50.00');assert.equal(r.value.statement.charges,'80.00');assert.equal(r.value.statement.credits,'30.00');assert.equal(r.value.statement.closing,'50.00');
 const financial=(await invoke(owner,path('reports')+'?from=2026-01-01&to=2026-11-30')).value;assert.equal(financial.totals.profit,'5.00');assert.equal(financial.totals.assets,'55.00');assert.equal(financial.totals.liabilities,'50.00');assert.equal(financial.totals.balanceSheetBalanced,true);
 pass('due-date ageing and contact statements reproduce historical cutoffs and independently expected GL');
 const proposals=await Promise.all([preview({...base('credit_note'),targetDocumentId:invoice,amount:'20.00'}),preview({...base('credit_note'),targetDocumentId:invoice,amount:'20.00'})]);const submissions=await Promise.all(proposals.map(p=>submit(p.value)));assert.deepEqual(submissions.map(s=>s.status).sort(),[201,409]);
 assert.equal((await preview({...base('receipt'),targetDocumentId:invoice,cashAccountId:'bank',amount:'10.01'})).status,409);
 assert.equal((await invoke(reviewer,path('documents/'+submissions.find(s=>s.status===201).value.id+'/reject'),'POST',{expectedVersion:1,expectedEvidenceRevision:0},crypto.randomUUID())).status,200);
 assert.equal((await preview({...base('receipt'),targetDocumentId:invoice,cashAccountId:'bank',amount:'30.00'})).status,200);
 pass('competing credits and settlements serialize and rejection releases reserved capacity');
 const close=await invoke(owner,path('close-review')+'?from=2026-11-01&to=2026-11-30');assert.equal(close.status,200,JSON.stringify(close));assert.equal(close.value.receivables.ledger,'40.00');assert.equal(close.value.receivables.balanced,true);assert.equal(close.value.payables.ledger,'50.00');assert.equal(close.value.payables.balanced,true);assert.equal(close.value.unbalanced,0);assert(close.value.missingEvidence>0);assert(close.value.unmatchedBank>0);assert.equal(close.value.humanReviewRequired,true);
 pass('close review reconciles AR/AP controls and surfaces missing evidence and unmatched cash entries');
 await admin.prepare("INSERT INTO resource_denials(company_id,user_id,resource_type,resource_id) VALUES(?,?,'party',?)").bind(cid,'outsider',customer).run();assert.equal((await report('customer','2026-01-01','2026-11-30',customer)).status,403);assert.equal((await invoke(owner,path('close-review'))).status,403);assert.equal((await invoke(reviewer,'/api/companies/alpha/party-ledger')).status,403);
 pass('party restrictions and company scope protect statements and ageing totals');
 console.log('PARTY ACCOUNTING CONTRACT PASSED: '+passed+' groups');
}finally{await runtime.close();await admin.close();}
