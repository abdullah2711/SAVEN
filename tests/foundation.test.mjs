import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../scripts/database.mjs';
import { seed,issueGrant } from '../scripts/fixtures.mjs';
import { redeemGrant,authenticate } from '../src/auth.mjs';
import { preview,submit,review,workspace } from '../src/commands.mjs';
import { minor,decimal } from '../src/money.mjs';
import { api } from '../src/api.mjs';

async function setup(t) {
  const db=new LocalDatabase();db.migrate();await seed(db);t.after(()=>db.close());
  const actors={};
  for(const id of ['owner','preparer','reviewer','viewer','outsider']) {
    const login=await redeemGrant(db,await issueGrant(db,id));
    actors[id]=await authenticate(db,new Request('http://localhost/',{headers:{cookie:`saven_session=${login.session}`}}));
    actors[id].rawToken=login.session;
  }
  return {db,...actors};
}
const key=()=>crypto.randomUUID();
const invoice=(extra={})=>({kind:'invoice',date:'2026-11-11',reference:key(),description:'Professional services',partyId:'customer',amount:'1250.50',settlement:'credit',...extra});
const stock=(extra={})=>({kind:'stock_issue',date:'2026-11-11',reference:key(),description:'Office supplies',itemId:'tissue',quantity:'1',...extra});
async function prepare(db,actor,document,companyId='alpha',commandKey=key()){
  const result=await preview(db,actor,companyId,document);
  const input={document:result.document,expectedRevision:result.revision,previewDigest:result.digest};
  return {result:await submit(db,actor,companyId,input,commandKey),input,commandKey,preview:result};
}
test('decimal arithmetic rejects floats, exponent notation, negatives and excess precision',()=>{
  assert.equal(minor('0.29'),29);assert.equal(decimal(125050),'1250.50');
  for(const value of [0.1,'0.001','1e3','-1','NaN','01','10000000000']) assert.throws(()=>minor(value));
  assert.throws(()=>minor('0',{positive:true}));
});
test('invoice preview follows credit, separate receipt, and direct-cash choices exactly',async t=>{
  const {db,preparer}=await setup(t);
  const credit=await preview(db,preparer,'alpha',invoice());
  assert.deepEqual(credit.lines.map(l=>[l.accountId,l.debit,l.credit]),[['receivable','1250.50','0.00'],['revenue','0.00','1250.50']]);
  const receipt=await preview(db,preparer,'alpha',invoice({settlement:'receipt',cashAccountId:'bank'}));
  assert.deepEqual(receipt.lines.map(l=>[l.accountId,l.debit,l.credit]),[['receivable','1250.50','0.00'],['revenue','0.00','1250.50'],['bank','1250.50','0.00'],['receivable','0.00','1250.50']]);
  const cash=await preview(db,preparer,'alpha',invoice({settlement:'cash',cashAccountId:'cash'}));
  assert.deepEqual(cash.lines.map(l=>l.accountId),['cash','revenue']);
});
test('invoice posts one balanced immutable journal with audit and outbox in the same transaction',async t=>{
  const {db,preparer,reviewer}=await setup(t);
  const draft=await prepare(db,preparer,invoice());
  assert.equal((await db.prepare('SELECT count(*) AS n FROM journals').first()).n,0);
  const result=await review(db,reviewer,'alpha',draft.result.id,{expectedVersion:1},key(),'approve');
  assert.equal(result.status,'posted');
  const totals=await db.prepare('SELECT sum(debit_minor) AS debit,sum(credit_minor) AS credit FROM journal_lines').first();
  assert.equal(totals.debit,125050);assert.equal(totals.credit,125050);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM audit_events').first()).n,2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM outbox').first()).n,2);
  assert.throws(()=>db.sqlite.exec("UPDATE journal_lines SET debit_minor=1"),/JOURNAL_IMMUTABLE/);
  assert.throws(()=>db.sqlite.exec("DELETE FROM journals"),/JOURNAL_IMMUTABLE/);
  assert.throws(()=>db.sqlite.exec("UPDATE documents SET amount_minor=1"),/DOCUMENT_IMMUTABLE/);
});
test('stock reservation and approval reduce physical stock exactly once',async t=>{
  const {db,preparer,reviewer}=await setup(t);
  const draft=await prepare(db,preparer,stock());
  let item=await db.prepare("SELECT on_hand,reserved FROM items WHERE company_id='alpha'").first();
  assert.deepEqual({...item},{on_hand:120,reserved:1});
  const commandKey=key(),input={expectedVersion:1};
  await review(db,reviewer,'alpha',draft.result.id,input,commandKey,'approve');
  const repeated=await review(db,reviewer,'alpha',draft.result.id,input,commandKey,'approve');
  assert.equal(repeated.replayed,true);
  item=await db.prepare("SELECT on_hand,reserved FROM items WHERE company_id='alpha'").first();
  assert.deepEqual({...item},{on_hand:119,reserved:0});
  assert.equal((await db.prepare('SELECT count(*) AS n FROM journals').first()).n,1);
  assert.equal((await db.prepare('SELECT sum(debit_minor) AS n FROM journal_lines').first()).n,25000);
});
test('rejecting an issue releases its reservation without changing physical stock or ledger',async t=>{
  const {db,preparer,reviewer}=await setup(t);const draft=await prepare(db,preparer,stock({quantity:'2'}));
  await review(db,reviewer,'alpha',draft.result.id,{expectedVersion:1},key(),'reject');
  assert.deepEqual({...await db.prepare("SELECT on_hand,reserved FROM items WHERE company_id='alpha'").first()},{on_hand:120,reserved:0});
  assert.equal((await db.prepare('SELECT count(*) AS n FROM journals').first()).n,0);
});
test('retry with the same key returns original submission; changed payload conflicts',async t=>{
  const {db,preparer}=await setup(t),draft=await prepare(db,preparer,invoice());
  const repeat=await submit(db,preparer,'alpha',draft.input,draft.commandKey);
  assert.equal(repeat.id,draft.result.id);assert.equal(repeat.replayed,true);
  await assert.rejects(submit(db,preparer,'alpha',{...draft.input,document:{...draft.input.document,amount:'1.00'}},draft.commandKey),e=>e.code==='IDEMPOTENCY_CONFLICT');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM documents').first()).n,1);
});
test('two competing last-unit requests cannot over-reserve stock',async t=>{
  const {db,preparer}=await setup(t);
  db.sqlite.exec("UPDATE items SET on_hand=1 WHERE company_id='alpha'");
  const documentA=stock(),documentB=stock();
  const [a,b]=await Promise.all([preview(db,preparer,'alpha',documentA),preview(db,preparer,'alpha',documentB)]);
  const results=await Promise.allSettled([a,b].map(p=>submit(db,preparer,'alpha',{document:p.document,previewDigest:p.digest,expectedRevision:p.revision},key())));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.prepare("SELECT reserved FROM items WHERE company_id='alpha'").first()).reserved,1);
});
test('another user must approve even when the preparer is the ultimate owner',async t=>{
  const {db,owner}=await setup(t),draft=await prepare(db,owner,invoice());
  await assert.rejects(review(db,owner,'alpha',draft.result.id,{expectedVersion:1},key(),'approve'),e=>e.code==='SELF_APPROVAL_DENIED');
});
test('company membership and resource restrictions apply to reads and writes',async t=>{
  const {db,outsider,viewer,preparer}=await setup(t);
  await assert.rejects(workspace(db,outsider,'alpha'),e=>e.code==='COMPANY_DENIED');
  await assert.rejects(preview(db,viewer,'alpha',invoice()),e=>e.code==='PREPARATION_DENIED');
  db.sqlite.exec("INSERT INTO resource_denials VALUES('alpha','preparer','party','customer')");
  await assert.rejects(preview(db,preparer,'alpha',invoice()),e=>e.code==='RESOURCE_DENIED');
  assert.equal((await workspace(db,preparer,'alpha')).parties.length,0);
});
test('revoked account access hides related documents and audit records',async t=>{
  const {db,preparer,reviewer}=await setup(t);await prepare(db,preparer,invoice());
  db.sqlite.exec("INSERT INTO resource_denials VALUES('alpha','reviewer','account','revenue')");
  const view=await workspace(db,reviewer,'alpha');
  assert.equal(view.documents.length,0);assert.equal(view.audit.length,0);
});
test('wrong-company foreign keys are rejected by the database',async t=>{
  const {db}=await setup(t);
  db.sqlite.exec("INSERT INTO accounts VALUES('beta','only-beta','9999','Private account','asset')");
  assert.throws(()=>db.sqlite.exec("UPDATE items SET inventory_account='only-beta' WHERE company_id='alpha'"),/FOREIGN KEY/);
});
test('stale previews and tampered preview digests cannot be submitted',async t=>{
  const {db,preparer}=await setup(t),p=await preview(db,preparer,'alpha',invoice());
  await assert.rejects(submit(db,preparer,'alpha',{document:p.document,previewDigest:'tampered',expectedRevision:p.revision},key()),e=>e.code==='STALE_PREVIEW');
  db.sqlite.exec("UPDATE companies SET revision=revision+1 WHERE id='alpha'");
  await assert.rejects(submit(db,preparer,'alpha',{document:p.document,previewDigest:p.digest,expectedRevision:p.revision},key()),e=>e.code==='STALE_PREVIEW');
});
test('a period locked after submission blocks posting and rolls back every attempted effect',async t=>{
  const {db,preparer,reviewer}=await setup(t),draft=await prepare(db,preparer,stock());
  db.sqlite.exec("UPDATE periods SET locked=1 WHERE company_id='alpha'");
  await assert.rejects(review(db,reviewer,'alpha',draft.result.id,{expectedVersion:1},key(),'approve'),e=>e.code==='PERIOD_LOCKED');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM journals').first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM operations').first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM audit_events').first()).n,1);
  assert.deepEqual({...await db.prepare("SELECT on_hand,reserved FROM items WHERE company_id='alpha'").first()},{on_hand:120,reserved:1});
  assert.equal((await db.prepare('SELECT status FROM documents').first()).status,'pending');
});
test('database rejects unbalanced or directly posted journals and preserves prior data',async t=>{
  const {db,preparer}=await setup(t),draft=await prepare(db,preparer,invoice());
  assert.throws(()=>db.sqlite.prepare("INSERT INTO journals VALUES('alpha','bad',?, '2026-11-11','posted')").run(draft.result.id),/JOURNAL_BUILD_REQUIRED/);
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO journals VALUES('alpha','bad',?,'2026-11-11','building')").bind(draft.result.id),
    db.prepare("INSERT INTO journal_lines VALUES('alpha','bad',1,'cash',100,0)"),
    db.prepare("INSERT INTO journal_lines VALUES('alpha','bad',2,'revenue',0,99)"),
    db.prepare("UPDATE journals SET status='posted' WHERE id='bad'")
  ]),/UNBALANCED_JOURNAL/);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM journals').first()).n,0);
});
test('one active session per account; invitation tokens are single use',async t=>{
  const {db,preparer}=await setup(t),grant=await issueGrant(db,'preparer');
  const login=await redeemGrant(db,grant);
  await assert.rejects(authenticate(db,new Request('http://localhost/',{headers:{cookie:`saven_session=${preparer.rawToken}`}})),e=>e.code==='SESSION_EXPIRED');
  await assert.rejects(redeemGrant(db,grant),e=>e.code==='INVALID_INVITATION');
  assert.equal((await authenticate(db,new Request('http://localhost/',{headers:{cookie:`saven_session=${login.session}`}}))).id,'preparer');
  const stored=await db.prepare('SELECT token_hash FROM sessions WHERE user_id=?').bind('preparer').first();
  assert.notEqual(stored.token_hash,login.session);
});
test('paused companies disappear and reject even previously prepared commands',async t=>{
  const {db,preparer}=await setup(t);db.sqlite.exec("UPDATE companies SET status='paused' WHERE id='alpha'");
  await assert.rejects(preview(db,preparer,'alpha',invoice()),e=>e.code==='COMPANY_DENIED');
  const response=await api(new Request('http://localhost/api/me',{headers:{cookie:`saven_session=${preparer.rawToken}`}}),{DB:db});
  assert.deepEqual((await response.json()).companies.map(row=>row.id),['beta']);
});
test('ultimate owner and audit records cannot be deleted or demoted',async t=>{
  const {db,preparer}=await setup(t);await prepare(db,preparer,invoice());
  assert.throws(()=>db.sqlite.exec("DELETE FROM memberships WHERE user_id='owner'"),/OWNER_PROTECTED/);
  assert.throws(()=>db.sqlite.exec("UPDATE memberships SET role='viewer' WHERE user_id='owner'"),/OWNER_PROTECTED/);
  assert.throws(()=>db.sqlite.exec('DELETE FROM audit_events'),/AUDIT_IMMUTABLE/);
});
test('invalid dates, unknown fields, negative/fractional stock and unsupported cash accounts are rejected',async t=>{
  const {db,preparer}=await setup(t);
  for(const document of [invoice({date:'2026-02-30'}),invoice({taxRate:'18'}),invoice({settlement:'cash',cashAccountId:'revenue'}),stock({quantity:'-1'}),stock({quantity:'1.5'}),stock({quantity:'0'})]) {
    await assert.rejects(preview(db,preparer,'alpha',document),e=>e.status===422);
  }
});
test('HTTP API enforces authentication, origin, JSON size, and private responses',async t=>{
  const {db,preparer}=await setup(t),env={DB:db};
  const call=(path,options={})=>api(new Request(`http://localhost${path}`,options),env);
  assert.equal((await call('/api/me')).status,401);
  assert.equal((await call('/api/session',{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:'{}'})).status,403);
  const large=await call('/api/companies/alpha/preview',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',cookie:`saven_session=${preparer.rawToken}`},body:JSON.stringify({description:'x'.repeat(17000)})});
  assert.equal(large.status,413);
  const response=await call('/api/me',{headers:{cookie:`saven_session=${preparer.rawToken}`}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  const unavailable=await api(new Request('http://localhost/api/me'),{});
  assert.equal(unavailable.status,503);
});
