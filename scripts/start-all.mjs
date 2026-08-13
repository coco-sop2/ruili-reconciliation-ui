#!/usr/bin/env node
// 一键启动：检查本机配置和依赖，建立数据库 SSH 隧道，再启动前后端。

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { credentialStatus, readCredentials } from "./local-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT, "server");
const SERVER_ENV_PATH = path.join(SERVER_DIR, ".env");
const SERVER_ENV_EXAMPLE = path.join(SERVER_DIR, ".env.example");
const FRONTEND_ENV_PATH = path.join(ROOT, ".env.local");
const FRONTEND_ENV_EXAMPLE = path.join(ROOT, ".env.example");
const FRONTEND_PORT = 3333;
const CONFIG_PORT = 3334;
const NO_BROWSER = process.argv.includes("--no-browser");
const LOG_DIR = path.join(ROOT, ".runtime", "logs");
const ASKPASS_DIR = path.join(ROOT, ".runtime", "bin");

const log = (message) => console.log(`[一键启动] ${message}`);

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function intSetting(values, key, fallback) {
  const parsed = Number.parseInt(values[key] || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loadSettings() {
  const values = parseEnvFile(SERVER_ENV_PATH);
  return {
    values,
    sshHost: values.SSH_HOST || "8.133.196.107",
    sshPort: intSetting(values, "SSH_PORT", 32222),
    sshUser: values.SSH_USER || "cherry",
    localDatabasePort: intSetting(values, "SSH_LOCAL_DATABASE_PORT", 5433),
    remoteDatabaseHost: values.SSH_REMOTE_DATABASE_HOST || "127.0.0.1",
    remoteDatabasePort: intSetting(values, "SSH_REMOTE_DATABASE_PORT", 5432),
    backendPort: intSetting(values, "PORT", 3001),
  };
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore", windowsHide: true });
  return !result.error;
}

function assertPrerequisites() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`需要 Node.js 22.13 或更高版本，当前为 ${process.version}`);
  }
  if (!commandAvailable("ssh", ["-V"])) {
    throw new Error("未找到 OpenSSH Client。请在 Windows 可选功能中安装 OpenSSH 客户端");
  }
}

