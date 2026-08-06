"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReconciliationApiError, reconciliationApi, usingMockApi } from "../lib/reconciliation-api";
import type {
  Money,
  ReconciliationStatistics,
  ReconciliationStatus,
  ReconciliationTaskSummary,
} from "../lib/reconciliation-types";

type View = "start" | "overview";
type DisplayStatus = "success" | "issue" | "failed" | "processing";
type Filter = "all" | DisplayStatus;

type ReconciliationView = {
  id: string;
  period: string;
  settlement: string;
  erp: string;
  amount: string;
  matched: string;
  variance: string;
  status: DisplayStatus;
  time: string;
  owner: string;
  failure?: string | null;
};

const statusLabels: Record<DisplayStatus, string> = {
  success: "对账成功",
  issue: "存在差异",
  failed: "对账失败",
  processing: "对账中",
};

const statusFilters: Record<Exclude<Filter, "all">, ReconciliationStatus[]> = {
  success: ["SUCCEEDED"],
  issue: ["NEEDS_REVIEW"],
  failed: ["FAILED"],
  processing: ["QUEUED", "PROCESSING"],
};

function displayStatus(status: ReconciliationStatus): DisplayStatus {
  if (status === "SUCCEEDED") return "success";
  if (status === "NEEDS_REVIEW") return "issue";
  if (status === "FAILED") return "failed";
  return "processing";
}

function formatMoney(value: Money | null, pendingLabel = "—") {
  if (!value) return pendingLabel;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: 2,
  }).format(Number(value.value));
}

function formatTaskTime(value: string) {
  const date = new Date(value);
  if (Date.now() - date.getTime() < 120_000) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace("/", "月").replace(",", "日");
}

function toViewModel(task: ReconciliationTaskSummary): ReconciliationView {
  const isPending = task.status === "QUEUED" || task.status === "PROCESSING";
  const total = task.metrics.totalCount;
  const matched = task.metrics.matchedCount;
  return {
    id: task.id,
    period: task.periodLabel ?? "账期待识别",
    settlement: task.settlementFile.name,
    erp: task.erpFile.name,
    amount: formatMoney(task.metrics.settlementAmount, isPending ? "待计算" : "—"),
    matched: total === null || matched === null ? (isPending ? "正在解析" : "—") : `${matched.toLocaleString()} / ${total.toLocaleString()}`,
    variance: formatMoney(task.metrics.differenceAmount),
    status: displayStatus(task.status),
    time: formatTaskTime(task.createdAt),
    owner: task.createdBy.name,
  };
}

function requestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ReconciliationApiError) {
    return `${error.message}${error.requestId ? `（请求编号：${error.requestId}）` : ""}`;
  }
  return error instanceof Error ? error.message : fallback;
}

function FileCard({
  eyebrow,
  title,
  description,
  file,
  accept,
  onChange,
  onDemo,
}: {
  eyebrow: string;
  title: string;
  description: string;
  file: File | null;
  accept: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDemo: () => void;
}) {
  return (
    <section className={`file-card ${file ? "file-card--ready" : ""}`}>
      <div className="file-card__head">
        <span className="step-index">{eyebrow}</span>
        <span className="file-state">{file ? "已就绪" : "等待导入"}</span>
      </div>
      <div className="file-icon" aria-hidden="true">{file ? "✓" : "XLS"}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {file ? (
        <div className="selected-file">
          <div>
            <strong>{file.name}</strong>
            <span>{(file.size / 1024 / 1024).toFixed(2)} MB · Excel 工作簿</span>
          </div>
          <label className="text-button">
            更换文件
            <input type="file" accept={accept} onChange={onChange} />
          </label>
        </div>
      ) : (
        <div className="file-actions">
          <label className="outline-button">
            <span aria-hidden="true">＋</span> 选择文件
            <input type="file" accept={accept} onChange={onChange} />
          </label>
          <button type="button" className="demo-button" onClick={onDemo}>载入示例</button>
        </div>
      )}
      <span className="file-hint">支持 .xlsx / .xls，单个文件不超过 20 MB</span>
    </section>
  );
}

