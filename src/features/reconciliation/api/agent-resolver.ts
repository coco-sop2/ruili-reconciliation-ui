// 文件说明：按 Agent 名称和/或工作目录查询 CherryStudio Agent，并取得它的唯一 session。
import { ReconciliationApiError } from "./error";
import type { ReconciliationProcessLogLevel } from "../model/types";

export type AgentSelector = {
  name?: string;
  workspace?: string;
};

export type AgentProgressCallback = (level: ReconciliationProcessLogLevel, message: string) => void;

type CherryAgent = {
  id: string;
  name: string;
  accessible_paths?: string[];
};

type CherrySession = {
  id: string;
  agent_id?: string;
  name?: string;
};

type CherryListResponse<T> = {
  data?: T[];
  agents?: T[];
  sessions?: T[];
  total?: number;
};

type AgentResolverConfig = {
  baseUrl: string;
  apiKey: string;
};

function normalizePath(value: string) {
  const slashPath = value.trim().replace(/\\/g, "/");
  const windowsPath = /^[a-zA-Z]:\//.test(slashPath);
  const drive = windowsPath ? slashPath.slice(0, 2) : "";
  const absolute = windowsPath || slashPath.startsWith("/");
  const pathWithoutRoot = windowsPath ? slashPath.slice(2) : slashPath;
  const segments: string[] = [];

  for (const segment of pathWithoutRoot.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const normalized = `${drive}${absolute ? "/" : ""}${segments.join("/")}`.replace(/\/$/, "");
  return windowsPath ? normalized.toLowerCase() : normalized;
}

async function readJson<T>(response: Response, failureMessage: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new ReconciliationApiError(
      `${failureMessage}（HTTP ${response.status}）：${text.slice(0, 300)}`,
      "CHERRYSTUDIO_LOOKUP_FAILED",
      undefined,
      response.status,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ReconciliationApiError(
      `${failureMessage}：接口没有返回合法 JSON`,
      "CHERRYSTUDIO_LOOKUP_INVALID_RESPONSE",
    );
  }
}

function pageItems<T>(page: CherryListResponse<T>, keys: Array<keyof CherryListResponse<T>>) {
  for (const key of keys) {
    const value = page[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

async function listAll<T>(
  urlForPage: (offset: number) => string,
  config: AgentResolverConfig,
  itemKeys: Array<keyof CherryListResponse<T>>,
  failureMessage: string,
) {
  const items: T[] = [];

  for (let offset = 0; ; offset += 100) {
    const response = await fetch(urlForPage(offset), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    const page = await readJson<CherryListResponse<T>>(response, failureMessage);
    const pageData = pageItems(page, itemKeys);
    items.push(...pageData);

    if (pageData.length === 0 || items.length >= (page.total ?? items.length)) break;
  }

  return items;
}

// 为 Agent 新建一个 session，返回该 session。每次发起对账都会创建一个新 session。
async function createCherryAgentSession(
  config: AgentResolverConfig,
  agent: CherryAgent,
): Promise<CherrySession> {
  const response = await fetch(`${config.baseUrl}/v1/agents/${encodeURIComponent(agent.id)}/sessions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: buildReconciliationSessionName() }),
  });
  const payload = await readJson<CherrySession | CherryListResponse<CherrySession>>(
    response,
    "创建 CherryStudio session 失败",
  );
  const session = Array.isArray((payload as CherryListResponse<CherrySession>).sessions)
    ? (payload as CherryListResponse<CherrySession>).sessions![0]
    : (payload as CherrySession);

  if (!session?.id) {
    throw new ReconciliationApiError(
      "CherryStudio 没有返回新 session 的 ID",
      "CHERRYSTUDIO_SESSION_CREATE_FAILED",
    );
  }
  return session;
}

function buildReconciliationSessionName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `对账-${stamp}`;
}

export async function findCherryAgentSession(
  config: AgentResolverConfig,
  selector: AgentSelector,
  onLog?: AgentProgressCallback,
) {
  const name = selector.name?.trim();
  const workspace = selector.workspace?.trim();
  if (!name && !workspace) {
    throw new ReconciliationApiError(
      "必须填写 Agent 名称或工作目录",
      "CHERRYSTUDIO_AGENT_SELECTOR_REQUIRED",
    );
  }

  onLog?.("info", `正在查询 CherryStudio Agent：${name ? `名称「${name}」` : ""}${name && workspace ? "、" : ""}${workspace ? `工作目录「${workspace}」` : ""}`);

  const agents = await listAll<CherryAgent>(
    (offset) => `${config.baseUrl}/v1/agents?limit=100&offset=${offset}`,
    config,
    ["data", "agents"],
    "获取 CherryStudio Agent 列表失败",
  );
  const normalizedWorkspace = workspace ? normalizePath(workspace) : undefined;
  const matches = agents.filter((agent) => {
    const nameMatches = !name || agent.name === name;
    const workspaceMatches = !normalizedWorkspace || agent.accessible_paths?.some(
      (agentPath) => normalizePath(agentPath) === normalizedWorkspace,
    );
    return nameMatches && Boolean(workspaceMatches);
  });

  if (matches.length === 0) {
    throw new ReconciliationApiError(
      `没有找到匹配的 Agent：${JSON.stringify({ name, workspace })}`,
      "CHERRYSTUDIO_AGENT_NOT_FOUND",
    );
  }
  if (matches.length > 1) {
    throw new ReconciliationApiError(
      `找到多个匹配 Agent，请同时填写名称和工作目录：${matches.map((agent) => agent.name).join("、")}`,
      "CHERRYSTUDIO_AGENT_AMBIGUOUS",
    );
  }

  const agent = matches[0];
  onLog?.("success", `已匹配 Agent：「${agent.name}」（${agent.id}）`);
  onLog?.("info", "正在创建本次对账会话…");
  const session = await createCherryAgentSession(config, agent);
  onLog?.("success", `会话已创建：${session.id}`);
  return { agent, session };
}
