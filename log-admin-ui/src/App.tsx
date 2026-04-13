import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TOKEN_KEY = "emotion_kit_ai_admin_token";

type LogRow = {
  id: number;
  created_at: string;
  phase: string;
  level: string;
  meta_json: unknown;
};

type ListResponse = {
  ok: boolean;
  errMsg?: string;
  mysql?: boolean;
  rows?: LogRow[];
  total?: number;
  page?: number;
  pageSize?: number;
};

function formatMeta(meta: unknown): string {
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
}

export default function App() {
  const [token, setToken] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [phase, setPhase] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [mysql, setMysql] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    try {
      const s = localStorage.getItem(TOKEN_KEY);
      if (s) setToken(s);
    } catch {
      /* ignore */
    }
  }, []);

  const authHeaders = useMemo(() => {
    const t = token.trim();
    if (!t) return {};
    return { Authorization: `Bearer ${t}` };
  }, [token]);

  const loadMeta = useCallback(async () => {
    const t = token.trim();
    if (!t) return;
    try {
      const r = await fetch("/api/logs/meta", { headers: { Authorization: `Bearer ${t}` } });
      const j = (await r.json()) as { ok?: boolean; mysql?: boolean };
      if (r.ok && j.mysql != null) setMysql(!!j.mysql);
    } catch {
      setMysql(null);
    }
  }, [token]);

  const load = useCallback(async () => {
    const t = token.trim();
    if (!t) {
      setErr("请先填写 Token（与 SERVICE_TOKEN 或 LOG_ADMIN_TOKEN 一致）");
      return;
    }
    setErr("");
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("pageSize", String(pageSize));
      if (phase.trim()) q.set("phase", phase.trim());
      if (from) q.set("from", new Date(from).toISOString());
      if (to) q.set("to", new Date(to).toISOString());
      const r = await fetch(`/api/logs?${q.toString()}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const j = (await r.json()) as ListResponse;
      if (!r.ok || !j.ok) {
        setErr(j.errMsg || `HTTP ${r.status}`);
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(j.rows || []);
      setTotal(j.total ?? 0);
      setMysql(!!j.mysql);
    } catch (e) {
      setErr((e as Error).message || String(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token, page, pageSize, phase, from, to]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!token.trim()) return;
    void loadRef.current();
  }, [page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px 48px" }}>
      <h1 style={{ fontSize: "1.2rem", margin: "0 0 8px" }}>emotion-kit-ai 日志（MySQL）</h1>
      <p style={{ color: "#8b949e", fontSize: "0.85rem", margin: "0 0 16px" }}>
        与 Node 服务同域部署；需配置 MySQL 并执行 <code>schema.sql</code>。Token 使用{" "}
        <code>SERVICE_TOKEN</code> 或 <code>LOG_ADMIN_TOKEN</code>。
        {mysql === false && (
          <span style={{ color: "#f85149" }}> 当前接口返回 MySQL 未配置。</span>
        )}
        {mysql === true && <span style={{ color: "#3fb950" }}> MySQL 已连接。</span>}
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <input
          type="password"
          placeholder="Bearer Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          style={{
            flex: "1 1 220px",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #30363d",
            background: "#161b22",
            color: "#e6edf3",
          }}
        />
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(TOKEN_KEY, token.trim());
              setErr("已保存到本地");
            } catch (e) {
              setErr(String(e));
            }
          }}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: "#238636",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          保存 Token
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #30363d",
            background: "#21262d",
            color: "#e6edf3",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "加载中…" : "查询"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <label style={{ color: "#8b949e", fontSize: "0.85rem" }}>phase 包含</label>
        <input
          value={phase}
          onChange={(e) => setPhase(e.target.value)}
          placeholder="如 dashscope / reflect"
          style={{
            width: 180,
            padding: 8,
            borderRadius: 8,
            border: "1px solid #30363d",
            background: "#161b22",
            color: "#e6edf3",
          }}
        />
        <label style={{ color: "#8b949e", fontSize: "0.85rem" }}>从</label>
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3" }}
        />
        <label style={{ color: "#8b949e", fontSize: "0.85rem" }}>到</label>
        <input
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3" }}
        />
        <label style={{ color: "#8b949e", fontSize: "0.85rem" }}>每页</label>
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          style={{ padding: 8, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3" }}
        >
          {[20, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {err ? (
        <p style={{ color: "#f85149", margin: "8px 0" }}>{err}</p>
      ) : null}

      <div style={{ overflow: "auto", border: "1px solid #30363d", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#161b22", textAlign: "left" }}>
              <th style={{ padding: 10, borderBottom: "1px solid #30363d" }}>id</th>
              <th style={{ padding: 10, borderBottom: "1px solid #30363d" }}>时间</th>
              <th style={{ padding: 10, borderBottom: "1px solid #30363d" }}>phase</th>
              <th style={{ padding: 10, borderBottom: "1px solid #30363d" }}>level</th>
              <th style={{ padding: 10, borderBottom: "1px solid #30363d" }}>meta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #21262d" }}>
                <td style={{ padding: 10, verticalAlign: "top", whiteSpace: "nowrap" }}>{r.id}</td>
                <td style={{ padding: 10, verticalAlign: "top", whiteSpace: "nowrap" }}>
                  {r.created_at != null ? String(r.created_at) : ""}
                </td>
                <td style={{ padding: 10, verticalAlign: "top" }}>{r.phase}</td>
                <td style={{ padding: 10, verticalAlign: "top" }}>{r.level}</td>
                <td style={{ padding: 10, verticalAlign: "top", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{formatMeta(r.meta_json)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <span style={{ color: "#8b949e", fontSize: "0.85rem" }}>
          共 {total} 条 · 第 {page} / {totalPages} 页
        </span>
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => {
            setPage((p) => Math.max(1, p - 1));
          }}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #30363d",
            background: "#21262d",
            color: "#e6edf3",
            cursor: page <= 1 || loading ? "not-allowed" : "pointer",
          }}
        >
          上一页
        </button>
        <button
          type="button"
          disabled={page >= totalPages || loading}
          onClick={() => {
            setPage((p) => p + 1);
          }}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #30363d",
            background: "#21262d",
            color: "#e6edf3",
            cursor: page >= totalPages || loading ? "not-allowed" : "pointer",
          }}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
