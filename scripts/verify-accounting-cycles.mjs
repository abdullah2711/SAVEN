import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresDatabase} from './postgres.mjs';
import {issueGrant} from './fixtures.mjs';
import {redeemGrant} from '../src/auth.mjs';
import {hash,token} from '../src/crypto.mjs';
import {api} from '../src/api.mjs';
const database=process.env.CONTRACT_DATABASE;
if(!database?.startsWith('saven_contract_'))throw new Error('Use a separate saven_contract_* database.');
const connection={host:process.env.PGHOST??'/var/run/postgresql',port:Number(process.env.PGPORT??5432),database,user:'postgres',password:process.env.PGPASSWORD};
const admin=PostgresDatabase.connect(connection),runtime=PostgresDatabase.connect({...connection,options:'-c role=saven_app'});
const origin='https://saven.contract';let passed=0;const pass=name=>{console.log('PASS accounting cycles: '+name);passed++;};
try{
 if(process.argv.includes('--migrate'))await admin.pool.query(await readFile(new URL('../postgresql/006_accounting_cycles.sql',import.meta.url),'utf8'));
 assert.equal(await runtime.schemaReady(),true);assert.equal(runtime.schemaVersion,4);
 async function login(id){const grant=await issueGrant(admin,id),db=runtime.scoped({grantHash:await hash(grant)}),result=await redeemGrant(db,grant);return {db,raw:result.session};}
 const owner=await login('outsider');
 async function invoke(identity,path,method='GET',input,key){const response=await api(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'saven_session='+identity.raw,...(key?{'idempotency-key':key}:{})},...(input?{body:JSON.stringify(input)}:{})}),{DB:identity.db,ENVIRONMENT:'contract'});return {status:response.status,value:await response.json()};}
 const companyId=crypto.randomUUID(),endpoint=part=>`/api/companies/${companyId}/${part}`;
 const created=await invoke(owner,'/api/companies','POST',{id:companyId,name:'Accounting cycle contract',startDate:'2026-01-01',endDate:'2026-12-31'},crypto.randomUUID());assert.equal(created.status,201,JSON.stringify(created.value));
 const context=async()=>(await invoke(owner,endpoint('workspace'))).value;
 const configure=async(entity,data)=>invoke(owner,endpoint('configure'),'POST',{entity,data,expectedRevision:(await context()).company.revision},crypto.randomUUID());
 const customer=await configure('party',{name:'Cycle customer',kind:'customer'}),supplier=await configure('party',{name:'Cycle supplier',kind:'supplier'});assert.equal(customer.status,201);assert.equal(supplier.status,201);
 const grant=token(),invitation=await invoke(owner,endpoint('invites'),'POST',{name:'Cycle independent reviewer',email:'cycle-reviewer@example.invalid',role:'approver',token:grant,expectedRevision:(await context()).company.revision},crypto.randomUUID());assert.equal(invitation.status,201);
 const reviewDb=runtime.scoped({grantHash:await hash(grant)}),reviewSession=await redeemGrant(reviewDb,grant),reviewer={db:reviewDb,raw:reviewSession.session};
 const preview=document=>invoke(owner,endpoint('preview'),'POST',document);
 async function submit(effect,key=crypto.randomUUID()){return invoke(owner,endpoint('documents'),'POST',{document:effect.document,previewDigest:effect.digest,expectedRevision:effect.revision},key);}
 async function review(id,action='approve'){return invoke(reviewer,endpoint(`documents/${id}/${action}`),'POST',{expectedVersion:1},crypto.randomUUID());}
 let serial=0;
 const base=kind=>({kind,date:'2026-11-12',reference:'CYCLE-'+(++serial),description:'Synthetic independent accounting contract'});
 async function post(document){const effect=await preview(document);assert.equal(effect.status,200,JSON.stringify(effect.value));const submitted=await submit(effect.value);assert.equal(submitted.status,201,JSON.stringify(submitted.value));const posted=await review(submitted.value.id);assert.equal(posted.status,200,JSON.stringify(posted.value));return {id:submitted.value.id,effect:effect.value};}
 const bill=await post({...base('bill'),partyId:supplier.value.id,expenseAccountId:'expense',amount:'1000.10'});
 assert.deepEqual(bill.effect.lines.map(l=>[l.accountId,l.debit,l.credit]),[['expense','1000.10','0.00'],['payable','0.00','1000.10']]);
 assert.equal((await preview({...base('bill'),partyId:customer.value.id,expenseAccountId:'expense',amount:'10.00'})).status,422);
 assert.equal((await preview({...base('invoice'),partyId:supplier.value.id,settlement:'credit',amount:'10.00'})).status,422);
 pass('supplier bills post the independently expected expense and payable with contact validation');
 const invoice=await post({...base('invoice'),partyId:customer.value.id,settlement:'credit',amount:'250.25'});
 const firstReceipt=await post({...base('receipt'),targetDocumentId:invoice.id,cashAccountId:'bank',amount:'100.00'});
 assert.equal(firstReceipt.effect.allocation.availableAfter,'150.25');
 await post({...base('receipt'),targetDocumentId:invoice.id,cashAccountId:'bank',amount:'150.25'});
 assert.equal((await preview({...base('receipt'),targetDocumentId:invoice.id,cashAccountId:'bank',amount:'0.01'})).status,409);
 assert.equal((await preview({...base('payment'),targetDocumentId:invoice.id,cashAccountId:'bank',amount:'1.00'})).status,422);
 await post({...base('payment'),targetDocumentId:bill.id,cashAccountId:'bank',amount:'400.04'});
 await post({...base('payment'),targetDocumentId:bill.id,cashAccountId:'bank',amount:'600.06'});
 assert.equal((await preview({...base('payment'),targetDocumentId:bill.id,cashAccountId:'bank',amount:'0.01'})).status,409);
 pass('partial/final customer receipts and supplier payments settle exactly without over-allocation');
 const journal=await post({...base('journal'),lines:[{accountId:'bank',debit:'5000.00',credit:'0.00'},{accountId:'opening_equity',debit:'0.00',credit:'5000.00'}]});
 assert.equal(journal.effect.amount,'5000.00');
 assert.equal((await preview({...base('journal'),lines:[{accountId:'bank',debit:'2.00',credit:'0.00'},{accountId:'opening_equity',debit:'0.00',credit:'1.00'}]})).status,422);
 assert.equal((await preview({...base('journal'),lines:[{accountId:'receivable',debit:'2.00',credit:'0.00'},{accountId:'opening_equity',debit:'0.00',credit:'2.00'}]})).status,422);
 pass('balanced manual journals and protection against bypassing subsidiary control accounts');
 const concurrentInvoice=await post({...base('invoice'),partyId:customer.value.id,settlement:'credit',amount:'100.01'});
 const proposals=await Promise.all([preview({...base('receipt'),targetDocumentId:concurrentInvoice.id,cashAccountId:'bank',amount:'60.00'}),preview({...base('receipt'),targetDocumentId:concurrentInvoice.id,cashAccountId:'bank',amount:'60.00'})]);
 const submissions=await Promise.all(proposals.map(p=>submit(p.value)));
 assert.deepEqual(submissions.map(r=>r.status).sort(),[201,409]);
 const pending=submissions.find(r=>r.status===201).value;
 assert.equal((await preview({...base('receipt'),targetDocumentId:concurrentInvoice.id,cashAccountId:'bank',amount:'50.00'})).status,409);
 assert.equal((await review(pending.id,'reject')).status,200);
 assert.equal((await preview({...base('receipt'),targetDocumentId:concurrentInvoice.id,cashAccountId:'bank',amount:'100.01'})).status,200);
 pass('concurrent receipt reservations serialize and returned requests release the available balance');
 const report=await invoke(owner,endpoint('reports')+'?from=2026-01-01&to=2026-12-31');assert.equal(report.status,200);assert.equal(report.value.totals.profit,'-649.84');assert.equal(report.value.totals.assets,'4350.16');assert.equal(report.value.totals.balanced,true);assert.equal(report.value.totals.balanceSheetBalanced,true);
 const balances=Object.fromEntries(report.value.accounts.map(a=>[a.id,a.net]));assert.equal(balances.bank,'4250.15');assert.equal(balances.receivable,'100.01');assert.equal(balances.payable,'0.00');
 const fullReceipt=await post({...base('invoice'),partyId:customer.value.id,settlement:'receipt',cashAccountId:'bank',amount:'1.00'});
 assert.equal((await preview({...base('receipt'),targetDocumentId:fullReceipt.id,cashAccountId:'bank',amount:'0.01'})).status,409);
 pass('whole-cycle financial reconciliation and blocking a second receipt for an already paid sale');
 console.log(`ACCOUNTING CYCLE CONTRACT PASSED: ${passed} groups`);
}finally{await runtime.close();await admin.close();}
