#!/bin/sh
set -eu
test -f scripts/backup-postgres.sh
test -f deployment/saven-testing-backup.service
sudo install -d -m 0755 /usr/local/lib/saven-testing
sudo install -d -o postgres -g postgres -m 0700 /var/backups/saven-testing
sudo install -m 0755 scripts/backup-postgres.sh /usr/local/lib/saven-testing/backup.sh
sudo install -m 0644 deployment/saven-testing-backup.service deployment/saven-testing-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now saven-testing-backup.timer
sudo systemctl start saven-testing-backup.service
sudo systemctl status saven-testing-backup.service --no-pager
