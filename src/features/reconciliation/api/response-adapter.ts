// 文件说明：把 CherryStudio agent 返回的 JSON 转成前端任务、统计和人工审核字段。
import { getReconciliationFileMetadata } from "../model/file-rules";
import type {
  CreateReconciliationTaskInput,
  Money,
  ReconciliationReviewItem,
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

export async function readCherryStudioJson(response: Response): Promise<CherryStudioResponse | null> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as CherryStudioResponse;
  } catch {
    return { data: { requestId: text.slice(0, 120) } };
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