function setEnvValue(content, key, value) {
  if (/[\r\n]/.test(value)) throw new Error(`${key} 不能包含换行符`);
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}\n${line}\n`;
}

function databaseUrlWithPassword(databaseUrl, password) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("server/.env 中的 DATABASE_URL 格式不正确");
  }
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

function ensureLocalEnvFiles() {
  if (!existsSync(SERVER_ENV_PATH)) copyFileSync(SERVER_ENV_EXAMPLE, SERVER_ENV_PATH);
  if (!existsSync(FRONTEND_ENV_PATH)) copyFileSync(FRONTEND_ENV_EXAMPLE, FRONTEND_ENV_PATH);
}

function ensureConfiguration() {
  ensureLocalEnvFiles();
  const stored = credentialStatus();
  if (!stored.cherryApiKey || !stored.sshPassword || !stored.databasePassword) return null;
  const settings = loadSettings();
  const credentials = readCredentials();
  return {
    settings,
    credentials,
    runtimeEnv: {
      ...process.env,
      CHERRYSTUDIO_API_KEY: credentials.cherryApiKey,
      DATABASE_URL: databaseUrlWithPassword(
        settings.values.DATABASE_URL || "postgresql://billcompare:password@127.0.0.1:5433/billcompare?schema=public",
        credentials.databasePassword,
      ),
    },
  };
}

function npmInvocation(args) {
  if (process.platform !== "win32") return { command: "npm", args };
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) {
    throw new Error(`未找到 npm CLI：${npmCli}。请重新安装官方 Node.js`);
  }
  return { command: process.execPath, args: [npmCli, ...args] };
}

function runNpm(args, cwd, env = process.env) {
  const invocation = npmInvocation(args);
  execFileSync(invocation.command, invocation.args, { cwd, env, stdio: "inherit", windowsHide: false });
}

function ensureDependencies() {
  const frontendReady = existsSync(path.join(ROOT, "node_modules", "vite", "bin", "vite.js"));
  const backendReady = existsSync(path.join(SERVER_DIR, "node_modules", "tsx", "dist", "cli.mjs"))
    && existsSync(path.join(SERVER_DIR, "node_modules", "@prisma", "client"));

  if (!frontendReady) {
    log("首次安装前端依赖…");
    runNpm(["ci", "--no-audit", "--no-fund"], ROOT);
  }
  if (!backendReady) {
    log("首次安装后端依赖…");
    runNpm(["ci", "--no-audit", "--no-fund"], SERVER_DIR);
  }
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(1500);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function runtimeLog(name) {
  mkdirSync(LOG_DIR, { recursive: true });
  return path.join(LOG_DIR, name);
}

function spawnBackground(command, args, options, logPath) {
  const output = openSync(logPath, "a");
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: ["ignore", output, output],
    windowsHide: true,
  });
  child.unref();
  closeSync(output);
  return child;
}

function ensureAskpassHelper(platform = process.platform) {
  mkdirSync(ASKPASS_DIR, { recursive: true });
  if (platform === "darwin") {
    const helperPath = path.join(ASKPASS_DIR, "billcompare-askpass-v1");
    writeFileSync(helperPath, macAskpassSource(), { encoding: "utf8", mode: 0o700 });
    chmodSync(helperPath, 0o700);
    return helperPath;
  }
  if (platform !== "win32") {
    throw new Error(`暂不支持 ${platform} 的 SSH 密码登录`);
  }
  const helperPath = path.join(ASKPASS_DIR, "billcompare-askpass-v1.exe");
  if (existsSync(helperPath)) return helperPath;
  const source = [
    "using System;",
    "internal static class Program {",
    "  private static int Main() {",
    "    Console.Out.Write(Environment.GetEnvironmentVariable(\"BILLCOMPARE_SSH_PASSWORD\") ?? \"\");",
    "    return 0;",
    "  }",
    "}",
  ].join("\n");
  const script = "Add-Type -TypeDefinition $env:BILLCOMPARE_ASKPASS_SOURCE "
    + "-OutputAssembly $env:BILLCOMPARE_ASKPASS_PATH -OutputType ConsoleApplication";
  execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", script], {
    env: {
      ...process.env,
      BILLCOMPARE_ASKPASS_PATH: helperPath,
      BILLCOMPARE_ASKPASS_SOURCE: source,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  return helperPath;
}

function macAskpassSource() {
  return "#!/bin/sh\nexec /usr/bin/printf '%s' \"$BILLCOMPARE_SSH_PASSWORD\"\n";
}

async function ensureTunnel(settings, sshPassword) {
  if (await portOpen(settings.localDatabasePort)) {
    log(`数据库入口已就绪（127.0.0.1:${settings.localDatabasePort}）`);
    return;
  }

  if (!sshPassword) throw new Error("SSH 密码不能为空");
  log(`连接服务器数据库（${settings.sshUser}@${settings.sshHost}）…`);
  const tunnelLog = runtimeLog("ssh-tunnel.log");
  const args = [
    "-p", String(settings.sshPort), "-N",
    "-o", "BatchMode=no",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ServerAliveInterval=60",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "NumberOfPasswordPrompts=1",
    "-o", "PreferredAuthentications=password,keyboard-interactive",
    "-o", "PubkeyAuthentication=no",
    "-L", `127.0.0.1:${settings.localDatabasePort}:${settings.remoteDatabaseHost}:${settings.remoteDatabasePort}`,
    `${settings.sshUser}@${settings.sshHost}`,
  ];
  const tunnel = spawnBackground("ssh", args, {
    cwd: ROOT,
    env: {
      ...process.env,
      BILLCOMPARE_SSH_PASSWORD: sshPassword,
      DISPLAY: "billcompare",
      SSH_ASKPASS: ensureAskpassHelper(),
      SSH_ASKPASS_REQUIRE: "force",
    },
  }, tunnelLog);

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await delay(1000);
    if (await portOpen(settings.localDatabasePort)) {
      log("SSH 数据库隧道建立成功");
      return;
    }
    if (tunnel.exitCode !== null) break;
  }
  throw new Error(`SSH 隧道建立失败。请确认 SSH 密码正确，详情见 ${tunnelLog}`);
}

async function ensureConfigServer() {
  if (await portOpen(CONFIG_PORT)) return;
  const logPath = runtimeLog("config-server.log");
  spawnBackground(process.execPath, [path.join(ROOT, "scripts", "config-server.mjs")], {
    cwd: ROOT,
    env: { ...process.env },
  }, logPath);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(250);
    if (await portOpen(CONFIG_PORT)) return;
  }
  throw new Error(`配置服务未启动成功，详情见 ${logPath}`);
}

async function backendHealth(port, deep = false) {
  try {
    const suffix = deep ? "?deep=1" : "";
    const response = await fetch(`http://127.0.0.1:${port}/api/health${suffix}`, {
      signal: AbortSignal.timeout(deep ? 12_000 : 3_000),
    });
    const payload = await response.json();
    return response.ok ? payload?.data : null;
  } catch {
    return null;
  }
}

