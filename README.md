# Weread Reader App

独立版**微信读书**阅读器（Mac Apple Silicon / Windows x64）+ **本机 MCP**，可被 Cursor / Claude Desktop / **网页版 ChatGPT（OpenAI Secure Tunnel）**调用。

- 扫码登录、书架、整页翻页、复制本章 / 按区间导出多章（如 `1-10`）
- 启动后自动提供：`http://127.0.0.1:17831`（UI）与 `http://127.0.0.1:17831/mcp`（MCP）
- 登录态保存在本机 `~/.weread-reader/`（Windows：`%USERPROFILE%\.weread-reader\`）

> 非官方微信读书接口，仅供个人已购/可读书籍使用；接口可能变更。

---

## 5 分钟速查（下次直接照这个）

| 步骤 | 做什么 |
|------|--------|
| 1 | 打开 **Weread Reader**（Mac `.app` / DMG，或 Win `WereadReader.bat`） |
| 2 | 浏览器确认已开 <http://127.0.0.1:17831>，**扫码登录** |
| 3 | 确认系统代理/VPN 可用（本机需能访问 `api.openai.com`） |
| 4 | 双击 `tunnel/Start Weread Tunnel.command`，粘贴 **Runtime API Key**（`sk-…`） |
| 5 | ChatGPT → [Connectors](https://chatgpt.com/#settings/Connectors) → 启用名为 `read` 的自定义 MCP |
| 6 | 新开对话，让 GPT：「列出我的微信读书书架」 |

两样东西别混：

| 名称 | 长什么样 | 哪里拿 |
|------|----------|--------|
| **Tunnel ID** | `tunnel_…` | [Platform → Tunnels](https://platform.openai.com/settings/organization/tunnels) |
| **Runtime API Key** | `sk-…` | [Platform → API keys](https://platform.openai.com/settings/organization/api-keys)（需 **Tunnels Read + Use**，不要用 Admin Key） |

本仓库 `tunnel/profiles/weread-local.yaml` 里已写好 Tunnel ID；**Key 永远不落盘**，每次启动器里粘贴一次。

---

## 安装包

若本地已有 `dist/` 构建产物：

| 平台 | 文件 |
|------|------|
| Mac M 芯片 | `WereadReader-0.1.0-mac-arm64.dmg` 或 `.zip` |
| Windows x64 | `WereadReader-0.1.0-win-x64.zip`（解压即用） |

也可自行打包（需先下载 Node 运行时到 `.vendor/`，见下方「开发者」）：

```sh
./scripts/build-macos-app.sh
./scripts/build-windows-portable.sh
```

### Mac

1. 打开 DMG，把 **Weread Reader** 拖进 Applications  
2. 首次若提示未验证：右键 → 打开 → 仍要打开  
3. 启动后自动打开阅读器页面；MCP 已在 `/mcp`

### Windows

1. 解压 zip，双击 `WereadReader.bat`  
2. 停止用同目录 `Stop-WereadReader.bat`

---

## 给网页版 ChatGPT 用（完整说明）

详见 **[docs/chatgpt-tunnel.md](./docs/chatgpt-tunnel.md)**（含代理排错、验收命令）。

摘要：

1. Weread 已运行且已登录  
2. 安装 [tunnel-client](https://github.com/openai/tunnel-client)（`brew install openai/tools/tunnel-client`，或沿用本机 Anki 那份）  
3. 运行 `tunnel/Start Weread Tunnel.command`（会自动探测 macOS 系统代理，如 Clash `127.0.0.1:7897`）  
4. ChatGPT 添加/启用 **Tunnel** 连接器，指向同一 Tunnel ID  
5. **保持** Weread + tunnel 窗口不要关

若出现「应用配置受到速率限制…也请检查隧道客户端」：优先检查 tunnel 是否真连上 OpenAI（日志里应有 `tunnel metadata fetched`，不应持续 `poll timed out`）。国内网络几乎一定要给 tunnel-client 配 **HTTPS 代理**。

---

## MCP 工具

| Tool | 作用 |
|------|------|
| `weread_status` | 是否已登录 |
| `weread_list_bookshelf` | 书架 |
| `weread_get_book_info` | 书籍元数据（字数/作者/出版社/ISBN/章节数等） |
| `weread_list_chapters` | 某书目录 |
| `weread_get_chapter` | 单章正文；`rich=true` 含图文块/表格；`includeImages=true` 以 MCP ImageContent 返回图片字节（可分页） |
| `weread_get_chapter_images` | 分批拉取章节图片（表格图、结构式、流程图等），供模型直接看图 |
| `weread_export_chapters` | 导出多章 Markdown（`range: "1-10"`）；`rich=true` 保留图片链接与原生表格 |

化工手册类 EPUB 的表格常被做成**图片**而非 HTML `<table>`。默认纯文本接口会丢掉这些图；请用 `rich` / `includeImages` / `weread_get_chapter_images`。详见 [docs/rich-content.md](./docs/rich-content.md)。

### Cursor / Claude Desktop（stdio，可选）

```json
{
  "mcpServers": {
    "weread-reader": {
      "command": "node",
      "args": ["/绝对路径/weread-reader-app/src/server/mcp-stdio.js"]
    }
  }
}
```

先在网页 UI 扫码登录，再让 AI 调工具。

---

## 开发者：从源码跑

需要 Node.js 20+。

```sh
cd weread-reader-app
node src/server/index.js
# 另开：node scripts/open.mjs
```

端口：`WEREAD_PORT=17831`（默认）。

---

## 目录结构（常用）

```
weread-reader-app/
  src/server/          # HTTP UI + /mcp
  src/weread/          # 登录 / 书架 / 正文
  packaging/           # Mac/Win 启动脚本模板
  scripts/             # 打包脚本
  tunnel/              # ChatGPT Secure Tunnel 启动器与 profile
  docs/chatgpt-tunnel.md
  dist/                # 本地构建产物（不进 git）
```

---

## 常见问题

**书架空的？** 登录后等几秒再刷新；刚扫码时书架可能还在同步。

**ChatGPT 加不上连接器？**  
1) Weread `/health` 是否 `ok`；2) tunnel 是否在跑；3) 代理是否让 `api.openai.com` 通；4) 等 1 分钟再点「创建」（界面常把「隧道未连接」说成速率限制）。

**换 Tunnel ID？** 改 `tunnel/profiles/weread-local.yaml` 和 `tunnel/start_weread_tunnel.py` 里的 `TUNNEL=`，再重启启动器。
