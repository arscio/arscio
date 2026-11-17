#!/usr/bin/env bash
# Builds an installable Android app (APK) for testing, on Expo's free build service.
# Usage (from the project folder):   pnpm build:android teacher    or    pnpm build:android parent
# The apps talk to the test server: https://arscio-api.52-64-125-90.sslip.io
# For the real school (talks to https://api.arscio.in, logins by password):
#                                     pnpm build:android teacher live   or   pnpm build:android parent live
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
WHICH="${1:-}"
PROFILE="${2:-test}"
case "$PROFILE" in test|live) ;; *) echo "The second word can only be 'live' (or nothing for the test server)"; exit 1 ;; esac
case "$WHICH" in
  teacher) DIR=apps/teacher-app; NAME="Arscio Teacher"; SLUG=arscio-teacher ;;
  parent)  DIR=apps/parent-app;  NAME="Arscio Parent";  SLUG=arscio-parent ;;
  *) echo "Say which app: pnpm build:android teacher   or   pnpm build:android parent"; exit 1 ;;
esac
say() { printf "\n\033[1;36m%s\033[0m\n" "$1"; }

say "Getting ready"
echo "Downloading the project libraries (first time: a few minutes; you will see progress below)"
pnpm install
EAS="npx --yes eas-cli@latest"
# This folder isn't a git project, so tell Expo where the whole project starts (the apps share code with it).
if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  export EAS_NO_VCS=1 EAS_PROJECT_ROOT="$ROOT"
fi
cd "$DIR"

say "Expo account"
if ! $EAS whoami >/dev/null 2>&1; then
  echo "Log in with the company Expo account (admin@arscio.in; team: arscios-team). The password is typed here, not shared with anyone."
  $EAS login
fi
WHO="$($EAS whoami 2>/dev/null || true)"
echo "$WHO"
# The apps belong to the company's Expo team, never a personal account.
if ! printf '%s' "$WHO" | grep -q "arscios-team"; then
  echo
  echo "This Mac is logged in to Expo with an account that is not part of the company team (arscios-team)."
  echo "Logging out now. Run the same command again and log in with the company account (admin@arscio.in)."
  $EAS logout >/dev/null 2>&1 || true
  exit 1
fi

if [ ! -s eas-project-id.txt ]; then
  say "First time only: create the $NAME project on Expo"
  echo "1. Open https://expo.dev/accounts/arscios-team/projects and click \"Create a project\"."
  echo "2. Display name: $NAME      Slug: $SLUG   (the slug must be exactly this)"
  echo "3. Expo then shows the project ID (looks like 1a2b3c4d-....). Copy it."
  while true; do
    read -r -p "Paste the project ID here: " PID
    PID="$(echo "$PID" | tr -d '[:space:]')"
    [[ "$PID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] && break
    echo "That doesn't look like a project ID. It should look like 1a2b3c4d-1234-5678-9abc-1234567890ab."
  done
  echo "$PID" > eas-project-id.txt
  echo "Saved. You won't be asked again."
fi

say "Building $NAME (about 10 to 20 minutes on Expo's free service)"
echo "If it asks to create an Android Keystore (the app's signing key), answer yes. Expo keeps it safe."
$EAS build --platform android --profile "$PROFILE"
say "Done"
echo "Expo shows a link and a QR code above. Open the link on a phone (or send it on WhatsApp) to download and install the app."
echo "The link is also on https://expo.dev under the project's Builds."
