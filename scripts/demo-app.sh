#!/usr/bin/env bash
# Starts the teacher or parent app for Expo Go on a phone.
# Usage (from the project folder):  pnpm demo:teacher   or   pnpm demo:parent
set -euo pipefail
cd "$(dirname "$0")/.."
WHICH="${1:-}"
case "$WHICH" in
  teacher) DIR=apps/teacher-app; PORT=8081 ;;
  parent)  DIR=apps/parent-app;  PORT=8082 ;;
  *) echo "Say which app: teacher or parent"; exit 1 ;;
esac
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || cat .demo-logs/lan-ip 2>/dev/null || echo "")
if [ -z "$IP" ]; then echo "Could not find this Mac's Wi-Fi address. Is Wi-Fi on?"; exit 1; fi
curl -s -o /dev/null "http://$IP:4000/health" || { echo "The server is not running. Start it first with:  pnpm demo:start"; exit 1; }
export EXPO_PUBLIC_API_URL="http://$IP:4000"
echo ""
echo "Starting the $WHICH app. The phone will talk to the server at $EXPO_PUBLIC_API_URL"
echo "1. Put the phone on the same Wi-Fi as this Mac."
echo "2. Install \"Expo Go\" from the App Store or Play Store."
echo "3. Scan the QR code below (iPhone: with the Camera app; Android: inside Expo Go)."
echo ""
cd "$DIR"
npx expo start --lan --port "$PORT" --clear