function StartView({ onComplete }: { onComplete: (task: ReconciliationTaskSummary) => void }) {
  const [settlementFile, setSettlementFile] = useState<File | null>(null);
  const [erpFile, setErpFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const demoFile = (name: string, size: number) =>
    new File([new Uint8Array(size)], name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

  const startReconciliation = async () => {
    if (!settlementFile || !erpFile || running) return;
    setRunning(true);
    setError("");
    try {
      const task = await reconciliationApi.createTask({ settlementFile, erpFile });
      onComplete(task);
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "创建对账任务失败，请稍后重试"));
      setRunning(false);
    }
  };

  return (
    <div className="view-shell start-view">
      <div className="page-intro page-intro--split">
        <div>
          <span className="eyebrow">NEW RECONCILIATION</span>
          <h1>发起一笔新对账</h1>
          <p>分别导入渠道结算单与 ERP 明细，后端将完成字段识别、规则匹配与结果计算。</p>
        </div>
        <div className="security-note">
          <span aria-hidden="true">⌁</span>
          <div>
            <strong>文件提交后由服务端处理</strong>
            <small>前端不解析、不保存，也不执行任何金额计算</small>
          </div>
        </div>
      </div>

      <div className="flow-strip" aria-label="对账步骤">
        <div className="flow-item flow-item--active"><b>01</b><span>导入结算单</span></div>
        <i />
        <div className={settlementFile ? "flow-item flow-item--active" : "flow-item"}><b>02</b><span>导入 ERP 表单</span></div>
        <i />
        <div className={settlementFile && erpFile ? "flow-item flow-item--active" : "flow-item"}><b>03</b><span>提交后端任务</span></div>
      </div>

      <div className="file-grid">
        <FileCard
          eyebrow="01"
          title="导入结算单"
          description="渠道、平台或门店提供的结算明细"
          file={settlementFile}
          accept=".xlsx,.xls"
          onChange={(event) => setSettlementFile(event.target.files?.[0] ?? null)}
          onDemo={() => setSettlementFile(demoFile("华东渠道结算单_202607.xlsx", 785000))}
        />
        <FileCard
          eyebrow="02"
          title="导入 ERP 表单"
          description="从 ERP 导出的销售或收款明细"
          file={erpFile}
          accept=".xlsx,.xls"
          onChange={(event) => setErpFile(event.target.files?.[0] ?? null)}
          onDemo={() => setErpFile(demoFile("ERP销售明细_202607.xlsx", 1210000))}
        />
      </div>

      <section className="launch-bar">
        <div className="launch-copy">
          <span className={`readiness-dot ${settlementFile && erpFile ? "ready" : ""}`} />
          <div>
            <strong>{settlementFile && erpFile ? "文件已准备完成" : "请先导入两份表单"}</strong>
            <small>{settlementFile && erpFile ? "点击后仅创建服务端任务，结果将异步返回" : "系统需要同时提交结算单和 ERP 表单"}</small>
          </div>
        </div>
        <button type="button" className="primary-button" disabled={!settlementFile || !erpFile || running} onClick={startReconciliation}>
          {running ? <><span className="spinner" /> 正在提交任务</> : <>开始对账 <span>→</span></>}
        </button>
      </section>

      {error && <div className="api-error" role="alert"><b>提交失败</b><span>{error}</span></div>}

      <div className="rule-note">
        <span>职责边界</span>
        <p>匹配规则、金额容差、差异分类及任务状态均以后端返回为准，前端只负责提交和展示。</p>
        <span className="contract-ready">接口已预留</span>
      </div>
    </div>
  );
}

