"use client";

import { ChangeEvent, useMemo, useState } from "react";

type View = "start" | "overview";
type Status = "success" | "issue" | "failed" | "processing";

type Reconciliation = {
  id: string;
  period: string;
  settlement: string;
  erp: string;
  amount: string;
  matched: string;
  variance: string;
  status: Status;
  time: string;
  owner: string;
};

const initialRecords: Reconciliation[] = [
  {
    id: "REC-260805-018",
    period: "2026年7月",
    settlement: "华东渠道结算单_07月.xlsx",
    erp: "ERP销售明细_202607.xlsx",
    amount: "¥ 4,286,920.40",
    matched: "1,842 / 1,842",
    variance: "¥ 0.00",
    status: "success",
    time: "08月05日 16:42",
    owner: "陈嘉宁",
  },
  {
    id: "REC-260804-017",
    period: "2026年7月",
    settlement: "线上渠道结算单_07月.xlsx",
    erp: "ERP销售明细_202607.xlsx",
    amount: "¥ 2,795,480.00",
    matched: "966 / 972",
    variance: "¥ 12,680.00",
    status: "issue",
    time: "08月04日 11:08",
    owner: "王舟",
  },
  {
    id: "REC-260731-016",
    period: "2026年6月",
    settlement: "直营门店结算单_06月.xlsx",
    erp: "ERP销售明细_202606.xlsx",
    amount: "¥ 6,150,320.80",
    matched: "2,410 / 2,410",
    variance: "¥ 0.00",
    status: "success",
    time: "07月31日 18:26",
    owner: "刘乐",
  },
  {
    id: "REC-260729-015",
    period: "2026年6月",
    settlement: "经销商结算汇总_06月.xlsx",
    erp: "ERP销售明细_202606.xlsx",
    amount: "¥ 1,084,760.00",
    matched: "—",
    variance: "—",
    status: "failed",
    time: "07月29日 09:14",
    owner: "周岚",
  },
  {
    id: "REC-260728-014",
    period: "2026年6月",
    settlement: "华南渠道结算单_06月.xlsx",
    erp: "ERP销售明细_202606.xlsx",
    amount: "¥ 3,527,190.50",
    matched: "1,238 / 1,241",
    variance: "¥ 8,240.50",
    status: "issue",
    time: "07月28日 15:32",
    owner: "陈嘉宁",
  },
  {
    id: "REC-260725-013",
    period: "2026年6月",
    settlement: "电商平台结算单_06月.xlsx",
    erp: "ERP销售明细_202606.xlsx",
    amount: "¥ 945,880.00",
    matched: "522 / 522",
    variance: "¥ 0.00",
    status: "success",
    time: "07月25日 10:17",
    owner: "王舟",
  },
];

const statusLabels: Record<Status, string> = {
  success: "对账成功",
  issue: "存在差异",
  failed: "对账失败",
  processing: "对账中",
};

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
      <div className="file-icon" aria-hidden="true">
        {file ? "✓" : "XLS"}
      </div>
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
          <button type="button" className="demo-button" onClick={onDemo}>
            载入示例
          </button>
        </div>
      )}
      <span className="file-hint">支持 .xlsx / .xls，单个文件不超过 20 MB</span>
    </section>
  );
}

