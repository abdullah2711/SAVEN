// Independent synthetic UI fixtures. No business storage or posting endpoint.
import {cents,decimal} from './model.js';
export const chart=[['1000','Cash','asset','Assets'],['1010','Operating bank','asset','Assets'],['1100','Trade receivables','asset','Assets'],['1300','Recoverable input tax','asset','Assets'],['2100','Trade payables','liability','Liabilities'],['2200','Output tax payable','liability','Liabilities'],['3000','Owner capital','equity','Equity'],['4000','Service revenue','income','Income'],['5000','Operating expenses','expense','Expenses']].map(([code,name,type,group])=>({code,name,type,group,currency:'PKR',active:true}));
const line=(account,debit,credit)=>({account,debit,credit});
export const journals=[{id:'DEMO-JV-001',date:'2026-11-01',narrative:'Capital introduced',party:'Owner',source:'Journal',lines:[line('1010','5000.00','0.00'),line('3000','0.00','5000.00')]},{id:'DEMO-SI-001',date:'2026-11-03',narrative:'Service invoice',party:'Atlas Studio',source:'Sales invoice',lines:[line('1100','110.00','0.00'),line('4000','0.00','100.00'),line('2200','0.00','10.00')]},{id:'DEMO-PY-001',date:'2026-11-05',narrative:'Invoice settlement',party:'Atlas Studio',source:'Payment',lines:[line('1010','110.00','0.00'),line('1100','0.00','110.00')]},{id:'DEMO-PI-001',date:'2026-11-07',narrative:'Purchased services',party:'Willow Supplies',source:'Supplier bill',lines:[line('5000','50.00','0.00'),line('1300','5.00','0.00'),line('2100','0.00','55.00')]}];

// ---------------------------------------------------------------------------
// Operating sample. ~195 balanced documents for November 2026, generated
// deterministically from the same nine-account chart, so the register, ledger,
// trial balance, statements and the newer screens cannot disagree.
const SAMPLE_CUSTOMERS=['Atlas Studio','Linden Design','Harbor Workshop','Crescent Textiles','Meridian Pharma','Orion Logistics','Sapphire Retail','Indus Packaging','Kestrel Engineering','Marina Hospitality','Zenith Electrical','Falcon Chemicals'];
const SAMPLE_SUPPLIERS=['Willow Supplies','Maple Packaging','Cedar Services','Pak Print House','Al-Noor Freight','Metro Office Supply','Secure Line','Digital Systems'];
const seeded=(()=>{let x=0x2f6e2b1;return()=>{x=(x*1103515245+12345)>>>0;return x/4294967296;};})();
const r2=n=>Math.round(n*100)/100;
const amt=(n)=>n.toFixed(2);
const dayOf=i=>String(1+Math.floor(i*29/195)).padStart(2,'0');

export const operatingJournals=(()=>{
  const out=[];
  const push=(doc)=>{out.push(doc);};
  let seq={SI:100,PY:100,PI:100,JV:100};
  const customers=SAMPLE_CUSTOMERS, suppliers=SAMPLE_SUPPLIERS;

  // 70 sales invoices: Dr receivables, Cr revenue + output tax
  for(let i=0;i<70;i++){
    const gross=r2(25000+seeded()*50000), net=r2(gross/1.1), tax=r2(gross-net);
    const id='DEMO-SI-'+String(++seq.SI);
    push({id,date:'2026-11-'+dayOf(out.length),narrative:'Service invoice',party:customers[i%customers.length],source:'Sales invoice',lines:[line('1100',amt(gross),'0.00'),line('4000','0.00',amt(net)),line('2200','0.00',amt(tax))]});
  }
  // 55 receipts: Dr bank, Cr receivables
  for(let i=0;i<55;i++){
    const value=r2(30000+seeded()*55000);
    push({id:'DEMO-PY-'+String(++seq.PY),date:'2026-11-'+dayOf(out.length),narrative:'Invoice settlement',party:customers[i%customers.length],source:'Payment',lines:[line('1010',amt(value),'0.00'),line('1100','0.00',amt(value))]});
  }
  // 40 supplier bills: Dr operating expenses, Cr payables
  for(let i=0;i<40;i++){
    const value=r2(20000+seeded()*50000);
    push({id:'DEMO-PI-'+String(++seq.PI),date:'2026-11-'+dayOf(out.length),narrative:'Purchased services',party:suppliers[i%suppliers.length],source:'Supplier bill',lines:[line('5000',amt(value),'0.00'),line('2100','0.00',amt(value))]});
  }
  // 24 supplier payments: Dr payables, Cr bank
  for(let i=0;i<24;i++){
    const value=r2(30000+seeded()*50000);
    push({id:'DEMO-JV-'+String(++seq.JV),date:'2026-11-'+dayOf(out.length),narrative:'Supplier payment',party:suppliers[i%suppliers.length],source:'Journal',lines:[line('2100',amt(value),'0.00'),line('1010','0.00',amt(value))]});
  }
  // 6 running costs paid from the bank
  for(let i=0;i<6;i++){
    const value=r2(60000+seeded()*80000);
    push({id:'DEMO-JV-'+String(++seq.JV),date:'2026-11-'+dayOf(out.length),narrative:['Office rent','Payroll','Utilities','Insurance','Freight','Maintenance'][i],party:'Internal',source:'Journal',lines:[line('5000',amt(value),'0.00'),line('1010','0.00',amt(value))]});
  }
  return out;
})();

