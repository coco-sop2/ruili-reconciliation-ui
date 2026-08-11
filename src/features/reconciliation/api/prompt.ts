// 文件说明：根据上传后的文件 URL 生成 CherryStudio 对账 agent 的消息内容。
import { getReconciliationFileMetadata } from "../model/file-rules";
import type { CreateReconciliationTaskInput } from "../model/types";

export type ReconciliationFileUrls = {
  settlementFileUrl: string;
  erpFileUrl: string;
};

export type ReconciliationPromptPayload = {
  source: "ruili-reconciliation-ui";
  action: "start_reconciliation";
  submittedAt: string;
  files: {
    settlementFile: ReturnType<typeof getReconciliationFileMetadata> & { url: string };
    erpFile: ReturnType<typeof getReconciliationFileMetadata> & { url: string };
  };
};

export function createReconciliationPromptPayload(
  input: CreateReconciliationTaskInput,
  fileUrls: ReconciliationFileUrls,
  submittedAt: string,
): ReconciliationPromptPayload {
  return {
    source: "ruili-reconciliation-ui",
    action: "start_reconciliation",
    submittedAt,
    files: {
      settlementFile: {
        ...getReconciliationFileMetadata(input.settlementFile),
        url: fileUrls.settlementFileUrl,
      },
      erpFile: {
        ...getReconciliationFileMetadata(input.erpFile),
        url: fileUrls.erpFileUrl,
      },
    },
  };
}

export function buildReconciliationPrompt(payload: ReconciliationPromptPayload): string {
  const erpUrl = payload.files.erpFile.url;
  const settlementUrl = payload.files.settlementFile.url;

  return `我有一个对账任务：

${erpUrl}
这是 ERP 导出单据

${settlementUrl}
这是结算单

在过程中，面对图片、PDF 等文件，你可以使用 mineru 这个项目 Subagent 获取 Markdown 格式的内容。

请帮我看看是否能够对上账。

当你完成对账后，最后只输出一个合法的 JSON 对象，不要使用 Markdown 代码块，也不要在 JSON 前后输出其他内容。格式如下：

{
  "matched": true,
  "difference": 0.00
}

或者：

{
  "matched": false,
  "difference": 1500.00
}

其中：
- matched：true 表示两方金额一致；false 表示存在差异
- difference：ERP 金额 - 结算单金额，单位为元
- 正数：ERP 多计，结算单少计
- 负数：ERP 少计，结算单多计
- 0：金额一致`;
}
