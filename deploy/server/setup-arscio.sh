#!/usr/bin/env bash
# Installs (or updates) Arscio on this server, next to Curavo, without touching Curavo.
#
#   sudo ./setup-arscio.sh                        first install (with a demo school), or update the code (keeps all data)
#   sudo ./setup-arscio.sh --reset-demo           wipe Arscio's data and rebuild the demo school
#   sudo ./setup-arscio.sh --start-real           wipe the demo and start for real: no demo data, logins by
#                                                password (no SMS). Schools are then added in the control panel.
#   sudo ./setup-arscio.sh --domain arscio.in     use app.arscio.in (website) and api.arscio.in (apps) instead
#                                                of the temporary sslip.io addresses (set up the DNS first)
#   sudo ./setup-arscio.sh --new-control-password make a new control panel password
#
# What it adds:  /opt/arscio (program), /etc/arscio.env (secrets), Linux user "arscio",
# services arscio-api, arscio-web and arscio-control (with memory limits), PostgreSQL 16 for
# Arscio's database, a nightly backup (arscio-backup timer, kept in /var/backups/arscio),
# and two site entries in Caddy between "# >>> ARSCIO" and "# <<< ARSCIO".
# To remove all of it:  sudo ./remove-arscio.sh
set -euo pipefail

API_PORT=4100; WEB_PORT=4101; CONTROL_PORT=4102
APP=/opt/arscio; ENVF=/etc/arscio.env; CADDY=/etc/caddy/Caddyfile; BACKUPS=/var/backups/arscio
HERE="$(cd "$(dirname "$0")" && pwd)"
RESET=0; REAL=0; DOMAIN=""; NEWCTL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --reset-demo) RESET=1 ;;
    --start-real) REAL=1 ;;
    --domain) DOMAIN="${2:-}"; shift ;;
    --new-control-password) NEWCTL=1 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done
