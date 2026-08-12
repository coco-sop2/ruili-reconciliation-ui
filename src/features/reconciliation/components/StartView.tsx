// 文件说明：开始对账页面，展示两份资料上传入口和提交按钮。
// 文件选择为本地表单状态；任务执行与处理日志由全局 ReconciliationTaskProvider 管理。
import { useStartReconciliation } from "../hooks/use-start-reconciliation";
import { useReconciliationTask } from "../hooks/ReconciliationTaskProvider";
import {
  reconciliationFileAccept,
  reconciliationFileHint,
} from "../model/file-rules";
import { FileCard } from "./FileCard";
import { ProcessLogPanel } from "./ProcessLogPanel";

export function StartView() {
  const {
    settlementFile,
    erpFile,
    agentName,
    agentWorkspace,
    formError,
    setAgentName,
    setAgentWorkspace,
    handleSettlementFileChange,
    handleErpFileChange,
  } = useStartReconciliation();
  const {
    running,
    canStop,
    stopping,
    error,
    logs,
    startReconciliation,
    stopReconciliation,
  } = useReconciliationTask();

  const canStart = Boolean(settlementFile && erpFile);

  const handleSubmit = () => {
    if (!settlementFile || !erpFile) return;
    void startReconciliation({ settlementFile, erpFile, agentName, agentWorkspace });
  };

  return (
    <div className="view-shell start-view">
      <div className="page-intro page-intro--split">
        <div>
          <span className="eyebrow">NEW RECONCILIATION</span>
          <h1>发起一笔新对账</h1>
          <p>分别导入渠道结算资料与 ERP 资料，CherryStudio agent 将完成内容识别、规则匹配与结果计算。</p>
        </div>
        <div className="security-note">
          <span aria-hidden="true">↗</span>
          <div>
            <strong>文件提交后由服务端处理</strong>
            <small>前端不解析、不保存，也不执行任何金额计算</small>
          </div>
        </div>
      </div>

      <div className="flow-strip" aria-label="对账步骤">
        <div className="flow-item flow-item--active"><b>01</b><span>导入结算资料</span></div>
        <i />
        <div className={settlementFile ? "flow-item flow-item--active" : "flow-item"}><b>02</b><span>导入 ERP 资料</span></div>
        <i />
        <div className={settlementFile && erpFile ? "flow-item flow-item--active" : "flow-item"}><b>03</b><span>提交后端任务</span></div>
      </div>

      <section className="agent-selector" aria-labelledby="agent-selector-title">
        <div className="agent-selector__intro">
          <span>CHERRYSTUDIO TARGET</span>
          <div>
            <h2 id="agent-selector-title">选择对账 Agent</h2>
            <p>按名称或工作目录匹配；名称可能重复时请同时填写两项。</p>
          </div>
        </div>
        <div className="agent-selector__fields">
          <label>
            <span>Agent 名称</span>
            <input
              type="text"
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder="留空时使用后端默认 Agent"
              autoComplete="off"
            />
          </label>
          <label>
            <span>Agent 工作目录</span>
            <input
              type="text"
              value={agentWorkspace}
              onChange={(event) => setAgentWorkspace(event.target.value)}
              placeholder="可选，用于消除同名 Agent 歧义"
              autoComplete="off"
            />
          </label>
        </div>
      </section>

      <div className="file-grid">
        <FileCard
          eyebrow="01"
          title="导入结算资料"
          description="渠道、平台或门店提供的表格、PDF 或截图资料"
          file={settlementFile}
          accept={reconciliationFileAccept}
          hint={reconciliationFileHint}
          onChange={handleSettlementFileChange}
        />
        <FileCard
          eyebrow="02"
          title="导入 ERP 资料"
          description="从 ERP 导出的表格、PDF 或业务截图资料"
          file={erpFile}
          accept={reconciliationFileAccept}
          hint={reconciliationFileHint}
          onChange={handleErpFileChange}
        />
      </div>

      <section className="launch-bar">
        <div className="launch-copy">
          <span className={`readiness-dot ${settlementFile && erpFile ? "ready" : ""}`} />
          <div>
            <strong>{settlementFile && erpFile ? "文件已准备完成" : "请先导入两份资料"}</strong>
            <small>{settlementFile && erpFile ? "点击后仅创建服务端任务，处理过程将实时显示" : "系统需要同时提交结算资料和 ERP 资料"}</small>
          </div>
        </div>
        {running ? (
          <button type="button" className="stop-button" disabled={!canStop || stopping} onClick={() => void stopReconciliation()}>
            <span aria-hidden="true">■</span> {canStop ? (stopping ? "正在停止" : "停止对账") : "正在创建任务"}
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={!canStart} onClick={handleSubmit}>
            开始对账<span>→</span>
          </button>
        )}
      </section>

      {formError && <div className="api-error" role="alert"><b>文件校验失败</b><span>{formError}</span></div>}
      {error && <div className="api-error" role="alert"><b>提交失败</b><span>{error}</span></div>}

      {/* 处理日志：保持在发起对账界面；任务切页不中断，切回仍显示完整日志 */}
      <ProcessLogPanel logs={logs} running={running} />

      <div className="rule-note">
        <span>职责边界</span>
        <p>匹配规则、金额容差、差异分类及任务状态，均以后端返回为准，前端只负责提交和展示。</p>
        <span className="contract-ready">接口已预留</span>
      </div>
    </div>
  );
}
