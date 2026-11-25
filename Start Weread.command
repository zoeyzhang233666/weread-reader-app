#!/bin/bash
# Double-click to start Weread Reader (latest source) on http://127.0.0.1:17831
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${WEREAD_PORT:-17831}"
LOGDIR="${HOME}/.weread-reader/logs"
PIDFILE="${HOME}/.weread-reader/server.pid"
mkdir -p "$LOGDIR"

if curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "Already running: http://127.0.0.1:${PORT}"
  open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true
  exit 0
fi

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  APP_NODE="$ROOT/dist/macos-stage/Weread Reader.app/Contents/Resources/node/bin/node"
  [[ -x "$APP_NODE" ]] && NODE="$APP_NODE"
fi
if [[ -z "${NODE:-}" || ! -x "$NODE" ]]; then
  osascript -e 'display alert "Weread Reader" message "找不到 node。请安装 Node.js 20+，或先构建 Mac 包。" as critical'
  exit 1
fi

"$NODE" --use-env-proxy "$ROOT/src/server/index.js" >>"$LOGDIR/app.log" 2>&1 &
echo $! >"$PIDFILE"

for _ in $(seq 1 40); do
  if curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true
    echo "OK http://127.0.0.1:${PORT}  (MCP /mcp)"
    echo "Keep this window open is optional; server runs in background."
    echo "Next: double-click tunnel/Start Weread Tunnel.command"
    read -r -p "Press Enter to close…" _
    exit 0
  fi
  sleep 0.25
done

osascript -e "display alert \"Weread Reader\" message \"启动失败，查看日志：${LOGDIR}/app.log\" as critical"
exit 1
