// Independent synthetic UI fixtures. No business storage or posting endpoint.
import {cents,decimal} from './model.js';
export const chart=[['1000','Cash','asset','Assets','cash','cash'],['1010','Operating bank','asset','Assets','bank','bank'],['1100','Trade receivables','asset','Assets','receivable','control'],['1300','Recoverable input tax','asset','Assets','','tax'],['2100','Trade payables','liability','Liabilities','payable','control'],['2200','Output tax payable','liability','Liabilities','','tax'],['2210','Sales tax withheld','liability','Liabilities','','tax'],['3000','Owner capital','equity','Equity','',''],['3100','Opening balance equity','equity','Equity','',''],['4000','Service revenue','income','Income','',''],['5000','Operating expenses','expense','Expenses','',''],['1200','Inventory — finished goods','asset','Assets','',''],['1020','Petty cash','asset','Assets','cash','cash'],['1400','Advance tax receivable','asset','Assets','','tax'],['2150','Withholding tax payable','liability','Liabilities','','tax'],['2300','Customer advances received','liability','Liabilities','','advance'],['1250','Supplier advances paid','asset','Assets','','advance'],['6500','Bank charges','expense','Expenses','','']].map(([code,name,type,group,control,subtype])=>({code,name,type,group,control:control||'',subtype:subtype||'',currency:'PKR',active:true}));
const line=(account,debit,credit,meta={})=>({account,debit,credit,project:'',location:'',costCentre:'',againstVoucher:'',supplierRef:'',...meta});
export const journals=[{id:'DEMO-JV-001',date:'2026-11-01',narrative:'Capital introduced',party:'Owner',source:'Journal',lines:[line('1010','5000.00','0.00'),line('3000','0.00','5000.00')]},{id:'DEMO-SI-001',date:'2026-11-03',narrative:'Service invoice',party:'Atlas Studio',source:'Sales invoice',lines:[line('1100','110.00','0.00'),line('4000','0.00','100.00'),line('2200','0.00','10.00')]},{id:'DEMO-PY-001',date:'2026-11-05',narrative:'Invoice settlement',party:'Atlas Studio',source:'Payment',lines:[line('1010','110.00','0.00'),line('1100','0.00','110.00')]},{id:'DEMO-PI-001',date:'2026-11-07',narrative:'Purchased services',party:'Willow Supplies',source:'Supplier bill',lines:[line('5000','50.00','0.00'),line('1300','5.00','0.00'),line('2100','0.00','55.00')]}];

// ---------------------------------------------------------------------------
// Operating sample. ~195 balanced documents for November 2026, generated
// deterministically from the same nine-account chart, so the register, ledger,
// trial balance, statements and the newer screens cannot disagree.
// Dimensions carried by every posting line, so the ledger can be sliced by them.
export const PROJECTS = [
  {code: 'PRJ-FALCON', name: 'Falcon warehouse fit-out', status: 'active', manager: 'S. Iqbal', accounts: ['1010', '4000', '5000']},
  {code: 'PRJ-MERIDIAN', name: 'Meridian clinic rollout', status: 'active', manager: 'N. Farooq', accounts: ['4000', '5000']},
  {code: 'PRJ-INDUS', name: 'Indus retail refit', status: 'on hold', manager: 'A. Rehman', accounts: ['4000', '5000']},
];
// Locations are a dimension on every posting, like project. Books stay company-wide.
export const LOCATIONS = [
  {code: 'HQ', name: 'Head office — Karachi', kind: 'office'},
  {code: 'OUT-KHI-01', name: 'Clifton outlet', kind: 'outlet'},
  {code: 'OUT-LHE-02', name: 'Gulberg outlet', kind: 'outlet'},
  {code: 'WH-KHI', name: 'Central warehouse', kind: 'warehouse'},
];
// Which projects and locations a party or sub-account may be used on. An empty
// list means every project or every location. Configuration, not a balance: it
// is set on the party or sub-account form and only narrows the journal picker.
// Access is read from PARTIES and CASH_BANK, so a form that sets membership
// takes effect everywhere immediately.

