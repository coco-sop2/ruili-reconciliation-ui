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
  canStop: boolean;
  stopping: boolean;
  logs: ReconciliationProcessLog[];
  error: string;
  startReconciliation: (input: StartReconciliationInput) => Promise<void>;
  stopReconciliation: () => Promise<void>;
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
    id: "local:1",
    timestamp: new Date().toISOString(),
    level: "info",
    message: `正在恢复任务 ${restoredTaskId} 的处理进度…`,
  }] : []);
  const [error, setError] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(restoredTaskId);
  const [stopping, setStopping] = useState(false);
  const logIdRef = useRef(restoredTaskId ? 1 : 0);
  const activeTaskIdRef = useRef<string | null>(restoredTaskId);
  const restoreStartedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const appendLog = useCallback((level: ReconciliationProcessLog["level"], message: string) => {
    const log: ReconciliationProcessLog = {
      id: `local:${++logIdRef.current}`,
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    setLogs((prev) => [...prev, log]);
  }, []);

  const upsertServerLogs = useCallback((serverLogs: ReconciliationProcessLog[] | undefined) => {
    if (!serverLogs?.length) return;
    setLogs((previous) => {
      const next = [...previous];
      for (const log of serverLogs) {
        const index = next.findIndex((item) => item.id === log.id);
        if (index >= 0) next[index] = { ...log, timestamp: next[index].timestamp };
        else next.push(log);
      }
      return next;
    });
  }, []);

  const monitorTask = useCallback(async (taskId: string) => {
    const deadline = Date.now() + pollTimeoutMs;
    let current = await getTaskWithRetry(taskId, deadline, appendLog);

    while (current.status === "QUEUED" || current.status === "PROCESSING") {
      upsertServerLogs(current.progressLogs);
      if (Date.now() >= deadline) throw new Error("对账处理超时，请在总览中查看任务状态");
      await wait(pollIntervalMs);
      current = await getTaskWithRetry(taskId, deadline, appendLog);
    }

    upsertServerLogs(current.progressLogs);
    const ownsTask = activeTaskIdRef.current === taskId;
    if (ownsTask) {
      activeTaskIdRef.current = null;
      window.localStorage.removeItem(activeTaskStorageKey);
      setActiveTaskId(null);
    }
    if (current.status === "FAILED") {
      throw new Error(current.failure?.message || "Agent 对账失败");
    }
    if (current.status === "CANCELLED") {
      if (ownsTask) setRunning(false);
      return;
    }
    if (ownsTask) {
      setRunning(false);
      onCompleteRef.current(current);
    }
  }, [appendLog, upsertServerLogs]);

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
    const agentName = input.agentName.trim();
    if (!agentName) {
      setError("请填写 Agent 名称");
      return;
    }

    setRunning(true);
    setError("");
    setLogs([]);
    logIdRef.current = 0;
    appendLog("info", "点击「开始对账」，任务已提交");
    try {
      const task = await reconciliationApi.createTask({
        settlementFile: input.settlementFile,
        erpFile: input.erpFile,
        agentSelector: {
          name: agentName,
          workspace: input.agentWorkspace.trim() || undefined,
        },
        onProgress: (log) => upsertServerLogs([log]),
      });
      activeTaskIdRef.current = task.id;
      setActiveTaskId(task.id);
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
  }, [running, appendLog, monitorTask, upsertServerLogs]);

  const stopReconciliation = useCallback(async () => {
    const taskId = activeTaskId ?? window.localStorage.getItem(activeTaskStorageKey);
    if (!taskId || stopping) return;
    setStopping(true);
    setError("");
    appendLog("info", "正在停止对账任务…");
    try {
      await reconciliationApi.stopTask(taskId);
      activeTaskIdRef.current = null;
      window.localStorage.removeItem(activeTaskStorageKey);
      setActiveTaskId(null);
      setRunning(false);
      appendLog("success", "对账任务已停止");
    } catch (requestError) {
      const message = requestErrorMessage(requestError, "停止对账任务失败");
      appendLog("error", message);
      setError(message);
    } finally {
      setStopping(false);
    }
  }, [activeTaskId, appendLog, stopping]);

  return (
    <ReconciliationTaskContext.Provider value={{
      running,
      canStop: Boolean(activeTaskId),
      stopping,
      logs,
      error,
      startReconciliation,
      stopReconciliation,
    }}>
      {children}
    </ReconciliationTaskContext.Provider>
  );
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
