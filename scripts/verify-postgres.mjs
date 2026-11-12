import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresDatabase} from './postgres.mjs';
import {seed,issueGrant} from './fixtures.mjs';
import {redeemGrant,authenticate} from '../src/auth.mjs';
import {preview,submit,review,workspace} from '../src/commands.mjs';
import {hash} from '../src/crypto.mjs';

// Refuse to run financial test fixtures against the application database.
const database=process.env.CONTRACT_DATABASE;
if(!database?.startsWith('saven_contract_'))throw new Error('Use a separate saven_contract_* database.');
const connection={host:process.env.PGHOST??'/var/run/postgresql',port:Number(process.env.PGPORT??5432),database,user:'postgres',password:process.env.PGPASSWORD};
const admin=PostgresDatabase.connect(connection);
let runtime;
let passed=0;
function pass(label){console.log(`PASS PostgreSQL: ${label}`);passed++;}
try {
  if(process.argv.includes('--initialize')){
    assert.equal((await admin.pool.query("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,'0','Contract database must be empty.');
    await admin.pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='saven_app') THEN CREATE ROLE saven_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END $$;");
    for(const file of ['001_schema.sql','002_controls.sql','003_runtime.sql','004_policy_owners.sql'])await admin.pool.query(await readFile(new URL('../postgresql/'+file,import.meta.url),'utf8'));
  }
  await seed(admin);
  runtime=PostgresDatabase.connect({...connection,options:'-c role=saven_app'});
  const role=(await runtime.pool.query('SELECT current_user,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user')).rows[0];
  assert.equal(role.current_user,'saven_app');assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
  assert.equal((await runtime.prepare('SELECT count(*) AS n FROM companies').first()).n,0);
  pass('unscoped non-owner runtime role cannot read company rows');
  async function login(id){const grant=await issueGrant(admin,id),db=runtime.scoped({grantHash:await hash(grant)}),result=await redeemGrant(db,grant);const actor=await authenticate(db,new Request('https://testing.invalid/',{headers:{cookie:`saven_session=${result.session}`}}));return {db,actor,grant,rawToken:result.session};}
  const preparer=await login('preparer'),reviewer=await login('reviewer'),owner=await login('owner'),outsider=await login('outsider');
  await assert.rejects(()=>redeemGrant(runtime.scoped({grantHash:preparer.db.scope.grantHash}),preparer.grant),e=>e.code==='INVALID_INVITATION');
  pass('single-use grant redemption and scoped sessions');
  for(let i=0;i<20;i++){
    const a=await owner.db.prepare('SELECT id FROM companies ORDER BY id').all(),b=await outsider.db.prepare('SELECT id FROM companies ORDER BY id').all();
    assert.deepEqual(a.results.map(x=>x.id),['alpha']);assert.deepEqual(b.results.map(x=>x.id),['beta']);
  }
  await assert.rejects(()=>workspace(outsider.db,outsider.actor,'alpha'),e=>e.code==='COMPANY_DENIED');
  pass('raw SQL row isolation and pooled-connection scope reset');
  const invoice=()=>({kind:'invoice',date:'2026-11-12',reference:crypto.randomUUID(),description:'PostgreSQL contract services',partyId:'customer',amount:'1250.50',settlement:'credit'});
  async function prepare(document,identity=preparer){const p=await preview(identity.db,identity.actor,'alpha',document),key=crypto.randomUUID(),input={document:p.document,expectedRevision:p.revision,previewDigest:p.digest};return {result:await submit(identity.db,identity.actor,'alpha',input,key),input,key};}
  const sale=await prepare(invoice());
  assert.equal((await submit(preparer.db,preparer.actor,'alpha',sale.input,sale.key)).replayed,true);
  await assert.rejects(()=>review(preparer.db,preparer.actor,'alpha',sale.result.id,{expectedVersion:1},crypto.randomUUID(),'approve'),e=>e.code==='APPROVAL_DENIED');
  await review(reviewer.db,reviewer.actor,'alpha',sale.result.id,{expectedVersion:1},crypto.randomUUID(),'approve');
  let totals=await admin.prepare('SELECT sum(debit_minor)::text AS debit,sum(credit_minor)::text AS credit FROM journal_lines').first();
  assert.deepEqual(totals,{debit:'125050',credit:'125050'});
  await assert.rejects(()=>reviewer.db.prepare('UPDATE journal_lines SET debit_minor=1').run());
  await assert.rejects(()=>reviewer.db.prepare('DELETE FROM audit_events').run());
  pass('idempotent invoice, balanced posting, immutable lines and audit');
  const own=await prepare(invoice(),owner);
  await assert.rejects(()=>review(owner.db,owner.actor,'alpha',own.result.id,{expectedVersion:1},crypto.randomUUID(),'approve'),e=>e.code==='SELF_APPROVAL_DENIED');
  await assert.rejects(()=>admin.batch([
    admin.prepare('INSERT INTO journals(company_id,id,document_id,date) VALUES(?,?,?,?)').bind('alpha','unbalanced-test',own.result.id,'2026-11-12'),
    admin.prepare('INSERT INTO journal_lines(company_id,journal_id,line_no,account_id,debit_minor,credit_minor) VALUES(?,?,?,?,?,?)').bind('alpha','unbalanced-test',1,'cash',100,0),
    admin.prepare('INSERT INTO journal_lines(company_id,journal_id,line_no,account_id,debit_minor,credit_minor) VALUES(?,?,?,?,?,?)').bind('alpha','unbalanced-test',2,'revenue',0,99),
    admin.prepare("UPDATE journals SET status='posted' WHERE id='unbalanced-test'")
  ]),/UNBALANCED_JOURNAL/);
  assert.equal(await admin.prepare("SELECT id FROM journals WHERE id='unbalanced-test'").first(),null);
  pass('ultimate-owner self-approval denial and database-enforced balance');
  await admin.pool.query("UPDATE items SET on_hand=1 WHERE company_id='alpha'");
  const stock=()=>({kind:'stock_issue',date:'2026-11-12',reference:crypto.randomUUID(),description:'Last-unit concurrency contract',itemId:'tissue',quantity:'1'});
  const p1=await preview(preparer.db,preparer.actor,'alpha',stock()),p2=await preview(preparer.db,preparer.actor,'alpha',stock());
  const submitPreview=p=>submit(preparer.db,preparer.actor,'alpha',{document:p.document,expectedRevision:p.revision,previewDigest:p.digest},crypto.randomUUID());
  const race=await Promise.allSettled([submitPreview(p1),submitPreview(p2)]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await admin.prepare("SELECT reserved FROM items WHERE company_id='alpha'").first()).reserved,1);
  const winning=race.find(r=>r.status==='fulfilled').value;
  await review(reviewer.db,reviewer.actor,'alpha',winning.id,{expectedVersion:1},crypto.randomUUID(),'approve');
  assert.deepEqual(await admin.prepare("SELECT on_hand,reserved FROM items WHERE company_id='alpha'").first(),{on_hand:0,reserved:0});
  pass('independent PostgreSQL connections serialize the last stock unit');
  const locked=await prepare(invoice());
  await admin.pool.query("UPDATE periods SET locked=1 WHERE company_id='alpha'");
  const before=await admin.prepare('SELECT count(*) AS n FROM audit_events').first();
  await assert.rejects(()=>review(reviewer.db,reviewer.actor,'alpha',locked.result.id,{expectedVersion:1},crypto.randomUUID(),'approve'),e=>e.code==='PERIOD_LOCKED');
  assert.deepEqual(await admin.prepare('SELECT count(*) AS n FROM audit_events').first(),before);
  assert.equal((await admin.prepare('SELECT status FROM documents WHERE id=?').bind(locked.result.id).first()).status,'pending');
  pass('period lock rolls back journal, review, operation and audit effects');
  const old=owner.db;await login('owner');
  await assert.rejects(()=>authenticate(old,new Request('https://testing.invalid/',{headers:{cookie:'saven_session='+owner.rawToken}})),e=>e.code==='SESSION_EXPIRED');
  assert.equal((await old.prepare('SELECT count(*) AS n FROM companies').first()).n,0);
  pass('revoked session loses row scope immediately');
  console.log(`POSTGRESQL CONTRACT PASSED: ${passed} groups`);
} finally {await runtime?.close();await admin.close();}
