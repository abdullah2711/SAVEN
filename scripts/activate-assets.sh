#!/bin/sh
set -eu
test "$(id -u)" = 0
test "$(hostname)" = economic-systems-server
image=${1:?Provide an already verified fixed assets image}
case "$image" in saven-testing:assets-*) ;; *) exit 1;; esac
test "$(runuser -u postgres -- psql -X -At -d saven_testing -c 'SELECT max(version) FROM schema_version')" = 12
docker image inspect "$image" >/dev/null
count=$(runuser -u postgres -- psql -X -At -d saven_testing -c "SELECT count(*) FROM documents WHERE company_id='alpha'")
docker stop --time 15 saven-testing-api >/dev/null
trap 'docker start saven-testing-api >/dev/null 2>&1 || true' EXIT
systemctl start saven-testing-backup.service
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d saven_testing < postgresql/015_fixed_assets.sql
sh scripts/deploy-server.sh "$image" 13
after=$(runuser -u postgres -- psql -X -At -d saven_testing -c "SELECT count(*) FROM documents WHERE company_id='alpha'")
test "$count" = "$after"
printf 'ASSETS_ACTIVATED schema=13 retained_original_documents=%s\n' "$after"
trap - EXIT
