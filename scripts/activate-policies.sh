#!/bin/sh
set -eu
test "$(id -u)" = 0
test "$(hostname)" = economic-systems-server
image=${1:?Provide an already verified approval policy image}
case "$image" in saven-testing:policies-*) ;; *) exit 1;; esac
test "$(runuser -u postgres -- psql -X -At -d saven_testing -c 'SELECT max(version) FROM schema_version')" = 9
docker image inspect "$image" >/dev/null
count=$(runuser -u postgres -- psql -X -At -d saven_testing -c "SELECT count(*) FROM documents WHERE company_id='alpha'")
docker stop --time 15 saven-testing-api >/dev/null
trap 'docker start saven-testing-api >/dev/null 2>&1 || true' EXIT
systemctl start saven-testing-backup.service
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d saven_testing < postgresql/012_approval_policies.sql
sh scripts/deploy-server.sh "$image" 10
after=$(runuser -u postgres -- psql -X -At -d saven_testing -c "SELECT count(*) FROM documents WHERE company_id='alpha'")
test "$count" = "$after"
printf 'POLICIES_ACTIVATED schema=10 retained_original_documents=%s\n' "$after"
trap - EXIT
