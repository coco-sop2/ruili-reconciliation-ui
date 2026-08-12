import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAgentResponse,
  RECONCILIATION_AGENT_INSTRUCTIONS,
  resolveAgentSession,
} from "../dist/lib/cherrystudio.js";
import { config } from "../dist/lib/config.js";
import { buildReconciliationPrompt } from "../dist/services/reconciliation.js";

const contractResult = (overrides = {}) => ({
  matched: false,
  difference: -1,
  issues: "结算单比 ERP 多计 1 元。",
  period: "2026-05",
  name: "京东商城",
  ...overrides,
});

test("parses the exact five-field Agent result and creates a review item", () => {
  const payload = contractResult({ difference: -5, issues: "结算金额比 ERP 多 5 元。" });
  const result = parseAgentResponse(JSON.stringify(payload));

  assert.equal(result?.difference, -5);
  assert.equal(result?.issues[0].differenceAmount, -5);
  assert.equal(result?.issues[0].message, "结算金额比 ERP 多 5 元。");
  assert.equal(result?.name, "京东商城");
  assert.equal(result?.period, "2026-05");
  assert.deepEqual(result?.rawAgentPayload, payload);
});

test("accepts a matched result with an empty issues string", () => {
  const result = parseAgentResponse(JSON.stringify(contractResult({
    matched: true,
    difference: 0,
    issues: "",
  })));

  assert.equal(result?.matched, true);
  assert.deepEqual(result?.issues, []);
});

test("rejects contradictory matched results", () => {
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ matched: true, difference: 5, issues: "" }))), null);
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ difference: 0, issues: "" }))), null);
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ matched: true, difference: 0, issues: "仍有差异" }))), null);
});

test("creates a reviewable summary when only a total difference is returned", () => {
  const result = parseAgentResponse(JSON.stringify(contractResult({ difference: 17, issues: "" })));

  assert.equal(result?.difference, 17);
  assert.equal(result?.issues.length, 1);
  assert.equal(result?.issues[0].differenceAmount, 17);
});

test("corrects a wrong Agent total from explicit ERP and settlement sales amounts", () => {
  const issues = "ERP 中有 16% 和 17% 两档扣点（16%档销售额 86175 元），而结算单全部按 17% 计算；且 ERP 方未体现结算单中的调整项费用（合计 13,272.58 元）。此外 ERP 总销售额 512,042 与结算单净营业额 512,047 存在 5 元差异。";
  const result = parseAgentResponse(JSON.stringify(contractResult({
    difference: 15855.61,
    issues,
  })));

  assert.equal(result?.difference, -5);
  assert.equal(result?.issues[0].differenceAmount, -5);
  assert.equal(result?.rawAgentPayload.difference, 15855.61);
  assert.equal(result?.rawAgentPayload.issues, issues);
});

test("corrects a concise sales-total explanation without confusing adjustment amounts", () => {
  const result = parseAgentResponse(JSON.stringify(contractResult({
    difference: 857.6,
    issues: "两方营业额口径差5元（ERP 512042元、结算单512047元），另有调整项 13272.58 元。",
  })));

  assert.equal(result?.difference, -5);
  assert.equal(result?.issues[0].differenceAmount, -5);
});

test("requires exactly the five documented fields and their documented types", () => {
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ name: "" }))), null);
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ name: undefined }))), null);
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ period: "2026年-05月" }))), null);
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ period: "2026-13" }))), null);
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ difference: "-1" }))), null);
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ issues: [] }))), null);
  assert.equal(parseAgentResponse(JSON.stringify(contractResult({ issues: undefined }))), null);
  assert.equal(parseAgentResponse(JSON.stringify({ ...contractResult(), extra: true })), null);
});

test("sends the provided prompt without changing its content", () => {
  const prompt = buildReconciliationPrompt({
    settlementFileUrl: "http://127.0.0.1/settlement",
    erpFileUrl: "http://127.0.0.1/erp",
    settlementFilePath: "C:/files/settlement.xlsx",
    erpFilePath: "C:/files/erp.xlsx",
    submittedAt: new Date(0).toISOString(),
    taskId: "test-task",
  });

  assert.equal(prompt, `我有一个对账任务：

http://127.0.0.1/erp
这是 ERP 导出单据

http://127.0.0.1/settlement
这是结算单

在过程中，面对图片、PDF 等文件，你可以使用 mineru 这个项目 Subagent 获取 Markdown 格式的内容。

请帮我看看是否能够对上账。

当你完成对账后，最后只输出一个合法的 JSON 对象，不要使用 Markdown 代码块，也不要在 JSON 前后输出其他内容。格式例子如下：

{
  "matched": true,
  "difference": 0.00,
  "issues": "",
  "period": "XXXX-XX",
  "name": "商城名称A"
}

或者：

{
  "matched": false,
  "difference": 1500.00,
  "issues": "DRP 中有 16% 和 17% 两档扣点，而结算单全部按 17% 计算。可能存在退款记录未同步。",
  "period": "XXXX-XX",
  "name": "商城名称A"
}

其中：
- matched：true 表示两方金额一致；false 表示存在差异
- difference：ERP 金额 - 结算单金额，单位为元
  - difference正数：ERP 多计，结算单少计
  - difference负数：ERP 少计，结算单多计
  - difference为0：金额一致
- issues: 字符串，列出造成差异的疑似原因；如果金额一致或未发现疑似原因，输出""
- period: 字符串，对账月份，格式必须为 "YYYY-MM"
- name: 字符串，drp表单中的商城名称`);
});

test("paginates agents and creates a new session", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = config.cherryStudio.apiKey;
  const calls = [];
  config.cherryStudio.apiKey = "test-api-key";
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("offset=0")) {
      return Response.json({
        data: Array.from({ length: 100 }, (_, index) => ({ id: `other-${index}`, name: `其他-${index}` })),
        total: 101,
      });
    }
    if (url.includes("offset=100")) {
      return Response.json({ data: [{ id: "agent-target", name: "锐力" }], total: 101 });
    }
    if (url.endsWith("/v1/agents/agent-target/sessions")) {
      assert.equal(init.method, "POST");
      const body = JSON.parse(String(init.body));
      assert.match(body.name, /^对账-/);
      assert.equal(body.instructions, RECONCILIATION_AGENT_INSTRUCTIONS);
      assert.match(body.instructions, /difference 必须是 -5\.00/);
      return Response.json({ data: { session: { id: "session-new" } } }, { status: 201 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const target = await resolveAgentSession({ name: "锐力" });
    assert.deepEqual(target, {
      agentId: "agent-target",
      agentName: "锐力",
      sessionId: "session-new",
    });
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    config.cherryStudio.apiKey = originalApiKey;
  }
});
