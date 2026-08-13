import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { databaseUrlWithPassword, ensureAskpassHelper, setEnvValue } from "./start-all.mjs";
import { protectSecret, unprotectSecret } from "./local-config.mjs";
import { friendlyConnectionError } from "./config-server.mjs";
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

test("connection errors are translated into actionable Chinese messages", () => {
  assert.equal(friendlyConnectionError("database", { code: "P1000", message: "raw prisma error" }), "数据库密码不正确");
  assert.equal(friendlyConnectionError("ssh", new Error("Permission denied")), "SSH 密码不正确");
  assert.equal(friendlyConnectionError("cherry", new Error("HTTP 401")), "API Key 不正确或已失效");
});

test("Windows launcher closes after success and pauses only on failure", async () => {
  const launcher = await readFile(new URL("../一键启动.ps1", import.meta.url), "utf8");
  assert.match(launcher, /scripts\\start-all\.mjs/);
  assert.match(launcher, /BILLCOMPARE_NO_PAUSE/);
  assert.match(launcher, /Read-Host 'Press Enter to close'/);
  assert.doesNotMatch(launcher, /Startup completed|Closing this window|首次配置/);
});
