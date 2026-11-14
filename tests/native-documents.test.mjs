import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeRuntime} from '../src/local/runtime.mjs';
import {createNativeHandler} from '../src/local/http.mjs';
const password='Synthetic-test-password-928';
const payload=(extra={})=>({company:'co',branch:'main',date:'2026-11-14',narrative:'Capital contribution',project:'project-one',lines:[{account:'1000',debit:'50.05',credit:'0.00'},{account:'3000',debit:'0.00',credit:'50.05'}],...extra});
async function setup(t){const root=await mkdtemp(join(tmpdir(),'saven-documents-')),r=new NativeRuntime(root),operator=await r.bootstrap('operator@example.test',password),owner=await r.createIdentity('owner@example.test',password);r.provision(operator,{tenantId:'alpha',ownerId:owner,company:'co',branch:'main',name:'Alpha',currency:'PKR',writesUntil:Date.now()+86400000,entitlementSource:'TEST_ONLY'});t.after(async()=>{r.close();await rm(root,{recursive:true,force:true});});return {r,owner,operator,root,db:r.engine.tenant('alpha')};}
test('incomplete drafts survive restart without ledger effects; stale writes fail and only exact balanced saved revision submits',async t=>{
 const {r:initial,owner,root}=await setup(t);let r=initial;let db=r.engine.tenant('alpha');const incomplete=payload({date:'',narrative:'',lines:[{account:'1000',debit:'10.00',credit:''}]});
 const first=r.saveJournalDraft('alpha',owner,{id:'draft-one',revision:0,payload:incomplete});assert.equal(first.number,'JRN-000001');r.close();Object.assign(r,new NativeRuntime(root));db=r.engine.tenant('alpha');assert.equal(r.journalDrafts('alpha',owner,'co','main').rows[0].number,first.number);assert.equal(db.prepare('SELECT count(*) AS n FROM journals').get().n,0);
 assert.throws(()=>r.submitJournalDraft('alpha',owner,{id:first.id,revision:1}),/date|Narrative|lines/);
 const saved=r.saveJournalDraft('alpha',owner,{id:first.id,revision:1,payload:payload({lines:[{account:'1000',debit:'50.05',credit:''},{account:'3000',debit:'',credit:'50.05'}]})});assert.equal(saved.revision,2);
 assert.throws(()=>r.saveJournalDraft('alpha',owner,{id:first.id,revision:1,payload:payload()}),/changed/);
 assert.throws(()=>r.submitJournalDraft('alpha',owner,{id:first.id,revision:1}),/changed/);
 assert.throws(()=>r.prepareJournal('alpha',owner,first.id,payload()),/Draft identity/);
 r.submitJournalDraft('alpha',owner,{id:first.id,revision:2});const posted=r.execute('alpha',owner,first.id);assert.equal(posted.state,'POSTED');
 assert.equal(r.submitJournalDraft('alpha',owner,{id:first.id,revision:2}).replayed,true);assert.equal(r.execute('alpha',owner,first.id).replayed,true);
 assert.throws(()=>r.saveJournalDraft('alpha',owner,{id:first.id,revision:2,payload:payload()}),/submitted/);
 assert.equal(r.trial('alpha',owner,{company:'co',branch:'main'}).totalDebit,'50.05');
});
test('cancelling a saved draft retains its number, advances the sequence and prevents identity reuse',async t=>{
 const {r,owner,db}=await setup(t);r.saveJournalDraft('alpha',owner,{id:'cancel-me',revision:0,payload:payload()});r.cancelJournalDraft('alpha',owner,{id:'cancel-me',revision:1});
 assert.equal(r.saveJournalDraft('alpha',owner,{id:'next',revision:0,payload:payload()}).number,'JRN-000002');
 assert.throws(()=>r.prepareJournal('alpha',owner,'cancel-me',payload()),/Draft identity/);
 assert.throws(()=>db.exec("DELETE FROM document_numbers WHERE id='cancel-me'"),/retained/);assert.throws(()=>db.exec('UPDATE document_sequences SET next_number=1'),/increase/);
 assert.equal(db.prepare("SELECT state FROM journal_drafts WHERE id='cancel-me'").get().state,'CANCELLED');
});
test('a submitted journal duplicates into a new linked draft without posting or copying evidence promises',async t=>{
 const {r,owner,db}=await setup(t);r.postJournal('alpha',owner,'original',payload());const d=r.duplicateJournalDraft('alpha',owner,{id:'copy',originalId:'original',date:'2026-11-15'});
 assert.equal(d.number,'JRN-000002');const draft=r.journalDrafts('alpha',owner,'co','main').rows[0];assert.equal(draft.source_id,'original');assert.equal(draft.payload.date,'2026-11-15');assert.equal(draft.payload.evidence,undefined);assert.equal(db.prepare('SELECT count(*) AS n FROM journals').get().n,1);
});
test('independent return preserves accepted bytes, creates an owned linked draft and original can never post',async t=>{
 const {r,owner,db}=await setup(t),staff=await r.createIdentity('staff@example.test',password);r.engine.central.identity.prepare('INSERT INTO memberships VALUES(?,?,1)').run('alpha',staff);r.engine.grantRole('alpha',owner,{id:'reviewed',name:'Accountant',permissions:{actions:['journal.read','journal.prepare','journal.post','ledger.read'],companies:['co'],branches:['main'],accounts:['1000','3000'],review:true}},staff);
 r.postJournal('alpha',staff,'review-me',payload());const before=db.prepare("SELECT payload FROM command_inbox WHERE id='review-me'").get().payload;
 assert.throws(()=>r.reviewCommand('alpha',staff,{id:'review-me',decision:'RETURNED',reason:'Fix narrative',replacementId:'fixed'}),/scope|Independent/);
 assert.equal(r.reviewCommand('alpha',owner,{id:'review-me',decision:'RETURNED',reason:'Fix narrative',replacementId:'fixed'}).state,'RETURNED');
 assert.equal(db.prepare("SELECT payload FROM command_inbox WHERE id='review-me'").get().payload,before);assert.throws(()=>r.approve('alpha',owner,'review-me'),/Failed/);
 assert.equal(r.journalDrafts('alpha',staff,'co','main').rows[0].source_id,'review-me');assert.equal(db.prepare('SELECT count(*) AS n FROM journals').get().n,0);
 assert.equal(r.reviewCommand('alpha',owner,{id:'review-me',decision:'RETURNED',reason:'Fix narrative',replacementId:'fixed'}).replayed,true);
 assert.throws(()=>r.reviewCommand('alpha',owner,{id:'review-me',decision:'REJECTED',reason:'Different'}),/differently/);
});
test('reviewed posting attributes preparer and actual poster and filters exact project/date/account totals',async t=>{
 const {r,owner}=await setup(t),staff=await r.createIdentity('poster@example.test',password);r.engine.central.identity.prepare('INSERT INTO memberships VALUES(?,?,1)').run('alpha',staff);r.engine.grantRole('alpha',owner,{id:'reviewed',name:'Accountant',permissions:{actions:['journal.read','journal.prepare','journal.post','ledger.read'],companies:['co'],branches:['main'],accounts:['1000','3000'],review:true}},staff);
 r.postJournal('alpha',staff,'reviewed',payload());r.approve('alpha',owner,'reviewed');r.postJournal('alpha',owner,'other',payload({date:'2026-11-15',project:'project-two'}));
 const report=r.ledger('alpha',owner,{company:'co',branch:'main',from:'2026-11-14',to:'2026-11-14',project:'project-one',account:'1000',postedBy:owner,exporting:true});assert.equal(report.count,1);assert.equal(report.totalDebit,'50.05');assert.equal(report.rows[0].prepared_by,staff);assert.equal(report.rows[0].posted_by,owner);assert.equal(report.rows[0].number,'JRN-000001');
 assert.equal(r.ledger('alpha',owner,{company:'co',branch:'main',project:'missing'}).count,0);assert.throws(()=>r.ledger('alpha',owner,{company:'co',branch:'main',from:'2026-11-16',to:'2026-11-14'}),/inverted/);
});
test('draft ownership and resource checks prevent cross-user read, submission, number hijack and revoked access',async t=>{
 const {r,owner,operator}=await setup(t);r.saveJournalDraft('alpha',owner,{id:'private',revision:0,payload:payload()});
 assert.throws(()=>r.submitJournalDraft('alpha',operator,{id:'private',revision:1}),/unavailable/);
 assert.throws(()=>r.journalDrafts('alpha',operator,'co','main'),/membership/);
 r.engine.tenant('alpha').prepare("INSERT INTO denials VALUES(?,'journal.prepare')").run(owner);assert.throws(()=>r.submitJournalDraft('alpha',owner,{id:'private',revision:1}),/denial/);
});
test('new draft routes retain app/operator and CSRF boundaries over the real handler',async t=>{
 const {r,owner}=await setup(t),handler=createNativeHandler(r,{appOrigin:'https://app.example.test',operatorOrigin:'https://ops.example.test'}),auth=await r.login('owner@example.test',password,'app');
 const body={id:'http-draft',revision:0,payload:payload()},headers={'content-type':'application/json',origin:'https://app.example.test',cookie:'__Host-sa7en_app='+auth.token,'x-csrf-token':auth.csrf};
 assert.equal((await handler(new Request('https://app.example.test/api/journal-drafts?tenant=alpha',{method:'POST',headers,body:JSON.stringify(body)}))).status,201);
 assert.equal((await handler(new Request('https://app.example.test/api/journal-drafts?tenant=alpha',{method:'POST',headers:{...headers,'x-csrf-token':'bad'},body:JSON.stringify(body)}))).status,403);
 assert.equal((await handler(new Request('https://ops.example.test/api/journal-drafts?tenant=alpha',{headers}))).status,401);
 assert.equal(r.journalDrafts('alpha',owner,'co','main').rows.length,1);
});
test('trial independently carries prior balances into dated movements and balanced closing columns',async t=>{
 const {r,owner}=await setup(t);r.postJournal('alpha',owner,'opening-position',payload({date:'2026-11-13'}));
 r.postJournal('alpha',owner,'expense',payload({lines:[{account:'5000',debit:'12.25',credit:'0.00'},{account:'1000',debit:'0.00',credit:'12.25'}]}));
 const report=r.trial('alpha',owner,{company:'co',branch:'main',from:'2026-11-14',to:'2026-11-14'}),cash=report.rows.find(x=>x.account==='1000');
 assert.deepEqual({opening:cash.opening,debit:cash.debit,credit:cash.credit,closing:cash.balance},{opening:'50.05',debit:'0.00',credit:'12.25',closing:'37.80'});
 assert.equal(report.totalDebit,'12.25');assert.equal(report.totalCredit,'12.25');assert.equal(report.closingDebit,'50.05');assert.equal(report.closingCredit,'50.05');
 assert.equal(r.statements('alpha',owner,{company:'co',branch:'main',from:'2026-11-14',to:'2026-11-14'}).profit,'-12.25');
});
test('rejection retains its reason and number, creates no correction draft and cannot later be approved',async t=>{
 const {r,owner,db}=await setup(t),staff=await r.createIdentity('reviewed@example.test',password);r.engine.central.identity.prepare('INSERT INTO memberships VALUES(?,?,1)').run('alpha',staff);
 r.engine.grantRole('alpha',owner,{id:'reviewed',name:'Accountant',permissions:{actions:['journal.read','journal.prepare','journal.post'],companies:['co'],branches:['main'],accounts:['1000','3000'],review:true}},staff);
 r.postJournal('alpha',staff,'reject-me',payload());const result=r.reviewCommand('alpha',owner,{id:'reject-me',decision:'REJECTED',reason:'Unsupported source'});assert.equal(result.state,'REJECTED');
 assert.equal(db.prepare('SELECT count(*) AS n FROM journal_drafts').get().n,0);assert.equal(db.prepare("SELECT number FROM document_numbers WHERE id='reject-me'").get().number,'JRN-000001');
 assert.throws(()=>r.approve('alpha',owner,'reject-me'),/Failed/);assert.throws(()=>r.execute('alpha',staff,'reject-me'),/Failed/);
 r.postJournal('alpha',owner,'next-voucher',payload());assert.equal(db.prepare("SELECT number FROM document_numbers WHERE id='next-voucher'").get().number,'JRN-000002');
 assert.equal(r.commands('alpha',owner,'co','main').find(x=>x.id==='reject-me').reviewDecision.reason,'Unsupported source');
});
test('failure after draft financial effects keeps its accepted number and retry commits exactly once',async t=>{
 const {r,owner,db}=await setup(t);r.saveJournalDraft('alpha',owner,{id:'faulted',revision:0,payload:payload()});r.submitJournalDraft('alpha',owner,{id:'faulted',revision:1});
 r.engine.afterFinancialWrite=()=>{throw Error('Injected financial interruption');};assert.throws(()=>r.execute('alpha',owner,'faulted'),/interruption/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM journals').get().n,0);assert.equal(db.prepare("SELECT state FROM journal_drafts WHERE id='faulted'").get().state,'SUBMITTED');
 r.engine.afterFinancialWrite=()=>{};assert.equal(r.execute('alpha',owner,'faulted').state,'POSTED');assert.equal(r.execute('alpha',owner,'faulted').replayed,true);
 assert.equal(db.prepare("SELECT number FROM document_numbers WHERE id='faulted'").get().number,'JRN-000001');assert.equal(db.prepare("SELECT next_number FROM document_sequences WHERE kind='JRN'").get().next_number,2);
});
