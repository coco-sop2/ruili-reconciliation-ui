import { config } from "./config.js";

// CherryStudio agent 调用封装
// 第一版实现：根据 agent 名找 agent 和 session，发送对账 prompt，解析结果

export type CherryIssue = {
  [key: string]: unknown;
  id?: string;
  rowId?: string;
  rowLabel?: string;
  orderNo?: string;
  field?: string;
  fieldName?: string;
  fieldLabel?: string;
  settlementValue?: string | number | null;
  settlementAmount?: string | number | null;
  erpValue?: string | number | null;
  erpAmount?: string | number | null;
  difference?: string | number | null;
  differenceAmount?: string | number | null;
  message?: string;
  suggestion?: string | null;
  status?: "PENDING" | "APPROVED" | "IGNORED";
};

export type CherryParseResult = {
  matched: boolean;
  difference: number;
  issues: CherryIssue[];
  period?: string | null;
  settlementAmount?: number | null;
  erpAmount?: number | null;
};

export type CherryAgentSession = {
  agentId: string;
  agentName: string;
  sessionId: string;
};

export type AgentSelector = {
  name?: string;
  workspace?: string;
};

type CherryListResponse<T> = {
  data?: T[];
  agents?: T[];
  sessions?: T[];
  total?: number;
};

type CherryAgent = { id: string; name: string; accessible_paths?: string[] };
type CherrySession = { id: string; agent_id?: string; name?: string };

export class CherryStudioError extends Error {
  constructor(message: string, readonly code = "CHERRYSTUDIO_ERROR") {
    super(message);
    this.name = "CherryStudioError";
  }
}

function requestSignal(timeoutMs: number) {
  return AbortSignal.timeout(timeoutMs);
}

function normalizePath(value: string) {
  const slashPath = value.trim().replace(/\\/g, "/");
  const windowsPath = /^[a-zA-Z]:\//.test(slashPath);
  const drive = windowsPath ? slashPath.slice(0, 2) : "";
  const absolute = windowsPath || slashPath.startsWith("/");
  const pathWithoutRoot = windowsPath ? slashPath.slice(2) : slashPath;
  const segments: string[] = [];

  for (const segment of pathWithoutRoot.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }

  const normalized = `${drive}${absolute ? "/" : ""}${segments.join("/")}`.replace(/\/$/, "");
  return windowsPath ? normalized.toLowerCase() : normalized;
}

async function readJson<T>(response: Response, failureMessage: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new CherryStudioError(
      `${failureMessage}（HTTP ${response.status}）：${text.slice(0, 300)}`,
      "CHERRYSTUDIO_LOOKUP_FAILED",
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CherryStudioError(`${failureMessage}：接口没有返回合法 JSON`);
  }
}

async function fetchAgentList() {
  const agents: CherryAgent[] = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const response = await fetch(`${config.cherryStudio.baseUrl}/v1/agents?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${config.cherryStudio.apiKey}` },
      signal: requestSignal(config.cherryStudio.lookupTimeoutMs),
    });
    const payload = await readJson<CherryListResponse<CherryAgent>>(response, "查询 Agent 列表失败");
    const page = payload.data ?? payload.agents ?? [];
    agents.push(...page);
    if (
      page.length === 0
      || (payload.total === undefined ? page.length < limit : agents.length >= payload.total)
    ) break;
    offset += page.length;
  }

  return agents;
}

export async function checkCherryStudioConnection() {
  if (!config.cherryStudio.apiKey) {
    throw new CherryStudioError("后端未配置 CherryStudio API Key", "CHERRYSTUDIO_API_KEY_MISSING");
  }
  const agents = await fetchAgentList();
  return { status: "ok" as const, agentCount: agents.length };
}

