# 锐力对账：前后端交接说明

## 1. 职责边界

### 前端负责

- 选择结算单和 ERP 表单，并通过 `multipart/form-data` 原样提交。
- 展示上传/提交状态、任务状态、统计数据和任务详情。
- 对 `QUEUED`、`PROCESSING` 状态的任务每 3 秒轮询一次，进入终态后停止。
- 做非权威的交互校验，例如是否已选择两份文件、扩展名和文件大小提示。
- 对金额、日期和状态文案做展示格式化。

### 后端负责

- 文件类型、大小、内容结构和权限的权威校验。
- Excel 解析、字段识别、字段映射、账期识别和数据清洗。
- 全部对账规则、金额计算、容差、匹配逻辑及差异分类。
- 任务排队、异步执行、状态流转、失败重试和结果持久化。
- 历史任务搜索、筛选、分页及总览统计聚合。
- 返回可供用户理解的失败原因，同时保留可排障的 `requestId`。

前端不得根据上传文件自行计算对账结果，也不得推断成功、有差异或失败状态。

## 2. V1 接口清单

| 页面动作 | 方法 | 路径 | 用途 |
| --- | --- | --- | --- |
| 点击“开始对账” | `POST` | `/api/v1/reconciliation-tasks` | 上传两份文件并创建异步任务 |
| 打开总览、筛选、搜索 | `GET` | `/api/v1/reconciliation-tasks` | 获取任务分页列表 |
| 打开任务详情、轮询状态 | `GET` | `/api/v1/reconciliation-tasks/{taskId}` | 获取任务最新状态与详情 |
| 打开总览 | `GET` | `/api/v1/reconciliation-statistics` | 获取本月统计与趋势 |

完整请求、响应和错误结构见 [api-contract.yaml](./api-contract.yaml)。

## 3. 任务状态约定

```text
QUEUED → PROCESSING → SUCCEEDED
                    ↘ NEEDS_REVIEW
                    ↘ FAILED
```

- `QUEUED`：任务已创建，等待执行。
- `PROCESSING`：服务端正在解析或对账。
- `SUCCEEDED`：对账完成且无需人工处理。
- `NEEDS_REVIEW`：对账完成，但存在需要人工处理的差异。
- `FAILED`：任务因文件、数据或系统原因失败。

`SUCCEEDED`、`NEEDS_REVIEW`、`FAILED` 为终态。V1 不允许前端直接修改任务状态。

## 4. 数据约定

- 时间统一返回 ISO 8601，建议 UTC；前端按用户时区展示。
- 金额使用十进制字符串，禁止使用 JSON 浮点数，例如 `{ "currency": "CNY", "value": "12680.00" }`。
- 所有 ID 都是不透明字符串，前端不解析其含义。
- 列表默认按 `createdAt` 倒序。
- 后端不确定的计算字段返回 `null`，不要用 `0` 代替“尚未计算”。
- 所有成功响应使用 `{ "data": ..., "requestId": "..." }`。
- 所有失败响应使用 `{ "error": { "code", "message", "requestId", "details?" } }`。

## 5. 文件提交约定

- Content-Type：`multipart/form-data`，由浏览器自动生成 boundary。
- 字段名固定为 `settlementFile` 和 `erpFile`。
- 前端为同一次文件提交生成并传递稳定的 `Idempotency-Key`；网络失败后的重试沿用原 key。后端需保证同一用户、同一 key 的重复请求只创建一个任务。
- 当前界面提示单文件上限为 20 MB，后端必须再次校验，并以 `413 FILE_TOO_LARGE` 为权威结果。
- V1 采用单请求直传。若未来文件明显增大，再升级为“预签名上传 + 创建任务”两阶段流程。

## 6. 前端接入方式

前端已经通过 `ReconciliationApi` 隔离页面和网络实现：

- 未配置 `NEXT_PUBLIC_API_BASE_URL`：使用内置演示适配器，页面顶部显示“接口演示模式”。
- 配置 `NEXT_PUBLIC_API_BASE_URL`：自动切换为真实 HTTP 接口。

后端本地联调示例：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

如果前后端不同域，后端需要允许前端域名进行 CORS 请求，并允许 `Idempotency-Key` 请求头。鉴权建议由现有网关或会话 Cookie 统一处理，本契约不新增登录接口。

## 7. 建议的验收场景

1. 两份合法文件创建任务，先返回 `QUEUED`，随后流转到一个终态。
2. 重复提交相同 `Idempotency-Key`，返回同一个任务而不是重复创建。
3. 缺少任一文件时返回 `400 MISSING_REQUIRED_FILE`。
4. 非 Excel 文件返回 `415 UNSUPPORTED_FILE_TYPE`。
5. 超过 20 MB 返回 `413 FILE_TOO_LARGE`。
6. Excel 结构不满足要求返回 `422 INVALID_FILE_STRUCTURE`。
7. 列表搜索、状态筛选和分页结果正确，统计口径与列表一致。
8. 服务端失败响应包含稳定的 `code`、用户可读的 `message` 和唯一 `requestId`。
