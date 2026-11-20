#!/usr/bin/env node
// Regenerates docs/design/shared/catalog.js from the requirement inventory.
// The inventory is the source of truth for which screens exist; this file adds
// the presentation metadata (label, icon, navigation group, delivery phase).
//
//   node docs/design/build/make-catalog.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../../..');
const inventory=JSON.parse(await readFile(resolve(root,'docs/ui-screen-inventory.json'),'utf8'));

// Order is the navigation order. Groups keep the sidebar readable.
const META={
  accounting:{label:'Accounting',icon:'ledger',group:'Accounting',phase:'MVP-1',
    blurb:'Ledger, journals, close and the statements everything else posts into.'},
  banking:{label:'Cash & bank',icon:'bank',group:'Accounting',phase:'MVP-1',
    blurb:'Cash books, bank books, statement imports and reconciliation.'},
  payments:{label:'Payments',icon:'arrows',group:'Accounting',phase:'MVP-1',
    blurb:'Receipts, supplier payments, allocations, advances and refunds.'},
  tax:{label:'Taxes',icon:'percent',group:'Accounting',phase:'MVP-1',
    blurb:'Registrations, sales and purchase tax, withholding and returns.'},
  assets:{label:'Fixed assets',icon:'asset',group:'Accounting',phase:'MVP-1',
    blurb:'Register, capitalisation, depreciation, transfers and disposals.'},
  finance:{label:'Finance',icon:'trend',group:'Accounting',phase:'MVP-2',
    blurb:'Cash position, liquidity, working capital and collection.'},
  reports:{label:'Reports & BI',icon:'chart',group:'Accounting',phase:'MVP-2',
    blurb:'Standard reports, statement mapping, packs and narrative notes.'},

  sales:{label:'Sales',icon:'sales',group:'Trading',phase:'MVP-1',
    blurb:'Customers, quotes, orders, invoices, fulfilment and credits.'},
  purchases:{label:'Purchases',icon:'purchases',group:'Trading',phase:'MVP-1',
    blurb:'Suppliers, requisitions, orders, receipts, bills and matching.'},
  inventory:{label:'Inventory',icon:'box',group:'Trading',phase:'MVP-1',
    blurb:'Items, stores, movements, counts, valuation and write-offs.'},
  pos:{label:'Point of sale',icon:'terminal',group:'Trading',phase:'MVP-1',
    blurb:'Fast sale, till sessions, tenders, discounts and overrides.'},
  manufacturing:{label:'Manufacturing',icon:'factory',group:'Trading',phase:'MVP-2',
    blurb:'Bills of material, routes, capacity, planning and work orders.'},

  people:{label:'People & payroll',icon:'people',group:'People & work',phase:'MVP-2',
    blurb:'Employees, recruitment, onboarding, shifts and payroll inputs.'},
  projects:{label:'Projects',icon:'folder',group:'People & work',phase:'MVP-2',
    blurb:'Projects, tasks, time, expenses, budgets and billing.'},
  crm:{label:'CRM',icon:'leads',group:'People & work',phase:'MVP-2',
    blurb:'Leads and opportunities, worked through to a quote.'},

  drive:{label:'Documents',icon:'drive',group:'Platform',phase:'MVP-2',
    blurb:'Folders, access, object storage, evidence links and quotas.'},
  apps:{label:'Integrations',icon:'grid',group:'Platform',phase:'MVP-2',
    blurb:'API contracts, authority, safe mutation and the app registry.'},
  assistant:{label:'Assistant',icon:'spark',group:'Platform',phase:'MVP-2',
    blurb:'Proposal-only help: setup, navigation, guidance and extraction.'},
  settings:{label:'Settings',icon:'gear',group:'Platform',phase:'MVP-1',
    blurb:'Identity, dimensions, currencies, periods, roles and defaults.'},
  admin:{label:'Administration',icon:'shield',group:'Platform',phase:'MVP-1',cross:true,
    blurb:'Authentication, tenant isolation, audit and audit access. Required from day one, in every phase.'},
  subscription:{label:'Subscription',icon:'card',group:'Platform',phase:'MVP-2',
    blurb:'Lifecycle, prorated changes, billing and private certificates.'},
  commerce:{label:'Commerce',icon:'globe',group:'Platform',phase:'MVP-2',
    blurb:'Application portal, verification, provisioning and conversion.'},
  operator:{label:'Operator',icon:'ops',group:'Platform',phase:'MVP-2',
    blurb:'Operator administration, backup, telemetry and support access.'},
  offline:{label:'Offline',icon:'offline',group:'Platform',phase:'MVP-2',
    blurb:'Connectivity, offline scope and controlled offline application.'},
  design:{label:'Design system',icon:'palette',group:'Platform',phase:'MVP-1',cross:true,
    blurb:'Themes, navigation, brand, task interaction and this catalogue.'},
};

const GROUP_ORDER=['Accounting','Trading','People & work','Platform'];
const statusOf=(s)=>s.designStatus==='interactive draft'?'building':'planned';
// Screens this design pass actually produces for accounting.
const BUILT=new Set([
  // Screens that genuinely have a working surface in docs/design/ui.
  'ACC-001','ACC-003','ACC-006','ACC-011','ACC-013','ACC-017',
  'SAL-001','SAL-003','SAL-008','PUR-001','PUR-004','PUR-008','AST-003',
]);

const modules=Object.keys(META).map((id)=>{
  const meta=META[id];
  const screens=inventory.screens.filter((s)=>s.module===id).map((s)=>({
    id:s.requirement,title:s.title,
    status:BUILT.has(s.requirement)?'building':statusOf(s),
    requirementRoute:s.route,
    approval:s.approval,
  }));
  return {id,...meta,screens};
});

const unknown=[...new Set(inventory.screens.map((s)=>s.module))].filter((m)=>!META[m]);
if(unknown.length)throw Error('Inventory modules without metadata: '+unknown.join(', '));
const assigned=modules.reduce((n,m)=>n+m.screens.length,0);
if(assigned!==inventory.screens.length)throw Error(`Screen count mismatch: ${assigned} of ${inventory.screens.length}`);
modules.sort((a,b)=>GROUP_ORDER.indexOf(a.group)-GROUP_ORDER.indexOf(b.group));
modules.forEach((m)=>{m.count=m.screens.length;m.building=m.screens.filter((s)=>s.status==='building').length;});

const phases=['MVP-1','MVP-2'];
const summary={
  screens:inventory.screens.length,
  modules:modules.length,
  groups:GROUP_ORDER.length,
  byPhase:Object.fromEntries(phases.map((p)=>[p,{
    modules:modules.filter((m)=>m.phase===p).length,
    screens:modules.filter((m)=>m.phase===p).reduce((n,m)=>n+m.count,0),
  }])),
  byStatus:modules.reduce((acc,m)=>{m.screens.forEach((s)=>{acc[s.status]=(acc[s.status]||0)+1});return acc;},{}),
};

const header=`// Generated by docs/design/build/make-catalog.mjs from docs/ui-screen-inventory.json.
// Do not edit by hand: change the inventory or the META table and regenerate.
`;
await writeFile(resolve(root,'docs/design/shared/catalog.js'),
  header+'export const GROUP_ORDER='+JSON.stringify(GROUP_ORDER)+';\n'+
  'export const SUMMARY='+JSON.stringify(summary,null,1)+';\n'+
  'export const MODULES='+JSON.stringify(modules,null,1)+';\n');
console.log(`catalog: ${summary.modules} modules, ${summary.screens} screens, ${summary.byStatus.building||0} in build`);
console.log('phase split:',JSON.stringify(summary.byPhase));