function buildReconciliationSessionName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `对账-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function createAgentSession(agent: CherryAgent) {
  const response = await fetch(
    `${config.cherryStudio.baseUrl}/v1/agents/${encodeURIComponent(agent.id)}/sessions`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.cherryStudio.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: buildReconciliationSessionName() }),
      signal: requestSignal(config.cherryStudio.lookupTimeoutMs),
    },
  );
  const payload = await readJson<unknown>(response, "创建 CherryStudio Session 失败");
  const session = extractSession(payload);
  if (!session?.id) {
    throw new CherryStudioError("CherryStudio 没有返回新 Session 的 ID", "SESSION_CREATE_FAILED");
  }
  return session;
}

function extractSession(input: unknown): CherrySession | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  if (typeof record.id === "string") {
    return {
      id: record.id,
      agent_id: typeof record.agent_id === "string" ? record.agent_id : undefined,
      name: typeof record.name === "string" ? record.name : undefined,
    };
  }
  for (const key of ["data", "session"] as const) {
    const session = extractSession(record[key]);
    if (session) return session;
  }
  if (Array.isArray(record.sessions)) {
    for (const value of record.sessions) {
      const session = extractSession(value);
      if (session) return session;
    }
  }
  return undefined;
}

/**
 * 解析 Agent 选择器，并为每次对账新建独立 Session。
 */
export async function resolveAgentSession(
  selector: AgentSelector,
  onLog?: (level: "info" | "success" | "error", message: string) => void,
): Promise<CherryAgentSession> {
  onLog?.("info", "正在查找对账 Agent…");
  if (!config.cherryStudio.apiKey) {
    throw new CherryStudioError("后端未配置 CherryStudio API Key", "CHERRYSTUDIO_API_KEY_MISSING");
  }
  const agents = await fetchAgentList();

  if (agents.length === 0) {
    throw new CherryStudioError("没有找到任何 Agent，请检查 CherryStudio 配置", "AGENT_NOT_FOUND");
  }

  const name = (selector.name || config.cherryStudio.defaultAgentName || "").trim();
  const workspace = (selector.workspace || config.cherryStudio.defaultAgentWorkspace || "").trim();
  const normalizedWorkspace = workspace ? normalizePath(workspace) : "";
  const matches = agents.filter((candidate) => {
    const nameMatches = !name || candidate.name === name;
    const workspaceMatches = !normalizedWorkspace || candidate.accessible_paths?.some(
      (candidatePath) => normalizePath(candidatePath) === normalizedWorkspace,
    );
    return nameMatches && Boolean(workspaceMatches);
  });
  if (matches.length === 0) {
    throw new CherryStudioError(
      `没有找到匹配的 Agent：${JSON.stringify({ name: name || undefined, workspace: workspace || undefined })}`,
      "AGENT_NOT_FOUND",
    );
  }
  if (matches.length > 1) {
    throw new CherryStudioError("找到多个匹配 Agent，请同时填写准确名称和工作目录", "AGENT_AMBIGUOUS");
  }

  const agent = matches[0];
  onLog?.("success", `已匹配 Agent：${agent.name}`);
  onLog?.("info", "正在创建本次对账 Session…");
  const session = await createAgentSession(agent);
  onLog?.("success", `Session 已创建：${session.id}`);

  return { agentId: agent.id, agentName: agent.name, sessionId: session.id };
}

/**
 * 向 agent 发送对账消息，返回解析结果。
 * prompt 中应包含文件 URL。
 * 注意：CherryStudio 消息接口返回 SSE 流，必须流式读取。
 */
export async function sendReconciliationPrompt(
  target: CherryAgentSession,
  prompt: string,
  onLog?: (level: "info" | "success" | "error", message: string) => void,
): Promise<CherryParseResult> {
  onLog?.("info", "正在提交对账请求至 Agent…");
  const messageUrl = `${config.cherryStudio.baseUrl}/v1/agents/${encodeURIComponent(target.agentId)}/sessions/${encodeURIComponent(target.sessionId)}/messages`;

  const response = await fetch(messageUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.cherryStudio.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: prompt }),
    signal: requestSignal(config.cherryStudio.requestTimeoutMs),
  });

  if (!response.ok) {
    onLog?.("error", `CherryStudio 请求失败（HTTP ${response.status}）`);
    throw new CherryStudioError(
      `CherryStudio 请求失败（HTTP ${response.status}）`,
      "CHERRYSTUDIO_AGENT_REQUEST_FAILED",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  // SSE 流：流式读取，收集 text-delta / text-end
  if (contentType.includes("text/event-stream")) {
    const finalText = await readSseFinalText(response, onLog);
    if (!finalText.trim()) {
      throw new CherryStudioError("Agent 没有返回内容", "CHERRYSTUDIO_AGENT_EMPTY_RESPONSE");
    }
    const parsed = parseAgentResponse(finalText);
    if (!parsed) {
      throw new CherryStudioError(
        "CherryStudio agent 没有返回合法的 { matched, difference } JSON",
        "CHERRYSTUDIO_AGENT_INVALID_RESPONSE",
      );
    }
    onLog?.("success", "Agent 对账完成");
    return parsed;
  }

  // 普通 JSON
  const text = await response.text();
  if (!text.trim()) {
    throw new CherryStudioError("Agent 没有返回内容", "CHERRYSTUDIO_AGENT_EMPTY_RESPONSE");
  }
  const parsed = parseAgentResponse(text);
  if (!parsed) {
    throw new CherryStudioError(
      "CherryStudio agent 没有返回合法的 { matched, difference } JSON",
      "CHERRYSTUDIO_AGENT_INVALID_RESPONSE",
    );
  }
  onLog?.("success", "Agent 对账完成");
  return parsed;
}

type SseEvent = {
  type?: string;
  text?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  providerMetadata?: {
    raw?: {
      message?: {
        content?: Array<{ text?: string }>;
      };
    };
  };
};

function singleLine(value: string, maxLength: number) {
  const line = value.split(/\r?\n/).find((item) => item.trim());
  const trimmed = (line ?? value).trim().replace(/\s+/g, " ");
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function toolInputSummary(input: unknown): string {
  if (typeof input === "string") return singleLine(input, 80);
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const command = typeof record.command === "string" ? record.command : undefined;
    const description = typeof record.description === "string" ? record.description : undefined;
    const first = command ?? description;
    if (typeof first === "string") return singleLine(first, 80);
    const value = Object.values(record).find((item) => typeof item === "string");
    if (typeof value === "string") return singleLine(value, 80);
  }
  return "";
}

async function readSseFinalText(
  response: Response,
  onLog?: (level: "info" | "success" | "error", message: string) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let chunkBuffer = "";
  let deltaText = "";
  let finalText = "";
  let reasoningText = "";

  const flushReasoning = () => {
    const text = reasoningText.trim();
    if (text) onLog?.("info", `正在思考：${singleLine(text, 180)}`);
    reasoningText = "";
  };

  const handleEventData = (data: string) => {
    const trimmed = data.trim();
    if (!trimmed || trimmed === "[DONE]") return;

    let event: SseEvent;
    try {
      event = JSON.parse(trimmed) as SseEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "start":
        onLog?.("info", "Agent 开始处理…");
        break;
      case "reasoning-delta":
        if (typeof event.text === "string") {
          reasoningText += event.text;
          if (reasoningText.length >= 240) flushReasoning();
        }
        break;
      case "tool-call": {
        flushReasoning();
        const name = event.toolName ?? "工具";
        const detail = toolInputSummary(event.input);
        onLog?.("info", `调用工具 ${name}${detail ? `：${detail}` : ""}`);
        break;
      }
      case "tool-result": {
        flushReasoning();
        const name = event.toolName ?? "工具";
        const detail = typeof event.output === "string" ? singleLine(event.output, 60) : "";
        onLog?.("success", `${name} 执行完成${detail ? `：${detail}` : ""}`);
        break;
      }
      case "tool-error": {
        flushReasoning();
        const name = event.toolName ?? "工具";
        onLog?.("error", `${name} 执行出错`);
        break;
      }
      case "finish":
        flushReasoning();
        onLog?.("success", "Agent 处理完成，正在整理最终结果…");
        break;
    }

    if (event.type === "text-delta" && typeof event.text === "string") {
      // CherryStudio providers may emit either cumulative or incremental deltas.
      deltaText = event.text.startsWith(deltaText) ? event.text : deltaText + event.text;
    }
    if (event.type === "text-end") {
      const content = event.providerMetadata?.raw?.message?.content;
      if (Array.isArray(content)) {
        const joined = content.map((block) => block.text ?? "").join("");
        if (joined) finalText = joined;
      }
    }
  };

  const consumeBuffer = () => {
    let sepIndex: number;
    while ((sepIndex = chunkBuffer.search(/\r?\n\r?\n/)) >= 0) {
      const rawEvent = chunkBuffer.slice(0, sepIndex);
      chunkBuffer = chunkBuffer.slice(sepIndex + (chunkBuffer[sepIndex] === "\r" ? 4 : 2));
      for (const line of rawEvent.split(/\r?\n/)) {
        if (line.startsWith("data:")) handleEventData(line.slice(5));
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunkBuffer += decoder.decode(value, { stream: true });
    consumeBuffer();
  }

  if (chunkBuffer.trim()) {
    for (const line of chunkBuffer.split(/\r?\n/)) {
      if (line.startsWith("data:")) handleEventData(line.slice(5));
    }
  }

  flushReasoning();

  return finalText || deltaText;
}

/**
 * 解析 agent 返回的文本（JSON 或 SSE 流中的 JSON）。
 * 从各种嵌套结构里提取 { matched, difference, issues }。
 */
export function parseAgentResponse(text: string): CherryParseResult | null {
  // 尝试从整段文本解析
  const direct = tryParseObject(text);
  if (direct) return direct;

  // SSE：提取 data 行里的 JSON
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");

  // 从后往前找最后一段含 { } 的数据
  for (let i = dataLines.length - 1; i >= 0; i--) {
    const parsed = tryParseObject(dataLines[i]);
    if (parsed) return parsed;
  }

  // 尝试拼接所有 delta 文本
  const allDelta = dataLines.join("");
  if (allDelta) {
    const joined = tryParseObject(allDelta);
    if (joined) return joined;
  }

  // 兜底：找文本里第一个 { ... }
  const startIndex = text.indexOf("{");
  const endIndex = text.lastIndexOf("}");
  if (startIndex >= 0 && endIndex > startIndex) {
    const candidate = text.slice(startIndex, endIndex + 1);
    const extracted = tryParseObject(candidate);
    if (extracted) return extracted;
  }

  return null;
}

function tryParseObject(text: string): CherryParseResult | null {
  if (!text.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }

  return extractResult(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractResult(input: unknown): CherryParseResult | null {
  if (!isRecord(input)) return null;

  // 直接是 { matched, difference }
  if (typeof input.matched === "boolean") {
    const difference = toNumber(input.difference);
    if (difference === null) return null;
    const issuesValue = Array.isArray(input.issues)
      ? input.issues
      : Array.isArray(input.reviewItems)
        ? input.reviewItems
        : isRecord(input.data) && Array.isArray(input.data.issues)
          ? input.data.issues
          : undefined;
    return finalizeAgentResult(normalizeDifferenceDirection({
      matched: input.matched,
      difference,
      issues: extractIssues(issuesValue),
      period: extractPeriod(input),
      settlementAmount: extractOptionalAmount(input, ["settlementAmount", "settlementTotal"]),
      erpAmount: extractOptionalAmount(input, ["erpAmount", "erpTotal"]),
    }));
  }

  // 嵌套在 data / result / message.content / choices[0].message.content 里
  const candidates: unknown[] = [];
  if (isRecord(input.data)) candidates.push(input.data);
  if (isRecord(input.result)) candidates.push(input.result);
  if (isRecord(input.message)) candidates.push(input.message);

  for (const candidate of candidates) {
    const extracted = extractResult(candidate);
    if (extracted) return extracted;
  }

  // choices[0].message.content 是字符串，可能是 JSON
  if (Array.isArray(input.choices) && isRecord(input.choices[0]) && isRecord(input.choices[0].message)) {
    const content = input.choices[0].message.content;
    if (typeof content === "string") {
      const nested = tryParseObject(content);
      if (nested) return nested;
    }
  }

  return null;
}

function extractPeriod(input: Record<string, unknown>) {
  const values = [input.period, input.month, input.periodLabel, input.billDate, input.settlementDate, input.date];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const iso = value.match(/(\d{4})-(\d{1,2})/);
    const isoMonth = iso ? Number(iso[2]) : 0;
    if (isoMonth >= 1 && isoMonth <= 12) return `${iso![1]}-${String(isoMonth).padStart(2, "0")}`;
    const chinese = value.match(/(\d{4})年(\d{1,2})月/);
    const chineseMonth = chinese ? Number(chinese[2]) : 0;
    if (chineseMonth >= 1 && chineseMonth <= 12) {
      return `${chinese![1]}-${String(chineseMonth).padStart(2, "0")}`;
    }
  }
  return null;
}

function extractIssues(value: unknown): CherryIssue[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    ...item,
    id: typeof item.id === "string" ? item.id : undefined,
    rowId: typeof item.rowId === "string" ? item.rowId : undefined,
    rowLabel: typeof item.rowLabel === "string" ? item.rowLabel : undefined,
    orderNo: typeof item.orderNo === "string" ? item.orderNo : undefined,
    field: typeof item.field === "string" ? item.field : undefined,
    fieldName: typeof item.fieldName === "string" ? item.fieldName : undefined,
    fieldLabel: typeof item.fieldLabel === "string" ? item.fieldLabel : undefined,
    settlementValue: item.settlementValue as CherryIssue["settlementValue"],
    settlementAmount: item.settlementAmount as CherryIssue["settlementAmount"],
    erpValue: item.erpValue as CherryIssue["erpValue"],
    erpAmount: item.erpAmount as CherryIssue["erpAmount"],
    difference: item.difference as CherryIssue["difference"],
    differenceAmount: item.differenceAmount as CherryIssue["differenceAmount"],
    message: typeof item.message === "string" ? item.message : undefined,
    suggestion: typeof item.suggestion === "string" ? item.suggestion : undefined,
    status: item.status as CherryIssue["status"],
  }));
}

function extractOptionalAmount(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (input[key] === null) return null;
    const value = toNumber(input[key]);
    if (value !== null) return value;
  }
  return null;
}

/** Keep every monetary difference in the documented ERP minus settlement direction. */
export function normalizeDifferenceDirection(result: CherryParseResult): CherryParseResult {
  const issues = result.issues.map((issue) => {
    const settlement = toNumber(issue.settlementValue ?? issue.settlementAmount);
    const erp = toNumber(issue.erpValue ?? issue.erpAmount);
    const reported = toNumber(issue.differenceAmount ?? issue.difference);
    if (settlement === null || erp === null || reported === null) return issue;

    const expected = Number((erp - settlement).toFixed(2));
    if (Math.abs(Math.abs(expected) - Math.abs(reported)) > 0.01) return issue;
    return {
      ...issue,
      differenceAmount: expected,
      ...(issue.difference !== undefined ? { difference: expected } : {}),
    };
  });

  const directionEvidence = issues.find((issue) => {
    const issueDifference = toNumber(issue.differenceAmount ?? issue.difference);
    return issueDifference !== null
      && Math.abs(Math.abs(issueDifference) - Math.abs(result.difference)) <= 0.01;
  });
  const issueDifferences = issues
    .map((issue) => toNumber(issue.differenceAmount ?? issue.difference))
    .filter((difference): difference is number => difference !== null);
  const summedDifference = issueDifferences.length === issues.length
    ? Number(issueDifferences.reduce((sum, difference) => sum + difference, 0).toFixed(2))
    : null;
  const summedEvidence = summedDifference !== null
    && Math.abs(Math.abs(summedDifference) - Math.abs(result.difference)) <= 0.01
    ? summedDifference
    : null;
  const evidencedDifference = summedEvidence
    ?? (directionEvidence ? toNumber(directionEvidence.differenceAmount ?? directionEvidence.difference) : null);
  const difference = evidencedDifference === null
    ? result.difference
    : Math.sign(evidencedDifference) * Math.abs(result.difference);

  return { ...result, difference, issues };
}

function finalizeAgentResult(result: CherryParseResult): CherryParseResult | null {
  const hasDifference = Math.abs(result.difference) > 0.005;
  if (result.matched) {
    return !hasDifference && result.issues.length === 0 ? result : null;
  }
  if (!hasDifference && result.issues.length === 0) return null;
  if (result.issues.length > 0) return result;

  return {
    ...result,
    issues: [{
      rowLabel: "总差额",
      fieldName: "ERP - 结算",
      differenceAmount: result.difference,
      message: `Agent 返回总差额 ${result.difference.toFixed(2)} 元，请结合原始资料核对`,
      suggestion: "核对 ERP 与结算资料中的金额汇总及逐笔明细",
    }],
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
