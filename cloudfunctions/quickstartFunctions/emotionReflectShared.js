/**
 * 情绪解读核心（与老项目两段式 【我怎么了】【我怎么做】+ 详情页《重点》一致）。
 * 本文件须与 emotionReflectWorker/emotionReflectShared.js 保持内容一致（微信云各函数独立打包，不用 file: 依赖）。
 * 人物取向与 miniprogram/人物蒸馏-武志红.md 对齐；改 md 时可酌情同步 WRZH_STYLE_PERSONA。
 */
const https = require("https");
const http = require("http");

const EMOTION_COLLECTION = "emotion_kit_records";
const USER_PROFILE_COLLECTION = "emotion_kit_users";
const REFLECT_JOBS_COLLECTION = "emotion_kit_reflect_jobs";

/** 与老项目 game-time-tracker-wx emotionReflect 默认模型一致 */
const LEGACY_PROJECT_EMOTION_MODEL = "qwen3-max";

/** 云开发日志检索前缀：长耗时解读请搜 [emotionReflect] */
function reflectLog(phase, meta) {
  const base = { t: new Date().toISOString(), phase };
  try {
    console.log("[emotionReflect]", JSON.stringify(meta != null ? { ...base, ...meta } : base));
  } catch (e) {
    console.log("[emotionReflect]", phase, meta);
  }
}

const WRZH_STYLE_PERSONA = `
【人物风格参考】借鉴心理科普作家武志红作品中常见的通俗表达与精神分析取向：
- 常见议题：原生家庭与关系模式、依恋与边界、情绪觉察与自我负责、潜意识动力与重复模式。结合用户记录只选最贴切的一两点，各用一两句点到为止，忌堆砌术语与长理论。
- 叙述：有「情境/联想」时先轻轻落在具体画面上，再谈内在感受与需要；没有明显关系情节时，从情绪种类与强度切入即可。
- 基调：通俗、略带叙事与解释；强调「看见自己」是改变的起点，整合内在冲突重于「立刻完美」；语气温和克制，避免说教与武断标签。
- 你不是武志红本人：勿署名、勿自称「武志红说」、勿声称代表其观点或立场。
- 【我怎么做】：用「①②③」三条组织；每条以当下可做的一小步为主，可自然带 1～2 句自我觉察或短提醒（勿另起冗长清单）。
`.trim();

function dashScopeHost() {
  const raw = (process.env.DASHSCOPE_API_HOST || "dashscope.aliyuncs.com").trim();
  return raw.replace(/^https?:\/\//, "").split("/")[0];
}

function dashScopeModel(override) {
  const o = override && String(override).trim();
  if (o) return o;
  const m = (process.env.DASHSCOPE_MODEL || "").trim();
  return m || LEGACY_PROJECT_EMOTION_MODEL;
}

function reflectAiProvider() {
  const p = String(process.env.REFLECT_AI_PROVIDER || "auto")
    .trim()
    .toLowerCase();
  if (p === "node" || p === "dashscope" || p === "auto") return p;
  return "auto";
}

function nodeServiceEndpoint() {
  return String(process.env.NODE_AI_SERVICE_URL || "").trim();
}

function nodeServiceToken() {
  return String(process.env.NODE_AI_SERVICE_TOKEN || "").trim();
}

function pickProviderForRequest() {
  const p = reflectAiProvider();
  if (p === "node") return "node";
  if (p === "dashscope") return "dashscope";
  return nodeServiceEndpoint() ? "node" : "dashscope";
}

function parseJsonSafe(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return null;
  }
}

