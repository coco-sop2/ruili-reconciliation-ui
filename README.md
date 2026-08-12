# 锐力对账

这是一个 Vite + React 前端、Express + Prisma 后端的本机对账工作台。前端只负责上传资料、展示任务和处理审核；后端保存文件和任务，通过 CherryStudio Enterprise Agent 完成文件识别与对账，并把结果写入 PostgreSQL。

## 启动

推荐在 Windows 中双击 `一键启动.bat`。它会检查数据库 SSH 隧道、后端和前端，再打开：

- 前端：`http://127.0.0.1:3333/`
- 后端健康检查：`http://127.0.0.1:3001/api/health`

也可以分别启动：

```powershell
npm install
cd server
npm install
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

另开终端，在项目根目录执行：

```powershell
npm run dev
```

## 环境变量

前端仅使用：

```env
VITE_API_BASE_URL=http://127.0.0.1:3001
```

Agent 默认名称、工作目录和服务凭据都由后端配置，详见 `server/.env.example`。`CHERRYSTUDIO_API_KEY` 和 `DATABASE_URL` 只能保存在 `server/.env`，不要提交到 Git。

## 对账流程

1. 前端把结算资料与 ERP 资料上传到 `POST /api/tasks`。
2. 后端在数据库创建任务和文件记录，并把原始文件保存到 `server/data/files`。
3. 后端匹配 CherryStudio Agent，为每次任务创建独立 Session，并发送对账提示词。
4. Agent 返回严格 JSON；差额统一定义为 `ERP 金额 - 结算金额`。
5. 后端校验结果并写入任务和审核明细，前端通过任务详情接口轮询进度。
6. 后端短暂断线时前端自动重连；服务重启后会从数据库恢复未完成任务，最多尝试三次。

## 检查

```powershell
npm test
npm run typecheck
npm run lint
cd server
npm run build
npx prisma validate
```

服务默认只监听本机 `127.0.0.1`，并仅接受本机前端来源。如需部署到其他机器，应先增加正式鉴权、HTTPS 和受控的 CORS 配置。
