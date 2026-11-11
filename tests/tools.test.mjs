import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../scripts/database.mjs';
import { seed,issueGrant } from '../scripts/fixtures.mjs';
import { authenticate,redeemGrant } from '../src/auth.mjs';
import { executeTool } from '../src/tools.mjs';
test('agent tools inherit company and user authority and cannot approve or grant privileges',async t=>{
  const db=new LocalDatabase();db.migrate();t.after(()=>db.close());await seed(db);
  const login=await redeemGrant(db,await issueGrant(db,'viewer'));
  const actor=await authenticate(db,new Request('http://localhost/',{headers:{cookie:`saven_session=${login.session}`}}));
  const context={db,actor,companyId:'alpha',idempotencyKey:crypto.randomUUID()};
  const input={kind:'invoice',date:'2026-11-11',reference:'AI-EXAMPLE',description:'Services',partyId:'customer',amount:'100.00',settlement:'credit'};
  await assert.rejects(executeTool('accounting.preview',input,context),e=>e.code==='PREPARATION_DENIED');
  await assert.rejects(executeTool('accounting.approve',{},context),e=>e.code==='TOOL_NOT_ALLOWED');
  await assert.rejects(executeTool('admin.grant',{},context),e=>e.code==='TOOL_NOT_ALLOWED');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM documents').first()).n,0);
});
