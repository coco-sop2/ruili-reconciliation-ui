import { Router } from "express";
import multer from "multer";
import { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import {
  cancelReconciliationTask,
  createReconciliationTask,
  type ProgressLog,
} from "../services/reconciliation.js";
import { getTaskProgress, removeTaskProgress } from "../lib/task-progress.js";
import { deleteStoredFilePath } from "../lib/file-storage.js";
import path from "node:path";

export const tasksRouter = Router();

// multer 内存存储（不落盘，由服务层统一处理）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

// POST /api/tasks —— 创建对账任务
tasksRouter.post("/", upload.fields([
  { name: "settlementFile", maxCount: 1 },
  { name: "erpFile", maxCount: 1 },
]), async (req, res, next) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const settlement = files?.settlementFile?.[0];
    const erp = files?.erpFile?.[0];

    if (!settlement || !erp) {
      return res.status(400).json({
        error: { code: "MISSING_FILES", message: "需要上传结算资料和 ERP 资料两份文件", requestId: crypto.randomUUID() },
      });
    }

    const acceptedExtensions = new Set([".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg"]);
    const acceptedMimeTypes = new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/pdf",
      "image/png",
      "image/jpeg",
    ]);
    if ([settlement, erp].some((file) => {
      const extensionAllowed = acceptedExtensions.has(path.extname(file.originalname).toLowerCase());
      const mimeAllowed = !file.mimetype
        || file.mimetype === "application/octet-stream"
        || acceptedMimeTypes.has(file.mimetype);
      return !extensionAllowed || !mimeAllowed;
    })) {
      return res.status(400).json({
        error: { code: "INVALID_FILE_TYPE", message: "仅支持 Excel、PDF、PNG 和 JPG 文件", requestId: crypto.randomUUID() },
      });
    }

    const agentSelector = {
      name: (req.body?.agentName as string) || undefined,
      workspace: (req.body?.agentWorkspace as string) || undefined,
    };

    const logs: ProgressLog[] = [];
    const task = await createReconciliationTask({
      settlementFile: {
        buffer: settlement.buffer,
        originalName: settlement.originalname,
        contentType: settlement.mimetype,
      },
      erpFile: {
        buffer: erp.buffer,
        originalName: erp.originalname,
        contentType: erp.mimetype,
      },
      agentSelector,
      onProgress: (log) => logs.push(log),
    });

    return res.status(202).json({
      data: {
        taskId: task.id,
        status: task.status,
        logs,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks —— 列表（分页 + 筛选）
tasksRouter.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const keyword = (req.query.keyword as string)?.trim().toLowerCase() || "";
    const statusParam = req.query.status as string | undefined;
    const statuses = statusParam
      ? statusParam.split(",").filter(Boolean)
      : undefined;

    const validStatuses = new Set(Object.values(TaskStatus));
    if (statuses?.some((status) => !validStatuses.has(status as TaskStatus))) {
      return res.status(400).json({
        error: { code: "INVALID_STATUS", message: "包含不支持的任务状态", requestId: crypto.randomUUID() },
      });
    }

    const facetWhere: Prisma.ReconciliationTaskWhereInput = {};
    if (keyword) {
      facetWhere.OR = [
        { id: { contains: keyword, mode: "insensitive" } },
        { name: { contains: keyword, mode: "insensitive" } },
        { period: { contains: keyword, mode: "insensitive" } },
        { createdByName: { contains: keyword, mode: "insensitive" } },
        { settlementFile: { originalName: { contains: keyword, mode: "insensitive" } } },
        { erpFile: { originalName: { contains: keyword, mode: "insensitive" } } },
      ];
    }
    const where: Prisma.ReconciliationTaskWhereInput = {
      ...facetWhere,
      ...(statuses?.length ? { status: { in: statuses as TaskStatus[] } } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.reconciliationTask.count({ where }),
      prisma.reconciliationTask.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { settlementFile: true, erpFile: true },
      }),
    ]);

    // facets
    const byStatus = {
      QUEUED: 0,
      PROCESSING: 0,
      SUCCEEDED: 0,
      NEEDS_REVIEW: 0,
      REVIEWED: 0,
      FAILED: 0,
      CANCELLED: 0,
      OBSOLETE: 0,
    };
    const [facetTotal, statusCounts] = await Promise.all([
      prisma.reconciliationTask.count({ where: facetWhere }),
      prisma.reconciliationTask.groupBy({
      by: ["status"],
      where: facetWhere,
      _count: true,
      }),
    ]);
    for (const row of statusCounts) {
      byStatus[row.status] = row._count;
    }

    return res.json({
      data: {
        items: items.map((task) => toSummary(task)),
        page,
        pageSize,
        total,
        facets: { total: facetTotal, byStatus },
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id —— 详情（含明细）
// POST /api/tasks/:id/stop - stop an active backend run and its CherryStudio session.
tasksRouter.post("/:id/stop", async (req, res, next) => {
  try {
    const result = await cancelReconciliationTask(req.params.id);
    if (result.outcome === "not_found") {
      return res.status(404).json({
        error: { code: "TASK_NOT_FOUND", message: "未找到对账任务", requestId: crypto.randomUUID() },
      });
    }
    if (result.outcome === "already_finished" && result.status !== TaskStatus.CANCELLED) {
      return res.status(409).json({
        error: { code: "TASK_NOT_ACTIVE", message: "任务已结束，无需停止", requestId: crypto.randomUUID() },
      });
    }
    return res.json({
      data: {
        taskId: req.params.id,
        status: TaskStatus.CANCELLED,
        stopped: true,
        sessionStopped: result.outcome === "cancelled" ? result.sessionStopped : true,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id - permanently remove a completed task and its source files.
tasksRouter.delete("/:id", async (req, res, next) => {
  try {
    const task = await prisma.reconciliationTask.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        status: true,
        settlementFile: { select: { id: true, storedPath: true } },
        erpFile: { select: { id: true, storedPath: true } },
      },
    });

    if (!task) {
      return res.status(404).json({
        error: { code: "TASK_NOT_FOUND", message: "未找到对账任务", requestId: crypto.randomUUID() },
      });
    }

    if (task.status === "QUEUED" || task.status === "PROCESSING") {
      return res.status(409).json({
        error: { code: "TASK_ACTIVE", message: "正在执行的对账任务不能删除", requestId: crypto.randomUUID() },
      });
    }

    const files = [task.settlementFile, task.erpFile];
    await prisma.$transaction(async (transaction) => {
      // Review items are removed by their cascading foreign key.
      await transaction.reconciliationTask.delete({ where: { id: task.id } });
      await transaction.file.updateMany({
        where: { id: { in: files.map((file) => file.id) } },
        data: { deletedAt: new Date() },
      });
    });

    removeTaskProgress(task.id);
    const fileCleanupWarnings: string[] = [];
    for (const file of files) {
      try {
        deleteStoredFilePath(file.storedPath);
        await prisma.file.delete({ where: { id: file.id } });
      } catch (error) {
        fileCleanupWarnings.push(file.id);
        console.error(`Failed to delete stored file ${file.id}`, error);
      }
    }

    return res.json({
      data: {
        taskId: task.id,
        deleted: true,
        deletedFiles: files.length - fileCleanupWarnings.length,
        fileCleanupWarnings,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    next(error);
  }
});

tasksRouter.get("/:id", async (req, res, next) => {
  try {
    const task = await prisma.reconciliationTask.findUnique({
      where: { id: req.params.id },
      include: {
        settlementFile: true,
        erpFile: true,
        reviewItems: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!task) {
      return res.status(404).json({
        error: { code: "TASK_NOT_FOUND", message: "未找到对账任务", requestId: crypto.randomUUID() },
      });
    }

    return res.json({
      data: { ...toDetail(task), progressLogs: getTaskProgress(task.id) },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    next(error);
  }
});

function toSummary(task: {
  id: string;
  name: string | null;
  status: string;
  period: string | null;
  version: number;
  createdAt: Date;
  completedAt: Date | null;
  settlementAmount: Prisma.Decimal | null;
  erpAmount: Prisma.Decimal | null;
  differenceAmount: Prisma.Decimal | null;
  createdByName: string | null;
  settlementFile: { id: string; originalName: string; sizeBytes: bigint };
  erpFile: { id: string; originalName: string; sizeBytes: bigint };
}) {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    periodLabel: task.period,
    version: task.version,
    settlementFile: {
      id: task.settlementFile.id,
      name: task.settlementFile.originalName,
      size: Number(task.settlementFile.sizeBytes),
    },
    erpFile: {
      id: task.erpFile.id,
      name: task.erpFile.originalName,
      size: Number(task.erpFile.sizeBytes),
    },
    metrics: {
      settlementAmount: task.settlementAmount?.toString() ?? null,
      erpAmount: task.erpAmount?.toString() ?? null,
      differenceAmount: task.differenceAmount?.toString() ?? null,
    },
    createdAt: task.createdAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
    createdBy: { id: "system", name: task.createdByName ?? "未知" },
  };
}

function toDetail(task: {
  id: string;
  name: string | null;
  status: string;
  period: string | null;
  version: number;
  createdAt: Date;
  completedAt: Date | null;
  resolvedAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  settlementAmount: Prisma.Decimal | null;
  erpAmount: Prisma.Decimal | null;
  differenceAmount: Prisma.Decimal | null;
  createdByName: string | null;
  settlementFile: { id: string; originalName: string; sizeBytes: bigint };
  erpFile: { id: string; originalName: string; sizeBytes: bigint };
  reviewItems: Array<{
    id: string;
    label: string;
    differenceAmount: Prisma.Decimal | null;
    status: string;
    payload: Prisma.JsonValue;
    resolvedAt: Date | null;
  }>;
}) {
  return {
    ...toSummary(task),
    resolvedAt: task.resolvedAt?.toISOString() ?? null,
    failure: task.failureCode
      ? { code: task.failureCode, message: task.failureMessage ?? "" }
      : null,
    reviewItems: task.reviewItems.map((item) => {
      const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
        ? item.payload as Record<string, Prisma.JsonValue>
        : {};
      return {
        id: item.id,
        rowLabel: typeof payload.rowLabel === "string" ? payload.rowLabel : item.label,
        fieldName: typeof payload.fieldName === "string"
          ? payload.fieldName
          : typeof payload.field === "string" ? payload.field : item.label,
        differenceAmount: item.differenceAmount?.toString() ?? null,
        status: item.status,
        message: typeof payload.message === "string" ? payload.message : "",
        suggestion: typeof payload.suggestion === "string" ? payload.suggestion : null,
        payload: item.payload,
        resolvedAt: item.resolvedAt?.toISOString() ?? null,
      };
    }),
  };
}
