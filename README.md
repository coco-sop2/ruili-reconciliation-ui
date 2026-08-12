# 锐力对账

这是一个 Vite + React 前端、Express + Prisma 后端的本机对账工作台。前端只负责上传资料、展示任务和处理审核；后端保存文件和任务，通过 CherryStudio Enterprise Agent 完成文件识别与对账，并把结果写入 PostgreSQL。

## 交付给另一台电脑

代码可以直接交付，但不要把你自己的 `server/.env`、`.env.local` 或 SSH 私钥一起发送。这些文件已被 Git 忽略。

接收人的电脑需要：

- Windows 10/11，Node.js 22.13 或更高版本。
- Windows OpenSSH Client（系统“可选功能”里的 OpenSSH 客户端）。
- CherryStudio 企业版已启动，API 服务监听 `127.0.0.1:24333`，并已创建名为“锐力”的对账 Agent。

第一次使用：

1. 双击 `首次配置.bat`。
2. 脚本会创建 SSH 密钥，把公钥复制到剪贴板，并打开 `server/.env`。
3. 把公钥交给服务器管理员，管理员只需授权一次。
4. 通过安全渠道取得数据库密码和接收人自己的 CherryStudio API Key，填入 `server/.env` 后保存。
5. 公钥授权完成后，双击 `一键启动.bat`。

以后每次只需双击 `一键启动.bat`。启动器会自动：

- 首次安装前后端 npm 依赖。
- 建立 `127.0.0.1:5433` 到服务器 PostgreSQL 的 SSH 隧道。
- 生成 Prisma Client 并应用尚未执行的数据库迁移。
- 启动并深度检查数据库、后端、CherryStudio 和前端。
- 打开：

- 前端：`http://127.0.0.1:3333/`
- 后端健康检查：`http://127.0.0.1:3001/api/health`

启动日志保存在 `.runtime/`，失败时直接看提示指向的日志文件。

### 服务器管理员操作

管理员将接收人的公钥追加到服务器 `cherry` 用户的 `~/.ssh/authorized_keys`。建议为项目使用专用 SSH 用户，并仅允许转发到 `127.0.0.1:5432`，不要共享服务器密码或私钥。

管理员还需通过安全渠道提供数据库账号密码。不要把真实密码、CherryStudio API Key 或任何私钥提交到 Git。

## 手动启动

需要排查时也可以分别启动：

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

服务器地址、SSH 隧道、Agent 默认名称、工作目录和服务凭据都由后端配置，详见 `server/.env.example`。`CHERRYSTUDIO_API_KEY` 和 `DATABASE_URL` 只能保存在接收人本机的 `server/.env`，不要提交到 Git。

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
