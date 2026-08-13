import { ReconciliationApiError } from "./error";
import type { ReconciliationApi } from "./types";
import type {
  CreateReconciliationTaskInput,
  ListReconciliationTasksParams,
  Money,
  PaginatedTasks,
  ReconciliationProcessLog,
  ReconciliationReviewItem,
  ReconciliationStatistics,
  ReconciliationTaskDetail,
  ReconciliationTaskSummary,
  ReconciliationStatus,
  ReviewItemStatus,
} from "../model/types";

type HttpConfig = {
  baseUrl: string;
};

const startupRetryDelaysMs = [250, 500, 1_000, 1_500, 2_000];

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const money = (value: string | number | null | undefined): Money | null => {
  if (value === null || value === undefined || value === "") return null;
  return { currency: "CNY", value: String(value) };
};

const payloadMoney = (value: unknown): Money | null => (
  typeof value === "string" || typeof value === "number" ? money(value) : null
);

function statusFromString(status: string): ReconciliationStatus {
  if (
    status === "QUEUED" ||
    status === "PROCESSING" ||
    status === "SUCCEEDED" ||
    status === "NEEDS_REVIEW" ||
    status === "REVIEWED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "OBSOLETE"
  ) {
    return status;
  }
  return "FAILED";
}

type RawSummary = {
  id: string;
  name: string | null;
  status: string;
  periodLabel: string | null;
  version: number;
  settlementFile: { id: string; name: string; size: number };
  erpFile: { id: string; name: string; size: number };
  metrics: {
    settlementAmount: string | null;
    erpAmount: string | null;
    differenceAmount: string | null;
  };
  createdAt: string;
  completedAt: string | null;
  createdBy: { id: string; name: string };
};

type RawDetail = RawSummary & {
  resolvedAt: string | null;
  failure: { code: string; message: string } | null;
  reviewItems: Array<{
    id: string;
    rowLabel: string;
    fieldName: string;
    differenceAmount: string | null;
    status: string;
    message: string;
    suggestion: string | null;
    payload: Record<string, unknown>;
  }>;
  progressLogs?: ReconciliationProcessLog[];
};

type RawListResponse = {
  items: RawSummary[];
  page: number;
  pageSize: number;
  total: number;
  facets: {
    total: number;
    byStatus: Record<string, number>;
  };
};

function toSummary(raw: RawSummary): ReconciliationTaskSummary {
  return {
    id: raw.id,
    name: raw.name,
    status: statusFromString(raw.status),
    periodLabel: raw.periodLabel,
    settlementFile: {
      id: raw.settlementFile.id,
      name: raw.settlementFile.name,
      size: raw.settlementFile.size,
      type: "",
      extension: null,
      uploadedAt: raw.createdAt,
    },
    erpFile: {
      id: raw.erpFile.id,
      name: raw.erpFile.name,
      size: raw.erpFile.size,
      type: "",
      extension: null,
      uploadedAt: raw.createdAt,
    },
    metrics: {
      settlementAmount: money(raw.metrics.settlementAmount),
      erpAmount: money(raw.metrics.erpAmount),
      differenceAmount: money(raw.metrics.differenceAmount),
      totalCount: null,
      matchedCount: null,
      differenceCount: null,
    },
    createdAt: raw.createdAt,
    completedAt: raw.completedAt,
    createdBy: raw.createdBy,
  };
}

function toDetail(raw: RawDetail): ReconciliationTaskDetail {
  const summary = toSummary(raw as unknown as RawSummary);
  return {
    ...summary,
    failure: raw.failure,
    progressLogs: raw.progressLogs ?? [],
    reviewItems: raw.reviewItems.map((item) => {
      const settlementValue = payloadMoney(item.payload?.settlementValue)
        ?? payloadMoney(item.payload?.settlementAmount);
      const erpValue = payloadMoney(item.payload?.erpValue)
        ?? payloadMoney(item.payload?.erpAmount);
      return {
        id: item.id,
        rowLabel: item.rowLabel,
        fieldName: item.fieldName,
        settlementValue,
        erpValue,
        differenceAmount: money(item.differenceAmount),
        message: item.message || (typeof item.payload?.message === "string" ? item.payload.message : ""),
        suggestion: item.suggestion ?? null,
        status: item.status as ReconciliationReviewItem["status"],
      };
    }),
  };
}

export class HttpReconciliationApi implements ReconciliationApi {
  private readonly baseUrl: string;

