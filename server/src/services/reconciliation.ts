import { Prisma, TaskStatus, ReviewItemStatus, FileKind } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { deleteStoredFilePath, saveUploadedFile, normalizeFileName } from "../lib/file-storage.js";
import { appendTaskProgress, initializeTaskProgress } from "../lib/task-progress.js";
import {
  resolveAgentSession,
  sendReconciliationPrompt,
  deleteAgentSession,
  CherryStudioError,
  type AgentSelector,
  type CherryAgentSession,
  type CherryParseResult,
} from "../lib/cherrystudio.js";
import { config } from "../lib/config.js";
import { cleanupTaskWorkDir, prepareTaskWorkDir } from "../lib/runtime-storage.js";

export type ProgressLog = {
  id: string;
  timestamp: string;
  level: "info" | "success" | "error";
  message: string;
  details?: string;
  expanded?: boolean;
};

export type CreateReconciliationInput = {
  settlementFile: {
    buffer: Buffer;
    originalName: string;
    contentType: string;
  };
  erpFile: {
    buffer: Buffer;
    originalName: string;
    contentType: string;
  };
  agentSelector: AgentSelector & { name: string };
  onProgress?: (log: ProgressLog) => void;
};

type ActiveReconciliation = {
  controller: AbortController;
  target?: CherryAgentSession;
};

const activeReconciliations = new Map<string, ActiveReconciliation>();

function emit(
  onProgress: CreateReconciliationInput["onProgress"],
  level: ProgressLog["level"],
  message: string,
  options?: Partial<Pick<ProgressLog, "id" | "details" | "expanded">>,
) {
  onProgress?.({
    id: options?.id ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    message,
    details: options?.details,
    expanded: options?.expanded,
  });
}

function saveTaskFiles(input: CreateReconciliationInput) {
  const settlementStored = saveUploadedFile(input.settlementFile.buffer, input.settlementFile.originalName);
  try {
    const erpStored = saveUploadedFile(input.erpFile.buffer, input.erpFile.originalName);
    return { settlementStored, erpStored };
  } catch (error) {
    deleteStoredFilePath(settlementStored.absolutePath);
    throw error;
  }
}

/**
 * 创建对账任务：
 * 1. 落盘两个文件
 * 2. 事务：建 File 记录 + ReconciliationTask（PROCESSING，含版本号）
 * 3. 异步调 CherryStudio，回写结果
 */
export async function createReconciliationTask(input: CreateReconciliationInput) {
  let activeTaskId: string | null = null;
  const pendingLogs: ProgressLog[] = [];
  const onProgress = (log: ProgressLog) => {
    if (activeTaskId) appendTaskProgress(activeTaskId, log);
    else pendingLogs.push(log);
    input.onProgress?.(log);
  };

  emit(onProgress, "info", "开始创建对账任务…");

  // 1. 落盘文件
  const { settlementStored, erpStored } = saveTaskFiles(input);
  emit(onProgress, "success", "文件已保存到服务器磁盘");

  // 2. 事务创建任务 + 文件记录
  let task;
  try {
    task = await prisma.$transaction(async (tx) => {
      const settlementFile = await tx.file.create({
        data: {
          id: settlementStored.id,
          kind: FileKind.SETTLEMENT,
          originalName: normalizeFileName(input.settlementFile.originalName),
          contentType: input.settlementFile.contentType || "application/octet-stream",
          sizeBytes: BigInt(input.settlementFile.buffer.length),
          storedPath: settlementStored.absolutePath,
        },
      });
      const erpFile = await tx.file.create({
        data: {
          id: erpStored.id,
          kind: FileKind.ERP,
          originalName: normalizeFileName(input.erpFile.originalName),
          contentType: input.erpFile.contentType || "application/octet-stream",
          sizeBytes: BigInt(input.erpFile.buffer.length),
          storedPath: erpStored.absolutePath,
        },
      });

      const created = await tx.reconciliationTask.create({
        data: {
          status: TaskStatus.PROCESSING,
          version: 1,
          settlementFileId: settlementFile.id,
          erpFileId: erpFile.id,
          agentName: input.agentSelector.name?.trim() || null,
          agentWorkspace: input.agentSelector.workspace?.trim() || null,
          createdByName: "CherryStudio Agent",
        },
        include: { settlementFile: true, erpFile: true },
      });

      return created;
    });
  } catch (error) {
    deleteStoredFilePath(settlementStored.absolutePath);
    deleteStoredFilePath(erpStored.absolutePath);
    throw error;
  }

  activeTaskId = task.id;
  initializeTaskProgress(task.id, pendingLogs);

  emit(onProgress, "success", `任务已创建（ID：${task.id}）`);

  // 3. 异步对账（不阻塞响应）
  void runReconciliation(
    task.id,
    settlementStored.absolutePath,
    erpStored.absolutePath,
    input.agentSelector,
    onProgress,
  );

  return task;
}

