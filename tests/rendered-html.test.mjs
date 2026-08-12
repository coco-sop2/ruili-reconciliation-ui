import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

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
    reviewHook,
    overview,
    serverTasks,
    serverFiles,
    reconciliationService,
    cherryStudio,
    schema,
  ] = await Promise.all([
    source("../src/features/reconciliation/api/index.ts"),
    source("../src/features/reconciliation/api/http-client.ts"),
    source("../src/features/reconciliation/hooks/ReconciliationTaskProvider.tsx"),
    source("../src/features/reconciliation/hooks/use-review-items.ts"),
    source("../src/features/reconciliation/components/OverviewView.tsx"),
    source("../server/src/routes/tasks.ts"),
    source("../server/src/routes/files.ts"),
    source("../server/src/services/reconciliation.ts"),
    source("../server/src/lib/cherrystudio.ts"),
    source("../server/prisma/schema.prisma"),
  ]);

  assert.match(apiEntry, /VITE_API_BASE_URL/);
  assert.match(apiEntry, /HttpReconciliationApi/);
  assert.match(httpClient, /FormData/);
  assert.match(httpClient, /settlementFile/);
  assert.match(httpClient, /erpFile/);
  assert.match(httpClient, /updateReviewItem/);
  assert.match(httpClient, /deleteTask/);
  assert.match(httpClient, /method: "DELETE"/);
  assert.match(taskProvider, /progressLogs/);
  assert.match(taskProvider, /pollIntervalMs/);
  assert.match(reviewHook, /reconciliationApi\.updateReviewItem/);
  assert.match(overview, /window\.confirm/);

  assert.match(serverTasks, /status\(202\)/);
  assert.match(serverTasks, /getTaskProgress/);
  assert.match(serverTasks, /tasksRouter\.delete/);
  assert.match(serverTasks, /transaction\.reconciliationTask\.delete/);
  assert.match(serverTasks, /transaction\.file\.updateMany/);
  assert.match(serverFiles, /toUpperCase\(\)/);
  assert.match(reconciliationService, /files\/SETTLEMENT/);
  assert.match(reconciliationService, /files\/ERP/);
  assert.match(cherryStudio, /createAgentSession/);
  assert.match(cherryStudio, /method: "POST"/);
  assert.match(cherryStudio, /buildReconciliationSessionName/);
  assert.match(cherryStudio, /AbortSignal\.timeout/);
  assert.match(cherryStudio, /normalizeDifferenceDirection/);
  assert.match(reconciliationService, /ERP - 结算/);

  assert.match(schema, /provider = "postgresql"/);
  assert.match(schema, /model ReconciliationTask/);
  assert.match(schema, /model ReconciliationReviewItem/);
  assert.match(schema, /model File/);
});
