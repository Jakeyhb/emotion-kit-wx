/**
 * 与「记下心情」AI 解读相同链路：dashScopePingStart → 小程序直调 emotionReflectWorker(slow) → 必要时轮询 dashScopePingStatus。
 * 仅用于联通性检测，不写情绪库。
 *
 * @returns {Promise<{ ok: boolean, title: string, content: string }>}
 */
const {
  CLOUD_CALL_FUNCTION_MAX_MS,
  CLOUD_AI_POLL_MAX_MS,
  DRY_RUN_PER_CALL_WALL_MS,
  isCloudInvokeTimeout,
  runReflectJobViaClient,
  withTimeout
} = require('./cloudAi');
const { envList } = require('../envList');
const DEBUG_RUN_ID = 'dryrun-debug';

function emitDebugLog(hypothesisId, location, message, data) {
  // #region agent log
  const payload = {
    sessionId: '34eb79',
    runId: DEBUG_RUN_ID,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now()
  };
  if (wx && typeof wx.request === 'function') {
    wx.request({
      url: 'http://127.0.0.1:7831/ingest/6727f9c4-f2b8-4862-a603-59321ac6fb89',
      method: 'POST',
      header: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '34eb79' },
      data: payload,
      fail: () => {
        Promise.resolve()
          .then(() =>
            fetch('http://127.0.0.1:7831/ingest/6727f9c4-f2b8-4862-a603-59321ac6fb89', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '34eb79' },
              body: JSON.stringify(payload)
            })
          )
          .catch(() => {});
      }
    });
  } else {
    Promise.resolve()
      .then(() =>
        fetch('http://127.0.0.1:7831/ingest/6727f9c4-f2b8-4862-a603-59321ac6fb89', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '34eb79' },
          body: JSON.stringify(payload)
        })
      )
      .catch(() => {});
  }
  // #endregion
}

const CF_QUICK = { name: 'quickstartFunctions', timeout: 20000 };
const CF_WORKER = { name: 'emotionReflectWorker', slow: true, timeout: CLOUD_CALL_FUNCTION_MAX_MS };
const CF_QS_SLOW = { name: 'quickstartFunctions', slow: true, timeout: CLOUD_CALL_FUNCTION_MAX_MS };

function withCloudEnv(base) {
  const o = { ...base };
  const envId = envList && envList[0];
  if (envId) o.config = { ...(o.config || {}), env: envId };
  return o;
}

/** 成功弹窗补充说明：检测请求刻意要模型只回一字，避免用户误以为「解读坏了」 */
const PING_SUCCESS_NOTE =
  '\n\n说明：这是最短连通检测（云端让模型只回一个字即可），不是「我怎么了」正式解读；记下心情后才会生成长文。';

