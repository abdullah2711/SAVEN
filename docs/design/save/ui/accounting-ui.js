import {escape as e,cents,decimal} from './model.js';
import {chart,fixture,ledger,trial,statements,reviewJournal,csv} from './accounting-model.js';
import {icon} from './icons.js';
import {PROJECTS,LOCATIONS,COST_CENTRES,PARTIES,CASH_BANK,CUSTOM_FIELDS,NUMBERING} from './accounting-model.js';
import {createAccountingSetup} from './accounting-setup.js';
import {createScreens,plannedPage} from './screens.js';
const button=(label,action,extra='',primary=false)=>`<button type="button" class="button ${primary?'primary':''}" data-ac="${action}" ${extra}>${label}</button>`;
const field=(name,label,value,type='text',extra='')=>`<label>${label}<input name="${name}" value="${e(value)}" type="${type}" ${extra}></label>`;
const options=(values,current)=>values.map(([v,t])=>`<option value="${e(v)}" ${v===current?'selected':''}>${e(t)}</option>`).join('');
let seq=1;
const nowTime=()=>{const d=new Date();return [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');};
const BUSINESS_START='2026-07-01';
const OPEN_PERIODS=[['2026-11-01','2026-11-30']];
const number=n=>`<span class="numeric">${e(n)}</span>`;
export function createAccountingUI({render,navigate,notify,dirty,getCompany}){
 const setup=createAccountingSetup({render,notify,dirty,getCompany});
 let chartTab='accounts',tbClass='',tbGroup='',selected='1010',query='',range={from:'2026-11-01',to:'2026-11-30'},open=new Set(['Assets','Liabilities','Equity','Income','Expenses']),accounts=chart.map(a=>({...a})),statement='profit',formTab='entry',saved=false,draft={date:'2026-11-13',number:'',reference:'',narrative:'Office expenses',decision:'direct',entryType:'normal',entrySubtype:'journal',location:'HQ',time:'',evidence:[],lines:[{account:'5000',debit:'100.00',credit:'0.00',description:'Office expenses',party:'',project:'',location:'HQ',costCentre:''},{account:'1010',debit:'0.00',credit:'100.00',description:'Bank payment',party:'Standard Bank — current 0123456789',project:'',location:'HQ',costCentre:''}]};
 const data=()=>fixture(getCompany());
 const screens=createScreens({getCompany,range:()=>range,navigate,notify,accounts:()=>accounts});
 function download(name,rows){const url=URL.createObjectURL(new Blob([csv([['SA7EN TESTING - SAMPLE DATA ONLY'],...rows])],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function table(headers,rows){return `<div class="table-scroll" data-hscroll><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">No matching sample records.</td></tr>`}</tbody></table></div>`;}
 function filters(){return `<form class="filterbar" id="accounting-filter">${field('from','From',range.from,'date','required')}${field('to','To',range.to,'date','required')}${field('query','Reference, party or description',query,'search')}<button class="button primary">Apply filters</button></form>`;}
 function sourceButton(id){return `<button class="text-button" data-ac="source" data-value="${e(id)}">${e(id)}</button>`;}
 function coa(){
   const tb=trial(data(),range);
   const plain=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
   const closing=a=>plain(Number(a.closingDebit)-Number(a.closingCredit));
   const rows=tb.filter(a=>(a.code+' '+a.name).toLowerCase().includes(query.toLowerCase()));
   return `<section class="panel">
     <div class="panel-head"><h2>Chart of accounts</h2><div class="related"><span class="badge">${rows.length} of ${accounts.length} accounts</span><button class="button" data-ac="new-account-page">New account</button><button class="button" data-ac="export-coa">Export CSV</button></div></div>
     <div class="filterbar"><input id="chart-query" type="search" placeholder="Find an account by code or name" aria-label="Find an account" value="${e(query)}"></div>
     <div class="table-scroll" data-hscroll><table>
       <thead><tr><th>Code</th><th>Account name</th><th>Accounting head</th><th>Accounting group</th><th>Control</th><th>Currency</th><th>Description</th><th>State</th><th class="numeric">Closing</th><th></th></tr></thead>
       <tbody>${rows.map(a=>`<tr class="row-link" data-ac="open-account" data-value="${a.code}"><td class="mono">${a.code}</td><td>${e(a.name)}</td><td>${e(a.type)}</td><td>${e(a.group)}</td><td>${a.control?`<span class="badge plum">${e(a.control)}</span>`:'—'}</td><td>${e(a.currency||'PKR')}</td><td>${e(a.description||'—')}</td><td><span class="badge ${a.active?'good':'warn'}">${a.active?'Active':'Archived'}</span></td><td class="numeric">${closing(a)}</td><td class="row-go">›</td></tr>`).join('')}</tbody>
     </table></div>
     <div class="table-footer">The register of every account: code, name, accounting head, accounting group, control, currency, description and state, with its closing balance. Click a row to open the account form.</div>
   </section>`;
 }
 function tb(){
   const rows=trial(data(),range).filter(a=>(a.code+' '+a.name).toLowerCase().includes(query.toLowerCase())&&(!tbClass||a.type===tbClass)&&(!tbGroup||a.group===tbGroup));
   const sum=k=>rows.reduce((n,a)=>n+Number(a[k]),0);
   const openDr=rows.reduce((n,a)=>n+Math.max(0,Number(a.opening)),0),openCr=rows.reduce((n,a)=>n+Math.max(0,-Number(a.opening)),0);
   const dr=sum('closingDebit'),cr=sum('closingCredit'),debit=sum('debit'),credit=sum('credit');
   const plain=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
   const openingOf=a=>Number(a.opening);
   return `<section class="panel">
     <div class="panel-head"><h2>Trial balance</h2><div class="related"><button class="button" data-ac="export-trial">Export CSV</button></div></div>
     <form class="filterbar" id="tb-filter">
       <label>From<input name="from" type="date" value="${e(range.from)}" required></label>
       <label>To<input name="to" type="date" value="${e(range.to)}" required></label>
       <label>Accounting head<select name="type"><option value="">All accounting heads</option>${['asset','liability','equity','income','expense'].map(x=>`<option value="${x}" ${tbClass===x?'selected':''}>${x}</option>`).join('')}</select></label>
       <label>Accounting group<select name="group"><option value="">All accounting groups</option>${['Assets','Liabilities','Equity','Income','Expenses'].map(x=>`<option value="${x}" ${tbGroup===x?'selected':''}>${x}</option>`).join('')}</select></label>
       <label>Search<input name="q" type="search" value="${e(query)}" placeholder="Code or account"></label>
       <button class="button primary">Apply</button>
     </form>
     <div class="gl-totals"><div><span>Accounts</span><strong class="numeric">${rows.length}</strong><small>${accounts.length} in the chart</small></div><div><span>Period debit</span><strong class="numeric">${plain(debit)}</strong><small>${e(range.from)} to ${e(range.to)}</small></div><div><span>Period credit</span><strong class="numeric">${plain(credit)}</strong><small>same period</small></div><div><span>${dr===cr?'Net':'Difference'}</span><strong class="numeric">${plain(Math.abs(dr-cr))}</strong><small>${dr===cr?'in balance':'investigate'}</small></div></div>
     <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Accounting head</th><th>Accounting group</th><th>Account name</th><th class="numeric">Opening debit</th><th class="numeric">Opening credit</th><th class="numeric">Period debit</th><th class="numeric">Period credit</th><th class="numeric">Closing debit</th><th class="numeric">Closing credit</th></tr></thead>
       <tbody>${rows.map(a=>{const op=openingOf(a);return `<tr class="row-link" data-ac="open-account" data-value="${a.code}"><td class="mono">${a.code}</td><td>${e(a.type)}</td><td>${e(a.group)}</td><td>${e(a.name)}</td><td class="numeric">${op>0?plain(op):''}</td><td class="numeric">${op<0?plain(-op):''}</td><td class="numeric">${plain(Number(a.debit))}</td><td class="numeric">${plain(Number(a.credit))}</td><td class="numeric">${plain(Number(a.closingDebit))}</td><td class="numeric">${plain(Number(a.closingCredit))}</td></tr>`;}).join('')}</tbody>
       <tfoot><tr><td colspan="4">Total</td><td class="numeric">${plain(openDr)}</td><td class="numeric">${plain(openCr)}</td><td class="numeric">${plain(debit)}</td><td class="numeric">${plain(credit)}</td><td class="numeric">${plain(dr)}</td><td class="numeric">${plain(cr)}</td></tr></tfoot>
     </table></div>
     <div class="ledger-basis"><span class="badge ${dr===cr?'good':'warn'}">${dr===cr?'Balanced':'Difference requires investigation'}</span><span>Click a row to open the account.</span></div>
   </section>`;
 }
 function chartPage(force){
   const tab=(force||chartTab)==='trial'?'trial':'accounts';
   return `<div class="tabs" role="tablist" aria-label="Chart views"><button role="tab" aria-selected="${tab==='accounts'}" data-ac="chart-tab" data-value="accounts">Chart of accounts</button><button role="tab" aria-selected="${tab==='trial'}" data-ac="chart-tab" data-value="trial">Trial balance</button></div><div id="chart-panel">${tab==='trial'?tb():coa()}</div>`;
 }
 function financial(){const s=statements(data(),range),statementTabs=[['profit','Profit & loss'],['position','Financial position'],['notes','Notes & source schedules']];return `<section class="panel"><div class="panel-head"><h2>Financial statements</h2>${button('Export statement CSV','export-statements')}</div>${filters()}<div class="panel-body"><div class="tabs">${statementTabs.map(([id,t])=>`<button data-ac="statement" data-value="${id}" aria-selected="${statement===id}">${t}</button>`).join('')}</div>${statement==='profit'?`<div class="statement-line"><span>Service revenue ${button('Source','ledger','data-value="4000"')}</span><strong>${s.income}</strong></div><div class="statement-line"><span>Operating expenses ${button('Source','ledger','data-value="5000"')}</span><strong>(${s.expenses})</strong></div><div class="statement-line total"><span>Profit / (loss)</span><strong>${s.profit}</strong></div>`:statement==='position'?`<div class="statement-line"><span>Assets</span><strong>${s.assets}</strong></div><div class="statement-line"><span>Liabilities</span><strong>${s.liabilities}</strong></div><div class="statement-line"><span>Capital</span><strong>${s.capital}</strong></div><div class="statement-line"><span>Accumulated sample profit</span><strong>${s.accumulatedProfit}</strong></div><div class="statement-line total"><span>Liabilities and equity</span><strong>${decimal(BigInt(s.liabilities.replace('.',''))+BigInt(s.equity.replace('.','')))}</strong></div><div class="related"><span class="badge good">${s.balanced?'Statement equation agrees':'Investigate differences'}</span></div>`:`<details open><summary>1. Basis of this example</summary><p class="form-note">Derived from four synthetic source documents and ten ledger lines. Currency PKR. No statutory reporting framework, legal tax rate or full published financial statements are represented.</p></details><details open><summary>2. Source and control schedules</summary><div class="related">${button('Bank','ledger','data-value="1010"')}${button('Receivables','ledger','data-value="1100"')}${button('Payables','ledger','data-value="2100"')}${button('Input tax','ledger','data-value="1300"')}${button('Output tax','ledger','data-value="2200"')}</div></details><p class="form-note">Comparatives, cash flow, changes in equity, industry disclosure packs and signed publication are required next UI workflows; this increment does not present them as complete.</p>`}<p class="form-note">Period ${range.from} to ${range.to}. Financial position includes all sample history through the end date. Filter text does not remove accounts from statement calculations.</p></div></section>`;}
 function view(tab='dashboard'){const alias={register:'journals'};const current=alias[tab]||tab||'dashboard';const body=current==='dashboard'?screens.dashboard():current==='journals'?screens.journalRegister():current==='ledger'?screens.gl():current==='trial'?chartPage('trial'):current==='coa'?chartPage():current==='statements'?financial():current==='receivables'?screens.receivables():current==='payables'?screens.payables():current==='aging'||current==='reports'?screens.reports():current==='cash'?screens.cashBank():current==='items'?screens.items():current==='approvals'?screens.approvals():current==='opening'?setup.openingView():current==='recurring'?setup.recurringView():current==='setup'?screens.setup():current==='taxes'?screens.taxesView():current==='parties'?screens.parties():current==='payments'?screens.payments():current==='sales-invoices'?screens.invoices('sales'):current==='purchase-invoices'?screens.invoices('purchase'):current==='close'?screens.close():plannedPage('accounting',current);return body;}
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
         <p class="form-note">Voucher ${e(draft.number||draft.reference)} · ${e(draft.date)} ${e(draft.time||'')} · ${e(draft.location||'HQ')}</p>
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
 const KIND_OF=(a)=>!a?'':a.control==='receivable'?'customer':a.control==='payable'?'supplier':a.control==='bank'?'bank':a.control==='cash'?'cash':'';
 const partyOptions=()=>[['','—','none'],...PARTIES.map(p=>[p.name,p.name,p.type]),...CASH_BANK.map(c=>[c.name,c.name,c.kind])];
 const PROJECT_OPTIONS=()=>[['','No project'],...PROJECTS.map(p=>[p.code,`${p.code} · ${p.name}`])];
 const LOCATION_OPTIONS=()=>LOCATIONS.map(x=>[x.code,`${x.code} · ${x.name}`]);
 const CENTRE_OPTIONS=[['','—'],...COST_CENTRES.filter(c=>!c.archived).map(c=>[c.name,c.name])];
 const SUBTYPE_OPTIONS=[['journal','Journal entry'],['bank','Bank entry'],['cash','Cash entry'],['contra','Contra entry'],['expense','Expense entry'],['debit-note','Debit note'],['credit-note','Credit note'],['depreciation','Depreciation'],['accrual','Accrual'],['prepayment','Prepayment'],['writeoff','Write off'],['opening','Opening entry'],['adjustment','Adjustment'],['reversal','Reversal']];
 const ENTRYTYPE_OPTIONS=[['normal','Normal'],['adjusting','Adjusting (party optional)'],['opening','Opening balance']];
 const ACCOUNT_OPTIONS=()=>accounts.filter(a=>a.active).map(a=>[a.code,`${a.code} - ${a.name}`]);
 function nextJournalNumber(){
   const n=NUMBERING.journal,d=new Date();
   const mm=String(d.getMonth()+1).padStart(2,'0'),yyyy=d.getFullYear();
   const value=String(n.next++).padStart(n.padding||4,'0');
   return [n.prefix,n.month?mm:null,n.year?yyyy:null,value].filter(Boolean).join('-');
 }
 function journalSeriesSample(){const n=NUMBERING.journal;return [n.prefix,n.month?'MM':null,n.year?'YYYY':null,'0'.repeat((n.padding||4)-1)+'1'].filter(Boolean).join('-');}
 function resetJournalDraft(){
   draft={date:'2026-11-30',time:'',number:nextJournalNumber(),reference:'',narrative:'',decision:'direct',entrySubtype:'journal',location:'HQ',evidence:[],editingId:'',state:'draft',locked:false,lines:[{account:'',debit:'0.00',credit:'0.00',party:'',project:'',costCentre:''},{account:'',debit:'0.00',credit:'0.00',party:'',project:'',costCentre:''}]};
 }
 function loadJournalDoc(id){
   const doc=screens.journalDocById(id);
   if(!doc)return false;
   const st=String(doc.subtype||'journal').toLowerCase();
   const known=['journal','bank','cash','contra','expense','debit-note','credit-note','depreciation','accrual','prepayment','writeoff','opening','adjustment','reversal'];
   draft={
     editingId:doc.id,state:doc.state,locked:doc.state!=='draft',
     number:doc.id,reference:doc.id,date:doc.date,time:'00:00:00',
     narrative:doc.narrative||'',
     entrySubtype:known.includes(st)?st:'journal',location:doc.location||'HQ',decision:'direct',
     lines:doc.lines.map(l=>({account:l.account,debit:String(l.debit||'0.00'),credit:String(l.credit||'0.00'),party:l.party||doc.party||'',project:l.project||'',costCentre:l.costCentre||''})),
     evidence:[]
   };
   return true;
 }
 function journalEditor(){
   if(!draft.number)draft.number=nextJournalNumber();
   const acc=(code)=>accounts.find(a=>a.code===code);
   const partyNeeded=(a)=>Boolean(a&&(a.control||a.code==='1010'||a.code==='1000'));
   const partyList=partyOptions().filter(x=>x[2]!=='none');
   const picker=(i,current)=>ss({key:'account',field:'account',value:current,options:ACCOUNT_OPTIONS(),label:'accounts',placeholder:'Choose account',line:i});
   const stateLabel=draft.locked?(draft.state==='cancelled'?'cancelled':'posted'):(draft.state==='returned'?'returned':'draft');
   const menu=draft.locked
     ? `${draft.state==='cancelled'?'':'<button type="button" data-form-action="cancel">Cancel entry</button>'}${draft.state==='cancelled'?'<button type="button" data-form-action="delete">Delete</button>':''}<button type="button" data-form-action="duplicate">Duplicate</button>`
     : `<button type="button" data-form-action="save">Save draft</button><button type="button" data-form-action="submit">Submit</button><button type="button" data-form-action="approval">Submit for approval</button><button type="button" data-form-action="duplicate">Duplicate</button><button type="button" data-form-action="delete">Delete</button>`;
   return `<div class="journal-single"><section class="panel">
     <div class="panel-head"><div><div class="eyebrow">Journal entry · ${stateLabel}</div><h2>${e(draft.number||'New journal')}</h2></div>
       <div class="related">
         <span class="badge ${stateLabel==='posted'?'good':stateLabel==='cancelled'?'warn':''}">${stateLabel==='posted'?'Posted · read-only':stateLabel==='cancelled'?'Cancelled · no ledger effect':saved?'Saved draft':'Draft'}</span>
         <button type="button" class="icon-button" data-ac="print" aria-label="Print" title="Print">${icon('printer')}</button>
         <details class="form-menu"><summary class="icon-button" aria-label="More actions" title="More actions">${icon('more')}</summary>
           <div class="menu">${menu}</div>
         </details>
       </div>
     </div>
     <form id="accounting-journal" class="panel-body">
       ${draft.locked?`<div class="callout wide" role="status"><strong>${draft.state==='cancelled'?'Cancelled entry':'Posted entry'}.</strong> ${draft.state==='cancelled'?'It has no ledger effect and stays in the register until deleted. Its number is never reused.':'The content is read-only. Cancel removes its ledger effect but keeps it in the register; duplicate it to prepare a correction.'}</div>`:''}
       <div class="form-tabs" role="tablist"><button type="button" role="tab" data-form-tab="entry" aria-selected="${formTab==='entry'}">Entry</button><button type="button" role="tab" data-form-tab="more" aria-selected="${formTab==='more'}">More info</button></div>
       <div class="form-grid" ${formTab==='entry'?'':'hidden'}>
         ${field('date','Posting date',draft.date,'date','required')}
         <label>Posting time<input name="time" type="time" step="1" value="${e(draft.time||nowTime())}"><small class="secondary">Recorded automatically when you post; change it only if the entry belongs to an earlier moment.</small></label>
         <label>Voucher number<input name="reference" value="${e(draft.reference||draft.number)}" readonly><small class="secondary">Series from Settings → Accounting: ${journalSeriesSample()}. It is frozen after the first entry and a number is never reused.</small></label>
         <div class="field"><span class="ms-label">Entry subtype</span>${ss({key:'subtype',name:'entrySubtype',value:draft.entrySubtype||'journal',options:SUBTYPE_OPTIONS,label:'entry subtypes',search:false})}</div>
         <div class="field"><span class="ms-label">Location</span>${ss({key:'location',name:'location',value:draft.location||'HQ',options:LOCATION_OPTIONS(),label:'locations',search:false})}<small class="secondary">Where this entry was made. One location for the whole voucher.</small></div>

         <label class="wide">Narration<textarea name="narrative" rows="5" required>${e(draft.narrative)}</textarea><small class="secondary">What this entry is for, in plain language. Prints on the voucher.</small></label>
       </div>
       <div class="form-grid" ${formTab==='more'?'':'hidden'}>
         <div class="record-summary audit-strip">
           <div><small>Created by</small>${e(draft.createdBy||'A. Rehman')}</div>
           <div><small>Created at</small>${e(draft.createdAt||draft.date+' '+nowTime())}</div>
           <div><small>Submitted by</small>${e(draft.submittedBy||'Not submitted')}</div>
           <div><small>Source</small>${e(draft.origin||'User')}</div>
         </div>
         ${CUSTOM_FIELDS.filter(f=>f.form==='Journal entry').map(f=>`<label>${e(f.name)}${f.required?' *':''}<input name="custom_${e(f.name.toLowerCase().replace(/[^a-z0-9]+/g,'_'))}" ${f.required?'required':''} value="${e(draft['custom_'+f.name.toLowerCase().replace(/[^a-z0-9]+/g,'_')]||'')}">${f.help?`<small class="secondary">${e(f.help)}</small>`:''}</label>`).join('')}
         <p class="form-note wide">Fields added in Settings → Forms & fields appear here. Created and submitted are separate identities: one person may do both, or a preparer may submit for an approver.</p>
       </div>

       <div class="line-editor-heading"><h3>Journal lines</h3>${button('Add line','add-line')}</div>
       <div class="hscroll" id="journal-hscroll"><div class="hscroll-thumb" id="journal-hscroll-thumb"></div></div>
       <div class="table-scroll journal-scroll" id="journal-scroll"><table class="invoice-lines journal-lines"><thead><tr><th>Account</th><th>Project</th><th>Party / sub-account</th><th>Cost centre</th><th>Debit</th><th>Credit</th><th></th></tr></thead><tbody>${draft.lines.map((l,i)=>{
         const a=acc(l.account);
         return `<tr data-journal-line="${i}"><td>${picker(i,l.account)}</td>
           <td>${ss({key:'project',field:'project',value:l.project||'',options:PROJECT_OPTIONS(),label:'projects',search:false,line:i})}</td>
           <td>${ss({key:'party',field:'party',value:l.party||'',options:partyOptions(),label:'parties and sub-accounts',placeholder:'Choose party / sub-account',line:i,disabled:!partyNeeded(a)})}</td>
           <td>${ss({key:'centre',field:'costCentre',value:l.costCentre||'',options:CENTRE_OPTIONS,label:'cost centres',search:false,line:i})}</td>
           <td><input data-journal-field="debit" aria-label="Line ${i+1} debit" value="${e(l.debit)}" inputmode="decimal"></td>
           <td><input data-journal-field="credit" aria-label="Line ${i+1} credit" value="${e(l.credit)}" inputmode="decimal"></td>
           <td>${button('Remove','remove-line','data-value="'+i+'"')}</td></tr>`;
       }).join('')}</tbody></table></div>

       <div class="line-editor-heading"><h3>Supporting files</h3></div>
       <div class="dropzone" id="journal-drop">
         <span>Drop files here, or <label class="text-button">choose files<input type="file" id="journal-evidence" multiple class="sr-only"></label></span>
         <small>PDF, image or SVG · up to 10 MB each</small>
       </div>
       <ul class="contract-list file-list">${draft.evidence.map((f,i)=>`<li><span>${e(f.name)} <small>${Math.max(1,Math.round(f.size/1024))} KB</small></span>${button('Remove','remove-evidence','data-value="'+i+'"')}</li>`).join('')||'<li class="muted">No file attached.</li>'}</ul>
       <p class="form-note">Names and sizes are recorded on the draft; bytes are not stored in this build.</p>
     </form>
   </section>
   <section class="panel" id="journal-live-preview" aria-live="polite">${preview()}</section>
   </div>`;
 }
 function dialog(title,body){const d=document.querySelector('#detail-dialog');d.innerHTML=`<div class="dialog-heading"><h2 id="detail-title">${e(title)}</h2><button class="icon-button" data-close="detail" aria-label="Close">${icon('close')}</button></div><div class="dialog-content">${body}</div>`;d.showModal();}
 function source(id){const j=data().find(j=>j.id===id);if(!j)return;dialog(j.id+' - source fixture',`<div class="record-summary"><div><small>Date</small>${j.date}</div><div><small>Source</small>${j.source}</div><div><small>Party</small>${e(j.party)}</div></div><p class="form-note">${e(j.narrative)}</p>${table(['Account','Debit','Credit'],j.lines.map(l=>`<tr><td>${l.account} - ${e(accounts.find(a=>a.code===l.account)?.name)}</td><td>${l.debit}</td><td>${l.credit}</td></tr>`))}<div class="related">${button('Linked correction walkthrough','correction')}${button('Evidence & audit trail','source-evidence')}</div><p class="form-note">Posted fixture is read-only. No real document, attachment or audit event is being retrieved.</p>`);}
 function accountDialog(fresh){const a=fresh?{code:'',name:'',type:'expense'}:accounts.find(a=>a.code===selected);dialog(fresh?'New sample account':'Edit sample account',`<form id="sample-account-form" class="form-grid">${field('code','Account code',a.code,'text',`required pattern="[0-9]{4,8}" ${fresh?'':'readonly'}`)}${field('name','Account name',a.name,'text','required maxlength="80"')}<label>Account class<select name="type" class="inline-input">${options([['asset','Asset'],['liability','Liability'],['equity','Equity'],['income','Income'],['expense','Expense']],a.type)}</select></label></form><p class="form-note">Group, parent hierarchy, currency/control mappings and historical reclassification require further reviewed configuration. This changes only the in-memory sample chart.</p><div class="related">${button('Save sample account','save-account',`data-fresh="${fresh}"`,true)}</div>`);}
 function bind(){setup.bind();screens.bindGL(render,navigate);screens.bindChartAccount(render,notify,navigate);screens.bindJournal(render,notify,navigate);
 document.querySelectorAll('[data-form-tab]').forEach(b=>b.addEventListener('click',()=>{formTab=b.dataset.formTab;render();}));screens.bindProjectForm(render,notify);screens.bindTaxes(render,notify,navigate);screens.bindCashBank(render,notify,navigate);screens.bindItems(render,notify,navigate);screens.bindReports(render);screens.bindParties(render,notify,navigate);screens.bindPayments(render,notify,navigate);screens.bindInvoices('sales',render,notify,navigate);screens.bindInvoices('purchase',render,notify,navigate);screens.bindClose(render,notify);screens.bindSettings(render,notify);screens.bindSettingsEditors(render,notify,navigate);screens.bindSetup(render,navigate);screens.bindDimension('project',render);screens.bindDimension('location',render);screens.bindRegisterFilters(render);bindTableScrollbars();
 const scroller=document.querySelector('#journal-scroll'),track=document.querySelector('#journal-hscroll'),thumb=document.querySelector('#journal-hscroll-thumb');
 if(scroller&&track&&thumb){
   const syncScroll=()=>{
     const max=Math.max(scroller.scrollWidth-scroller.clientWidth,0);
     const ratio=scroller.clientWidth/Math.max(scroller.scrollWidth,1);
     thumb.style.width=Math.max(12,Math.round(ratio*100))+'%';
     thumb.style.left=(max?scroller.scrollLeft/max:0)*(100-parseFloat(thumb.style.width))+'%';
   };
   scroller.addEventListener('scroll',syncScroll);
   window.addEventListener('resize',syncScroll);
   thumb.addEventListener('pointerdown',ev=>{
     ev.preventDefault();
     const startX=ev.clientX,startLeft=scroller.scrollLeft,max=Math.max(scroller.scrollWidth-scroller.clientWidth,0),trackWidth=track.clientWidth-thumb.offsetWidth;
     thumb.setPointerCapture(ev.pointerId);
     const move=e2=>{if(!trackWidth)return;scroller.scrollLeft=startLeft+((e2.clientX-startX)/trackWidth)*max;};
     const up=()=>{thumb.removeEventListener('pointermove',move);thumb.removeEventListener('pointerup',up);};
     thumb.addEventListener('pointermove',move);
     thumb.addEventListener('pointerup',up);
   });
   track.addEventListener('click',ev=>{
     if(ev.target===thumb)return;
     const rect=track.getBoundingClientRect(),max=Math.max(scroller.scrollWidth-scroller.clientWidth,0);
     scroller.scrollLeft=max*((ev.clientX-rect.left)/Math.max(rect.width,1));
   });
   syncScroll();
 }
 const form=document.querySelector('#accounting-journal');
 if(form&&draft.locked)form.querySelectorAll('input,select,textarea,button').forEach(el=>{el.disabled=true;});
 if(form){
   const needsParty=a=>Boolean(a&&a.control);
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
   const revalidate=()=>{
     const location=form.querySelector('input[name="location"]')?.value||draft.location||'HQ';
     form.querySelectorAll('[data-journal-line]').forEach(tr=>{
       const party=tr.querySelector('.ss[data-ss="party"]');
       if(!party)return;
       const hidden=party.querySelector('input[type="hidden"]');
       const project=tr.querySelector('[data-journal-field="project"]').value;
       if(hidden.value&&!allowedHere(hidden.value,project,location)){
         hidden.value='';
         party.querySelector('.ms-text').textContent='Choose party / sub-account';
       }
     });
   };
   form.addEventListener('change',ev=>{if(ev.target.matches('[data-journal-field="project"], input[name="location"]'))revalidate();});
   form.addEventListener('click',ev=>{
     const item=ev.target.closest('.ss-item');
     if(!item)return;
     const box=item.closest('.ss');
     const hidden=box.querySelector('input[type="hidden"]');
     hidden.value=item.dataset.value;
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
 const allowedHere=(name,project,location)=>{
   const record=PARTIES.find(p=>p.name===name)||CASH_BANK.find(c=>c.name===name);
   if(!record)return true;
   if(project&&record.projects.length&&!record.projects.includes(project))return false;
   if(record.locations.length&&!record.locations.includes(location))return false;
   return true;
 };
 const openParty=box=>{
   const line=box.closest('[data-journal-line]');
   if(!line)return;
   const acc=accounts.find(a=>a.code===line.querySelector('[data-journal-field="account"]').value);
   const kind=KIND_OF(acc);
   if(!kind){box.querySelector('.ms-panel').hidden=true;return;}
   const project=line.querySelector('[data-journal-field="project"]').value;
   const location=document.querySelector('#accounting-journal input[name="location"]')?.value||draft.location||'HQ';
   let shown=0;
   box.querySelectorAll('.ss-item').forEach(item=>{
     const hit=item.dataset.kind===kind&&allowedHere(item.dataset.value,project,location);
     item.hidden=!hit;
     if(hit)shown++;
   });
   const empty=box.querySelector('.ms-empty');
   if(empty)empty.hidden=shown>0;
 };
 document.addEventListener('ms:open',ev=>{
   const box=ev.target.closest('.ss');
   if(!box||box.dataset.ss!=='party')return;
   openParty(box);
 });
 const addFiles=(list)=>{
   for(const f of list) draft.evidence.push({name:f.name,size:f.size,type:f.type||''});
   if(list.length)notify(list.length+' file(s) attached to this draft.');
   render();
 };
 document.querySelector('#journal-evidence')?.addEventListener('change',ev=>{
   capture();
   addFiles(ev.target.files);
   ev.target.value='';
 });
 const drop=document.querySelector('#journal-drop');
 if(drop){
   drop.addEventListener('dragover',ev=>{ev.preventDefault();drop.classList.add('is-over');});
   drop.addEventListener('dragleave',()=>drop.classList.remove('is-over'));
   drop.addEventListener('drop',ev=>{ev.preventDefault();drop.classList.remove('is-over');capture();addFiles(ev.dataTransfer.files);});
   drop.querySelector('input[type=file]')?.addEventListener('change',ev=>{capture();addFiles(ev.target.files);ev.target.value='';});
 }
 document.querySelectorAll('[data-form-action]').forEach(b=>b.addEventListener('click',()=>{
   const act=b.dataset.formAction;
   const controlProblem=()=>{for(const [i,l] of draft.lines.entries()){const a=accounts.find(x=>x.code===l.account);if(a&&a.control&&!String(l.party||'').trim())return `${a.code} ${a.name} on line ${i+1} is a control account. Choose a party or sub-account before continuing.`;}return '';};
   const patch=()=>({date:draft.date,narrative:draft.narrative,location:draft.location,lines:draft.lines.map(l=>({account:l.account,debit:l.debit,credit:l.credit,party:l.party,project:l.project,costCentre:l.costCentre}))});
   if(act==='save'){capture();const problem=controlProblem();if(problem){notify(problem);return;}if(draft.editingId){screens.updateJournalDoc(draft.editingId,patch());notify('Draft updated. No ledger effect.');navigate({module:'accounting',tab:'journals'});return;}localStorage.setItem('sa7en:sample-journal:v1',JSON.stringify(draft));saved=true;notify('Saved as a draft. No ledger effect.');render();return;}
   if(act==='submit'||act==='approval'){capture();const problem=controlProblem();if(problem){notify(problem);return;}if(draft.editingId){screens.updateJournalDoc(draft.editingId,{...patch(),state:act==='submit'?'posted':'returned'});notify(act==='submit'?'Submitted and posted.':'Submitted for approval; it comes back editable if returned.');navigate({module:'accounting',tab:'journals'});return;}notify(act==='submit'?'Submitted and posted.':'Submitted for approval.');return;}
   if(act==='duplicate'){capture();const id=draft.editingId?screens.duplicateJournalDoc(draft.editingId):'';if(id){notify('Duplicated into a new draft.');navigate({module:'accounting',tab:'journals',mode:'editor',code:id});return;}draft={...draft,editingId:'',state:'draft',locked:false,number:nextJournalNumber(),reference:'',lines:draft.lines.map(l=>({...l}))};notify('Duplicated into a new draft.');render();return;}
   if(act==='cancel'){if(!draft.editingId)return;capture();screens.cancelJournalDoc(draft.editingId);notify('Entry cancelled: removed from the ledger, kept in the register. Delete removes it from the register.');navigate({module:'accounting',tab:'journals'});return;}
   if(act==='delete'){if(draft.editingId){screens.deleteJournalDoc(draft.editingId);notify('Deleted from the register. The number is never reused and the audit log keeps the record.');navigate({module:'accounting',tab:'journals'});return;}notify('Deleted as a draft. A posted entry can only be cancelled first.');return;}
 }));document.querySelector('#tb-filter')?.addEventListener('submit',ev=>{ev.preventDefault();const v=Object.fromEntries(new FormData(ev.target));try{range={from:v.from,to:v.to};query=v.q;tbClass=v.type;tbGroup=v.group;render();}catch(error){notify(error.message);}});
document.querySelector('#accounting-filter')?.addEventListener('submit',ev=>{ev.preventDefault();const values=Object.fromEntries(new FormData(ev.target));try{ledger(data(),values);range={from:values.from,to:values.to};query=values.query;render();}catch(error){notify(error.message);}});document.querySelector('#ledger-account')?.addEventListener('change',ev=>{selected=ev.target.value;render();});document.querySelector('#chart-query')?.addEventListener('change',ev=>{query=ev.target.value;render();});const f=document.querySelector('#accounting-journal');f?.addEventListener('submit',ev=>ev.preventDefault());f?.addEventListener('input',()=>{capture();saved=false;dirty(true);document.querySelector('#journal-live-preview').innerHTML=preview();});f?.addEventListener('change',()=>{capture();dirty(true);document.querySelector('#journal-live-preview').innerHTML=preview();});document.querySelector('#journal-evidence')?.addEventListener('change',ev=>{capture();draft.evidence.push(...[...ev.target.files].map(f=>({name:f.name,size:f.size})));dirty(true);render();});}
 function bindTableScrollbars(){
   document.querySelectorAll('[data-hscroll]').forEach(scroller=>{
     if(scroller.dataset.hscrollReady)return;
     scroller.dataset.hscrollReady='1';
     const track=document.createElement('div');track.className='hscroll hscroll--table';
     const thumb=document.createElement('div');thumb.className='hscroll-thumb';
     track.appendChild(thumb);
     scroller.parentNode.insertBefore(track,scroller);
     const sync=()=>{
       const max=Math.max(scroller.scrollWidth-scroller.clientWidth,0);
       const ratio=scroller.clientWidth/Math.max(scroller.scrollWidth,1);
       thumb.style.width=Math.max(12,Math.round(ratio*100))+'%';
       thumb.style.left=(max?scroller.scrollLeft/max:0)*(100-parseFloat(thumb.style.width))+'%';
     };
     scroller.addEventListener('scroll',sync);
     window.addEventListener('resize',sync);
     thumb.addEventListener('pointerdown',ev=>{
       ev.preventDefault();
       const startX=ev.clientX,startLeft=scroller.scrollLeft,room=track.clientWidth-thumb.offsetWidth,max=Math.max(scroller.scrollWidth-scroller.clientWidth,0);
       thumb.setPointerCapture(ev.pointerId);
       const move=e2=>{if(!room)return;scroller.scrollLeft=startLeft+((e2.clientX-startX)/room)*max;};
       const up=()=>{thumb.removeEventListener('pointermove',move);thumb.removeEventListener('pointerup',up);};
       thumb.addEventListener('pointermove',move);thumb.addEventListener('pointerup',up);
     });
     track.addEventListener('click',ev=>{
       if(ev.target===thumb)return;
       const rect=track.getBoundingClientRect(),max=Math.max(scroller.scrollWidth-scroller.clientWidth,0);
       scroller.scrollLeft=max*((ev.clientX-rect.left)/Math.max(rect.width,1));
     });
     sync();
   });
 }
 document.addEventListener('click',event=>{const b=event.target.closest('[data-ac]');if(!b)return;try{switch(b.dataset.ac){case 'group':open.has(b.dataset.value)?open.delete(b.dataset.value):open.add(b.dataset.value);render();break;case 'account':selected=b.dataset.value;render();break;case 'ledger':selected=b.dataset.value||'';query='';document.querySelector('#detail-dialog').close();navigate({module:'accounting',tab:'ledger'});break;case 'new-journal':navigate({module:'accounting',mode:'editor'});break;case 'statement':statement=b.dataset.value;render();break;case 'source':source(b.dataset.value);break;case 'new-account':accountDialog(true);break;case 'edit-account':accountDialog(false);break;case 'chart-tab':chartTab=b.dataset.value;render();break;case 'open-account':navigate({module:'accounting',tab:'coa',mode:'editor',code:b.dataset.value});break;case 'new-account-page':navigate({module:'accounting',tab:'coa',mode:'editor',code:''});break;case 'export-coa':{const rows=[['Code','Name','Class','Head','Control','Opening','Period debit','Period credit','Closing debit','Closing credit'],...trial(data(),range).map(a=>[a.code,a.name,a.type,a.group,a.control,a.opening,a.debit,a.credit,a.closingDebit,a.closingCredit])];download('SA7EN-chart-of-accounts.csv',rows);break;}case 'save-account':{const form=document.querySelector('#sample-account-form');if(!form.reportValidity())return;const v=Object.fromEntries(new FormData(form)),old=accounts.find(a=>a.code===v.code);if(b.dataset.fresh==='true'&&old)throw Error('That sample account code already exists.');const group={asset:'Assets',liability:'Liabilities',equity:'Equity',income:'Income',expense:'Expenses'}[v.type];if(old){if(old.type!==v.type)throw Error('Historical account reclassification needs a reviewed migration; change the name only in this example.');old.name=v.name;}else accounts.push({...v,group,currency:'PKR',active:true});selected=v.code;document.querySelector('#detail-dialog').close();render();notify('Sample chart updated in memory. No real account changed.');break;}case 'archive-account':{const a=accounts.find(a=>a.code===selected);if(data().some(j=>j.lines.some(l=>l.account===a.code)))throw Error('This sample account has history. Review balance, subledger dependencies and effective archival policy first.');a.active=!a.active;render();notify('Sample account state changed in memory only.');break;}case 'add-line':capture();if(draft.lines.length>=40)throw Error('Use at most 40 sample lines.');draft.lines.push({account:'5000',debit:'0.00',credit:'0.00',description:'',party:'',project:'',location:'',costCentre:''});dirty(true);render();break;case 'remove-line':capture();if(draft.lines.length<=2)throw Error('Retain at least two journal lines.');draft.lines.splice(Number(b.dataset.value),1);dirty(true);render();break;case 'remove-evidence':capture();draft.evidence.splice(Number(b.dataset.value),1);dirty(true);render();break;case 'save-draft':capture();{const missing=draft.lines.filter(l=>{const a=accounts.find(x=>x.code===l.account);return a&&a.control&&!String(l.party||'').trim();});if(missing.length)throw Error('A control account needs a party or sub-account on line '+(draft.lines.findIndex(l=>{const a=accounts.find(x=>x.code===l.account);return a&&a.control&&!String(l.party||'').trim();})+1)+' ('+missing[0].account+'). Choose the party before saving.');}localStorage.setItem('sa7en:sample-journal:v1',JSON.stringify(draft));saved=true;dirty(false);render();notify('Sample draft saved on this browser. No journal was posted.');break;case 'restore-draft':{const raw=localStorage.getItem('sa7en:sample-journal:v1');if(!raw)throw Error('No saved sample draft on this browser.');const restored=JSON.parse(raw);if(!restored||!Array.isArray(restored.lines)||restored.lines.length<2||restored.lines.length>40||!['date','reference','narrative','branch','decision'].every(k=>typeof restored[k]==='string')||!restored.lines.every(l=>['account','debit','credit','description'].every(k=>typeof l[k]==='string'))||!Array.isArray(restored.evidence)||!restored.evidence.every(f=>typeof f.name==='string'&&Number.isSafeInteger(f.size)&&f.size>=0))throw Error('Saved sample draft is invalid.');draft=restored;saved=true;dirty(false);render();notify('Saved sample draft restored.');break;}case 'review-journal':capture();if(!document.querySelector('#accounting-journal').reportValidity())return;const result=reviewJournal(draft,accounts);dialog('Journal workflow review',`${preview()}<div class="callout">${result.decision}. The real backend must recheck scope, evidence, entitlement, period and policy versions before creating a durable receipt. No posting or approval request was submitted.</div>`);break;case 'export-ledger':{const r=ledger(data(),{...range,account:selected,query});download('SA7EN-sample-general-ledger.csv',[['Date','Voucher','Account','Narrative','Party','Debit','Credit','Balance'],...r.rows.map(l=>[l.date,l.id,l.account,l.narrative,l.party,l.debit,l.credit,l.balance])]);break;}case 'export-trial':download('SA7EN-sample-trial-balance.csv',[['Code','Account','Opening net','Period debit','Period credit','Closing debit','Closing credit'],...trial(data(),range).map(a=>[a.code,a.name,a.opening,a.debit,a.credit,a.closingDebit,a.closingCredit])]);break;case 'export-statements':{const s=statements(data(),range);download('SA7EN-sample-financial-statements.csv',[['Period',range.from,range.to],['Revenue',s.income],['Expenses',s.expenses],['Profit',s.profit],['Assets',s.assets],['Liabilities',s.liabilities],['Capital',s.capital],['Accumulated profit',s.accumulatedProfit],['Equity',s.equity],['Basis','Synthetic fixtures only; not statutory financial statements']]);break;}default:dialog('Accounting workflow contract',`<p>${b.dataset.ac==='period-review'?'Review outstanding reconciliation, subledger controls, pending entries, sign-off and immutable snapshot before an authorized period lock.':b.dataset.ac==='correction'?'Select linked reversal or correcting entry, effective date, reason, retained source evidence and approval policy. Historical posted entries remain immutable.':'Supporting objects require versioned links, original bytes, hash/type/scan result, access rules and immutable audit attribution.'}</p><p class="form-note">Detailed backend and remaining UI states are not connected in this walkthrough.</p>`);}}catch(error){notify(error.message);}});
 const FORM_META={
   journals:['New journal','Journal entry'],
   cash:['New sub-account','Cash or bank sub-account'],
   parties:['New party','Customer or supplier'],
   items:['New item','Item'],
   taxes:['New tax rule','Tax rule'],
   payments:['New receipt or payment','Receipt or payment'],
   'sales-invoices':['New sales invoice','Sales invoice'],
   'purchase-invoices':['New purchase bill','Purchase bill'],
   coa:['',''],
   trial:['',''],
 };
 function newLabel(tab){return (FORM_META[tab]||FORM_META.journals)[0];}
 function formMeta(tab,code){
   if(tab==='journals'&&code)return {title:'Journal entry',description:'Opened in the same form it was created in. Drafts and returned entries are editable; posted entries are read-only until cancelled or duplicated.'};
   if(tab==='coa')return code?{title:'Edit account',description:'Saving returns to the chart register.'}:{title:'New account',description:'Adds a head to the chart. Class and control decide where it posts and whether it needs a party.'};
   const meta=FORM_META[tab]||FORM_META.journals;
   return code
     ? {title:'Edit '+meta[1].toLowerCase(),description:'Change the saved values. Saving returns you to the register.'}
     : {title:meta[0],description:'Fill this form and save. Nothing here posts to the ledger in this build.'};
 }
 function editor(tab,code){
   if(tab==='coa')return screens.chartAccountEditor(code||'');
   if(tab==='cash')return screens.cashEditor(code||'');
   if(tab==='parties')return screens.partyEditor(code||'');
   if(tab==='items')return screens.itemEditor(code||'');
   if(tab==='taxes')return screens.taxEditor(code||'');
   if(tab==='payments')return screens.paymentEditor();
   if(tab==='sales-invoices')return screens.invoiceEditor('sales');
   if(tab==='purchase-invoices')return screens.invoiceEditor('purchase');
   if(code&&draft.editingId!==code)loadJournalDoc(code);
   if(!code&&draft.editingId)resetJournalDraft();
   return journalEditor();
 }
 function prepareNew(tab){if(tab==='journals')resetJournalDraft();}
 return {view,editor,newLabel,formMeta,prepareNew,bind,settings:page=>screens.settings(page),settingsEditor:(form,code)=>screens.settingsEditor(form,code)};
}