async function ensureBackend(settings, runtimeEnv) {
  if (await portOpen(settings.backendPort)) {
    const health = await backendHealth(settings.backendPort, true);
    if (health?.service === "billcompare" && health.database === "ok" && health.cherryStudio?.status === "ok") {
      log(`后端、数据库和 CherryStudio 已就绪（端口 ${settings.backendPort}）`);
      return true;
    }
    log("已有后端未通过连接检查，请在页面中重新检测配置后再启动");
    return false;
  }

  log("应用数据库迁移…");
  runNpm(["run", "prisma:deploy"], SERVER_DIR, runtimeEnv);

  const backendLog = runtimeLog("backend.log");
  log(`启动后端（日志：${backendLog}）…`);
  const tsxCli = path.join(SERVER_DIR, "node_modules", "tsx", "dist", "cli.mjs");
  spawnBackground(process.execPath, [tsxCli, "src/index.ts"], {
    cwd: SERVER_DIR,
    env: runtimeEnv,
  }, backendLog);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(1000);
    const health = await backendHealth(settings.backendPort, true);
    if (health?.service === "billcompare" && health.database === "ok" && health.cherryStudio?.status === "ok") {
      log("后端、数据库和 CherryStudio 启动成功");
      return true;
    }
  }
  throw new Error(`后端未通过深度健康检查，详情见 ${backendLog}`);
}

async function ensureFrontend() {
  if (await portOpen(FRONTEND_PORT)) {
    try {
      const response = await fetch(`http://127.0.0.1:${FRONTEND_PORT}/`, { signal: AbortSignal.timeout(3000) });
      const html = await response.text();
      if (response.ok && html.includes("<title>锐力对账｜财务协同工作台</title>")) {
        log(`前端已在运行（端口 ${FRONTEND_PORT}）`);
        return;
      }
    } catch {
      // 继续抛出明确的端口占用错误。
    }
    throw new Error(`${FRONTEND_PORT} 端口已被其他程序占用`);
  }

  log("构建前端静态资源…");
  runNpm(["run", "build"], ROOT);

  const frontendLog = runtimeLog("frontend.log");
  log(`启动前端（日志：${frontendLog}）…`);
  const viteCli = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  spawnBackground(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", String(FRONTEND_PORT)], {
    cwd: ROOT,
    env: { ...process.env },
  }, frontendLog);

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await delay(1000);
    if (await portOpen(FRONTEND_PORT)) {
      log("前端启动成功");
      return;
    }
  }
  throw new Error(`前端未启动成功，详情见 ${frontendLog}`);
}

function openBrowser() {
  const url = `http://127.0.0.1:${FRONTEND_PORT}/`;
  log(`打开浏览器：${url}`);
  try {
    if (process.platform === "win32") execFileSync("cmd.exe", ["/c", "start", "", url]);
    else if (process.platform === "darwin") execFileSync("open", [url]);
    else execFileSync("xdg-open", [url]);
  } catch {
    log(`无法自动打开浏览器，请手动访问 ${url}`);
  }
}

async function main() {
  log("===== 锐力对账系统一键启动 =====");
  assertPrerequisites();
  ensureLocalEnvFiles();
  ensureDependencies();
  log("生成数据库客户端…");
  runNpm(["run", "prisma:generate"], SERVER_DIR);
  await ensureConfigServer();
  await ensureFrontend();
  if (!NO_BROWSER) openBrowser();
  const configuration = ensureConfiguration();
  if (!configuration) {
    log("请在前端的“连接设置”中填写并检测三项凭据");
    return;
  }
  const { settings, credentials, runtimeEnv } = configuration;
  await ensureTunnel(settings, credentials.sshPassword);
  if (!(await ensureBackend(settings, runtimeEnv))) return;
  log("===== 全部启动完成 =====");
  log(`前端：http://127.0.0.1:${FRONTEND_PORT}/`);
  log(`后端：http://127.0.0.1:${settings.backendPort}/api/health`);
  log(`运行日志：${LOG_DIR}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("\n[一键启动] 启动失败：", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { databaseUrlWithPassword, ensureAskpassHelper, loadSettings, macAskpassSource, setEnvValue };
