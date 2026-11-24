# 给 WorkBuddy 用（本机 Agent，无需隧道）

网页版 ChatGPT 不能访问本机，所以要 OpenAI Tunnel。  
**WorkBuddy 跑在本机，直接配本地 MCP 即可，不要开 `tunnel-client`。**

## 步骤

1. 双击仓库根目录 `Start Weread.command`，浏览器扫码登录一次。  
2. 新建或编辑 `~/.workbuddy/mcp.json`：

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

3. WorkBuddy → MCP/连接器 → 对 `weread-reader` **信任**。  
4. **新开会话**，试：`调用 weread_server_info`。

阅读时长 / 笔记 / 搜索等官方能力需另配 `wrk-` Key，见 [official-api.md](./official-api.md)。

完整对照表与 ChatGPT 用法见仓库根目录 [README.md](../README.md)。
