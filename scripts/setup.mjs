#!/usr/bin/env node
// 首次配置：创建本地环境文件和 SSH 密钥，并显示需要服务器管理员授权的公钥。

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENV = path.join(ROOT, "server", ".env");
const SERVER_ENV_EXAMPLE = path.join(ROOT, "server", ".env.example");
const FRONTEND_ENV = path.join(ROOT, ".env.local");
const FRONTEND_ENV_EXAMPLE = path.join(ROOT, ".env.example");
const SSH_DIR = path.join(os.homedir(), ".ssh");
const SSH_PRIVATE_KEY = path.join(SSH_DIR, "id_ed25519");
const SSH_PUBLIC_KEY = `${SSH_PRIVATE_KEY}.pub`;

const log = (message) => console.log(`[首次配置] ${message}`);

function ensureLocalEnvFiles() {
  if (!existsSync(SERVER_ENV)) {
    copyFileSync(SERVER_ENV_EXAMPLE, SERVER_ENV);
    log(`已创建 ${SERVER_ENV}`);
  } else {
    log("server/.env 已存在，不会覆盖");
  }
  if (!existsSync(FRONTEND_ENV)) {
    copyFileSync(FRONTEND_ENV_EXAMPLE, FRONTEND_ENV);
    log(`已创建 ${FRONTEND_ENV}`);
  }
}

function ensureSshKey() {
  mkdirSync(SSH_DIR, { recursive: true });
  if (!existsSync(SSH_PRIVATE_KEY)) {
    log("正在为这台电脑生成 SSH 密钥…");
    const result = spawnSync("ssh-keygen", [
      "-t", "ed25519",
      "-f", SSH_PRIVATE_KEY,
      "-N", "",
      "-C", `billcompare-${os.userInfo().username}`,
    ], { stdio: "inherit", windowsHide: false });
    if (result.error || result.status !== 0) {
      throw new Error("SSH 密钥生成失败，请确认 Windows OpenSSH Client 已安装");
    }
  }
  if (!existsSync(SSH_PUBLIC_KEY)) {
    const publicKey = execFileSync("ssh-keygen", ["-y", "-f", SSH_PRIVATE_KEY], { encoding: "utf8" });
    throw new Error(`私钥存在但缺少 .pub 文件。请让管理员使用以下公钥：\n${publicKey.trim()}`);
  }
  return readFileSync(SSH_PUBLIC_KEY, "utf8").trim();
}

function copyPublicKey(publicKey) {
  if (process.platform !== "win32") return;
  try {
    execFileSync("clip.exe", { input: publicKey, stdio: ["pipe", "ignore", "ignore"] });
    log("SSH 公钥已复制到剪贴板");
  } catch {
    // 下方仍会完整显示公钥。
  }
}

function openServerEnv() {
  if (process.platform !== "win32") return;
  log("即将打开 server/.env，请填写 DATABASE_URL 中的真实密码和 CHERRYSTUDIO_API_KEY，然后保存关闭");
  spawnSync("notepad.exe", [SERVER_ENV], { stdio: "inherit", windowsHide: false });
}

function main() {
  log("===== 第一次使用只需配置一次 =====");
  ensureLocalEnvFiles();
  const publicKey = ensureSshKey();
  copyPublicKey(publicKey);
  console.log("\n请把下面的 SSH 公钥发给服务器管理员，由管理员加入 cherry 用户的 authorized_keys：\n");
  console.log(publicKey);
  console.log("\n服务器未授权该公钥前，一键启动无法建立数据库隧道。\n");
  openServerEnv();
  log("配置文件准备完成。管理员授权公钥后，再双击 一键启动.bat");
}

try {
  main();
} catch (error) {
  console.error("[首次配置] 失败：", error instanceof Error ? error.message : error);
  process.exit(1);
}
