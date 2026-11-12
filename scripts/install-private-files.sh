#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'Run this installer through the authorized root operator.' >&2; exit 1; }
test "$(hostname)" = economic-systems-server || { echo 'Unexpected host.' >&2; exit 1; }
existing_memory=$(docker inspect -f '{{if .State.Running}}{{.HostConfig.Memory}}{{else}}0{{end}}' saven-antivirus 2>/dev/null || printf 0)
if [ "$existing_memory" != 3221225472 ]; then
 test "$(awk '/MemAvailable:/{print $2}' /proc/meminfo)" -gt 4500000 || { echo 'At least 4.5 GB of available RAM is required before starting the scanner.' >&2; exit 1; }
fi
test "$(df --output=avail -B1 /var/lib | tail -1 | tr -d ' ')" -gt 5368709120 || { echo 'At least 5 GB of free disk is required.' >&2; exit 1; }
id saven_app >/dev/null
install -d -o saven_app -g saven_app -m 0700 /var/lib/saven-testing /var/lib/saven-testing/objects
install -d -o root -g root -m 0700 /etc/saven-testing
if ! docker network inspect saven-testing-private >/dev/null 2>&1; then docker network create --label saven.service=testing saven-testing-private >/dev/null; fi
test "$(docker network inspect -f '{{index .Labels "saven.service"}}' saven-testing-private)" = testing
if ! docker volume inspect saven-testing-antivirus-db >/dev/null 2>&1; then docker volume create --label saven.service=testing saven-testing-antivirus-db >/dev/null; fi
test "$(docker volume inspect -f '{{index .Labels "saven.service"}}' saven-testing-antivirus-db)" = testing
if docker inspect saven-antivirus >/dev/null 2>&1; then
 test "$(docker inspect -f '{{index .Config.Labels "saven.service"}}' saven-antivirus)" = testing
 case "$(docker inspect -f '{{json .Config.Healthcheck.Test}}' saven-antivirus)" in
  *clamdcheck.sh*) docker stop --time 30 saven-antivirus >/dev/null;docker rename saven-antivirus "saven-antivirus-previous-$(date -u +%Y%m%dT%H%M%SZ)";;
 esac
fi
if ! docker inspect saven-antivirus >/dev/null 2>&1; then
 if [ -r /etc/saven-testing/antivirus-image.txt ]; then digest=$(cat /etc/saven-testing/antivirus-image.txt); else docker pull clamav/clamav:stable_base;digest=$(docker image inspect -f '{{index .RepoDigests 0}}' clamav/clamav:stable_base);fi
 case "$digest" in clamav/clamav@sha256:*) ;; *) echo 'Unexpected scanner image.' >&2; exit 1;; esac
 printf '%s\n' "$digest" > /etc/saven-testing/antivirus-image.txt
 cat > /etc/saven-testing/clamd.conf <<'CONF'
LogFile /tmp/clamd.log
LogTime yes
LogFileMaxSize 1M
LogRotate yes
DatabaseDirectory /var/lib/clamav
LocalSocket /tmp/clamd.sock
FixStaleSocket yes
TCPSocket 3310
TCPAddr 0.0.0.0
User clamav
Foreground yes
MaxThreads 2
StreamMaxLength 12M
MaxScanSize 25M
MaxFileSize 12M
MaxRecursion 12
MaxFiles 1000
AlertExceedsMax yes
ConcurrentDatabaseReload no
CONF
 chmod 0644 /etc/saven-testing/clamd.conf
 docker run -d --name saven-antivirus --label saven.service=testing --restart unless-stopped \
  --network saven-testing-private --memory 3g --memory-swap 3g --cpus 2 --pids-limit 200 \
  --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  -v saven-testing-antivirus-db:/var/lib/clamav \
  -v /etc/saven-testing/clamd.conf:/etc/clamav/clamd.conf:ro \
  --health-cmd 'test "$(printf "PING\n" | nc -w 3 127.0.0.1 3310)" = PONG' --health-interval 15s --health-start-period 120s --health-retries 3 \
  --log-opt max-size=10m --log-opt max-file=3 "$digest"
else
 test "$(docker inspect -f '{{index .Config.Labels "saven.service"}}' saven-antivirus)" = testing
fi
umask 077
printf 'STORAGE_ROOT=/data/objects\nCLAMAV_HOST=saven-antivirus\nCLAMAV_PORT=3310\n' > /etc/saven-testing/runtime.env
for attempt in $(seq 1 90); do
 status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' saven-antivirus)
 if [ "$status" = healthy ]; then printf 'PRIVATE_FILES_READY\n';exit 0;fi
 printf 'SCANNER_STARTING %s\n' "$status"
 sleep 5
done
echo 'The scanner did not become healthy; uploads must remain quarantined.' >&2
exit 1
