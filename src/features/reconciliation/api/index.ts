// 文件说明：对账接口统一出口，根据环境变量选择 CherryStudio 接口或禁用态接口。
import { CherryStudioReconciliationApi } from "./cherrystudio-client";
import { DisabledReconciliationApi } from "./disabled-client";
import type { ReconciliationApi } from "./types";

const cherryStudioAgentUrl = (import.meta.env.VITE_CHERRYSTUDIO_AGENT_URL ?? "").trim();
const cherryStudioSkillName = (import.meta.env.VITE_CHERRYSTUDIO_AGENT_SKILL ?? "reconciliation.start").trim();
export const usingDisabledApi = !cherryStudioAgentUrl;

export const reconciliationApi: ReconciliationApi = cherryStudioAgentUrl
  ? new CherryStudioReconciliationApi({
      endpointUrl: cherryStudioAgentUrl,
      skillName: cherryStudioSkillName || "reconciliation.start",
    })
  : new DisabledReconciliationApi();

export type { ReconciliationApi } from "./types";
export { ReconciliationApiError } from "./error";
