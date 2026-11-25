#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/.vendor"
DIST="$ROOT/dist"
STAGE="$DIST/WereadReader-win-x64"
NODE_ZIP="$VENDOR/node-win-x64.zip"
VERSION="0.2.2"

mkdir -p "$VENDOR" "$DIST"
if [[ ! -f "$NODE_ZIP" ]]; then
  echo "Missing $NODE_ZIP — download Node win-x64 first"
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/app" "$STAGE/runtime"

TMP="$VENDOR/node-win-extract"
rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$NODE_ZIP" -d "$TMP"
NODE_DIR="$(find "$TMP" -maxdepth 1 -type d -name 'node-v*' | head -1)"
cp "$NODE_DIR/node.exe" "$STAGE/runtime/node.exe"
cp "$NODE_DIR/LICENSE" "$STAGE/runtime/LICENSE" 2>/dev/null || true

rsync -a --delete \
  --exclude node_modules \
  --exclude .vendor \
  --exclude dist \
  --exclude packaging \
  --exclude '.git' \
  "$ROOT/" "$STAGE/app/"

cp "$ROOT/packaging/windows/WereadReader.bat" "$STAGE/WereadReader.bat"
cp "$ROOT/packaging/windows/Stop-WereadReader.bat" "$STAGE/Stop-WereadReader.bat"
cp "$ROOT/README.md" "$STAGE/README.md"
cp "$ROOT/docs/chatgpt-tunnel.md" "$STAGE/ChatGPT-Tunnel.md"

OUT="$DIST/WereadReader-${VERSION}-win-x64.zip"
rm -f "$OUT"
(
  cd "$DIST"
  zip -qr "$(basename "$OUT")" "$(basename "$STAGE")"
)

echo "Built:"
ls -lh "$OUT"
echo "Stage: $STAGE"
