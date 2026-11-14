import {test} from 'node:test';import assert from 'node:assert/strict';
import {createServerPreview} from '../src/server-preview.mjs';
const origin='https://testing.example.test';

test('server-hosted testing retains asset boundaries and makes no Worker request',async()=>{
 const seen=[];const handle=createServerPreview({origins:[origin],readAsset:async r=>{seen.push(r.url);return new Response('static asset');},forward:()=>{throw Error('No API call expected');}});
 assert.equal((await handle(new Request(origin+'/'))).status,200);assert.equal(seen[0],origin+'/');
 assert.equal((await handle(new Request(origin+'/design/'))).status,302);
 assert.equal((await handle(new Request(origin+'/app.js'))).status,410);
 assert.equal((await handle(new Request('https://foreign.example.test/'))).status,421);
});

test('the local proxy overwrites forged public origin and preserves ordinary auth without granting authority',async()=>{
 let called;const handle=createServerPreview({origins:[origin],readAsset:()=>{throw Error('No asset expected');},forward:async r=>{called=r;assert.equal(await r.text(),'{"amount":"10.01"}');return new Response('refused',{status:403});}});
 const r=await handle(new Request(origin+'/api/submit?company=alpha',{method:'POST',headers:{origin,'x-saven-public-origin':'https://evil.example.test','x-sa7en-relay-key':'forged',cookie:'fixture=retained','x-csrf-token':'fixture'},body:'{"amount":"10.01"}'}));
 assert.equal(r.status,403);assert.equal(called.url,'http://127.0.0.1:8788/api/submit?company=alpha');assert.equal(called.headers.get('x-saven-public-origin'),origin);assert.equal(called.headers.get('cookie'),'fixture=retained');assert.equal(called.headers.get('x-csrf-token'),'fixture');assert.equal(called.headers.get('x-sa7en-relay-key'),null);
});

test('foreign browser writes and unavailable local APIs fail closed without another data store',async()=>{
 let calls=0;const handle=createServerPreview({origins:[origin],readAsset:()=>{},forward:()=>{calls++;throw Error('offline');}});
 assert.equal((await handle(new Request(origin+'/api/submit',{method:'POST',headers:{origin:'https://foreign.example.test'},body:'{}'}))).status,403);assert.equal(calls,0);
 assert.equal((await handle(new Request(origin+'/api/health'))).status,503);assert.equal(calls,1);
});
