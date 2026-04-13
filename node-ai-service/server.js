const express = require("express");
const https = require("https");
const fs = require("fs");
const path = require("path");
const db = require("./db");

const app = express();
app.use(express.json({ limit: "1mb" }));

const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();
if (CORS_ORIGIN) {
  const cors = require("cors");
  const origins = CORS_ORIGIN.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(cors({ origin: origins.length === 1 ? origins[0] : origins, credentials: true }));
}

const PORT = Number(process.env.PORT || 8787);
const DASHSCOPE_API_KEY = String(process.env.DASHSCOPE_API_KEY || "").trim();
const DASHSCOPE_API_HOST = String(process.env.DASHSCOPE_API_HOST || "dashscope.aliyuncs.com")
  .trim()
  .replace(/^https?:\/\//, "")
  .split("/")[0];
const DASHSCOPE_MODEL = String(process.env.DASHSCOPE_MODEL || "qwen3-max").trim();
const SERVICE_TOKEN = String(process.env.SERVICE_TOKEN || "").trim();
/** 仅用于 /admin 日志页；未设置时与 SERVICE_TOKEN 相同 */
const LOG_ADMIN_TOKEN = String(process.env.LOG_ADMIN_TOKEN || "").trim();
const LOG_MAX_FILE_BYTES = Math.min(
  Math.max(Number(process.env.LOG_MAX_FILE_BYTES) || 2 * 1024 * 1024, 256 * 1024),
  10 * 1024 * 1024
);
const LOG_READ_MAX_LINES = Math.min(Math.max(Number(process.env.LOG_READ_MAX_LINES) || 500, 50), 10000);

const LOG_DIR = path.join(__dirname, "logs");
const APP_LOG_FILE = path.join(LOG_DIR, "app.log");
const REACT_ADMIN_DIR = path.join(__dirname, "public", "log-admin");

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {}
}

function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(APP_LOG_FILE)) return;
    const st = fs.statSync(APP_LOG_FILE);
    if (st.size <= LOG_MAX_FILE_BYTES) return;
    const backup = `${APP_LOG_FILE}.1`;
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
    fs.renameSync(APP_LOG_FILE, backup);
  } catch (e) {}
}

function appendFileLog(line) {
  ensureLogDir();
  rotateLogIfNeeded();
  fs.appendFile(APP_LOG_FILE, `${line}\n`, () => {});
}

function nowIso() {
  return new Date().toISOString();
}

function log(phase, meta) {
  const payload = { t: nowIso(), phase, ...(meta || {}) };
  try {
    const s = JSON.stringify(payload);
    console.log("[node-ai-service]", s);
    appendFileLog(s);
    db.insertLogRow({
      phase: String(payload.phase || phase || "").slice(0, 128),
      level: "info",
      meta_json: payload,
      created_at: new Date(payload.t),
    });
  } catch (e) {
    console.log("[node-ai-service]", phase, meta);
    appendFileLog(JSON.stringify({ t: nowIso(), phase: "log_stringify_fail", err: String(e) }));
  }
}

function withAuth(req, res, next) {
  if (!SERVICE_TOKEN) return next();
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, errMsg: "missing bearer token" });
  }
  const token = auth.slice("Bearer ".length).trim();
  if (token !== SERVICE_TOKEN) {
    return res.status(403).json({ ok: false, errMsg: "bad token" });
  }
  return next();
}

function adminToken() {
  return LOG_ADMIN_TOKEN || SERVICE_TOKEN;
}

function withAdminAuth(req, res, next) {
  const need = adminToken();
  if (!need) {
    return res.status(503).json({
      ok: false,
      errMsg: "未配置 SERVICE_TOKEN；请先设置 SERVICE_TOKEN 后再使用日志页",
    });
  }
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, errMsg: "missing bearer token" });
  }
  const token = auth.slice("Bearer ".length).trim();
  if (token !== need) {
    return res.status(403).json({ ok: false, errMsg: "bad token" });
  }
  return next();
}

