// 文件说明：对账任务执行与处理日志的全局状态提供者。
// 挂在 App 根部，任务执行与日志状态常驻，切换页面不丢失。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { reconciliationApi, ReconciliationApiError } from "../api";
import { validateReconciliationFile } from "../model/file-rules";
import type { ReconciliationProcessLog, ReconciliationTaskSummary } from "../model/types";
import { requestErrorMessage } from "../model/view-model";

export type StartReconciliationInput = {
  settlementFile: File;
  erpFile: File;
  agentName: string;
  agentWorkspace: string;
};

type ReconciliationTaskContextValue = {
  running: boolean;
  logs: ReconciliationProcessLog[];
  error: string;
  startReconciliation: (input: StartReconciliationInput) => Promise<void>;
};

const ReconciliationTaskContext = createContext<ReconciliationTaskContextValue | null>(null);
const pollIntervalMs = 1_500;
const pollTimeoutMs = 20 * 60 * 1000;
const maxConsecutivePollFailures = 8;
const activeTaskStorageKey = "billcompare.activeTaskId";

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function useReconciliationTask(): ReconciliationTaskContextValue {
  const value = useContext(ReconciliationTaskContext);
  if (!value) throw new Error("useReconciliationTask 必须在 ReconciliationTaskProvider 内使用");
  return value;
}

type ReconciliationTaskProviderProps = {
  onComplete: (task: ReconciliationTaskSummary) => void;
  children: ReactNode;
};

export function ReconciliationTaskProvider({ onComplete, children }: ReconciliationTaskProviderProps) {
  const [restoredTaskId] = useState(() => window.localStorage.getItem(activeTaskStorageKey));
  const [running, setRunning] = useState(() => Boolean(restoredTaskId));
  const [logs, setLogs] = useState<ReconciliationProcessLog[]>(() => restoredTaskId ? [{
    id: "1",
    timestamp: new Date().toISOString(),
    level: "info",
    message: `正在恢复任务 ${restoredTaskId} 的处理进度…`,
  }] : []);
  const [error, setError] = useState("");
  const logIdRef = useRef(restoredTaskId ? 1 : 0);
  const seenServerLogIds = useRef(new Set<string>());
  const restoreStartedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const appendLog = useCallback((level: ReconciliationProcessLog["level"], message: string) => {
    const log: ReconciliationProcessLog = {
      id: String(++logIdRef.current),
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    setLogs((prev) => [...prev, log]);
  }, []);

  const monitorTask = useCallback(async (taskId: string) => {
    const deadline = Date.now() + pollTimeoutMs;
    let current = await getTaskWithRetry(taskId, deadline, appendLog);

    while (current.status === "QUEUED" || current.status === "PROCESSING") {
      appendServerLogs(current.progressLogs, seenServerLogIds.current, appendLog);
      if (Date.now() >= deadline) throw new Error("对账处理超时，请在总览中查看任务状态");
      await wait(pollIntervalMs);
      current = await getTaskWithRetry(taskId, deadline, appendLog);
    }

    appendServerLogs(current.progressLogs, seenServerLogIds.current, appendLog);
    window.localStorage.removeItem(activeTaskStorageKey);
    if (current.status === "FAILED") {
      throw new Error(current.failure?.message || "Agent 对账失败");
    }
    setRunning(false);
    onCompleteRef.current(current);
  }, [appendLog]);

  useEffect(() => {
    if (!restoredTaskId || restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    void monitorTask(restoredTaskId).catch((requestError) => {
      if (requestError instanceof ReconciliationApiError && requestError.status === 404) {
        window.localStorage.removeItem(activeTaskStorageKey);
      }
      const message = requestErrorMessage(requestError, "恢复对账任务失败");
      appendLog("error", message);
      setError(message);
      setRunning(false);
    });
  }, [appendLog, monitorTask, restoredTaskId]);

  const startReconciliation = useCallback(async (input: StartReconciliationInput) => {
    if (running) return;
    if (!input.settlementFile || !input.erpFile) return;
    const validationError = validateReconciliationFile(input.settlementFile) ?? validateReconciliationFile(input.erpFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    setRunning(true);
    setError("");
    setLogs([]);
    logIdRef.current = 0;
    seenServerLogIds.current.clear();
    appendLog("info", "点击「开始对账」，任务已提交");
    try {
      const task = await reconciliationApi.createTask({
        settlementFile: input.settlementFile,
        erpFile: input.erpFile,
        agentSelector: {
          name: input.agentName.trim() || undefined,
          workspace: input.agentWorkspace.trim() || undefined,
        },
        onProgress: (log) => {
          seenServerLogIds.current.add(log.id);
          appendLog(log.level, log.message);
        },
      });
      window.localStorage.setItem(activeTaskStorageKey, task.id);
      await monitorTask(task.id);
    } catch (requestError) {
      if (requestError instanceof ReconciliationApiError && requestError.status === 404) {
        window.localStorage.removeItem(activeTaskStorageKey);
      }
      const message = requestErrorMessage(requestError, "创建对账任务失败，请稍后重试");
      appendLog("error", message);
      setError(message);
      setRunning(false);
    }
  }, [running, appendLog, monitorTask]);

  return (
    <ReconciliationTaskContext.Provider value={{ running, logs, error, startReconciliation }}>
      {children}
    </ReconciliationTaskContext.Provider>
  );
}

function appendServerLogs(
  logs: ReconciliationProcessLog[] | undefined,
  seenIds: Set<string>,
  appendLog: (level: ReconciliationProcessLog["level"], message: string) => void,
) {
  for (const log of logs ?? []) {
    if (seenIds.has(log.id)) continue;
    seenIds.add(log.id);
    appendLog(log.level, log.message);
  }
}

async function getTaskWithRetry(
  taskId: string,
  deadline: number,
  appendLog: (level: ReconciliationProcessLog["level"], message: string) => void,
) {
  let failureCount = 0;
  while (true) {
    try {
      const task = await reconciliationApi.getTask(taskId);
      if (failureCount > 0) appendLog("success", "已重新连接后端，继续跟踪任务");
      return task;
    } catch (error) {
      failureCount += 1;
      if (error instanceof ReconciliationApiError && error.status && error.status < 500) throw error;
      if (failureCount === 1) appendLog("info", "后端连接暂时中断，正在自动重连…");
      if (failureCount >= maxConsecutivePollFailures || Date.now() >= deadline) throw error;
      await wait(Math.min(1_000 * 2 ** (failureCount - 1), 8_000));
    }
  }
}
