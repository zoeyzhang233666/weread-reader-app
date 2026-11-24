# 官方微信读书 Agent Gateway（阅读统计 / 笔记 / 搜索）

腾讯官方 Skill（[Tencent/WeChatReading](https://github.com/Tencent/WeChatReading)）**不能读章节正文**，但提供阅读时长、笔记划线、书城搜索、进度、推荐等。

本仓库 MCP **两套鉴权并存**：

| 能力 | 鉴权 | 工具示例 |
|------|------|----------|
| 章节正文 / 图片 / 富文本导出 | 扫码 Cookie（`Start Weread.command`） | `weread_get_chapter`、`weread_get_chapter_images` |
| 阅读统计、进度、笔记、搜索、点评、推荐 | 官方 `WEREAD_API_KEY`（`wrk-…`） | `weread_reading_stats`、`weread_get_progress` 等 |

## 配置 API Key

1. 打开 https://weread.qq.com/r/weread-skills 获取 Key（`wrk-` 开头）。  
2. 任选一种写入本机：

```sh
# 推荐：落盘（权限 600）
printf '%s\n' 'wrk-你的密钥' > ~/.weread-reader/official-api-key.txt
chmod 600 ~/.weread-reader/official-api-key.txt

# 或环境变量
export WEREAD_API_KEY='wrk-你的密钥'
```

也可让 Agent 调用工具 `weread_set_official_key`（会写入上述文件）。**不要把 Key 提交到 git / 发到公开聊天。**

自检：

```sh
# 重启 MCP 后
# 工具 weread_server_info → officialApi.configured 应为 true
```

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
