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
  runtime?: {
    taskWorkDir: string;
    settlementFilePath: string;
    erpFilePath: string;
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
  const params = payload.runtime ?? {
    taskWorkDir: ".runtime/tasks/current",
    settlementFilePath: settlementUrl,
    erpFilePath: erpUrl,
  };

  return `我有一个对账任务：

${erpUrl}
这是 ERP 导出单据

${settlementUrl}
这是结算单

本次任务唯一允许使用的临时工作目录：
${params.taskWorkDir}

如需下载文件、拆分 PDF、渲染图片、执行 OCR 或生成 Markdown/JSON，请只写入上述目录。不要在项目根目录、源码目录或输入文件旁创建文件；不要复制原始文件，优先直接读取以下本地路径：
- ERP：${params.erpFilePath}
- 结算单：${params.settlementFilePath}

在过程中，面对图片、PDF 等文件，你可以使用 mineru 这个项目 Subagent 获取 Markdown 格式的内容。

请帮我看看是否能够对上账。

当你完成对账后，最后只输出一个合法的 JSON 对象，不要使用 Markdown 代码块，也不要在 JSON 前后输出其他内容。格式例子如下：

{
  "matched": true,
  "difference": 0.00,
  "issues": "",
  "period": "XXXX-XX",
  "name": "商城名称A"
}

或者：

{
  "matched": false,
  "difference": 1500.00,
  "issues": "DRP 中有 16% 和 17% 两档扣点，而结算单全部按 17% 计算。可能存在退款记录未同步。",
  "period": "XXXX-XX",
  "name": "商城名称A"
}

其中：
- matched：true 表示两方金额一致；false 表示存在差异
- difference：ERP 金额 - 结算单金额，单位为元
  - difference正数：ERP 多计，结算单少计
  - difference负数：ERP 少计，结算单多计
  - difference为0：金额一致
- issues: 字符串，列出造成差异的疑似原因；如果金额一致或未发现疑似原因，输出""
- period: 字符串，对账月份，格式必须为 "YYYY-MM"
- name: 字符串，drp表单中的商城名称`

}
