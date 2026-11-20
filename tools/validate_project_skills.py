"""Check committed project skill provenance, entry points, references and exact bytes."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / '.agents/skill-files.json').read_text(encoding='utf-8'))
sources = json.loads((ROOT / '.agents/skill-sources.json').read_text(encoding='utf-8'))
assert len(sources['pins']) == 5
for source in sources['pins']:
    assert re.fullmatch(r'[a-f0-9]{40}', source['commit'])
actual = {p.relative_to(ROOT).as_posix() for p in (ROOT / '.agents/skills').rglob('*') if p.is_file()}
expected = {item['path'] for item in manifest['files']}
assert actual == expected, 'Skill file inventory differs; review upstream update deliberately'
for item in manifest['files']:
    data = (ROOT / item['path']).read_bytes()
    if Path(item['path']).suffix.lower() not in ['.jpg','.jpeg','.png','.webp','.ico','.pdf']: data = data.replace(b'\r\n',b'\n')
    assert hashlib.sha256(data).hexdigest() == item['sha256'], item['path']
guides = list((ROOT / '.agents/skills').glob('*/SKILL.md'))
assert len(guides) == 18
for guide in guides:
    text = guide.read_text(encoding='utf-8')
    assert text.startswith('---\n') or text.startswith('---\r\n'), guide
    frontmatter = text.split('---', 2)[1]
    assert re.search(r'^name:\s*\S', frontmatter, re.M), guide
    assert re.search(r'^description:\s*\S', frontmatter, re.M), guide
    assert (guide.parent / 'LICENSE').is_file(), guide
    for target in re.findall(r'\]\(([^)]+)\)', text):
        target = target.split('#')[0]
        if target and ':' not in target and '<' not in target and not target.startswith('/'):
            assert (guide.parent / target).exists(), (guide, target)
print(f'PASS: {len(guides)} skill entry points, {len(sources["pins"])} source pins and {len(expected)} exact files; not a full upstream or visual audit')
