# Weread Reader App

独立版**微信读书**阅读器 + **本机 MCP**。同一套服务，可给：

1. **网页版 ChatGPT**（需要 OpenAI Secure Tunnel）  
2. **WorkBuddy / Cursor 等本机 Agent**（本地 stdio，**不需要隧道**）

> 仓库（私有）：https://github.com/zoeyzhang233666/weread-reader-app  
> 安装包：https://github.com/zoeyzhang233666/weread-reader-app/releases

---

## 先搞清：两种用法差在哪

| | 网页版 ChatGPT | WorkBuddy / Cursor 等本机 Agent |
|--|--|--|
| 能否直连 `127.0.0.1` | 不能 | 能 |
| 要不要 OpenAI 隧道 | **要** | **不要** |
| 本机要开什么 | Weread 服务 + `tunnel-client` | 先扫码登录；Agent 用 stdio 拉起 MCP |
| 配哪里 | ChatGPT → Connectors → Tunnel | `~/.workbuddy/mcp.json` 或 Cursor MCP 设置 |

两种用法都依赖：**本机已扫码登录微信读书**（登录态在 `~/.weread-reader/`）。

---

## 公共前提：本机登录微信读书

不论给谁用，先完成这一步：

1. Finder 打开 `/Users/edy/weread-reader-app/`  
2. 双击 **`Start Weread.command`**  
3. 浏览器打开 <http://127.0.0.1:17831> → **扫码登录**

自检：

```sh
curl -s http://127.0.0.1:17831/health
# 期望：{"ok":true,"loggedIn":true}
```

工具列表（应能看到 `weread_server_info`、`weread_get_chapter_images` 等，约 8 个）：

```sh
curl -s -X POST http://127.0.0.1:17831/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c 'import sys,json; print([t["name"] for t in json.load(sys.stdin)["result"]["tools"]])'
```

> 不要用未重新打包的旧 `Weread Reader.app`（可能只有 5 个旧工具、无图片）。

---

## 用法 A：网页版 ChatGPT（要隧道）

### A1. 开隧道