  constructor(config: HttpConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();
    const retryDelays = method === "GET" ? startupRetryDelaysMs : [];
    let response: Response | undefined;

    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            Accept: "application/json",
            ...(init?.body ? { "Content-Type": "application/json" } : {}),
            ...(init?.headers ?? {}),
          },
        });
        break;
      } catch {
        if (attempt >= retryDelays.length) {
          throw new ReconciliationApiError("暂时无法连接对账后端", "NETWORK_ERROR");
        }
        await wait(retryDelays[attempt]);
      }
    }

    if (!response) throw new ReconciliationApiError("暂时无法连接对账后端", "NETWORK_ERROR");
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // 非 JSON 响应
    }

    if (!response.ok) {
      const errorPayload = payload as { error?: { code?: string; message?: string; requestId?: string } } | null;
      throw new ReconciliationApiError(
        errorPayload?.error?.message ?? `请求失败（HTTP ${response.status}）`,
        errorPayload?.error?.code ?? "HTTP_REQUEST_FAILED",
        errorPayload?.error?.requestId,
        response.status,
      );
    }

    const envelope = payload as { data: T } | null;
    return envelope?.data as T;
  }

  async createTask(input: CreateReconciliationTaskInput): Promise<ReconciliationTaskSummary> {
    const agentName = input.agentSelector.name.trim();
    if (!agentName) {
      throw new ReconciliationApiError("请填写 Agent 名称", "AGENT_NAME_REQUIRED", undefined, 400);
    }

    const formData = new FormData();
    formData.append("settlementFile", input.settlementFile);
    formData.append("erpFile", input.erpFile);
    formData.append("agentName", agentName);
    if (input.agentSelector.workspace) formData.append("agentWorkspace", input.agentSelector.workspace);

    input.onProgress?.({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: "info",
      message: "正在上传文件并创建对账任务…",
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/tasks`, {
        method: "POST",
        body: formData,
      });
    } catch {
      throw new ReconciliationApiError("暂时无法连接对账后端", "NETWORK_ERROR");
    }

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (!response.ok) {
      const errorPayload = payload as { error?: { code?: string; message?: string; requestId?: string } } | null;
      input.onProgress?.({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level: "error",
        message: errorPayload?.error?.message ?? `创建任务失败（HTTP ${response.status}）`,
      });
      throw new ReconciliationApiError(
        errorPayload?.error?.message ?? `创建任务失败（HTTP ${response.status}）`,
        errorPayload?.error?.code ?? "CREATE_TASK_FAILED",
        errorPayload?.error?.requestId,
        response.status,
      );
    }

    // 返回 202 + taskId + 日志
    const envelope = payload as {
      data?: {
        taskId?: string;
        status?: string;
        logs?: ReconciliationProcessLog[];
      };
    } | null;

    const logs = envelope?.data?.logs ?? [];
    for (const log of logs) {
      input.onProgress?.({
        id: log.id ?? crypto.randomUUID(),
        timestamp: log.timestamp ?? new Date().toISOString(),
        level: log.level,
        message: log.message,
      });
    }

    const taskId = envelope?.data?.taskId;
    if (!taskId) {
      throw new ReconciliationApiError(
        "后端已响应，但没有返回任务 ID",
        "INVALID_CREATE_TASK_RESPONSE",
        undefined,
        response.status,
      );
    }

    // 需要返回 ReconciliationTaskSummary，但异步对账还没完成。
    // 这里返回一个 PROCESSING 的占位摘要，后续靠轮询 getTask 获取真实状态。
    const placeholder: ReconciliationTaskSummary = {
      id: taskId,
      name: null,
      status: "PROCESSING",
      periodLabel: null,
      settlementFile: {
        id: "pending",
        name: input.settlementFile.name,
        size: input.settlementFile.size,
        type: input.settlementFile.type,
        extension: null,
        uploadedAt: new Date().toISOString(),
      },
      erpFile: {
        id: "pending",
        name: input.erpFile.name,
        size: input.erpFile.size,
        type: input.erpFile.type,
        extension: null,
        uploadedAt: new Date().toISOString(),
      },
      metrics: {
        settlementAmount: null,
        erpAmount: null,
        differenceAmount: null,
        totalCount: null,
        matchedCount: null,
        differenceCount: null,
      },
      createdAt: new Date().toISOString(),
      completedAt: null,
      createdBy: { id: "system", name: "CherryStudio Agent" },
    };

    return placeholder;
  }

  async listTasks(params: ListReconciliationTasksParams = {}): Promise<PaginatedTasks> {
    const query = new URLSearchParams();
    if (params.status?.length) query.set("status", params.status.join(","));
    if (params.keyword) query.set("keyword", params.keyword);
    if (params.page) query.set("page", String(params.page));
    if (params.pageSize) query.set("pageSize", String(params.pageSize));

    const raw = await this.request<RawListResponse>(`/api/tasks?${query.toString()}`);

    const byStatus = {} as Record<ReconciliationStatus, number>;
    const statuses: ReconciliationStatus[] = ["QUEUED", "PROCESSING", "SUCCEEDED", "NEEDS_REVIEW", "REVIEWED", "FAILED", "CANCELLED", "OBSOLETE"];
    for (const s of statuses) byStatus[s] = raw.facets.byStatus[s] ?? 0;

    return {
      items: raw.items.map(toSummary),
      page: raw.page,
      pageSize: raw.pageSize,
      total: raw.total,
      facets: { total: raw.facets.total, byStatus },
    };
  }

  async getTask(taskId: string): Promise<ReconciliationTaskDetail> {
    const raw = await this.request<RawDetail>(`/api/tasks/${encodeURIComponent(taskId)}`);
    return toDetail(raw);
  }

  async stopTask(taskId: string): Promise<void> {
    await this.request<{ stopped: boolean; sessionStopped: boolean }>(
      `/api/tasks/${encodeURIComponent(taskId)}/stop`,
      { method: "POST" },
    );
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request<{ deleted: boolean; fileCleanupWarnings?: string[] }>(
      `/api/tasks/${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
    );
  }

  async updateReviewItem(taskId: string, itemId: string, status: ReviewItemStatus) {
    await this.request<unknown>(
      `/api/tasks/${encodeURIComponent(taskId)}/review-items/${encodeURIComponent(itemId)}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    return this.getTask(taskId);
  }

  async getStatistics(month?: string): Promise<ReconciliationStatistics> {
    const query = month ? `?month=${month}` : "";
    const raw = await this.request<ReconciliationStatistics>(`/api/statistics${query}`);
    return {
      ...raw,
      totalDifferenceAmount: money(raw.totalDifferenceAmount as unknown as string) ?? { currency: "CNY", value: "0" },
    };
  }
}
