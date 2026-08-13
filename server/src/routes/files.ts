import { Router } from "express";
import fs from "node:fs";
import { prisma } from "../lib/prisma.js";

export const filesRouter = Router();

// GET /api/tasks/:taskId/files/:kind —— 下载/预览文件
filesRouter.get("/:taskId/files/:kind", async (req, res, next) => {
  try {
    const { taskId, kind } = req.params;
    const normalizedKind = (kind ?? "").toUpperCase();
    if (!["SETTLEMENT", "ERP"].includes(normalizedKind)) {
      return res.status(400).json({
        error: { code: "INVALID_KIND", message: "kind 必须是 SETTLEMENT / ERP", requestId: crypto.randomUUID() },
      });
    }

    const task = await prisma.reconciliationTask.findUnique({
      where: { id: taskId },
      include: { settlementFile: true, erpFile: true },
    });
    if (!task) {
      return res.status(404).json({
        error: { code: "TASK_NOT_FOUND", message: "未找到对账任务", requestId: crypto.randomUUID() },
      });
    }

    const file = normalizedKind === "SETTLEMENT" ? task.settlementFile : task.erpFile;
    if (!file || file.deletedAt) {
      return res.status(404).json({
        error: { code: "FILE_NOT_FOUND", message: "文件不存在或已清理", requestId: crypto.randomUUID() },
      });
    }

    // 检查磁盘文件是否存在
    if (!fs.existsSync(file.storedPath)) {
      return res.status(404).json({
        error: { code: "FILE_MISSING", message: "磁盘文件丢失", requestId: crypto.randomUUID() },
      });
    }

    res.setHeader("Content-Type", file.contentType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    res.setHeader("Content-Length", Number(file.sizeBytes));

    const stream = fs.createReadStream(file.storedPath);
    stream.on("error", (err) => next(err));
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});
