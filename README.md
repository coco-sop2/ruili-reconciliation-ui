# 锐力对账

这是一个 Vite + React 前端、Express + Prisma 后端的本机对账工作台。前端只负责上传资料、展示任务和处理审核；后端保存文件和任务，通过 CherryStudio Enterprise Agent 完成文件识别与对账，并把结果写入 PostgreSQL。

## 交付给另一台电脑

代码可以直接交付，但不要把你自己的 `server/.env` 或 `.env.local` 一起发送。这些文件已被 Git 忽略。

接收人的电脑需要：

- Windows 10/11 或 macOS，Node.js 22.13 或更高版本。
- SSH 客户端（Windows 在系统“可选功能”中安装 OpenSSH Client；macOS 已内置）。
- CherryStudio 企业版已启动，API 服务监听 `127.0.0.1:24333`，并已创建名为“锐力”的对账 Agent。

Windows 右键 `一键启动.ps1` 选择“使用 PowerShell 运行”。macOS 首次运行先在终端执行 `chmod +x 一键启动.command`，以后双击该文件即可；如果系统拦截，右键文件选择“打开”。浏览器会自动打开。首次使用时在左侧“连接设置”填写：

1. CherryStudio API Key。
2. SSH 密码。
3. PostgreSQL 数据库密码。

点击“检测并保存”后，Windows 使用当前用户 DPAPI 加密保存，macOS 使用当前用户钥匙串保存；页面不会回显明文，后续启动会自动读取并检测。连接设置页始终保留，但不会修改服务器账号或密码。

其余步骤全部自动完成：

- 首次安装前后端 npm 依赖。
- 建立 `127.0.0.1:5433` 到服务器 PostgreSQL 的 SSH 隧道。
- 生成 Prisma Client 并应用尚未执行的数据库迁移。
- 启动并深度检查数据库、后端、CherryStudio 和前端。
- 打开：

- 前端：`http://127.0.0.1:3333/`
- 后端健康检查：`http://127.0.0.1:3001/api/health`

启动日志保存在 `.runtime/logs/`，失败时直接看提示指向的日志文件。

## 项目目录约定

源码、文档与运行时文件分开存放，扫描文件后不会再向项目根目录散落中间产物：

```text
billcompare/
├─ src/                 # 前端源码
├─ server/              # 后端源码、数据库模型与迁移
├─ scripts/             # 启动和配置脚本
├─ tests/               # 前端与集成测试
├─ docs/                # 项目文档
└─ .runtime/            # 本机运行数据，不提交 Git
   ├─ logs/             # 前端、后端和 SSH 隧道日志
   ├─ data/uploads/     # 新安装环境上传的原始对账文件
   ├─ tasks/<任务ID>/   # 单次扫描中间文件，任务结束自动删除
   └─ legacy/           # 旧版根目录产物的保留归档
```

已有安装如果在 `server/.env` 中配置了旧的 `UPLOAD_DIR=./data/files`，原始文件会继续留在旧目录，避免破坏历史任务；新安装默认使用 `.runtime/data/uploads/`。

不要提交真实密码或 CherryStudio API Key。启动时生成给后端使用的 `server/.env` 也已被 Git 忽略。

## 手动启动

每个项目副本必须使用自己的 `node_modules`，不要用 Junction 或软链接共享依赖。需要排查时也可以分别启动；`npm ci` 会自动生成 Prisma Client：

```powershell
npm ci
cd server
npm ci
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

服务器地址、SSH 隧道、Agent 默认名称和工作目录由后端配置，详见 `server/.env.example`。凭据由本机连接设置页管理，不要提交到 Git。

## 对账流程

1. 前端把结算资料与 ERP 资料上传到 `POST /api/tasks`。
2. 后端在数据库创建任务和文件记录，并把原始文件保存到 `UPLOAD_DIR` 配置的受控目录。
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
