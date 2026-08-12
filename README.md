# 锐力对账前端

这是一个 Vite + React 对账工作台。前端上传结算资料与 ERP 资料，将文件 URL 填入提示词，并向 CherryStudio agent session 发送对账消息；文件解析、OCR、金额计算和结果判断由 agent 完成。

## 启动

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

本地开发地址默认为 `http://localhost:3333/`。

## CherryStudio 配置

复制 `.env.example` 为 `.env.local`，按需填写上传服务和 CherryStudio 地址：

```env
# 可留空；开发/预览服务器会使用内置本地上传端点
VITE_RECONCILIATION_UPLOAD_URL=
VITE_CHERRYSTUDIO_BASE_URL=http://127.0.0.1:24333
VITE_CHERRYSTUDIO_DEFAULT_AGENT_NAME=锐力体育
VITE_CHERRYSTUDIO_DEFAULT_AGENT_WORKSPACE=
```

API Key 不需要写入环境文件。请在“发起一笔新对账”页面的必填输入框中填写；Key 只保留在当前页面会话的内存中，刷新页面后需重新输入。

点击“开始对账”后：

1. 前端把两份文件上传到本地 Vite 上传端点，获得 CherryStudio 可访问的 HTTP URL；配置 `VITE_RECONCILIATION_UPLOAD_URL` 时改用外部上传服务。
2. 前端使用页面填写的 API Key，并根据 Agent 名称和/或工作目录调用 `/v1/agents`，唯一匹配 Agent ID。
3. 前端读取该 Agent 的 session；当前要求恰好只有一个 session。
4. 前端把文件 URL 填入 `buildReconciliationPrompt`，向 `/v1/agents/{agentId}/sessions/{sessionId}/messages` 发送 `{ "content": prompt }`。
5. agent 返回 `{ "matched": boolean, "difference": number }`；前端将其映射到成功或待审核状态。

当前上传控件支持 `.xlsx`、`.xls`、`.pdf`、`.png`、`.jpg`、`.jpeg`，单个文件最大 20 MB。详细接口见 [CherryStudio Agent 调用契约](docs/cherrystudio-agent-contract.md)。

内置上传端点适用于 `npm run dev` 和 `npm run start` 的本机流程，文件临时保存在操作系统临时目录。纯静态托管生产环境应配置独立的 `VITE_RECONCILIATION_UPLOAD_URL`。

> API Key 会由浏览器直接用于 CherryStudio 请求。当前方式适用于本机受控环境；公开部署应通过服务端代理调用 CherryStudio，避免向浏览器暴露长期凭证。

## 常用命令

- `npm run dev`：启动开发服务器
- `npm run build`：构建生产产物
- `npm run start`：预览生产构建
- `npm run lint`：运行代码规范检查
- `npm test`：构建并运行项目约束测试
