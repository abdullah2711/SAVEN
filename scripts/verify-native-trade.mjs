// Explicit isolated QA business only. Existing operator credentials arrive on stdin.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {probeRequest} from './native-probe-request.mjs';
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>8192)throw Error('Credential input too large');}
const credentials=JSON.parse(raw),app=process.env.APP_ORIGIN,ops=process.env.OPERATOR_ORIGIN;
if(!app||!ops)throw Error('Explicit origins required');
async function call(origin,path,{auth,body,key}={}){const r=await probeRequest(origin,path,{headers:{origin,...(auth?{cookie:auth.cookie,'x-csrf-token':auth.csrf}:{}),...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:JSON.parse(r.bytes.toString()),cookie:r.headers.get('set-cookie')};}
const ok=r=>{assert(r.status>=200&&r.status<300,JSON.stringify({status:r.status,error:r.data.error}));return r.data;};
async function login(origin,input){const r=await call(origin,'/api/login',{body:input}),data=ok(r);return {cookie:r.cookie.split(';')[0],csrf:data.csrf};}
const operator=await login(ops,credentials),suffix=randomUUID().slice(0,8),tenant='trade-probe-'+suffix,ownerCredentials={email:'trade-owner-'+suffix+'@example.invalid',password:randomBytes(32).toString('base64url')},ownerId=ok(await call(ops,'/api/operator/identities',{auth:operator,body:ownerCredentials})).userId;
ok(await call(ops,'/api/operator/businesses',{auth:operator,body:{tenantId:tenant,ownerId,company:'company',branch:'main',name:'ISOLATED ACCOUNTING DOCUMENT VERIFICATION '+suffix,currency:'PKR',writesUntil:Date.now()+3600000,entitlementSource:'INTERNAL_TRADE_VERIFICATION_ONLY'}}));
const owner=await login(app,ownerCredentials),scope={company:'company',branch:'main'},query=new URLSearchParams({tenant,...scope}),path=p=>p+'?'+query,date=new Date().toISOString().slice(0,10);
for(const kind of ['customer','supplier'])ok(await call(app,path('/api/trade/parties'),{auth:owner,body:{...scope,id:kind,kind,name:'Synthetic '+kind}}));
const post=async(id,body)=>{ok(await call(app,path('/api/trade/prepare'),{auth:owner,key:id,body}));return ok(await call(app,path('/api/execute'),{auth:owner,body:{commandId:id}}));};
const invoice={...scope,kind:'invoice',party:'customer',date,dueDate:date,reference:'SYNTHETIC-SALE',lines:[{description:'Synthetic consulting',account:'4000',amount:'100.03'}]};
const bill={...scope,kind:'bill',party:'supplier',date,dueDate:date,reference:'SYNTHETIC-BILL',lines:[{description:'Synthetic office cost',account:'5000',amount:'40.01'}]};
const saleId=randomUUID(),billId=randomUUID(),receiptId=randomUUID(),paymentId=randomUUID();assert.equal((await post(saleId,invoice)).state,'POSTED');assert.equal((await post(billId,bill)).state,'POSTED');
const receipt={...scope,kind:'receipt',party:'customer',date,reference:'SYNTHETIC-RECEIPT',cashAccount:'1000',allocations:[{document:saleId,amount:'60.02'}]};
await post(receiptId,receipt);await post(paymentId,{...scope,kind:'payment',party:'supplier',date,reference:'SYNTHETIC-PAYMENT',cashAccount:'1000',allocations:[{document:billId,amount:'10.01'}]});assert.equal((await post(receiptId,receipt)).replayed,true);
const report=ok(await call(app,path('/api/trade'),{auth:owner}));assert.equal(report.documents.find(d=>d.kind==='invoice').outstanding,'40.01');assert.equal(report.documents.find(d=>d.kind==='bill').outstanding,'30.00');assert(report.reconciliation.every(r=>r.difference==='0.00'));
const trial=ok(await call(app,path('/api/trial'),{auth:owner}));assert.equal(trial.rows.find(a=>a.account==='1000').balance,'50.01');assert.equal((await call(app,path('/api/trade/prepare'),{auth:owner,key:randomUUID(),body:{...receipt,reference:'OVERPAY-REFUSED',allocations:[{document:saleId,amount:'40.02'}]}})).status,422);
assert.equal((await call(app,path('/api/trade'),{auth:operator})).status,401);
console.log(JSON.stringify({verified:true,tenant,customerUnpaid:'40.01',supplierUnpaid:'30.00',cash:'50.01',controlDifferences:report.reconciliation.map(r=>r.difference),replay:'exactly once',overpayment:'refused',operatorRealm:'refused',clientReleaseComplete:false}));
