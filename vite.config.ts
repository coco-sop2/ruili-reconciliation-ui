// 文件说明：Vite 开发服务器和生产构建配置。
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { Plugin } from "vite";

const localUploadPath = "/api/reconciliation/upload";
const localFilePath = "/api/reconciliation/files/";
const maxUploadBytes = 20 * 1024 * 1024;

function localReconciliationUploadPlugin(): Plugin {
  const files = new Map<string, { absolutePath: string; contentType: string; name: string }>();
  const uploadDirectory = path.join(os.tmpdir(), "billcompare-vite-uploads");

  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "POST" && requestUrl.pathname === localUploadPath) {
      const contentLength = Number(request.headers["content-length"] ?? 0);
      if (contentLength > maxUploadBytes) {
        response.statusCode = 413;
        response.end(JSON.stringify({ error: { message: "单个文件不能超过 20 MB" } }));
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > maxUploadBytes) {
          response.statusCode = 413;
          response.end(JSON.stringify({ error: { message: "单个文件不能超过 20 MB" } }));
          return;
        }
        chunks.push(buffer);
      }

      const encodedName = request.headers["x-file-name"];
      const decodedName = typeof encodedName === "string" ? decodeURIComponent(encodedName) : "upload.bin";
      const extension = path.extname(decodedName).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12);
      const id = crypto.randomUUID();
      const absolutePath = path.join(uploadDirectory, `${id}${extension}`);
      await mkdir(uploadDirectory, { recursive: true });
      await writeFile(absolutePath, Buffer.concat(chunks));

      files.set(id, {
        absolutePath,
        contentType: request.headers["content-type"] || "application/octet-stream",
        name: decodedName,
      });

      const hostHeader = request.headers.host;
      const safeHost = typeof hostHeader === "string" && /^[a-zA-Z0-9.:[\]-]+$/.test(hostHeader)
        ? hostHeader
        : "127.0.0.1:3333";
      const fileUrl = `http://${safeHost}${localFilePath}${id}/${encodeURIComponent(decodedName)}`;
      response.statusCode = 201;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ url: fileUrl }));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname.startsWith(localFilePath)) {
      const id = requestUrl.pathname.slice(localFilePath.length).split("/")[0];
      const file = files.get(id);
      if (!file) {
        response.statusCode = 404;
        response.end("File not found");
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", file.contentType);
      response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      createReadStream(file.absolutePath).pipe(response);
      return;
    }

    next();
  };

  return {
    name: "local-reconciliation-upload",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void middleware(request, response, next).catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        void middleware(request, response, next).catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localReconciliationUploadPlugin()],
  server: {
    host: "0.0.0.0",
    port: 3333,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
