// 文件说明：封装差异处理页的审核任务加载、审核行展开和本地审核状态。
import { useEffect, useMemo, useState } from "react";
import { reconciliationApi } from "../api";
import type {
  ReconciliationReviewItem,
  ReconciliationTaskDetail,
  ReviewItemStatus,
} from "../model/types";
import { requestErrorMessage } from "../model/view-model";

export type ReviewRow = {
  task: ReconciliationTaskDetail;
  item: ReconciliationReviewItem;
};

export function useReviewItems() {
  const [tasks, setTasks] = useState<ReconciliationTaskDetail[]>([]);
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewItemStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadReviewItems() {
      try {
        setLoading(true);
        setError("");
        const result = await reconciliationApi.listTasks({
          status: ["NEEDS_REVIEW"],
          page: 1,
          pageSize: 100,
        });
        const details = await Promise.all(result.items.map((task) => reconciliationApi.getTask(task.id)));
        if (active) setTasks(details.filter((task) => task.reviewItems.length > 0));
      } catch (requestError) {
        if (active) setError(requestErrorMessage(requestError, "审核明细加载失败"));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadReviewItems();
    return () => { active = false; };
  }, []);

  const rows = useMemo<ReviewRow[]>(
    () => tasks.flatMap((task) => task.reviewItems.map((item) => ({ task, item }))),
    [tasks],
  );
  const pendingCount = rows.filter(({ item }) => (reviewStatuses[item.id] ?? item.status) === "PENDING").length;
  const reviewedCount = rows.length - pendingCount;

  const setReviewStatus = (itemId: string, status: ReviewItemStatus) => {
    setReviewStatuses((current) => ({ ...current, [itemId]: status }));
  };

  return {
    rows,
    reviewStatuses,
    pendingCount,
    reviewedCount,
    loading,
    error,
    setReviewStatus,
  };
}