// Cash and bank sub-accounts. A sub-account is a party inside the control
// account (1010 bank, 1000 cash). Membership of projects and locations is a
// data field on the sub-account: blank means all.
export const BANK_NAMES = ['Standard Bank — current 0123456789', 'Meezan Bank — current 0987654321'];
export const CASH_NAMES = ['Front desk — A. Khan', 'Store counter — S. Ali'];
export const CASH_BANK = [
  {code: 'CB-0001', name: BANK_NAMES[0], kind: 'bank', control: '1010', reference: 'PK36STAN0000123456789012', projects: [], locations: []},
  {code: 'CB-0002', name: BANK_NAMES[1], kind: 'bank', control: '1010', reference: 'PK36MEZN0000987654321098', projects: [], locations: []},
  {code: 'CB-0003', name: CASH_NAMES[0], kind: 'cash', control: '1000', reference: 'Front desk till', projects: [], locations: ['HQ']},
  {code: 'CB-0004', name: CASH_NAMES[1], kind: 'cash', control: '1020', reference: 'Warehouse counter', projects: [], locations: ['WH-KHI']},
];

// Tax rules. A rule is a default; a document line may override it.
// One source for every document series. The journal composes
// prefix-MONTH-YEAR-sequence; the others are prefix + sequence.
export const NUMBERING = {
  journal: {prefix: 'JV', month: true, year: true, next: 1, padding: 4},
  sales: {prefix: 'SI-2026-', next: 301, padding: 4},
  purchase: {prefix: 'PI-2026-', next: 301, padding: 4},
  payment: {prefix: 'PAY', month: true, year: true, next: 1, padding: 4},
  receipt: {prefix: 'RCPT', month: true, year: true, next: 1, padding: 4},
};

export const TAX_RULES = [
  {code: 'STD-SALE', name: 'Sales tax 10%', kind: 'sales', rate: 10, basis: 'exclusive', account: '2200', scope: 'all', from: '2026-07-01', to: '', projects: [], locations: []},
  {code: 'STD-PURCHASE', name: 'Purchase tax 10%', kind: 'purchase', rate: 10, basis: 'exclusive', account: '1300', scope: 'all', from: '2026-07-01', to: '', projects: [], locations: []},
  {code: 'WHT-SERV', name: 'Withholding on services 4.5%', kind: 'withholding', rate: 4.5, basis: 'exclusive', account: '2150', scope: 'all', from: '2026-07-01', to: '', projects: [], locations: []},
  {code: 'ADV-SALE', name: 'Advance tax deducted by customer 0.5%', kind: 'advance', rate: 0.5, basis: 'exclusive', account: '1400', scope: 'all', from: '2026-07-01', to: '', projects: [], locations: []},
];

// Light item master for accounting. Tracked items are the only ones Inventory
// would value; quantities never live here.
// Custom fields added in Settings → Forms & fields. Stored on the document.
export const CUSTOM_FIELDS = [];

// Currencies offered by the business. Every document stores its own currency and
// the rate used, while the ledger keeps the primary currency.
export const CURRENCIES = {primary: 'PKR', allowed: ['PKR', 'USD', 'GBP', 'AED']};

// Groups used by parties and items. They are data for reporting and defaults.
export const PARTY_GROUPS = [
  {code: 'RET', name: 'Retail', kind: 'customer', description: 'Walk-in and small accounts'},
  {code: 'WHO', name: 'Wholesale', kind: 'customer', description: 'Trade customers with terms'},
  {code: 'SVC', name: 'Services', kind: 'supplier', description: 'Service providers'},
  {code: 'MAT', name: 'Materials', kind: 'supplier', description: 'Goods and packaging suppliers'},
];
export const ITEM_GROUPS = [
  {code: 'SRV', name: 'Services', description: 'Never valued or counted'},
  {code: 'PKG', name: 'Packaging', description: 'Tracked packaging materials'},
  {code: 'PRT', name: 'Printing', description: 'Printing consumables'},
  {code: 'GEN', name: 'General', description: 'Everything else'},
];

