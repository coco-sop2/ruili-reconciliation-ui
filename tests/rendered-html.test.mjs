import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

function extractPromptTemplate(fileSource) {
  const match = fileSource.match(/return `(我有一个对账任务：[\s\S]*?- name: 字符串，drp表单中的商城名称)`/);
  assert.ok(match, "未找到对账 Prompt 模板");
  return match[1];
}

async function readBuiltClient() {
  const assetsDirectory = new URL("../dist/assets/", import.meta.url);
  const assetNames = await readdir(assetsDirectory);
  const scripts = await Promise.all(
    assetNames
      .filter((assetName) => assetName.endsWith(".js"))
      .map((assetName) => readFile(new URL(assetName, assetsDirectory), "utf8")),
  );
  return scripts.join("\n");
}

test("builds the Vite reconciliation shell", async () => {
  const html = await source("../dist/index.html");
  const client = await readBuiltClient();

  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<title>锐力对账｜财务协同工作台<\/title>/);
  assert.match(html, /\/assets\/index-[^"]+\.js/);
  assert.doesNotMatch(html, /vinext|cloudflare|worker/i);
  assert.doesNotMatch(client, /vinext|cloudflare|wrangler|next\/headers|next\/font/i);
});

test("routes reconciliation through the HTTP backend", async () => {
  const [
    apiEntry,
    httpClient,
    taskProvider,
    startView,
    reviewHook,
    overview,
    serverTasks,
    serverReviewItems,
    serverFiles,
    reconciliationService,
    promptTemplate,
    cherryStudio,
    schema,
    startAll,
  ] = await Promise.all([
    source("../src/features/reconciliation/api/index.ts"),
    source("../src/features/reconciliation/api/http-client.ts"),
    source("../src/features/reconciliation/hooks/ReconciliationTaskProvider.tsx"),
    source("../src/features/reconciliation/components/StartView.tsx"),
    source("../src/features/reconciliation/hooks/use-review-items.ts"),
    source("../src/features/reconciliation/components/OverviewView.tsx"),
    source("../server/src/routes/tasks.ts"),
    source("../server/src/routes/review-items.ts"),
    source("../server/src/routes/files.ts"),
    source("../server/src/services/reconciliation.ts"),
    source("../src/features/reconciliation/api/prompt.ts"),
    source("../server/src/lib/cherrystudio.ts"),
    source("../server/prisma/schema.prisma"),
    source("../scripts/start-all.mjs"),
  ]);

  assert.match(apiEntry, /VITE_API_BASE_URL/);
  assert.match(apiEntry, /HttpReconciliationApi/);
  assert.match(httpClient, /FormData/);
  assert.match(httpClient, /settlementFile/);
  assert.match(httpClient, /erpFile/);
  assert.match(httpClient, /updateReviewItem/);
  assert.match(httpClient, /deleteTask/);
  assert.match(httpClient, /stopTask/);
  assert.match(httpClient, /\/stop/);
  assert.match(httpClient, /method: "DELETE"/);
  assert.match(taskProvider, /progressLogs/);
  assert.match(taskProvider, /pollIntervalMs/);
  assert.match(reviewHook, /reconciliationApi\.updateReviewItem/);
  assert.match(reviewHook, /\["NEEDS_REVIEW", "REVIEWED"\]/);
  assert.match(overview, /window\.confirm/);
  assert.match(overview, /record\.name/);

  assert.match(serverTasks, /status\(202\)/);
  assert.match(serverTasks, /getTaskProgress/);
  assert.match(serverTasks, /tasksRouter\.delete/);
  assert.match(serverTasks, /tasksRouter\.post\("\/:id\/stop"/);
  assert.match(serverTasks, /transaction\.reconciliationTask\.delete/);
  assert.match(serverTasks, /transaction\.file\.updateMany/);
  assert.match(serverFiles, /toUpperCase\(\)/);
  assert.match(reconciliationService, /files\/SETTLEMENT/);
  assert.match(reconciliationService, /files\/ERP/);
  assert.doesNotMatch(reconciliationService, /attemptCount >= 3/);
  assert.doesNotMatch(reconciliationService, /RETRY_LIMIT_REACHED/);
  assert.doesNotMatch(reconciliationService, /data:\s*\{\s*status:\s*TaskStatus\.OBSOLETE/);
  assert.match(reconciliationService, /每次对账都是独立业务记录/);
  assert.match(serverReviewItems, /SELECT 1 AS acquired\s+FROM pg_advisory_xact_lock/);
  assert.doesNotMatch(serverReviewItems, /SELECT pg_advisory_xact_lock/);
  assert.match(cherryStudio, /createAgentSession/);
  assert.match(cherryStudio, /method: "POST"/);
  assert.match(cherryStudio, /buildReconciliationSessionName/);
  assert.match(cherryStudio, /AbortSignal\.timeout/);
  assert.match(cherryStudio, /normalizeDifferenceDirection/);
  assert.match(cherryStudio, /extractTaskName/);
  assert.match(reconciliationService, /ERP 金额 - 结算单金额/);
  assert.match(reconciliationService, /drp表单中的商城名称/);
  assert.match(reconciliationService, /SELECT 1 AS acquired\s+FROM pg_advisory_xact_lock/);
  assert.doesNotMatch(reconciliationService, /SELECT pg_advisory_xact_lock/);
  assert.match(promptTemplate, /drp表单中的商城名称/);
  assert.match(promptTemplate, /"issues": ""/);
  assert.match(promptTemplate, /格式必须为 "YYYY-MM"/);
  assert.equal(extractPromptTemplate(reconciliationService), extractPromptTemplate(promptTemplate));

  assert.match(schema, /provider = "postgresql"/);
  assert.match(schema, /model ReconciliationTask/);
  assert.match(schema, /name\s+String\?/);
  assert.match(schema, /model ReconciliationReviewItem/);
  assert.match(schema, /model File/);
  assert.match(startAll, /npm-cli\.js/);
  assert.doesNotMatch(startAll, /spawnSync\(npmCommand/);
  assert.match(startAll, /\[viteCli, "preview"/);
  assert.match(httpClient, /startupRetryDelaysMs/);
  assert.match(serverTasks, /AGENT_NAME_REQUIRED/);
  assert.match(serverTasks, /agentName 为必填字段/);
  assert.match(httpClient, /formData\.append\("agentName", agentName\)/);
  assert.match(startView, /Agent 名称（必填）/);
  assert.match(startView, /required/);
});
