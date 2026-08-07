// 文件说明：左侧导航栏组件，负责切换对账工作台页面。
import type { WorkspaceView } from "../model/workspace-types";

type AppSidebarProps = {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
};

export function AppSidebar({ view, onViewChange }: AppSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div><strong>锐力对账</strong><span>财务协同工作台</span></div>
      </div>
      <nav aria-label="主导航">
        <span className="nav-label">工作台</span>
        <button type="button" className={view === "start" ? "active" : ""} onClick={() => onViewChange("start")}><i>＋</i><span>发起对账</span></button>
        <button type="button" className={view === "overview" ? "active" : ""} onClick={() => onViewChange("overview")}><i>览</i><span>对账总览</span></button>
        <button type="button" className={view === "review" ? "active" : ""} onClick={() => onViewChange("review")}><i>审</i><span>差异处理</span></button>
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
  );
}
