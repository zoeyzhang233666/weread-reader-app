#!/usr/bin/env python3
"""Foreground launcher for Weread Reader ↔ OpenAI Secure Tunnel. Never saves the runtime API key."""
import getpass
import os
import re
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP_ROOT = ROOT.parent
TUNNEL = "tunnel_6b052c37078c8191afe660304703dd84"
ORG = "org-XMxn9etfgg4H9kmEW8HjnZuS"
MCP_URL = "http://127.0.0.1:17831/mcp"
HEALTH = "http://127.0.0.1:17831/health"

# Prefer known local installs, then PATH / Homebrew.
CANDIDATES = [
    Path.home()
    / "Documents/Codex/2026-11-13/mac-ankimcp-chatgpt-chatgpt-chat-chatgpt/outputs/AnkiSecureTunnel/bin/tunnel-client",
    Path("/opt/homebrew/bin/tunnel-client"),
    Path("/usr/local/bin/tunnel-client"),
]


def find_bin() -> str:
    for p in CANDIDATES:
        if p.is_file() and os.access(p, os.X_OK):
            return str(p)
    which = subprocess.run(["which", "tunnel-client"], capture_output=True, text=True)
    if which.returncode == 0:
        path = which.stdout.strip()
        if path:
            return path
    raise SystemExit(
        "找不到 tunnel-client。请先安装：brew install openai/tools/tunnel-client\n"
        "或把二进制放到 PATH。"
    )


def wait_weread(timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(HEALTH, timeout=1) as r:
                if r.status == 200:
                    return
        except Exception:
            time.sleep(0.4)
    raise SystemExit(
        f"Weread Reader 未在 {HEALTH} 运行。\n"
        "请先打开 Weread Reader.app（或双击 dist 里的安装包），扫码登录后再跑本脚本。"
    )


def main() -> int:
    if not sys.stdin.isatty():
        raise SystemExit("请双击「Start Weread Tunnel.command」或在终端直接运行本脚本。")

    bin_path = find_bin()
    print("Weread Reader → OpenAI Secure Tunnel")
    print(f"Tunnel ID: {TUNNEL}")
    print(f"本机 MCP:  {MCP_URL}")
    print()
    print("需要 Platform 组织的 Runtime API Key（sk-…），权限：Tunnels Read + Use。")
    print("不要用 Admin Key。输入不显示，不会写入磁盘/历史。")
    key = getpass.getpass("Runtime API Key: ").strip()
    if not key or any(c.isspace() for c in key):
        raise SystemExit("Key 为空或含空格，未启动。")

    wait_weread()

    allowed = (
        "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "TERM",
        "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY",
        "https_proxy", "http_proxy", "all_proxy", "no_proxy",
        "SSL_CERT_FILE", "SSL_CERT_DIR",
    )
    env = {k: os.environ[k] for k in allowed if k in os.environ}
    env["CONTROL_PLANE_API_KEY"] = key
    env["CONTROL_PLANE_ORGANIZATION_ID"] = ORG

    # macOS system proxy (Clash 等) 不会自动进非 GUI 进程；探测后写入。
    if not env.get("HTTPS_PROXY") and not env.get("https_proxy"):
        try:
            sc = subprocess.check_output(["scutil", "--proxy"], text=True)
            host = port = None
            for line in sc.splitlines():
                if "HTTPSProxy :" in line:
                    host = line.split(":", 1)[1].strip()
                if "HTTPSPort :" in line:
                    port = line.split(":", 1)[1].strip()
            if host and port and host != "0":
                proxy = f"http://{host}:{port}"
                env["HTTPS_PROXY"] = proxy
                env["HTTP_PROXY"] = proxy
                env["ALL_PROXY"] = proxy
                env.setdefault("NO_PROXY", "127.0.0.1,localhost")
                print(f"已使用系统代理: {proxy}", flush=True)
        except Exception:
            pass

    def clean(text: str) -> str:
        text = text.replace(key, "[REDACTED]")
        return re.sub(r"sk-[A-Za-z0-9_-]+", "[REDACTED]", text)

    profile = ["--profile", "weread-local", "--profile-dir", str(ROOT / "profiles")]
    print("\nRunning doctor…", flush=True)
    doc = subprocess.run(
        [bin_path, "doctor", *profile, "--explain"],
        env=env, cwd=str(ROOT), capture_output=True, text=True, timeout=120,
    )
    print(clean(doc.stdout + doc.stderr), flush=True)
    if doc.returncode != 0:
        raise SystemExit("Doctor 未通过，未启动隧道。")

    print("\n启动隧道。保持本窗口打开；Ctrl+C 停止。", flush=True)
    print("ChatGPT：设置 → Connectors → 添加自定义 MCP → 选 Tunnel → 选此隧道。", flush=True)
    proc = subprocess.Popen(
        [bin_path, "run", *profile],
        env=env, cwd=str(ROOT),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            print(clean(line), end="", flush=True)
        return proc.wait()
    except KeyboardInterrupt:
        if proc.poll() is None:
            proc.send_signal(signal.SIGINT)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.terminate()
        return 130
    finally:
        env.pop("CONTROL_PLANE_API_KEY", None)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except (EOFError, KeyboardInterrupt):
        print("\n已取消，未保存 Key。")
        raise SystemExit(130)