function callNodeAiService(task, payload) {
  const endpoint = nodeServiceEndpoint();
  if (!endpoint) {
    return Promise.reject(new Error("未配置 NODE_AI_SERVICE_URL"));
  }
  let urlObj;
  try {
    urlObj = new URL(endpoint);
  } catch (e) {
    return Promise.reject(new Error("NODE_AI_SERVICE_URL 格式无效"));
  }
  const isHttps = urlObj.protocol === "https:";
  const reqLib = isHttps ? https : http;
  if (urlObj.protocol !== "https:" && urlObj.protocol !== "http:") {
    return Promise.reject(new Error("NODE_AI_SERVICE_URL 仅支持 http/https"));
  }
  const token = nodeServiceToken();
  const body = JSON.stringify({ task, ...payload });
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const t0 = Date.now();
  reflectLog("node_service_request_start", {
    host: urlObj.host,
    path: `${urlObj.pathname || "/"}${urlObj.search || ""}`,
    task,
    bodyBytes,
  });
  return new Promise((resolve, reject) => {
    const req = reqLib.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || undefined,
        path: `${urlObj.pathname || "/"}${urlObj.search || ""}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": bodyBytes,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          const status = res.statusCode || 0;
          const json = parseJsonSafe(raw);
          if (!json) {
            reflectLog("node_service_parse_fail", { status, msTotal: Date.now() - t0 });
            reject(new Error(`Node 服务返回非 JSON（HTTP ${status}）`));
            return;
          }
          if (status < 200 || status >= 300) {
            const msg =
              json.errMsg ||
              json.message ||
              (json.error && (json.error.message || json.error.code)) ||
              `HTTP ${status}`;
            reflectLog("node_service_http_error", {
              status,
              msTotal: Date.now() - t0,
              msg: String(msg).slice(0, 240),
            });
            reject(new Error(String(msg)));
            return;
          }
          reflectLog("node_service_response_done", {
            task,
            status,
            msTotal: Date.now() - t0,
            rawBodyChars: raw.length,
          });
          resolve(json);
        });
      }
    );
    req.on("error", (err) => {
      reflectLog("node_service_socket_error", {
        task,
        msTotal: Date.now() - t0,
        err: (err && err.message) || String(err),
      });
      reject(err);
    });
    req.setTimeout(110000, () => {
      reflectLog("node_service_timeout", { task, msTotal: Date.now() - t0 });
      req.destroy();
      reject(new Error("Node 服务等待超时，请稍后重试"));
    });
    req.write(body);
    req.end();
  });
}

function dashscopeCompatibleChat(bodyObj) {
  const apiKey = process.env.DASHSCOPE_API_KEY || "";
  if (!apiKey) {
    return Promise.reject(
      new Error("未配置 DASHSCOPE_API_KEY，请在云开发控制台为该云函数配置环境变量")
    );
  }
  const body = JSON.stringify({
    ...bodyObj,
    model: dashScopeModel(bodyObj.model),
    stream: bodyObj.stream === true,
  });
  const host = dashScopeHost();
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const t0 = Date.now();
  const modelUsed = dashScopeModel(bodyObj.model);
  reflectLog("bailian_request_start", {
    host,
    model: modelUsed,
    bodyBytes,
    max_tokens: bodyObj.max_tokens,
    msgCount: Array.isArray(bodyObj.messages) ? bodyObj.messages.length : 0,
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path: "/compatible-mode/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": bodyBytes,
        },
      },
      (res) => {
        reflectLog("bailian_response_headers", {
          httpStatus: res.statusCode || 0,
          msToHeaders: Date.now() - t0,
        });
        let raw = "";
        let firstDataLogged = false;
        res.on("data", (chunk) => {
          if (!firstDataLogged) {
            firstDataLogged = true;
            reflectLog("bailian_first_chunk", { msToFirstChunk: Date.now() - t0, chunkBytes: chunk.length });
          }
          raw += chunk;
        });
        res.on("end", () => {
          const status = res.statusCode || 0;
          let json;
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch (e) {
            reflectLog("bailian_parse_json_fail", {
              msTotal: Date.now() - t0,
              httpStatus: status,
              rawHead: String(raw).slice(0, 200),
            });
            reject(
              new Error(`百炼返回非 JSON（HTTP ${status}）：${String(raw).slice(0, 240)}`)
            );
            return;
          }
          if (status < 200 || status >= 300) {
            const msg =
              (json.error && (json.error.message || json.error.code)) ||
              json.message ||
              `HTTP ${status}`;
            reflectLog("bailian_http_error", { msTotal: Date.now() - t0, httpStatus: status, msg: String(msg).slice(0, 300) });
            reject(new Error(String(msg)));
            return;
          }
          if (json.error) {
            const em = json.error.message || json.error.code || "百炼 API 返回错误";
            reflectLog("bailian_api_error_field", { msTotal: Date.now() - t0, msg: String(em).slice(0, 300) });
            reject(new Error(em));
            return;
          }
          const msgObj = json.choices && json.choices[0] && json.choices[0].message;
          let content = msgObj && msgObj.content != null ? String(msgObj.content) : "";
          if (!content.trim() && msgObj) {
            const rc = msgObj.reasoning_content || msgObj.reasoning;
            if (rc) content = String(rc);
          }
          const usage = json.usage || {};
          reflectLog("bailian_response_done", {
            msTotal: Date.now() - t0,
            model: json.model || modelUsed,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            rawBodyChars: raw.length,
            contentChars: String(content || "").length,
            usedReasoningFallback: !!(msgObj && !String(msgObj.content || "").trim() && (msgObj.reasoning_content || msgObj.reasoning)),
          });
          resolve({ content: String(content || ""), usage: json.usage, model: json.model });
        });
      }
    );
    req.on("error", (err) => {
      reflectLog("bailian_socket_error", { msTotal: Date.now() - t0, err: (err && err.message) || String(err) });
      reject(err);
    });
    req.setTimeout(110000, () => {
      reflectLog("bailian_client_timeout", { msTotal: Date.now() - t0 });
      req.destroy();
      reject(new Error("百炼接口等待超时，请稍后重试"));
    });
    req.on("finish", () => {
      reflectLog("bailian_request_body_sent", { msToSent: Date.now() - t0 });
    });
    req.write(body);
    req.end();
  });
}

const callBailianChat = (params) =>
  dashscopeCompatibleChat({
    model: params.model,
    messages: params.messages,
    max_tokens: params.max_tokens != null ? params.max_tokens : 512,
    temperature: params.temperature != null ? params.temperature : 0.7,
    stream: false,
  });

function parseNodeChatResponse(json) {
  const data = (json && json.data) || json || {};
  const content =
    data.content != null
      ? String(data.content)
      : data.text != null
        ? String(data.text)
        : data.output != null
          ? String(data.output)
          : "";
  const usage = data.usage || json.usage;
  const model = data.model || json.model;
  return { content, usage, model };
}

async function callReflectChat(params) {
  const provider = pickProviderForRequest();
  const ctx = params.context || {};
  if (provider === "node") {
    const json = await callNodeAiService("chat", {
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens != null ? params.max_tokens : 512,
      temperature: params.temperature != null ? params.temperature : 0.7,
      stream: false,
      openid: String(ctx.openid != null ? ctx.openid : "")
        .trim()
        .slice(0, 64),
      source: String(ctx.source != null ? ctx.source : "")
        .trim()
        .slice(0, 32),
      recordId: String(ctx.recordId != null ? ctx.recordId : "")
        .trim()
        .slice(0, 128),
    });
    const parsed = parseNodeChatResponse(json);
    if (!String(parsed.content || "").trim()) {
      throw new Error("Node 服务未返回有效 content");
    }
    return parsed;
  }
  return callBailianChat(params);
}

function callDashScopePingOnce(ctx = {}) {
  const openid = ctx && ctx.openid != null ? String(ctx.openid).trim() : "";
  return callReflectChat({
    model: LEGACY_PROJECT_EMOTION_MODEL,
    messages: [
      { role: "system", content: "只回复一个字：好" },
      { role: "user", content: "连通性测试" },
    ],
    max_tokens: 8,
    temperature: 0,
    context: { openid, source: "test", recordId: "" },
  }).then((r) => String(r.content || "").trim());
}

function compactAiParagraph(s) {
  return String(s || "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** 去掉模型偶发的 think 块与 markdown 围栏，便于正则解析 */
function sanitizeModelOutput(raw) {
  let s = String(raw || "").trim();
  const thinkOpen = "<" + "think" + ">";
  const thinkClose = "<" + "/" + "think" + ">";
  let pos = 0;
  while (pos < s.length) {
    const i = s.indexOf(thinkOpen, pos);
    if (i === -1) break;
    const j = s.indexOf(thinkClose, i + thinkOpen.length);
    if (j === -1) {
      s = s.slice(0, i) + s.slice(i + thinkOpen.length);
      break;
    }
    s = s.slice(0, i) + s.slice(j + thinkClose.length);
    pos = i;
  }
  s = s.trim();
  s = s.replace(/^```[\w]*\s*/m, "").replace(/\s*```$/m, "").trim();
  return s;
}

/**
 * 解析两段式解读（与老项目 + 当前详情页字段对齐）。
 * 支持：【我怎么了】/【我怎么做】、Markdown 标题、纯「我怎么了：」换行分段、半角方括号。
 */
function parseEmotionReflect(content) {
  const raw0 = sanitizeModelOutput(content);
  const raw = raw0.trim();
  if (!raw) {
    return { whatIsWrong: "暂无", whatToDo: "暂无" };
  }
  let whatIsWrong = "";
  let whatToDo = "";

  const wrongBlock =
    raw.match(/【我怎么了】\s*([\s\S]*?)(?=\n?\s*【(?:我怎么做|怎么做)】|$)/) ||
    raw.match(/(?:^|\n)\s*#{1,3}\s*我怎么了\s*[：:]?\s*([\s\S]*?)(?=\n\s*#{0,3}\s*我怎么做|$)/i) ||
    raw.match(
      /(?:^|\n)\s*\[我怎么了\]\s*[：:]?\s*([\s\S]*?)(?=\n\s*(?:\[我怎么做\]|【我怎么做】|【怎么做】)|$)/i
    ) ||
    raw.match(/(?:^|\n)\s*我怎么了\s*[：:]\s*([\s\S]*?)(?=\n\s*我怎么做\s*[：:]|$)/);
  const doBlock =
    raw.match(/【我怎么做】\s*([\s\S]*?)(?=【|$)/) ||
    raw.match(/【怎么做】\s*([\s\S]*?)(?=【|$)/) ||
    raw.match(/(?:^|\n)\s*#{1,3}\s*我怎么做\s*[：:]?\s*([\s\S]*?)$/i) ||
    raw.match(/(?:^|\n)\s*\[我怎么做\]\s*[：:]?\s*([\s\S]*?)$/i) ||
    raw.match(/(?:^|\n)\s*我怎么做\s*[：:]\s*([\s\S]*?)$/i);

  if (wrongBlock) whatIsWrong = (wrongBlock[1] || "").trim();
  if (doBlock) whatToDo = (doBlock[1] || "").trim();

  if (!wrongBlock && !doBlock) {
    const gameWrong = (raw.match(/【我怎么了】([\s\S]*?)(?:【|$)/) || [])[1];
    const gameDo =
      (raw.match(/【我怎么做】([\s\S]*?)(?:【|$)/) || [])[1] ||
      (raw.match(/【怎么做】([\s\S]*?)(?:【|$)/) || [])[1];
    if (gameWrong || gameDo) {
      whatIsWrong = (gameWrong && gameWrong.trim()) || "";
      whatToDo = (gameDo && gameDo.trim()) || "";
    }
  }

  if (!whatIsWrong && !whatToDo) {
    return { whatIsWrong: raw, whatToDo: "暂无" };
  }
  if (!whatIsWrong) whatIsWrong = "暂无";
  if (!whatToDo) whatToDo = "暂无";
  return { whatIsWrong, whatToDo };
}

async function ensureUserProfileCollection(db) {
  try {
    await db.createCollection(USER_PROFILE_COLLECTION);
  } catch (e) {}
}

async function loadAiPremiseFromProfile(db, openid) {
  if (!openid) return "";
  try {
    await ensureUserProfileCollection(db);
    const res = await db.collection(USER_PROFILE_COLLECTION).where({ openid }).limit(1).get();
    const row = res.data && res.data[0];
    const p = row && row.aiPremise != null ? String(row.aiPremise).trim() : "";
    return p;
  } catch (e) {
    console.error("loadAiPremiseFromProfile", e);
    return "";
  }
}

function buildReflectSystemPrompt(effectivePremise) {
  const userPremiseBlock = effectivePremise
    ? `用户补充的背景/前提（请在此前提下进行理解）：\n${effectivePremise}\n\n`
    : "";
  return (
    userPremiseBlock +
    "\n\n" +
    WRZH_STYLE_PERSONA +
    "\n\n" +
    "你在上述风格下，根据用户记录（情绪种类、强度、情境/联想）写两段回应，功能对齐「情绪手记详情」老版：帮助用户理解当下状态，再给可执行小步。不照搬用户原句、不做临床诊断、不下武断结论。\n\n" +
    "结构要求（必须严格遵守，不要前言、不要总标题、不要用 Markdown 标题符号 #）：\n" +
    "【我怎么了】\n" +
    "以「你」称呼；约 3～6 句，总字数约 120～320 字。若有情境/关系张力，先轻轻落在具体画面上，再写情绪与内在需要或重复模式；没有明显关系情节时，从情绪与强度写起即可。\n\n" +
    "【我怎么做】\n" +
    "总字数约 260～520 字。用「①」「②」「③」分三条：每条里依次包含——（1）一句接纳当下感受；（2）一个此刻就能做的微小行动（呼吸、停顿、写一句、调整身体姿势、把任务拆成更小一步等）；（3）可选半句内在提醒。三条之间语气连贯，像一篇短文里的三个小节。\n" +
    "禁止出现：找朋友倾诉、找专业人士、心理咨询、求助热线、去医院诊断等表述。\n" +
    "可选：用《重点》…《/重点》包住全段里最关键的一句提醒（只包一句，可省略）。\n\n" +
    "输出格式示例（仅结构示意，勿照抄示例文字）：\n" +
    "【我怎么了】……\n" +
    "【我怎么做】①……②……③……"
  );
}

/**
 * 百炼调用 + 解析；不写库。供正式解读、dryRun、emotionReflectWorker 直连接口共用。
 */
async function runReflectInterpretationCore(db, openid, { emotions, question3, premise, source, recordId }) {
  const tInterpret = Date.now();
  let effectivePremise = premise && String(premise).trim() ? String(premise).trim() : "";
  if (!effectivePremise) {
    effectivePremise = await loadAiPremiseFromProfile(db, openid);
  }
  const degreeLabel = (d) =>
    d === 1 ? "很轻" : d === 2 ? "较轻" : d === 3 ? "中等" : d === 4 ? "较强" : "很强";
  const emotionLine =
    Array.isArray(emotions) && emotions.length
      ? emotions.map((e) => `${e.name}（${degreeLabel(e.degree || 3)}）`).join("、")
      : "";
  const userDesc = [
    emotionLine ? `情绪及强度：${emotionLine}` : "",
    question3 ? `情境/联想：${question3}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = buildReflectSystemPrompt(effectivePremise);
  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: userDesc
        ? `请根据以下记录写解读（可读性优先，与常见情绪手记详情页篇幅相近）：\n${userDesc}`
        : "请根据用户记录写解读。",
    },
  ];

  reflectLog("interpret_context", {
    msAfterPremise: Date.now() - tInterpret,
    openidTail: openid ? String(openid).slice(-6) : "",
    emotionCount: Array.isArray(emotions) ? emotions.length : 0,
    userDescChars: userDesc.length,
    systemPromptChars: systemPrompt.length,
    hasPremise: !!effectivePremise,
  });

  const src =
    source != null && String(source).trim()
      ? String(source).trim().slice(0, 32)
      : "emotion";
  const rid = recordId != null ? String(recordId).trim().slice(0, 128) : "";
  const { content } = await callReflectChat({
    messages,
    model: LEGACY_PROJECT_EMOTION_MODEL,
    max_tokens: 960,
    temperature: 0.55,
    context: {
      openid: openid || "",
      source: src,
      recordId: rid,
    },
  });
  let { whatIsWrong, whatToDo } = parseEmotionReflect(content);
  whatIsWrong = compactAiParagraph(whatIsWrong);
  whatToDo = compactAiParagraph(whatToDo);
  reflectLog("interpret_done", {
    msTotal: Date.now() - tInterpret,
    whatIsWrongChars: whatIsWrong.length,
    whatToDoChars: whatToDo.length,
    rawModelContentChars: String(content || "").length,
  });
  return { whatIsWrong, whatToDo };
}

