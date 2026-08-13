import { closeSync, mkdirSync, openSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { credentialStatus, readCredentials, saveCredentials } from "./local-config.mjs";
import { ensureAskpassHelper, loadSettings } from "./start-all.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3334;
const ALLOWED_ORIGINS = new Set(["http://127.0.0.1:3333", "http://localhost:3333"]);
const START_ALL = path.join(ROOT, "scripts", "start-all.mjs");
const LOG_DIR = path.join(ROOT, ".runtime", "logs");

const responseHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

function send(res, status, payload, origin = "") {
  res.writeHead(status, responseHeaders(origin));
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 32 * 1024) throw new Error("请求内容过大");
  }
  return body ? JSON.parse(body) : {};
}

function askpassEnv(password) {
  return {
    ...process.env,
    BILLCOMPARE_SSH_PASSWORD: password,
    DISPLAY: "billcompare",
    SSH_ASKPASS: ensureAskpassHelper(),
    SSH_ASKPASS_REQUIRE: "force",
  };
}

function sshArgs(settings) {
  return [
    "-p", String(settings.sshPort),
    "-o", "BatchMode=no",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "NumberOfPasswordPrompts=1",
    "-o", "PreferredAuthentications=password,keyboard-interactive",
    "-o", "PubkeyAuthentication=no",
  ];
}

function runSsh(settings, password, remoteCommand, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [
      ...sshArgs(settings),
      `${settings.sshUser}@${settings.sshHost}`,
      remoteCommand,
    ], {
      cwd: ROOT,
      env: askpassEnv(password),
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText += String(chunk).slice(0, 1000); });
    child.stdin.end(input);
    const timer = setTimeout(() => child.kill(), 15_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(errorText || "SSH 命令执行失败"));
    });
  });
}

