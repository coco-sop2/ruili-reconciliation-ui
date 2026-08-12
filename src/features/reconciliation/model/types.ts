// 文件说明：集中定义对账任务、金额、上传文件、审核字段等业务类型。
export type ReconciliationStatus =
  | "QUEUED"
  | "PROCESSING"
  | "SUCCEEDED"
  | "NEEDS_REVIEW"
  | "FAILED";

export type Money = {
  currency: "CNY";
  value: string;
};

export type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  extension: string | null;
  uploadedAt: string;
};

export type ReconciliationMetrics = {
  settlementAmount: Money | null;
  erpAmount: Money | null;
  differenceAmount: Money | null;
  totalCount: number | null;
  matchedCount: number | null;
  differenceCount: number | null;
};

export type ReviewItemStatus = "PENDING" | "APPROVED" | "IGNORED";

export type ReconciliationReviewItem = {
  id: string;
  rowLabel: string;
  fieldName: string;
  settlementValue: Money | null;
  erpValue: Money | null;
  differenceAmount: Money | null;
  message: string;
  suggestion: string | null;
  status: ReviewItemStatus;
};

export type ReconciliationTaskSummary = {
  id: string;
  status: ReconciliationStatus;
  periodLabel: string | null;
  settlementFile: UploadedFile;
  erpFile: UploadedFile;
  metrics: ReconciliationMetrics;
  createdAt: string;
  completedAt: string | null;
  createdBy: {
    id: string;
    name: string;
  };
};

export type ReconciliationTaskDetail = ReconciliationTaskSummary & {
  reviewItems: ReconciliationReviewItem[];
  failure: {
    code: string;
    message: string;
  } | null;
};

export type ReconciliationStatistics = {
  month: string;
  totalTasks: number;
  succeededTasks: number;
  needsReviewTasks: number;
  failedTasks: number;
  processingTasks: number;
  autoMatchRate: number;
  monthOverMonthRate: number;
  totalDifferenceAmount: Money;
  trend: Array<{
    label: string;
    taskCount: number;
  }>;
  updatedAt: string;
};

export type ReconciliationProcessLogLevel = "info" | "success" | "error";

export type ReconciliationProcessLog = {
  id: string;
  timestamp: string;
  level: ReconciliationProcessLogLevel;
  message: string;
};

export type ReconciliationProgressListener = (log: ReconciliationProcessLog) => void;

export type CreateReconciliationTaskInput = {
  settlementFile: File;
  erpFile: File;
  apiKey: string;
  agentSelector: {
    name?: string;
    workspace?: string;
  };
  onProgress?: ReconciliationProgressListener;
};

export type ListReconciliationTasksParams = {
  status?: ReconciliationStatus[];
  keyword?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedTasks = {
  items: ReconciliationTaskSummary[];
  page: number;
  pageSize: number;
  total: number;
  facets: {
    total: number;
    byStatus: Record<ReconciliationStatus, number>;
  };
};

export type ApiEnvelope<T> = {
  data: T;
  requestId: string;
};

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
};
