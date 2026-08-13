# Agent 对账输出契约

> **给写提示词（Prompt）的人看**：你的 Prompt 最终必须引导 Agent 返回**一个合法的 JSON 对象**。后端会按本契约解析并写入数据库。**不符合契约的返回会被判为「对账失败」。**

---

## 一、顶层结构（必须）

```json
{
  "matched": true,
  "difference": 0,
  "period": "2026-08",
  "issues": []
}
```

## 二、字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `matched` | boolean | ✅ 必须 | `true` = 两方金额一致（任务判成功）；`false` = 有差异（任务进人工审核） |
| `difference` | number | ✅ 必须 | **ERP 金额 − 结算金额**（元）。正数 = ERP 多计；负数 = ERP 少计；0 = 一致 |
| `period` | string / null | ⚠️ 建议 | 账期，格式 **`YYYY-MM`**（如 `2026-08`）。从单据日期提取；**提取不出就返回 `null`**，不要编造 |
| `issues` | array | ⚠️ 建议 | 差异明细数组。**每一笔对不上的条目**一条；实在拆不出就放一条汇总（`rowLabel` 填「对账汇总」）。金额完全一致时返回 `[]` |

## 三、issues 里每一条的结构

```json
{
  "rowLabel": "单据号/行标识",
  "fieldName": "字段名",
  "settlementValue": 100,
  "erpValue": 80,
  "differenceAmount": -20,
  "message": "差异说明",
  "suggestion": "核对建议"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `rowLabel` | string | 建议 | 人看得懂的「这行是什么」（订单号、行号） |
| `fieldName` | string | 建议 | 有差异的字段名（运费、实收金额…） |
| `settlementValue` | number | 可选 | 结算单该字段金额 |
| `erpValue` | number | 可选 | ERP 该字段金额 |
| `differenceAmount` | number | 建议 | 该条差额 = **ERP 值 − 结算值** |
| `message` | string | 可选 | 差异说明 |
| `suggestion` | string | 可选 | 建议人工怎么核对 |

> ⚠️ `issues` 里允许出现**任意额外字段**，都会原样存进数据库的「万能抽屉」（JSONB），前端界面无法直接展示未知字段，但会保留。上面列出的字段是前端界面能直接展示的。

## 四、输出格式硬性要求

1. **只输出一个合法 JSON 对象**，不要 Markdown 代码块（不要 ```json），不要 JSON 前后加任何说明文字、寒暄、标点。
2. **金额用数字**，不要带货币符号（`¥`、`元`），不要千分位逗号（`1,000` 不行，`1000` 才行）。
3. **`difference` 的符号约定**：固定 **ERP − 结算**。这是唯一约定，别用反。

## 五、完整示例

**对上了：**

```json
{"matched": true, "difference": 0, "period": "2026-08", "issues": []}
```

**有差异：**

```json
{
  "matched": false,
  "difference": 1500,
  "period": "2026-08",
  "issues": [
    {
      "rowLabel": "单号 20260801",
      "fieldName": "实收金额",
      "settlementValue": 5000,
      "erpValue": 3500,
      "differenceAmount": -1500,
      "message": "结算单实收 5000，ERP 实收 3500，差 1500",
      "suggestion": "请核对 20260801 单号的实收记录"
    }
  ]
}
```

---

## 附：后端解析位置（供协作者参考）

- **返回结构定义**：`server/src/services/reconciliation.ts` → `applyReconciliationResult()`
- **JSON 解析逻辑**：`server/src/lib/cherrystudio.ts` → `parseAgentResponse()`

两端不一致时，以后端代码为准。
