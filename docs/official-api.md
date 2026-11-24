# 官方微信读书 Agent Gateway（阅读统计 / 笔记 / 搜索）

腾讯官方 Skill（[Tencent/WeChatReading](https://github.com/Tencent/WeChatReading)）**不能读章节正文**，但提供阅读时长、笔记划线、书城搜索、进度、推荐等。

本仓库 MCP **两套鉴权并存**：

| 能力 | 鉴权 | 工具示例 |
|------|------|----------|
| 章节正文 / 图片 / 富文本导出 | 扫码 Cookie（`Start Weread.command`） | `weread_get_chapter`、`weread_get_chapter_images` |
| 阅读统计、进度、笔记、搜索、点评、推荐 | 官方 `WEREAD_API_KEY`（`wrk-…`） | `weread_reading_stats`、`weread_get_progress` 等 |

## 扫码能不能代替 Key？

**不能。** 这是两套鉴权：

- **扫码 Cookie**：读章节正文 / 图片  
- **官方 `wrk-` Key**：阅读时长、进度、笔记、搜索、推荐（腾讯 Agent Gateway）

## 配置 API Key（推荐 GUI）

1. 双击 `Start Weread.command`，打开 <http://127.0.0.1:17831>  
2. 点顶部 **「设置」**  
3. 打开 https://weread.qq.com/r/weread-skills 复制 `wrk-…` Key  
4. 粘贴到「官方 API Key」输入框 → **保存 Key** → 可点 **测试**

Key 只保存在本机 `~/.weread-reader/official-api-key.txt`，不会进 git。

命令行备选（一般不用）：

```sh
printf '%s\n' 'wrk-你的密钥' > ~/.weread-reader/official-api-key.txt
chmod 600 ~/.weread-reader/official-api-key.txt
```

也可让 Agent 调 `weread_set_official_key`。**不要把 Key 发到公开聊天。**

## 新增 MCP 工具（官方）

| Tool | 说明 |
|------|------|
| `weread_set_official_key` | 保存 `wrk-` Key |
| `weread_reading_stats` | 本周/本月/本年/总计阅读时长与偏好（秒→小时分钟） |
| `weread_get_progress` | 单本书进度 % 与累计阅读秒数 |
| `weread_search_books` | 书城搜索 |
| `weread_list_notebooks` | 有笔记的书列表 |
| `weread_get_book_notes` | 单本划线 + 想法 |
| `weread_list_reviews` | 公开点评 |
| `weread_recommend_books` | 个性化 / 相似推荐 |
| `weread_hot_bookmarks` | 热门划线 |
| `weread_official_call` | 高级：白名单内原始 `api_name` |

网关：`POST https://i.weread.qq.com/api/agent/gateway`  
文档字段以官方 skill 为准；**所有时长字段单位是秒**。

## 示例

> 我这个月读了多久？读得最多的书是哪几本？  
→ `weread_reading_stats` `{ "mode": "monthly" }`

> 《精细化工配方常用原料手册》我读到百分之几了？  
→ 先 `weread_search_books` 或已知 `bookId` → `weread_get_progress`
