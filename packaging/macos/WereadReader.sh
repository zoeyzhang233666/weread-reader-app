#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/Resources"
APP_DIR="$RES/app"
NODE_BIN="$RES/node/bin/node"
PORT="${WEREAD_PORT:-17831}"
HOST="${WEREAD_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}"
LOG_DIR="${HOME}/.weread-reader/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/app.log"

export WEREAD_PORT="$PORT"
export WEREAD_HOST="$HOST"
# Node fetch needs this to honor HTTP(S)_PROXY / system proxy applied in index.js
export NODE_OPTIONS="--use-env-proxy ${NODE_OPTIONS:-}"

if [[ ! -x "$NODE_BIN" ]]; then
  osascript -e 'display alert "Weread Reader" message "缺少内置 Node 运行时，请重新安装。" as critical'
  exit 1
fi

already_up() {
  curl -fsS --max-time 1 "$URL/health" >/dev/null 2>&1
}

if ! already_up; then
  # Start server in background, keep launcher waiting so Dock icon stays.
  "$NODE_BIN" --use-env-proxy "$APP_DIR/src/server/index.js" >>"$LOG_FILE" 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > "${HOME}/.weread-reader/server.pid"

  for _ in $(seq 1 40); do
    if already_up; then
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      osascript -e "display alert \"Weread Reader\" message \"服务启动失败，请查看日志：\n$LOG_FILE\" as critical"
      exit 1
    fi
    sleep 0.25
  done
else
  SERVER_PID="$(cat "${HOME}/.weread-reader/server.pid" 2>/dev/null || true)"
fi

open "$URL" >/dev/null 2>&1 || true

# Keep process alive while server runs (or forever if we attached to existing).
if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
  wait "$SERVER_PID"
else
  while already_up; do sleep 2; done
fi