async function runDashScopeConnectionTest() {
  if (!wx.cloud) {
    return { ok: false, title: '无法测试', content: '当前未开启云开发或未初始化 wx.cloud。' };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    const startRes = await wx.cloud.callFunction({
      ...CF_QUICK,
      data: { type: 'dashScopePingStart' }
    });
    const start = startRes.result || {};
    if (!start.success || !start.pingId) {
      return {
        ok: false,
        title: '无法开始测试',
        content: start.errMsg || '请确认已部署云函数 quickstartFunctions，且 emotionReflectWorker、quickstartFunctions 均配置了 DASHSCOPE_API_KEY。'
      };
    }
    const { pingId } = start;

    try {
      const wRes = await wx.cloud.callFunction({
        ...CF_WORKER,
        data: { dashScopePingId: pingId }
      });
      const wr = (wRes && wRes.result) || {};
      if (!wr.ok) {
        return {
          ok: false,
          title: 'AI 连接失败',
          content: wr.err || 'emotionReflectWorker 未返回成功，请查看云函数日志。'
        };
      }
      if (wr.ping) {
        return {
          ok: true,
          title: 'AI 连接正常',
          content: `模型：${wr.ping.model || 'qwen3-max'}\n耗时：${wr.ping.ms}ms\n测试回包：${wr.ping.reply || '（空）'}${PING_SUCCESS_NOTE}`
        };
      }
    } catch (we) {
      console.error('emotionReflectWorker ping', we);
      if (!isCloudInvokeTimeout(we)) {
        return {
          ok: false,
          title: '调用失败',
          content: (we && we.errMsg) || (we && we.message) || String(we)
        };
      }
    }

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await sleep(900);
      const stRes = await wx.cloud.callFunction({
        ...CF_QUICK,
        data: { type: 'dashScopePingStatus', data: { pingId } }
      });
      const s = stRes.result || {};
      if (s.success && s.done && s.failed) {
        return { ok: false, title: 'AI 连接失败', content: s.errMsg || '未知错误' };
      }
      if (s.success && s.done && !s.failed) {
        return {
          ok: true,
          title: 'AI 连接正常',
          content: `模型：${s.model || 'qwen3-max'}\n耗时：${s.ms}ms\n测试回包：${s.reply || '（空）'}${PING_SUCCESS_NOTE}`
        };
      }
    }
    return {
      ok: false,
      title: '等待超时',
      content: '百炼仍未返回，请稍后再试或查看云函数 emotionReflectWorker 日志。'
    };
  } catch (e) {
    return {
      ok: false,
      title: '调用失败',
      content: (e && e.errMsg) || e.message || String(e)
    };
  }
}

const DRY_RUN_HEADER =
  '已走与「记下心情」相同的完整提示词与解析（未写入任何心情记录；每次会消耗与真实解读相近的 token）。\n\n';

function buildDryRunModalContent(whatIsWrong, whatToDo) {
  const body = `【我怎么了】\n${whatIsWrong || '暂无'}\n\n【我怎么做】\n${whatToDo || '暂无'}`;
  const full = DRY_RUN_HEADER + body;
  const max = 2800;
  if (full.length <= max) return full;
  return full.slice(0, max - 24) + '\n…(内容过长已截断)';
}

/**
 * 深度自检：优先 quickstartFunctions.reflectDryRunInline（同进程长调用，与 reflectJobRun 一致）；
 * 未部署该 type 或调用异常时再尝试 emotionReflectWorker(dryRun)，最后兜底 runReflectJobViaClient。
 * 不写 emotion_kit_records。
 * @returns {Promise<{ ok: boolean, title: string, content: string }>}
 */
function dryRunPayload(premise) {
  return {
    emotions: [{ name: '焦虑', degree: 3 }],
    question3: '（深度自检）任务偏多、连续熬夜，心里发紧。',
    premise: premise || undefined
  };
}

function modalFromPair(whatIsWrong, whatToDo) {
  const w = whatIsWrong != null ? String(whatIsWrong) : '';
  const t = whatToDo != null ? String(whatToDo) : '';
  if (!w && !t) {
    return {
      ok: false,
      title: '调用失败',
      content: '深度自检未返回解读内容，请稍后重试。'
    };
  }
  return {
    ok: true,
    title: '深度自检成功',
    content: buildDryRunModalContent(w, t)
  };
}

