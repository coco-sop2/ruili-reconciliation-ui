// 文件说明：项目约束测试，确认 Vite 构建和 CherryStudio 接口链路没有被改坏。
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

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
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const client = await readBuiltClient();

  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<title>锐力对账｜财务协同工作台<\/title>/);
  assert.match(html, /\/assets\/index-[^"]+\.js/);
  assert.doesNotMatch(html, /vinext|cloudflare|worker/i);
  assert.doesNotMatch(client, /vinext|cloudflare|wrangler|next\/headers|next\/font/i);
});

test("routes reconciliation work through CherryStudio", async () => {
  const [
    app,
    startView,
    overviewView,
    reviewView,
    startHook,
    overviewHook,
    reviewHook,
    apiEntry,
    cherryStudioClient,
    formData,
    responseAdapter,
    fileRules,
    types,
    contract,
    envExample,
  ] = await Promise.all([
    readFile(new URL("../src/app/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/components/StartView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/components/OverviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/hooks/use-start-reconciliation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/hooks/use-reconciliation-overview.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/hooks/use-review-items.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/cherrystudio-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/form-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/response-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/model/file-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/model/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/cherrystudio-agent-contract.md", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  const pageSource = [app, startView, overviewView, reviewView, startHook, overviewHook, reviewHook].join("\n");
  const apiSource = [apiEntry, cherryStudioClient, formData, responseAdapter, fileRules].join("\n");
  const runtimeSource = [pageSource, apiSource].join("\n");

  assert.match(pageSource, /useStartReconciliation/);
  assert.match(pageSource, /useReconciliationOverview/);
  assert.match(pageSource, /useReviewItems/);
  assert.match(pageSource, /reconciliationApi\.createTask/);
  assert.match(pageSource, /reconciliationApi\.listTasks/);
  assert.match(pageSource, /reconciliationApi\.getTask/);
  assert.match(pageSource, /reconciliationApi\.getStatistics/);
  assert.match(pageSource, /status: \["NEEDS_REVIEW"\]/);
  assert.match(pageSource, /reviewItems/);
  assert.match(pageSource, /结算单金额/);
  assert.match(pageSource, /ERP 金额/);
  assert.match(pageSource, /差额/);
  assert.match(pageSource, /reconciliationFileAccept/);
  assert.match(pageSource, /validateReconciliationFile/);

  assert.match(apiSource, /createReconciliationFormData/);
  assert.match(apiSource, /createTaskFromCherryStudioResponse/);
  assert.match(apiSource, /readCherryStudioJson/);
  assert.match(apiSource, /formData\.append\("settlementFile"/);
  assert.match(apiSource, /formData\.append\("erpFile"/);
  assert.match(apiSource, /formData\.append\("skill"/);
  assert.match(apiSource, /formData\.append\(\s*"payload"/);
  assert.match(apiSource, /method: "POST"/);
  assert.match(apiSource, /VITE_CHERRYSTUDIO_AGENT_URL/);
  assert.match(apiSource, /VITE_CHERRYSTUDIO_AGENT_SKILL/);
  assert.match(apiSource, /issues/);
  assert.match(apiSource, /summary/);
  assert.match(apiSource, /reviewItemsFromResponse/);
  assert.match(apiSource, /"Idempotency-Key": idempotencyKey/);
  assert.match(apiSource, /"X-Agent-Skill": this\.config\.skillName/);
  assert.match(apiSource, /credentials: "include"/);
  assert.match(apiSource, /\.pdf/);
  assert.match(apiSource, /\.png/);
  assert.match(apiSource, /\.jpeg/);
  assert.match(apiSource, /getReconciliationFileMetadata/);
  assert.match(apiSource, /extension/);
  assert.doesNotMatch(apiSource, /VITE_API_BASE_URL|HttpReconciliationApi|reconciliationApiEndpoints/);
  assert.doesNotMatch(runtimeSource, /\.\.\/\.\.\/lib|\.\/reconciliation-/);

  assert.match(types, /"QUEUED"[\s\S]*"PROCESSING"[\s\S]*"SUCCEEDED"[\s\S]*"NEEDS_REVIEW"[\s\S]*"FAILED"/);
  assert.match(contract, /VITE_CHERRYSTUDIO_AGENT_URL/);
  assert.match(contract, /X-Agent-Skill/);
  assert.match(contract, /start_reconciliation/);
  assert.match(contract, /NEEDS_REVIEW/);
  assert.match(contract, /settlementValue/);
  assert.match(contract, /erpValue/);
  assert.match(contract, /differenceAmount/);
  assert.match(contract, /Excel/);
  assert.match(contract, /PDF/);
  assert.match(contract, /extension/);
  assert.match(envExample, /VITE_CHERRYSTUDIO_AGENT_URL=/);
  assert.match(envExample, /VITE_CHERRYSTUDIO_AGENT_SKILL=reconciliation\.start/);
  assert.doesNotMatch(envExample, /VITE_API_BASE_URL/);
});