function readTailLines(filePath, maxLines) {
  if (!fs.existsSync(filePath)) {
    return { lines: [], truncated: false, totalBytes: 0 };
  }
  const stat = fs.statSync(filePath);
  const totalBytes = stat.size;
  const maxRead = Math.min(totalBytes, 1024 * 1024);
  const fd = fs.openSync(filePath, "r");
  const start = Math.max(0, totalBytes - maxRead);
  const buf = Buffer.alloc(totalBytes - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  let text = buf.toString("utf8");
  const truncated = start > 0;
  if (truncated && !text.startsWith("\n")) {
    const firstNl = text.indexOf("\n");
    if (firstNl !== -1) text = text.slice(firstNl + 1);
  }
  const allLines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const lines = allLines.length > maxLines ? allLines.slice(-maxLines) : allLines;
  return { lines, truncated, totalBytes };
}

function dashscopeCompatibleChat({ model, messages, max_tokens, temperature, stream }) {
  if (!DASHSCOPE_API_KEY) {
    return Promise.reject(new Error("server missing DASHSCOPE_API_KEY"));
  }
  const body = JSON.stringify({
    model: model || DASHSCOPE_MODEL,
    messages: Array.isArray(messages) ? messages : [],
    max_tokens: Number.isFinite(Number(max_tokens)) ? Number(max_tokens) : 512,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.7,
    stream: stream === true,
  });
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: DASHSCOPE_API_HOST,
        path: "/compatible-mode/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
          "Content-Length": bodyBytes,
        },
      },
      (resp) => {
        let raw = "";
        resp.on("data", (chunk) => {
          raw += chunk;
        });
        resp.on("end", () => {
          const status = resp.statusCode || 0;
          let json = {};
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch (e) {
            return reject(new Error(`dashscope returned non-json, status=${status}`));
          }
          if (status < 200 || status >= 300) {
            const msg =
              (json.error && (json.error.message || json.error.code)) ||
              json.message ||
              `HTTP ${status}`;
            return reject(new Error(String(msg)));
          }
          if (json.error) {
            return reject(new Error(json.error.message || json.error.code || "dashscope api error"));
          }
          const msgObj = json.choices && json.choices[0] && json.choices[0].message;
          let content = msgObj && msgObj.content != null ? String(msgObj.content) : "";
          if (!content.trim() && msgObj) {
            const reasoning = msgObj.reasoning_content || msgObj.reasoning;
            if (reasoning) content = String(reasoning);
          }
          log("dashscope_done", {
            msTotal: Date.now() - t0,
            status,
            contentChars: content.length,
            model: json.model || model || DASHSCOPE_MODEL,
          });
          return resolve({ content, usage: json.usage, model: json.model || model || DASHSCOPE_MODEL });
        });
      }
    );
    req.on("error", (err) => {
      reject(err);
    });
    req.setTimeout(110000, () => {
      req.destroy();
      reject(new Error("dashscope timeout"));
    });
    req.write(body);
    req.end();
  });
}

app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    service: "emotion-kit-node-ai-service",
    now: nowIso(),
    model: DASHSCOPE_MODEL,
    host: DASHSCOPE_API_HOST,
    authRequired: !!SERVICE_TOKEN,
    adminLog: !!adminToken(),
    mysql: db.mysqlEnabled(),
  });
});

app.get("/api/logs/meta", withAdminAuth, (req, res) => {
  res.json({
    ok: true,
    mysql: db.mysqlEnabled(),
  });
});

app.get("/api/logs", withAdminAuth, async (req, res) => {
  if (!db.mysqlEnabled()) {
    return res.status(503).json({
      ok: false,
      errMsg: "MySQL 未配置：请设置 MYSQL_HOST 等环境变量，并执行 schema.sql 建表",
    });
  }
  const page = parseInt(String(req.query.page || "1"), 10) || 1;
  const pageSize = parseInt(String(req.query.pageSize || "50"), 10) || 50;
  const phase = req.query.phase != null ? String(req.query.phase) : "";
  const from = req.query.from || null;
  const to = req.query.to || null;
  try {
    const result = await db.queryLogs({ page, pageSize, phase, from, to });
    res.json({ ok: true, ...result });
  } catch (e) {
    const errMsg = (e && e.message) || String(e);
    res.status(500).json({ ok: false, errMsg });
  }
});

app.get("/admin/api/logs", withAdminAuth, (req, res) => {
  const n = Math.min(
    LOG_READ_MAX_LINES,
    Math.max(50, parseInt(String(req.query.lines || "300"), 10) || 300)
  );
  const { lines, truncated, totalBytes } = readTailLines(APP_LOG_FILE, n);
  res.json({
    ok: true,
    file: path.basename(APP_LOG_FILE),
    lines,
    lineCount: lines.length,
    truncated,
    totalBytes,
    maxLines: n,
  });
});

if (fs.existsSync(path.join(REACT_ADMIN_DIR, "index.html"))) {
  app.use("/log-admin", express.static(REACT_ADMIN_DIR));
  app.get("/log-admin", (req, res) => res.redirect(302, "/log-admin/"));
}

