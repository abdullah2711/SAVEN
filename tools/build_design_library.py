"""Generate auditable design coverage, not claims of implemented workflow depth."""
import json,re,hashlib
from design_contracts import contracts
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MODULES=[('accounting','Accounting','Books & money','ACC','Chart, journals, ledger and close'),('banking','Cash & bank','Books & money','','Cash books, statements and matching'),('payments','Payments','Books & money','','Receipts, allocations, advances and refunds'),('sales','Sales','Books & money','SAL','Quotes to invoices and collections'),('purchases','Purchases','Books & money','PUR','Orders, receipts, bills and matching'),('tax','Taxes','Books & money','TAX','Tax profiles, withholding and workpapers'),('inventory','Inventory','Operations','INV','Stock, stores, movements and valuation'),('manufacturing','Manufacturing','Operations','MFG','Recipes, production, WIP and costing'),('pos','Point of sale','Operations','POS','Fast checkout, shifts and returns'),('assets','Assets','Operations','AST','Acquisition, depreciation and custody'),('people','HR & payroll','Operations','HR','People, attendance, payroll and settlement'),('projects','Projects & CRM','Operations','PRJ','Leads, projects, commitments and billing'),('finance','Finance','Insights','FIN','Liquidity, budgets and scenarios'),('reports','Reports & BI','Insights','RPT','Statements, notes and governed dashboards'),('drive','Company Drive','Workspace','DOC','Evidence, folders, retention and sharing'),('apps','Apps & integrations','Workspace','APP','Scoped connectors and devices'),('assistant','AI assistant','Workspace','AI','Permissioned tools, evidence and budgets'),('settings','Workspace settings','Workspace','FND,CFG','Business setup, roles and workflows'),('admin','Operator administration','Platform','OPS,SEC','Onboarding, subscriptions, fleet and recovery'),('offline','Offline companion','Platform','','Scoped continuity, sync and conflicts'),('design','Design coverage','Platform','UX','Requirements, workflow states and review')]
EXTRA={'banking':['ACC-006','ACC-007'],'payments':['ACC-006','SAL-007','PUR-007'],'offline':['OPS-018','POS-007','POS-008']}
INTERACTIVE={'accounting':'ACC-003','banking':'ACC-006','payments':'SAL-007','sales':'SAL-003','purchases':'PUR-004','tax':'TAX-003','inventory':'INV-003','manufacturing':'MFG-004','pos':'POS-001','assets':'AST-003'}
PRIORITY={'accounting','banking','payments','sales','purchases','tax','inventory','manufacturing','pos','assets'}
def build():
 data=json.loads((ROOT/'docs/feature-catalog.json').read_text(encoding='utf-8'));rows=data['requirements'];modules=[];screens=[]
 for mid,title,group,prefixes,description in MODULES:
  selected=[r for r in rows if r['id'].split('-')[0] in prefixes.split(',') or r['id'] in EXTRA.get(mid,[])]
  modules.append(dict(id=mid,title=title,group=group,description=description,requirements=[r['id'] for r in selected],interactive=mid in PRIORITY))
  for r in selected:
   screens.append(dict(id=f"{mid}/{r['id']}",requirement=r['id'],module=mid,title=r['title'],route=f"/design/index.html#module={mid}&screen={r['id']}",designStatus='interactive draft' if INTERACTIVE.get(mid)==r['id'] else 'specification brief',backendStatus=r['status'],contract=f"design.{mid}.{r['id'].lower()}.v1",approval='NOT_APPROVED',fieldsContract='module editor plus requirement-specific scope; see design brief',states=['sample','empty','loading','denied','validation','stale','review','offline','conflict','suspended','queued','unsaved','partial-failure'],permissionContract='authority.v1',financialContract='posting.v1'))
 covered={s['requirement'] for s in screens};assert covered=={r['id'] for r in rows}
 result=dict(version=1,governingMandate='v2.3',dataMode='SYNTHETIC_DESIGN_ONLY',ownerApproval=None,modules=modules,requirements=[{k:r[k] for k in ['id','family','title','supported_scope','acceptance','status']} for r in rows],screens=[{k:s[k] for k in ['requirement','module','contract','designStatus']} for s in screens],workflowContracts=contracts())
 target=ROOT/'public/design';target.mkdir(parents=True,exist_ok=True)
 (target/'catalog.js').write_text('export const catalog='+json.dumps(result,ensure_ascii=True,separators=(',',':'))+';\n',encoding='utf-8')
 (ROOT/'docs/workflow-contracts-v1.json').write_text(json.dumps(contracts(),indent=2)+'\n',encoding='utf-8')
 (ROOT/'docs/ui-screen-inventory.json').write_text(json.dumps(dict(version=1,coverage=len(covered),screens=screens),indent=2)+'\n',encoding='utf-8')
 objects=[]
 for p in sorted((ROOT/'postgresql').glob('*.sql')):
  sql=p.read_text(encoding='utf-8');entry=dict(path=p.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(sql.encode('utf-8')).hexdigest(),digestFormat='UTF-8 LF-normalized source',inspection='static source inventory; dynamic objects require database introspection')
  for name,pattern in [('tables',r'CREATE TABLE(?: IF NOT EXISTS)?\s+([\w.]+)'),('functions',r'CREATE(?: OR REPLACE)? FUNCTION\s+([\w.]+)'),('triggers',r'CREATE(?: CONSTRAINT)? TRIGGER\s+([\w.]+)'),('policies',r'CREATE POLICY\s+([\w.]+)')]:entry[name]=re.findall(pattern,sql,re.I)
  entry['replacementContract']='docs/29-tenant-sqlite-and-fleet-migrations.md';objects.append(entry)
 (ROOT/'docs/postgres-reference-inventory.json').write_text(json.dumps(objects,indent=2)+'\n',encoding='utf-8')
 print(f'DESIGN COVERAGE: {len(covered)} requirements, {len(modules)} modules, {len(screens)} screen mappings; no approval or implementation completion implied.')
if __name__=='__main__':build()
