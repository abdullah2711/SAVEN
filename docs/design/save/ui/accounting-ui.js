import {escape as e,cents,decimal} from './model.js';
import {chart,fixture,ledger,trial,statements,reviewJournal,csv} from './accounting-model.js';
import {icon} from './icons.js';
import {PROJECTS,LOCATIONS,COST_CENTRES} from './accounting-model.js';
import {createAccountingSetup} from './accounting-setup.js';
import {createScreens,plannedPage} from './screens.js';
const button=(label,action,extra='',primary=false)=>`<button type="button" class="button ${primary?'primary':''}" data-ac="${action}" ${extra}>${label}</button>`;
const field=(name,label,value,type='text',extra='')=>`<label>${label}<input name="${name}" value="${e(value)}" type="${type}" ${extra}></label>`;
const options=(values,current)=>values.map(([v,t])=>`<option value="${e(v)}" ${v===current?'selected':''}>${e(t)}</option>`).join('');
let seq=1;
const nowTime=()=>{const d=new Date();return [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');};
const BUSINESS_START='2026-07-01';
const OPEN_PERIODS=[['2026-11-01','2026-11-30']];
const BANK_ACCOUNTS=['Standard Bank — current 0123456789','Meezan Bank — current 0987654321'];
const CASH_CUSTODIANS=['Cash — front desk (A. Khan)','Cash — store (S. Ali)'];
const CUSTOMER_NAMES=['Atlas Studio','Linden Design','Harbor Workshop','Crescent Textiles','Meridian Pharma','Orion Logistics','Sapphire Retail','Indus Packaging','Kestrel Engineering','Marina Hospitality'];
const SUPPLIER_NAMES=['Willow Supplies','Maple Packaging','Cedar Services','Pak Print House','Al-Noor Freight','Metro Office Supply','Secure Line','Digital Systems'];
const partyOptions=(current,control)=>!control?'':(control==='receivable'?CUSTOMER_NAMES:SUPPLIER_NAMES).map(n=>`<option value="${e(n)}" ${n===current?'selected':''}>${e(n)}</option>`).join('');
const number=n=>`<span class="numeric">${e(n)}</span>`;
export function createAccountingUI({render,navigate,notify,dirty,getCompany}){
 const setup=createAccountingSetup({render,notify,dirty,getCompany});
 let selected='1010',query='',range={from:'2026-11-01',to:'2026-11-30'},open=new Set(['Assets','Liabilities','Equity','Income','Expenses']),accounts=chart.map(a=>({...a})),statement='profit',formTab='entry',saved=false,draft={date:'2026-11-13',number:'',reference:'',narrative:'Office expenses',decision:'direct',entryType:'normal',entrySubtype:'journal',location:'HQ',time:'',evidence:[],lines:[{account:'5000',debit:'100.00',credit:'0.00',description:'Office expenses',party:'',project:'',location:'HQ',costCentre:''},{account:'1010',debit:'0.00',credit:'100.00',description:'Bank payment',party:'Standard Bank — current 0123456789',project:'',location:'HQ',costCentre:''}]};
 const data=()=>fixture(getCompany());
 const screens=createScreens({getCompany,range:()=>range,navigate,notify,accounts:()=>accounts});
 function download(name,rows){const url=URL.createObjectURL(new Blob([csv([['SA7EN TESTING - SAMPLE DATA ONLY'],...rows])],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function table(headers,rows){return `<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">No matching sample records.</td></tr>`}</tbody></table></div>`;}
 function filters(){return `<form class="filterbar" id="accounting-filter">${field('from','From',range.from,'date','required')}${field('to','To',range.to,'date','required')}${field('query','Reference, party or description',query,'search')}<button class="button primary">Apply filters</button></form>`;}
 function sourceButton(id){return `<button class="text-button" data-ac="source" data-value="${e(id)}">${e(id)}</button>`;}
 function coa(){const a=accounts.find(a=>a.code===selected)||accounts[0];return `<div class="coa-layout"><section class="panel"><div class="panel-head"><h2>Chart of accounts</h2>${button('New account','new-account')}</div><div class="filterbar"><input id="chart-query" type="search" placeholder="Find an account" aria-label="Find an account" value="${e(query)}"></div><div class="coa-tree">${['Assets','Liabilities','Equity','Income','Expenses'].map(group=>`<button class="coa-group" data-ac="group" data-value="${group}" aria-expanded="${open.has(group)}">${icon('chevron')}<strong>${group}</strong></button>${open.has(group)?accounts.filter(a=>a.group===group&&(a.code+' '+a.name).toLowerCase().includes(query.toLowerCase())).map(a=>`<button class="coa-account ${a.code===selected?'selected':''}" data-ac="account" data-value="${a.code}"><span>${a.code}</span>${e(a.name)}<small>${a.active?'':'Archived'}</small></button>`).join(''):''}`).join('')}</div></section><section class="panel"><div class="panel-head"><div><div class="eyebrow">${a.code} / ${a.group}</div><h2>${e(a.name)}</h2></div>${button('Open ledger','ledger','data-value="'+a.code+'"',true)}</div><div class="panel-body"><dl class="account-properties"><div><dt>Currency</dt><dd>PKR</dd></div><div><dt>State</dt><dd>${a.active?'Active':'Archived'} sample account</dd></div><div><dt>Posting control</dt><dd>Company, branch, account scope and current period</dd></div><div><dt>Source connections</dt><dd>${['1100','2100','1300','2200'].includes(a.code)?'Subledger / tax control - mapping and reconciliation required':'Ordinary posting account'}</dd></div></dl><div class="related">${button('Edit account details','edit-account')}${button(a.active?'Archive account preview':'Reactivate preview','archive-account')}</div><p class="form-note">Account changes here affect this sample chart only. Real control mappings, effective dates and archival dependencies require backend checks.</p></div></section></div>`;}
 function journalRegister(){const rows=data().filter(j=>j.date>=range.from&&j.date<=range.to&&(j.id+' '+j.narrative+' '+j.party).toLowerCase().includes(query.toLowerCase()));return `<section class="panel"><div class="panel-head"><h2>Journals & source entries</h2>${button('Prepare journal','new-journal','',true)}</div>${filters()}${table(['Date','Voucher','Narrative / party','Source','Debit PKR','State'],rows.map(j=>`<tr><td>${j.date}</td><td>${sourceButton(j.id)}</td><td>${e(j.narrative)}<small class="secondary">${e(j.party)}</small></td><td>${j.source}</td><td class="numeric">${decimal(j.lines.reduce((n,l)=>n+cents(l.debit),0n))}</td><td><span class="badge">Posted fixture</span></td></tr>`))}<div class="table-footer">${rows.length} source documents. Posted corrections use linked reversal/correction workflows; editing history is not a permitted shortcut.</div></section>`;}
 function gl(){const result=ledger(data(),{...range,account:selected,query});return `<section class="panel"><div class="panel-head"><h2>General ledger</h2>${button('Export ledger CSV','export-ledger')}</div><div class="filterbar"><label>Account<select class="inline-input" id="ledger-account">${options([['','All accounts'],...accounts.map(a=>[a.code,a.code+' - '+a.name])],selected)}</select></label></div>${filters()}<div class="ledger-basis"><span>Opening <strong>${result.opening??'By account'}</strong></span><span>Closing <strong>${result.closing??'By account'}</strong></span><span>PKR / Sample posted source</span></div>${table(['Date','Voucher','Account','Narrative / party','Debit','Credit','Running balance'],result.rows.map(l=>`<tr><td>${l.date}</td><td>${sourceButton(l.id)}</td><td>${l.account}</td><td>${e(l.narrative)}<small class="secondary">${e(l.party)}</small></td><td class="numeric">${l.debit}</td><td class="numeric">${l.credit}</td><td class="numeric">${l.balance}</td></tr>`))}<div class="table-footer">${result.rows.length} matching lines / Debit ${result.debit} / Credit ${result.credit}. Text search preserves the underlying account running balance.</div></section>`;}
 function tb(){const rows=trial(data(),range),dr=rows.reduce((n,a)=>n+cents(a.closingDebit),0n),cr=rows.reduce((n,a)=>n+cents(a.closingCredit),0n);return `<section class="panel"><div class="panel-head"><h2>Trial balance</h2>${button('Export trial balance CSV','export-trial')}</div>${filters()}${table(['Account','Opening net','Period debit','Period credit','Closing debit','Closing credit'],rows.filter(a=>(a.code+' '+a.name).toLowerCase().includes(query.toLowerCase())).map(a=>`<tr><td><button class="text-button" data-ac="ledger" data-value="${a.code}">${a.code} - ${e(a.name)}</button></td><td class="numeric">${a.opening}</td><td class="numeric">${a.debit}</td><td class="numeric">${a.credit}</td><td class="numeric">${a.closingDebit}</td><td class="numeric">${a.closingCredit}</td></tr>`))}<div class="ledger-basis"><span>Full sample chart / Closing debit <strong>${decimal(dr)}</strong></span><span>Closing credit <strong>${decimal(cr)}</strong></span><span class="badge ${dr===cr?'good':'warn'}">${dr===cr?'Balanced fixture':'Difference requires investigation'}</span></div></section>`;}
 function financial(){const s=statements(data(),range),statementTabs=[['profit','Profit & loss'],['position','Financial position'],['notes','Notes & source schedules']];return `<section class="panel"><div class="panel-head"><h2>Financial statements</h2>${button('Export statement CSV','export-statements')}</div>${filters()}<div class="panel-body"><div class="tabs">${statementTabs.map(([id,t])=>`<button data-ac="statement" data-value="${id}" aria-selected="${statement===id}">${t}</button>`).join('')}</div>${statement==='profit'?`<div class="statement-line"><span>Service revenue ${button('Source','ledger','data-value="4000"')}</span><strong>${s.income}</strong></div><div class="statement-line"><span>Operating expenses ${button('Source','ledger','data-value="5000"')}</span><strong>(${s.expenses})</strong></div><div class="statement-line total"><span>Profit / (loss)</span><strong>${s.profit}</strong></div>`:statement==='position'?`<div class="statement-line"><span>Assets</span><strong>${s.assets}</strong></div><div class="statement-line"><span>Liabilities</span><strong>${s.liabilities}</strong></div><div class="statement-line"><span>Capital</span><strong>${s.capital}</strong></div><div class="statement-line"><span>Accumulated sample profit</span><strong>${s.accumulatedProfit}</strong></div><div class="statement-line total"><span>Liabilities and equity</span><strong>${decimal(BigInt(s.liabilities.replace('.',''))+BigInt(s.equity.replace('.','')))}</strong></div><div class="related"><span class="badge good">${s.balanced?'Statement equation agrees':'Investigate differences'}</span></div>`:`<details open><summary>1. Basis of this example</summary><p class="form-note">Derived from four synthetic source documents and ten ledger lines. Currency PKR. No statutory reporting framework, legal tax rate or full published financial statements are represented.</p></details><details open><summary>2. Source and control schedules</summary><div class="related">${button('Bank','ledger','data-value="1010"')}${button('Receivables','ledger','data-value="1100"')}${button('Payables','ledger','data-value="2100"')}${button('Input tax','ledger','data-value="1300"')}${button('Output tax','ledger','data-value="2200"')}</div></details><p class="form-note">Comparatives, cash flow, changes in equity, industry disclosure packs and signed publication are required next UI workflows; this increment does not present them as complete.</p>`}<p class="form-note">Period ${range.from} to ${range.to}. Financial position includes all sample history through the end date. Filter text does not remove accounts from statement calculations.</p></div></section>`;}
 function close(){return `<section class="panel"><div class="panel-head"><h2>Period close</h2>${button('Review closing snapshot','period-review','',true)}</div><div class="panel-body"><p>Review controls before locking November 2026.</p><ul class="close-list">${[['Trial balance','Fixture balances agree','good'],['Bank statements','Reconciliation and outstanding items require evidence','warn'],['AR / AP / stock / assets / tax','Connect the independent source schedules',''],['Pending commands & evidence','Resolve held documents and retained attachments',''],['Review and report snapshot','Named sign-off, version and effective lock required','']].map(([t,d,k])=>`<li><div><strong>${t}</strong><small class="secondary">${d}</small></div><span class="badge ${k}">${k==='good'?'Agrees':'Review required'}</span></li>`).join('')}</ul><p class="form-note">This walkthrough cannot lock or reopen a real period. Current policy, authority and source versions must be rechecked at the actual commit.</p></div></section>`;}
 function view(tab='dashboard'){const alias={register:'journals'};const current=alias[tab]||tab||'dashboard';const body=current==='dashboard'?screens.dashboard():current==='journals'?screens.journalRegister():current==='ledger'?screens.gl():current==='coa'?coa():current==='trial'?tb():current==='statements'?financial():current==='receivables'?screens.receivables():current==='payables'?screens.payables():current==='aging'||current==='reports'?screens.ageing():current==='approvals'?screens.approvals():current==='close'?close():current==='opening'?setup.openingView():current==='recurring'?setup.recurringView():current==='setup'?screens.setup():current==='taxes'?screens.taxesView():plannedPage('accounting',current);return body;}
 function capture(){const f=document.querySelector('#accounting-journal');if(!f)return;draft={...draft,...Object.fromEntries(new FormData(f)),lines:[...f.querySelectorAll('[data-journal-line]')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-journal-field]')].map(x=>[x.dataset.journalField,x.value])))};}
 function preview(){
   const errors=[];
   const when=new Date(`${draft.date}T${draft.time||nowTime()}`);
   const now=new Date();
   const open=OPEN_PERIODS.some(([a,b])=>draft.date>=a&&draft.date<=b);
   if(draft.date<BUSINESS_START)errors.push('Posting date is before this business was created ('+BUSINESS_START+').');
   if(!open)errors.push('No open period covers '+draft.date+'. Open a period in Setup before posting.');
   if(when>now)errors.push('Posting time is in the future. Choose a time that has already happened.');
   let debit=0n, credit=0n;
   try{
     if(!draft.narrative||!draft.narrative.trim())errors.push('Narration is required.');
     if(!draft.lines||draft.lines.length<2)errors.push('At least two lines are required.');
     for(const l of draft.lines){
       if(!accounts.some(a=>a.code===l.account&&a.active)){errors.push('Every line needs an active account.');break;}
       const a=accounts.find(x=>x.code===l.account);
       if((a.control||a.code==='1010'||a.code==='1000')&&!(l.party||'').trim())errors.push(`${a.code} ${a.name} needs a party or sub-account.`);
       debit+=cents(l.debit||'0'); credit+=cents(l.credit||'0');
     }
     const result=reviewJournal({...draft,reference:draft.reference||draft.number,entryType:draft.entryType},accounts);
     const balanced=debit===credit;
     return `<div class="panel-head"><h2>Journal review</h2><span class="badge ${errors.length?'warn':balanced?'good':''}">${errors.length?errors.length+' to fix':balanced?'Ready to post':'Out of balance'}</span></div>
       <div class="panel-body">
         ${errors.length?`<div class="callout callout--error"><strong>This entry cannot be posted yet.</strong><ul class="contract-list">${errors.map(x=>`<li>${e(x)}</li>`).join('')}</ul></div>`:''}
         <div class="review-grid">
           <div class="statement-line"><span>Debit</span><strong>${decimal(debit)}</strong></div>
           <div class="statement-line"><span>Credit</span><strong>${decimal(credit)}</strong></div>
           <div class="statement-line total"><span>Difference</span><strong>${decimal(debit-credit)}</strong></div>
           <div class="statement-line"><span>Workflow</span><strong>${e(result.decision)}</strong></div>
         </div>
         <p class="form-note">Voucher ${e(draft.number||draft.reference)} · ${e(draft.date)} ${e(draft.time||'')} · posted entries are immutable; corrections are reversals.</p>
       </div>`;
   }catch(error){
     return `<div class="panel-head"><h2>Journal review</h2><span class="badge warn">Not ready</span></div><div class="panel-body"><p class="error">${e(error.message)}</p><p class="form-note">Correct the draft before reviewing its workflow.</p></div>`;
   }
 }
 const ss=(o)=>{
   const selected=o.options.find(x=>x[0]===o.value);
   return `<div class="ms ss" data-ss="${o.key}"${o.line!==undefined?` data-line="${o.line}"`:''}>
     <button type="button" class="ms-trigger" aria-expanded="false" ${o.disabled?'disabled':''}>
       <span class="ms-text">${e(selected?selected[1]:(o.placeholder||'Choose'))}</span><span class="ms-caret" aria-hidden="true">▾</span>
     </button>
     <div class="ms-panel" hidden>
       ${o.search===false?'':`<div class="ms-searchrow"><input class="ms-search" type="search" placeholder="Search ${e(o.label||'')}" aria-label="Search ${e(o.label||'')}"></div>`}
       <div class="ms-list">${o.options.map(([v,t,kind])=>`<button type="button" class="ms-row ss-item" data-value="${e(v)}" data-label="${e(t)}" ${kind?`data-kind="${e(kind)}"`:''}><span>${e(t)}</span></button>`).join('')}</div>
       <div class="ms-empty" hidden>No match</div>
     </div>
     <input type="hidden" ${o.field?`data-journal-field="${o.field}"`:`name="${o.name}"`} value="${e(o.value)}">
   </div>`;
 };
 const KIND_OF=(a)=>!a?'':a.control==='receivable'?'customer':a.control==='payable'?'supplier':a.code==='1010'?'bank':a.code==='1000'?'cash':'';
 const PARTY_OPTIONS=[['','—','none'],...CUSTOMER_NAMES.map(n=>[n,n,'customer']),...SUPPLIER_NAMES.map(n=>[n,n,'supplier']),...BANK_ACCOUNTS.map(n=>[n,n,'bank']),...CASH_CUSTODIANS.map(n=>[n,n,'cash'])];
 const PROJECT_OPTIONS=[['','No project'],...PROJECTS.map(p=>[p.code,`${p.code} · ${p.name}`])];
 const LOCATION_OPTIONS=LOCATIONS.map(x=>[x.code,`${x.code} · ${x.name}`]);
 const CENTRE_OPTIONS=[['','—'],...COST_CENTRES.map(c=>[c,c])];
 const SUBTYPE_OPTIONS=[['journal','Journal entry'],['bank','Bank entry'],['cash','Cash entry'],['contra','Contra entry'],['expense','Expense entry'],['debit-note','Debit note'],['credit-note','Credit note'],['depreciation','Depreciation'],['accrual','Accrual'],['prepayment','Prepayment'],['writeoff','Write off'],['opening','Opening entry'],['adjustment','Adjustment'],['reversal','Reversal']];
 const ENTRYTYPE_OPTIONS=[['normal','Normal'],['adjusting','Adjusting (party optional)'],['opening','Opening balance']];
 const ACCOUNT_OPTIONS=()=>accounts.filter(a=>a.active).map(a=>[a.code,`${a.code} - ${a.name}`]);
 function nextJournalNumber(){
   const d=new Date(), mm=String(d.getMonth()+1).padStart(2,'0'), yyyy=d.getFullYear();
   return `JV-${mm}-${yyyy}-${String(seq++).padStart(4,'0')}`;
 }
 function editor(){
   if(!draft.number)draft.number=nextJournalNumber();
   const acc=(code)=>accounts.find(a=>a.code===code);
   const partyNeeded=(a)=>Boolean(a&&(a.control||a.code==='1010'||a.code==='1000'));
   const partyList=[...CUSTOMER_NAMES.map(n=>[n,'Customer']),...SUPPLIER_NAMES.map(n=>[n,'Supplier']),...BANK_ACCOUNTS.map(n=>[n,'Bank']),...CASH_CUSTODIANS.map(n=>[n,'Cash'])];
   const picker=(i,current)=>ss({key:'account',field:'account',value:current,options:ACCOUNT_OPTIONS(),label:'accounts',placeholder:'Choose account',line:i});
   return `<div class="journal-single"><section class="panel">
     <div class="panel-head"><div><div class="eyebrow">Journal entry · draft</div><h2>${e(draft.number||'New journal')}</h2></div>
       <div class="related">
         <span class="badge">${saved?'Saved draft':'Draft'}</span>
         <button type="button" class="icon-button" data-ac="print" aria-label="Print" title="Print">${icon('printer')}</button>
         <details class="form-menu"><summary class="icon-button" aria-label="More actions" title="More actions">${icon('more')}</summary>
           <div class="menu">
             <button type="button" data-form-action="save">Save draft</button>
             <button type="button" data-form-action="submit">Submit</button>
             <button type="button" data-form-action="approval">Submit for approval</button>
             <button type="button" data-form-action="duplicate">Duplicate</button>
             <button type="button" data-form-action="cancel">Cancel entry</button>
             <button type="button" data-form-action="delete">Delete</button>
           </div>
         </details>
       </div>
     </div>
     <form id="accounting-journal" class="panel-body">
       <div class="form-tabs" role="tablist"><button type="button" role="tab" data-form-tab="entry" aria-selected="${formTab==='entry'}">Entry</button><button type="button" role="tab" data-form-tab="more" aria-selected="${formTab==='more'}">More info</button></div>
       <div class="form-grid" ${formTab==='entry'?'':'hidden'}>
         ${field('date','Posting date',draft.date,'date','required')}
         <label>Posting time<input name="time" type="time" step="1" value="${e(draft.time||nowTime())}"><small class="secondary">Recorded automatically when you post; change it only if the entry belongs to an earlier moment.</small></label>
         <label>Voucher number<input name="reference" value="${e(draft.reference||draft.number)}" readonly><small class="secondary">Series fixed in Setup: JV-MM-YYYY-0001. A custom format must be set before the first entry.</small></label>
         <div class="field"><span class="ms-label">Entry subtype</span>${ss({key:'subtype',name:'entrySubtype',value:draft.entrySubtype||'journal',options:SUBTYPE_OPTIONS,label:'entry subtypes',search:false})}</div>
         <div class="field"><span class="ms-label">Location</span>${ss({key:'location',name:'location',value:draft.location||'HQ',options:LOCATION_OPTIONS,label:'locations',search:false})}</div>
         <label class="wide">Narration<textarea name="narrative" rows="5" required>${e(draft.narrative)}</textarea><small class="secondary">What this entry is for, in plain language. Prints on the voucher.</small></label>
       </div>
       <div class="form-grid" ${formTab==='more'?'':'hidden'}>
         <div class="field"><span class="ms-label">Entry type</span>${ss({key:'entrytype',name:'entryType',value:draft.entryType||'normal',options:ENTRYTYPE_OPTIONS,label:'entry types',search:false})}</div>
         <div class="record-summary audit-strip">
           <div><small>Created by</small>${e(draft.createdBy||'A. Rehman')}</div>
           <div><small>Created at</small>${e(draft.createdAt||draft.date+' '+nowTime())}</div>
           <div><small>Submitted by</small>${e(draft.submittedBy||'Not submitted')}</div>
           <div><small>Source</small>${e(draft.origin||'User')}</div>
         </div>
         <p class="form-note wide">Fields added to this form in Setup appear here. Created and submitted are separate identities: one person may do both, or a preparer may submit for an approver.</p>
       </div>

       <div class="line-editor-heading"><h3>Journal lines</h3>${button('Add line','add-line')}</div>
       <div class="table-scroll"><table class="invoice-lines journal-lines"><thead><tr><th>Account</th><th>Party / sub-account</th><th>Project</th><th>Location</th><th>Cost centre</th><th>Description</th><th>Debit</th><th>Credit</th><th></th></tr></thead><tbody>${draft.lines.map((l,i)=>{
         const a=acc(l.account);
         return `<tr data-journal-line="${i}"><td>${picker(i,l.account)}</td>
           <td>${ss({key:'party',field:'party',value:l.party||'',options:PARTY_OPTIONS,label:'parties and sub-accounts',placeholder:'Choose party / sub-account',line:i,disabled:!partyNeeded(a)})}</td>
           <td>${ss({key:'project',field:'project',value:l.project||'',options:PROJECT_OPTIONS,label:'projects',search:false,line:i})}</td>
           <td>${ss({key:'location',field:'location',value:l.location||draft.location||'HQ',options:LOCATION_OPTIONS,label:'locations',search:false,line:i})}</td>
           <td>${ss({key:'centre',field:'costCentre',value:l.costCentre||'',options:CENTRE_OPTIONS,label:'cost centres',search:false,line:i})}</td>
           <td><input data-journal-field="description" aria-label="Line ${i+1} description" value="${e(l.description)}"></td>
           <td><input data-journal-field="debit" aria-label="Line ${i+1} debit" value="${e(l.debit)}" inputmode="decimal"></td>
           <td><input data-journal-field="credit" aria-label="Line ${i+1} credit" value="${e(l.credit)}" inputmode="decimal"></td>
           <td>${button('Remove','remove-line','data-value="'+i+'"')}</td></tr>`;
       }).join('')}</tbody></table></div>

       <div class="line-editor-heading"><h3>Supporting files</h3><label class="button">Choose files<input type="file" id="journal-evidence" multiple class="sr-only"></label></div>
       <ul class="contract-list">${draft.evidence.map((f,i)=>`<li>${e(f.name)} <small>${f.size} bytes</small> ${button('Remove','remove-evidence','data-value="'+i+'"')}</li>`).join('')||'<li>No file attached.</li>'}</ul>
       <p class="form-note">Filenames and sizes are shown only; bytes are not uploaded in this build.</p>
     </form>
   </section>
   <section class="panel" id="journal-live-preview" aria-live="polite">${preview()}</section>
   </div>`;
 }
 function dialog(title,body){const d=document.querySelector('#detail-dialog');d.innerHTML=`<div class="dialog-heading"><h2 id="detail-title">${e(title)}</h2><button class="icon-button" data-close="detail" aria-label="Close">${icon('close')}</button></div><div class="dialog-content">${body}</div>`;d.showModal();}
 function source(id){const j=data().find(j=>j.id===id);if(!j)return;dialog(j.id+' - source fixture',`<div class="record-summary"><div><small>Date</small>${j.date}</div><div><small>Source</small>${j.source}</div><div><small>Party</small>${e(j.party)}</div></div><p class="form-note">${e(j.narrative)}</p>${table(['Account','Debit','Credit'],j.lines.map(l=>`<tr><td>${l.account} - ${e(accounts.find(a=>a.code===l.account)?.name)}</td><td>${l.debit}</td><td>${l.credit}</td></tr>`))}<div class="related">${button('Linked correction walkthrough','correction')}${button('Evidence & audit trail','source-evidence')}</div><p class="form-note">Posted fixture is read-only. No real document, attachment or audit event is being retrieved.</p>`);}
 function accountDialog(fresh){const a=fresh?{code:'',name:'',type:'expense'}:accounts.find(a=>a.code===selected);dialog(fresh?'New sample account':'Edit sample account',`<form id="sample-account-form" class="form-grid">${field('code','Account code',a.code,'text',`required pattern="[0-9]{4,8}" ${fresh?'':'readonly'}`)}${field('name','Account name',a.name,'text','required maxlength="80"')}<label>Account class<select name="type" class="inline-input">${options([['asset','Asset'],['liability','Liability'],['equity','Equity'],['income','Income'],['expense','Expense']],a.type)}</select></label></form><p class="form-note">Group, parent hierarchy, currency/control mappings and historical reclassification require further reviewed configuration. This changes only the in-memory sample chart.</p><div class="related">${button('Save sample account','save-account',`data-fresh="${fresh}"`,true)}</div>`);}
 function bind(){setup.bind();screens.bindGL(render);screens.bindJournal(render,notify);
 document.querySelectorAll('[data-form-tab]').forEach(b=>b.addEventListener('click',()=>{formTab=b.dataset.formTab;render();}));screens.bindProjectForm(render,notify);screens.bindTaxes(render);
 const form=document.querySelector('#accounting-journal');
 if(form){
   const needsParty=a=>Boolean(a&&(a.control||a.code==='1010'||a.code==='1000'));
   const sync=()=>form.querySelectorAll('[data-journal-line]').forEach(tr=>{
     const acc=accounts.find(a=>a.code===tr.querySelector('[data-journal-field="account"]').value);
     const box=tr.querySelector('.ss[data-ss="party"]');
     if(!box)return;
     const trigger=box.querySelector('.ms-trigger');
     const hidden=box.querySelector('input[type="hidden"]');
     const need=needsParty(acc);
     trigger.disabled=!need;
     if(!need&&hidden.value){hidden.value='';box.querySelector('.ms-text').textContent='Choose party / sub-account';}
   });
   sync();
   form.addEventListener('change',ev=>{if(ev.target.matches('[data-journal-field="account"]'))sync();});
   form.addEventListener('click',ev=>{
     const item=ev.target.closest('.ss-item');
     if(!item)return;
     const box=item.closest('.ss');
     const hidden=box.querySelector('input[type="hidden"]');
     hidden.value=item.dataset.code;
     box.querySelector('.ms-text').textContent=item.dataset.label;
     box.querySelector('.ms-panel').hidden=true;
     box.querySelector('.ms-trigger').setAttribute('aria-expanded','false');
     hidden.dispatchEvent(new Event('change',{bubbles:true}));
     const line=hidden.closest('[data-journal-line]');
     if(line){
       const acc=accounts.find(a=>a.code===hidden.value);
       const party=line.querySelector('[data-journal-field="party"]');
       if(party){party.disabled=!needsParty(acc);if(!needsParty(acc))party.value='';}
     }
   });
 }
 document.addEventListener('ms:open',ev=>{
   const box=ev.target.closest('.ss');
   if(!box||box.dataset.ss!=='party')return;
   const line=box.closest('[data-journal-line]');
   if(!line)return;
   const acc=accounts.find(a=>a.code===line.querySelector('[data-journal-field="account"]').value);
   const kind=KIND_OF(acc);
   if(!kind){box.querySelector('.ms-panel').hidden=true;return;}
   let shown=0;
   box.querySelectorAll('.ss-item').forEach(item=>{
     const hit=item.dataset.kind===kind;
     item.hidden=!hit;
     if(hit)shown++;
   });
   const empty=box.querySelector('.ms-empty');
   if(empty)empty.hidden=shown>0;
 });
 document.querySelectorAll('[data-form-action]').forEach(b=>b.addEventListener('click',()=>{
   const act=b.dataset.formAction;
   if(act==='save'){capture();localStorage.setItem('sa7en:sample-journal:v1',JSON.stringify(draft));saved=true;notify('Saved as a draft. No ledger effect.');render();return;}
   if(act==='submit'||act==='approval'){capture();notify(act==='submit'?'Submitted and posted.':'Submitted for approval.');return;}
   if(act==='duplicate'){capture();draft={...draft,number:'',reference:'',lines:draft.lines.map(l=>({...l}))};notify('Duplicated into a new draft.');render();return;}
   if(act==='cancel'){notify('Cancelled. A reversal entry is recorded and the original stays.');return;}
   if(act==='delete'){notify('Deleted as a draft. A posted entry can only be reversed.');return;}
 }));document.querySelector('#accounting-filter')?.addEventListener('submit',ev=>{ev.preventDefault();const values=Object.fromEntries(new FormData(ev.target));try{ledger(data(),values);range={from:values.from,to:values.to};query=values.query;render();}catch(error){notify(error.message);}});document.querySelector('#ledger-account')?.addEventListener('change',ev=>{selected=ev.target.value;render();});document.querySelector('#chart-query')?.addEventListener('change',ev=>{query=ev.target.value;render();});const f=document.querySelector('#accounting-journal');f?.addEventListener('submit',ev=>ev.preventDefault());f?.addEventListener('input',()=>{capture();saved=false;dirty(true);document.querySelector('#journal-live-preview').innerHTML=preview();});f?.addEventListener('change',()=>{capture();dirty(true);document.querySelector('#journal-live-preview').innerHTML=preview();});document.querySelector('#journal-evidence')?.addEventListener('change',ev=>{capture();draft.evidence.push(...[...ev.target.files].map(f=>({name:f.name,size:f.size})));dirty(true);render();});}
 document.addEventListener('click',event=>{const b=event.target.closest('[data-ac]');if(!b)return;try{switch(b.dataset.ac){case 'group':open.has(b.dataset.value)?open.delete(b.dataset.value):open.add(b.dataset.value);render();break;case 'account':selected=b.dataset.value;render();break;case 'ledger':selected=b.dataset.value||'';query='';document.querySelector('#detail-dialog').close();navigate({module:'accounting',tab:'ledger'});break;case 'new-journal':navigate({module:'accounting',mode:'editor'});break;case 'statement':statement=b.dataset.value;render();break;case 'source':source(b.dataset.value);break;case 'new-account':accountDialog(true);break;case 'edit-account':accountDialog(false);break;case 'save-account':{const form=document.querySelector('#sample-account-form');if(!form.reportValidity())return;const v=Object.fromEntries(new FormData(form)),old=accounts.find(a=>a.code===v.code);if(b.dataset.fresh==='true'&&old)throw Error('That sample account code already exists.');const group={asset:'Assets',liability:'Liabilities',equity:'Equity',income:'Income',expense:'Expenses'}[v.type];if(old){if(old.type!==v.type)throw Error('Historical account reclassification needs a reviewed migration; change the name only in this example.');old.name=v.name;}else accounts.push({...v,group,currency:'PKR',active:true});selected=v.code;document.querySelector('#detail-dialog').close();render();notify('Sample chart updated in memory. No real account changed.');break;}case 'archive-account':{const a=accounts.find(a=>a.code===selected);if(data().some(j=>j.lines.some(l=>l.account===a.code)))throw Error('This sample account has history. Review balance, subledger dependencies and effective archival policy first.');a.active=!a.active;render();notify('Sample account state changed in memory only.');break;}case 'add-line':capture();if(draft.lines.length>=40)throw Error('Use at most 40 sample lines.');draft.lines.push({account:'5000',debit:'0.00',credit:'0.00',description:'',party:'',project:'',location:'',costCentre:''});dirty(true);render();break;case 'remove-line':capture();if(draft.lines.length<=2)throw Error('Retain at least two journal lines.');draft.lines.splice(Number(b.dataset.value),1);dirty(true);render();break;case 'remove-evidence':capture();draft.evidence.splice(Number(b.dataset.value),1);dirty(true);render();break;case 'save-draft':capture();localStorage.setItem('sa7en:sample-journal:v1',JSON.stringify(draft));saved=true;dirty(false);render();notify('Sample draft saved on this browser. No journal was posted.');break;case 'restore-draft':{const raw=localStorage.getItem('sa7en:sample-journal:v1');if(!raw)throw Error('No saved sample draft on this browser.');const restored=JSON.parse(raw);if(!restored||!Array.isArray(restored.lines)||restored.lines.length<2||restored.lines.length>40||!['date','reference','narrative','branch','decision'].every(k=>typeof restored[k]==='string')||!restored.lines.every(l=>['account','debit','credit','description'].every(k=>typeof l[k]==='string'))||!Array.isArray(restored.evidence)||!restored.evidence.every(f=>typeof f.name==='string'&&Number.isSafeInteger(f.size)&&f.size>=0))throw Error('Saved sample draft is invalid.');draft=restored;saved=true;dirty(false);render();notify('Saved sample draft restored.');break;}case 'review-journal':capture();if(!document.querySelector('#accounting-journal').reportValidity())return;const result=reviewJournal(draft,accounts);dialog('Journal workflow review',`${preview()}<div class="callout">${result.decision}. The real backend must recheck scope, evidence, entitlement, period and policy versions before creating a durable receipt. No posting or approval request was submitted.</div>`);break;case 'export-ledger':{const r=ledger(data(),{...range,account:selected,query});download('SA7EN-sample-general-ledger.csv',[['Date','Voucher','Account','Narrative','Party','Debit','Credit','Balance'],...r.rows.map(l=>[l.date,l.id,l.account,l.narrative,l.party,l.debit,l.credit,l.balance])]);break;}case 'export-trial':download('SA7EN-sample-trial-balance.csv',[['Code','Account','Opening net','Period debit','Period credit','Closing debit','Closing credit'],...trial(data(),range).map(a=>[a.code,a.name,a.opening,a.debit,a.credit,a.closingDebit,a.closingCredit])]);break;case 'export-statements':{const s=statements(data(),range);download('SA7EN-sample-financial-statements.csv',[['Period',range.from,range.to],['Revenue',s.income],['Expenses',s.expenses],['Profit',s.profit],['Assets',s.assets],['Liabilities',s.liabilities],['Capital',s.capital],['Accumulated profit',s.accumulatedProfit],['Equity',s.equity],['Basis','Synthetic fixtures only; not statutory financial statements']]);break;}default:dialog('Accounting workflow contract',`<p>${b.dataset.ac==='period-review'?'Review outstanding reconciliation, subledger controls, pending entries, sign-off and immutable snapshot before an authorized period lock.':b.dataset.ac==='correction'?'Select linked reversal or correcting entry, effective date, reason, retained source evidence and approval policy. Historical posted entries remain immutable.':'Supporting objects require versioned links, original bytes, hash/type/scan result, access rules and immutable audit attribution.'}</p><p class="form-note">Detailed backend and remaining UI states are not connected in this walkthrough.</p>`);}}catch(error){notify(error.message);}});
 return {view,editor,bind};
}
