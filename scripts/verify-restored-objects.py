"""Verify clean PostgreSQL file metadata against a separately restored bucket."""
import argparse,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('metadata');p.add_argument('directory');args=p.parse_args()
root=Path(args.directory).resolve();rows=json.loads(Path(args.metadata).read_text())
for row in rows:
    target=(root/row['company_id']/row['id']/row['sha256']).resolve()
    assert target.is_relative_to(root) and target.is_file(), 'Missing retained object'
    assert target.stat().st_size==row['byte_size'], 'Object size mismatch'
    assert hashlib.sha256(target.read_bytes()).hexdigest()==row['sha256'], 'Object checksum mismatch'
print(f'RESTORED_OBJECTS_VERIFIED {len(rows)}')
