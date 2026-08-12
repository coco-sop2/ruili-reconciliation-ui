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
    taskProvider,
    overviewHook,
    reviewHook,
    apiEntry,
    cherryStudioClient,
    responseAdapter,
    fileRules,
    types,
    contract,
    envExample,
    fileUploader,
    promptBuilder,
    agentResolver,
    viteConfig,
  ] = await Promise.all([
    readFile(new URL("../src/app/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/components/StartView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/components/OverviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/components/ReviewView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/hooks/use-start-reconciliation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/hooks/ReconciliationTaskProvider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/hooks/use-reconciliation-overview.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/hooks/use-review-items.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/cherrystudio-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/response-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/model/file-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/model/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/cherrystudio-agent-contract.md", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/file-uploader.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/prompt.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reconciliation/api/agent-resolver.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);
  const pageSource = [app, startView, overviewView, reviewView, startHook, taskProvider, overviewHook, reviewHook].join("\n");
  const apiSource = [apiEntry, cherryStudioClient, responseAdapter, fileRules, fileUploader, promptBuilder, agentResolver, viteConfig].join("\n");
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
  assert.match(pageSource, /Agent 名称/);
  assert.match(pageSource, /Agent 工作目录/);
  assert.match(pageSource, /API Key（必填）/);
  assert.match(pageSource, /type="password"/);
  assert.match(pageSource, /apiKey\.trim\(\)/);
  assert.match(pageSource, /apiKey: requestApiKey/);
  assert.match(pageSource, /redactApiKey/);
  assert.match(pageSource, /appendSafeLog/);

  assert.match(apiSource, /createReconciliationPromptPayload/);
  assert.match(apiSource, /buildReconciliationPrompt/);
  assert.match(apiSource, /createTaskFromCherryStudioResponse/);
  assert.match(apiSource, /readCherryStudioJson/);
  assert.match(apiSource, /"X-File-Name": encodeURIComponent\(file\.name\)/);
  assert.match(apiSource, /body: file/);
  assert.match(apiSource, /localReconciliationUploadPlugin/);
  assert.match(apiSource, /\/api\/reconciliation\/upload/);
  assert.match(apiSource, /uploadBoth/);
  assert.match(apiSource, /settlementFileUrl/);
  assert.match(apiSource, /erpFileUrl/);
  assert.match(apiSource, /url: fileUrls\.settlementFileUrl/);
  assert.match(apiSource, /url: fileUrls\.erpFileUrl/);
  assert.doesNotMatch(cherryStudioClient, /FormData|multipart\/form-data/);
  assert.match(apiSource, /JSON\.stringify\(\{ content: prompt \}\)/);
  assert.match(apiSource, /method: "POST"/);
  assert.doesNotMatch(runtimeSource, /VITE_CHERRYSTUDIO_API_KEY/);
  assert.match(apiSource, /findCherryAgentSession/);
  assert.match(apiSource, /\/v1\/agents\?limit=100&offset=/);
  assert.match(apiSource, /createCherryAgentSession/);
  assert.match(apiSource, /buildReconciliationSessionName/);
  assert.match(apiSource, /\/v1\/agents\/\$\{encodeURIComponent\(agent\.id\)\}\/sessions/);
  assert.match(apiSource, /body: JSON\.stringify\(\{ name: buildReconciliationSessionName\(\) \}\)/);
  assert.match(apiSource, /\["data", "agents"\]/);
  assert.match(apiSource, /normalizePath/);
  assert.match(apiSource, /issues/);
  assert.match(apiSource, /summary/);
  assert.match(apiSource, /reviewItemsFromResponse/);
  assert.doesNotMatch(cherryStudioClient, /"Idempotency-Key"/);
  assert.match(apiSource, /Authorization: `Bearer \$\{input\.apiKey\}`/);
  assert.match(apiSource, /"Content-Type": "application\/json"/);
  assert.match(apiSource, /matched/);
  assert.match(apiSource, /difference/);
  assert.match(apiSource, /\.pdf/);
  assert.match(apiSource, /\.png/);
  assert.match(apiSource, /\.jpeg/);
  assert.match(apiSource, /getReconciliationFileMetadata/);
  assert.match(apiSource, /extension/);
  assert.doesNotMatch(apiSource, /VITE_API_BASE_URL|HttpReconciliationApi|reconciliationApiEndpoints/);
  assert.doesNotMatch(runtimeSource, /\.\.\/\.\.\/lib|\.\/reconciliation-/);

  assert.match(types, /"QUEUED"[\s\S]*"PROCESSING"[\s\S]*"SUCCEEDED"[\s\S]*"NEEDS_REVIEW"[\s\S]*"FAILED"/);
  assert.match(contract, /VITE_CHERRYSTUDIO_DEFAULT_AGENT_NAME/);
  assert.match(contract, /Authorization: Bearer/);
  assert.match(contract, /\/v1\/agents\//);
  assert.match(contract, /NEEDS_REVIEW/);
  assert.match(contract, /settlementValue/);
  assert.match(contract, /erpValue/);
  assert.match(contract, /differenceAmount/);
  assert.match(contract, /Excel/);
  assert.match(contract, /PDF/);
  assert.match(contract, /extension/);
  assert.match(envExample, /VITE_RECONCILIATION_UPLOAD_URL=/);
  assert.doesNotMatch(envExample, /VITE_CHERRYSTUDIO_API_KEY=/);
  assert.match(envExample, /VITE_CHERRYSTUDIO_DEFAULT_AGENT_NAME=/);
  assert.match(envExample, /VITE_CHERRYSTUDIO_DEFAULT_AGENT_WORKSPACE=/);
  assert.doesNotMatch(envExample, /VITE_API_BASE_URL/);
});
