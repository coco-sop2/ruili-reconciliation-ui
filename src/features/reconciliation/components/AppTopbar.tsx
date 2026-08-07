// 文件说明：顶部栏组件，展示当前页面位置和 CherryStudio 接口配置状态。
import { usingDisabledApi } from "../api";
import type { WorkspaceView } from "../model/workspace-types";

type AppTopbarProps = {
  view: WorkspaceView;
  onStart: () => void;
};

const viewLabels: Record<WorkspaceView, string> = {
  start: "发起对账",
  overview: "对账总览",
  review: "差异处理",
};

export function AppTopbar({ view, onStart }: AppTopbarProps) {
  return (
    <header className="topbar">
      <div><span>财务运营</span><b>/</b><strong>{viewLabels[view]}</strong>{usingDisabledApi && <em className="api-indicator">接口未配置</em>}</div>
      <div className="topbar-actions">
        <button type="button" className="help-button"><span>?</span> 使用帮助</button>
        {view !== "start" && <button type="button" className="compact-primary" onClick={onStart}>＋ 新建对账</button>}
        <button type="button" className="notification-button" aria-label="通知"><span>•</span>⌾</button>
      </div>
    </header>
  );
}