function StartView({ onComplete }: { onComplete: (record: Reconciliation) => void }) {
  const [settlementFile, setSettlementFile] = useState<File | null>(null);
  const [erpFile, setErpFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);

  const demoFile = (name: string, size: number) =>
    new File([new Uint8Array(size)], name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

  const startReconciliation = () => {
    if (!settlementFile || !erpFile || running) return;
    setRunning(true);
    window.setTimeout(() => {
      onComplete({
        id: "REC-260806-019",
        period: "2026年7月",
        settlement: settlementFile.name,
        erp: erpFile.name,
        amount: "待计算",
        matched: "正在解析",
        variance: "—",
        status: "processing",
        time: "刚刚",
        owner: "当前用户",
      });
    }, 1300);
  };

  return (
    <div className="view-shell start-view">
      <div className="page-intro page-intro--split">
        <div>
          <span className="eyebrow">NEW RECONCILIATION</span>
          <h1>发起一笔新对账</h1>
          <p>分别导入渠道结算单与 ERP 明细，系统将自动识别字段并逐行核对。</p>
        </div>
        <div className="security-note">
          <span aria-hidden="true">⌁</span>
          <div>
            <strong>文件仅用于本次核对</strong>
            <small>正式接入后将按企业策略加密存储</small>
          </div>
        </div>
      </div>

      <div className="flow-strip" aria-label="对账步骤">
        <div className="flow-item flow-item--active"><b>01</b><span>导入结算单</span></div>
        <i />
        <div className={settlementFile ? "flow-item flow-item--active" : "flow-item"}><b>02</b><span>导入 ERP 表单</span></div>
        <i />
        <div className={settlementFile && erpFile ? "flow-item flow-item--active" : "flow-item"}><b>03</b><span>自动对账</span></div>
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
            <small>{settlementFile && erpFile ? "点击开始后，预计 1–3 分钟生成结果" : "系统需要同时读取结算单和 ERP 表单"}</small>
          </div>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={!settlementFile || !erpFile || running}
          onClick={startReconciliation}
        >
          {running ? <><span className="spinner" /> 正在创建任务</> : <>开始对账 <span>→</span></>}
        </button>
      </section>

      <div className="rule-note">
        <span>核对规则</span>
        <p>当前采用「订单号 + 含税金额」匹配，金额容差 ¥0.01。规则将在后端接口阶段确认。</p>
        <button type="button" aria-label="查看当前规则说明">查看说明</button>
      </div>
    </div>
  );
}

function OverviewView({ records }: { records: Reconciliation[] }) {
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Reconciliation | null>(null);

  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return records.filter((record) => {
      const matchesStatus = filter === "all" || record.status === filter;
      const matchesQuery = !normalized || [record.id, record.settlement, record.erp, record.period, record.owner]
        .some((value) => value.toLowerCase().includes(normalized));
      return matchesStatus && matchesQuery;
    });
  }, [filter, query, records]);

  const counts = records.reduce(
    (acc, record) => ({ ...acc, [record.status]: acc[record.status] + 1 }),
    { success: 0, issue: 0, failed: 0, processing: 0 },
  );

  return (
    <div className="view-shell overview-view">
      <div className="page-intro page-intro--split">
        <div>
          <span className="eyebrow">RECONCILIATION OVERVIEW</span>
          <h1>对账总览</h1>
          <p>集中查看历史任务、匹配结果与需要进一步处理的差异。</p>
        </div>
        <div className="updated-at"><span /> 数据更新于今天 17:06</div>
      </div>

      <div className="summary-grid">
        <article className="summary-card summary-card--total">
          <div><span>本月对账</span><b>24</b></div>
          <div className="mini-chart" aria-label="近六周对账任务量">
            {[36, 55, 42, 68, 58, 82, 72].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
          </div>
          <small>较上月 <strong>+ 12.5%</strong></small>
        </article>
        <article className="summary-card">
          <span className="metric-symbol metric-symbol--success">✓</span>
          <div><span>自动对平</span><b>18</b></div>
          <small>自动完成率 75%</small>
        </article>
        <article className="summary-card">
          <span className="metric-symbol metric-symbol--issue">!</span>
          <div><span>需要处理</span><b>4</b></div>
          <small>共 ¥20,920.50 差异</small>
        </article>
        <article className="summary-card">
          <span className="metric-symbol metric-symbol--failed">×</span>
          <div><span>对账失败</span><b>2</b></div>
          <small>主要为文件格式问题</small>
        </article>
      </div>

      <section className="records-section">
        <div className="records-head">
          <div>
            <h2>历史对账</h2>
            <span>共 {records.length} 条任务</span>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务编号、文件或负责人" />
          </label>
        </div>

        <div className="filter-tabs" role="tablist" aria-label="按状态筛选">
          {([
            ["all", "全部", records.length],
            ["success", "成功", counts.success],
            ["issue", "有差异", counts.issue],
            ["failed", "失败", counts.failed],
            ["processing", "进行中", counts.processing],
          ] as const).map(([value, label, count]) => (
            <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
              {label}<span>{count}</span>
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>任务 / 账期</th>
                <th>文件</th>
                <th>结算金额</th>
                <th>匹配条目</th>
                <th>差异金额</th>
                <th>状态</th>
                <th>执行时间</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => (
                <tr key={record.id} onClick={() => setSelected(record)}>
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
          {!filteredRecords.length && (
            <div className="empty-state"><b>没有找到相关任务</b><span>试试更换筛选条件或搜索关键词</span></div>
          )}
        </div>
      </section>

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="detail-drawer" onClick={(event) => event.stopPropagation()} aria-label="对账任务详情">
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
            </dl>
            <button type="button" className="primary-button drawer-button">查看完整结果 <span>→</span></button>
          </aside>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("start");
  const [records, setRecords] = useState(initialRecords);

  const handleComplete = (record: Reconciliation) => {
    setRecords((current) => [record, ...current]);
    setView("overview");
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div><strong>锐力对账</strong><span>财务协同工作台</span></div>
        </div>

        <nav aria-label="主导航">
          <span className="nav-label">工作台</span>
          <button type="button" className={view === "start" ? "active" : ""} onClick={() => setView("start")}>
            <i>＋</i><span>发起对账</span>
          </button>
          <button type="button" className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>
            <i>览</i><span>对账总览</span><b>{records.filter((record) => record.status === "issue").length}</b>
          </button>
          <button type="button" disabled><i>异</i><span>差异处理</span><em>稍后</em></button>
          <span className="nav-label nav-label--second">系统</span>
          <button type="button" disabled><i>规</i><span>对账规则</span></button>
          <button type="button" disabled><i>设</i><span>基础设置</span></button>
        </nav>

        <div className="sidebar-footer">
          <div className="avatar">V</div>
          <div><strong>财务管理员</strong><span>锐力贸易 · 财务部</span></div>
          <button type="button" aria-label="更多账户选项">•••</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><span>财务运营</span><b>/</b><strong>{view === "start" ? "发起对账" : "对账总览"}</strong></div>
          <div className="topbar-actions">
            <button type="button" className="help-button"><span>?</span> 使用帮助</button>
            {view === "overview" && <button type="button" className="compact-primary" onClick={() => setView("start")}>＋ 新建对账</button>}
            <button type="button" className="notification-button" aria-label="通知"><span>•</span>⌾</button>
          </div>
        </header>
        {view === "start" ? <StartView onComplete={handleComplete} /> : <OverviewView records={records} />}
      </section>
    </main>
  );
}
