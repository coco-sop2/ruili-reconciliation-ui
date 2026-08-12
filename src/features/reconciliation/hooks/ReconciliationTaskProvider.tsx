// 文件说明：对账任务执行与处理日志的全局状态提供者。
// 挂在 App 根部，任务执行与日志状态常驻，切换页面不丢失。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { reconciliationApi } from "../api";
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
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  startReconciliation: (input: StartReconciliationInput) => Promise<void>;
};

const ReconciliationTaskContext = createContext<ReconciliationTaskContextValue | null>(null);

function redactApiKey(message: string, apiKey: string) {
  return message.replaceAll(apiKey, "••••••");
}

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
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<ReconciliationProcessLog[]>([]);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const logIdRef = useRef(0);
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

  const startReconciliation = useCallback(async (input: StartReconciliationInput) => {
    if (running) return;
    if (!input.settlementFile || !input.erpFile) return;
    if (!input.agentName.trim() && !input.agentWorkspace.trim()) {
      setError("请至少填写 Agent 名称或工作目录");
      return;
    }
    const requestApiKey = apiKey.trim();
    if (!requestApiKey) {
      setError("请填写 API Key");
      return;
    }
    const validationError = validateReconciliationFile(input.settlementFile) ?? validateReconciliationFile(input.erpFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    setRunning(true);
    setError("");
    const appendSafeLog = (level: ReconciliationProcessLog["level"], message: string) => {
      appendLog(level, redactApiKey(message, requestApiKey));
    };
    appendSafeLog("info", "点击「开始对账」，任务已提交");
    try {
      const task = await reconciliationApi.createTask({
        settlementFile: input.settlementFile,
        erpFile: input.erpFile,
        apiKey: requestApiKey,
        agentSelector: {
          name: input.agentName.trim() || undefined,
          workspace: input.agentWorkspace.trim() || undefined,
        },
        onProgress: (log) => appendSafeLog(log.level, log.message),
      });
      setRunning(false);
      onCompleteRef.current(task);
    } catch (requestError) {
      const message = redactApiKey(
        requestErrorMessage(requestError, "创建对账任务失败，请稍后重试"),
        requestApiKey,
      );
      appendSafeLog("error", message);
      setError(message);
      setRunning(false);
    }
  }, [running, apiKey, appendLog]);

  return (
    <ReconciliationTaskContext.Provider value={{ running, logs, error, apiKey, setApiKey, startReconciliation }}>
      {children}
    </ReconciliationTaskContext.Provider>
  );
}
