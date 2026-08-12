#!/usr/bin/env node
// 一键启动脚本：建立 SSH 隧道 + 启动后端 + 启动前端 + 打开浏览器
// 用法：node scripts/start-all.mjs
// 前提：本机已配置 SSH 免密登录到服务器（~/.ssh/id_ed25519 已上传公钥）

import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_HOST = "8.133.196.107";
const SERVER_PORT = 32222;
const SERVER_USER = "cherry";
const TUNNEL_LOCAL_PORT = 5433;
const TUNNEL_REMOTE_PORT = 5432;

const BACKEND_PORT = 3001;
const FRONTEND_PORT = 3333;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT, "server");

// Windows 下显式定位 cmd.exe（Git Bash 环境 PATH 可能不含 system32）
const WINDOWS_CMD = process.platform === "win32"
  ? process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe"
  : "/bin/sh";

const log = (msg) => console.log(`[一键启动] ${msg}`);

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(2000);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

// 1. 确保 SSH 隧道
async function ensureTunnel() {
  const isOpen = await portOpen(TUNNEL_LOCAL_PORT);
  if (isOpen) {
    log(`SSH 隧道已就绪（本地 ${TUNNEL_LOCAL_PORT} → 服务器 ${TUNNEL_REMOTE_PORT}）`);
    return;
  }

  log(`建立 SSH 隧道（本地 ${TUNNEL_LOCAL_PORT} → 服务器 ${TUNNEL_REMOTE_PORT}）…`);
  const args = [
    "-p", String(SERVER_PORT),
    "-N",
    "-o", "StrictHostKeyChecking=no",
    "-o", "ServerAliveInterval=60",
    "-o", "ExitOnForwardFailure=yes",
    "-L", `${TUNNEL_LOCAL_PORT}:127.0.0.1:${TUNNEL_REMOTE_PORT}`,
    `${SERVER_USER}@${SERVER_HOST}`,
  ];

  // Windows 下 ssh 在 Git 的 usr/bin 里，用 cmd 执行确保能找到
  const sshCommand = process.platform === "win32"
    ? `ssh ${args.join(" ")}`
    : `ssh ${args.join(" ")}`;

  const tunnel = spawn(WINDOWS_CMD, ["/c", sshCommand], {
    stdio: "ignore",
    detached: true,
  });
  tunnel.unref();

  // 等待隧道建立
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await portOpen(TUNNEL_LOCAL_PORT)) {
      log("SSH 隧道建立成功");
      return;
    }
  }
  log("⚠️ SSH 隧道可能未建立，请检查免密登录配置");
}

// 2. 启动后端
async function ensureBackend() {
  const isOpen = await portOpen(BACKEND_PORT);
  if (isOpen) {
    try {
      const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health?deep=1`, { signal: AbortSignal.timeout(10000) });
      const payload = await response.json();
      if (response.ok && payload?.data?.service === "billcompare" && payload?.data?.database === "ok" && payload?.data?.cherryStudio?.status === "ok") {
        log(`后端、数据库和 CherryStudio 已就绪（端口 ${BACKEND_PORT}）`);
        return;
      }
    } catch {
      // The occupied port is not a healthy billcompare backend.
    }
    throw new Error(`${BACKEND_PORT} 端口已被其他程序或旧版后端占用，请先关闭该进程`);
  }

  log("检查数据库迁移…");
  execFileSync(WINDOWS_CMD, ["/c", "npx prisma generate && npx prisma migrate deploy"], {
    cwd: SERVER_DIR,
    stdio: "inherit",
  });

  log(`启动后端（端口 ${BACKEND_PORT}）…`);
  const backend = spawn(WINDOWS_CMD, ["/c", "npx tsx src/index.ts"], {
    cwd: SERVER_DIR,
    stdio: "inherit",
    detached: true,
    env: { ...process.env },
  });
  backend.unref();

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await portOpen(BACKEND_PORT)) {
      try {
        const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health?deep=1`, { signal: AbortSignal.timeout(10000) });
        const payload = await response.json();
        if (response.ok && payload?.data?.cherryStudio?.status === "ok") {
          log("后端、数据库和 CherryStudio 启动成功");
          return;
        }
      } catch {
        // The server may still be starting.
      }
    }
  }
  log("⚠️ 后端可能未启动成功，请查看日志");
}

// 3. 启动前端
async function ensureFrontend() {
  const isOpen = await portOpen(FRONTEND_PORT);
  if (isOpen) {
    try {
      const response = await fetch(`http://127.0.0.1:${FRONTEND_PORT}/`, { signal: AbortSignal.timeout(3000) });
      const html = await response.text();
      if (response.ok && html.includes("<title>锐力对账｜财务协同工作台</title>")) {
        log(`前端已在运行（端口 ${FRONTEND_PORT}）`);
        return;
      }
    } catch {
      // The occupied port is not the billcompare frontend.
    }
    throw new Error(`${FRONTEND_PORT} 端口已被其他程序占用，请先关闭该进程`);
  }

  log(`启动前端（端口 ${FRONTEND_PORT}）…`);
  const frontend = spawn(WINDOWS_CMD, ["/c", `npx vite --host 127.0.0.1 --port ${FRONTEND_PORT}`], {
    cwd: ROOT,
    stdio: "inherit",
    detached: true,
  });
  frontend.unref();

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await portOpen(FRONTEND_PORT)) {
      log("前端启动成功");
      return;
    }
  }
  log("⚠️ 前端可能未启动成功，请查看日志");
}

// 4. 打开浏览器
function openBrowser() {
  const url = `http://127.0.0.1:${FRONTEND_PORT}/`;
  log(`打开浏览器：${url}`);
  try {
    if (process.platform === "win32") {
      execFileSync("cmd.exe", ["/c", "start", "", url]);
    } else if (process.platform === "darwin") {
      execFileSync("open", [url]);
    } else {
      execFileSync("xdg-open", [url]);
    }
  } catch {
    log(`自动打开浏览器失败，请手动访问 ${url}`);
  }
}

// 主流程
async function main() {
  log("===== 锐力对账系统 一键启动 =====");
  await ensureTunnel();
  await ensureBackend();
  await ensureFrontend();
  openBrowser();
  log("===== 全部启动完成 =====");
  log("前端: http://127.0.0.1:" + FRONTEND_PORT + "/");
  log("后端: http://127.0.0.1:" + BACKEND_PORT + "/api/health");
  log("提示: 关闭此窗口不会停止服务（后台运行）。");
}

main().catch((e) => {
  console.error("[一键启动] 出错:", e);
  process.exit(1);
});
