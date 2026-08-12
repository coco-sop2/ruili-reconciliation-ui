# CherryStudio Agent 调用契约

CherryStudio 请求全部由后端发起。浏览器不持有 API Key，也不直接访问 Agent 或 Session 接口。

## Agent 与 Session

后端调用：

```http
GET /v1/agents?limit=100&offset=0
POST /v1/agents/{agentId}/sessions
POST /v1/agents/{agentId}/sessions/{sessionId}/messages
Authorization: Bearer <CHERRYSTUDIO_API_KEY>
```

Agent 按名称和可选工作目录精确匹配。每次对账创建独立 Session，Session ID 和 Agent ID 会写入任务记录，便于定位执行过程。

## 文件访问

上传文件由后端保存并关联任务。Agent 优先读取其 `accessible_paths` 中的本地绝对路径，必要时使用后端备用地址：

```text
GET /api/tasks/{taskId}/files/SETTLEMENT
GET /api/tasks/{taskId}/files/ERP
```

支持 `.xlsx`、`.xls`、`.pdf`、`.png`、`.jpg`、`.jpeg`，单个文件最大 20 MB。

## 结果 JSON

Agent 最终必须返回：

```json
{
  "matched": false,
  "difference": -5.0,
  "period": "2026-05",
  "issues": [
    {
      "rowLabel": "销售额合计",
      "fieldName": "销售额",
      "settlementValue": 512047,
      "erpValue": 512042,
      "differenceAmount": -5,
      "message": "结算金额比 ERP 多 5 元",
      "suggestion": "核对销售明细"
    }
  ]
}
```

差额方向固定为 `ERP 金额 - 结算金额`。后端会利用明细中的两侧金额纠正反向符号，并拒绝以下自相矛盾的结果：

- `matched=true` 但总差额非零或仍有差异明细。
- `matched=false`、总差额为零且没有任何差异明细。若明细正负抵消，总差额可以为零并继续进入人工审核。
- 总差额不是有限数字。

当 `matched=false` 且 Agent 只返回总差额时，后端会生成一条可审核的汇总明细，避免任务无法处理。

## SSE 事件

Messages 接口实际可能返回 `text/event-stream`。后端支持 `reasoning-*`、`tool-call`、`tool-result`、`tool-error`、`text-delta` 和 `text-end`，并兼容累计式与增量式 `text-delta`。过程日志保存在服务器内存中供前端短期轮询；任务状态、Agent 选择器和执行次数保存在 PostgreSQL 中。

## 失败与恢复

前端轮询遇到瞬时网络错误时会指数退避重连，并在刷新页面后从本地任务 ID 恢复。后端重启后会重新执行 `QUEUED` 或 `PROCESSING` 任务，每个任务最多自动尝试三次。恢复任务会创建新的 CherryStudio Session，并以最新一次完整结果替换可能残留的审核明细。
