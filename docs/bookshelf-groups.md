# 书架分组（书单文件夹）

微信读书书架上的「文件夹」在接口里叫 `archive`（书单）。

## 接口来源

| 路径 | 鉴权 | `archive` | `archiveId` |
|------|------|-----------|-------------|
| 官方 Gateway `POST /shelf/sync` | `wrk-` Key | ✅ `name` + `bookIds` | ❌ 无 |
| Cookie `GET /web/shelf/sync` | 扫码登录 | ✅ 同上 + 更多字段 | ✅ 有 |

本仓库 **优先用 Cookie `/web/shelf/sync`**，以便稳定返回 `groupId`（= `archiveId`）。官方 Gateway 也能看到分组名称与书籍 ID，但缺少 `archiveId`，故分组工具走 Cookie 书架同步。

## MCP 工具

| Tool | 作用 |
|------|------|
| `weread_list_bookshelf_groups` | 全部文件夹：`groupId` / `name` / `bookCount` |
| `weread_list_bookshelf_group_books` | 按 `groupId` 或 `name` 列出该文件夹全部书 |
| `weread_list_bookshelf` | 全量书架；每本书含 `groups` / `groupIds` / `groupNames` |

导入书（TXT / EPUB / PDF，`bookId` 常以 `CB_` 开头）与官方书城书均包含在内。

## HTTP（本机 UI 同源）

- `GET /api/shelf/groups`
- `GET /api/shelf/group-books?name=神作`
- `GET /api/shelf/group-books?groupId=1792503268`
