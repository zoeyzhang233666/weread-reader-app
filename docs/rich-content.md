# 富文本 / 图片 / 表格提取说明（v0.2）

## 内容丢失的根本原因

微信读书 **epub** 章节接口其实已经返回完整 XHTML（含 `<img>`、偶发 `<table>`）。

旧版链路在 `getChapterContent` 之后调用 `stripHtml()`，再只把 `text` 交给 MCP：

1. **请求阶段有数据**：解密后的 `html` 里已有图片 URL（如 `https://res.weread.qq.com/wrepub/epub_…`）。
2. **转换阶段丢失**：`stripHtml` 去掉全部标签 → 图片、表格、结构式全部消失。
3. **MCP 未暴露 html**：即便内存里有 `html`，`weread_get_chapter` 也只返回纯文本。

另外，像《精细化工配方常用原料手册》这类书，**数据表本身就是 JPEG 插图**，不是 HTML `<table>`。只做纯文本永远拿不到「炭黑 / 白炭黑」等物性表。

## 新增 / 增强接口

| 工具 | 变化 |
|------|------|
| `weread_get_chapter` | 默认行为不变。`rich=true` → 有序 blocks + markdown（含 `![](url)` / 原生表）；`includeHtml=true` → 原始 HTML；`includeImages=true` → 附带 MCP `ImageContent`（可 `imageOffset` / `imageLimit` 分页，默认每批 4 张，最大 10） |
| `weread_get_chapter_images` | **新**：专拉章节图片字节，供模型直接看图 |
| `weread_export_chapters` | `rich=true` 导出保留图片链接与原生表；`includeImages=true` 可附带一批 ImageContent |
| `weread_get_book_info` | **新**：字数、作者、出版社、ISBN、章节数、简介等 |

图片下载失败只记入 `imageErrors`，**不会**导致整章失败。不做默认 OCR。

### ChatGPT 推荐用法（化工表）

```text
1) weread_get_book_info { bookId: "923588" }
2) weread_get_chapter { bookId, chapterUid: "5", rich: true }   # 看图文顺序与标签
3) weread_get_chapter_images { bookId, chapterUid: "5", imageOffset: 0, imageLimit: 4 }
4) 继续 imageOffset: 4 / 8 / … 直到 imagesHasMore=false
```

## 实机验证（《精细化工配方常用原料手册》 bookId=923588）

| 章节 | 结果 |
|------|------|
| uid 5 常用填充原料 | 22 张图；正文含炭黑/白炭黑/碳酸钙/钛白粉；白炭黑表图可识别为完整物性表 |
| uid 8 通用功能性配方原料 | 38 张图；图文块解析正常 |
| uid 35 专用配方原料 | 30 张图；解析正常 |
| 元数据 | 出版社化学工业出版社，ISBN 9787122211323，约 12.4 万字，49 章 |
| 兼容 | 无 `rich` 时仍只返回 `{ text, format }` |

## 部署更新

```sh
cd weread-reader-app
git pull
# 停掉旧进程后重启（打包 App 则重新打开 App；源码则：）
node src/server/index.js
# 若用 OpenAI tunnel：重启 Start Weread Tunnel.command
```

重新打包安装包：

```sh
./scripts/build-macos-app.sh
./scripts/build-windows-portable.sh
```
