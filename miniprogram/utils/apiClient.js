/**
 * 小程序直调 emotion-kit-node-ai HTTP API 客户端。
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';
const DEFAULT_TIMEOUT_MS = 120000;

function getBaseUrl() {
  return String(wx.getStorageSync('node_ai_service_url') || DEFAULT_BASE_URL).trim();
}

function getServiceToken() {
  return String(wx.getStorageSync('node_ai_service_token') || '').trim();
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(message));
      }
    }, ms);
    promise.then(
      (v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } },
      (e) => { if (!settled) { settled = true; clearTimeout(t); reject(e); } }
    );
  });
}

function request({ method, path, data, timeoutMs }) {
  const baseUrl = getBaseUrl();
  const url = baseUrl.replace(/\/$/, '') + path;
  const token = getServiceToken();
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: method || 'GET',
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      data: data != null ? data : undefined,
      timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
      success: (res) => {
        const json = res.data || {};
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(json.errMsg || json.message || `HTTP ${res.statusCode}`));
          return;
        }
        if (!json.ok) {
          reject(new Error(json.errMsg || '请求失败'));
          return;
        }
        resolve(json);
      },
      fail: (err) => {
        reject(new Error(err && err.errMsg ? err.errMsg : '网络请求失败'));
      }
    });
  });
}

/* ========== Prompt 构建（与 emotionReflectShared.js 对齐）========== */

const WRZH_STYLE_PERSONA = `
【人物风格参考】借鉴心理科普作家武志红作品中常见的通俗表达与精神分析取向：
- 常见议题：原生家庭与关系模式、依恋与边界、情绪觉察与自我负责、潜意识动力与重复模式。结合用户记录只选最贴切的一两点，各用一两句点到为止，忌堆砌术语与长理论。
- 叙述：有「情境/联想」时先轻轻落在具体画面上，再谈内在感受与需要；没有明显关系情节时，从情绪种类与强度切入即可。
- 基调：通俗、略带叙事与解释；强调「看见自己」是改变的起点，整合内在冲突重于「立刻完美」；语气温和克制，避免说教与武断标签。
- 你不是武志红本人：勿署名、勿自称「武志红说」、勿声称代表其观点或立场。
- 【我怎么做】：用「①②③」三条组织；每条以当下可做的一小步为主，可自然带 1～2 句自我觉察或短提醒（勿另起冗长清单）。
`.trim();

function buildSystemPrompt(effectivePremise) {
  const userPremiseBlock = effectivePremise
    ? `用户补充的背景/前提（请在此前提下进行理解）：\n${effectivePremise}\n\n`
    : '';
  return (
    userPremiseBlock +
    '\n\n' +
    WRZH_STYLE_PERSONA +
    '\n\n' +
    '你在上述风格下，根据用户记录（情绪种类、强度、情境/联想）写两段回应，功能对齐「情绪手记详情」老版：帮助用户理解当下状态，再给可执行小步。不照搬用户原句、不做临床诊断、不下武断结论。\n\n' +
    '结构要求（必须严格遵守，不要前言、不要总标题、不要用 Markdown 标题符号 #）：\n' +
    '【我怎么了】\n' +
    '以「你」称呼；约 3～6 句，总字数约 120～320 字。若有情境/关系张力，先轻轻落在具体画面上，再写情绪与内在需要或重复模式；没有明显关系情节时，从情绪与强度写起即可。\n\n' +
    '【我怎么做】\n' +
    '总字数约 260～520 字。用「①」「②」「③」分三条：每条里依次包含——（1）一句接纳当下感受；（2）一个此刻就能做的微小行动（呼吸、停顿、写一句、调整身体姿势、把任务拆成更小一步等）；（3）可选半句内在提醒。三条之间语气连贯，像一篇短文里的三个小节。\n' +
    '禁止出现：找朋友倾诉、找专业人士、心理咨询、求助热线、去医院诊断等表述。\n' +
    '可选：用《重点》…《/重点》包住全段里最关键的一句提醒（只包一句，可省略）。\n\n' +
    '输出格式示例（仅结构示意，勿照抄示例文字）：\n' +
    '【我怎么了】……\n' +
    '【我怎么做】①……②……③……'
  );
}

