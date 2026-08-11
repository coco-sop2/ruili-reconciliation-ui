// 文件说明：应用主壳，负责在开始对账、对账总览、差异处理三个页面之间切换。
// 对账任务执行与处理日志由 ReconciliationTaskProvider 常驻管理，切换页面不丢失。
import { useCallback, useState } from "react";
import { AppSidebar } from "../features/reconciliation/components/AppSidebar";
import { AppTopbar } from "../features/reconciliation/components/AppTopbar";
import { OverviewView } from "../features/reconciliation/components/OverviewView";
import { ReviewView } from "../features/reconciliation/components/ReviewView";
import { StartView } from "../features/reconciliation/components/StartView";
import { ReconciliationTaskProvider } from "../features/reconciliation/hooks/ReconciliationTaskProvider";
import type { ReconciliationTaskSummary } from "../features/reconciliation/model/types";
import type { WorkspaceView } from "../features/reconciliation/model/workspace-types";

function AppShell({ view, onViewChange }: { view: WorkspaceView; onViewChange: (view: WorkspaceView) => void }) {
  return (
    <main className="app-shell">
      <AppSidebar view={view} onViewChange={onViewChange} />

      <section className="workspace">
        <AppTopbar view={view} onStart={() => onViewChange("start")} />
        {view === "start" && <StartView />}
        {view === "overview" && <OverviewView />}
        {view === "review" && <ReviewView />}
      </section>
    </main>
  );
}

export default function Home() {
  const [view, setView] = useState<WorkspaceView>("start");

  const handleComplete = useCallback((task: ReconciliationTaskSummary) => {
    setView(task.status === "NEEDS_REVIEW" ? "review" : "overview");
  }, []);

  return (
    <ReconciliationTaskProvider onComplete={handleComplete}>
      <AppShell view={view} onViewChange={setView} />
    </ReconciliationTaskProvider>
  );
}