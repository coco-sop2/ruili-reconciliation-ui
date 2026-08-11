// 文件说明：负责向 CherryStudio agent 发起开始对账请求，并维护当前页面会话里的任务缓存。
import { createReconciliationFormData } from "./form-data";
import { ReconciliationApiError } from "./error";
import {
  buildTaskFacets,
  cherryStudioResponseData,
  createTaskFromCherryStudioResponse,
  readCherryStudioJson,
} from "./response-adapter";
import type { ReconciliationApi } from "./types";
import type {
  CreateReconciliationTaskInput,
  ListReconciliationTasksParams,
  Money,
  PaginatedTasks,
  ReconciliationStatistics,
  ReconciliationTaskDetail,
  ReconciliationTaskSummary,
} from "../model/types";

type CherryStudioConfig = {
  endpointUrl: string;
  skillName: string;
};

const money = (value: string): Money => ({ currency: "CNY", value });

export class CherryStudioReconciliationApi implements ReconciliationApi {
  private readonly tasks: ReconciliationTaskSummary[] = [];
  private readonly details = new Map<string, ReconciliationTaskDetail>();
  private readonly idempotencyKeys = new WeakMap<File, WeakMap<File, string>>();

  constructor(private readonly config: CherryStudioConfig) {}

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
    const idempotencyKey = this.idempotencyKeyFor(input);
    const submittedAt = new Date().toISOString();
    const formData = createReconciliationFormData(input, {
      skillName: this.config.skillName,
      submittedAt,
    });

    const response = await fetch(this.config.endpointUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-Agent-Skill": this.config.skillName,
      },
      credentials: "include",
      body: formData,
    });
    const payload = await readCherryStudioJson(response);
    const data = cherryStudioResponseData(payload);

    if (!response.ok) {
      throw new ReconciliationApiError(
        payload?.error?.message ?? `CherryStudio 请求失败（HTTP ${response.status}）`,
        payload?.error?.code ?? "CHERRYSTUDIO_AGENT_REQUEST_FAILED",
        payload?.error?.requestId ?? payload?.requestId ?? data?.requestId,
        response.status,
      );
    }

    const task = createTaskFromCherryStudioResponse(input, payload, idempotencyKey, submittedAt);
    this.tasks.unshift(task);
    this.details.set(task.id, task);
    return task;
  }

  async listTasks(params: ListReconciliationTasksParams = {}): Promise<PaginatedTasks> {
    const keyword = params.keyword?.trim().toLowerCase();
    const keywordMatches = this.tasks.filter((task) => {
      return !keyword || [task.id, task.periodLabel ?? "", task.settlementFile.name, task.erpFile.name, task.createdBy.name]
        .some((value) => value.toLowerCase().includes(keyword));
    });
    const filtered = keywordMatches.filter((task) => !params.status?.length || params.status.includes(task.status));
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const start = (page - 1) * pageSize;

    return {
      items: filtered.slice(start, start + pageSize),
      page,
      pageSize,
      total: filtered.length,
      facets: buildTaskFacets(keywordMatches),
    };
  }

  async getTask(taskId: string): Promise<ReconciliationTaskDetail> {
    const task = this.details.get(taskId);
    if (!task) {
      throw new ReconciliationApiError("未找到对账任务", "TASK_NOT_FOUND", "cherrystudio-local-state", 404);
    }

    return { ...task, failure: null };
  }

  async getStatistics(month = new Date().toISOString().slice(0, 7)): Promise<ReconciliationStatistics> {
    const succeededTasks = this.tasks.filter((task) => task.status === "SUCCEEDED").length;
    const needsReviewTasks = this.tasks.filter((task) => task.status === "NEEDS_REVIEW").length;
    const failedTasks = this.tasks.filter((task) => task.status === "FAILED").length;
    const processingTasks = this.tasks.filter((task) => task.status === "QUEUED" || task.status === "PROCESSING").length;

    return {
      month,
      totalTasks: this.tasks.length,
      succeededTasks,
      needsReviewTasks,
      failedTasks,
      processingTasks,
      autoMatchRate: this.tasks.length ? succeededTasks / this.tasks.length : 0,
      monthOverMonthRate: 0,
      totalDifferenceAmount: money("0.00"),
      trend: [],
      updatedAt: new Date().toISOString(),
    };
  }
}