function buildUserPrompt({ emotions, question3 }) {
  const degreeLabel = (d) =>
    d === 1 ? '很轻' : d === 2 ? '较轻' : d === 3 ? '中等' : d === 4 ? '较强' : '很强';
  const emotionLine =
    Array.isArray(emotions) && emotions.length
      ? emotions.map((e) => `${e.name}（${degreeLabel(e.degree || 3)}）`).join('、')
      : '';
  const parts = [
    emotionLine ? `情绪及强度：${emotionLine}` : '',
    question3 ? `情境/联想：${question3}` : '',
  ].filter(Boolean);
  const userDesc = parts.join('\n');
  return userDesc
    ? `请根据以下记录写解读（可读性优先，与常见情绪手记详情页篇幅相近）：\n${userDesc}`
    : '请根据用户记录写解读。';
}

/* ========== 结果解析 ========== */

function sanitizeModelOutput(raw) {
  let s = String(raw || '').trim();
  const thinkOpen = '<' + 'think' + '>';
  const thinkClose = '<' + '/' + 'think' + '>';
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
  s = s.replace(/^```[\w]*\s*/m, '').replace(/\s*```$/m, '').trim();
  return s;
}

function compactAiParagraph(s) {
  return String(s || '')
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function parseReflectResult(content) {
  const raw0 = sanitizeModelOutput(content);
  const raw = raw0.trim();
  if (!raw) {
    return { whatIsWrong: '暂无', whatToDo: '暂无' };
  }

  let whatIsWrong = '';
  let whatToDo = '';

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

  if (wrongBlock) whatIsWrong = (wrongBlock[1] || '').trim();
  if (doBlock) whatToDo = (doBlock[1] || '').trim();

  if (!wrongBlock && !doBlock) {
    const gameWrong = (raw.match(/【我怎么了】([\s\S]*?)(?:【|$)/) || [])[1];
    const gameDo =
      (raw.match(/【我怎么做】([\s\S]*?)(?:【|$)/) || [])[1] ||
      (raw.match(/【怎么做】([\s\S]*?)(?:【|$)/) || [])[1];
    if (gameWrong || gameDo) {
      whatIsWrong = (gameWrong && gameWrong.trim()) || '';
      whatToDo = (gameDo && gameDo.trim()) || '';
    }
  }

  if (!whatIsWrong && !whatToDo) {
    return { whatIsWrong: raw, whatToDo: '暂无' };
  }
  if (!whatIsWrong) whatIsWrong = '暂无';
  if (!whatToDo) whatToDo = '暂无';
  return { whatIsWrong: compactAiParagraph(whatIsWrong), whatToDo: compactAiParagraph(whatToDo) };
}

/* ========== 对外 API ========== */

/**
 * 调用 node-ai-service /ai/reflect 进行情绪解读
 * @param {{ emotions: {name:string, degree:number}[], question3?: string, premise?: string, recordId?: string }} params
 * @returns {Promise<{ whatIsWrong: string, whatToDo: string }>}
 */
async function reflectEmotion(params) {
  const { emotions, question3, premise, recordId } = params || {};
  const systemPrompt = buildSystemPrompt((premise || '').trim());
  const userPrompt = buildUserPrompt({ emotions, question3 });

  const res = await withTimeout(
    request({
      method: 'POST',
      path: '/ai/reflect',
      data: {
        task: 'chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 960,
        temperature: 0.55,
        stream: false,
        recordId: recordId || '',
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }),
    DEFAULT_TIMEOUT_MS + 15000,
    '解读等待超时，请稍后再试'
  );

  const data = (res && res.data) || {};
  const content = data.content != null ? String(data.content) : '';
  if (!content.trim()) {
    throw new Error('AI 未返回有效内容');
  }
  return parseReflectResult(content);
}

/**
 * 健康检查
 * @returns {Promise<{ ok: boolean, mysql?: boolean }>}
 */
async function healthCheck() {
  const res = await request({ method: 'GET', path: '/healthz', timeoutMs: 15000 });
  return { ok: !!(res && res.ok), mysql: !!(res && res.mysql) };
}

module.exports = {
  reflectEmotion,
  healthCheck,
  getBaseUrl,
  getServiceToken,
};