export const ITEMS = [
  {code: 'SRV-CONSULT', name: 'Consulting hour', unit: 'hour', income: '4000', expense: '5000', tax: 'STD-SALE', tracked: false},
  {code: 'SRV-SUPPORT', name: 'Support retainer', unit: 'month', income: '4000', expense: '5000', tax: 'STD-SALE', tracked: false},
  {code: 'ITM-PACK', name: 'Packaging carton', unit: 'piece', income: '4000', expense: '5000', tax: 'STD-PURCHASE', tracked: true},
  {code: 'ITM-INK', name: 'Printing ink', unit: 'litre', income: '4000', expense: '5000', tax: 'STD-PURCHASE', tracked: true},
];

export const CUSTOMER_NAMES = ['Atlas Studio','Linden Design','Harbor Workshop','Crescent Textiles','Meridian Pharma','Orion Logistics','Sapphire Retail','Indus Packaging','Kestrel Engineering','Marina Hospitality','Zenith Electrical','Falcon Chemicals'];
export const SUPPLIER_NAMES = ['Willow Supplies','Maple Packaging','Cedar Services','Pak Print House','Al-Noor Freight','Metro Office Supply','Secure Line','Digital Systems'];
const TERMS = [30, 15, 45, 0];
const LIMITS = [500000, 250000, 1000000, 0];
export const PARTIES = [
  ...CUSTOMER_NAMES.map((name, i) => ({
    code: 'CUS-' + String(101 + i), name, type: 'customer',
    group: i % 3 === 0 ? 'Retail' : 'Wholesale',
    terms: TERMS[i % 4], limit: LIMITS[i % 4],
    status: name === 'Marina Hospitality' ? 'Hold' : 'Active',
    taxId: 'NTN-' + String(4100000 + i * 37),
    projects: name === 'Atlas Studio' ? ['PRJ-MERIDIAN'] : name === 'Meridian Pharma' ? ['PRJ-MERIDIAN'] : [],
    locations: name === 'Atlas Studio' ? ['HQ', 'OUT-KHI-01'] : name === 'Meridian Pharma' ? ['OUT-LHE-02'] : [],
  })),
  ...SUPPLIER_NAMES.map((name, i) => ({
    code: 'SUP-' + String(201 + i), name, type: 'supplier',
    group: i % 2 === 0 ? 'Services' : 'Materials',
    terms: TERMS[(i + 1) % 4], limit: LIMITS[(i + 2) % 4],
    status: 'Active',
    taxId: 'NTN-' + String(5200000 + i * 53),
    projects: name === 'Willow Supplies' ? ['PRJ-FALCON'] : [],
    locations: [],
  })),
];

const locationFor = (i) => LOCATIONS[i % LOCATIONS.length].code;
export const COST_CENTRES = [
  {code: 'CC-ADM', name: 'Administration', description: 'Head office and management'},
  {code: 'CC-OPS', name: 'Operations', description: 'Delivery and production'},
  {code: 'CC-SAL', name: 'Sales', description: 'Selling and marketing'},
  {code: 'CC-WHS', name: 'Warehouse', description: 'Storage and handling'},
];
const projectFor = (i) => (i % 5 === 0 ? '' : PROJECTS[i % PROJECTS.length].code);
const centreFor = (i) => COST_CENTRES[i % COST_CENTRES.length].name;

const SAMPLE_CUSTOMERS=['Atlas Studio','Linden Design','Harbor Workshop','Crescent Textiles','Meridian Pharma','Orion Logistics','Sapphire Retail','Indus Packaging','Kestrel Engineering','Marina Hospitality','Zenith Electrical','Falcon Chemicals'];
const SAMPLE_SUPPLIERS=['Willow Supplies','Maple Packaging','Cedar Services','Pak Print House','Al-Noor Freight','Metro Office Supply','Secure Line','Digital Systems'];
const seeded=(()=>{let x=0x2f6e2b1;return()=>{x=(x*1103515245+12345)>>>0;return x/4294967296;};})();
const r2=n=>Math.round(n*100)/100;
const amt=(n)=>n.toFixed(2);
const dayOf=i=>String(1+Math.floor(i*29/195)).padStart(2,'0');

export const EXTRA_JOURNALS = [];

