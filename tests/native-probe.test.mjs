import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {probeRequest} from '../scripts/native-probe-request.mjs';

test('loopback acceptance preserves the logical hostname, browser Origin, binary evidence and response cookie over real HTTP',async t=>{
 const bytes=Buffer.from([0,255,1,127]),server=http.createServer(async(req,res)=>{
  assert.equal(req.headers.host,'operator.example.test');assert.equal(req.headers.origin,'https://operator.example.test');assert.equal(req.method,'POST');
  const chunks=[];for await(const c of req)chunks.push(c);assert.deepEqual(Buffer.concat(chunks),bytes);
  res.writeHead(201,{'content-type':'application/octet-stream','set-cookie':'__Host-sa7en_operator=fixture; Path=/; Secure; HttpOnly'});res.end(bytes);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await probeRequest('https://operator.example.test','/api/evidence',{transport:'http://127.0.0.1:'+server.address().port,headers:{origin:'https://operator.example.test'},body:bytes});
 assert.equal(response.status,201);assert.deepEqual(response.bytes,bytes);assert.match(response.headers.get('set-cookie'),/__Host-sa7en_operator/);
});

test('acceptance hostname overrides cannot send credentials to a remote or decorated transport URL',async()=>{
 for(const transport of ['http://example.test','https://localhost','http://localhost/path','http://user:pass@localhost','http://localhost/?secret=1','http://localhost/#x'])await assert.rejects(()=>probeRequest('https://app.example.test','/',{transport}),/localhost HTTP origin/);
});
