#!/bin/bash
# Double-clickable: prompts for Runtime API Key, starts OpenAI tunnel → Weread MCP
cd "$(dirname "$0")"
exec /usr/bin/python3 "$(dirname "$0")/start_weread_tunnel.py"
