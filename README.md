# Weread Reader App

独立版**微信读书**阅读器（Mac Apple Silicon / Windows x64）+ **本机 MCP**，给网页版 ChatGPT 用。

> 仓库（私有）：https://github.com/zoeyzhang233666/weread-reader-app  
> 安装包：https://github.com/zoeyzhang233666/weread-reader-app/releases

---

## 下次从零启动（照抄即可）

你每次要用 ChatGPT 读微信读书，只做这 **两件事开着**，再打开 ChatGPT。

### A. 启动微信读书服务（本机阅读器 + MCP）

**方式 1（推荐，有安装包时）**

1. 打开 [Releases](https://github.com/zoeyzhang233666/weread-reader-app/releases)  
2. Mac 下 `WereadReader-*-mac-arm64.dmg` → 拖到「应用程序」→ 点开 **Weread Reader**  
   （首次拦截：右键 App → 打开 → 仍要打开）  
3. 浏览器应自动出现 <http://127.0.0.1:17831>  
4. **扫码登录**微信读书（只需登录一次；登录态在 `~/.weread-reader/`）

**方式 2（本机已有源码目录时）**

```sh
cd /Users/edy/weread-reader-app
node src/server/index.js
```

然后浏览器打开 <http://127.0.0.1:17831> 扫码。

自检：

```sh
curl -s http://127.0.0.1:17831/health
# 期望：{"ok":true,"loggedIn":true}
```

### B. 启动 OpenAI 隧道（让网页 ChatGPT 连上本机）

1. **先开代理/VPN**（Clash 等系统代理），否则隧道连不上 `api.openai.com`  
2. 在 Finder 打开本仓库的隧道文件夹：

```text
/Users/edy/weread-reader-app/tunnel/
```

3. 双击 **`Start Weread Tunnel.command`**  
4. 粘贴 **Runtime API Key**（`sk-…`，输入不显示）  
   - 获取：[Platform → API keys](https://platform.openai.com/settings/organization/api-keys)  
   - 权限要有 **Tunnels Read + Use**；不要用 Admin Key  
5. 看到类似 `tunnel metadata fetched` / `🟢 tunnel-client started` 后，**不要关这个窗口**

Tunnel ID 已写在配置里（一般不用改）：

```text
tunnel_6b052c37078c8191afe660304703dd84
```

| 别混 | 长什么样 | 干什么 |
|------|----------|--------|
| Tunnel ID | `tunnel_…` | 告诉 ChatGPT 连哪条隧道 |
| Runtime API Key | `sk-…` | 给 `tunnel-client` 登录 OpenAI（每次启动粘一次，不落盘） |

### C. 在 ChatGPT 里用

1. 打开 [ChatGPT → 设置 → Connectors](https://chatgpt.com/#settings/Connectors)  
2. 启用你之前建好的连接器（名称多半是 **`read`**）  
   - 若还没有：添加自定义 MCP → 连接选 **隧道** → 选上面的 Tunnel ID → 认证「无需」→ 勾选风险提示 → 创建  
3. **新开一条聊天**，打开该工具/插件  
4. 试一句：

> 列出我的微信读书书架

看图/表格（化工书，表格多为图片）：

> 读取 bookId 923588 的章节 17（2.10 增塑剂），把表格图片也拉出来；若还有剩余图片继续分页

自 v0.2.1 起，`weread_get_chapter` **默认就会返回图片**（MCP ImageContent）。若仍只有纯文字，多半连到了旧进程——见 [docs/rich-content.md](./docs/rich-content.md)。

### D. 用完怎么关

- 隧道窗口：`Ctrl+C` 或关掉终端  
- Weread：退出 App；或源码模式在跑 `node` 的终端 `Ctrl+C`  
- Windows 便携包：用 `Stop-WereadReader.bat`

---

## 详细文档（按需点开）

| 文档 | 内容 |
|------|------|
| [docs/chatgpt-tunnel.md](./docs/chatgpt-tunnel.md) | 隧道、代理排错、验收命令、第一次加 Connectors |
| [docs/rich-content.md](./docs/rich-content.md) | 图片/表格为什么会丢、`rich` / ImageContent 怎么用 |

---

## 安装包位置

| 平台 | 文件（在 Release 或本地 `dist/`） |
|------|------|
| Mac M 芯片 | `WereadReader-0.1.0-mac-arm64.dmg` / `.zip` |
| Windows x64 | `WereadReader-0.1.0-win-x64.zip` → 解压后双击 `WereadReader.bat` |

本地重新打包：

```sh
cd /Users/edy/weread-reader-app
./scripts/build-macos-app.sh
./scripts/build-windows-portable.sh
```

---

## MCP 工具一览

| Tool | 作用 |
|------|------|
| `weread_status` | 是否已登录 |
| `weread_list_bookshelf` | 书架 |
| `weread_get_book_info` | 元数据（字数/作者/出版社/ISBN/章节数） |
| `weread_list_chapters` | 目录 |
| `weread_get_chapter` | 单章；默认纯文本；`rich=true` 图文块；`includeImages=true` 带图片字节 |
| `weread_get_chapter_images` | 分批拉章节图片（表格图等），模型可直接看 |
| `weread_export_chapters` | 导出 Markdown；`rich=true` 保留图片链接 |

端口默认 **17831**：UI `/` ，MCP `/mcp` ，健康检查 `/health`。

---

## 常见问题

**下次找不到怎么启动？**  
回到本文最上面「下次从零启动」：先开 Weread（App 或 `node src/server/index.js`），再双击 `tunnel/Start Weread Tunnel.command`。

**ChatGPT 说速率限制 / 检查隧道？**  
多半是隧道没连上：确认代理开着、隧道窗口还在、日志不是一直 `poll timed out`，等半分钟再试。

**书架空的？**  
扫码后等几秒刷新；刚登录书架可能还在同步。

**换 Tunnel ID？**  
改 `tunnel/profiles/weread-local.yaml` 和 `tunnel/start_weread_tunnel.py` 里的 ID，再重开隧道启动器。