/**
 * 后台执行对账：调 CherryStudio、解析结果、回写数据库。
 * 同账期新任务到终态时，作废旧版本。
 */
async function runReconciliation(
  taskId: string,
  settlementFilePath: string,
  erpFilePath: string,
  agentSelector: AgentSelector,
  onProgress?: CreateReconciliationInput["onProgress"],
) {
  const active: ActiveReconciliation = { controller: new AbortController() };
  activeReconciliations.set(taskId, active);
  let taskWorkDir = "";

  try {
    taskWorkDir = prepareTaskWorkDir(taskId);
    const started = await prisma.reconciliationTask.updateMany({
      where: { id: taskId, status: { in: [TaskStatus.PROCESSING, TaskStatus.QUEUED] } },
      data: {
        status: TaskStatus.PROCESSING,
        failureCode: null,
        failureMessage: null,
        completedAt: null,
        attemptCount: { increment: 1 },
      },
    });
    if (started.count === 0) return;
    emit(onProgress, "info", "正在连接 CherryStudio Agent…");
    const target = await resolveAgentSession(
      agentSelector,
      (level, message, options) => emit(onProgress, level, message, options),
      active.controller.signal,
    );
    active.target = target;
    await prisma.reconciliationTask.update({
      where: { id: taskId },
      data: {
        agentName: target.agentName,
        agentId: target.agentId,
        agentSessionId: target.sessionId,
      },
    });

    // 构造文件 URL：通过后端自己的下载接口暴露，CherryStudio 需要能访问到
    const host = "http://127.0.0.1:" + config.port;
    const settlementUrl = `${host}/api/tasks/${taskId}/files/SETTLEMENT`;
    const erpUrl = `${host}/api/tasks/${taskId}/files/ERP`;

    const prompt = buildReconciliationPrompt({
      settlementFileUrl: settlementUrl,
      erpFileUrl: erpUrl,
      settlementFilePath,
      erpFilePath,
      submittedAt: new Date().toISOString(),
      taskId,
      taskWorkDir,
    });

    emit(onProgress, "info", "提示词已生成，正在提交至 Agent…");
    const result = await sendReconciliationPrompt(
      target,
      prompt,
      (level, message, options) => emit(onProgress, level, message, options),
      active.controller.signal,
    );

    // 回写数据库
    await applyReconciliationResult(taskId, result, onProgress);
  } catch (error) {
    if (active.controller.signal.aborted || await taskWasCancelled(taskId)) return;
    const message = error instanceof Error ? error.message : "对账处理失败";
    const failureCode = error instanceof CherryStudioError ? error.code : "RECONCILIATION_FAILED";
    emit(onProgress, "error", message);
    try {
      await prisma.reconciliationTask.updateMany({
        where: { id: taskId, status: { in: [TaskStatus.PROCESSING, TaskStatus.QUEUED] } },
        data: {
          status: TaskStatus.FAILED,
          failureCode,
          failureMessage: message,
          completedAt: new Date(),
        },
      });
    } catch {
      // 忽略回写失败
    }
  } finally {
    try {
      cleanupTaskWorkDir(taskId);
    } catch (error) {
      console.error(`[cleanup] 清理任务临时目录 ${taskId} 失败`, error);
    }
    if (activeReconciliations.get(taskId) === active) activeReconciliations.delete(taskId);
  }
}

