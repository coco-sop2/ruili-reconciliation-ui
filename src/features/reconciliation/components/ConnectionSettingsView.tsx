import { useEffect, useState } from "react";

const configBaseUrl = "http://127.0.0.1:3334";

type StoredStatus = { cherryApiKey: boolean; sshPassword: boolean; databasePassword: boolean };
type CheckResult = { status: "ok" | "error" | "skipped"; message: string };
type Results = { cherry: CheckResult; ssh: CheckResult; database: CheckResult };

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${configBaseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    if (payload.data) return payload.data as T;
    throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
  }
  return payload.data as T;
}

const emptyStored: StoredStatus = { cherryApiKey: false, sshPassword: false, databasePassword: false };

export function ConnectionSettingsView() {
  const [stored, setStored] = useState<StoredStatus>(emptyStored);
  const [secureStorage, setSecureStorage] = useState("系统安全存储");
  const [cherryApiKey, setCherryApiKey] = useState("");
  const [sshPassword, setSshPassword] = useState("");
  const [databasePassword, setDatabasePassword] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error" | "">("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void request<{ stored: StoredStatus; secureStorage: string }>("/api/config")
      .then((data) => {
        setStored(data.stored);
        setSecureStorage(data.secureStorage);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "无法读取本机配置");
        setMessageKind("error");
      })
      .finally(() => setLoaded(true));
  }, []);

  const values = { cherryApiKey, sshPassword, databasePassword };
  const ready = loaded
    && Boolean(cherryApiKey || stored.cherryApiKey)
    && Boolean(sshPassword || stored.sshPassword)
    && Boolean(databasePassword || stored.databasePassword);
  const update = (setter: (value: string) => void, value: string) => {
    setter(value);
    setResults(null);
    setMessage("");
    setMessageKind("");
  };

  const testAndSave = async () => {
    setBusy(true);
    setMessage("");
    setMessageKind("");
    try {
      const data = await request<{ ok: boolean; restarting: boolean; results: Results; stored: StoredStatus }>("/api/config/test-and-save", values);
      setResults(data.results);
      setStored(data.stored);
      setMessage(data.ok
        ? (data.restarting ? "连接正常，已保存；后台正在完成启动。" : "连接正常，已保存；下次启动将使用新配置。")
        : "未保存本次输入，请修改失败项后重新检测。");
      setMessageKind(data.ok ? "success" : "error");
      if (data.ok) {
        setCherryApiKey("");
        setSshPassword("");
        setDatabasePassword("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "检测失败");
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view-shell settings-view">
      <header className="page-intro page-intro--split">
        <div>
          <span className="eyebrow">LOCAL CONNECTION</span>
          <h1>连接设置</h1>
          <p>首次使用请填写全部三项。以后留空表示沿用本机已有值，只有全部检测通过才会保存。</p>
        </div>
        <div className="security-note"><span>⌁</span><div><strong>{secureStorage}</strong><small>配置服务仅监听 127.0.0.1</small></div></div>
      </header>

      <section className="settings-card">
        <label>
          <span><b>1</b> CherryStudio API Key <Stored loaded={loaded} saved={stored.cherryApiKey} changed={Boolean(cherryApiKey)} /></span>
          <input type="password" autoComplete="off" value={cherryApiKey} onChange={(event) => update(setCherryApiKey, event.target.value)} placeholder={stored.cherryApiKey ? "已有本机配置；留空继续使用" : "请输入 API Key"} />
        </label>
        <label>
          <span><b>2</b> SSH 服务器密码 <Stored loaded={loaded} saved={stored.sshPassword} changed={Boolean(sshPassword)} /></span>
          <input type="password" autoComplete="off" value={sshPassword} onChange={(event) => update(setSshPassword, event.target.value)} placeholder={stored.sshPassword ? "已有本机配置；留空继续使用" : "请输入 SSH 密码"} />
        </label>
        <label>
          <span><b>3</b> 数据库密码 <Stored loaded={loaded} saved={stored.databasePassword} changed={Boolean(databasePassword)} /></span>
          <input type="password" autoComplete="new-password" value={databasePassword} onChange={(event) => update(setDatabasePassword, event.target.value)} placeholder={stored.databasePassword ? "已有本机配置；留空继续使用" : "请输入数据库密码"} />
        </label>

        {results && (
          <div className="connection-results">
            <Result label="CherryStudio" result={results.cherry} />
            <Result label="SSH" result={results.ssh} />
            <Result label="PostgreSQL" result={results.database} />
          </div>
        )}
        {message && <div className={`settings-message settings-message--${messageKind}`} role="status">{message}</div>}

        <div className="settings-actions">
          <button type="button" className="primary-button" disabled={busy || !ready} onClick={() => void testAndSave()}>
            {busy ? "正在检测连接…" : "检测通过并保存"}
          </button>
          {!ready && loaded && <small>请先填写所有未配置项</small>}
        </div>
      </section>
    </div>
  );
}

function Stored({ loaded, saved, changed }: { loaded: boolean; saved: boolean; changed: boolean }) {
  const text = !loaded ? "读取中" : changed ? "待验证" : saved ? "本机已有值" : "待填写";
  return <em className={!changed && saved ? "stored stored--yes" : "stored"}>{text}</em>;
}

function Result({ label, result }: { label: string; result: CheckResult }) {
  const icon = result.status === "ok" ? "✓" : result.status === "error" ? "×" : "—";
  return <div className={`check-result check-result--${result.status}`}><b>{icon}</b><span><strong>{label}</strong><small>{result.message}</small></span></div>;
}
