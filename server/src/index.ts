// 先加载 BigInt 序列化补丁（必须在任何 res.json() 之前）
import "./lib/bigint.js";

import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";
import { config } from "./lib/config.js";
import { tasksRouter } from "./routes/tasks.js";
import { reviewItemsRouter } from "./routes/review-items.js";
import { filesRouter } from "./routes/files.js";
import { statisticsRouter } from "./routes/statistics.js";
import { notFoundHandler, errorHandler } from "./middleware/error-handler.js";
import { cleanupExpiredFiles, cleanupOrphanedFiles } from "./lib/file-storage.js";
import { resumeIncompleteTasks } from "./services/reconciliation.js";
import { checkCherryStudioConnection } from "./lib/cherrystudio.js";

async function main() {
  const app = express();
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && !config.allowedOrigins.includes(origin)) {
      return res.status(403).json({
        error: { code: "ORIGIN_FORBIDDEN", message: "不允许的请求来源", requestId: crypto.randomUUID() },
      });
    }
    next();
  });
  app.use(cors({ origin: config.allowedOrigins }));
  app.use(express.json());

  // 健康检查
  app.get("/api/health", async (req, res, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const cherryStudio = req.query.deep === "1"
        ? await checkCherryStudioConnection()
        : { status: "unchecked" as const };
      res.json({
        data: {
          service: "billcompare",
          apiVersion: 2,
          status: "ok",
          database: "ok",
          cherryStudio,
          time: new Date().toISOString(),
        },
        requestId: crypto.randomUUID(),
      });
    } catch (error) {
      next(error);
    }
  });

  // 路由
  app.use("/api/tasks", tasksRouter);
  app.use("/api/tasks", reviewItemsRouter);
  app.use("/api/tasks", filesRouter);
  app.use("/api/statistics", statisticsRouter);

  // 404 + 错误处理
  app.use(notFoundHandler);
  app.use(errorHandler);

  app.listen(config.port, config.host, async () => {
    console.log(`[server] 后端已启动: http://${config.host}:${config.port}`);
    console.log(`[server] 上传目录: ${config.uploadDir}`);
    try {
      const resumed = await resumeIncompleteTasks();
      if (resumed > 0) console.log(`[startup] 已恢复 ${resumed} 个未完成任务`);
    } catch (error) {
      console.error("[startup] 恢复未完成任务失败:", error);
    }
  });

  // 每日清理过期文件（启动时跑一次 + 每 24h）
  const cleanup = async () => {
    try {
      const n = await cleanupExpiredFiles(prisma);
      if (n > 0) console.log(`[cleanup] 清理 ${n} 个过期文件`);
      const orphaned = await cleanupOrphanedFiles(prisma);
      if (orphaned > 0) console.log(`[cleanup] 清理 ${orphaned} 个孤立文件`);
    } catch (error) {
      console.error("[cleanup] 清理失败:", error);
    }
  };
  await cleanup();
  setInterval(cleanup, 24 * 60 * 60 * 1000);
}

main().catch((error) => {
  console.error("[server] 启动失败:", error);
  process.exit(1);
});
