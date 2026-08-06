import type {
  ApiEnvelope,
  ApiErrorPayload,
  CreateReconciliationTaskInput,
  ListReconciliationTasksParams,
  Money,
  PaginatedTasks,
  ReconciliationStatistics,
  ReconciliationStatus,
  ReconciliationTaskDetail,
  ReconciliationTaskSummary,
} from "./reconciliation-types";

export interface ReconciliationApi {
  createTask(input: CreateReconciliationTaskInput): Promise<ReconciliationTaskSummary>;
  listTasks(params?: ListReconciliationTasksParams): Promise<PaginatedTasks>;
  getTask(taskId: string): Promise<ReconciliationTaskDetail>;
  getStatistics(month?: string): Promise<ReconciliationStatistics>;
}

export class ReconciliationApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ReconciliationApiError";
  }
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
export const usingMockApi = !apiBaseUrl;

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallback = `请求失败（HTTP ${response.status}）`;
    const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
    throw new ReconciliationApiError(
      payload?.error.message ?? fallback,
      payload?.error.code ?? "HTTP_ERROR",
      payload?.error.requestId,
      response.status,
    );
  }

  const payload = await response.json() as ApiEnvelope<T>;
  return payload.data;
}

class HttpReconciliationApi implements ReconciliationApi {
  private idempotencyKeys = new WeakMap<File, WeakMap<File, string>>();

  private idempotencyKeyFor(input: CreateReconciliationTaskInput) {
    let erpKeys = this.idempotencyKeys.get(input.settlementFile);
    if (!erpKeys) {
      erpKeys = new WeakMap<File, string>();
      this.idempotencyKeys.set(input.settlementFile, erpKeys);
    }
    const existingKey = erpKeys.get(input.erpFile);
    if (existingKey) return existingKey;
    const newKey = crypto.randomUUID();
    erpKeys.set(input.erpFile, newKey);
    return newKey;
  }

  async createTask(input: CreateReconciliationTaskInput) {
    const formData = new FormData();
    formData.append("settlementFile", input.settlementFile);
    formData.append("erpFile", input.erpFile);

    return unwrap<ReconciliationTaskSummary>(await fetch(`${apiBaseUrl}/api/v1/reconciliation-tasks`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": this.idempotencyKeyFor(input),
      },
      credentials: "include",
      body: formData,
    }));
  }

  async listTasks(params: ListReconciliationTasksParams = {}) {
    const query = new URLSearchParams();
    if (params.status?.length) query.set("status", params.status.join(","));
    if (params.keyword) query.set("keyword", params.keyword);
    query.set("page", String(params.page ?? 1));
    query.set("pageSize", String(params.pageSize ?? 20));

    return unwrap<PaginatedTasks>(await fetch(`${apiBaseUrl}/api/v1/reconciliation-tasks?${query}`, {
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    }));
  }

  async getTask(taskId: string) {
    return unwrap<ReconciliationTaskDetail>(await fetch(
      `${apiBaseUrl}/api/v1/reconciliation-tasks/${encodeURIComponent(taskId)}`,
      { headers: { Accept: "application/json" }, credentials: "include", cache: "no-store" },
    ));
  }

  async getStatistics(month?: string) {
    const query = month ? `?month=${encodeURIComponent(month)}` : "";
    return unwrap<ReconciliationStatistics>(await fetch(
      `${apiBaseUrl}/api/v1/reconciliation-statistics${query}`,
      { headers: { Accept: "application/json" }, credentials: "include", cache: "no-store" },
    ));
  }
}

const money = (value: string): Money => ({ currency: "CNY", value });
const iso = (day: string, time: string) => `2026-${day}T${time}:00+08:00`;

let mockTasks: ReconciliationTaskSummary[] = [
  ["REC-260805-018", "SUCCEEDED", "2026年7月", "华东渠道结算单_07月.xlsx", "ERP销售明细_202607.xlsx", "4286920.40", "0.00", 1842, 1842, "08-05", "16:42", "陈嘉宁"],
  ["REC-260804-017", "NEEDS_REVIEW", "2026年7月", "线上渠道结算单_07月.xlsx", "ERP销售明细_202607.xlsx", "2795480.00", "12680.00", 972, 966, "08-04", "11:08", "王舟"],
  ["REC-260731-016", "SUCCEEDED", "2026年6月", "直营门店结算单_06月.xlsx", "ERP销售明细_202606.xlsx", "6150320.80", "0.00", 2410, 2410, "07-31", "18:26", "刘乐"],
  ["REC-260729-015", "FAILED", "2026年6月", "经销商结算汇总_06月.xlsx", "ERP销售明细_202606.xlsx", "1084760.00", null, null, null, "07-29", "09:14", "周岚"],
  ["REC-260728-014", "NEEDS_REVIEW", "2026年6月", "华南渠道结算单_06月.xlsx", "ERP销售明细_202606.xlsx", "3527190.50", "8240.50", 1241, 1238, "07-28", "15:32", "陈嘉宁"],
  ["REC-260725-013", "SUCCEEDED", "2026年6月", "电商平台结算单_06月.xlsx", "ERP销售明细_202606.xlsx", "945880.00", "0.00", 522, 522, "07-25", "10:17", "王舟"],
].map((row, index) => {
  const [id, status, periodLabel, settlementName, erpName, amount, difference, total, matched, day, time, owner] = row as [string, ReconciliationStatus, string, string, string, string, string | null, number | null, number | null, string, string, string];
  const createdAt = iso(day, time);
  return {
    id,
    status,
    periodLabel,
    settlementFile: { id: `file-settlement-${index}`, name: settlementName, size: 780000, uploadedAt: createdAt },
    erpFile: { id: `file-erp-${index}`, name: erpName, size: 1210000, uploadedAt: createdAt },
    metrics: {
      settlementAmount: money(amount),
      differenceAmount: difference === null ? null : money(difference),
      totalCount: total,
      matchedCount: matched,
      differenceCount: total !== null && matched !== null ? total - matched : null,
    },
    createdAt,
    completedAt: status === "FAILED" ? createdAt : createdAt,
    createdBy: { id: `user-${index}`, name: owner },
  };
});

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

