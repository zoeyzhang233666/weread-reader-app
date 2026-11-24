# ChatGPT 网页版 ↔ Weread Reader（OpenAI Secure Tunnel）

网页版 ChatGPT **不能直连**你电脑上的 `127.0.0.1`。做法与 AnkiMCP 相同：本机跑官方 `tunnel-client`，**出站**连到 OpenAI，再把请求转到本机 MCP。

```
ChatGPT 网页
    ↓（OpenAI 托管的隧道端点）
OpenAI Tunnel Service
    ↑ long-poll（本机出站 HTTPS）
tunnel-client（本机）
    ↓
http://127.0.0.1:17831/mcp  ← Weread Reader
```

---

## 一、准备清单

### 1. Weread Reader

- Mac：安装并打开 **Weread Reader.app**
- 或开发模式：`node src/server/index.js`
- 浏览器打开 <http://127.0.0.1:17831>，**扫码登录**
- 验收：

```sh
curl -s http://127.0.0.1:17831/health
# 期望类似：{"ok":true,"loggedIn":true}
```

### 2. Tunnel ID + Runtime API Key（两样都要）

| | Tunnel ID | Runtime API Key |
|---|-----------|-----------------|
| 样子 | `tunnel_` + 32 位十六进制 | `sk-…` / `sk-proj-…` |
| 获取 | [Platform → Tunnels](https://platform.openai.com/settings/organization/tunnels) 创建或复制 | [Platform → API keys](https://platform.openai.com/settings/organization/api-keys) |
| 权限 | 组织需有 Tunnels | 该 Key 需 **Tunnels Read + Use**（**不要**用 Admin Key） |

本仓库默认 Tunnel ID（可改）：

```text
tunnel_6b052c37078c8191afe660304703dd84
```

写在：

- `tunnel/profiles/weread-local.yaml` → `control_plane.tunnel_id`
- `tunnel/start_weread_tunnel.py` → `TUNNEL = "..."`  

**永远不要**把 `sk-…` 写进仓库、截图或聊天记录。启动器只会在内存里用，输入不回显、不落盘。

### 3. tunnel-client

任选其一：

```sh
brew install openai/tools/tunnel-client
```

或使用本机已有二进制（例如以前 Anki Secure Tunnel 目录里的 `bin/tunnel-client`）。  
启动器会按顺序找：Anki 路径 → Homebrew → `/usr/local` → `PATH`。

### 4. 网络 / 代理（国内必看）

`tunnel-client` **不会**自动使用 macOS「系统代理」。若本机 Clash / Surge 等开了系统代理，但终端直连 `api.openai.com` 超时，ChatGPT 会报：

> 应用配置受到速率限制……如果你正在使用隧道，也请检查隧道客户端是否正在运行且已连接。

本仓库的 `Start Weread Tunnel.command` 会用 `scutil --proxy` 自动带上系统 HTTPS 代理（例如 `http://127.0.0.1:7897`）。

手动自检：

```sh
# 不走代理：多半超时
curl -m 10 -o /dev/null -w '%{http_code}\n' https://api.openai.com/v1/models

# 走代理：应能连上（无 Key 时常见 401，说明网络通）
curl -m 10 -x http://127.0.0.1:7897 -o /dev/null -w '%{http_code}\n' https://api.openai.com/v1/models
```

日志健康信号（`~/Library/Application Support/tunnel-client/logs/weread-local.log`）：

- 好：`tunnel metadata fetched`、`poller started`，且**没有**连续的 `poll timed out`
- 坏：反复 `poll timed out` / `poll failed` → 代理或网络问题

本地健康：

```sh
cat "$HOME/Library/Application Support/tunnel-client/health/weread-local.url"
# 例如 http://127.0.0.1:61615
curl -s "$(cat "$HOME/Library/Application Support/tunnel-client/health/weread-local.url")/readyz"
# 期望：ready
```

---

## 二、Mac 日常启动顺序

1. **先开代理/VPN**（能访问 OpenAI）  
2. **先开 Weread**：双击仓库根目录 `Start Weread.command`，确认已登录  
3. **再开隧道**：双击 `tunnel/Start Weread Tunnel.command`  
   - 粘贴 Runtime API Key  
   - 看到 `tunnel metadata fetched` / `🟢 tunnel-client started`  
   - **不要关这个终端窗口**  
4. 打开 [ChatGPT → 设置 → Connectors](https://chatgpt.com/#settings/Connectors)  
   - **升级过 MCP 工具后必须删掉旧连接器再加一次**（否则会永远看到旧的 5 个「纯文本」工具）  
   - 添加自定义 MCP → 连接选 **隧道** → 选上述 Tunnel ID → 认证「无需」→ 创建  
5. **全新聊天**，启用连接器，先问：

> 调用 weread_server_info，告诉我 version

应看到 `0.2.2-images` 以及 `weread_get_chapter_images`。再读化工书章节图。

停止：隧道窗口 `Ctrl+C`；Weread 可留着。

---

## 三、ChatGPT 里第一次添加（对照表单）

| 字段 | 建议 |
|------|------|
| 名称 | 如 `read` |
| 连接 | **隧道** |
| 隧道 | `tunnel_6b052c37078c8191afe660304703dd84`（或你自己的） |
| 身份验证 | 无需身份验证 |
| 风险勾选 | 勾选「我已了解，并希望继续」 |

创建失败且提到速率限制 / 检查隧道客户端时：

1. 确认本机 tunnel 在跑且日志无 poll 超时  
2. 等 30–60 秒再点「创建」  
3. 不要连续狂点（真的会撞限流）

---

## 四、验收 MCP 工具列表

```sh
curl -s -X POST http://127.0.0.1:17831/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

应能看到：`weread_status`、`weread_list_bookshelf`、`weread_list_chapters`、`weread_get_chapter`、`weread_export_chapters`。

---

## 五、换 Tunnel / 换机器

1. 在 Platform 新建或选用 Tunnel，复制新的 `tunnel_…`  
2. 改 `tunnel/profiles/weread-local.yaml` 与 `tunnel/start_weread_tunnel.py` 中的 ID  
3. （可选）改 `ORG = "org-…"` 为你的 Platform 组织 ID  
4. 重启隧道启动器，在 ChatGPT Connectors 里改选新隧道或新建连接器  

Windows：同样需要 Weread 便携包 + 官方 Windows 版 `tunnel-client`，把 MCP URL 设为 `http://127.0.0.1:17831/mcp`，并配置能访问 `api.openai.com` 的代理环境变量 `HTTPS_PROXY`。

---

## 六、安全与隐私

- 登录 Cookie / session 只在本机 `~/.weread-reader/`  
- 隧道只转发 MCP JSON-RPC，不把微信读书账号密码交给第三方业务服务器  
- Runtime API Key 不要提交 git；本仓库的启动器刻意用 `env:CONTROL_PLANE_API_KEY` + 交互输入  
- 仓库建议 **私有**（含个人 Tunnel ID / 组织 ID）
