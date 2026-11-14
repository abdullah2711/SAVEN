#!/bin/sh
# Root-owned deployment configuration supplies these paths; never put credentials
# or raw backups in the source checkout. Backups require a short maintenance stop.
set -eu
: "${SAVEN_CONTAINER:?}" "${SAVEN_DATA_ROOT:?}" "${SAVEN_BACKUP_ROOT:?}"
[ "$(id -u)" = 0 ] || { echo 'Run through the protected service'; exit 1; }
exec 9>/run/lock/saven-native-backup.lock
flock -n 9 || { echo 'Another native recovery job is running'; exit 1; }
data=$(realpath -e "$SAVEN_DATA_ROOT")
install -d -m 700 "$SAVEN_BACKUP_ROOT"
destination=$(realpath -e "$SAVEN_BACKUP_ROOT")
case "$destination/" in "$data/"*) echo 'Backup destination must be separate from live data'; exit 1;; esac
actual=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$SAVEN_CONTAINER")
[ "$actual" = "$data" ] || { echo 'Container data mount differs from configured source'; exit 1; }
[ "$(find "$destination" -maxdepth 1 -type d -name 'backup-*' | wc -l)" -lt 30 ] || { echo 'Backup retention review required; no existing backup was deleted'; exit 1; }
[ "$(df -Pk "$destination" | awk 'NR==2 {print $4}')" -gt 2097152 ] || { echo 'Insufficient backup disk reserve'; exit 1; }
image=$(docker inspect --format '{{.Image}}' "$SAVEN_CONTAINER")
running=$(docker inspect --format '{{.State.Running}}' "$SAVEN_CONTAINER")
resume() { if [ "$running" = true ]; then docker start "$SAVEN_CONTAINER" >/dev/null; fi; }
trap resume EXIT
trap 'exit 1' HUP INT TERM
if [ "$running" = true ]; then docker stop --time 30 "$SAVEN_CONTAINER" >/dev/null; fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker run --rm --user 0 --read-only --network none --tmpfs /tmp:rw,nosuid,nodev,size=128m \
 -e SAVEN_CONFIRMED_STOPPED=yes -e SAVEN_DATA_DIR=/data -e SAVEN_BACKUP_DIR="/recovery/backup-$stamp" \
 -v "$data:/data" -v "$destination:/recovery" --entrypoint node "$image" scripts/native-backup.mjs
docker run --rm --user 0 --read-only --network none --tmpfs /tmp:rw,nosuid,nodev,size=128m \
 -e SAVEN_BACKUP_DIR="/recovery/backup-$stamp" -e SAVEN_RESTORE_DIR="/recovery/verified-$stamp" \
 -v "$destination:/recovery" --entrypoint node "$image" scripts/native-restore.mjs
echo 'Local backup and independent restore verified; off-host recovery remains a separate gate.'
