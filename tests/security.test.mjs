import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePassword,verifyPassword,securityApi} from '../src/security.mjs';

test('passwords use unique scrypt salts and verify exact Unicode input',async()=>{
  const secret='Testing only — correct horse 2711';
  const a=await encodePassword(secret),b=await encodePassword(secret);
  assert.notEqual(a,b);assert.equal(await verifyPassword(secret,a),true);
  assert.equal(await verifyPassword(secret+'x',a),false);
  assert.equal(await verifyPassword(secret,'malformed hash'),false);
  assert.equal(a.includes(secret),false);
  await assert.rejects(()=>encodePassword('too short'),e=>e.code==='PASSWORD_LENGTH');
});
test('password sign-in rejects a foreign origin before touching credentials',async()=>{
  const db={schemaVersion:3,prepare(){throw new Error('Credentials must not be queried.');}};
  const response=await securityApi(new Request('https://saven.test/api/login',{method:'POST',headers:{origin:'https://attacker.invalid','content-type':'application/json'},body:JSON.stringify({email:'owner@example.invalid',password:'testing-only-password'})}),db);
  assert.equal(response.status,403);assert.equal((await response.json()).error.code,'ORIGIN_DENIED');
});
test('sign-in rate limit stops before credential lookup or password work',async()=>{
  let queries=0;
  const db={schemaVersion:3,prepare(sql){assert.match(sql,/saven_auth_limit/);queries++;return {bind(){return {first:async()=>({allowed:false})};}};}};
  const response=await securityApi(new Request('https://saven.test/api/login',{method:'POST',headers:{origin:'https://saven.test','content-type':'application/json'},body:JSON.stringify({email:'owner@example.invalid',password:'testing-only-password'})}),db);
  assert.equal(response.status,429);assert.equal(queries,1);assert.equal(response.headers.get('cache-control'),'no-store');
});
