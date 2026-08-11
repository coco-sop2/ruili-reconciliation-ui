// 文件说明：应用主壳，负责在开始对账、对账总览、差异处理三个页面之间切换。
import { useState } from "react";
import { AppSidebar } from "../features/reconciliation/components/AppSidebar";
import { AppTopbar } from "../features/reconciliation/components/AppTopbar";
import { OverviewView } from "../features/reconciliation/components/OverviewView";
import { ReviewView } from "../features/reconciliation/components/ReviewView";
import { StartView } from "../features/reconciliation/components/StartView";
import type { ReconciliationTaskSummary } from "../features/reconciliation/model/types";
import type { WorkspaceView } from "../features/reconciliation/model/workspace-types";

export default function Home() {
  const [view, setView] = useState<WorkspaceView>("start");

  const handleComplete = (task: ReconciliationTaskSummary) => {
    setView(task.status === "NEEDS_REVIEW" ? "review" : "overview");
  };

  return (
    <main className="app-shell">
      <AppSidebar view={view} onViewChange={setView} />

      <section className="workspace">
        <AppTopbar view={view} onStart={() => setView("start")} />
        {view === "start" && <StartView onComplete={handleComplete} />}
        {view === "overview" && <OverviewView />}
        {view === "review" && <ReviewView />}
      </section>
    </main>
  );
}
