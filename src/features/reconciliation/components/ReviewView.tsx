// 文件说明：差异处理页面，展示 agent 返回的人工审核字段并支持本地确认状态。
import { useReviewItems } from "../hooks/use-review-items";
import type { ReviewItemStatus } from "../model/types";
import { formatMoney } from "../model/view-model";

const reviewStatusLabels: Record<ReviewItemStatus, string> = {
  PENDING: "待审核",
  APPROVED: "已确认",
  IGNORED: "已忽略",
};

export function ReviewView() {
  const {
    rows,
    reviewStatuses,
    pendingCount,
    reviewedCount,
    loading,
    error,
    setReviewStatus,
  } = useReviewItems();

  return (
    <div className="view-shell review-view">
      <div className="page-intro page-intro--split">
        <div>
          <span className="eyebrow">MANUAL REVIEW</span>
          <h1>差异处理</h1>
          <p>集中查看 agent 标记出的金额差异，逐字段核对结算单与 ERP 的金额。</p>
        </div>
        <div className="review-summary">
          <span>待审核 <strong>{pendingCount}</strong></span>
          <span>已处理 <strong>{reviewedCount}</strong></span>
        </div>
      </div>

      {error && <div className="api-error overview-error" role="alert"><b>审核明细加载失败</b><span>{error}</span></div>}

      <section className="records-section review-section">
        <div className="records-head">
          <div><h2>人工审核明细</h2><span>共 {rows.length} 条字段差异</span></div>
        </div>
        <div className="table-wrap">
          <table className="review-table">
            <thead>
              <tr>
                <th>任务 / 单据</th>
                <th>字段</th>
                <th>结算单金额</th>
                <th>ERP 金额</th>
                <th>差额</th>
                <th>问题说明</th>
                <th>审核状态</th>
                <th aria-label="审核操作" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ task, item }) => {
                const status = reviewStatuses[item.id] ?? item.status;
                return (
                  <tr key={`${task.id}-${item.id}`}>
                    <td><strong>{task.id}</strong><span>{item.rowLabel}</span></td>
                    <td><strong>{item.fieldName}</strong><span>{task.periodLabel ?? "账期待识别"}</span></td>
                    <td className="number-cell">{formatMoney(item.settlementValue)}</td>
                    <td className="number-cell">{formatMoney(item.erpValue)}</td>
                    <td className="number-cell number-cell--issue">{formatMoney(item.differenceAmount)}</td>
                    <td className="review-message"><strong>{item.message}</strong><span>{item.suggestion ?? "请结合原始表格确认"}</span></td>
                    <td><span className={`review-pill review-pill--${status.toLowerCase()}`}>{reviewStatusLabels[status]}</span></td>
                    <td>
                      <div className="review-actions">
                        <button type="button" onClick={() => setReviewStatus(item.id, "APPROVED")}>确认</button>
                        <button type="button" onClick={() => setReviewStatus(item.id, "IGNORED")}>忽略</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {loading && <div className="empty-state"><b>正在读取审核明细</b><span>请稍候</span></div>}
          {!loading && !error && rows.length === 0 && <div className="empty-state"><b>暂无需要人工审核的字段</b><span>agent 返回 NEEDS_REVIEW 和 issues 后会显示在这里</span></div>}
        </div>
      </section>
    </div>
  );
}
