#!/usr/bin/env bash
# Daily backup of Arscio: the whole database (every school, including uploaded photos and
# documents, which are stored inside the database). Runs every night by itself
# (the "arscio-backup" timer, set up by setup-arscio.sh). Can also be run by hand:
#   sudo /opt/arscio/arscio-backup.sh
#
# Keeps the last 14 daily backups in /var/backups/arscio and writes last-backup.json,
# which the control panel shows (when, worked or not, size).
#
# To restore a backup (this REPLACES all current data):
#   sudo systemctl stop arscio-api arscio-web arscio-control
#   sudo -u postgres pg_restore --clean --if-exists -d arscio /var/backups/arscio/arscio-YYYY-MM-DD.dump
#   sudo systemctl start arscio-api arscio-web arscio-control
set -uo pipefail

DIR=${BACKUP_DIR:-/var/backups/arscio}
KEEP=${BACKUP_KEEP:-14}
STAMP=$(TZ=Asia/Kolkata date +%F)
FILE="$DIR/arscio-$STAMP.dump"
STATUS="$DIR/last-backup.json"

mkdir -p "$DIR"; chown root:arscio "$DIR"; chmod 750 "$DIR"

write_status() { # ok, error
  local err=${2:-}; local size=null
  [ -f "$FILE" ] && size=$(du -m "$FILE" | cut -f1)
  printf '{"at":"%s","ok":%s,"file":"%s","sizeMb":%s,"error":%s}\n' \
    "$(date -u +%FT%TZ)" "$1" "$(basename "$FILE")" "$size" \
    "$( [ -n "$err" ] && printf '"%s"' "$(echo "$err" | tr -d '"\\' | tr '\n' ' ' | cut -c1-300)" || echo null )" > "$STATUS"
  chown root:arscio "$STATUS"; chmod 640 "$STATUS"
}

# Is there enough free space? (need at least twice the database size)
DB_MB=$(runuser -u postgres -- psql -qtAc "SELECT pg_database_size('arscio')/1048576" 2>/dev/null || echo 0)
FREE_MB=$(df -Pm "$DIR" | awk 'NR==2 {print $4}')
if [ "$FREE_MB" -lt $(( DB_MB * 2 + 200 )) ]; then
  write_status false "Not enough free disk space for the backup (${FREE_MB} MB free)."
  echo "Backup skipped: not enough disk space" >&2; exit 1
fi

TMP="$FILE.part"
if ERR=$(runuser -u postgres -- pg_dump --format=custom --compress=6 arscio 2>&1 > "$TMP"); then
  mv "$TMP" "$FILE"; chown root:arscio "$FILE"; chmod 640 "$FILE"
  # Check the backup can be read back
  if ! pg_restore --list "$FILE" >/dev/null 2>&1; then
    write_status false "The backup file was made but could not be read back."; exit 1
  fi
  write_status true
  # Keep only the newest $KEEP backups
  ls -1t "$DIR"/arscio-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
  echo "Backup done: $FILE ($(du -h "$FILE" | cut -f1))"
else
  rm -f "$TMP"; write_status false "$ERR"
  echo "Backup FAILED: $ERR" >&2; exit 1
fi
