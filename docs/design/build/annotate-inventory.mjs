#!/usr/bin/env node
// Adds a delivery-status field and an explicit module grouping to
// docs/ui-screen-inventory.json, without changing any existing field.
//
//   node docs/design/build/annotate-inventory.mjs          write
//   node docs/design/build/annotate-inventory.mjs --check  verify only
//
// Status is about design work in this repository, not about release approval:
//   PLANNED   no working screen exists
//   IN_BUILD  a working screen exists in docs/design/ui, design not finished
//   DONE      screen designed, reviewed and accepted by the owner
// DONE is deliberately empty: no screen has dated owner acceptance.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../../..');
const file=resolve(root,'docs/ui-screen-inventory.json');
const inventory=JSON.parse(await readFile(file,'utf8'));

const IN_BUILD=new Set([
  'ACC-001','ACC-003','ACC-006','ACC-011','ACC-013','ACC-017',
  'SAL-001','SAL-003','SAL-008','PUR-001','PUR-004','PUR-008','AST-003',
]);

// The navigation grouping used by the application and by the design library.
const GROUPS=[
  {id:'accounting',label:'Accounting',modules:['accounting','banking','payments','tax','assets','finance','reports']},
  {id:'trading',label:'Trading',modules:['sales','purchases','inventory','pos','manufacturing']},
  {id:'people',label:'People & work',modules:['people','projects','crm']},
  {id:'platform',label:'Platform',modules:['drive','apps','assistant','settings','admin','subscription','commerce','operator','offline','design']},
];

const screens=inventory.screens.map((s)=>({
  ...s,
  status:IN_BUILD.has(s.requirement)?'IN_BUILD':'PLANNED',
}));

// Grouping checks: every module appears exactly once, and each group only names
// modules that exist in the screen inventory.
const present=[...new Set(screens.map((s)=>s.module))].sort();
const grouped=GROUPS.flatMap((g)=>g.modules);
const missing=present.filter((m)=>!grouped.includes(m));
const extra=grouped.filter((m)=>!present.includes(m));
const duplicate=grouped.filter((m,i)=>grouped.indexOf(m)!==i);
if(missing.length)throw Error('Modules missing from a group: '+missing.join(', '));
if(extra.length)throw Error('Groups name modules that do not exist: '+extra.join(', '));
if(duplicate.length)throw Error('Modules listed in more than one group: '+duplicate.join(', '));

const counts={PLANNED:0,IN_BUILD:0,DONE:0};
for(const s of screens)counts[s.status]++;

const annotated={
  version:inventory.version,
  coverage:inventory.coverage,
  screenCount:screens.length,
  requirementCount:new Set(screens.map((s)=>s.requirement)).size,
  moduleCount:present.length,
  statusLegend:{
    PLANNED:'No working screen exists beyond the requirement brief.',
    IN_BUILD:'A working screen exists in docs/design/ui; design is not finished or reviewed.',
    DONE:'Designed, reviewed and accepted by the owner. Requires dated owner acceptance.',
  },
  statusCounts:counts,
  grouping:GROUPS.map((g)=>({
    ...g,
    screenCount:screens.filter((s)=>g.modules.includes(s.module)).length,
  })),
  screens,
};

const text=JSON.stringify(annotated,null,2)+'\n';
const existing=await readFile(file,'utf8');

if(process.argv.includes('--check')){
  if(existing!==text){console.error('STALE: docs/ui-screen-inventory.json is not annotated. Run this script without --check.');process.exit(1);}
  console.log(`PASS: ${screens.length} screens, ${annotated.moduleCount} modules, ${GROUPS.length} groups; status ${JSON.stringify(counts)}`);
  process.exit(0);
}
await writeFile(file,text);
console.log(`annotated ${screens.length} screens · ${annotated.moduleCount} modules · groups ${GROUPS.map((g)=>g.id).join(', ')}`);
console.log('status:',JSON.stringify(counts));