export async function cancelReconciliationTask(taskId: string) {
  const task = await prisma.reconciliationTask.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, agentId: true, agentName: true, agentSessionId: true },
  });
  if (!task) return { outcome: "not_found" as const };
  if (task.status !== TaskStatus.PROCESSING && task.status !== TaskStatus.QUEUED) {
    return { outcome: "already_finished" as const, status: task.status };
  }

  const cancelled = await prisma.reconciliationTask.updateMany({
    where: { id: taskId, status: { in: [TaskStatus.PROCESSING, TaskStatus.QUEUED] } },
    data: {
      status: TaskStatus.CANCELLED,
      failureCode: "TASK_CANCELLED",
      failureMessage: "对账任务已由用户停止",
      completedAt: new Date(),
    },
  });
  if (cancelled.count === 0) {
    const current = await prisma.reconciliationTask.findUnique({ where: { id: taskId }, select: { status: true } });
    return { outcome: "already_finished" as const, status: current?.status };
  }

  const active = activeReconciliations.get(taskId);
  active?.controller.abort(new Error("对账任务已由用户停止"));
  const target = active?.target ?? (
    task.agentId && task.agentSessionId
      ? { agentId: task.agentId, agentName: task.agentName ?? "", sessionId: task.agentSessionId }
      : undefined
  );

  appendTaskProgress(taskId, {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level: "success",
    message: "对账任务已停止",
  });

  let sessionStopped = false;
  if (target) {
    try {
      await deleteAgentSession(target);
      sessionStopped = true;
    } catch (error) {
      console.error(`[reconciliation] 停止 CherryStudio Session ${target.sessionId} 失败`, error);
    }
  }

  return { outcome: "cancelled" as const, status: TaskStatus.CANCELLED, sessionStopped };
}

async function taskWasCancelled(taskId: string) {
  const task = await prisma.reconciliationTask.findUnique({ where: { id: taskId }, select: { status: true } });
  return task?.status === TaskStatus.CANCELLED;
}

export async function resumeIncompleteTasks() {
  const tasks = await prisma.reconciliationTask.findMany({
    where: { status: { in: [TaskStatus.PROCESSING, TaskStatus.QUEUED] } },
    include: { settlementFile: true, erpFile: true },
  });

  for (const task of tasks) {
    initializeTaskProgress(task.id, []);
    const onProgress = (log: ProgressLog) => appendTaskProgress(task.id, log);
    emit(onProgress, "info", "服务恢复后继续执行未完成任务");

    if (task.agentId && task.agentSessionId) {
      try {
        await deleteAgentSession({
          agentId: task.agentId,
          agentName: task.agentName ?? "",
          sessionId: task.agentSessionId,
        });
        await prisma.reconciliationTask.updateMany({
          where: { id: task.id, status: { in: [TaskStatus.PROCESSING, TaskStatus.QUEUED] } },
          data: { agentSessionId: null },
        });
        emit(onProgress, "success", "已清理上次中断的 Agent Session");
      } catch (error) {
        console.error(`[startup] 清理中断 Session ${task.agentSessionId} 失败`, error);
        emit(onProgress, "info", "上次 Agent Session 无法清理，将创建新的 Session 继续处理");
      }
    }

    void runReconciliation(
      task.id,
      task.settlementFile.storedPath,
      task.erpFile.storedPath,
      { name: task.agentName ?? undefined, workspace: task.agentWorkspace ?? undefined },
      onProgress,
    );
  }

  return tasks.length;
}

/**
 * 应用 agent 对账结果到数据库：
 * 更新任务状态/金额/明细，处理账期与版本号。
 */