const portOpen = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  socket.setTimeout(500);
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
  socket.once("timeout", () => { socket.destroy(); resolve(false); });
});

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function openTestTunnel(settings, password) {
  const localPort = await freePort();
  const child = spawn("ssh", [
    ...sshArgs(settings),
    "-N",
    "-o", "ExitOnForwardFailure=yes",
    "-L", `127.0.0.1:${localPort}:${settings.remoteDatabaseHost}:${settings.remoteDatabasePort}`,
    `${settings.sshUser}@${settings.sshHost}`,
  ], {
    cwd: ROOT,
    env: askpassEnv(password),
    stdio: "ignore",
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(250);
    if (await portOpen(localPort)) return { child, localPort };
    if (child.exitCode !== null) break;
  }
  child.kill();
  throw new Error("SSH 隧道建立失败");
}

async function testCherry(apiKey, settings) {
  if (!apiKey) throw new Error("请填写 CherryStudio API Key");
  const baseUrl = (settings.values.CHERRYSTUDIO_BASE_URL || "http://127.0.0.1:24333").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/v1/agents?limit=1&offset=0`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`CherryStudio 鉴权失败（HTTP ${response.status}）`);
}

async function testSsh(password, settings) {
  if (password) {
    await runSsh(settings, password, "true");
    return;
  }
  await new Promise((resolve, reject) => {
    const child = spawn("ssh", [
      "-p", String(settings.sshPort),
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      `${settings.sshUser}@${settings.sshHost}`,
      "true",
    ], { cwd: ROOT, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("SSH 登录失败")));
  });
}

async function testDatabase(databasePassword, sshPassword, settings) {
  if (!databasePassword) throw new Error("请填写数据库密码");
  const tunnel = sshPassword
    ? await openTestTunnel(settings, sshPassword)
    : { child: null, localPort: settings.localDatabasePort };
  if (!sshPassword && !(await portOpen(settings.localDatabasePort))) {
    throw new Error("请填写 SSH 密码，或先建立 SSH 隧道");
  }
  try {
    const url = new URL(settings.values.DATABASE_URL || "postgresql://billcompare:password@127.0.0.1:5433/billcompare?schema=public");
    url.hostname = "127.0.0.1";
    url.port = String(tunnel.localPort);
    url.password = encodeURIComponent(databasePassword);
    const prismaModule = await import(pathToFileURL(path.join(ROOT, "server", "node_modules", "@prisma", "client", "default.js")).href);
    const client = new prismaModule.PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
      await client.$queryRawUnsafe("SELECT 1");
    } finally {
      await client.$disconnect();
    }
  } finally {
    tunnel.child?.kill();
  }
}

export function friendlyConnectionError(target, error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  if (target === "cherry") {
    if (/HTTP (401|403)/.test(message)) return "API Key 不正确或已失效";
    if (/timeout|aborted/i.test(message) || error?.name === "TimeoutError") return "CherryStudio 响应超时，请确认 API 服务已启动";
    return "无法连接 CherryStudio，请确认应用和 API 服务已启动";
  }
  if (target === "ssh") {
    if (/Permission denied|authentication failed/i.test(message)) return "SSH 密码不正确";
    if (/timed out|refused|No route|Could not resolve/i.test(message)) return "无法连接 SSH 服务器，请检查网络";
    return "SSH 登录失败，请检查密码后重试";
  }
  if (code === "P1000" || /Authentication failed/i.test(message)) return "数据库密码不正确";
  if (code === "P1001" || /Can't reach database server/i.test(message)) return "无法连接数据库，请稍后重试";
  if (code === "P1010" || /denied access/i.test(message)) return "数据库账号无权访问 billcompare 数据库";
  return "数据库连接失败，请检查数据库密码";
}

function result(promise, successMessage, target) {
  return promise.then(
    () => ({ status: "ok", message: successMessage }),
    (error) => ({ status: "error", message: friendlyConnectionError(target, error) }),
  );
}

function resolvedCredentials(input) {
  const saved = readCredentials();
  return {
    cherryApiKey: input.cherryApiKey || saved.cherryApiKey,
    sshPassword: input.sshPassword || saved.sshPassword,
    databasePassword: input.databasePassword || saved.databasePassword,
  };
}

async function testAll(input) {
  const credentials = resolvedCredentials(input);
  const settings = loadSettings();
  const [cherry, ssh] = await Promise.all([
    result(testCherry(credentials.cherryApiKey, settings), "CherryStudio 连接正常", "cherry"),
    result(testSsh(credentials.sshPassword, settings), "SSH 登录正常", "ssh"),
  ]);
  const database = ssh.status === "ok"
    ? await result(testDatabase(credentials.databasePassword, credentials.sshPassword, settings), "数据库连接正常", "database")
    : { status: "skipped", message: "SSH 连接成功后再检测数据库" };
  return {
    credentials,
    results: { cherry, ssh, database },
    ok: cherry.status === "ok" && ssh.status === "ok" && database.status === "ok",
  };
}

function resumeStartup() {
  mkdirSync(LOG_DIR, { recursive: true });
  const output = openSync(path.join(LOG_DIR, "resume-startup.log"), "a");
  const child = spawn(process.execPath, [START_ALL, "--resume", "--no-browser"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", output, output],
    windowsHide: true,
  });
  child.unref();
  closeSync(output);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: "不允许的请求来源" });
  if (req.method === "OPTIONS") return send(res, 204, {}, origin);
  try {
    if (req.method === "GET" && req.url === "/api/config") {
      const settings = loadSettings();
      return send(res, 200, {
        data: {
          stored: credentialStatus(),
          connection: {
            sshHost: settings.sshHost,
            sshPort: settings.sshPort,
            sshUser: settings.sshUser,
            databaseUser: new URL(settings.values.DATABASE_URL).username,
          },
        },
      }, origin);
    }
    if (req.method === "POST" && req.url === "/api/config/test-and-save") {
      const checked = await testAll(await readBody(req));
      let restarting = false;
      if (checked.ok) {
        saveCredentials(checked.credentials);
        restarting = !(await portOpen(loadSettings().backendPort));
        if (restarting) resumeStartup();
      }
      return send(res, checked.ok ? 200 : 422, {
        data: { ok: checked.ok, restarting, results: checked.results, stored: credentialStatus() },
      }, origin);
    }
    return send(res, 404, { error: "接口不存在" }, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return send(res, 400, { error: message }, origin);
  }
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[配置服务] http://127.0.0.1:${PORT}`);
  });
}
