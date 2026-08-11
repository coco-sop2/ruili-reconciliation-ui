// 文件说明：负责向 CherryStudio agent 发起开始对账请求，并维护当前页面会话里的任务缓存。
import { ReconciliationFileUploader } from "./file-uploader";
import { ReconciliationApiError } from "./error";
import { buildReconciliationPrompt, createReconciliationPromptPayload } from "./prompt";
import { findCherryAgentSession } from "./agent-resolver";
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
  ReconciliationProcessLogLevel,
  ReconciliationStatistics,
  ReconciliationTaskDetail,
  ReconciliationTaskSummary,
} from "../model/types";

type CherryStudioConfig = {
  baseUrl: string;
  uploadUrl: string;
  apiKey: string;
};

const money = (value: string): Money => ({ currency: "CNY", value });

export class CherryStudioReconciliationApi implements ReconciliationApi {
  private readonly tasks: ReconciliationTaskSummary[] = [];
  private readonly details = new Map<string, ReconciliationTaskDetail>();
  private readonly idempotencyKeys = new WeakMap<File, WeakMap<File, string>>();
  private readonly fileUploader: ReconciliationFileUploader;

  constructor(private readonly config: CherryStudioConfig) {
    this.fileUploader = new ReconciliationFileUploader({ endpointUrl: config.uploadUrl });
  }

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
    const emitLog = (level: ReconciliationProcessLogLevel, message: string) => {
      input.onProgress?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, message });
    };

    emitLog("info", "开始创建对账任务…");
    const target = await findCherryAgentSession(
      { baseUrl: this.config.baseUrl, apiKey: this.config.apiKey },
      input.agentSelector,
      emitLog,
    );
    const fileUrls = await this.fileUploader.uploadBoth(input, idempotencyKey, emitLog);
    const promptPayload = createReconciliationPromptPayload(input, fileUrls, submittedAt);
    const prompt = buildReconciliationPrompt(promptPayload);
    emitLog("info", "对账提示词已生成，正在提交至 Agent…");

    const messageUrl = `${this.config.baseUrl}/v1/agents/${encodeURIComponent(target.agent.id)}/sessions/${encodeURIComponent(target.session.id)}/messages`;
    emitLog("info", "已提交请求，Agent 处理中（文件识别与金额比对中，处理过程将实时显示）…");
    const response = await fetch(messageUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: prompt }),
    });
    const payload = await readCherryStudioJson(response, emitLog);
    const data = cherryStudioResponseData(payload);

    if (!response.ok) {
      emitLog("error", `CherryStudio 请求失败（HTTP ${response.status}）`);
      throw new ReconciliationApiError(
        payload?.error?.message ?? `CherryStudio 请求失败（HTTP ${response.status}）`,
        payload?.error?.code ?? "CHERRYSTUDIO_AGENT_REQUEST_FAILED",
        payload?.error?.requestId ?? payload?.requestId ?? data?.requestId,
        response.status,
      );
    }

    if (!payload) {
      emitLog("error", "Agent 没有返回合法的对账 JSON");
      throw new ReconciliationApiError(
        "CherryStudio agent 没有返回合法的 { matched, difference } JSON",
        "CHERRYSTUDIO_AGENT_INVALID_RESPONSE",
      );
    }

    const task = createTaskFromCherryStudioResponse(input, payload, idempotencyKey, submittedAt);
    emitLog("success", `对账完成：${task.metrics.differenceAmount?.value ?? "—"} 元${task.status === "SUCCEEDED" ? "（金额一致）" : "（存在差异）"}`);
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
    const totalDifference = this.tasks.reduce(
      (total, task) => total + Number(task.metrics.differenceAmount?.value ?? 0),
      0,
    );

    return {
      month,
      totalTasks: this.tasks.length,
      succeededTasks,
      needsReviewTasks,
      failedTasks,
      processingTasks,
      autoMatchRate: this.tasks.length ? succeededTasks / this.tasks.length : 0,
      monthOverMonthRate: 0,
      totalDifferenceAmount: money(totalDifference.toFixed(2)),
      trend: [],
      updatedAt: new Date().toISOString(),
    };
  }
}