class MockReconciliationApi implements ReconciliationApi {
  async createTask(input: CreateReconciliationTaskInput) {
    await wait(900);
    const createdAt = new Date().toISOString();
    const task: ReconciliationTaskSummary = {
      id: `REC-260806-${String(mockTasks.length + 13).padStart(3, "0")}`,
      status: "QUEUED",
      periodLabel: null,
      settlementFile: { id: crypto.randomUUID(), name: input.settlementFile.name, size: input.settlementFile.size, uploadedAt: createdAt },
      erpFile: { id: crypto.randomUUID(), name: input.erpFile.name, size: input.erpFile.size, uploadedAt: createdAt },
      metrics: { settlementAmount: null, differenceAmount: null, totalCount: null, matchedCount: null, differenceCount: null },
      createdAt,
      completedAt: null,
      createdBy: { id: "current-user", name: "当前用户" },
    };
    mockTasks = [task, ...mockTasks];
    return task;
  }

  async listTasks(params: ListReconciliationTasksParams = {}) {
    await wait(180);
    const keyword = params.keyword?.trim().toLowerCase();
    const filtered = mockTasks.filter((task) => {
      const statusMatch = !params.status?.length || params.status.includes(task.status);
      const keywordMatch = !keyword || [task.id, task.periodLabel ?? "", task.settlementFile.name, task.erpFile.name, task.createdBy.name]
        .some((value) => value.toLowerCase().includes(keyword));
      return statusMatch && keywordMatch;
    });
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize), page, pageSize, total: filtered.length };
  }

  async getTask(taskId: string) {
    await wait(120);
    let task = mockTasks.find((item) => item.id === taskId);
    if (!task) throw new ReconciliationApiError("未找到对账任务", "TASK_NOT_FOUND", "mock-request", 404);
    const taskAge = Date.now() - new Date(task.createdAt).getTime();
    if ((task.status === "QUEUED" || task.status === "PROCESSING") && taskAge > 2_500) {
      task = taskAge > 6_000
        ? {
            ...task,
            status: "NEEDS_REVIEW",
            periodLabel: "2026年7月",
            completedAt: new Date().toISOString(),
            metrics: {
              settlementAmount: money("3286400.00"),
              differenceAmount: money("1260.00"),
              totalCount: 1682,
              matchedCount: 1679,
              differenceCount: 3,
            },
          }
        : { ...task, status: "PROCESSING" };
      mockTasks = mockTasks.map((item) => item.id === taskId ? task : item);
    }
    return {
      ...task,
      failure: task.status === "FAILED" ? { code: "INVALID_FILE_STRUCTURE", message: "ERP 表单缺少必需的订单编号列" } : null,
    };
  }

  async getStatistics(month = "2026-08") {
    await wait(120);
    return {
      month,
      totalTasks: 24,
      succeededTasks: 18,
      needsReviewTasks: 4,
      failedTasks: 2,
      processingTasks: mockTasks.filter((task) => task.status === "QUEUED" || task.status === "PROCESSING").length,
      autoMatchRate: 0.75,
      monthOverMonthRate: 0.125,
      totalDifferenceAmount: money("20920.50"),
      trend: [
        { label: "第1周", taskCount: 4 }, { label: "第2周", taskCount: 7 }, { label: "第3周", taskCount: 5 },
        { label: "第4周", taskCount: 9 }, { label: "第5周", taskCount: 7 }, { label: "第6周", taskCount: 11 },
        { label: "本周", taskCount: 9 },
      ],
      updatedAt: new Date().toISOString(),
    };
  }
}

export const reconciliationApi: ReconciliationApi = apiBaseUrl
  ? new HttpReconciliationApi()
  : new MockReconciliationApi();