1. **先开代理/VPN**（需能访问 `api.openai.com`）  
2. **先保证上面「公共前提」已登录**  
3. 双击 `/Users/edy/weread-reader-app/tunnel/Start Weread Tunnel.command`  
4. 粘贴 **Runtime API Key**（`sk-…`，输入不显示、不落盘）  
   - 获取：[Platform → API keys](https://platform.openai.com/settings/organization/api-keys)  
   - 权限：**Tunnels Read + Use**（不要用 Admin Key）  
5. 看到 `tunnel metadata fetched` 后，**不要关窗口**

Tunnel ID（已写进仓库配置，一般不用改）：

```text
tunnel_6b052c37078c8191afe660304703dd84
```

| 别混 | 样子 | 用途 |
|------|------|------|
| Tunnel ID | `tunnel_…` | ChatGPT 选哪条隧道 |
| Runtime API Key | `sk-…` | 本机 `tunnel-client` 登录 OpenAI |

### A2. 在 ChatGPT 里接上

1. [设置 → Connectors](https://chatgpt.com/#settings/Connectors)  
2. 添加自定义 MCP → **隧道** → 选上面的 Tunnel ID → 认证「无需」→ 创建  
3. **全新对话**，启用该连接器  

试一句：

> 调用 weread_server_info；再列出我的微信读书书架

化工书看表格图（多为 JPEG 插图）：

> 读取 bookId 923588 章节 17，把表格图片也返回；有剩余再分页

### A3. 升级代码后 GPT 仍只有 5 个旧工具？

这是 **Connectors 缓存了创建时的工具快照**。处理：

1. 本机 `tools/list` 已确认有新工具  
2. 隧道在 MCP 起来之后再开  
3. Connectors 里 **删除** 旧连接器 → **重新添加** Tunnel  
4. **全新对话**，先调 `weread_server_info`（应见 `0.2.2-images`）

更细： [docs/chatgpt-tunnel.md](./docs/chatgpt-tunnel.md)

### A4. 用完

- 隧道窗口：`Ctrl+C`  
- Weread：可关；下次再用再开 `Start Weread.command`

---

## 用法 B：WorkBuddy（本机 Agent，不要隧道）

WorkBuddy 跑在你电脑上，可直接连本地 MCP，**不要** `tunnel-client`。

### B1. 配置 `~/.workbuddy/mcp.json`

没有该文件就新建。推荐 **stdio**（WorkBuddy 自己拉起进程）：

```json
{
  "mcpServers": {
    "weread-reader": {
      "command": "node",
      "args": [
        "/Users/edy/weread-reader-app/src/server/mcp-stdio.js"
      ]
    }
  }
}
```

注意文件名是 `mcp.json`，不是 `.mcp.json`。

### B2. 在 WorkBuddy 里启用

1. 侧边栏 → 插件 / MCP / 连接器 → 找到 `weread-reader`  
2. **信任 / 启用**（新配的不会自动开）  
3. **新开一个会话**（改 MCP 配置后旧会话常不生效）

### B3. 登录态

stdio 进程会读本机 `~/.weread-reader/`。若未登录：

1. 先双击 `Start Weread.command` 扫码一次  
2. 再回 WorkBuddy 新会话调用工具  

（HTTP 方式可选：保持 `Start Weread.command` 在跑，若 WorkBuddy 支持 `url` 型 MCP，可指向 `http://127.0.0.1:17831/mcp`。）

### B4. 试一句

> 调用 weread_server_info；列出书架；读取《精细化工配方常用原料手册》章节 17 并拉取表格图片

图片能否被模型「看见」，取决于 WorkBuddy 是否完整支持 MCP `image` 内容类型；本仓库工具侧会返回 ImageContent。

官方 MCP 说明可参考：[WorkBuddy MCP 指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)

---

## 用法 C：Cursor / Claude Desktop（stdio，不要隧道）

```json
{
  "mcpServers": {
    "weread-reader": {
      "command": "node",
      "args": [
        "/Users/edy/weread-reader-app/src/server/mcp-stdio.js"
      ]
    }
  }
}
```

同样：先本机扫码登录，再让 Agent 调工具。

---

## MCP 工具一览

| Tool | 作用 |
|------|------|
| `weread_server_info` | 版本与能力自检（应见 `0.2.2-images`） |
| `weread_status` | 是否已登录 |
| `weread_list_bookshelf` | 书架 |
| `weread_get_book_info` | 元数据（字数/作者/出版社/ISBN/章节数） |
| `weread_list_chapters` | 目录 |
| `weread_get_chapter` | 单章；**默认**返回图文 + ImageContent；仅文字时用 `plain=true` |
| `weread_get_chapter_images` | 分批拉章节图片（表格/结构式等） |
| `weread_export_chapters` | 导出 Markdown（默认保留图片链接） |

端口（HTTP 模式）默认 **17831**：UI `/` ，MCP `/mcp` ，健康检查 `/health`。

图片/表格细节：[docs/rich-content.md](./docs/rich-content.md)

---

## 安装包

| 平台 | 文件（Release 或本地 `dist/`） |
|------|------|
| Mac M 芯片 | `WereadReader-0.1.0-mac-arm64.dmg` / `.zip` |
| Windows x64 | `WereadReader-0.1.0-win-x64.zip` → `WereadReader.bat` |

```sh
cd /Users/edy/weread-reader-app
./scripts/build-macos-app.sh
./scripts/build-windows-portable.sh
```

打包后请用**新**安装包；旧 App 可能不含图片工具。

---

## 常见问题

**下次怎么启动？**  
- 网页 GPT：`Start Weread.command` → 扫码 → `tunnel/Start Weread Tunnel.command` → ChatGPT 启用连接器  
- WorkBuddy：扫码登录一次 → 配好 `mcp.json` 并信任 → 新会话直接用（不用隧道）

**ChatGPT 说速率限制 / 检查隧道？**  
代理、隧道窗口、日志是否 `poll timed out`；隧道要在 MCP 起来之后开。

**WorkBuddy 配了但没工具？**  
查 `~/.workbuddy/mcp.json` 路径/JSON；是否点了信任；是否新开会话；本机是否已 `loggedIn`。

**书架空？**  
扫码后等几秒再刷。

**换 Tunnel ID？**  
改 `tunnel/profiles/weread-local.yaml` 与 `tunnel/start_weread_tunnel.py` 里的 ID，重开隧道，并在 ChatGPT **重建**连接器。
