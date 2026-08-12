import { Router } from "express";
import { ReviewItemStatus, TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export const reviewItemsRouter = Router();

// PATCH /api/tasks/:taskId/review-items/:itemId —— 审批明细
reviewItemsRouter.patch("/:taskId/review-items/:itemId", async (req, res, next) => {
  try {
    const { taskId, itemId } = req.params;
    const { status } = req.body ?? {};

    if (!["PENDING", "APPROVED", "IGNORED"].includes(status)) {
      return res.status(400).json({
        error: {
          code: "INVALID_STATUS",
          message: "status 必须是 PENDING / APPROVED / IGNORED",
          requestId: crypto.randomUUID(),
        },
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${taskId}))`;

      // 1. 更新明细状态
      const item = await tx.reconciliationReviewItem.findUnique({
        where: { id: itemId },
      });
      if (!item || item.taskId !== taskId) {
        return { notFound: true } as const;
      }

      await tx.reconciliationReviewItem.update({
        where: { id: itemId },
        data: {
          status: status as ReviewItemStatus,
          resolvedAt: status === "PENDING" ? null : new Date(),
        },
      });

      // 2. 重新加载任务及其全部明细
      const task = await tx.reconciliationTask.findUnique({
        where: { id: taskId },
        include: { reviewItems: true },
      });
      if (!task) return { notFound: true } as const;

      const allDone = task.reviewItems.every((i) => i.status !== ReviewItemStatus.PENDING);

      // 3. 状态流转
      if (allDone && task.status === TaskStatus.NEEDS_REVIEW) {
        await tx.reconciliationTask.update({
          where: { id: taskId },
          data: { status: TaskStatus.REVIEWED, resolvedAt: new Date() },
        });
      } else if (
        status === "PENDING" &&
        task.status === TaskStatus.REVIEWED
      ) {
        await tx.reconciliationTask.update({
          where: { id: taskId },
          data: { status: TaskStatus.NEEDS_REVIEW, resolvedAt: null },
        });
      }

      const refreshed = await tx.reconciliationTask.findUnique({
        where: { id: taskId },
        include: {
          settlementFile: true,
          erpFile: true,
          reviewItems: { orderBy: { createdAt: "asc" } },
        },
      });

      return { notFound: false, task: refreshed } as const;
    });

    if ("notFound" in updated && updated.notFound) {
      return res.status(404).json({
        error: { code: "ITEM_NOT_FOUND", message: "未找到该明细", requestId: crypto.randomUUID() },
      });
    }

    if ("task" in updated && updated.task) {
      return res.json({ data: { task: updated.task }, requestId: crypto.randomUUID() });
    }

    return res.status(500).json({
      error: { code: "UNKNOWN", message: "未知错误", requestId: crypto.randomUUID() },
    });
  } catch (error) {
    next(error);
  }
});
