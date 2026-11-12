import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {LocalBucket,inspectFile,fileBody,scanWithClamd} from '../src/object-store.mjs';

test('private objects preserve original bytes, reject traversal/overwrite and detect tampering',async()=>{
 const root=await mkdtemp(join(tmpdir(),'saven-bucket-')),bucket=new LocalBucket(root),bytes=Buffer.from('Retained original evidence'),meta=inspectFile('invoice.txt',bytes),id=randomUUID();
 try{const path=await bucket.put('alpha',id,meta,bytes);const stored={sha256:meta.sha256,byte_size:bytes.length};assert.deepEqual(await bucket.get('alpha',id,stored),bytes);await assert.rejects(()=>bucket.put('alpha',id,meta,bytes),e=>e.code==='EEXIST');await assert.rejects(()=>bucket.get('../beta',id,stored),e=>e.code==='OBJECT_KEY');await writeFile(path,Buffer.from('Changed original evidence'));await assert.rejects(()=>bucket.get('alpha',id,stored),e=>e.code==='OBJECT_INTEGRITY');}finally{await rm(root,{recursive:true,force:true});}
});
test('upload inspection rejects executable disguises, unsafe names and oversized streamed bodies',async()=>{
 for(const name of ['../a.txt','C:\\secret.txt','.hidden.txt'])assert.throws(()=>inspectFile(name,Buffer.from('hello')));
 assert.throws(()=>inspectFile('evidence.pdf',Buffer.from('MZ executable bytes')),e=>e.code==='FILE_TYPE');
 assert.throws(()=>inspectFile('data.txt',Buffer.from([0,255,0])),e=>e.code==='FILE_TYPE');
 assert.equal(inspectFile('data.csv',Buffer.from('name,amount\nA,2.10')).mediaType,'text/csv');
 await assert.rejects(()=>fileBody(new Request('http://local',{method:'POST',headers:{'content-type':'application/octet-stream'},body:Buffer.alloc(10*1024*1024+1)})),e=>e.code==='FILE_SIZE');
});
test('ClamAV protocol consumes original stream and distinguishes clean from infected results',async()=>{
 const bytes=Buffer.from('Synthetic file for scanner contract');let received=Buffer.alloc(0),result='stream: OK\0';
 const server=createServer(socket=>{let all=Buffer.alloc(0);socket.on('data',chunk=>{all=Buffer.concat([all,chunk]);if(all.length>=10+4+bytes.length+4){assert.equal(all.subarray(0,10).toString(),'zINSTREAM\0');assert.equal(all.readUInt32BE(10),bytes.length);received=all.subarray(14,14+bytes.length);socket.end(result);}});});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const config={host:'127.0.0.1',port:server.address().port,timeout:1000};assert.equal(await scanWithClamd(bytes,config),'clean');assert.deepEqual(received,bytes);result='stream: Synthetic-Signature FOUND\0';assert.equal(await scanWithClamd(bytes,config),'infected');}finally{server.close();await once(server,'close');}
});
