const express = require("express");
const https = require("https");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8787);
const DASHSCOPE_API_KEY = String(process.env.DASHSCOPE_API_KEY || "").trim();
const DASHSCOPE_API_HOST = String(process.env.DASHSCOPE_API_HOST || "dashscope.aliyuncs.com")
  .trim()
  .replace(/^https?:\/\//, "")
  .split("/")[0];
const DASHSCOPE_MODEL = String(process.env.DASHSCOPE_MODEL || "qwen3-max").trim();
const SERVICE_TOKEN = String(process.env.SERVICE_TOKEN || "").trim();

function nowIso() {
  return new Date().toISOString();
}

function log(phase, meta) {
  const payload = { t: nowIso(), phase, ...(meta || {}) };
  try {
    console.log("[node-ai-service]", JSON.stringify(payload));
  } catch (e) {
    console.log("[node-ai-service]", phase, meta);
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
  });
});

app.post("/ai/reflect", withAuth, async (req, res) => {
  const t0 = Date.now();
  const body = req.body || {};
  const task = body.task || "chat";
  if (task !== "chat") {
    return res.status(400).json({ ok: false, errMsg: "unsupported task, only chat is allowed" });
  }
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
  log("server_start", {
    port: PORT,
    host: DASHSCOPE_API_HOST,
    model: DASHSCOPE_MODEL,
    authRequired: !!SERVICE_TOKEN,
  });
});