[ $RESET = 1 ] && [ $REAL = 1 ] && { echo "Choose either --reset-demo or --start-real, not both."; exit 1; }
say() { printf "\n\033[1;36m== %s\033[0m\n" "$1"; }
ok() { printf "   \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "\n\033[1;31mStopped: %s\033[0m\n" "$1"; exit 1; }
warn() { printf "   \033[33m!\033[0m %s\n" "$1"; }

# ---------------------------------------------------------------- checks
say "1. Checking this server (nothing is changed yet)"
[ "$(id -u)" = 0 ] || fail "Please run with sudo:  sudo ./setup-arscio.sh"
[ -d "$HERE/app/apps/api" ] && [ -d "$HERE/web" ] || fail "Run this from inside the unpacked arscio-test folder."
. /etc/os-release; [ "$ID" = ubuntu ] || fail "This script is written for Ubuntu."
case "$(uname -m)" in aarch64) NARCH=arm64 ;; x86_64) NARCH=x64 ;; *) fail "Unknown processor type $(uname -m)" ;; esac
[ -f "$CADDY" ] || fail "Caddy's settings file $CADDY was not found."
command -v caddy >/dev/null || fail "Caddy is not installed."
for p in $API_PORT $WEB_PORT $CONTROL_PORT; do
  line=$(ss -ltnp "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*",pid=[0-9]*' | head -1 || true)
  [ -n "$line" ] || continue
  owner=$(echo "$line" | cut -d'"' -f2); pid=${line##*pid=}
  # Arscio's own services (from an earlier install) are fine: this run updates them.
  grep -q 'arscio-' "/proc/$pid/cgroup" 2>/dev/null && continue
  fail "Port $p is already used by another program ($owner)."
done
AVAIL_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$AVAIL_MB" -ge 600 ] || fail "Only ${AVAIL_MB} MB of memory is free; Arscio needs about 600 MB."
IP=$(curl -fsS --max-time 5 https://checkip.amazonaws.com || true); IP=${ARSCIO_IP:-$IP}
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Could not find this server's public address. Run again with ARSCIO_IP=1.2.3.4"
DASH=${IP//./-}; WEB_HOST="arscio.$DASH.sslip.io"; API_HOST="arscio-api.$DASH.sslip.io"
# Keep the addresses chosen earlier (e.g. a real domain) unless a new --domain is given
if [ -f "$ENVF" ] && [ -z "$DOMAIN" ]; then
  OLD_WEB=$(sed -n 's/^WEB_HOST=//p' "$ENVF"); OLD_API=$(sed -n 's/^API_HOST=//p' "$ENVF")
  [ -n "$OLD_WEB" ] && WEB_HOST=$OLD_WEB; [ -n "$OLD_API" ] && API_HOST=$OLD_API
fi
if [ -n "$DOMAIN" ]; then
  [[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || fail "The domain should look like arscio.in"
  WEB_HOST="app.$DOMAIN"; API_HOST="api.$DOMAIN"
  for h in $WEB_HOST $API_HOST; do
    got=$(getent ahostsv4 "$h" | awk 'NR==1 {print $1}' || true)
    [ "$got" = "$IP" ] || fail "$h does not point to this server yet (it points to '${got:-nothing}', this server is $IP).
   At your domain company (Hostinger), add two DNS records of type A: 'app' and 'api', both with the value $IP. Wait 10-30 minutes and run again."
  done
  ok "$WEB_HOST and $API_HOST point to this server"
fi
if [ $REAL = 1 ]; then
  echo
  echo "   --start-real DELETES all Arscio data on this server (the demo school, test logins, everything)"
  echo "   and starts empty, ready for real schools. Curavo is not touched."
  read -r -p "   Type START to continue: " ans; [ "$ans" = START ] || fail "Stopped. Nothing was changed."
fi
ok "Ubuntu $VERSION_ID on $(uname -m), ${AVAIL_MB} MB memory free, public address $IP"
CURAVO_BEFORE=$(systemctl is-active curavo-cloud 2>/dev/null || true)
ok "Curavo service is: ${CURAVO_BEFORE:-not found}"

# A 2 GB swap file: a cushion so a busy moment (results day, 900 families at once) slows down instead of
# crashing. Only added if the server has no swap yet; Curavo is unaffected.
if [ "$(swapon --show --noheadings | wc -l)" = 0 ]; then
  if [ "$(df --output=avail -m / | tail -1)" -gt 6000 ]; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo 'vm.swappiness=10' > /etc/sysctl.d/90-arscio-swap.conf && sysctl -q -p /etc/sysctl.d/90-arscio-swap.conf
    ok "Added a 2 GB swap file (safety cushion for memory)"
  else
    warn "Not enough free disk for a swap file; enlarge the disk first (see README)"
  fi
else
  ok "Swap already present: $(swapon --show --noheadings | awk '{print $3}' | head -1)"
fi

# ---------------------------------------------------------------- Node.js (private copy, only for Arscio)
say "2. Node.js 22 (installed only inside $APP, not system-wide)"
mkdir -p "$APP"
if ! "$APP/node/bin/node" -v 2>/dev/null | grep -q '^v22\.'; then
  BASE=https://nodejs.org/dist/latest-v22.x
  FILE=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk -v a="linux-$NARCH.tar.xz" '$2 ~ a"$" {print $2}')
  SUM=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk -v f="$FILE" '$2==f {print $1}')
  [ -n "$FILE" ] || fail "Could not find Node.js 22 for $NARCH."
  curl -fsSL "$BASE/$FILE" -o /tmp/node.tar.xz
  echo "$SUM  /tmp/node.tar.xz" | sha256sum -c --quiet || fail "Node.js download was damaged; run again."
  rm -rf "$APP/node"; mkdir -p "$APP/node"; tar -xJf /tmp/node.tar.xz -C "$APP/node" --strip-components=1; rm /tmp/node.tar.xz
fi
NODE="$APP/node/bin/node"; ok "Node $("$NODE" -v)"

# ---------------------------------------------------------------- PostgreSQL
say "3. PostgreSQL 16 (only listens inside this server)"
if ! command -v pg_lsclusters >/dev/null || ! pg_lsclusters -h | grep -q '^16 '; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16 >/dev/null
fi
cat > /etc/postgresql/16/main/conf.d/arscio.conf <<'CONF'
# Small settings so the database stays light on this shared server (added by setup-arscio.sh)
listen_addresses = 'localhost'
max_connections = 30
shared_buffers = 64MB
work_mem = 2MB
maintenance_work_mem = 32MB
effective_cache_size = 256MB
CONF
mkdir -p /etc/systemd/system/postgresql@16-main.service.d
cat > /etc/systemd/system/postgresql@16-main.service.d/arscio-limits.conf <<'CONF'
[Service]
MemoryHigh=220M
MemoryMax=280M
CONF
systemctl daemon-reload
systemctl enable -q postgresql@16-main
systemctl restart postgresql@16-main
for i in $(seq 1 30); do pg_isready -q -h localhost && break; sleep 1; done
ok "PostgreSQL $(pg_lsclusters -h | awk '$1==16 {print $1" "$4}')"

# ---------------------------------------------------------------- user, files, secrets
say "4. Arscio user, program files and secrets"
id arscio >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin arscio
systemctl stop arscio-api arscio-web 2>/dev/null || true
rm -rf "$APP/app.new" "$APP/web.new"
cp -a "$HERE/app" "$APP/app.new"; cp -a "$HERE/web" "$APP/web.new"
rm -rf "$APP/app" "$APP/web"; mv "$APP/app.new" "$APP/app"; mv "$APP/web.new" "$APP/web"
chown -R root:root "$APP"; chmod -R go-w "$APP"
mkdir -p "$APP/web/apps/admin-web/.next/cache"; chown -R arscio:arscio "$APP/web/apps/admin-web/.next/cache"
ok "Program files in $APP ($(cat "$HERE/BUILT_AT" 2>/dev/null || echo 'unknown date'))"

rnd() { openssl rand -hex "$1"; }
FIRST=0
if [ ! -f "$ENVF" ]; then
  FIRST=1
  OWNER_PW=$(rnd 24); APP_PW=$(rnd 24)
  TEST_PW="Gv-$(rnd 3)-$(date +%y)"   # one password for the test logins, e.g. Gv-3fa9c1-26
  cat > "$ENVF" <<CONF
# Arscio test server settings. Keep secret. (created by setup-arscio.sh on $(date -u +%F))
DATABASE_OWNER_URL=postgres://arscio_owner:$OWNER_PW@127.0.0.1:5432/arscio
DATABASE_URL=postgres://arscio_app:$APP_PW@127.0.0.1:5432/arscio
APP_DB_PASSWORD=$APP_PW
JWT_SECRET=$(rnd 32)
OTP_PROVIDER=console
HOST=127.0.0.1
PORT=$API_PORT
CORS_ORIGINS=https://$WEB_HOST
DEMO_PASSWORD=$TEST_PW
WEB_HOST=$WEB_HOST
API_HOST=$API_HOST
CONF
  ok "Created $ENVF with new random passwords"
fi
# Settings added in later versions (kept if already there)
set_env() { if grep -q "^$1=" "$ENVF"; then sed -i "s#^$1=.*#$1=$2#" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi; }
grep -q '^LOGIN_MODE=' "$ENVF" || set_env LOGIN_MODE otp
[ $REAL = 1 ] && set_env LOGIN_MODE password
[ $RESET = 1 ] && set_env LOGIN_MODE otp
set_env WEB_HOST "$WEB_HOST"; set_env API_HOST "$API_HOST"
set_env CORS_ORIGINS "https://$WEB_HOST"; set_env PUBLIC_WEB_URL "https://$WEB_HOST"
set_env BACKUP_DIR "$BACKUPS"; set_env CONTROL_PORT "$CONTROL_PORT"; set_env WEB_PORT "$WEB_PORT"
chown root:arscio "$ENVF"; chmod 640 "$ENVF"
set -a; . "$ENVF"; set +a
OWNER_PW=$(echo "$DATABASE_OWNER_URL" | sed -E 's#.*://arscio_owner:([^@]*)@.*#\1#')
runuser -u postgres -- psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname='arscio_owner'" | grep -q 1 \
  || runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -c "CREATE ROLE arscio_owner LOGIN CREATEROLE PASSWORD '$OWNER_PW'"
runuser -u postgres -- psql -qtAc "SELECT 1 FROM pg_database WHERE datname='arscio'" | grep -q 1 \
  || runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE arscio OWNER arscio_owner"
ok "Database 'arscio' ready"

# ---------------------------------------------------------------- database tables and demo school
say "5. Database tables$( [ $REAL = 1 ] && echo ' (starting empty, for real schools)' || { [ $FIRST = 1 ] || [ $RESET = 1 ]; } && echo ' and the demo school')"
asarscio() { runuser -u arscio -- env -i PATH="$APP/node/bin:/usr/bin:/bin" HOME=/tmp bash -c "set -a; . $ENVF; set +a; cd $APP/app/apps/api; $*"; }
if [ $REAL = 1 ]; then
  systemctl stop arscio-control 2>/dev/null || true
  asarscio "node --import tsx src/scripts/reset-db.ts"
  rm -f "$APP/logins.txt"
  ok "Arscio's database is empty and ready. Add schools in the control panel."
elif [ $FIRST = 1 ] || [ $RESET = 1 ]; then
  asarscio "node --import tsx src/scripts/reset-db.ts && node --import tsx src/scripts/demo-school.ts" | tee "$APP/logins.txt"
  chown root:root "$APP/logins.txt"; chmod 600 "$APP/logins.txt"
else
  asarscio "node --import tsx src/migrate.ts"
fi

# ---------------------------------------------------------------- control panel password
if ! grep -q '^CONTROL_PASSWORD_HASH=' "$ENVF" || [ $NEWCTL = 1 ]; then
  CTL_PW="Kv-$(openssl rand -hex 4)-$(openssl rand -hex 4)"
  CTL_HASH=$(echo "$CTL_PW" | asarscio "node --import tsx src/scripts/hash-password.ts" | tail -1)
  [[ "$CTL_HASH" == \$argon2* ]] || fail "Could not make the control panel password."
  set_env CONTROL_PASSWORD_HASH "'$CTL_HASH'"
  printf 'Arscio control panel password (made %s): %s\n' "$(date -u +%F)" "$CTL_PW" > "$APP/control-password.txt"
  chown root:root "$APP/control-password.txt"; chmod 600 "$APP/control-password.txt"
  ok "New control panel password saved in $APP/control-password.txt (readable by root only)"
fi
usermod -aG systemd-journal arscio   # lets the control panel read crash logs

# ---------------------------------------------------------------- services
say "6. Services (with memory limits so Curavo is never squeezed)"
cat > /etc/systemd/system/arscio-api.service <<UNIT
[Unit]
Description=Arscio - server for the apps and website
After=network.target postgresql@16-main.service
Requires=postgresql@16-main.service

[Service]
User=arscio
Group=arscio
WorkingDirectory=$APP/app/apps/api
EnvironmentFile=$ENVF
Environment=PATH=$APP/node/bin:/usr/bin:/bin
ExecStart=$APP/node/bin/node --import tsx src/server.ts
Restart=on-failure
RestartSec=3
MemoryHigh=300M
MemoryMax=350M
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/arscio-web.service <<UNIT
[Unit]
Description=Arscio - office website
After=network.target arscio-api.service

[Service]
User=arscio
Group=arscio
WorkingDirectory=$APP/web/apps/admin-web
Environment=NODE_ENV=production
Environment=PORT=$WEB_PORT
Environment=HOSTNAME=127.0.0.1
Environment=API_URL=http://127.0.0.1:$API_PORT
ExecStart=$APP/node/bin/node server.js
Restart=on-failure
RestartSec=3
MemoryHigh=250M
MemoryMax=300M
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$APP/web/apps/admin-web/.next/cache

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/arscio-control.service <<UNIT
[Unit]
Description=Arscio - control panel (only inside this server; open it through an SSH tunnel)
After=network.target postgresql@16-main.service

[Service]
User=arscio
Group=arscio
SupplementaryGroups=systemd-journal
WorkingDirectory=$APP/app/apps/api
EnvironmentFile=$ENVF
Environment=PATH=$APP/node/bin:/usr/bin:/bin
ExecStart=$APP/node/bin/node --import tsx src/control/server.ts
Restart=on-failure
RestartSec=5
MemoryHigh=120M
MemoryMax=160M
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT

# Nightly backup at 2:30 am India time (21:00 UTC); catches up after the server was off
install -m 750 -o root -g root "$HERE/arscio-backup.sh" "$APP/arscio-backup.sh"
cat > /etc/systemd/system/arscio-backup.service <<UNIT
[Unit]
Description=Arscio - nightly backup of the database
After=postgresql@16-main.service

[Service]
Type=oneshot
Environment=BACKUP_DIR=$BACKUPS
ExecStart=$APP/arscio-backup.sh
Nice=10
IOSchedulingClass=idle
UNIT
cat > /etc/systemd/system/arscio-backup.timer <<UNIT
[Unit]
Description=Arscio - run the backup every night

[Timer]
OnCalendar=*-*-* 21:00:00 UTC
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable -q arscio-api arscio-web arscio-control
systemctl enable -q --now arscio-backup.timer
systemctl restart arscio-api arscio-web arscio-control
for i in $(seq 1 40); do curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/health" && break; sleep 1; done
curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/health" || fail "The Arscio server didn't start. See: journalctl -u arscio-api -n 50"
for i in $(seq 1 40); do curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/login" && break; sleep 1; done
curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/login" || fail "The Arscio website didn't start. See: journalctl -u arscio-web -n 50"
for i in $(seq 1 20); do curl -fsS -o /dev/null "http://127.0.0.1:$CONTROL_PORT/api/me" && break; sleep 1; done
curl -fsS -o /dev/null "http://127.0.0.1:$CONTROL_PORT/api/me" || fail "The control panel didn't start. See: journalctl -u arscio-control -n 50"
ok "arscio-api, arscio-web and arscio-control are running; backup runs every night"
if [ ! -f "$BACKUPS/last-backup.json" ]; then
  if "$APP/arscio-backup.sh" >/dev/null; then ok "First backup made in $BACKUPS"; else echo "   ! The first backup didn't work; the control panel shows why."; fi
fi

# ---------------------------------------------------------------- Caddy
say "7. Web addresses in Caddy (checked before going live)"
BACKUP="$CADDY.before-arscio.$(date +%Y%m%d-%H%M%S)"
cp -a "$CADDY" "$BACKUP"
TMP=$(mktemp /etc/caddy/.Caddyfile.arscio-XXXXXX)   # same folder, so any "import" lines still work
sed '/^# >>> ARSCIO/,/^# <<< ARSCIO/d' "$CADDY" > "$TMP"
cat >> "$TMP" <<CONF
# >>> ARSCIO (added by setup-arscio.sh; remove with remove-arscio.sh)
$WEB_HOST {
	encode gzip
	reverse_proxy 127.0.0.1:$WEB_PORT
}
$API_HOST {
	encode gzip
	request_body {
		max_size 20MB
	}
	reverse_proxy 127.0.0.1:$API_PORT
}
# <<< ARSCIO
CONF
if caddy validate --adapter caddyfile --config "$TMP" >/tmp/caddy-check.log 2>&1; then
  cat "$TMP" > "$CADDY"; rm -f "$TMP"
  systemctl reload caddy
  ok "Caddy updated (old settings saved as $BACKUP)"
else
  rm -f "$TMP"; cat /tmp/caddy-check.log
  fail "Caddy didn't accept the new settings, so nothing was changed in Caddy. Curavo is untouched."
fi

# ---------------------------------------------------------------- final check
say "8. Final check"
HTTPS_OK=0
for i in $(seq 1 30); do curl -fsS -o /dev/null "https://$API_HOST/health" && HTTPS_OK=1 && break; sleep 3; done
[ $HTTPS_OK = 1 ] && ok "https://$API_HOST works" || echo "   ! HTTPS isn't ready yet (the certificate can take a minute). Check again soon: curl https://$API_HOST/health"
CURAVO_AFTER=$(systemctl is-active curavo-cloud 2>/dev/null || true)
ok "Curavo service is still: ${CURAVO_AFTER:-not found}"
free -m | awk '/Mem:/ {print "   Memory: " $3 " MB used, " $7 " MB available"}'

cat <<DONE

$(printf '\033[1;32m')Arscio is ready.$(printf '\033[0m')

  Office website:   https://$WEB_HOST
  Address for apps: https://$API_HOST
  Logins:           $( [ "$LOGIN_MODE" = password ] && echo 'by password (no SMS). Add schools in the control panel.' || echo "demo logins: sudo cat $APP/logins.txt  (password $DEMO_PASSWORD)")

  Control panel (from your Mac):
     ssh -i <your key> -L 8102:127.0.0.1:$CONTROL_PORT ubuntu@$IP
     then open http://localhost:8102
     password:  sudo cat $APP/control-password.txt

  Backups:          every night into $BACKUPS (last 14 kept). Run one now: sudo $APP/arscio-backup.sh
  Status:           systemctl status arscio-api arscio-web arscio-control
  Logs:             journalctl -u arscio-api -f
  Update later:     sudo ./setup-arscio.sh   (from a newer package; keeps data)
  Remove all:       sudo ./remove-arscio.sh
DONE
