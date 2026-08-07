# 锐力对账前端

这是锐力对账系统的纯 Vite + React 前端项目。前端负责上传结算资料和 ERP 资料、提交 CherryStudio agent skill 调用、展示对账任务状态和人工审核字段；文件解析、OCR、金额计算、对账规则和结果判断都交给 CherryStudio agent。

## 环境要求

- Node.js `>=22.13.0`

## 快速开始

```bash
npm install
npm run dev
```

本地开发服务默认运行在 `http://localhost:3000/`。

## CherryStudio 接口配置

复制 `.env.example` 为 `.env.local`，按 CherryStudio 接收 agent skill 调用的地址配置：

```bash
VITE_CHERRYSTUDIO_AGENT_URL=http://localhost:8080/api/cherrystudio/agent/skill
VITE_CHERRYSTUDIO_AGENT_SKILL=reconciliation.start
```

点击“开始对账”时，前端会向 `VITE_CHERRYSTUDIO_AGENT_URL` 发送 `POST multipart/form-data` 请求，包含：

- `settlementFile`: 结算资料文件
- `erpFile`: ERP 资料文件
- `action`: `start_reconciliation`
- `skill`: `VITE_CHERRYSTUDIO_AGENT_SKILL`
- `payload`: 文件元信息和调用上下文，包含文件名、大小、MIME type 和扩展名

当前上传控件支持 `.xlsx`、`.xls`、`.pdf`、`.png`、`.jpg`、`.jpeg`，单个文件限制为 20 MB。前端只负责校验格式和大小，不读取文件内容；Excel 解析、PDF 解析和图片 OCR 都由 CherryStudio agent 处理。

如果 agent 返回 `status: "NEEDS_REVIEW"` 和 `issues` 数组，前端会在“差异处理”模块展示每条字段差异，包括结算单金额、ERP 金额、差额、问题说明和人工审核操作。

如果不配置 `VITE_CHERRYSTUDIO_AGENT_URL`，页面会进入接口未配置状态，只展示界面，不创建真实对账任务。

## 目录结构

- `src/app/`: 应用入口和页面壳
- `src/features/reconciliation/components/`: 对账页面组件
- `src/features/reconciliation/hooks/`: 页面数据请求、提交、轮询和审核状态逻辑
- `src/features/reconciliation/api/`: CherryStudio 请求、FormData 打包、响应适配和接口错误
- `src/features/reconciliation/model/`: 业务类型、上传文件规则和展示数据转换
- `src/shared/`: 全局样式等共享资源
- `docs/`: CherryStudio agent 调用契约和飞书文档源文件
- `public/`: 图标、OG 图等静态资源
- `tests/`: Vite 构建产物和接口约束测试

## 常用命令

- `npm run dev`: 启动本地开发服务
- `npm run build`: 构建静态前端产物
- `npm run start`: 本地预览构建产物
- `npm run lint`: 运行代码规范检查
- `npm test`: 构建并运行项目约束测试
