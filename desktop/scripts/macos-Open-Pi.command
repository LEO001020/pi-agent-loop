#!/bin/bash
# Visible entry point for community macOS builds without Apple notarization.
set -euo pipefail

APP_SRC=""
DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -d "$DIR/.payload/Pi.app" ]]; then
  APP_SRC="$DIR/.payload/Pi.app"
elif [[ -d "$DIR/Pi.app" ]]; then
  # Compatibility with DMGs produced before v0.2.4.
  APP_SRC="$DIR/Pi.app"
elif [[ -d "/Volumes/Pi/Pi.app" ]]; then
  APP_SRC="/Volumes/Pi/Pi.app"
fi

DEST_DIR="${PI_APP_INSTALL_DIR:-/Applications}"
if [[ ! -w "$DEST_DIR" ]]; then
  DEST_DIR="$HOME/Applications"
fi
DEST="$DEST_DIR/Pi.app"
TMP_DEST="$DEST_DIR/.Pi.app.installing.$$"

cleanup() {
  rm -rf "$TMP_DEST"
}
trap cleanup EXIT

echo ""
echo "  Pi - macOS installer"
echo "  ─────────────────────────"
echo ""

if [[ -z "$APP_SRC" ]]; then
  echo "Could not find the Pi application payload."
  echo "Open the Pi DMG and run Install Pi.command from there."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

mkdir -p "$DEST_DIR"
echo "Installing Pi in $DEST_DIR..."
ditto "$APP_SRC" "$TMP_DEST"

echo "Removing download quarantine..."
xattr -cr "$TMP_DEST"

echo "Applying and verifying the local signature..."
codesign \
  --force \
  --deep \
  --sign - \
  --timestamp=none \
  --identifier "dev.pi.desktop" \
  "$TMP_DEST"
codesign --verify --deep --strict "$TMP_DEST"

rm -rf "$DEST"
mv "$TMP_DEST" "$DEST"
trap - EXIT

echo "Opening Pi..."
open "$DEST"

echo ""
echo "Pi is installed and ready."
echo "You can close this window."
echo ""
read -r -p "Press Enter to close..."
