import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresDatabase} from './postgres.mjs';
import {issueGrant} from './fixtures.mjs';
import {redeemGrant} from '../src/auth.mjs';
import {hash,token} from '../src/crypto.mjs';
import {api} from '../src/api.mjs';
const database=process.env.CONTRACT_DATABASE;
if(!database?.startsWith('saven_contract_'))throw Error('Use an isolated contract database.');
const connection={host:process.env.PGHOST??'/var/run/postgresql',port:Number(process.env.PGPORT??5432),database,user:'postgres',password:process.env.PGPASSWORD};
const admin=PostgresDatabase.connect(connection),runtime=PostgresDatabase.connect({...connection,options:'-c role=saven_app'});
let passed=0;const pass=name=>{console.log('PASS accounting workspace: '+name);passed++;};
try{
 if(process.argv.includes('--migrate'))await admin.pool.query(await readFile(new URL('../postgresql/008_accounting_workspace.sql',import.meta.url),'utf8'));
 assert(await runtime.schemaReady());assert.equal(runtime.schemaVersion,6);
 async function login(id){const grant=await issueGrant(admin,id),db=runtime.scoped({grantHash:await hash(grant)}),session=await redeemGrant(db,grant);return {db,raw:session.session};}
 const owner=await login('outsider'),cid=crypto.randomUUID(),path=p=>`/api/companies/${cid}/${p}`;
 async function invoke(who,route,method='GET',input,key){const response=await api(new Request('https://saven.contract'+route,{method,headers:{origin:'https://saven.contract','content-type':'application/json',cookie:'saven_session='+who.raw,...(key?{'idempotency-key':key}:{})},...(input?{body:JSON.stringify(input)}:{})}),{DB:who.db});return {status:response.status,value:await response.json()};}
 assert.equal((await invoke(owner,'/api/companies','POST',{id:cid,name:'Accounting workspace contract',startDate:'2026-01-01',endDate:'2026-12-31'},crypto.randomUUID())).status,201);
 const workspace=async()=>(await invoke(owner,path('workspace'))).value;
 const grant=token();assert.equal((await invoke(owner,path('invites'),'POST',{email:'bank-reviewer@example.invalid',name:'Bank independent reviewer',role:'approver',token:grant,expectedRevision:(await workspace()).company.revision},crypto.randomUUID())).status,201);
 const db=runtime.scoped({grantHash:await hash(grant)}),session=await redeemGrant(db,grant),reviewer={db,raw:session.session};
 let serial=0;const base=(kind,date='2026-11-02')=>({kind,date,reference:'AW-'+(++serial),description:'Synthetic accounting workspace acceptance'});
 const preview=d=>invoke(owner,path('preview'),'POST',d);
 async function submit(d){const p=await preview(d);assert.equal(p.status,200,JSON.stringify(p));const s=await invoke(owner,path('documents'),'POST',{document:p.value.document,expectedRevision:p.value.revision,previewDigest:p.value.digest},crypto.randomUUID());assert.equal(s.status,201,JSON.stringify(s));return s.value.id;}
 const approve=(id,who=reviewer)=>invoke(who,path('documents/'+id+'/approve'),'POST',{expectedVersion:1,expectedEvidenceRevision:0},crypto.randomUUID());
 async function post(d){const id=await submit(d),result=await approve(id);assert.equal(result.status,200,JSON.stringify(result));return id;}
 const opening=await post({...base('journal','2026-11-01'),lines:[{accountId:'bank',debit:'1000.00',credit:'0.00'},{accountId:'opening_equity',debit:'0.00',credit:'1000.00'}]});
 const expense=await post({...base('cash_expense'),cashAccountId:'bank',counterAccountId:'expense',amount:'30.00'});
 const transfer=await post({...base('cash_transfer','2026-11-03'),fromAccountId:'bank',toAccountId:'cash',amount:'100.00'});
 assert.equal((await preview({...base('cash_transfer'),fromAccountId:'bank',toAccountId:'bank',amount:'1.00'})).status,422);
 const reversed=await post({...base('reversal','2026-11-04'),originalDocumentId:expense});assert.equal((await preview({...base('reversal'),originalDocumentId:expense})).status,409);
 assert.equal((await admin.prepare('SELECT status FROM documents WHERE company_id=? AND id=?').bind(cid,expense).first()).status,'posted');
 await post({...base('cash_income','2026-11-05'),cashAccountId:'cash',counterAccountId:'revenue',amount:'50.00'});
 pass('cash transfers, expense/income and exact linked reversals preserve original posted records');
 let report=await invoke(owner,path('accounting')+'?from=2026-11-02&to=2026-11-04&account=bank');assert.equal(report.status,200,JSON.stringify(report));const bank=report.value.accounts.find(a=>a.id==='bank');assert.equal(bank.opening,'1000.00');assert.equal(bank.debit,'30.00');assert.equal(bank.credit,'130.00');assert.equal(bank.closing,'900.00');assert.deepEqual(report.value.ledger.map(l=>l.balance),['970.00','870.00','900.00']);
 assert.equal((await invoke(owner,path('accounting')+'?from=2026-11-01&to=2026-11-30&search=AW-1&status=posted')).value.total,1);
 const financial=(await invoke(owner,path('reports')+'?from=2026-01-01&to=2026-12-31')).value;assert.equal(financial.totals.profit,'50.00');assert.equal(financial.totals.assets,'1050.00');assert.equal(financial.totals.balanceSheetBalanced,true);
 pass('date-based opening, movements, running balance, search and independently expected financial totals');
 async function command(action,data,who=owner,key=crypto.randomUUID()){return invoke(who,path('accounting'),'POST',{action,data,expectedRevision:(await workspace()).company.revision},key);}
 const configured=await invoke(owner,path('configure'),'POST',{entity:'account',data:{name:'Unused account',code:'6990',kind:'expense',category:'general'},expectedRevision:(await workspace()).company.revision},crypto.randomUUID());assert.equal(configured.status,201);const aid=configured.value.id;
 const update=await command('account_update',{id:aid,name:'Travel expenses',code:'6991',active:false,reason:'Archive unused setup account'});assert.equal(update.status,201,JSON.stringify(update));assert.equal((await preview({...base('cash_expense'),cashAccountId:'bank',counterAccountId:aid,amount:'1.00'})).status,409);
 assert.equal((await command('account_update',{id:'bank',name:'Bank',code:'1010',active:false,reason:'Attempt protected archive'})).status,409);
 assert.equal((await command('account_update',{id:aid,name:'Travel expenses',code:'6991',active:true,reason:'Approver cannot administer chart'},reviewer)).status,403);
 pass('audited account rename/archive and protected mappings/current role checks');
 const statement={accountId:'bank',reference:'SYNTHETIC-NOV-2026',from:'2026-11-01',to:'2026-11-30',opening:'0.00',closing:'900.00',lines:[{date:'2026-11-01',reference:'Opening deposit',amount:'1000.00'},{date:'2026-11-02',reference:'Expense',amount:'-30.00'},{date:'2026-11-03',reference:'Cash withdrawal',amount:'-100.00'},{date:'2026-11-04',reference:'Expense correction',amount:'30.00'}]};
 const key=crypto.randomUUID(),created=await command('statement_import',statement,owner,key);assert.equal(created.status,201,JSON.stringify(created));const sid=created.value.id;
 assert.equal((await command('statement_import',statement,owner,key)).value.replayed,true);assert.equal((await command('statement_import',statement)).status,409);
 assert.equal((await command('close',{statementId:sid},reviewer)).status,409);
 const journals=(await admin.prepare('SELECT id,document_id FROM journals WHERE company_id=?').bind(cid).all()).results;
 const jid=id=>journals.find(j=>j.document_id===id).id;
 assert.equal((await command('match',{statementId:sid,lineNo:1,journalId:jid(expense)})).status,409);
 for(const [lineNo,documentId]of [[1,opening],[2,expense],[3,transfer],[4,reversed]]){const matched=await command('match',{statementId:sid,lineNo,journalId:jid(documentId)});assert.equal(matched.status,201,JSON.stringify(matched));}
 assert.equal((await command('close',{statementId:sid})).status,409);
 assert.equal((await command('unmatch',{statementId:sid,lineNo:2,reason:'Reviewer correction'},reviewer)).status,201);assert.equal((await command('close',{statementId:sid},reviewer)).status,409);assert.equal((await command('match',{statementId:sid,lineNo:2,journalId:jid(expense)})).status,201);
 const closed=await command('close',{statementId:sid},reviewer);assert.equal(closed.status,201,JSON.stringify(closed));
 assert.equal((await command('unmatch',{statementId:sid,lineNo:1,reason:'Cannot change closed reconciliation'},reviewer)).status,409);
 pass('statement import replay, overlap, exact matching, attributed unmatch and independent reconciliation closure');
 const late=await submit({...base('cash_expense','2026-11-30'),cashAccountId:'bank',counterAccountId:'expense',amount:'1.00'});assert.equal((await approve(late)).status,409);
 await post({...base('cash_expense','2026-12-01'),cashAccountId:'bank',counterAccountId:'expense',amount:'1.00'});
 assert.equal((await command('statement_import',{...statement,reference:'DEC',from:'2026-12-02',to:'2026-12-31',opening:'900.00',closing:'899.00',lines:[{date:'2026-12-02',reference:'December charge',amount:'-1.00'}]})).status,409);
 pass('closed reconciliation rejects backdated posting atomically and subsequent statements enforce continuity');
 await admin.prepare("INSERT INTO resource_denials(company_id,user_id,resource_type,resource_id) VALUES(?,?,'account','bank')").bind(cid,'outsider').run();
 assert.equal((await invoke(owner,path('accounting'))).status,403);assert.equal((await invoke(owner,path('accounting/statements/'+sid))).status,403);
 assert.equal((await invoke(reviewer,'/api/companies/alpha/accounting')).status,403);
 pass('account restrictions and cross-company denials cover statements, ledger and aggregate data');
 console.log('ACCOUNTING WORKSPACE CONTRACT PASSED: '+passed+' groups');
}finally{await runtime.close();await admin.close();}
