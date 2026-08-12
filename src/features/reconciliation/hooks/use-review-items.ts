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
  const [errorTitle, setErrorTitle] = useState("");
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadReviewItems() {
      try {
        setLoading(true);
        setError("");
        setErrorTitle("");
        const summaries = [];
        let page = 1;
        let total = 0;
        do {
          const result = await reconciliationApi.listTasks({
            status: ["NEEDS_REVIEW", "REVIEWED"],
            page,
            pageSize: 100,
          });
          summaries.push(...result.items);
          total = result.total;
          page += 1;
        } while (summaries.length < total);
        const details = await Promise.all(summaries.map((task) => reconciliationApi.getTask(task.id)));
        if (active) setTasks(details.filter((task) => task.reviewItems.length > 0));
      } catch (requestError) {
        if (active) {
          setErrorTitle("审核明细加载失败");
          setError(requestErrorMessage(requestError, "审核明细加载失败"));
        }
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

  const setReviewStatus = async (taskId: string, itemId: string, status: ReviewItemStatus) => {
    const previous = reviewStatuses[itemId];
    setReviewStatuses((current) => ({ ...current, [itemId]: status }));
    setUpdatingItemId(itemId);
    setError("");
    setErrorTitle("");
    try {
      const task = await reconciliationApi.updateReviewItem(taskId, itemId, status);
      setTasks((current) => current
        .map((item) => item.id === taskId ? task : item));
      setReviewStatuses((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
    } catch (requestError) {
      setReviewStatuses((current) => {
        const next = { ...current };
        if (previous) next[itemId] = previous;
        else delete next[itemId];
        return next;
      });
      setErrorTitle("审核状态保存失败");
      setError(requestErrorMessage(requestError, "审核状态保存失败"));
    } finally {
      setUpdatingItemId(null);
    }
  };

  return {
    rows,
    reviewStatuses,
    pendingCount,
    reviewedCount,
    loading,
    error,
    errorTitle,
    updatingItemId,
    setReviewStatus,
  };
}