app.get("/admin", (req, res) => {
  if (fs.existsSync(path.join(REACT_ADMIN_DIR, "index.html"))) {
    return res.redirect(302, "/log-admin/");
  }
  res.type("html").send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>emotion-kit-ai 日志</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0f1419; color: #e6edf3; min-height: 100vh; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 20px 16px 40px; }
  h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 8px; }
  .sub { color: #8b949e; font-size: 0.85rem; margin-bottom: 16px; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
  input[type="password"] { flex: 1; min-width: 200px; padding: 10px 12px; border: 1px solid #30363d; border-radius: 8px; background: #161b22; color: #e6edf3; }
  button { padding: 10px 16px; border: 0; border-radius: 8px; background: #238636; color: #fff; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
  pre { margin: 0; padding: 14px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; font-size: 12px; line-height: 1.45; overflow: auto; max-height: 70vh; white-space: pre-wrap; word-break: break-all; }
  .err { color: #f85149; margin-top: 8px; font-size: 0.9rem; }
  .meta { color: #8b949e; font-size: 0.8rem; margin-bottom: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>emotion-kit-ai 日志</h1>
  <p class="sub">使用与接口相同的 Bearer Token（默认即 SERVICE_TOKEN；也可单独设置 LOG_ADMIN_TOKEN）。仅建议在 HTTPS 或内网使用。</p>
  <div class="row">
    <input id="tok" type="password" placeholder="粘贴 SERVICE_TOKEN 或 LOG_ADMIN_TOKEN" autocomplete="off"/>
    <button type="button" id="save">保存到本地</button>
    <button type="button" id="go" class="secondary">拉取日志</button>
  </div>
  <div class="row">
    <label style="color:#8b949e;font-size:0.85rem">行数</label>
    <input id="lines" type="number" min="50" max="10000" value="300" style="width:100px;padding:8px;border-radius:8px;border:1px solid #30363d;background:#161b22;color:#e6edf3"/>
  </div>
  <div id="meta" class="meta"></div>
  <div id="err" class="err"></div>
  <pre id="out">（先输入 Token 并点击「拉取日志」）</pre>
</div>
<script>
(function(){
  var KEY = 'emotion_kit_ai_admin_token';
  var tok = document.getElementById('tok');
  var out = document.getElementById('out');
  var err = document.getElementById('err');
  var meta = document.getElementById('meta');
  var linesEl = document.getElementById('lines');
  try { var s = localStorage.getItem(KEY); if (s) tok.value = s; } catch(e) {}
  document.getElementById('save').onclick = function(){
    try { localStorage.setItem(KEY, tok.value.trim()); err.textContent = '已保存'; } catch(e) { err.textContent = '无法保存: ' + e; }
  };
  document.getElementById('go').onclick = function(){
    err.textContent = '';
    meta.textContent = '';
    var t = tok.value.trim();
    if (!t) { err.textContent = '请先填写 Token'; return; }
    var n = parseInt(linesEl.value, 10) || 300;
    out.textContent = '加载中…';
    fetch('/admin/api/logs?lines=' + encodeURIComponent(n), {
      headers: { 'Authorization': 'Bearer ' + t }
    }).then(function(r){
      return r.json().then(function(j){ return { ok: r.ok, status: r.status, j: j }; });
    }).then(function(x){
      if (!x.ok || !x.j || !x.j.ok) {
        var msg = (x.j && x.j.errMsg) ? x.j.errMsg : ('HTTP ' + x.status);
        err.textContent = msg;
        out.textContent = '';
        return;
      }
      meta.textContent = '文件: ' + (x.j.file || '') + ' · 行数: ' + x.j.lineCount + (x.j.truncated ? ' · 仅显示文件末尾（已截断）' : '');
      out.textContent = (x.j.lines || []).join(String.fromCharCode(10));
    }).catch(function(e){
      err.textContent = String(e.message || e);
      out.textContent = '';
    });
  };
})();
</script>
</body>
</html>`);
});

app.post("/ai/reflect", withAuth, async (req, res) => {
  const t0 = Date.now();
  const body = req.body || {};
  const task = body.task || "chat";
  if (task !== "chat") {
    return res.status(400).json({ ok: false, errMsg: "unsupported task, only chat is allowed" });
  }
  log("reflect_request", {
    msgCount: Array.isArray(body.messages) ? body.messages.length : 0,
    max_tokens: body.max_tokens,
    model: body.model || "",
  });
  try {
    const result = await dashscopeCompatibleChat({
      model: body.model,
      messages: body.messages,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      stream: body.stream,
    });
    return res.json({
      ok: true,
      data: {
        content: result.content || "",
        usage: result.usage,
        model: result.model || body.model || DASHSCOPE_MODEL,
      },
      ms: Date.now() - t0,
    });
  } catch (e) {
    const errMsg = (e && e.message) || String(e);
    log("reflect_error", { ms: Date.now() - t0, errMsg });
    return res.status(502).json({ ok: false, errMsg });
  }
});

app.use((err, req, res, next) => {
  const errMsg = (err && err.message) || "internal server error";
  log("unhandled_error", { errMsg });
  res.status(500).json({ ok: false, errMsg });
});

app.listen(PORT, () => {
  ensureLogDir();
  log("server_start", {
    port: PORT,
    host: DASHSCOPE_API_HOST,
    model: DASHSCOPE_MODEL,
    authRequired: !!SERVICE_TOKEN,
    adminLog: !!adminToken(),
    logFile: APP_LOG_FILE,
    mysql: db.mysqlEnabled(),
    reactAdmin: fs.existsSync(path.join(REACT_ADMIN_DIR, "index.html")),
  });
});
