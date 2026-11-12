#!/bin/sh
set -eu
umask 077
directory=/var/backups/saven-testing
database=saven_testing
mkdir -p "$directory"
exec 9>"$directory/backup.lock"
flock -n 9 || { echo 'A SAVEN backup is already running.' >&2; exit 1; }
file="$directory/saven-testing-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
test ! -e "$file"
pg_dump --format=custom --no-owner --no-acl --lock-wait-timeout=5s --dbname="$database" --file="$file.partial"
pg_restore --list "$file.partial" >/dev/null
mv -n "$file.partial" "$file"
(cd "$directory" && sha256sum "$(basename "$file")") >"$file.sha256"
printf 'BACKUP_OK %s\n' "$file"
# No automatic removal during initial testing. Off-site encrypted storage and a
# reviewed retention policy are required before customer data or an RPO promise.
