# CherryStudio Agent 调用契约

前端只负责把用户选择的两份对账资料文件提交给 CherryStudio。文件可以是 Excel、PDF 或图片；文件解析、字段识别、图片 OCR、对账计算、结果判断和后续状态更新都由 CherryStudio agent skill 负责。

## 环境变量

```env
VITE_CHERRYSTUDIO_AGENT_URL=http://localhost:8080/api/cherrystudio/agent/skill
VITE_CHERRYSTUDIO_AGENT_SKILL=reconciliation.start
```

如果 `VITE_CHERRYSTUDIO_AGENT_URL` 为空，前端进入本地空数据模式，不会创建真实任务。

当前上传控件支持的文件后缀为 `.xlsx`、`.xls`、`.pdf`、`.png`、`.jpg`、`.jpeg`。单个文件限制为 20 MB。前端只校验格式和大小，不读取文件内容。

## 开始对账请求

点击“开始对账”按钮后，前端会发送：

```http
POST {VITE_CHERRYSTUDIO_AGENT_URL}
Content-Type: multipart/form-data
Accept: application/json
Idempotency-Key: <uuid>
X-Agent-Skill: <VITE_CHERRYSTUDIO_AGENT_SKILL>
```

表单字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `action` | string | 固定为 `start_reconciliation` |
| `skill` | string | 要调用的 CherryStudio agent skill 名称 |
| `payload` | JSON string | 调用上下文和文件元信息 |
| `settlementFile` | file | 用户上传的结算资料文件，可以是 Excel、PDF 或图片 |
| `erpFile` | file | 用户上传的 ERP 资料文件，可以是 Excel、PDF 或图片 |

`payload` 示例：

```json
{
  "source": "ruili-reconciliation-ui",
  "action": "start_reconciliation",
  "skill": "reconciliation.start",
  "submittedAt": "2026-08-07T06:30:00.000Z",
  "resultMode": "placeholder",
  "files": {
    "settlementFile": {
      "name": "settlement.pdf",
      "size": 102400,
      "type": "application/pdf",
      "extension": ".pdf"
    },
    "erpFile": {
      "name": "erp-screenshot.png",
      "size": 204800,
      "type": "image/png",
      "extension": ".png"
    }
  }
}
```

## 推荐返回结构

当前前端已经可以识别 `status`、`summary` 和 `issues`。当 agent 返回 `NEEDS_REVIEW` 时，前端会进入“差异处理”模块，逐字段展示结算单金额、ERP 金额和差额。

对账成功且无需人工审核：

```json
{
  "success": true,
  "taskId": "agent_task_123",
  "status": "SUCCEEDED",
  "message": "对账完成，无需人工处理",
  "summary": {
    "settlementAmount": "12680.00",
    "erpAmount": "12680.00",
    "differenceAmount": "0.00",
    "totalCount": 128,
    "matchedCount": 128,
    "differenceCount": 0
  },
  "issues": []
}
```

对账完成但需要人工审核：

```json
{
  "success": true,
  "taskId": "agent_task_124",
  "status": "NEEDS_REVIEW",
  "message": "存在金额差异，需要人工审核",
  "summary": {
    "settlementAmount": "12680.00",
    "erpAmount": "12580.00",
    "differenceAmount": "100.00",
    "totalCount": 128,
    "matchedCount": 125,
    "differenceCount": 3
  },
  "issues": [
    {
      "id": "issue_001",
      "rowLabel": "订单 A001",
      "fieldName": "实收金额",
      "settlementValue": "100.00",
      "erpValue": "80.00",
      "differenceAmount": "20.00",
      "message": "结算单实收金额与 ERP 实收金额不一致",
      "suggestion": "请核对订单 A001 是否存在退款或渠道手续费",
      "status": "PENDING"
    }
  ]
}
```

`issues` 中每一项会显示在前端“差异处理”表格里。

| 字段 | 说明 |
| --- | --- |
| `rowLabel` | 人工能识别的单据或行标签，例如订单号 |
| `fieldName` | 有差异的字段名，例如实收金额、手续费、退款金额 |
| `settlementValue` | 结算单里的金额 |
| `erpValue` | ERP 里的金额 |
| `differenceAmount` | 差额 |
| `message` | 差异说明 |
| `suggestion` | 建议人工怎么核对 |
| `status` | 默认 `PENDING`，也可返回 `APPROVED` 或 `IGNORED` |

失败响应建议包含：

```json
{
  "error": {
    "code": "AGENT_SKILL_FAILED",
    "message": "Agent skill 调用失败",
    "requestId": "req_123"
  }
}
```

前端不会根据上传文件自行计算对账结果，也不会推断成功、有差异或失败状态。
