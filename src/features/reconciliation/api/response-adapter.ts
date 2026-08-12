// 文件说明：把 CherryStudio agent 返回的 JSON 转成前端任务、统计和人工审核字段。
import { getReconciliationFileMetadata } from "../model/file-rules";
import type {
  CreateReconciliationTaskInput,
  Money,
  ReconciliationReviewItem,
  ReconciliationProcessLog,
  ReconciliationStatus,
  ReconciliationTaskDetail,
  ReconciliationTaskSummary,
} from "../model/types";

export type CherryStudioResponse = {
  requestId?: string;
  taskId?: string;
  id?: string;
  status?: ReconciliationStatus;
  message?: string;
  summary?: CherryStudioSummary;
  result?: CherryStudioSummary;
  issues?: CherryStudioIssue[];
  reviewItems?: CherryStudioIssue[];
  data?: {
    requestId?: string;
    taskId?: string;
    id?: string;
    status?: ReconciliationStatus;
    message?: string;
    summary?: CherryStudioSummary;
    result?: CherryStudioSummary;
    issues?: CherryStudioIssue[];
    reviewItems?: CherryStudioIssue[];
  };
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

type CherryStudioSummary = {
  settlementAmount?: string | number | null;
  erpAmount?: string | number | null;
  differenceAmount?: string | number | null;
  totalCount?: number | null;
  matchedCount?: number | null;
  differenceCount?: number | null;
};

type CherryStudioIssue = {
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

type ReconciliationAgentResult = {
  matched: boolean;
  difference: number;
};

const money = (value: string): Money => ({ currency: "CNY", value });

const emptyMetrics = () => ({
  settlementAmount: null,
  erpAmount: null,
  differenceAmount: null,
  totalCount: null,
  matchedCount: null,
  differenceCount: null,
});

function toMoney(value: string | number | null | undefined): Money | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return money(value.toFixed(2));

  const normalized = Number(value);
  return money(Number.isFinite(normalized) ? normalized.toFixed(2) : value);
}

export function cherryStudioResponseData(response: CherryStudioResponse | null) {
  return response?.data ?? response ?? null;
}

function statusFromResponse(response: CherryStudioResponse | null): ReconciliationStatus {
  const data = cherryStudioResponseData(response);
  const status = data?.status;
  if (status === "SUCCEEDED" || status === "NEEDS_REVIEW" || status === "FAILED" || status === "QUEUED" || status === "PROCESSING") {
    return status;
  }

  const issues = data?.issues ?? data?.reviewItems ?? [];
  return issues.length ? "NEEDS_REVIEW" : "PROCESSING";
}

function metricsFromResponse(response: CherryStudioResponse | null) {
  const data = cherryStudioResponseData(response);
  const summary = data?.summary ?? data?.result;

  if (!summary) return emptyMetrics();

  return {
    settlementAmount: toMoney(summary.settlementAmount),
    erpAmount: toMoney(summary.erpAmount),
    differenceAmount: toMoney(summary.differenceAmount),
    totalCount: summary.totalCount ?? null,
    matchedCount: summary.matchedCount ?? null,
    differenceCount: summary.differenceCount ?? null,
  };
}

function reviewItemsFromResponse(response: CherryStudioResponse | null): ReconciliationReviewItem[] {
  const data = cherryStudioResponseData(response);
  const issues = data?.issues ?? data?.reviewItems ?? [];

  return issues.map((issue, index) => ({
    id: issue.id ?? `review-${index + 1}`,
    rowLabel: issue.rowLabel ?? issue.orderNo ?? issue.rowId ?? `第 ${index + 1} 条`,
    fieldName: issue.fieldLabel ?? issue.fieldName ?? issue.field ?? "金额字段",
    settlementValue: toMoney(issue.settlementValue ?? issue.settlementAmount),
    erpValue: toMoney(issue.erpValue ?? issue.erpAmount),
    differenceAmount: toMoney(issue.differenceAmount ?? issue.difference),
    message: issue.message ?? "该字段存在差异，需要人工确认",
    suggestion: issue.suggestion ?? null,
    status: issue.status ?? "PENDING",
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;

  const parts = value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!isRecord(item)) return [];
    if (typeof item.text === "string") return [item.text];
    if (typeof item.content === "string") return [item.content];
    return [];
  });

  return parts.length ? parts.join("") : null;
}

function resultFromObject(value: Record<string, unknown>): ReconciliationAgentResult | null {
  if (typeof value.matched !== "boolean") return null;
  const difference = typeof value.difference === "number"
    ? value.difference
    : typeof value.difference === "string"
      ? Number(value.difference)
      : Number.NaN;

  if (!Number.isFinite(difference)) return null;
  const amountsMatch = Math.abs(difference) < 0.005;
  if (value.matched !== amountsMatch) return null;
  return { matched: value.matched, difference };
}

function resultFromContent(value: unknown): ReconciliationAgentResult | null {
  if (isRecord(value)) return resultFromObject(value);
  const text = contentText(value);
  if (!text) return null;

  // 优先尝试把整段文本当作 JSON 解析。
  try {
    const parsed: unknown = JSON.parse(text.trim());
    const direct = isRecord(parsed) ? resultFromObject(parsed) : null;
    if (direct) return direct;
  } catch {
    // 忽略整体解析失败，继续尝试从文本中提取 JSON。
  }

  // agent 可能在 JSON 前后夹带解释文字（例如"两方金额一致…\n\n{...}"）。
  // 提取第一个 { 到最后一个 } 之间的内容再解析。
  const startIndex = text.indexOf("{");
  const endIndex = text.lastIndexOf("}");
  if (startIndex >= 0 && endIndex > startIndex) {
    const candidate = text.slice(startIndex, endIndex + 1);
    try {
      const parsed: unknown = JSON.parse(candidate);
      const extracted = isRecord(parsed) ? resultFromObject(parsed) : null;
      if (extracted) return extracted;
    } catch {
      // 提取片段仍无法解析，返回 null。
    }
  }

  return null;
}

function agentResultFromPayload(payload: unknown): ReconciliationAgentResult | null {
  if (!isRecord(payload)) return null;

  const directResult = resultFromObject(payload);
  if (directResult) return directResult;

  const data = isRecord(payload.data) ? payload.data : null;
  const message = isRecord(payload.message) ? payload.message : null;
  const dataMessage = data && isRecord(data.message) ? data.message : null;
  const result = isRecord(payload.result) ? payload.result : null;
  const dataResult = data && isRecord(data.result) ? data.result : null;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : null;
  const choiceMessage = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null;
  const candidates = [
    payload.content,
    data?.content,
    message?.content,
    dataMessage?.content,
    result?.content,
    dataResult?.content,
    choiceMessage?.content,
    data,
    result,
    dataResult,
  ];

  for (const candidate of candidates) {
    const parsed = resultFromContent(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function responseIdentifier(payload: unknown, field: "requestId" | "taskId" | "id") {
  if (!isRecord(payload)) return undefined;
  if (typeof payload[field] === "string") return payload[field];
  const data = isRecord(payload.data) ? payload.data : null;
  return data && typeof data[field] === "string" ? data[field] : undefined;
}

function normalizeAgentResponse(payload: unknown): CherryStudioResponse | null {
  const result = agentResultFromPayload(payload);
  if (!result) return null;

  const differenceAmount = result.difference.toFixed(2);
  return {
    requestId: responseIdentifier(payload, "requestId"),
    taskId: responseIdentifier(payload, "taskId") ?? responseIdentifier(payload, "id"),
    status: result.matched ? "SUCCEEDED" : "NEEDS_REVIEW",
    message: result.matched ? "对账完成，金额一致" : "对账完成，存在金额差异",
    summary: {
      differenceAmount,
      differenceCount: result.matched ? 0 : 1,
    },
    issues: result.matched
      ? []
      : [{
          id: "amount-difference",
          rowLabel: "对账汇总",
          fieldName: "金额",
          differenceAmount,
          message: `ERP 金额与结算单金额相差 ${differenceAmount} 元`,
          suggestion: "请核对两份资料中的汇总金额与缺失单据",
          status: "PENDING",
        }],
  };
}

type CherryStudioSseEvent = {
  type?: string;
  text?: string;
  reasoning?: string;
  toolName?: string;
  toolCallId?: string;
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

export type ProgressEmitter = (
  level: "info" | "success" | "error",
  message: string,
  options?: Pick<ReconciliationProcessLog, "id" | "details" | "expanded">,
) => void;

function singleLine(value: string, maxLength: number) {
  const line = value.split(/\r?\n/).find((item) => item.trim());
  const trimmed = (line ?? value).trim().replace(/\s+/g, " ");
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

// 从工具调用的 input 里提取一句可读摘要（Bash 命令 / description / 其他字符串字段）。
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

function rawDetail(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  return JSON.stringify(value, null, 2);
}

// 同一段 reasoning 只更新一条日志；工具事件仍按时序追加。
function emitSseProcess(onProgress: ProgressEmitter) {
  let reasoning = "";
  let reasoningId: string | undefined;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;

  const emitReasoning = (expanded: boolean) => {
    if (!reasoning.trim() || !reasoningId) return;
    onProgress("info", expanded ? "正在思考…" : "思考过程", {
      id: reasoningId,
      details: reasoning,
      expanded,
    });
  };

  const scheduleReasoningUpdate = () => {
    if (updateTimer) return;
    updateTimer = setTimeout(() => {
      updateTimer = undefined;
      emitReasoning(true);
    }, 100);
  };

  const finishReasoning = () => {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = undefined;
    emitReasoning(false);
    reasoning = "";
    reasoningId = undefined;
  };

  return (event: CherryStudioSseEvent) => {
    switch (event.type) {
      case "start":
        onProgress("info", "Agent 开始处理…");
        break;
      case "start-step":
        finishReasoning();
        onProgress("info", "进入新的处理步骤…");
        break;
      case "reasoning-start":
        finishReasoning();
        reasoningId = crypto.randomUUID();
        break;
      case "reasoning-delta":
        if (typeof event.text === "string") {
          reasoningId ??= crypto.randomUUID();
          reasoning += event.text;
          scheduleReasoningUpdate();
        }
        break;
      case "reasoning-end":
      case "finish-step":
        finishReasoning();
        break;
      case "tool-call": {
        finishReasoning();
        const name = event.toolName ?? "工具";
        const detail = toolInputSummary(event.input);
        onProgress("info", `调用工具 ${name}${detail ? `：${detail}` : ""}`, {
          details: rawDetail(event.input),
        });
        break;
      }
      case "tool-result": {
        finishReasoning();
        const name = event.toolName ?? "工具";
        const detail = typeof event.output === "string" ? singleLine(event.output, 60) : "";
        onProgress("success", `${name} 执行完成${detail ? `：${detail}` : ""}`, {
          details: rawDetail(event.output),
        });
        break;
      }
      case "tool-error": {
        finishReasoning();
        const name = event.toolName ?? "工具";
        const detail = typeof event.error === "string" ? singleLine(event.error, 60) : "";
        onProgress("error", `${name} 执行出错${detail ? `：${detail}` : ""}`, {
          details: rawDetail(event.error),
        });
        break;
      }
      case "finish":
        finishReasoning();
        onProgress("success", "Agent 处理完成，正在整理最终结果…");
        break;
    }
  };
}

// 从 CherryStudio 的 SSE 流中提取 agent 最终输出的纯文本。
// 事件结构（data: 行，空行分隔）：
//   {"type":"start"}
//   {"type":"raw","rawValue":{...init...}}
//   {"type":"start-step"}
//   {"type":"reasoning-start"|"reasoning-delta"|"reasoning-end"}
//   {"type":"text-start"}
//   {"type":"text-delta","text":"..."}         // 增量文本
//   {"type":"text-end","providerMetadata":{"raw":{"message":{...}}}}  // 完整 assistant 消息
//   {"type":"finish-step"} {"type":"finish"}
//   data: [DONE]
async function readSseFinalText(
  response: Response,
  onEvent?: (event: CherryStudioSseEvent) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let chunkBuffer = "";
  let deltaText = "";
  let finalText = "";

  const handleEventData = (data: string) => {
    const trimmed = data.trim();
    if (!trimmed || trimmed === "[DONE]") return;

    let event: CherryStudioSseEvent;
    try {
      event = JSON.parse(trimmed) as CherryStudioSseEvent;
    } catch {
      return;
    }

    onEvent?.(event);

    if (event.type === "text-delta" && typeof event.text === "string") {
      deltaText += event.text;
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

  return finalText || deltaText;
}

export async function readCherryStudioJson(
  response: Response,
  onProgress?: ProgressEmitter,
): Promise<CherryStudioResponse | null> {
  const contentType = response.headers.get("content-type") ?? "";

  // CherryStudio messages 接口采用 SSE 流式响应，最终结果在 text-delta/text-end 事件里。
  if (contentType.includes("text/event-stream")) {
    const text = (await readSseFinalText(response, onProgress ? emitSseProcess(onProgress) : undefined)).trim();
    if (!text) return null;

    const result = resultFromContent(text);
    if (!result) return null;
    return normalizeAgentResponse({ content: text });
  }

  const text = await response.text();
  if (!text.trim()) return null;

  try {
    const payload: unknown = JSON.parse(text);
    if (!response.ok) return isRecord(payload) ? payload as CherryStudioResponse : null;
    return normalizeAgentResponse(payload);
  } catch {
    return null;
  }
}

export function buildTaskFacets(tasks: ReconciliationTaskSummary[]) {
  const byStatus = tasks.reduce<Record<ReconciliationStatus, number>>(
    (counts, task) => ({ ...counts, [task.status]: counts[task.status] + 1 }),
    { QUEUED: 0, PROCESSING: 0, SUCCEEDED: 0, NEEDS_REVIEW: 0, FAILED: 0 },
  );

  return { total: tasks.length, byStatus };
}

export function createTaskFromCherryStudioResponse(
  input: CreateReconciliationTaskInput,
  response: CherryStudioResponse | null,
  idempotencyKey: string,
  submittedAt: string,
): ReconciliationTaskDetail {
  const data = cherryStudioResponseData(response);
  const status = statusFromResponse(response);
  const settlementFileMetadata = getReconciliationFileMetadata(input.settlementFile);
  const erpFileMetadata = getReconciliationFileMetadata(input.erpFile);
  const responseTaskId = data?.taskId ?? data?.id;

  return {
    id: responseTaskId ?? `cherrystudio-${idempotencyKey.slice(0, 8)}`,
    status,
    periodLabel: null,
    settlementFile: {
      id: `${idempotencyKey}-settlement`,
      name: input.settlementFile.name,
      size: input.settlementFile.size,
      type: input.settlementFile.type,
      extension: settlementFileMetadata.extension,
      uploadedAt: submittedAt,
    },
    erpFile: {
      id: `${idempotencyKey}-erp`,
      name: input.erpFile.name,
      size: input.erpFile.size,
      type: input.erpFile.type,
      extension: erpFileMetadata.extension,
      uploadedAt: submittedAt,
    },
    metrics: metricsFromResponse(response),
    createdAt: submittedAt,
    completedAt: status === "PROCESSING" || status === "QUEUED" ? null : submittedAt,
    createdBy: {
      id: "cherrystudio-agent",
      name: "CherryStudio Agent",
    },
    reviewItems: reviewItemsFromResponse(response),
    failure: status === "FAILED"
      ? {
          code: response?.error?.code ?? "AGENT_SKILL_FAILED",
          message: response?.error?.message ?? data?.message ?? "Agent skill 处理失败",
        }
      : null,
  };
}
