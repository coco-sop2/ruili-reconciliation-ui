// 文件说明：封装开始对账页的文件选择、文件校验和提交 CherryStudio 逻辑。
import { useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { reconciliationApi } from "../api";
import { validateReconciliationFile } from "../model/file-rules";
import type { ReconciliationTaskSummary } from "../model/types";
import { requestErrorMessage } from "../model/view-model";

type UseStartReconciliationOptions = {
  onComplete: (task: ReconciliationTaskSummary) => void;
};

export function useStartReconciliation({ onComplete }: UseStartReconciliationOptions) {
  const [settlementFile, setSettlementFile] = useState<File | null>(null);
  const [erpFile, setErpFile] = useState<File | null>(null);
  const [agentName, setAgentName] = useState(
    (import.meta.env.VITE_CHERRYSTUDIO_DEFAULT_AGENT_NAME ?? "").trim(),
  );
  const [agentWorkspace, setAgentWorkspace] = useState(
    (import.meta.env.VITE_CHERRYSTUDIO_DEFAULT_AGENT_WORKSPACE ?? "").trim(),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const createFileChangeHandler = (
    setFile: Dispatch<SetStateAction<File | null>>,
    fieldLabel: string,
  ) => (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    if (!selectedFile) {
      setFile(null);
      return;
    }

    const validationError = validateReconciliationFile(selectedFile);
    if (validationError) {
      setFile(null);
      setError(`${fieldLabel}：${validationError}`);
      event.target.value = "";
      return;
    }

    setError("");
    setFile(selectedFile);
  };

  const startReconciliation = async () => {
    if (!settlementFile || !erpFile || running) return;
    if (!agentName.trim() && !agentWorkspace.trim()) {
      setError("请至少填写 Agent 名称或工作目录");
      return;
    }

    const validationError = validateReconciliationFile(settlementFile) ?? validateReconciliationFile(erpFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    setRunning(true);
    setError("");
    try {
      const task = await reconciliationApi.createTask({
        settlementFile,
        erpFile,
        agentSelector: {
          name: agentName.trim() || undefined,
          workspace: agentWorkspace.trim() || undefined,
        },
      });
      onComplete(task);
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "创建对账任务失败，请稍后重试"));
      setRunning(false);
    }
  };

  return {
    settlementFile,
    erpFile,
    agentName,
    agentWorkspace,
    running,
    error,
    setAgentName,
    setAgentWorkspace,
    handleSettlementFileChange: createFileChangeHandler(setSettlementFile, "结算资料"),
    handleErpFileChange: createFileChangeHandler(setErpFile, "ERP 资料"),
    startReconciliation,
  };
}
