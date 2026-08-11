// 文件说明：先把浏览器中的文件上传到文件服务，再返回 CherryStudio 可访问的文件地址。
import { ReconciliationApiError } from "./error";
import type { ReconciliationProcessLogLevel } from "../model/types";

export type UploadedFileUrls = {
  settlementFileUrl: string;
  erpFileUrl: string;
};

export type UploadProgressCallback = (level: ReconciliationProcessLogLevel, message: string) => void;

type FileUploadConfig = {
  endpointUrl: string;
};

type FileUploadResponse = {
  url?: string;
  fileUrl?: string;
  downloadUrl?: string;
  data?: {
    url?: string;
    fileUrl?: string;
    downloadUrl?: string;
  };
  file?: {
    url?: string;
    fileUrl?: string;
    downloadUrl?: string;
  };
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

function getUploadedFileUrl(payload: FileUploadResponse | null) {
  const url = payload?.url
    ?? payload?.fileUrl
    ?? payload?.downloadUrl
    ?? payload?.data?.url
    ?? payload?.data?.fileUrl
    ?? payload?.data?.downloadUrl
    ?? payload?.file?.url
    ?? payload?.file?.fileUrl
    ?? payload?.file?.downloadUrl;

  if (!url) return null;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function readUploadResponse(response: Response): Promise<FileUploadResponse | null> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as FileUploadResponse;
  } catch {
    return null;
  }
}

export class ReconciliationFileUploader {
  constructor(private readonly config: FileUploadConfig) {}

  async upload(file: File, idempotencyKey: string, role: "settlementFile" | "erpFile", onLog?: UploadProgressCallback) {
    onLog?.("info", `正在上传${role === "settlementFile" ? "结算资料" : "ERP 资料"}：${file.name}（${(file.size / 1024).toFixed(1)} KB）…`);
    const response = await fetch(this.config.endpointUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": file.type || "application/octet-stream",
        "Idempotency-Key": `${idempotencyKey}-${role}`,
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Role": role,
      },
      body: file,
    });
    const payload = await readUploadResponse(response);

    if (!response.ok) {
      onLog?.("error", `上传${role === "settlementFile" ? "结算资料" : "ERP 资料"}失败（HTTP ${response.status}）`);
      throw new ReconciliationApiError(
        payload?.error?.message ?? `文件上传失败（HTTP ${response.status}）`,
        payload?.error?.code ?? "FILE_UPLOAD_FAILED",
        payload?.error?.requestId,
        response.status,
      );
    }

    const url = getUploadedFileUrl(payload);
    if (!url) {
      onLog?.("error", `上传接口未返回可访问的 URL：${file.name}`);
      throw new ReconciliationApiError(
        "文件上传接口没有返回可访问的 URL",
        "FILE_UPLOAD_URL_MISSING",
      );
    }

    onLog?.("success", `${role === "settlementFile" ? "结算资料" : "ERP 资料"}上传完成`);
    return url;
  }

  async uploadBoth(
    input: { settlementFile: File; erpFile: File },
    idempotencyKey: string,
    onLog?: UploadProgressCallback,
  ): Promise<UploadedFileUrls> {
    const [settlementFileUrl, erpFileUrl] = await Promise.all([
      this.upload(input.settlementFile, idempotencyKey, "settlementFile", onLog),
      this.upload(input.erpFile, idempotencyKey, "erpFile", onLog),
    ]);

    return { settlementFileUrl, erpFileUrl };
  }
}