async function runEmotionReflectDryRun() {
  emitDebugLog('H3', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:entry', 'enter dry run helper', {
    hasCloud: !!wx.cloud
  });
  if (!wx.cloud) {
    return { ok: false, title: '无法自检', content: '当前未开启云开发或未初始化 wx.cloud。' };
  }
  const premise = (wx.getStorageSync('kit_user_premise') || '').trim();
  const payload = dryRunPayload(premise);

  /** @param {{ whatIsWrong?: string, whatToDo?: string }} pair */
  const tryQuickstartInline = async () => {
    emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:inline', 'before reflectDryRunInline', {
      hasPremise: !!premise
    });
    const inlineRes = await wx.cloud.callFunction(
      withCloudEnv({
        ...CF_QS_SLOW,
        data: { type: 'reflectDryRunInline', data: payload }
      })
    );
    const ir = (inlineRes && inlineRes.result) || {};
    const err = (ir.errMsg && String(ir.errMsg)) || '';
    if (/未知 type/.test(err)) return { skip: true };
    if (!ir.success) {
      if (/未登录|no openid|OPENID|请先登录/i.test(err)) {
        return {
          skip: false,
          out: { ok: false, title: '无法自检', content: err || '请先使用微信授权登录后再试。' }
        };
      }
      return { skip: true };
    }
    const pair = ir.data && typeof ir.data === 'object' ? ir.data : {};
    return { skip: false, out: modalFromPair(pair.whatIsWrong, pair.whatToDo) };
  };

  const tryWorker = async () => {
    emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:worker', 'before emotionReflectWorker dryRun', {
      hasPremise: !!premise
    });
    const wRes = await wx.cloud.callFunction(
      withCloudEnv({
        ...CF_WORKER,
        data: { dryRun: true, ...payload }
      })
    );
    const wr = (wRes && wRes.result) || {};
    if (!wr.ok) {
      return { ok: false, title: '调用失败', content: wr.err || 'emotionReflectWorker 未返回成功，请查看云函数日志。' };
    }
    const pair = wr.data && typeof wr.data === 'object' ? wr.data : {};
    return modalFromPair(pair.whatIsWrong, pair.whatToDo);
  };

  const tryReflectJob = async () => {
    emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:reflectJob', 'before runReflectJobViaClient', {});
    const { whatIsWrong, whatToDo } = await runReflectJobViaClient(wx.cloud, {
      kind: 'dryRun',
      maxWaitMs: CLOUD_AI_POLL_MAX_MS,
      payload: { dryRun: true, ...payload }
    });
    return modalFromPair(whatIsWrong, whatToDo);
  };

  try {
    let inline;
    try {
      inline = await withTimeout(tryQuickstartInline(), DRY_RUN_PER_CALL_WALL_MS, 'dryRun_step_timeout');
    } catch (ie) {
      emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:inlineCatch', 'reflectDryRunInline threw or wall timeout', {
        errMsg: (ie && (ie.message || ie.errMsg)) || ''
      });
      inline = { skip: true };
    }
    if (inline && !inline.skip && inline.out) {
      emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:inlineDone', 'inline path settled', {
        ok: !!inline.out.ok
      });
      return inline.out;
    }

    try {
      const out = await withTimeout(tryWorker(), DRY_RUN_PER_CALL_WALL_MS, 'dryRun_step_timeout');
      emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:workerDone', 'worker path settled', {
        ok: !!out.ok
      });
      if (out.ok) return out;
    } catch (we) {
      emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:workerCatch', 'worker dryRun threw', {
        errMsg: (we && (we.message || we.errMsg)) || ''
      });
    }

    try {
      const out = await tryReflectJob();
      emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:jobDone', 'reflectJob path settled', {
        ok: !!out.ok
      });
      return out;
    } catch (je) {
      emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:jobCatch', 'reflectJob threw', {
        errMsg: (je && (je.message || je.errMsg)) || ''
      });
      const raw = (je && je.errMsg) || (je && je.message) || String(je);
      const msg = isCloudInvokeTimeout(je)
        ? '深度自检等待超时。请重新上传部署 quickstartFunctions（需含 reflectDryRunInline）与 emotionReflectWorker，并在云控制台将超时设为 ≥120s；真机网络稳定后再试。'
        : raw;
      return { ok: false, title: '调用失败', content: msg };
    }
  } catch (e) {
    emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:catch', 'dryRun outer failed', {
      errMsg: (e && (e.message || e.errMsg)) || ''
    });
    const raw = (e && e.errMsg) || (e && e.message) || String(e);
    const msg = isCloudInvokeTimeout(e)
      ? '深度自检调用超时。请确认已部署最新 quickstartFunctions，云函数超时 ≥120s，并在网络稳定时重试。'
      : raw;
    return { ok: false, title: '调用失败', content: msg };
  }
}

module.exports = { runDashScopeConnectionTest, runEmotionReflectDryRun };
