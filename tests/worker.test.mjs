import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { LocalDatabase } from '../scripts/database.mjs';
import { seed,issueGrant } from '../scripts/fixtures.mjs';

test('Worker end-to-end: invitation, preview, submit, new reviewer session, approval and retry',async t=>{
  const db=new LocalDatabase();db.migrate();await seed(db);t.after(()=>db.close());
  const env={DB:db,ENVIRONMENT:'testing'};
  const invoke=(path,method='GET',input,cookie='',key)=>worker.fetch(new Request(`https://saven.test${path}`,{method,headers:{origin:'https://saven.test',...(input?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(key?{'idempotency-key':key}:{})},...(input?{body:JSON.stringify(input)}:{})}),env);
  const login=async id=>{
    const response=await invoke('/api/session','POST',{token:await issueGrant(db,id)});
    assert.equal(response.status,200);
    assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    assert.ok(response.headers.get('set-cookie').includes('Secure'));
    return response.headers.get('set-cookie').split(';')[0];
  };
  const preparer=await login('preparer');
  const doc={kind:'invoice',date:'2026-11-11',reference:'HTTP-001',description:'Consulting services',partyId:'customer',amount:'8500.25',settlement:'receipt',cashAccountId:'bank'};
  const previewResponse=await invoke('/api/companies/alpha/preview','POST',doc,preparer);
  assert.equal(previewResponse.status,200);const p=await previewResponse.json();
  assert.equal(p.lines.length,4);
  const submitted=await invoke('/api/companies/alpha/documents','POST',{document:p.document,expectedRevision:p.revision,previewDigest:p.digest},preparer,crypto.randomUUID());
  assert.equal(submitted.status,201);const result=await submitted.json();
  const reviewer=await login('reviewer'),key=crypto.randomUUID();
  const approved=await invoke(`/api/companies/alpha/documents/${result.id}/approve`,'POST',{expectedVersion:1},reviewer,key);
  assert.equal(approved.status,200);assert.equal((await approved.json()).status,'posted');
  const repeated=await invoke(`/api/companies/alpha/documents/${result.id}/approve`,'POST',{expectedVersion:1},reviewer,key);
  assert.equal((await repeated.json()).replayed,true);
  const workspace=await invoke('/api/companies/alpha/workspace','GET',null,reviewer);
  const data=await workspace.json();assert.equal(data.documents.length,1);assert.equal(data.documents[0].status,'posted');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM journals').first()).n,1);
});
test('Worker serves static assets with security headers and fails closed without a database',async()=>{
  const env={ASSETS:{fetch:async()=>new Response('<h1>SAVEN</h1>',{headers:{'Content-Type':'text/html'}})}};
  const response=await worker.fetch(new Request('https://saven.test/'),env);
  assert.equal(response.status,200);assert.equal(response.headers.get('x-frame-options'),'DENY');
  assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000');
  const api=await worker.fetch(new Request('https://saven.test/api/me'),env);
  assert.equal(api.status,503);assert.equal((await api.json()).error.code,'SETUP_REQUIRED');
});