function OverviewView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<ReconciliationTaskSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({
    total: 0,
    byStatus: { QUEUED: 0, PROCESSING: 0, SUCCEEDED: 0, NEEDS_REVIEW: 0, FAILED: 0 },
  });
  const [page, setPage] = useState(1);
  const [statistics, setStatistics] = useState<ReconciliationStatistics | null>(null);
  const [statisticsError, setStatisticsError] = useState("");
  const [selected, setSelected] = useState<ReconciliationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const pageSize = 20;

  const loadTasks = useCallback(async () => {
    const requestNumber = ++requestSequence.current;
    try {
      setError("");
      const result = await reconciliationApi.listTasks({
        status: filter === "all" ? undefined : statusFilters[filter],
        keyword: query.trim() || undefined,
        page,
        pageSize,
      });
      if (requestNumber !== requestSequence.current) return;
      setTasks(result.items);
      setTotal(result.total);
      setFacets(result.facets);
    } catch (requestError) {
      if (requestNumber !== requestSequence.current) return;
      setError(requestErrorMessage(requestError, "历史任务加载失败"));
    } finally {
      if (requestNumber === requestSequence.current) setLoading(false);
    }
  }, [filter, page, query]);

  const loadStatistics = useCallback(async () => {
    try {
      setStatistics(await reconciliationApi.getStatistics());
      setStatisticsError("");
    } catch (requestError) {
      setStatistics(null);
      setStatisticsError(requestErrorMessage(requestError, "总览统计加载失败"));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadTasks, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadTasks, query]);

  useEffect(() => {
    let active = true;
    reconciliationApi.getStatistics()
      .then((result) => { if (active) { setStatistics(result); setStatisticsError(""); } })
      .catch((requestError) => { if (active) { setStatistics(null); setStatisticsError(requestErrorMessage(requestError, "总览统计加载失败")); } });
    return () => { active = false; };
  }, []);

  const hasActiveTask = tasks.some((task) => task.status === "QUEUED" || task.status === "PROCESSING");
  useEffect(() => {
    if (!hasActiveTask) return;
    const activeTaskIds = tasks
      .filter((task) => task.status === "QUEUED" || task.status === "PROCESSING")
      .map((task) => task.id);
    const refreshActiveTasks = async () => {
      const results = await Promise.allSettled(activeTaskIds.map((taskId) => reconciliationApi.getTask(taskId)));
      const refreshed = new Map(
        results
          .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof reconciliationApi.getTask>>> => result.status === "fulfilled")
          .map((result) => [result.value.id, result.value]),
      );
      const transitionedOutOfProcessing = tasks.some((task) => {
        const nextTask = refreshed.get(task.id);
        return nextTask && (task.status === "QUEUED" || task.status === "PROCESSING")
          && nextTask.status !== "QUEUED" && nextTask.status !== "PROCESSING";
      });
      setTasks((current) => current.map((task) => refreshed.get(task.id) ?? task));
      setSelected((current) => {
        if (!current) return null;
        const refreshedTask = refreshed.get(current.id);
        return refreshedTask ? { ...toViewModel(refreshedTask), failure: refreshedTask.failure?.message ?? null } : current;
      });
      if (filter === "processing" && transitionedOutOfProcessing) void loadTasks();
      void loadStatistics();
    };
    const timer = window.setInterval(() => { void refreshActiveTasks(); }, 3_000);
    return () => window.clearInterval(timer);
  }, [filter, hasActiveTask, loadStatistics, loadTasks, tasks]);

  const records = useMemo(() => tasks.map(toViewModel), [tasks]);
  const counts = {
    all: facets.total,
    success: facets.byStatus.SUCCEEDED,
    issue: facets.byStatus.NEEDS_REVIEW,
    failed: facets.byStatus.FAILED,
    processing: facets.byStatus.QUEUED + facets.byStatus.PROCESSING,
  };
  const trend = statistics?.trend ?? [];
  const maxTrend = Math.max(...trend.map((item) => item.taskCount), 1);

  const openDetails = async (taskId: string) => {
    try {
      const detail = await reconciliationApi.getTask(taskId);
      setSelected({ ...toViewModel(detail), failure: detail.failure?.message ?? null });
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "任务详情加载失败"));
    }
  };

  return (
    <div className="view-shell overview-view">
      <div className="page-intro page-intro--split">
        <div>
          <span className="eyebrow">RECONCILIATION OVERVIEW</span>
          <h1>对账总览</h1>
          <p>集中查看后端返回的历史任务、匹配结果与需要进一步处理的差异。</p>
        </div>
        <div className="updated-at"><span /> 数据更新于 {statistics ? formatTaskTime(statistics.updatedAt) : "加载中"}</div>
      </div>

      {statisticsError && <div className="api-error overview-error" role="alert"><b>统计加载失败</b><span>{statisticsError}</span></div>}

      <div className="summary-grid">
        <article className="summary-card summary-card--total">
          <div><span>本月对账</span><b>{statistics?.totalTasks ?? "—"}</b></div>
          <div className="mini-chart" aria-label="近七周对账任务量">
            {trend.map((item) => <i key={item.label} title={`${item.label}：${item.taskCount}笔`} style={{ height: `${Math.max(18, item.taskCount / maxTrend * 100)}%` }} />)}
          </div>
          <small>较上月 <strong>{statistics ? `${statistics.monthOverMonthRate >= 0 ? "+ " : ""}${(statistics.monthOverMonthRate * 100).toFixed(1)}%` : "—"}</strong></small>
        </article>
        <article className="summary-card">
          <span className="metric-symbol metric-symbol--success">✓</span>
          <div><span>自动对平</span><b>{statistics?.succeededTasks ?? "—"}</b></div>
          <small>自动完成率 {statistics ? `${(statistics.autoMatchRate * 100).toFixed(0)}%` : "—"}</small>
        </article>
        <article className="summary-card">
          <span className="metric-symbol metric-symbol--issue">!</span>
          <div><span>需要处理</span><b>{statistics?.needsReviewTasks ?? "—"}</b></div>
          <small>共 {statistics ? formatMoney(statistics.totalDifferenceAmount) : "—"} 差异</small>
        </article>
        <article className="summary-card">
          <span className="metric-symbol metric-symbol--failed">×</span>
          <div><span>对账失败</span><b>{statistics?.failedTasks ?? "—"}</b></div>
          <small>具体原因以后端错误码为准</small>
        </article>
      </div>

      <section className="records-section">
        <div className="records-head">
          <div><h2>历史对账</h2><span>共 {total} 条任务</span></div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索任务编号、文件或负责人" />
          </label>
        </div>

        <div className="filter-tabs" role="tablist" aria-label="按状态筛选">
          {([
            ["all", "全部", counts.all], ["success", "成功", counts.success], ["issue", "有差异", counts.issue],
            ["failed", "失败", counts.failed], ["processing", "进行中", counts.processing],
          ] as const).map(([value, label, count]) => (
            <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setPage(1); }}>
              {label}<span>{count}</span>
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th>任务 / 账期</th><th>文件</th><th>结算金额</th><th>匹配条目</th><th>差异金额</th><th>状态</th><th>执行时间</th><th aria-label="操作" /></tr></thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} onClick={() => void openDetails(record.id)}>
                  <td><strong>{record.id}</strong><span>{record.period}</span></td>
                  <td className="file-cell"><strong>{record.settlement}</strong><span>{record.erp}</span></td>
                  <td className="number-cell">{record.amount}</td>
                  <td className="number-cell">{record.matched}</td>
                  <td className={`number-cell ${record.status === "issue" ? "number-cell--issue" : ""}`}>{record.variance}</td>
                  <td><span className={`status status--${record.status}`}><i />{statusLabels[record.status]}</span></td>
                  <td><strong>{record.time}</strong><span>{record.owner}</span></td>
                  <td><button type="button" className="row-action" aria-label={`查看 ${record.id} 详情`}>›</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="empty-state"><b>正在读取对账任务</b><span>请稍候</span></div>}
          {!loading && error && <div className="empty-state empty-state--error"><b>数据加载失败</b><span>{error}</span></div>}
          {!loading && !error && !records.length && <div className="empty-state"><b>没有找到相关任务</b><span>试试更换筛选条件或搜索关键词</span></div>}
        </div>
        {total > pageSize && (
          <div className="pagination" aria-label="历史任务分页">
            <span>第 {page} / {Math.ceil(total / pageSize)} 页</span>
            <div>
              <button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
              <button type="button" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((current) => current + 1)}>下一页</button>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <div className="drawer-backdrop">
          <button type="button" className="drawer-dismiss" onClick={() => setSelected(null)} aria-label="关闭任务详情" />
          <aside className="detail-drawer" aria-label="对账任务详情">
            <button type="button" className="drawer-close" onClick={() => setSelected(null)} aria-label="关闭详情">×</button>
            <span className="eyebrow">TASK DETAIL</span>
            <h2>{selected.id}</h2>
            <span className={`status status--${selected.status}`}><i />{statusLabels[selected.status]}</span>
            <div className="detail-amount"><span>结算金额</span><strong>{selected.amount}</strong></div>
            <dl>
              <div><dt>账期</dt><dd>{selected.period}</dd></div>
              <div><dt>匹配条目</dt><dd>{selected.matched}</dd></div>
              <div><dt>差异金额</dt><dd>{selected.variance}</dd></div>
              <div><dt>执行人</dt><dd>{selected.owner}</dd></div>
              <div><dt>结算单</dt><dd>{selected.settlement}</dd></div>
              <div><dt>ERP 表单</dt><dd>{selected.erp}</dd></div>
              {selected.failure && <div><dt>失败原因</dt><dd className="failure-message">{selected.failure}</dd></div>}
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("start");

  const handleComplete = () => setView("overview");

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">R</div><div><strong>锐力对账</strong><span>财务协同工作台</span></div></div>
        <nav aria-label="主导航">
          <span className="nav-label">工作台</span>
          <button type="button" className={view === "start" ? "active" : ""} onClick={() => setView("start")}><i>＋</i><span>发起对账</span></button>
          <button type="button" className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><i>览</i><span>对账总览</span></button>
          <button type="button" disabled><i>异</i><span>差异处理</span><em>稍后</em></button>
          <span className="nav-label nav-label--second">系统</span>
          <button type="button" disabled><i>规</i><span>对账规则</span></button>
          <button type="button" disabled><i>设</i><span>基础设置</span></button>
        </nav>
        <div className="sidebar-footer"><div className="avatar">V</div><div><strong>财务管理员</strong><span>锐力贸易 · 财务部</span></div><button type="button" aria-label="更多账户选项">•••</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><span>财务运营</span><b>/</b><strong>{view === "start" ? "发起对账" : "对账总览"}</strong>{usingMockApi && <em className="mock-indicator">接口演示模式</em>}</div>
          <div className="topbar-actions">
            <button type="button" className="help-button"><span>?</span> 使用帮助</button>
            {view === "overview" && <button type="button" className="compact-primary" onClick={() => setView("start")}>＋ 新建对账</button>}
            <button type="button" className="notification-button" aria-label="通知"><span>•</span>⌾</button>
          </div>
        </header>
        {view === "start" ? <StartView onComplete={handleComplete} /> : <OverviewView />}
      </section>
    </main>
  );
}
