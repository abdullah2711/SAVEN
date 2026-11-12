#!/bin/sh
set -eu
image=${1:?Usage: sh scripts/deploy-server.sh saven-testing:tag schema-version}
schema=${2:?Provide the required schema version}
case "$image" in saven-testing:*) ;; *) echo 'Refusing an unrelated image.' >&2; exit 1;; esac
case "$schema" in ''|*[!0-9]*) echo 'Invalid schema version.' >&2; exit 1;; esac
current=$(sudo docker inspect -f '{{.Config.Image}}' saven-testing-api)
label=$(sudo docker inspect -f '{{index .Config.Labels "saven.service"}}' saven-testing-api)
if [ "$label" != testing ] && [ "$current" != saven-testing:pg-20261112 ]; then
  echo 'The existing container is not the known SAVEN testing service.' >&2; exit 1
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
previous="saven-testing-api-previous-$stamp"
set --
if [ "$schema" -ge 5 ]; then
 test -r /etc/saven-testing/runtime.env || { echo 'Install private file services before deploying schema 5.' >&2;exit 1; }
 test -d /var/lib/saven-testing/objects
 set -- --network saven-testing-private --env-file /etc/saven-testing/runtime.env -v /var/lib/saven-testing/objects:/data/objects
fi
sudo docker stop --time 15 saven-testing-api >/dev/null
sudo docker rename saven-testing-api "$previous"
started=0
if sudo docker run -d --name saven-testing-api --label saven.service=testing --restart unless-stopped \
 --user "$(id -u saven_app):$(id -g saven_app)" --read-only --cap-drop ALL --security-opt no-new-privileges \
 --pids-limit 128 --memory 768m --cpus 1 --tmpfs /tmp:rw,noexec,nosuid,size=64m \
 -v /var/run/postgresql:/var/run/postgresql:ro -p 127.0.0.1:8788:8788 \
 --log-opt max-size=10m --log-opt max-file=3 \
 -e PUBLIC_ORIGIN=https://saventesting.economicsystems.cc \
 -e ADDITIONAL_ORIGINS=https://saventesting.economicsystemsglobal.com "$@" "$image"; then
 for attempt in 1 2 3 4 5 6 7 8 9 10; do
  health=$(curl --silent --show-error --max-time 3 http://127.0.0.1:8788/api/health || true)
  if printf '%s' "$health" | grep -q '"schemaReady":true' && printf '%s' "$health" | grep -Eq '"schemaVersion":'"$schema"'[,}]'; then started=1;break;fi
  sleep 1
 done
fi
if [ "$started" = 1 ]; then printf 'DEPLOYED %s; rollback container %s\n' "$image" "$previous";exit 0;fi
echo 'New application did not become ready; restoring the previous container.' >&2
if sudo docker inspect saven-testing-api >/dev/null 2>&1;then
 sudo docker stop --time 10 saven-testing-api >/dev/null || true
 sudo docker rename saven-testing-api "saven-testing-api-failed-$stamp"
fi
sudo docker rename "$previous" saven-testing-api
sudo docker start saven-testing-api >/dev/null
exit 1
