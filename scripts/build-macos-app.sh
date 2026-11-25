#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/.vendor"
DIST="$ROOT/dist"
STAGE="$DIST/macos-stage"
APP="$STAGE/Weread Reader.app"
NODE_TGZ="$VENDOR/node-darwin-arm64.tar.gz"
VERSION="0.2.1"

mkdir -p "$VENDOR" "$DIST"
if [[ ! -f "$NODE_TGZ" ]]; then
  echo "Missing $NODE_TGZ — download Node darwin-arm64 first"
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app" "$APP/Contents/Resources/node"

# Extract Node runtime (only bin/node + needed libs via full official tarball)
TMP="$VENDOR/node-darwin-extract"
rm -rf "$TMP"
mkdir -p "$TMP"
tar -xzf "$NODE_TGZ" -C "$TMP"
NODE_DIR="$(find "$TMP" -maxdepth 1 -type d -name 'node-v*' | head -1)"
# Keep a slim runtime: node binary + LICENSE
mkdir -p "$APP/Contents/Resources/node/bin"
cp "$NODE_DIR/bin/node" "$APP/Contents/Resources/node/bin/node"
chmod +x "$APP/Contents/Resources/node/bin/node"
cp "$NODE_DIR/LICENSE" "$APP/Contents/Resources/node/LICENSE" 2>/dev/null || true

# App sources (no .vendor / dist)
rsync -a --delete \
  --exclude node_modules \
  --exclude .vendor \
  --exclude dist \
  --exclude packaging \
  --exclude '.git' \
  "$ROOT/" "$APP/Contents/Resources/app/"

cp "$ROOT/packaging/macos/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/packaging/macos/WereadReader.sh" "$APP/Contents/MacOS/WereadReader"
chmod +x "$APP/Contents/MacOS/WereadReader"

# DMG
DMG="$DIST/WereadReader-${VERSION}-mac-arm64.dmg"
rm -f "$DMG"
STAGE_DMG="$DIST/dmg-root"
rm -rf "$STAGE_DMG"
mkdir -p "$STAGE_DMG"
cp -R "$APP" "$STAGE_DMG/"
ln -s /Applications "$STAGE_DMG/Applications"
hdiutil create -volname "Weread Reader" -srcfolder "$STAGE_DMG" -ov -format UDZO "$DMG"
rm -rf "$STAGE_DMG"

# Also keep a zip of the .app for direct use
ZIP="$DIST/WereadReader-${VERSION}-mac-arm64.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"

echo "Built:"
ls -lh "$DMG" "$ZIP"
echo "App stage: $APP"
