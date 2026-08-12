# CherryStudio Agent 调用契约

前端负责上传用户选择的结算资料和 ERP 资料，再把两个可访问的文件 URL 写入对账提示词，最后调用指定 CherryStudio agent session 的消息接口。Excel、PDF、图片解析和金额判断均由 agent 完成。

## 环境变量

```env
VITE_RECONCILIATION_UPLOAD_URL=
VITE_CHERRYSTUDIO_BASE_URL=http://127.0.0.1:24333
VITE_CHERRYSTUDIO_DEFAULT_AGENT_NAME=锐力体育
VITE_CHERRYSTUDIO_DEFAULT_AGENT_WORKSPACE=
```

页面允许填写 API Key、Agent 名称和工作目录。API Key 为必填项，只保留在当前页面会话的内存中，不写入环境文件或浏览器持久化存储。Agent 默认值来自 `VITE_CHERRYSTUDIO_DEFAULT_AGENT_NAME` 与 `VITE_CHERRYSTUDIO_DEFAULT_AGENT_WORKSPACE`。API Base 为空时，前端进入接口未配置状态；上传地址为空时使用 Vite 内置本地上传端点。

> API Key 会由浏览器直接用于 CherryStudio 请求。当前方式适用于本机受控环境；公开部署时应由服务端代理请求，避免向浏览器暴露长期凭证。

## 第一步：上传文件

默认情况下，前端把原始文件作为请求体发送到 `POST /api/reconciliation/upload`。开发/预览服务器将文件写入操作系统临时目录，并返回可供本机 CherryStudio 读取的 HTTP URL。配置 `VITE_RECONCILIATION_UPLOAD_URL` 后改用该外部服务。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| 请求体 | file | 原始文件二进制 |
| `X-File-Name` | header | URL 编码后的文件名 |
| `X-File-Role` | header | `settlementFile` 或 `erpFile` |

上传接口需要返回 HTTP/HTTPS URL。支持 `url`、`fileUrl`、`downloadUrl`，也支持这些字段位于 `data` 或 `file` 对象中。

当前上传控件支持 Excel（`.xlsx`、`.xls`）、PDF 和图片（`.png`、`.jpg`、`.jpeg`），单个文件最大 20 MB。文件元数据包含 `name`、`size`、`type`、`extension` 和 `url`。

## 第二步：生成 prompt

`createReconciliationPromptPayload` 把上传 URL 填入：

- `payload.files.erpFile.url`
- `payload.files.settlementFile.url`

`buildReconciliationPrompt` 随后生成 agent 消息，明确 ERP 与结算单 URL、MinerU Subagent 建议，以及最终只允许返回以下 JSON：

```json
{
  "matched": true,
  "difference": 0.00
}
```

`difference` 的含义固定为“ERP 金额 - 结算单金额”，单位为元。

## 第三步：解析 Agent 与 session

前端分页调用：

```http
GET /v1/agents?limit=100&offset=0
Authorization: Bearer <页面填写的 API Key>
```

按名称做精确匹配；填写工作目录时，会将 `/`、`\\`、`.`、`..` 和 Windows 路径大小写规范化后，与 `accessible_paths` 比较。名称有重复时必须同时填写工作目录。

当前 CherryStudio 企业版返回 `{ data, total }`，代码也兼容 `{ agents, total }`。匹配到唯一 Agent 后，前端分页调用 `/v1/agents/{agentId}/sessions`，并要求恰好返回一个 session。

## 第四步：调用 CherryStudio session

默认请求地址：

```text
http://127.0.0.1:24333/v1/agents/{agentId}/sessions/{sessionId}/messages
```

请求：

```http
POST /v1/agents/{agentId}/sessions/{sessionId}/messages
Authorization: Bearer <页面填写的 API Key>
Content-Type: application/json
Accept: application/json
```

Messages 请求不发送自定义 `Idempotency-Key` 请求头，避免触发 CherryStudio CORS 预检拒绝。

```json
{
  "content": "由 buildReconciliationPrompt 生成的完整提示词"
}
```

## 返回结果适配

> **重要：该接口实际返回 SSE 流式响应（`Content-Type: text/event-stream`）**，无论请求头 `Accept` 是否为 `application/json`。OpenAPI 文档（`/api-docs.json`）标注其为 `application/json` 并不准确，已实测确认。`readCherryStudioJson` 会按 SSE 流解析。

SSE 流包含 Claude Code 事件：`start`、`raw`（init）、`start-step`/`finish-step`、`reasoning-*`（思维链增量）、`tool-call`/`tool-result`/`tool-error`（工具调用）、`text-*`（最终文本增量）。前端在 `readCherryStudioJson` 消费该流时，同时把过程事件转发给 `onProgress`，在「开始对账」页的日志面板实时展示 agent 的思考与工具调用过程。

- 最终对账 JSON 从 `text-delta`/`text-end` 事件中提取，兼容直接返回 `{ matched, difference }`，也兼容该 JSON 字符串位于 `content`、`data.content`、`message.content` 或 `choices[0].message.content`。
- `matched: true` 且 `difference: 0` 映射为 `SUCCEEDED`。
- `matched: false` 且 `difference` 非零映射为 `NEEDS_REVIEW`，并生成一条汇总差异项。
- `matched` 与 `difference` 自相矛盾、金额不是有限数字，或 agent 输出不是合法 JSON 时，请求会按无效响应失败。

现有页面模型仍使用 `differenceAmount`、`settlementValue`、`erpValue` 和人工审核列表；简化后的 agent 返回只提供总差额，所以两个绝对金额保持为空。
