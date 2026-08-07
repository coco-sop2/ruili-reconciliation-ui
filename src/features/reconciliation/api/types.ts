// 文件说明：定义前端统一使用的对账 API 方法形状。
import type {
  CreateReconciliationTaskInput,
  ListReconciliationTasksParams,
  PaginatedTasks,
  ReconciliationStatistics,
  ReconciliationTaskDetail,
  ReconciliationTaskSummary,
} from "../model/types";

export interface ReconciliationApi {
  createTask(input: CreateReconciliationTaskInput): Promise<ReconciliationTaskSummary>;
  listTasks(params?: ListReconciliationTasksParams): Promise<PaginatedTasks>;
  getTask(taskId: string): Promise<ReconciliationTaskDetail>;
  getStatistics(month?: string): Promise<ReconciliationStatistics>;
}
