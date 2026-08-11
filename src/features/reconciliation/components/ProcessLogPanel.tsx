// 文件说明：对账处理过程日志面板，类似终端控制台，实时滚动显示各阶段输出。
import { useEffect, useRef } from "react";
import type { ReconciliationProcessLog } from "../model/types";

type ProcessLogPanelProps = {
  logs: ReconciliationProcessLog[];
  running: boolean;
};

function formatTime(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function ProcessLogPanel({ logs, running }: ProcessLogPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [logs.length]);

  if (logs.length === 0) return null;

  return (
    <section className="process-log" aria-label="处理过程日志">
      <div className="process-log__header">
        <span className="process-log__dot" aria-hidden="true" />
        <strong>处理过程</strong>
        <span className="process-log__status">{running ? "进行中…" : "已完成"}</span>
      </div>
      <div className="process-log__body" ref={bodyRef}>
        {logs.map((log) => (
          <div key={log.id} className={`process-log__line process-log__line--${log.level}`}>
            <span className="process-log__time">{formatTime(log.timestamp)}</span>
            <span className="process-log__mark" aria-hidden="true">
              {log.level === "error" ? "✕" : log.level === "success" ? "✓" : "·"}
            </span>
            <span className="process-log__message">{log.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}