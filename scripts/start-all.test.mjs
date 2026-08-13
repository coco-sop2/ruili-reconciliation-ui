import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertPrivateNodeModules, databaseUrlWithPassword, ensureAskpassHelper, macAskpassSource, setEnvValue } from "./start-all.mjs";
import { keychainArguments, protectSecret, unprotectSecret } from "./local-config.mjs";
import { backendHealthy, friendlyConnectionError, runDatabaseProbe } from "./config-server.mjs";
import { readFile } from "node:fs/promises";

test("launcher safely writes credentials containing URL and env metacharacters", () => {
  const password = "a b@c:/%&!\"'";
  const url = new URL(databaseUrlWithPassword(
    "postgresql://billcompare:password@127.0.0.1:5433/billcompare?schema=public",
    password,
  ));
  assert.equal(url.password, encodeURIComponent(password));
  assert.equal(setEnvValue('CHERRYSTUDIO_API_KEY=""\n', "CHERRYSTUDIO_API_KEY", password),
    `CHERRYSTUDIO_API_KEY=${password}\n`);
  assert.throws(() => setEnvValue("", "CHERRYSTUDIO_API_KEY", "line1\nline2"));
});

test("Windows SSH askpass returns the password verbatim", { skip: process.platform !== "win32" }, () => {
  const password = "a b@c:/%&!\"'";
  const actual = execFileSync(ensureAskpassHelper(), [], {
    encoding: "utf8",
    env: { ...process.env, BILLCOMPARE_SSH_PASSWORD: password },
  });
  assert.equal(actual, password);
});

test("Windows current-user encryption round-trips secrets", { skip: process.platform !== "win32" }, () => {
  const secret = "密钥 a b@c:/%&!\"'";
  const encrypted = protectSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(unprotectSecret(encrypted), secret);
});

test("macOS uses a native askpass script and Keychain arguments without shell interpolation", () => {
  const password = "a b@c:/%&!\"'";
  assert.match(macAskpassSource(), /^#!\/bin\/sh/);
  assert.ok(macAskpassSource().includes('"$BILLCOMPARE_SSH_PASSWORD"'));
  assert.doesNotMatch(macAskpassSource(), /powershell|\.exe/i);
  const args = keychainArguments("save", "sshPassword", password);
  assert.equal(args[args.indexOf("-w") + 1], password);
  assert.deepEqual(keychainArguments("read", "sshPassword").slice(0, 3), ["find-generic-password", "-a", "sshPassword"]);
  assert.doesNotMatch(ensureAskpassHelper("darwin"), /\.exe$/i);
});

test("macOS SSH askpass returns the password verbatim", { skip: process.platform !== "darwin" }, () => {
  const password = "a b@c:/%&!\"'";
  const actual = execFileSync(ensureAskpassHelper(), [], {
    encoding: "utf8",
    env: { ...process.env, BILLCOMPARE_SSH_PASSWORD: password },
  });
  assert.equal(actual, password);
});

test("connection errors are translated into actionable Chinese messages", () => {
  assert.equal(friendlyConnectionError("database", { code: "P1000", message: "raw prisma error" }), "数据库密码不正确");
  assert.equal(friendlyConnectionError("ssh", new Error("Permission denied")), "SSH 密码不正确");
  assert.equal(friendlyConnectionError("cherry", new Error("HTTP 401")), "API Key 不正确或已失效");
});

test("database probe loads Prisma in a disposable child process", async () => {
  const fakeClient = `data:text/javascript,${encodeURIComponent(`
    export class PrismaClient {
      async $queryRawUnsafe(query) {
        if (query !== "SELECT 1" || process.env.BILLCOMPARE_DATABASE_URL !== "postgresql://probe") process.exit(2);
      }
      async $disconnect() {}
    }
  `)}`;
  await runDatabaseProbe("postgresql://probe", fakeClient);
});

test("configuration success requires the business backend health endpoint", async () => {
  const healthServer = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: { service: "billcompare", database: "ok" } }));
  });
  await new Promise((resolve) => healthServer.listen(0, "127.0.0.1", resolve));
  try {
    assert.equal(await backendHealthy(healthServer.address().port), true);
  } finally {
    await new Promise((resolve, reject) => healthServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("launcher rejects shared node_modules and generates Prisma only during package installation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "billcompare-dependencies-"));
  const project = path.join(directory, "project");
  const shared = path.join(directory, "shared");
  await mkdir(project);
  await mkdir(shared);
  await symlink(shared, path.join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  try {
    assert.throws(() => assertPrivateNodeModules(project), /不允许共享 node_modules/);
    const launcher = await readFile(new URL("./start-all.mjs", import.meta.url), "utf8");
    const serverPackage = JSON.parse(await readFile(new URL("../server/package.json", import.meta.url), "utf8"));
    assert.doesNotMatch(launcher, /prisma:generate/);
    assert.equal(serverPackage.scripts.postinstall, "prisma generate");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows launcher closes after success and pauses only on failure", async () => {
  const launcher = await readFile(new URL("../一键启动.ps1", import.meta.url), "utf8");
  assert.match(launcher, /scripts\\start-all\.mjs/);
  assert.match(launcher, /BILLCOMPARE_NO_PAUSE/);
  assert.match(launcher, /Read-Host 'Press Enter to close'/);
  assert.doesNotMatch(launcher, /Startup completed|Closing this window|首次配置/);
});

test("macOS launcher delegates to the cross-platform startup script", async () => {
  const launcher = await readFile(new URL("../一键启动.command", import.meta.url), "utf8");
  assert.match(launcher, /^#!\/bin\/sh/);
  assert.match(launcher, /scripts\/start-all\.mjs/);
  assert.doesNotMatch(launcher, /powershell|\.exe/i);
});
