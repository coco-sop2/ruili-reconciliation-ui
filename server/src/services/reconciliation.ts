import { Prisma, TaskStatus, ReviewItemStatus, FileKind } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { deleteStoredFilePath, saveUploadedFile, normalizeFileName } from "../lib/file-storage.js";
import { appendTaskProgress, initializeTaskProgress } from "../lib/task-progress.js";
import {
  resolveAgentSession,
  sendReconciliationPrompt,
  CherryStudioError,
  type AgentSelector,
} from "../lib/cherrystudio.js";
import { config } from "../lib/config.js";

export type ProgressLog = {
  id: string;
  timestamp: string;
  level: "info" | "success" | "error";
  message: string;
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
  agentSelector: AgentSelector;
  onProgress?: (log: ProgressLog) => void;
};

function emit(
  onProgress: CreateReconciliationInput["onProgress"],
  level: ProgressLog["level"],
  message: string,
) {
  onProgress?.({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, message });
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
  try {
    await prisma.reconciliationTask.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.PROCESSING,
        failureCode: null,
        failureMessage: null,
        completedAt: null,
        attemptCount: { increment: 1 },
      },
    });
    emit(onProgress, "info", "正在连接 CherryStudio Agent…");
    const target = await resolveAgentSession(agentSelector, (level, message) =>
      emit(onProgress, level, message),
    );
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
    });

    emit(onProgress, "info", "提示词已生成，正在提交至 Agent…");
    const result = await sendReconciliationPrompt(target, prompt, (level, message) =>
      emit(onProgress, level, message),
    );

    // 回写数据库
    await applyReconciliationResult(taskId, result, onProgress);
  } catch (error) {
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
  }
}

export async function resumeIncompleteTasks() {
  const tasks = await prisma.reconciliationTask.findMany({
    where: { status: { in: [TaskStatus.PROCESSING, TaskStatus.QUEUED] } },
    include: { settlementFile: true, erpFile: true },
  });

  for (const task of tasks) {
    if (task.attemptCount >= 3) {
      await prisma.reconciliationTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.FAILED,
          failureCode: "RETRY_LIMIT_REACHED",
          failureMessage: "服务多次重启，对账任务已停止自动恢复",
          completedAt: new Date(),
        },
      });
      continue;
    }

    initializeTaskProgress(task.id, []);
    const onProgress = (log: ProgressLog) => appendTaskProgress(task.id, log);
    emit(onProgress, "info", `服务恢复后继续执行任务（第 ${task.attemptCount + 1} 次尝试）`);
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
  result: {
    matched: boolean;
    difference: number;
    period?: string | null;
    settlementAmount?: number | null;
    erpAmount?: number | null;
    issues: Array<{
      rowLabel?: string;
      fieldName?: string;
      differenceAmount?: string | number | null;
      message?: string;
      suggestion?: string | null;
      [key: string]: unknown;
    }>;
  },
  onProgress?: CreateReconciliationInput["onProgress"],
) {
  const differenceAmount = new Prisma.Decimal(result.difference.toFixed(2));
  const status = result.matched ? TaskStatus.SUCCEEDED : TaskStatus.NEEDS_REVIEW;
  const period = result.period ?? extractPeriodFromPayload(result);

  await prisma.$transaction(async (tx) => {
    if (period) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${period}))`;
    }

    // 1. 更新任务状态
    const task = await tx.reconciliationTask.update({
      where: { id: taskId },
      data: {
        status,
        settlementAmount: toFiniteDecimal(result.settlementAmount),
        erpAmount: toFiniteDecimal(result.erpAmount),
        differenceAmount,
        completedAt: new Date(),
        rawAgentPayload: result as unknown as Prisma.InputJsonValue,
      },
    });

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

    // 3. 版本号 + 账期：解析账期，作废旧版
    if (period) {
      // 同账期已有非 OBSOLETE 任务 → 作废
      await tx.reconciliationTask.updateMany({
        where: {
          period,
          status: {
            in: [TaskStatus.SUCCEEDED, TaskStatus.NEEDS_REVIEW, TaskStatus.REVIEWED, TaskStatus.FAILED],
          },
          id: { not: taskId },
        },
        data: { status: TaskStatus.OBSOLETE },
      });
      // 计算新版本号
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

    return task;
  });

  emit(
    onProgress,
    "success",
    `对账完成：差额 ${differenceAmount.toString()} 元${status === TaskStatus.SUCCEEDED ? "（金额一致）" : "（存在差异）"}`,
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
      const m2 = candidate.match(/(\d{4})年(\d{1,2})月/);
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
}) {
  return `请对以下两份文件进行对账。

结算资料本地路径：${params.settlementFilePath}
ERP 资料本地路径：${params.erpFilePath}

以上路径位于当前 Agent 的 accessible_paths 内，请优先直接读取本地文件。
仅当本地路径不可用时再使用下面的备用下载地址：
结算资料下载地址：${params.settlementFileUrl}
ERP 资料下载地址：${params.erpFileUrl}

请逐条核对两份资料中的金额，输出严格的 JSON（不要额外文字，不要 markdown 代码块）：

{
  "matched": true/false,
  "settlementAmount": 结算总额数字或 null,
  "erpAmount": ERP 总额数字或 null,
  "difference": 总差额数字,
  "period": "账期，格式 YYYY-MM；无法识别时为 null",
  "issues": [
    {
      "rowLabel": "行标识",
      "fieldName": "字段名",
      "settlementValue": 结算值,
      "erpValue": ERP 值,
      "differenceAmount": 差额,
      "message": "差异说明",
      "suggestion": "核对建议"
    }
  ]
}

要求：
1. matched=true 当且仅当所有金额一致
2. 逐条列出全部有差异的条目到 issues
3. difference 固定使用 ERP 金额减结算金额（ERP - 结算）；结算大于 ERP 时必须为负数
4. issues 中的 differenceAmount 也固定使用 ERP 值减结算值
5. 金额用数字，不要带货币符号`;
}
