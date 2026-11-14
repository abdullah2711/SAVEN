import {icon} from './icons.js';
export function visual(el,name){const node=el('span',{class:'nav-symbol'});node.innerHTML=icon(name);return node;}
export const pageInfo={
 Workspace:['home','Your daily work, records and business controls.'],
 Selling:['sales','Sales invoices and linked customer documents.'],
 Buying:['sales','Supplier bills and linked purchase documents.'],
 'Customers & suppliers':['people','Customer and supplier records.'],
 Settings:['settings','Business setup, people, access and document configuration.'],
 Accounting:['accounting','Keep the books, review journals and follow every balance to its source.'],
 'Selling':['sales','Customer invoices, supplier bills and the amounts still outstanding.'],
 Payments:['payments','Record receipts and payments against the right source documents.'],
 Inventory:['inventory','Items, warehouses, stock movements and perpetual valuation.'],
 Assistant:['assistant','Ask about the records you can access. Review every proposal before submission.'],
 'Settings':['settings','Company information, print details, accounts and period controls.'],
 'Business administration':['people','Manage the people, roles and access in this business.'],
 Subscriptions:['accounting','Business subscriptions, onboarding and commercial controls.'],
 Operations:['admin','Database fleet, service status and platform operations.']
};
export function modulePages(name,business={}){
 const caps=business.capabilities??[],owner=business.owner;
 if(name==='Accounting')return [...(caps.includes('journal.prepare')?['Journal entry','Drafts']:[]),...(caps.includes('journal.read')?['Journals','Approvals','Corrections']:[]),'General ledger','Trial balance','Chart of accounts','Financial position','Profit or loss'];
 if(name==='Settings')return ['Business','Print configuration',...(caps.includes('periods.manage')||owner?['Period close']:[]),...(owner?['People','Roles','Add staff','Link an account','Role assignments']:[])];
 return ({Selling:['Invoices'],Buying:['Bills'],Payments:['Receipts','Supplier payments'],'Customers & suppliers':['Customers & suppliers'],Inventory:['Stock balances',...(caps.includes('inventory.prepare')||owner?['New movement']:[]),'Items','Warehouses',...(caps.includes('inventory.manage')?['Setup']:[])]})[name]??[];
}
export function workspaceFrame({el,btn,brand,context,business,page,activeTab,nav,navigate,signOut}){
 const content=el('div',{id:'content',class:'workspace-content'}),operator=context.realm==='operator';
 const groups=operator?[['PLATFORM',['Subscriptions','Operations']]]:[['WORKSPACE',['Workspace']],['ACCOUNTING',['Accounting','Selling','Buying','Payments','Customers & suppliers']],['OPERATIONS',['Inventory']],['BUSINESS',['Assistant','Settings']]];
 const groupsNodes=groups.map(([title,names])=>el('div',{class:'nav-group'},el('div',{class:'nav-label'},title),...names.filter(name=>nav.includes(name)).map(name=>{
  const pages=operator?[]:modulePages(name,business),button=btn(name,()=>navigate(name,{tab:pages[0]??''}));button.prepend?.(visual(el,pageInfo[name]?.[0]??'settings'));button.className='nav-item'+(name===page?' active':'');
  if(pages.length){button.setAttribute?.('aria-expanded',String(name===page));button.append(el('span',{class:'nav-chevron'},name===page?'\u2304':'\u203a'));}
  else button.setAttribute?.('aria-current',name===page?'page':'false');
  const children=name===page?pages.map(child=>{const button=btn(child,()=>navigate(name,{tab:child}),true);button.className='nav-subitem'+((activeTab||pages[0])===child?' selected':'');button.setAttribute?.('aria-current',(activeTab||pages[0])===child?'page':'false');return button;}):[];
  return el('div',{class:'nav-module'},button,...children);
 })));

 const sidebar=el('aside',{class:'sidebar',ariaLabel:'Business workspace navigation'},brand(),el('nav',{},...groupsNodes),el('div',{class:'sidebar-foot'},el('span',{class:'connection-dot'}),'On your server',el('div',{class:'small'},'Economic Systems')));
 const search=el('input',{type:'search',placeholder:'Find a page…',ariaLabel:'Find a page',autocomplete:'off'}),results=el('div',{class:'page-search-results',hidden:true});
 search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase(),matches=nav.flatMap(n=>[{name:n,tab:''},...modulePages(n,business).map(tab=>({name:n,tab}))]).filter(x=>(x.name+' '+x.tab).toLowerCase().includes(q));results.hidden=!q;results.replaceChildren(...matches.map(x=>btn(x.name+(x.tab?' / '+x.tab:''),()=>navigate(x.name,{tab:x.tab}),true)));});
 search.addEventListener('keydown',e=>{if(e.key==='Escape'){results.hidden=true;search.blur();}if(e.key==='Enter'){const match=nav.find(n=>n.toLowerCase().includes(search.value.trim().toLowerCase()));if(match)navigate(match);}});
 const menu=btn('',()=>sidebar.classList.toggle('open'),true);menu.className='icon-button mobile-menu';menu.ariaLabel='Open navigation';menu.append(visual(el,'menu'));
 const theme=btn('',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('sa7en_theme',next);}catch{}},true);theme.className='icon-button';theme.ariaLabel='Switch light or dark theme';theme.append(visual(el,'theme'));
 const picker=operator?el('span',{class:'business-name'},'SA7EN administration'):el('label',{class:'business-picker'},el('span',{class:'sr-only'},'Business'),el('select',{ariaLabel:'Business',onChange:e=>{const index=Number(e.target.value);if(navigate(page,{businessIndex:index})===false)e.target.value=String(context.businesses.indexOf(business));}},...(context.businesses??[]).map((b,i)=>el('option',{value:String(i),selected:b===business},b.name))));
 const avatar=el('span',{class:'avatar',title:context.email},context.email.slice(0,2).toUpperCase());
 const topbar=el('header',{class:'topbar'},menu,el('div',{class:'page-search'},visual(el,'search'),search,el('kbd',{},'Ctrl K'),results),el('div',{class:'top-context'},picker,el('span',{class:'branch-label'},business?.branch??'Platform'),theme,avatar,btn('Sign out',signOut,true)));
 const heading=el('div',{class:'page-heading'},el('div',{},el('p',{class:'eyebrow'},operator?'SA7EN PLATFORM':business?.currency?'BUSINESS WORKSPACE · '+business.currency:'BUSINESS WORKSPACE'),el('h1',{},activeTab?.startsWith('Draft ')?'Journal draft':activeTab?.startsWith('Entry ')?'Journal voucher':activeTab||page),el('p',{},pageInfo[page]?.[1]??'')),el('span',{class:'badge'},'In development'));
 const workspace=el('div',{class:'workspace'},el('div',{class:'crumbs'},btn('←',()=>history.back(),true),btn('→',()=>history.forward(),true),el('span',{},operator?'Platform / '+page:'Workspace'+(page==='Workspace'?'':' / '+page))),...(page==='Workspace'?[]:[heading]),el('div',{id:'status',role:'status',ariaLive:'polite'}),content);
 const main=el('main',{class:'main'},topbar,workspace);
 return {layout:el('div',{class:'layout'},sidebar,main),content,search};
}
export function tabs(content,names,selected,{el,btn,navigate,page}){
 const active=names.includes(selected)?selected:names[0];
 if(['Subscriptions','Operations'].includes(page))content.append(el('div',{class:'tabs',role:'tablist'},...names.map(name=>{const button=btn(name,()=>navigate(page,{tab:name}),true);button.role='tab';button.ariaSelected=String(name===active);if(name===active)button.className+=' selected';return button;})));
 return active;
}
export function focusCards(content,allowed){
 for(const node of [...content.children]){
  if(node.className?.includes('tabs'))continue;
  const heading=node.querySelector?.('h2')?.textContent;
  if(heading)node.hidden=!allowed.includes(heading);
 }
}
export async function overview(content,{api,el,btn,card,table,scope,business,navigate,capabilities}){
 const requests=[['commands',capabilities.includes('journal.read')?'/api/commands':null],['statements',capabilities.includes('ledger.read')?'/api/statements':null],['trade',capabilities.includes('journal.read')?'/api/trade':null],['stock',capabilities.includes('inventory.read')?'/api/inventory':null]];
 const values=await Promise.allSettled(requests.map(([,endpoint])=>endpoint?api(endpoint):null)),data=Object.fromEntries(requests.map(([key],i)=>[key,values[i].status==='fulfilled'?values[i].value:null]));
 const pending=(data.commands?.rows??[]).filter(x=>x.state==='AWAITING_APPROVAL'),recent=(data.commands?.rows??[]).slice(0,6);
 const money=kind=>{if(!data.trade)return '—';let total=0n;for(const d of data.trade.documents.filter(d=>d.kind===kind)){const [w,f='']=d.outstanding.split('.');total+=BigInt(w)*100n+BigInt(f.padEnd(2,'0'));}return (total/100n).toString()+'.'+String(total%100n).padStart(2,'0');};
 const hero=el('section',{class:'home-hero'},el('div',{},el('div',{class:'eyebrow'},'YOUR BUSINESS WORKSPACE'),el('h1',{},'Workspace'),el('p',{},'Open the books, record a transaction or review stock.'),btn(capabilities.includes('ledger.read')?'Open accounting':'Open inventory',()=>navigate(capabilities.includes('ledger.read')?'Accounting':'Inventory'),false)),el('div',{class:'hero-side'},...['Selling','Payments','Inventory'].filter(n=>n==='Inventory'?capabilities.includes('inventory.read'):capabilities.includes('journal.read')).map(n=>btn(n+'  ↗',()=>navigate(n),true))));
 content.append(hero,el('div',{class:'stats'},...[
  ['Receivables',money('invoice'),'Unpaid customer invoices'],['Payables',money('bill'),'Unpaid supplier bills'],['Stock value',data.stock?.totalValue??'—','Current carrying value'],['For review',data.commands?String(pending.length):'—','Documents awaiting approval']
 ].map(([label,value,note])=>el('div',{class:'stat'},el('span',{class:'stat-label'},label),el('strong',{class:'stat-value'},String(value).replace(/^(-?\d+)(\.\d+)?$/,(_,whole,fraction='')=>whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+fraction)),el('small',{},label==='For review'?note:(business?.currency??'')+' · '+note)))));
 const modules=[['Accounting','Chart, journals, ledgers and financial reports.','accounting','ledger.read'],['Selling','Create source documents and follow unpaid amounts.','sales','journal.read'],['Payments','Receipts, supplier payments and invoice allocations.','payments','journal.read'],['Inventory','Stock by warehouse, movements and valuation.','inventory','inventory.read'],['Assistant','Ask questions using your authorized business records.','assistant','assistant.use'],['Settings','Company details, accounts and print configuration.','settings','workspace.manage']];
 content.append(el('div',{class:'section-heading'},el('h2',{},'Everyday work'),el('span',{class:'small'},'Your connected business modules')),el('div',{class:'module-grid'},...modules.filter(m=>capabilities.includes(m[3])).map(([title,description,symbol])=>{const button=el('button',{class:'module-card',type:'button',onClick:()=>navigate(title)},el('div',{class:'module-icon'},visual(el,symbol),el('span',{},'↗')),el('h3',{},title),el('p',{},description));return button;})));
 const activity=card('Recent activity',table(recent,[['date','Date'],['narrative','Description'],['state','Status']]),el('div',{class:'toolbar'},btn('View all journals',()=>navigate('Accounting',{tab:'Journals'}),true)));
 const review=card('Keep things moving',el('div',{class:'quiet-row'},el('div',{},el('h3',{},'Review documents'),el('p',{class:'small'},data.commands?pending.length+' waiting for an authorized review':'No journal access in this workspace')),btn('Open',()=>navigate('Accounting',{tab:'Journals'}),true)),el('div',{class:'quiet-row'},el('div',{},el('h3',{},'People & permissions'),el('p',{class:'small'},'Staff access and business roles')),btn('Open',()=>navigate('Settings',{tab:'People'}),true)),el('div',{class:'quiet-row'},el('div',{},el('h3',{},'Print & business details'),el('p',{class:'small'},'Keep the information on your documents up to date')),btn('Open',()=>navigate('Settings'),true)));
 content.append(el('div',{class:'two-column'},...(capabilities.includes('journal.read')?[activity]:[]),...(business?.owner?[review]:[])));
}
