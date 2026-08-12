import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentResponse, resolveAgentSession } from "../dist/lib/cherrystudio.js";
import { config } from "../dist/lib/config.js";
import { buildReconciliationPrompt } from "../dist/services/reconciliation.js";

test("normalizes differences to ERP minus settlement", () => {
  const result = parseAgentResponse(JSON.stringify({
    matched: false,
    difference: 5,
    period: "2026-05",
    issues: [{ settlementValue: 512047, erpValue: 512042, differenceAmount: 5 }],
  }));

  assert.equal(result?.difference, -5);
  assert.equal(result?.issues[0].differenceAmount, -5);
});

test("normalizes a reversed total from multiple issue differences", () => {
  const result = parseAgentResponse(JSON.stringify({
    matched: false,
    difference: 5,
    issues: [
      { settlementValue: 100, erpValue: 98, differenceAmount: 2 },
      { settlementValue: 50, erpValue: 47, differenceAmount: 3 },
    ],
  }));

  assert.equal(result?.difference, -5);
  assert.deepEqual(result?.issues.map((issue) => issue.differenceAmount), [-2, -3]);
});

test("rejects contradictory matched results", () => {
  assert.equal(parseAgentResponse('{"matched":true,"difference":5,"issues":[]}'), null);
  assert.equal(parseAgentResponse('{"matched":false,"difference":0,"issues":[]}'), null);
  assert.equal(parseAgentResponse('{"matched":true,"difference":0,"issues":[{"differenceAmount":1}]}'), null);
});

test("keeps offsetting line differences reviewable when the total is zero", () => {
  const result = parseAgentResponse(JSON.stringify({
    matched: false,
    difference: 0,
    issues: [
      { rowLabel: "A", settlementValue: 10, erpValue: 8, differenceAmount: -2 },
      { rowLabel: "B", settlementValue: 8, erpValue: 10, differenceAmount: 2 },
    ],
  }));

  assert.equal(result?.matched, false);
  assert.equal(result?.issues.length, 2);
});

test("creates a reviewable summary when only a total difference is returned", () => {
  const result = parseAgentResponse('{"matched":false,"difference":17,"issues":[]}');

  assert.equal(result?.difference, 17);
  assert.equal(result?.issues.length, 1);
  assert.equal(result?.issues[0].differenceAmount, 17);
});

test("rejects invalid period months without rejecting the reconciliation", () => {
  const result = parseAgentResponse('{"matched":true,"difference":0,"period":"2026-13","issues":[]}');

  assert.equal(result?.matched, true);
  assert.equal(result?.period, null);
});

test("preserves extra issue fields and optional totals", () => {
  const result = parseAgentResponse(JSON.stringify({
    matched: false,
    settlementAmount: "100.50",
    erpAmount: 98.5,
    difference: -2,
    issues: [{ differenceAmount: -2, customTrace: "source-row-9" }],
  }));

  assert.equal(result?.settlementAmount, 100.5);
  assert.equal(result?.erpAmount, 98.5);
  assert.equal(result?.issues[0].customTrace, "source-row-9");
});

test("prompt states the signed difference contract", () => {
  const prompt = buildReconciliationPrompt({
    settlementFileUrl: "http://127.0.0.1/settlement",
    erpFileUrl: "http://127.0.0.1/erp",
    settlementFilePath: "C:/files/settlement.xlsx",
    erpFilePath: "C:/files/erp.xlsx",
    submittedAt: new Date(0).toISOString(),
    taskId: "test-task",
  });

  assert.match(prompt, /ERP - 结算/);
  assert.match(prompt, /结算大于 ERP 时必须为负数/);
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
      assert.match(String(init.body), /"name":"对账-/);
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
