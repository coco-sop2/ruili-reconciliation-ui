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
  uploadedAt: string;
};

export type ReconciliationMetrics = {
  settlementAmount: Money | null;
  differenceAmount: Money | null;
  totalCount: number | null;
  matchedCount: number | null;
  differenceCount: number | null;
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

export type CreateReconciliationTaskInput = {
  settlementFile: File;
  erpFile: File;
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
