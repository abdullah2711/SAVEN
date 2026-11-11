"""Validate planning consistency without implying that product functionality exists."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def validate():
    data=json.loads((ROOT/'docs/feature-catalog.json').read_text(encoding='utf-8'))
    rows=data['requirements']
    ids=[r['id'] for r in rows]
    assert len(ids)==len(set(ids)), 'Duplicate requirement ID'
    assert len(rows)>=180, 'Unexpected scope reduction'
    known=set(ids)
    graph={r['id']:r['dependencies'] for r in rows}
    for r in rows:
        assert r['status'] in {'specified','in progress','implemented','verified','released','changed'}, 'Unknown requirement status'
        if r['status'] in {'verified','released'}:
            assert r['evidence'], f'Missing completion evidence in {r["id"]}'
        assert r['commercial_release']=='required', 'Unexpected release-scope change'
        for k in ('id','family','title','supported_scope','acceptance'):
            assert r[k].strip(), f'Missing {k}'
        assert set(r['dependencies'])<=known, f'Unknown dependency in {r["id"]}'
    def visit(k,path):
        assert k not in path, f'Dependency cycle: {path+[k]}'
        for child in graph[k]: visit(child,path+[k])
    for k in graph: visit(k,[])
    for file in ROOT.rglob('*.md'):
        text=file.read_text(encoding='utf-8')
        for match in re.finditer(r'\[[^\]]+\]\(([^)]+)\)',text):
            link=match.group(1)
            if not link.startswith(('https:','http:','#')):
                assert (file.parent/link.split('#')[0]).exists(), f'Broken link {link} in {file}'
        for rid in re.findall(r'\b(?:FND|ACC|SAL|PUR|POS|INV|AST|MFG|HR|PRJ|FIN|TAX|RPT|CFG|DOC|APP|AI|OPS|SEC|UX)-\d{3}\b',text):
            assert rid in known, f'Unknown requirement reference {rid}'
    print(f'PASS: {len(rows)} unique specified requirements, {len(set(r["family"] for r in rows))} families, dependencies, scope, references and local links')

if __name__=='__main__': validate()

