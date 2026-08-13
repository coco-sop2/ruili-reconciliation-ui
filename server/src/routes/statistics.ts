import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export const statisticsRouter = Router();

// GET /api/statistics?month=YYYY-MM —— 总览统计
statisticsRouter.get("/", async (req, res, next) => {
  try {
    const month = (req.query.month as string) || currentShanghaiMonth();
    // 校验 month 格式
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        error: { code: "INVALID_MONTH", message: "month 必须是 YYYY-MM 格式", requestId: crypto.randomUUID() },
      });
    }

    const start = startOfShanghaiMonth(month);
    const end = startOfShanghaiMonth(shiftMonth(month, 1));

    const where = {
      createdAt: { gte: start, lt: end },
    };
    const previousStart = startOfShanghaiMonth(shiftMonth(month, -1));

    const [totalTasks, previousTotalTasks, byStatus, differences] = await Promise.all([
      prisma.reconciliationTask.count({ where }),
      prisma.reconciliationTask.count({
        where: { createdAt: { gte: previousStart, lt: start } },
      }),
      prisma.reconciliationTask.groupBy({
        by: ["status"],
        where,
        _count: true,
      }),
      prisma.reconciliationTask.findMany({
        where,
        select: { differenceAmount: true },
      }),
    ]);

    const counts: Record<string, number> = {
      QUEUED: 0,
      PROCESSING: 0,
      SUCCEEDED: 0,
      NEEDS_REVIEW: 0,
      REVIEWED: 0,
      FAILED: 0,
      CANCELLED: 0,
      OBSOLETE: 0,
    };
    for (const row of byStatus) counts[row.status] = row._count;

    const succeededTasks = counts.SUCCEEDED;
    const autoMatchRate = totalTasks ? succeededTasks / totalTasks : 0;
    const monthOverMonthRate = previousTotalTasks
      ? (totalTasks - previousTotalTasks) / previousTotalTasks
      : 0;
    const totalDifferenceAmount = differences
      .reduce((sum, task) => sum.plus(task.differenceAmount?.abs() ?? 0), new Prisma.Decimal(0))
      .toFixed(2);

    // 近 6 个月趋势
    const trendMonths = Array.from({ length: 6 }, (_, index) => {
      const label = shiftMonth(month, index - 5);
      const monthStart = startOfShanghaiMonth(label);
      const monthEnd = startOfShanghaiMonth(shiftMonth(label, 1));
      return { label, monthStart, monthEnd };
    });
    const trend = await Promise.all(trendMonths.map(async ({ label, monthStart, monthEnd }) => ({
      label,
      taskCount: await prisma.reconciliationTask.count({
        where: { createdAt: { gte: monthStart, lt: monthEnd } },
      }),
    })));

    return res.json({
      data: {
        month,
        totalTasks,
        succeededTasks,
        needsReviewTasks: counts.NEEDS_REVIEW,
        reviewedTasks: counts.REVIEWED,
        failedTasks: counts.FAILED,
        processingTasks: counts.PROCESSING + counts.QUEUED,
        autoMatchRate,
        monthOverMonthRate,
        totalDifferenceAmount,
        trend,
        updatedAt: new Date().toISOString(),
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    next(error);
  }
});

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const absoluteMonth = year * 12 + monthNumber - 1 + offset;
  const shiftedYear = Math.floor(absoluteMonth / 12);
  const shiftedMonth = absoluteMonth % 12 + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
}

function startOfShanghaiMonth(month: string) {
  return new Date(`${month}-01T00:00:00.000+08:00`);
}

function currentShanghaiMonth() {
  const shanghaiTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shanghaiTime.toISOString().slice(0, 7);
}
