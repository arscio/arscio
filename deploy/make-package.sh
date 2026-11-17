#!/usr/bin/env bash
# Builds the package for the test server: deploy/out/arscio-test.tar.gz
# It contains Arscio already built (nothing heavy runs on the server) plus the setup scripts.
# Run from the project folder:   pnpm package:server
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/deploy/out"; STAGE="$OUT/arscio-test"
rm -rf "$STAGE" "$OUT/arscio-test.tar.gz"; mkdir -p "$STAGE/app/apps" "$STAGE/app/db"

echo "1/3 Office website (self-contained build)"
( cd apps/admin-web && rm -rf .next && npx next build >/dev/null )
cp -r apps/admin-web/.next/standalone "$STAGE/web"
cp -r apps/admin-web/.next/static "$STAGE/web/apps/admin-web/.next/static"
[ -d apps/admin-web/public ] && cp -r apps/admin-web/public "$STAGE/web/apps/admin-web/public"
rm -rf "$STAGE/web/node_modules/@img" "$STAGE/web/node_modules/sharp"   # image resizing is switched off

echo "2/3 Server (with its libraries for Arm and Intel servers)"
pnpm --filter @arscio/api deploy --prod "$STAGE/app/apps/api" >/dev/null
rm -rf "$STAGE/app/apps/api/test" "$STAGE/app/apps/api/.env" "$STAGE/app/apps/api/vitest.config.ts"
cp -r db/migrations "$STAGE/app/db/migrations"

echo "3/3 Setup scripts"
cp deploy/server/*.sh "$STAGE/"
chmod +x "$STAGE"/*.sh
date -u +"%Y-%m-%d %H:%M UTC" > "$STAGE/BUILT_AT"
tar -C "$OUT" -czf "$OUT/arscio-test.tar.gz" arscio-test
rm -rf "$STAGE"
echo "Done: deploy/out/arscio-test.tar.gz ($(du -h "$OUT/arscio-test.tar.gz" | cut -f1))"