/**
 * 执行 reflect 任务文档（openid 以任务文档为准）。
 * @param {import('wx-server-sdk').DB.Database} db 已 init 的 cloud.database()
 */
async function processReflectJob(db, jobId, options = {}) {
  const id = jobId != null ? String(jobId).trim() : "";
  if (!id) return { ok: false, err: "missing reflectJobId" };
  const tJob = Date.now();

  let job;
  try {
    const one = await db.collection(REFLECT_JOBS_COLLECTION).doc(id).get();
    job = one.data;
  } catch (e) {
    console.error("reflect job doc missing", id, e);
    reflectLog("job_load_fail", { jobId: id, err: (e && e.message) || String(e) });
    return { ok: false, err: "job not found" };
  }
  if (!job) return { ok: false, err: "job not found" };
  if (job.status === "done") {
    const r = job.result;
    if (r && (r.whatIsWrong != null || r.whatToDo != null)) {
      reflectLog("job_skip_already_done", { jobId: id, ms: Date.now() - tJob });
      return {
        ok: true,
        skipped: true,
        data: {
          whatIsWrong: r.whatIsWrong != null ? String(r.whatIsWrong) : "",
          whatToDo: r.whatToDo != null ? String(r.whatToDo) : "",
        },
      };
    }
    reflectLog("job_skip_done_no_result", { jobId: id, ms: Date.now() - tJob });
    return { ok: true, skipped: true };
  }
  if (job.status === "failed") {
    reflectLog("job_skip_failed", { jobId: id, error: job.error });
    return { ok: false, err: job.error || "failed" };
  }
  if (job.status === "processing") {
    if (!(options && options.forceRun)) {
      reflectLog("job_skip_processing", { jobId: id, ms: Date.now() - tJob });
      return { ok: true, skipped: true, processing: true };
    }
    reflectLog("job_force_takeover_processing", { jobId: id, ms: Date.now() - tJob });
    job.status = "pending";
  }
  if (job.status !== "pending") return { ok: false, err: "bad job status" };

  const openidFromJob = job.openid;
  if (!openidFromJob) return { ok: false, err: "job missing openid" };

  reflectLog("job_run_start", {
    jobId: id,
    kind: job.kind,
    openidTail: String(openidFromJob).slice(-6),
    recordId: job.payload && job.payload.recordId != null ? String(job.payload.recordId).slice(0, 40) : undefined,
  });

  try {
    await db.collection(REFLECT_JOBS_COLLECTION).doc(id).update({
      data: { status: "processing", updatedAt: new Date() },
    });
  } catch (e) {
    console.error("reflect job mark processing", e);
  }

  try {
    if (job.kind === "dryRun") {
      const p = job.payload || {};
      const emotions =
        Array.isArray(p.emotions) && p.emotions.length > 0
          ? p.emotions
          : [{ name: "焦虑", degree: 3 }];
      const question3 =
        p.question3 != null && String(p.question3).trim()
          ? String(p.question3).trim()
          : "（深度自检）任务偏多、连续熬夜，心里发紧。";
      const data = await runReflectInterpretationCore(db, openidFromJob, {
        emotions,
        question3,
        premise: p.premise,
        source: "origin",
        recordId: "",
      });
      await db.collection(REFLECT_JOBS_COLLECTION).doc(id).update({
        data: { status: "done", result: data, updatedAt: new Date() },
      });
      reflectLog("job_dryrun_done", { jobId: id, msTotal: Date.now() - tJob });
      return { ok: true, data };
    }

    if (job.kind === "emotion") {
      const p = job.payload || {};
      const recordKey = p.recordId != null ? String(p.recordId).trim() : "";
      if (!recordKey) throw new Error("missing recordId in job");
      let { whatIsWrong, whatToDo } = await runReflectInterpretationCore(db, openidFromJob, {
        emotions: p.emotions,
        question3: p.question3,
        premise: p.premise,
        source: "emotion",
        recordId: recordKey,
      });
      const col = db.collection(EMOTION_COLLECTION);
      const _ = db.command;
      const upd = await col.where({ openid: openidFromJob, id: recordKey }).update({
        data: {
          aiResult: { whatIsWrong, whatToDo },
          aiReflectError: _.remove(),
          updatedAt: new Date(),
        },
      });
      const updated = (upd && upd.stats && upd.stats.updated) || 0;
      if (updated < 1) {
        const msg =
          "未写入解读：云端没有匹配到本条记录。请先在当前页完成一次同步（记下后已自动上传），或检查云环境是否与小程序一致。";
        reflectLog("job_emotion_record_miss", { jobId: id, recordKey, msTotal: Date.now() - tJob });
        await db.collection(REFLECT_JOBS_COLLECTION).doc(id).update({
          data: { status: "failed", error: msg, updatedAt: new Date() },
        });
        return { ok: false, err: msg };
      }
      await db.collection(REFLECT_JOBS_COLLECTION).doc(id).update({
        data: {
          status: "done",
          result: { whatIsWrong, whatToDo },
          updatedAt: new Date(),
        },
      });
      reflectLog("job_emotion_done", { jobId: id, recordKey, updated, msTotal: Date.now() - tJob });
      return { ok: true, data: { whatIsWrong, whatToDo } };
    }

    await db.collection(REFLECT_JOBS_COLLECTION).doc(id).update({
      data: { status: "failed", error: "unknown kind", updatedAt: new Date() },
    });
    reflectLog("job_unknown_kind", { jobId: id, kind: job.kind });
    return { ok: false, err: "unknown kind" };
  } catch (e) {
    console.error("processReflectJob", id, e);
    reflectLog("job_error", { jobId: id, kind: job.kind, msTotal: Date.now() - tJob, err: (e && e.message) || String(e) });
    const msg = e.message || "AI 暂时不可用";
    try {
      await db.collection(REFLECT_JOBS_COLLECTION).doc(id).update({
        data: { status: "failed", error: msg, updatedAt: new Date() },
      });
    } catch (err) {
      console.error("processReflectJob persist fail", err);
    }
    try {
      if (job.kind === "emotion") {
        const p = job.payload || {};
        const rk = p.recordId != null ? String(p.recordId).trim() : "";
        if (rk) {
          await db
            .collection(EMOTION_COLLECTION)
            .where({ openid: openidFromJob, id: rk })
            .update({
              data: { aiReflectError: msg, updatedAt: new Date() },
            });
        }
      }
    } catch (err2) {
      console.error("processReflectJob emotion err persist", err2);
    }
    return { ok: false, err: msg };
  }
}

module.exports = {
  EMOTION_COLLECTION,
  USER_PROFILE_COLLECTION,
  REFLECT_JOBS_COLLECTION,
  LEGACY_PROJECT_EMOTION_MODEL,
  parseEmotionReflect,
  compactAiParagraph,
  runReflectInterpretationCore,
  processReflectJob,
  callDashScopePingOnce,
};
