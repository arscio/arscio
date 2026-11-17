#!/usr/bin/env bash
# Removes Arscio from this server completely. Curavo is not touched.
#   sudo ./remove-arscio.sh
set -euo pipefail
CADDY=/etc/caddy/Caddyfile
[ "$(id -u)" = 0 ] || { echo "Please run with sudo"; exit 1; }
echo "This deletes Arscio's program, its database (ALL school data) and its settings from this server."
read -r -p "Type DELETE to continue: " ans; [ "$ans" = DELETE ] || { echo "Stopped. Nothing was changed."; exit 0; }

echo "1. Removing the Arscio addresses from Caddy"
if grep -q '^# >>> ARSCIO' "$CADDY"; then
  cp -a "$CADDY" "$CADDY.before-arscio-removal.$(date +%Y%m%d-%H%M%S)"
  TMP=$(mktemp /etc/caddy/.Caddyfile.arscio-XXXXXX)
  sed '/^# >>> ARSCIO/,/^# <<< ARSCIO/d' "$CADDY" > "$TMP"
  if caddy validate --adapter caddyfile --config "$TMP" >/dev/null 2>&1; then cat "$TMP" > "$CADDY"; systemctl reload caddy; echo "   done"
  else echo "   Caddy didn't accept the change; left as it was. Remove the ARSCIO lines by hand."; fi
  rm -f "$TMP"
fi

echo "2. Stopping and removing the Arscio services"
systemctl disable --now arscio-api arscio-web arscio-control arscio-backup.timer 2>/dev/null || true
rm -f /etc/systemd/system/arscio-api.service /etc/systemd/system/arscio-web.service /etc/systemd/system/arscio-control.service \
      /etc/systemd/system/arscio-backup.service /etc/systemd/system/arscio-backup.timer
systemctl daemon-reload

echo "3. Deleting the Arscio database"
if command -v psql >/dev/null; then
  runuser -u postgres -- psql -q -c "DROP DATABASE IF EXISTS arscio WITH (FORCE)" || true
  runuser -u postgres -- psql -q -c "DROP ROLE IF EXISTS arscio_app" -c "DROP ROLE IF EXISTS arscio_owner" || true
fi
read -r -p "Also uninstall PostgreSQL itself? Only say yes if nothing else on this server uses it (Curavo doesn't). [yes/no] " pg
if [ "$pg" = yes ]; then
  systemctl disable --now postgresql@16-main 2>/dev/null || true
  DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq 'postgresql*' >/dev/null || true
  rm -rf /etc/systemd/system/postgresql@16-main.service.d /var/lib/postgresql /etc/postgresql
else
  rm -f /etc/postgresql/16/main/conf.d/arscio.conf
fi

read -r -p "Also delete the nightly backups in /var/backups/arscio? (Say no to keep a copy.) [yes/no] " bk
[ "$bk" = yes ] && rm -rf /var/backups/arscio

echo "4. Deleting Arscio files, settings and user"
rm -rf /opt/arscio /etc/arscio.env
userdel arscio 2>/dev/null || true
echo "Arscio has been removed. Curavo service is: $(systemctl is-active curavo-cloud 2>/dev/null || echo 'not found')"
