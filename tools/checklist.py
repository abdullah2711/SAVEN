"""Small resumable actions. Example: python tools/checklist.py ACCOUNTING004 source-tested --evidence tests/native-documents.test.mjs"""
import argparse
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'contracts/delivery-checklist.json'
STATUSES = ('todo', 'in-progress', 'source-tested', 'browser-tested', 'released', 'blocked')

def render(data):
    tasks = data['tasks']
    assert len({x['id'] for x in tasks}) == len(tasks), 'Duplicate task identity'
    lines = ['# Small-action delivery checklist', '',
             'Current scope: [owner revision](48-accounting-first-owner-revision.md). Exact source/live checkpoint: [CURRENT_HANDOFF.md](CURRENT_HANDOFF.md).', '',
             'Generated from contracts/delivery-checklist.json. Update one action with tools/checklist.py. Source-tested and browser-tested do not mean released. No full-module completion is claimed.', '']
    for area in dict.fromkeys(t['area'] for t in tasks):
        lines += ['## ' + area, '', '| ID | Action | State | Evidence / limit |', '| --- | --- | --- | --- |']
        for item in (t for t in tasks if t['area'] == area):
            assert item['status'] in STATUSES
            assert item['status'] not in ('source-tested','browser-tested','released') or item['evidence'], item['id']+' needs evidence'
            for evidence in item['evidence']:
                assert (ROOT/evidence).is_file(), 'Missing evidence '+evidence
            detail = '; '.join(item['evidence'] + ([item['note']] if item['note'] else []))
            lines.append(f"| {item['id']} | {item['title']} | {item['status']} | {detail.replace('|','/')} |")
        lines.append('')
    return '\n'.join(lines)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('id', nargs='?')
    parser.add_argument('status', nargs='?', choices=STATUSES)
    parser.add_argument('--evidence', action='append', default=[])
    parser.add_argument('--note', default='')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.loads(PATH.read_text(encoding='utf-8'))
    if args.id:
        parser.error('ID and status are both required') if not args.status else None
        item = next((t for t in data['tasks'] if t['id'] == args.id), None)
        if not item: parser.error('Unknown task ID')
        item.update(status=args.status, evidence=args.evidence, note=args.note)
    output = render(data)
    target = ROOT/'docs/TASKS.md'
    if args.check:
        assert target.read_text(encoding='utf-8') == output, 'Checklist view is stale'
    else:
        if args.id: PATH.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
        target.write_text(output,encoding='utf-8')
    counts = {s:sum(t['status']==s for t in data['tasks']) for s in STATUSES}
    print(json.dumps({'actions':len(data['tasks']),'states':counts}))

if __name__ == '__main__': main()
