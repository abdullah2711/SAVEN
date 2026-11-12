import {AppError,requireThat} from './errors.mjs';
import {companyAccess} from './auth.mjs';
import {hash} from './crypto.mjs';
import {minor,decimal} from './money.mjs';

export function object(value,allowed){requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k)),422,'INVALID_FIELDS','Provide the supported fields for this action.');}
export function text(value,label,max=160,optional=false){if(optional&&(value===undefined||value===''))return '';requireThat(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max&&!/[\u0000-\u001f]/.test(value),422,'INVALID_FIELD',`Provide a valid ${label} (up to ${max} characters).`);return value.trim();}
export function date(value){requireThat(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,422,'INVALID_DATE','Provide a valid date.');return value;}
function email(value,optional=false){const result=text(value,'email',254,optional).toLowerCase();requireThat(optional&&!result||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result),422,'INVALID_EMAIL','Provide a valid email address.');return result;}
function admin(company){requireThat(['owner','admin'].includes(company.role),403,'ADMIN_REQUIRED','A company administrator must make this change.');}
function key(value){requireThat(typeof value==='string'&&/^[a-zA-Z0-9_-]{16,128}$/.test(value),422,'IDEMPOTENCY_REQUIRED','Provide a stable command key.');return value;}
function revision(value){requireThat(Number.isSafeInteger(value)&&value>0,422,'VERSION_REQUIRED','Refresh the company before saving.');return value;}
export function databaseError(error){
  if(error instanceof AppError)throw error;
  for(const [code,status,message]of [['FORBIDDEN',403,'Your access does not permit this change.'],['OWNER_PROTECTED',403,'The ultimate owner cannot be removed or changed by delegation.'],['INVITATION_DENIED',403,'This invitation is unavailable for the signed-in account. Sign in with the invited email or request a new link.'],['PASSWORD_REQUIRED',409,'Set your own password before joining another company.'],['STALE_PREVIEW',409,'The company changed. Refresh before saving again.'],['IDEMPOTENCY_CONFLICT',409,'This command key was already used with different data.'],['PERIOD_OVERLAP',409,'This date range overlaps an existing accounting period.'],['TESTING_COMPANY_LIMIT',409,'This testing account has reached its company limit.']])if(String(error.message).includes(code))throw new AppError(status,code,message);
  if(error.code==='23505')throw new AppError(409,'DUPLICATE_REFERENCE','That code, email address or reference is already in use.');
  if(['23503','23514','23502'].includes(error.code))throw new AppError(422,'INVALID_REFERENCE','Check the related company records and required fields.');
  throw error;
}
export async function operatingContext(db,actor,companyId){
  const company=await companyAccess(db,actor,companyId);
  const [accounts,parties,periods]=await Promise.all([
    db.prepare('SELECT id,code,name,kind,category FROM accounts WHERE company_id=? ORDER BY code').bind(companyId).all(),
    db.prepare('SELECT id,name,kind,email,phone,address,tax_number FROM parties WHERE company_id=? ORDER BY name').bind(companyId).all(),
    db.prepare('SELECT start_date,end_date,locked FROM periods WHERE company_id=? ORDER BY start_date').bind(companyId).all()
  ]);
  let members=[],changes=[],pendingInvitations=[];
  if(['owner','admin'].includes(company.role)){
    members=(await db.prepare('SELECT u.id,u.name,u.email,m.role,m.active FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=? ORDER BY u.name').bind(companyId).all()).results;
    changes=(await db.prepare('SELECT e.entity_type,e.entity_id,e.created_at,u.name AS actor FROM configuration_events e JOIN users u ON u.id=e.actor_id WHERE e.company_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 30').bind(companyId).all()).results;
    pendingInvitations=(await db.prepare('SELECT * FROM saven_pending_invitations(?)').bind(companyId).all()).results;
  }
  const denied=(await db.prepare('SELECT resource_type,resource_id FROM resource_denials WHERE company_id=? AND user_id=?').bind(companyId,actor.id).all()).results;
  return {capabilities:{administration:true,extendedAccounting:db.schemaVersion>=4,accountingCycles:db.schemaVersion>=4,files:db.schemaVersion>=5,assistant:db.schemaVersion>=5,persistentSignIn:true},accounts:accounts.results.filter(a=>!denied.some(d=>d.resource_type==='account'&&d.resource_id===a.id)),parties:parties.results.filter(p=>!denied.some(d=>d.resource_type==='party'&&d.resource_id===p.id)),periods:periods.results,members,pendingInvitations,configurationChanges:changes};
}
export async function configure(db,actor,companyId,input,commandKey){
  requireThat(db.schemaVersion>=3,503,'UPGRADE_REQUIRED','Company setup is being activated.');
  const company=await companyAccess(db,actor,companyId);admin(company);
  object(input,['entity','data','expectedRevision']);const p=input.data;let data;
  switch(input.entity){
    case 'party':object(p,['name','kind','email','phone','address','taxNumber']);requireThat(['customer','supplier','both'].includes(p.kind),422,'INVALID_PARTY_KIND','Choose customer, supplier or both.');data={name:text(p.name,'name'),kind:p.kind,email:email(p.email,true),phone:text(p.phone,'phone',60,true),address:text(p.address,'address',500,true),taxNumber:text(p.taxNumber,'tax number',80,true)};break;
    case 'account':object(p,['name','code','kind','category']);requireThat(['asset','liability','equity','income','expense'].includes(p.kind)&&['general','cash_bank','receivable','payable','inventory'].includes(p.category),422,'INVALID_ACCOUNT','Choose a supported account type and category.');requireThat(p.category==='general'||(p.category==='payable'?p.kind==='liability':p.kind==='asset'),422,'INVALID_ACCOUNT','The account category must agree with its financial-statement type.');data={name:text(p.name,'account name'),code:text(p.code,'account code',30),kind:p.kind,category:p.category};break;
    case 'item':{
      object(p,['name','store','unit','unitCost','inventoryAccountId','expenseAccountId']);
      const accounts=(await db.prepare('SELECT id,kind,category FROM accounts WHERE company_id=?').bind(companyId).all()).results;
      requireThat(accounts.some(a=>a.id===p.inventoryAccountId&&a.kind==='asset'&&a.category==='inventory')&&accounts.some(a=>a.id===p.expenseAccountId&&a.kind==='expense'),422,'ACCOUNT_MAPPING','Choose an inventory asset and an expense account.');
      data={name:text(p.name,'item name'),store:text(p.store,'store name',100),unit:text(p.unit,'unit',30),unitCostMinor:minor(p.unitCost,{positive:true}),inventoryAccountId:p.inventoryAccountId,expenseAccountId:p.expenseAccountId};break;
    }
    case 'company':object(p,['name','address','taxNumber']);data={name:text(p.name,'company name'),address:text(p.address,'address',500,true),taxNumber:text(p.taxNumber,'tax number',80,true)};break;
    case 'period':object(p,['startDate','endDate','locked','reason']);requireThat(company.role==='owner',403,'OWNER_REQUIRED','Only the ultimate owner can administer periods.');requireThat(typeof p.locked==='boolean',422,'INVALID_FIELD','Choose whether this period is locked.');data={startDate:date(p.startDate),endDate:date(p.endDate),locked:p.locked?1:0,reason:text(p.reason,'reason',500)};requireThat(data.startDate<=data.endDate,422,'INVALID_DATE','The period end must follow its start.');break;
    case 'membership':object(p,['userId','role','active']);requireThat(company.role==='owner'&&['admin','preparer','approver','viewer'].includes(p.role)&&typeof p.active==='boolean',403,'OWNER_REQUIRED','Only the ultimate owner can change delegated roles.');data={userId:text(p.userId,'user ID',80),role:p.role,active:p.active?1:0};break;
    default:throw new AppError(422,'INVALID_CONFIGURATION','Choose a supported setup action.');
  }
  try{return (await db.prepare('SELECT saven_configure(?,?,?,?,?) AS result').bind(companyId,input.entity,JSON.stringify(data),revision(input.expectedRevision),key(commandKey)).first()).result;}catch(error){databaseError(error);}
}
export async function createCompany(db,actor,input,commandKey){
  requireThat(db.schemaVersion>=3,503,'UPGRADE_REQUIRED','Company setup is being activated.');
  object(input,['id','name','address','taxNumber','startDate','endDate']);
  const data={name:text(input.name,'company name'),address:text(input.address,'address',500,true),taxNumber:text(input.taxNumber,'tax number',80,true),startDate:date(input.startDate),endDate:date(input.endDate)};
  requireThat(data.startDate<=data.endDate&&new Date(data.endDate)-new Date(data.startDate)<=366*86400000,422,'INVALID_DATE','Choose an accounting year of at most 366 days.');
  const id=text(input.id,'company ID',80);requireThat(/^[a-zA-Z0-9_-]{16,80}$/.test(id),422,'INVALID_ID','Provide a stable company ID.');
  try{return (await db.prepare('SELECT saven_create_company(?,?,?) AS result').bind(id,JSON.stringify(data),key(commandKey)).first()).result;}catch(error){databaseError(error);}
}
export async function invite(db,actor,companyId,input,commandKey){
  const company=await companyAccess(db,actor,companyId);admin(company);
  object(input,['email','name','role','token','expectedRevision']);
  requireThat(['admin','preparer','approver','viewer'].includes(input.role)&&(!(input.role==='admin')||company.role==='owner'),403,'INVITATION_DENIED','Only the ultimate owner can create additional administrators.');
  requireThat(typeof input.token==='string'&&/^[a-f0-9]{64}$/.test(input.token)&&new Set(input.token).size>=8,422,'INVALID_INVITATION','Generate a fresh secure invitation.');
  const data={email:email(input.email),name:text(input.name,'name'),role:input.role};
  try{return {...(await db.prepare('SELECT saven_invite(?,?,?,?,?) AS result').bind(companyId,JSON.stringify(data),await hash(input.token),revision(input.expectedRevision),key(commandKey)).first()).result,token:input.token};}catch(error){databaseError(error);}
}
export async function membershipInvitation(db,actor,input,action){
  object(input,['token']);requireThat(typeof input.token==='string'&&/^[a-f0-9]{64}$/.test(input.token),422,'INVALID_INVITATION','Provide a valid company invitation.');
  const sql=action==='preview'?'SELECT saven_invitation_preview(?) AS result':'SELECT saven_invitation_accept(?) AS result';
  try{return (await db.prepare(sql).bind(await hash(input.token)).first()).result;}catch(error){databaseError(error);}
}
export async function reports(db,actor,companyId,query){
  await companyAccess(db,actor,companyId);
  const denied=(await db.prepare('SELECT resource_id FROM resource_denials WHERE company_id=? AND user_id=?').bind(companyId,actor.id).all()).results;
  requireThat(!denied.length,403,'REPORT_ACCESS','Full transaction and account access is required for company financial reports.');
  const from=query.get('from')?date(query.get('from')):'1900-01-01',to=query.get('to')?date(query.get('to')):'2099-12-31';requireThat(from<=to,422,'INVALID_DATE','Choose a valid report range.');
  const [trial,ledger]=await Promise.all([
    db.prepare("SELECT a.id,a.code,a.name,a.kind,coalesce(sum(CASE WHEN j.date<=? AND j.status='posted' THEN l.debit_minor ELSE 0 END),0)::text AS debit,coalesce(sum(CASE WHEN j.date<=? AND j.status='posted' THEN l.credit_minor ELSE 0 END),0)::text AS credit,coalesce(sum(CASE WHEN j.date BETWEEN ? AND ? AND j.status='posted' THEN l.debit_minor-l.credit_minor ELSE 0 END),0)::text AS period_net FROM accounts a LEFT JOIN journal_lines l ON l.company_id=a.company_id AND l.account_id=a.id LEFT JOIN journals j ON j.company_id=l.company_id AND j.id=l.journal_id WHERE a.company_id=? GROUP BY a.id,a.code,a.name,a.kind ORDER BY a.code").bind(to,to,from,to,companyId).all(),
    db.prepare("SELECT j.date,d.id AS document_id,d.reference,d.description,a.code,a.name,l.debit_minor,l.credit_minor FROM journals j JOIN journal_lines l ON l.company_id=j.company_id AND l.journal_id=j.id JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id JOIN documents d ON d.company_id=j.company_id AND d.id=j.document_id WHERE j.company_id=? AND j.status='posted' AND j.date BETWEEN ? AND ? ORDER BY j.date,d.reference,l.line_no LIMIT 500").bind(companyId,from,to).all()
  ]);
  // Partial financial statements can be misleading. Require full account access
  // until a separately labelled/redacted reporting policy is implemented.
  let debit=0n,credit=0n,debitBalance=0n,creditBalance=0n,income=0n,expense=0n,assets=0n,liabilities=0n,equity=0n;
  const accounts=trial.results.map(a=>{const d=BigInt(a.debit),c=BigInt(a.credit),net=d-c,p=BigInt(a.period_net);debit+=d;credit+=c;if(net>0n)debitBalance+=net;else creditBalance-=net;if(a.kind==='income')income-=p;if(a.kind==='expense')expense+=p;if(a.kind==='asset')assets+=net;if(a.kind==='liability')liabilities-=net;if(a.kind==='equity')equity-=net;return {...a,debit:decimal(d),credit:decimal(c),net:decimal(net),periodNet:decimal(p)};});
  const cumulativeEarnings=trial.results.reduce((sum,a)=>sum+(['income','expense'].includes(a.kind)?BigInt(a.credit)-BigInt(a.debit):0n),0n);
  return {from,to,accounts,totals:{debit:decimal(debit),credit:decimal(credit),debitBalance:decimal(debitBalance),creditBalance:decimal(creditBalance),balanced:debit===credit,income:decimal(income),expense:decimal(expense),profit:decimal(income-expense),assets:decimal(assets),liabilities:decimal(liabilities),equity:decimal(equity),cumulativeEarnings:decimal(cumulativeEarnings),liabilitiesAndEquity:decimal(liabilities+equity+cumulativeEarnings),balanceSheetBalanced:assets===liabilities+equity+cumulativeEarnings},ledger:ledger.results.map(l=>({...l,debit:decimal(l.debit_minor),credit:decimal(l.credit_minor),debit_minor:undefined,credit_minor:undefined})),ledgerLimited:ledger.results.length===500};
}
