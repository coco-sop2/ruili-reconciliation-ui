import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the reconciliation workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>锐力对账｜财务协同工作台<\/title>/);
  assert.match(html, /发起一笔新对账/);
  assert.match(html, /导入结算单/);
  assert.match(html, /导入 ERP 表单/);
  assert.match(html, /开始对账/);
  assert.match(html, /接口演示模式/);
  assert.match(html, /前端只负责提交和展示/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps business logic behind the backend API contract", async () => {
  const [page, api, types, contract, handoff, envExample] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/reconciliation-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/reconciliation-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/api-contract.yaml", import.meta.url), "utf8"),
    readFile(new URL("../docs/backend-handoff.md", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(page, /reconciliationApi\.createTask/);
  assert.match(page, /reconciliationApi\.listTasks/);
  assert.match(page, /reconciliationApi\.getTask/);
  assert.match(page, /reconciliationApi\.getStatistics/);
  assert.match(api, /formData\.append\("settlementFile"/);
  assert.match(api, /formData\.append\("erpFile"/);
  assert.match(api, /"Idempotency-Key": crypto\.randomUUID\(\)/);
  assert.match(api, /NEXT_PUBLIC_API_BASE_URL/);
  assert.match(types, /"QUEUED"[\s\S]*"PROCESSING"[\s\S]*"SUCCEEDED"[\s\S]*"NEEDS_REVIEW"[\s\S]*"FAILED"/);
  assert.match(contract, /operationId: createReconciliationTask/);
  assert.match(contract, /operationId: listReconciliationTasks/);
  assert.match(contract, /operationId: getReconciliationTask/);
  assert.match(contract, /operationId: getReconciliationStatistics/);
  assert.match(handoff, /前端不得根据上传文件自行计算对账结果/);
  assert.match(envExample, /NEXT_PUBLIC_API_BASE_URL=http:\/\/localhost:8080/);
});
