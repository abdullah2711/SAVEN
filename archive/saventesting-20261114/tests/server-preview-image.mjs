// Run inside the built preview image, without a network or a database service.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import http from 'node:http';
test('the shipped frontend serves actual packaged assets and refuses foreign writes without Workers or a database',async t=>{
 const child=spawn(process.execPath,['scripts/frontend-server.mjs'],{env:{...process.env,PREVIEW_PORT:'18792',PREVIEW_ORIGINS:'https://testing.example.test'},stdio:['ignore','pipe','pipe']});
 t.after(()=>{child.kill('SIGTERM');});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Frontend did not become ready')),10000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Frontend exited: '+code));});child.stdout.on('data',data=>{if(data.toString().includes('frontend ready')){clearTimeout(timer);resolve();}});});
 const call=(path,{host='testing.example.test',origin,body}={})=>new Promise((resolve,reject)=>{const request=http.request({hostname:'127.0.0.1',port:18792,path,method:body?'POST':'GET',headers:{host,...(origin?{origin}:{})}},response=>{let text='';response.on('data',c=>text+=c);response.on('end',()=>resolve({status:response.statusCode,text}));});request.on('error',reject);request.end(body);});
 const root=await call('/');assert.equal(root.status,200);assert.match(root.text,/SA7EN/);assert.match(root.text,/No business records are saved/);
 const catalog=await call('/ui/catalog.js');assert.equal(catalog.status,200);assert.match(catalog.text,/app\.economicsystems\.cc/);
 assert.equal((await call('/app.js')).status,410);assert.equal((await call('/',{host:'foreign.example.test'})).status,421);
 assert.equal((await call('/api/login',{origin:'https://foreign.example.test',body:'{}'})).status,403);
 assert.equal((await call('/api/health')).status,503);
});
