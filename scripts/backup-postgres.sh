#!/bin/sh
set -eu
umask 077
directory=/var/backups/saven-testing
database=saven_testing
mkdir -p "$directory"
if [ "$(id -u)" = 0 ]; then chmod 0700 "$directory"; chown root:root "$directory"; fi
exec 9>"$directory/backup.lock"
flock -n 9 || { echo 'A SAVEN backup is already running.' >&2; exit 1; }
file="$directory/saven-testing-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
test ! -e "$file"
if [ "$(id -u)" = 0 ]; then
 runuser -u postgres -- pg_dump --format=custom --no-owner --no-acl --lock-wait-timeout=5s --dbname="$database" > "$file.partial"
else
 pg_dump --format=custom --no-owner --no-acl --lock-wait-timeout=5s --dbname="$database" > "$file.partial"
fi
pg_restore --list "$file.partial" >/dev/null
mv -n "$file.partial" "$file"
(cd "$directory" && sha256sum "$(basename "$file")") >"$file.sha256"
if [ -d /var/lib/saven-testing/objects ]; then
 test "$(id -u)" = 0 || { echo 'Private object backups require the root-owned backup service.' >&2;exit 1; }
 tar --one-file-system -C /var/lib/saven-testing/objects -cf "$file.objects.tar.partial" .
 tar -tf "$file.objects.tar.partial" >/dev/null
 mv -n "$file.objects.tar.partial" "$file.objects.tar"
 (cd "$directory" && sha256sum "$(basename "$file.objects.tar")") >> "$file.sha256"
fi
printf 'complete\n' > "$file.complete"
printf 'BACKUP_OK %s\n' "$file"
# No automatic removal during initial testing. Off-site encrypted storage and a
# reviewed retention policy are required before customer data or an RPO promise.
