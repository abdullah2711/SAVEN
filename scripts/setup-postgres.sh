#!/bin/sh
set -eu
# For a new, isolated TESTING database only. Run after reviewing server inventory.
# No TCP exposure, server credential changes or changes to existing databases.
if getent passwd saven_app >/dev/null; then
  echo 'saven_app already exists; inspect it before continuing.' >&2; exit 1
fi
if sudo -u postgres psql -X -Atc "SELECT 1 FROM pg_database WHERE datname='saven_testing'" | grep -q 1; then
  echo 'saven_testing already exists; never initialize over an existing database.' >&2; exit 1
fi
sudo useradd --system --home-dir /opt/saven-testing --create-home --shell /usr/sbin/nologin saven_app
sudo -u postgres createuser --no-superuser --no-createdb --no-createrole saven_app
sudo -u postgres createdb --owner=postgres saven_testing
for file in postgresql/001_schema.sql postgresql/002_controls.sql postgresql/003_runtime.sql postgresql/004_policy_owners.sql; do
  sudo -u postgres psql -X --set ON_ERROR_STOP=1 -d saven_testing < "$file"
done
echo 'Initialized PostgreSQL testing database with a non-owner peer-auth runtime role.'