async function applyReconciliationResult(
  taskId: string,
  result: CherryParseResult,
  onProgress?: CreateReconciliationInput["onProgress"],
) {
  const differenceAmount = new Prisma.Decimal(result.difference.toFixed(2));
  const status = result.matched ? TaskStatus.SUCCEEDED : TaskStatus.NEEDS_REVIEW;
  const period = result.period ?? extractPeriodFromPayload(result);

  const applied = await prisma.$transaction(async (tx) => {
    if (period) {
      // Prisma cannot deserialize PostgreSQL's void return type, so expose only an integer column.
      await tx.$queryRaw<Array<{ acquired: number }>>`
        SELECT 1 AS acquired
        FROM pg_advisory_xact_lock(hashtext(${period}))
      `;
    }

    // 1. 更新任务状态
    const task = await tx.reconciliationTask.updateMany({
      where: { id: taskId, status: { in: [TaskStatus.PROCESSING, TaskStatus.QUEUED] } },
      data: {
        name: result.name,
        status,
        differenceAmount,
        completedAt: new Date(),
        rawAgentPayload: result.rawAgentPayload as unknown as Prisma.InputJsonValue,
      },
    });
    if (task.count === 0) return false;

    // A resumed attempt replaces any partial review data from an earlier attempt.
    await tx.reconciliationReviewItem.deleteMany({ where: { taskId } });

    // 2. 创建明细
    if (result.issues.length > 0) {
      await tx.reconciliationReviewItem.createMany({
        data: result.issues.map((issue, index) => ({
          taskId,
          label: issue.rowLabel ?? issue.fieldName ?? `第 ${index + 1} 条`,
          differenceAmount: toFiniteDecimal(issue.differenceAmount),
          status: ReviewItemStatus.PENDING,
          payload: issue as unknown as Prisma.InputJsonValue,
        })),
      });
    }

    // 3. 版本号 + 账期：每次对账都是独立业务记录，不自动改写历史任务状态。
    if (period) {
      // 版本号只用于满足同账期记录的唯一约束，不代表新任务替代旧任务。
      const latest = await tx.reconciliationTask.findFirst({
        where: { period, id: { not: taskId } },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersion = latest ? latest.version + 1 : 1;
      await tx.reconciliationTask.update({
        where: { id: taskId },
        data: { period, version: nextVersion },
      });
    }

    return true;
  });

  if (!applied) return;

  emit(
    onProgress,
    "success",
    `对账完成：${result.name}，差额 ${differenceAmount.toString()} 元${status === TaskStatus.SUCCEEDED ? "（金额一致）" : "（存在差异）"}`,
  );
}

function toFiniteDecimal(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? new Prisma.Decimal(number.toFixed(2)) : null;
}

/**
 * 从 agent 返回里提取账期（YYYY-MM）。
 * 第一版：从 rawAgentPayload 里找日期字段；找不到返回 null（不参与版本号）。
 */
function extractPeriodFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  // 常见日期字段
  const dateCandidates = [
    record.period,
    record.month,
    record.periodLabel,
    record.billDate,
    record.settlementDate,
    record.date,
  ];

  for (const candidate of dateCandidates) {
    if (typeof candidate === "string") {
      const m = candidate.match(/^\d{4}-(\d{1,2})/);
      const month = m ? Number(m[1]) : 0;
      if (month >= 1 && month <= 12) {
        return `${candidate.slice(0, 4)}-${String(month).padStart(2, "0")}`;
      }
      // 也支持 yyyy年m月
      const m2 = candidate.match(/(\d{4})年-?(\d{1,2})月/);
      const chineseMonth = m2 ? Number(m2[2]) : 0;
      if (chineseMonth >= 1 && chineseMonth <= 12) {
        return `${m2![1]}-${String(chineseMonth).padStart(2, "0")}`;
      }
    }
  }

  // 从 issues 里找
  if (Array.isArray(record.issues)) {
    for (const issue of record.issues) {
      if (issue && typeof issue === "object") {
        const extracted = extractPeriodFromPayload(issue);
        if (extracted) return extracted;
      }
    }
  }

  return null;
}

export function buildReconciliationPrompt(params: {
  settlementFileUrl: string;
  erpFileUrl: string;
  settlementFilePath: string;
  erpFilePath: string;
  submittedAt: string;
  taskId: string;
  taskWorkDir: string;
}) {
  const erpUrl = params.erpFileUrl;
  const settlementUrl = params.settlementFileUrl;

  return `我有一个对账任务：

${erpUrl}
这是 ERP 导出单据

${settlementUrl}
这是结算单

本次任务唯一允许使用的临时工作目录：
${params.taskWorkDir}

如需下载文件、拆分 PDF、渲染图片、执行 OCR 或生成 Markdown/JSON，请只写入上述目录。不要在项目根目录、源码目录或输入文件旁创建文件；不要复制原始文件，优先直接读取以下本地路径：
- ERP：${params.erpFilePath}
- 结算单：${params.settlementFilePath}

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
- name: 字符串，drp表单中的商城名称`

}
