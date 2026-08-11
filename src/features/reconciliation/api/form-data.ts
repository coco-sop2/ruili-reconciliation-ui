// 文件说明：把用户上传的两份文件和调用上下文打包成 CherryStudio 需要的 FormData。
import { getReconciliationFileMetadata } from "../model/file-rules";
import type { CreateReconciliationTaskInput } from "../model/types";

type CreateReconciliationFormDataOptions = {
  skillName: string;
  submittedAt: string;
};

export function createReconciliationFormData(
  input: CreateReconciliationTaskInput,
  options: CreateReconciliationFormDataOptions,
) {
  const formData = new FormData();

  formData.append("action", "start_reconciliation");
  formData.append("skill", options.skillName);
  formData.append(
    "payload",
    JSON.stringify({
      source: "ruili-reconciliation-ui",
      action: "start_reconciliation",
      skill: options.skillName,
      submittedAt: options.submittedAt,
      resultMode: "placeholder",
      files: {
        settlementFile: getReconciliationFileMetadata(input.settlementFile),
        erpFile: getReconciliationFileMetadata(input.erpFile),
      },
    }),
  );
  formData.append("settlementFile", input.settlementFile);
  formData.append("erpFile", input.erpFile);

  return formData;
}
