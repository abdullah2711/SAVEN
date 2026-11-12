#!/bin/sh
set -eu
test "$(id -u)" = 0
test "$(hostname)" = economic-systems-server
database=${1:?Use a NEW saven_restore_* database}
case "$database" in saven_restore_*) ;; *) exit 1;; esac
case "$database" in *[!a-zA-Z0-9_]*) exit 1;; esac
marker=$(ls -1t /var/backups/saven-testing/*.dump.complete | head -1)
test -s "$marker"
backup=${marker%.complete}
test -s "$backup.objects.tar"
(cd /var/backups/saven-testing && sha256sum -c "$(basename "$backup.sha256")")
runuser -u postgres -- createdb "$database"
runuser -u postgres -- pg_restore --exit-on-error --no-owner --no-acl -d "$database" < "$backup"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d "$database" < postgresql/003_runtime.sql
target="/var/lib/saven-testing/restore-$database"
test ! -e "$target"
install -d -o root -g root -m 0700 "$target"
python3 - "$backup.objects.tar" "$target" <<'PY'
import sys,tarfile
from pathlib import Path
root=Path(sys.argv[2]).resolve()
assert root.parent==Path('/var/lib/saven-testing') and root.name.startswith('restore-saven_restore_')
with tarfile.open(sys.argv[1]) as archive:
    archive.extractall(root,filter='data')
PY
umask 077
metadata="var/$database-files.json"
runuser -u postgres -- psql -X -At -v ON_ERROR_STOP=1 -d "$database" -c "SELECT coalesce(json_agg(json_build_object('company_id',company_id,'id',id,'sha256',sha256,'byte_size',byte_size)),'[]'::json) FROM stored_files WHERE scan_state='clean'" > "$metadata"
python3 scripts/verify-restored-objects.py "$metadata" "$target"
runuser -u postgres -- psql -X -At -v ON_ERROR_STOP=1 -d "$database" -c "SELECT 'RESTORED_SCHEMA='||max(version) FROM schema_version; SELECT 'UNBALANCED_JOURNALS='||count(*) FROM(SELECT j.id FROM journals j JOIN journal_lines l ON l.company_id=j.company_id AND l.journal_id=j.id WHERE j.status='posted' GROUP BY j.id HAVING sum(l.debit_minor)!=sum(l.credit_minor)) q; SET ROLE saven_app; SELECT 'UNSCOPED_COMPANIES='||count(*) FROM companies;"
printf 'RECOVERY_REHEARSAL_OK %s\n' "$database"