export const operatingJournals=(()=>{
  const customers=SAMPLE_CUSTOMERS, suppliers=SAMPLE_SUPPLIERS;
  // Type tokens, then a deterministic shuffle so the month interleaves instead
  // of posting all sales before all receipts.
  const kinds=[...Array(70).fill('sale'),...Array(55).fill('receipt'),...Array(40).fill('bill'),...Array(24).fill('payment'),...Array(6).fill('expense')];
  for(let i=kinds.length-1;i>0;i--){const j=Math.floor(seeded()*(i+1));[kinds[i],kinds[j]]=[kinds[j],kinds[i]];}
  const docs=kinds.map((kind,i)=>{
    const day=String(1+Math.floor(i*29/kinds.length)).padStart(2,'0');
    const date='2026-11-'+day;
    const project=projectFor(i), location=locationFor(i), centre=centreFor(i), against='DEMO-'+(kind==='payment'?'PI':'SI')+'-'+String(100+((i*7)%70));
    if(kind==='sale'){
      const gross=r2(25000+seeded()*50000), net=r2(gross/1.1), tax=r2(gross-net);
      return {id:'DEMO-SI-'+String(100+i),date,subtype:'Invoice',project,location,party:customers[i%customers.length],partyType:'Customer',source:'Sales invoice',supplierRef:'',againstVoucher:'',lines:[line('1100',amt(gross),'0.00',{project,costCentre:centre,location}),line('4000','0.00',amt(net),{project,costCentre:centre,location}),line('2200','0.00',amt(tax),{project,costCentre:centre,location})]};
    }
    if(kind==='receipt'){
      const value=r2(30000+seeded()*55000);
      return {id:'DEMO-PY-'+String(100+i),date,subtype:'Receipt',project,location,party:customers[i%customers.length],partyType:'Customer',source:'Payment',supplierRef:'',againstVoucher:'DEMO-SI-'+String(100+i),lines:[line('1010',amt(value),'0.00',{project,costCentre:centre,party:BANK_NAMES[i%BANK_NAMES.length],againstVoucher:'DEMO-SI-'+String(100+i)}),line('1100','0.00',amt(value),{project,costCentre:centre,againstVoucher:'DEMO-SI-'+String(100+i)})]};
    }
    if(kind==='bill'){
      const value=r2(20000+seeded()*50000);
      return {id:'DEMO-PI-'+String(100+i),date,subtype:'Bill',project,location,party:suppliers[i%suppliers.length],partyType:'Supplier',source:'Supplier bill',supplierRef:'SUP-'+String(4100+i),againstVoucher:'',lines:[line('5000',amt(value),'0.00',{project,costCentre:centre,location}),line('2100','0.00',amt(value),{project,costCentre:centre,location})]};
    }
    if(kind==='payment'){
      const value=r2(30000+seeded()*50000);
      return {id:'DEMO-JV-'+String(100+i),date,subtype:'Payment',project,location,party:suppliers[i%suppliers.length],partyType:'Supplier',source:'Payment',supplierRef:'',againstVoucher:'DEMO-PI-'+String(100+i),lines:[line('2100',amt(value),'0.00',{project,costCentre:centre,againstVoucher:'DEMO-PI-'+String(100+i)}),line('1010','0.00',amt(value),{project,costCentre:centre,party:BANK_NAMES[i%BANK_NAMES.length],againstVoucher:'DEMO-PI-'+String(100+i)})]};
    }
    const value=r2(60000+seeded()*80000);
    return {id:'DEMO-JV-'+String(500+i),date,subtype:'Expense',project:'',location,party:'Internal',partyType:'',source:'Journal',supplierRef:'',againstVoucher:'',lines:[line('5000',amt(value),'0.00',{project,costCentre:centre,location}),line('1010','0.00',amt(value),{project,costCentre:centre,location,party:BANK_NAMES[i%BANK_NAMES.length]})]};
  });
  return docs.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
})();

