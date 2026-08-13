import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CREDENTIALS_PATH = path.join(ROOT, ".runtime", "config", "credentials.json");
const credentialNames = ["cherryApiKey", "sshPassword", "databasePassword"];

function runDpapi(mode, value) {
  if (process.platform !== "win32") throw new Error("本机凭据加密目前仅支持 Windows");
  const script = mode === "protect"
    ? [
        "Add-Type -AssemblyName System.Security",
        "$plain = [Console]::In.ReadToEnd()",
        "$bytes = [Text.Encoding]::UTF8.GetBytes($plain)",
        "$encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Console]::Out.Write([Convert]::ToBase64String($encrypted))",
      ].join("; ")
    : [
        "Add-Type -AssemblyName System.Security",
        "$encrypted = [Convert]::FromBase64String([Console]::In.ReadToEnd())",
        "$bytes = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))",
      ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", script], {
    input: value,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`无法使用 Windows 当前用户保护本机凭据：${result.stderr.trim()}`);
  return result.stdout;
}

export const protectSecret = (value) => runDpapi("protect", value);
export const unprotectSecret = (value) => runDpapi("unprotect", value);

function readEncryptedCredentials() {
  if (!existsSync(CREDENTIALS_PATH)) return {};
  const payload = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  if (payload?.version !== 1 || !payload.values || typeof payload.values !== "object") {
    throw new Error("本机凭据文件格式不正确");
  }
  return payload.values;
}

export function readCredentials() {
  const encrypted = readEncryptedCredentials();
  return Object.fromEntries(credentialNames.map((name) => [
    name,
    typeof encrypted[name] === "string" && encrypted[name] ? unprotectSecret(encrypted[name]) : "",
  ]));
}

export function credentialStatus() {
  const encrypted = readEncryptedCredentials();
  return Object.fromEntries(credentialNames.map((name) => [name, Boolean(encrypted[name])]));
}

export function saveCredentials(next) {
  const encrypted = readEncryptedCredentials();
  for (const name of credentialNames) {
    const value = next[name];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || value.length > 4096 || /[\r\n\0]/.test(value)) {
      throw new Error(`${name} 格式不正确`);
    }
    encrypted[name] = protectSecret(value);
  }
  mkdirSync(path.dirname(CREDENTIALS_PATH), { recursive: true });
  writeFileSync(CREDENTIALS_PATH, `${JSON.stringify({ version: 1, values: encrypted }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return credentialStatus();
}

export function clearCredentials(names) {
  const encrypted = readEncryptedCredentials();
  for (const name of names) {
    if (credentialNames.includes(name)) delete encrypted[name];
  }
  mkdirSync(path.dirname(CREDENTIALS_PATH), { recursive: true });
  writeFileSync(CREDENTIALS_PATH, `${JSON.stringify({ version: 1, values: encrypted }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return credentialStatus();
}
