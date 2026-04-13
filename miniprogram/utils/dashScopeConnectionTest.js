/**
 * 与「记下心情」AI 解读相同链路：dashScopePingStart → 小程序直调 emotionReflectWorker(slow) → 必要时轮询 dashScopePingStatus。
 * 仅用于联通性检测，不写情绪库。
 *
 * @returns {Promise<{ ok: boolean, title: string, content: string }>}
 */
const {
  CLOUD_AI_POLL_MAX_MS,
  CLOUD_CALL_FUNCTION_MAX_MS,
  isCloudInvokeTimeout,
  runReflectJobViaClient
} = require('./cloudAi');
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
 * 深度自检：reflectJobStart + reflectJobDispatch（与记下心情同款完整解读），不写 emotion_kit_records。
 * @returns {Promise<{ ok: boolean, title: string, content: string }>}
 */
async function runEmotionReflectDryRun() {
  emitDebugLog('H3', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:entry', 'enter dry run helper', {
    hasCloud: !!wx.cloud
  });
  if (!wx.cloud) {
    return { ok: false, title: '无法自检', content: '当前未开启云开发或未初始化 wx.cloud。' };
  }
  const premise = (wx.getStorageSync('kit_user_premise') || '').trim();
  try {
    emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:beforeClientRun', 'before runReflectJobViaClient', {
      hasPremise: !!premise
    });
    const { whatIsWrong, whatToDo } = await runReflectJobViaClient(wx.cloud, {
      kind: 'dryRun',
      /** 与记下心情一致：轮询需覆盖「首调 3s 限制 + 百炼 10～60s + 单次 status 可能慢至 ~22s」 */
      maxWaitMs: CLOUD_AI_POLL_MAX_MS,
      payload: {
        dryRun: true,
        emotions: [{ name: '焦虑', degree: 3 }],
        question3: '（深度自检）任务偏多、连续熬夜，心里发紧。',
        premise: premise || undefined
      }
    });
    emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:success', 'runReflectJobViaClient success', {
      wrongLen: String(whatIsWrong || '').length,
      todoLen: String(whatToDo || '').length
    });
    return {
      ok: true,
      title: '深度自检成功',
      content: buildDryRunModalContent(whatIsWrong, whatToDo)
    };
  } catch (e) {
    emitDebugLog('H10', 'dashScopeConnectionTest.js:runEmotionReflectDryRun:catch', 'runReflectJobViaClient failed', {
      errMsg: (e && (e.message || e.errMsg)) || ''
    });
    const msg = isCloudInvokeTimeout(e)
      ? '深度自检请求超时（当前环境存在 3 秒调用限制），已自动转轮询等待；若仍超时，请稍后重试。'
      : (e && e.errMsg) || (e && e.message) || String(e);
    return {
      ok: false,
      title: '调用失败',
      content: msg
    };
  }
}

module.exports = { runDashScopeConnectionTest, runEmotionReflectDryRun };