export function fixture(company){return company==='Northstar Trading'?journals.concat(operatingJournals):[];}
export function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function ledger(data,{account='',from='2026-11-01',to='2026-11-30',query=''}={}){if(!validDate(from)||!validDate(to)||from>to)throw Error('Choose a valid date range.');const running=new Map(),opening=new Map();for(const j of data.filter(j=>j.date<from))for(const l of j.lines)opening.set(l.account,(opening.get(l.account)||0n)+cents(l.debit)-cents(l.credit));for(const [a,n] of opening)running.set(a,n);const rows=[];for(const j of data.filter(j=>j.date>=from&&j.date<=to).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)))for(const [i,l] of j.lines.entries()){running.set(l.account,(running.get(l.account)||0n)+cents(l.debit)-cents(l.credit));if((!account||l.account===account)&&(j.id+' '+j.narrative+' '+j.party+' '+l.account).toLowerCase().includes(query.toLowerCase()))rows.push({...l,id:j.id,date:j.date,narrative:j.narrative,party:j.party,source:j.source,line:i+1,balance:decimal(running.get(l.account))});}return {rows,opening:account?decimal(opening.get(account)||0n):null,closing:account?decimal(running.get(account)||0n):null,debit:decimal(rows.reduce((n,l)=>n+cents(l.debit),0n)),credit:decimal(rows.reduce((n,l)=>n+cents(l.credit),0n))};}
export function trial(data,{from='2026-11-01',to='2026-11-30'}={}){ledger(data,{from,to});return chart.map(a=>{let opening=0n,debit=0n,credit=0n;for(const j of data.filter(j=>j.date<=to))for(const l of j.lines.filter(l=>l.account===a.code)){if(j.date<from)opening+=cents(l.debit)-cents(l.credit);else{debit+=cents(l.debit);credit+=cents(l.credit);}}const closing=opening+debit-credit;return {...a,opening:decimal(opening),debit:decimal(debit),credit:decimal(credit),closingDebit:decimal(closing>0n?closing:0n),closingCredit:decimal(closing<0n?-closing:0n)};});}
export function statements(data,range={}){const period=trial(data,range),all=trial(data,{from:'1900-01-01',to:range.to||'2026-11-30'}),value=a=>cents(a.closingDebit)-cents(a.closingCredit),sum=(rows,type)=>rows.filter(a=>a.type===type).reduce((n,a)=>n+value(a),0n),income=period.filter(a=>a.type==='income').reduce((n,a)=>n+cents(a.credit)-cents(a.debit),0n),expenses=period.filter(a=>a.type==='expense').reduce((n,a)=>n+cents(a.debit)-cents(a.credit),0n),profit=income-expenses,accumulatedProfit=-sum(all,'income')-sum(all,'expense'),assets=sum(all,'asset'),liabilities=-sum(all,'liability'),capital=-sum(all,'equity');return {income:decimal(income),expenses:decimal(expenses),profit:decimal(profit),assets:decimal(assets),liabilities:decimal(liabilities),capital:decimal(capital),accumulatedProfit:decimal(accumulatedProfit),equity:decimal(capital+accumulatedProfit),balanced:assets===liabilities+capital+accumulatedProfit,accounts:all};}
export function reviewJournal(draft,accounts=chart){if(!validDate(draft.date))throw Error('Choose a valid posting date.');if(!draft.reference?.trim()||draft.reference.length>60||!draft.narrative?.trim())throw Error('Reference and narrative are required.');if(!Array.isArray(draft.lines)||draft.lines.length<2||draft.lines.length>40)throw Error('Use 2 to 40 lines.');let debit=0n,credit=0n;const lines=draft.lines.map(l=>{if(!accounts.some(a=>a.code===l.account&&a.active))throw Error('Choose an active account.');const dr=cents(l.debit||'0'),cr=cents(l.credit||'0');if(!((dr>0n&&cr===0n)||(cr>0n&&dr===0n)))throw Error('Each line needs one positive debit or credit.');debit+=dr;credit+=cr;return {...l,debit:decimal(dr),credit:decimal(cr)};});if(debit!==credit||debit===0n)throw Error('Debits and credits must balance before review.');return {lines,debit:decimal(debit),credit:decimal(credit),decision:draft.decision==='review'?'Independent review':'Authorized direct post',posted:false};}
export function csv(rows){return rows.map(row=>row.map(value=>{let s=String(value??'');if(!/^-?\d+(?:\.\d+)?$/.test(s)&&/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
