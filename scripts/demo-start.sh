#!/usr/bin/env bash
# Starts the whole Arscio demo on this Mac: database, demo school, server and office website.
# Run from the project folder:   pnpm demo:start
# Then, in two more Terminal windows:   pnpm demo:teacher   and   pnpm demo:parent
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOGS="$ROOT/.demo-logs"; mkdir -p "$LOGS"
say() { printf "\n\033[1;36m%s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m%s\033[0m\n" "$1"; exit 1; }

say "1. Checking the tools on this Mac"
command -v node >/dev/null || fail "Node.js is missing. Install it with:  brew install node@22   (or from nodejs.org), then run this again."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js $NODE_MAJOR is too old; version 22 or newer is needed (brew install node@22)."
if ! command -v pnpm >/dev/null; then corepack enable >/dev/null 2>&1 || npm install -g pnpm@9; fi
echo "Node $(node -v), pnpm $(pnpm -v)"

say "2. Starting the database"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  docker compose up -d db
  for i in $(seq 1 30); do docker compose exec -T db pg_isready -U arscio_owner >/dev/null 2>&1 && break; sleep 1; done
  echo "Database running in Docker."
elif command -v brew >/dev/null; then
  brew list postgresql@16 >/dev/null 2>&1 || brew install postgresql@16
  brew services start postgresql@16 >/dev/null
  PG="$(brew --prefix postgresql@16)/bin"
  for i in $(seq 1 30); do "$PG/pg_isready" -q && break; sleep 1; done
  "$PG/psql" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='arscio_owner'" | grep -q 1 \
    || "$PG/psql" -d postgres -c "CREATE ROLE arscio_owner LOGIN CREATEDB CREATEROLE PASSWORD 'dev_only_password'" >/dev/null
  "$PG/psql" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='arscio'" | grep -q 1 \
    || "$PG/createdb" -O arscio_owner arscio
  echo "Database running with Homebrew PostgreSQL 16."
else
  fail "No database found. Install Docker Desktop (and open it), or Homebrew from brew.sh, then run this again."
fi

say "3. Settings"
ENV="$ROOT/apps/api/.env"
if [ ! -f "$ENV" ]; then
  cat > "$ENV" <<CONF
DATABASE_OWNER_URL=postgres://arscio_owner:dev_only_password@localhost:5432/arscio
DATABASE_URL=postgres://arscio_app:dev_app_password@localhost:5432/arscio
APP_DB_PASSWORD=dev_app_password
JWT_SECRET=$(openssl rand -hex 32)
OTP_PROVIDER=console
PORT=4000
CORS_ORIGINS=http://localhost:3000,http://localhost:8081,http://localhost:8082
CONF
  echo "Created apps/api/.env for this computer."
else
  grep -q '^CORS_ORIGINS=' "$ENV" || echo "CORS_ORIGINS=http://localhost:3000,http://localhost:8081,http://localhost:8082" >> "$ENV"
  echo "Using the existing apps/api/.env."
fi
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
[ -n "$IP" ] && echo "$IP" > "$LOGS/lan-ip" && echo "This Mac's Wi-Fi address: $IP (phones use it to reach the server)"

say "4. Installing (first time takes a few minutes)"
pnpm install --frozen-lockfile=false >/dev/null && echo "Done."

say "5. Building the demo school"
if [ "${1:-}" != "--keep" ]; then
  echo "This WIPES the local Arscio database on this Mac and builds a fresh demo school."
  if [ "${1:-}" != "--yes" ]; then read -r -p "Type yes to continue (or run with --keep to keep your current data): " ok; [ "$ok" = "yes" ] || fail "Stopped. Nothing was changed."; fi
  pnpm demo:reset | tee "$LOGS/logins.txt"
else
  pnpm db:migrate
fi

say "6. Starting the server and the office website"
for port in 4000 3000; do lsof -ti tcp:$port | xargs kill 2>/dev/null || true; done
(pnpm dev:api > "$LOGS/api.log" 2>&1 &)
(pnpm dev:web > "$LOGS/web.log" 2>&1 &)
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:4000/health && break; sleep 1; done
curl -s -o /dev/null http://localhost:4000/health || fail "The server did not start. See .demo-logs/api.log"
for i in $(seq 1 90); do curl -s -o /dev/null http://localhost:3000/login && break; sleep 1; done

say "Ready"
echo "Office website:  http://localhost:3000   (opening it now)"
echo "Every login password: Demo#2027   (full list in docs/demo-guide.md and .demo-logs/logins.txt)"
echo ""
echo "Phone apps: open two more Terminal windows in this folder and run"
echo "   pnpm demo:teacher     and     pnpm demo:parent"
echo "then scan each QR code with the Expo Go app (phone on the same Wi-Fi as this Mac)."
echo ""
echo "Keep this window open. Press Ctrl+C to stop everything."
open http://localhost:3000 2>/dev/null || true
trap 'for port in 4000 3000; do lsof -ti tcp:$port | xargs kill 2>/dev/null || true; done; echo "Stopped."' EXIT
tail -f "$LOGS/api.log"
