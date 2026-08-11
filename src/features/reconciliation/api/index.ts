// 文件说明：对账接口统一出口，根据环境变量选择 CherryStudio 接口或禁用态接口。
import { CherryStudioReconciliationApi } from "./cherrystudio-client";
import { DisabledReconciliationApi } from "./disabled-client";
import type { ReconciliationApi } from "./types";
import { localReconciliationUploadPath } from "./local-upload-path";

const reconciliationUploadUrl = (import.meta.env.VITE_RECONCILIATION_UPLOAD_URL || localReconciliationUploadPath).trim();
const cherryStudioBaseUrl = (import.meta.env.VITE_CHERRYSTUDIO_BASE_URL ?? "http://127.0.0.1:24333")
  .trim()
  .replace(/\/$/, "");
const cherryStudioApiKey = (import.meta.env.VITE_CHERRYSTUDIO_API_KEY ?? "").trim();

export const usingDisabledApi = !cherryStudioBaseUrl || !reconciliationUploadUrl || !cherryStudioApiKey;

export const reconciliationApi: ReconciliationApi = !usingDisabledApi
  ? new CherryStudioReconciliationApi({
      baseUrl: cherryStudioBaseUrl,
      uploadUrl: reconciliationUploadUrl,
      apiKey: cherryStudioApiKey,
    })
  : new DisabledReconciliationApi();

export type { ReconciliationApi } from "./types";
export { ReconciliationApiError } from "./error";