export function fixture(company){return company==='Northstar Trading'?journals.concat(operatingJournals).concat(EXTRA_JOURNALS):[];}
export function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function ledger(data,{account='',from='2026-11-01',to='2026-11-30',query=''}={}){if(!validDate(from)||!validDate(to)||from>to)throw Error('Choose a valid date range.');const running=new Map(),opening=new Map();for(const j of data.filter(j=>j.date<from))for(const l of j.lines)opening.set(l.account,(opening.get(l.account)||0n)+cents(l.debit)-cents(l.credit));for(const [a,n] of opening)running.set(a,n);const rows=[];for(const j of data.filter(j=>j.date>=from&&j.date<=to).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)))for(const [i,l] of j.lines.entries()){running.set(l.account,(running.get(l.account)||0n)+cents(l.debit)-cents(l.credit));if((!account||l.account===account)&&(j.id+' '+j.narrative+' '+j.party+' '+l.account).toLowerCase().includes(query.toLowerCase()))rows.push({...l,id:j.id,date:j.date,narrative:j.narrative,party:j.party,source:j.source,line:i+1,balance:decimal(running.get(l.account))});}return {rows,opening:account?decimal(opening.get(account)||0n):null,closing:account?decimal(running.get(account)||0n):null,debit:decimal(rows.reduce((n,l)=>n+cents(l.debit),0n)),credit:decimal(rows.reduce((n,l)=>n+cents(l.credit),0n))};}
export function trial(data,{from='2026-11-01',to='2026-11-30'}={}){ledger(data,{from,to});return chart.map(a=>{let opening=0n,debit=0n,credit=0n;for(const j of data.filter(j=>j.date<=to))for(const l of j.lines.filter(l=>l.account===a.code)){if(j.date<from)opening+=cents(l.debit)-cents(l.credit);else{debit+=cents(l.debit);credit+=cents(l.credit);}}const closing=opening+debit-credit;return {...a,opening:decimal(opening),debit:decimal(debit),credit:decimal(credit),closingDebit:decimal(closing>0n?closing:0n),closingCredit:decimal(closing<0n?-closing:0n)};});}
export function statements(data,range={}){const period=trial(data,range),all=trial(data,{from:'1900-01-01',to:range.to||'2026-11-30'}),value=a=>cents(a.closingDebit)-cents(a.closingCredit),sum=(rows,type)=>rows.filter(a=>a.type===type).reduce((n,a)=>n+value(a),0n),income=period.filter(a=>a.type==='income').reduce((n,a)=>n+cents(a.credit)-cents(a.debit),0n),expenses=period.filter(a=>a.type==='expense').reduce((n,a)=>n+cents(a.debit)-cents(a.credit),0n),profit=income-expenses,accumulatedProfit=-sum(all,'income')-sum(all,'expense'),assets=sum(all,'asset'),liabilities=-sum(all,'liability'),capital=-sum(all,'equity');return {income:decimal(income),expenses:decimal(expenses),profit:decimal(profit),assets:decimal(assets),liabilities:decimal(liabilities),capital:decimal(capital),accumulatedProfit:decimal(accumulatedProfit),equity:decimal(capital+accumulatedProfit),balanced:assets===liabilities+capital+accumulatedProfit,accounts:all};}
export function reviewJournal(draft,accounts=chart){if(!validDate(draft.date))throw Error('Choose a valid posting date.');if(!draft.reference?.trim()||draft.reference.length>60||!draft.narrative?.trim())throw Error('Reference and narrative are required.');if(!Array.isArray(draft.lines)||draft.lines.length<2||draft.lines.length>40)throw Error('Use 2 to 40 lines.');let debit=0n,credit=0n;const lines=draft.lines.map(l=>{if(!accounts.some(a=>a.code===l.account&&a.active))throw Error('Choose an active account.');const ctl=accounts.find(a=>a.code===l.account&&a.control);if(ctl&&!(l.party||'').trim())throw Error(ctl.code+' '+ctl.name+' is a control account: every line needs a party or sub-account, with no exception.');const dr=cents(l.debit||'0'),cr=cents(l.credit||'0');if(!((dr>0n&&cr===0n)||(cr>0n&&dr===0n)))throw Error('Each line needs one positive debit or credit.');debit+=dr;credit+=cr;return {...l,debit:decimal(dr),credit:decimal(cr)};});if(debit!==credit||debit===0n)throw Error('Debits and credits must balance before review.');return {lines,debit:decimal(debit),credit:decimal(credit),decision:draft.decision==='review'?'Independent review':'Authorized direct post',posted:false};}
export function csv(rows){return rows.map(row=>row.map(value=>{let s=String(value??'');if(!/^-?\d+(?:\.\d+)?$/.test(s)&&/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
