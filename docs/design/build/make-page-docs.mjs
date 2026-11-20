#!/usr/bin/env node
// Generates docs/design/MODULE_PAGES.md from the same page map the UI uses.
//   node docs/design/build/make-page-docs.mjs
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PAGE_MAP as map} from '../save/ui/pages-map.js';

const root=resolve(import.meta.dirname,'../../..');

const titles={
  accounting:'Accounting',banking:'Cash & bank',payments:'Payments',sales:'Sales',purchases:'Purchases',
  tax:'Taxes',inventory:'Inventory',manufacturing:'Manufacturing',pos:'Point of sale',assets:'Fixed assets',
  people:'People & payroll',projects:'Projects',crm:'CRM',finance:'Finance',reports:'Reports & BI',
  drive:'Documents',apps:'Integrations',assistant:'Assistant',settings:'Settings',admin:'Administration',
  subscription:'Subscription',commerce:'Commerce',operator:'Operator',offline:'Offline',design:'Design system',
};

let out=`# Module pages\n\nGenerated from \`docs/design/save/ui/pages-map.js\` by\n\`docs/design/build/make-page-docs.mjs\`. The rail reads the same file, so this page\nand the application cannot disagree. Do not edit by hand.\n\nStates: **built** working screen · **partial** working, covers part of the page ·\n**planned** mapped, not built.\n\n`;

let counts={built:0,partial:0,planned:0};
for (const [id,pages] of Object.entries(map)) {
  out+=`\n## ${titles[id]||id} (${id})\n\n`;
  out+=`| # | Page | State | Specification |\n|---|---|---|---|\n`;
  pages.forEach(([pid,label,spec,state],i)=>{
    counts[state]=(counts[state]||0)+1;
    out+=`| ${i+1} | ${label} \`${pid}\` | ${state} | ${spec} |\n`;
  });
}
const modules=Object.keys(map).length;
const pages=Object.values(map).reduce((n,p)=>n+p.length,0);
out+=`\n---\n\n**${modules} modules · ${pages} pages · ${counts.built} built · ${counts.partial} partial · ${counts.planned} planned.**\n`;
await writeFile(resolve(root,'docs/design/MODULE_PAGES.md'),out);
console.log(`wrote ${modules} modules, ${pages} pages (${counts.built} built, ${counts.partial} partial, ${counts.planned} planned)`);
