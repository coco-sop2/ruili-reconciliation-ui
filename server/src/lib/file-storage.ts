import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { resolveUploadDir } from "./config.js";

// 允许的扩展名白名单
const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg"];

export type StoredFile = {
  id: string;
  extension: string;
  absolutePath: string;
};

function safeExtension(originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext) ? ext : "";
}

export function normalizeFileName(originalName: string) {
  // 保留原文件名用于展示，去除路径分隔符
  const decoded = /[\u0080-\u00ff]/.test(originalName)
    ? Buffer.from(originalName, "latin1").toString("utf8")
    : originalName;
  const base = path.basename(decoded.includes("�") ? originalName : decoded);
  return base.length > 255 ? base.slice(-255) : base;
}

export function saveUploadedFile(buffer: Buffer, originalName: string): StoredFile {
  const dir = resolveUploadDir();
  fs.mkdirSync(dir, { recursive: true });

  const id = crypto.randomUUID();
  const extension = safeExtension(originalName);
  const fileName = `${id}${extension}`;
  const absolutePath = path.join(dir, fileName);

  fs.writeFileSync(absolutePath, buffer);
  return { id, extension, absolutePath };
}

export function getStoredFilePath(fileId: string): string {
  const dir = resolveUploadDir();
  if (!fs.existsSync(dir)) return "";
  // 遍历目录找到匹配 id 的文件（扩展名未知）
  const entries = fs.readdirSync(dir);
  const match = entries.find((name) => name.startsWith(fileId));
  if (!match) return "";
  return path.join(dir, match);
}

export function deleteStoredFile(fileId: string) {
  const filePath = getStoredFilePath(fileId);
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // 忽略删除失败
  }
}

export function deleteStoredFilePath(filePath: string) {
  const uploadDir = resolveUploadDir();
  const resolvedPath = path.resolve(filePath);
  if (resolvedPath !== uploadDir && !resolvedPath.startsWith(`${uploadDir}${path.sep}`)) {
    throw new Error(`拒绝删除上传目录之外的文件：${resolvedPath}`);
  }
  try {
    fs.unlinkSync(resolvedPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

/**
 * Retry files left in the soft-delete queue after a task was removed.
 */
export async function cleanupExpiredFiles(prisma: PrismaClient) {
  const expired = await prisma.file.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, storedPath: true },
  });

  const deletedIds: string[] = [];
  for (const file of expired) {
    try {
      deleteStoredFilePath(file.storedPath);
      deletedIds.push(file.id);
    } catch (error) {
      console.error(`[cleanup] 文件 ${file.id} 删除失败，保留记录等待重试`, error);
    }
  }

  if (deletedIds.length > 0) {
    await prisma.file.deleteMany({
      where: { id: { in: deletedIds } },
    });
  }

  return deletedIds.length;
}

export async function cleanupOrphanedFiles(prisma: PrismaClient) {
  const dir = resolveUploadDir();
  if (!fs.existsSync(dir)) return 0;

  const referenced = await prisma.file.findMany({ select: { storedPath: true } });
  const referencedPaths = new Set(referenced.map((file) => path.resolve(file.storedPath)));
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.resolve(dir, entry.name);
    if (referencedPaths.has(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs >= cutoff) continue;
    deleteStoredFilePath(filePath);
    deleted += 1;
  }

  return deleted;
}
