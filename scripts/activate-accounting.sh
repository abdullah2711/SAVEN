#!/bin/sh
set -eu
test "$(id -u)" = 0
test "$(hostname)" = economic-systems-server
image=${1:?Provide the already verified saven-testing image}
case "$image" in saven-testing:accounting-*) ;; *) exit 1;; esac
test "$(runuser -u postgres -- psql -X -At -d saven_testing -c 'SELECT max(version) FROM schema_version')" = 5
docker image inspect "$image" >/dev/null
count=$(runuser -u postgres -- psql -X -At -d saven_testing -c "SELECT count(*) FROM documents WHERE company_id='alpha'")
docker stop --time 15 saven-testing-api >/dev/null
trap 'docker start saven-testing-api >/dev/null 2>&1 || true' EXIT
systemctl start saven-testing-backup.service
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d saven_testing < postgresql/008_accounting_workspace.sql
sh scripts/deploy-server.sh "$image" 6
after=$(runuser -u postgres -- psql -X -At -d saven_testing -c "SELECT count(*) FROM documents WHERE company_id='alpha'")
test "$count" = "$after"
printf 'ACCOUNTING_ACTIVATED schema=6 retained_original_documents=%s\n' "$after"
trap - EXIT
