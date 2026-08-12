// 文件说明：开始对账页的文件选择与表单校验逻辑（纯 UI 层）。
// 任务执行与处理日志由 ReconciliationTaskProvider 统一管理，切换页面不丢失。
import { useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { validateReconciliationFile } from "../model/file-rules";

export function useStartReconciliation() {
  const [settlementFile, setSettlementFile] = useState<File | null>(null);
  const [erpFile, setErpFile] = useState<File | null>(null);
  const [agentName, setAgentName] = useState("");
  const [agentWorkspace, setAgentWorkspace] = useState("");
  const [formError, setFormError] = useState("");

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
      setFormError(`${fieldLabel}：${validationError}`);
      event.target.value = "";
      return;
    }

    setFormError("");
    setFile(selectedFile);
  };

  return {
    settlementFile,
    erpFile,
    agentName,
    agentWorkspace,
    formError,
    setAgentName,
    setAgentWorkspace,
    handleSettlementFileChange: createFileChangeHandler(setSettlementFile, "结算资料"),
    handleErpFileChange: createFileChangeHandler(setErpFile, "ERP 资料"),
  };
}
