#!/bin/sh
set -eu
image=${1:?Provide the testing image tag}
database=${2:?Provide a new saven_contract_* database}
case "$image" in saven-testing:*) ;; *) exit 1;; esac
case "$database" in saven_contract_*) ;; *) exit 1;; esac
case "$database" in *[!a-zA-Z0-9_]*) exit 1;; esac
docker build -f Dockerfile.postgres -t "$image" .
runuser -u postgres -- createdb "$database"
docker run --rm --user "$(id -u postgres):$(id -g postgres)" \
 -e CONTRACT_DATABASE="$database" -v /var/run/postgresql:/var/run/postgresql:ro "$image" \
 sh -c 'node scripts/verify-postgres.mjs --initialize && node scripts/verify-operating.mjs --migrate && node scripts/verify-accounting-cycles.mjs --migrate && node scripts/verify-services.mjs --migrate && node scripts/verify-accounting-workspace.mjs --migrate'
