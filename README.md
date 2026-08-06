# 锐力对账前端

锐力对账是一套面向财务团队的对账工作台前端。用户可以上传渠道结算单和 ERP 表单、创建异步对账任务，并查看历史任务、处理状态与汇总数据。

> 本仓库只包含前端展示、文件提交和接口适配。Excel 解析、字段识别、匹配规则、金额计算、差异分类及任务状态判定全部由后端负责。

## 在线预览

[打开私密预览](https://ruili-reconciliation.panke2001.chatgpt.site)

未配置后端地址时，页面使用内置演示适配器，并在顶部显示“接口演示模式”。演示数据仅用于界面评审。

## 主要功能

- 导入结算单与 ERP Excel 表单
- 创建异步对账任务
- 查询任务状态并轮询进行中的任务
- 历史任务搜索、状态筛选与分页
- 月度对账统计及差异金额展示
- 后端错误码与请求编号展示
- 桌面端和移动端响应式布局

## 快速开始

### 环境要求

- Node.js `>=22.13.0`
- npm

### 安装与启动

```bash
npm ci
npm run dev
```

本地页面启动后通常位于 `http://localhost:3000`。如果端口被占用，请以终端输出的地址为准。

### 接入真实后端

复制环境变量示例并填写后端服务地址：

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

只要配置了 `NEXT_PUBLIC_API_BASE_URL`，前端就会从演示适配器切换到真实 HTTP 接口。

## 前后端契约

- [OpenAPI 接口契约](docs/api-contract.yaml)
- [前后端职责与联调说明](docs/backend-handoff.md)
- [前端接口类型](lib/reconciliation-types.ts)
- [前端 API 适配层](lib/reconciliation-api.ts)

V1 包含四个操作：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/reconciliation-tasks` | 上传两份文件并创建任务 |
| `GET` | `/api/v1/reconciliation-tasks` | 搜索、筛选和分页查询任务 |
| `GET` | `/api/v1/reconciliation-tasks/{taskId}` | 查询详情并轮询状态 |
| `GET` | `/api/v1/reconciliation-statistics` | 获取月度统计和趋势 |

## 项目结构

```text
app/                 页面组件、样式和站点元数据
lib/                 对账领域类型与 API 适配层
docs/                OpenAPI 契约和后端交接说明
tests/               页面渲染与职责边界测试
public/              静态资源
.github/workflows/   GitHub Actions 检查
```

## 常用命令

```bash
npm run dev      # 启动本地开发环境
npm run lint     # 运行代码质量检查
npm test         # 构建并运行测试
npm run build    # 生成部署构建
```

## 协作

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。涉及接口字段或状态语义的修改，必须同时更新类型、OpenAPI 契约和交接说明。

当前仓库默认为私有协作项目，暂未附加开源许可证。
