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

test('health distinguishes an absent binding, an empty database and the full schema',async t=>{
  const request=()=>new Request('https://saven.test/api/health');
  const absent=await worker.fetch(request(),{});
  assert.equal((await absent.json()).schemaReady,false);
  const db=new LocalDatabase();t.after(()=>db.close());
  const empty=await worker.fetch(request(),{DB:db});
  const emptyHealth=await empty.json();
  assert.equal(emptyHealth.databaseConfigured,true);assert.equal(emptyHealth.schemaReady,false);
  db.migrate();
  const initialized=await worker.fetch(request(),{DB:db});
  assert.equal((await initialized.json()).schemaReady,true);
});

test('PostgreSQL edge route preserves the command and overwrites forged origin metadata',async()=>{
  let received;
  const response=await worker.fetch(new Request('https://saven.test/api/companies/alpha/preview?x=1',{method:'POST',headers:{origin:'https://saven.test','content-type':'application/json','x-saven-public-origin':'https://attacker.invalid',cookie:'saven_session=opaque','idempotency-key':'stable-key'},body:'{"kind":"invoice"}'}),{
    API_MODE:'postgresql',DB:{prepare(){throw new Error('D1 fallback is forbidden');}},SAVEN_API:{async fetch(request){received={url:request.url,origin:request.headers.get('x-saven-public-origin'),cookie:request.headers.get('cookie'),key:request.headers.get('idempotency-key'),redirect:request.redirect,body:await request.text()};return new Response('{"ok":true}',{status:201,headers:{'content-type':'application/json','set-cookie':'saven_session=new; HttpOnly; Secure; SameSite=Strict','cache-control':'public'}});}}
  });
  assert.equal(response.status,201);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('set-cookie'),/HttpOnly/);
  assert.deepEqual(received,{url:'http://saven.internal/api/companies/alpha/preview?x=1',origin:'https://saven.test',cookie:'saven_session=opaque',key:'stable-key',redirect:'manual',body:'{"kind":"invoice"}'});
});
test('maintenance and PostgreSQL outages never write to the former D1 database',async()=>{
  const DB={prepare(){throw new Error('D1 fallback is forbidden');}};
  for(const env of [{API_MODE:'maintenance',DB},{API_MODE:'postgresql',DB},{API_MODE:'postgresql',DB,SAVEN_API:{fetch:async()=>{throw new Error('Origin is down');}}},{API_MODE:'mistyped',DB}]){
    const response=await worker.fetch(new Request('https://saven.test/api/session',{method:'POST',body:'{}'}),env);
    assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
  }
});
