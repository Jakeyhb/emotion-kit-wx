/**
 * 与百炼 / 情绪解读任务相关的客户端约定（心情页与「我的」页共用）。
 *
 * reflectJobStart 建任务 → reflectJobDispatch（云端 await processReflectJob）；部分端 callFunction 仍约 3s -504003，此时走轮询 reflectJobStatus。
 * 云函数控制台超时建议 ≥120s（与百炼 HTTPS 约 110s 对齐）；reflectJobDispatch 须 slow + 合理 timeout。
 */
const CLOUD_CALL_FUNCTION_MAX_MS = 120000;

/** 轮询 reflectJobStatus 时允许的总等待（可长于单次 callFunction；首调超时后依赖轮询收尾） */
const CLOUD_AI_POLL_MAX_MS = 180000;

/**
 * 建任务 + reflectJobDispatch + 轮询状态 的墙钟上限。
 * 避免个别环境下 callFunction 长时间既不 resolve 也不 reject，导致页面 loading 永不消失。
 */
const CLOUD_AI_CLIENT_WALL_MS =
  CLOUD_AI_POLL_MAX_MS + CLOUD_CALL_FUNCTION_MAX_MS + 45000;

/**
 * 深度自检单步长调用（reflectDryRunInline / worker dryRun）的客户端墙钟，须略大于云函数控制台超时。
 * dashScopeConnectionTest 用 Promise.race 与之一致，避免 callFunction 挂死导致一直转圈。
 */
const DRY_RUN_PER_CALL_WALL_MS = CLOUD_CALL_FUNCTION_MAX_MS + 20000;

/**
 * 深度自检最多「inline 一步 + worker 一步 + runReflectJobViaClient 整链」；供「我的」/详情页 loading 兜底，避免比逻辑链还短而误关。
 */
const DRY_RUN_FULL_UI_WALL_MS =
  DRY_RUN_PER_CALL_WALL_MS * 2 + CLOUD_AI_POLL_MAX_MS + CLOUD_CALL_FUNCTION_MAX_MS + 50000;

/** @deprecated 请用 CLOUD_CALL_FUNCTION_MAX_MS；保留别名避免外部引用报错 */
const CLOUD_AI_TIMEOUT_MS = CLOUD_CALL_FUNCTION_MAX_MS;

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
      fail: () => {}
    });
  }
  // #endregion
}

function callQuickstartOpts(extra) {
  const env = envList && envList[0];
  const base = { name: 'quickstartFunctions', ...extra };
  if (env) {
    base.config = { ...(base.config || {}), env };
  }
  return base;
}

function isCloudInvokeTimeout(err) {
  const s = `${(err && err.errMsg) || ''}${(err && err.message) || ''}`;
  return /504003|TIME_LIMIT|timed out|timeout/i.test(s);
}

function normalizeReflectPair(data) {
  if (!data || typeof data !== 'object') return { whatIsWrong: '', whatToDo: '' };
  return {
    whatIsWrong: data.whatIsWrong != null ? String(data.whatIsWrong) : '',
    whatToDo: data.whatToDo != null ? String(data.whatToDo) : ''
  };
}

function withTimeout(promise, ms, message) {
  emitDebugLog('H8', 'cloudAi.js:withTimeout:entry', 'withTimeout start', { ms, message });
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) {
        emitDebugLog('H8', 'cloudAi.js:withTimeout:timer', 'withTimeout timer fired', { ms, message });
        settled = true;
        reject(new Error(message));
      }
    }, ms);
    promise.then(
      (v) => {
        if (!settled) {
          emitDebugLog('H8', 'cloudAi.js:withTimeout:resolve', 'withTimeout resolved', {});
          settled = true;
          clearTimeout(t);
          resolve(v);
        }
      },
      (e) => {
        if (!settled) {
          emitDebugLog('H8', 'cloudAi.js:withTimeout:reject', 'withTimeout rejected', {
            errMsg: (e && (e.message || e.errMsg)) || ''
          });
          settled = true;
          clearTimeout(t);
          reject(e);
        }
      }
    );
  });
}

/**
 * 轮询 reflectJobStatus，直至 done / failed 或超时。
 * @param {WechatMiniprogram.Wx} wxCloud 传入 wx（需已 initCloud）
 */
async function pollReflectJobUntilDone(wxCloud, jobId, options = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const statusCallMs = 22000;
  const maxWaitMs = Number(options.maxWaitMs) > 0 ? Number(options.maxWaitMs) : CLOUD_AI_POLL_MAX_MS;
  const deadline = Date.now() + maxWaitMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    await sleep(800);
    attempts += 1;
    let stRes;
    try {
      stRes = await withTimeout(
        wxCloud.callFunction(
          callQuickstartOpts({
            timeout: 20000,
            data: { type: 'reflectJobStatus', data: { jobId } }
          })
        ),
        statusCallMs,
        'reflectJobStatus 调用超时'
      );
    } catch (e) {
      if ((e && e.message) === 'reflectJobStatus 调用超时' && Date.now() < deadline) {
        continue;
      }
      throw e;
    }
    const s = (stRes && stRes.result) || {};
    if (attempts % 5 === 0) {
      emitDebugLog('H9', 'cloudAi.js:pollReflectJobUntilDone:status', 'status snapshot', {
        attempts,
        success: !!s.success,
        done: !!s.done,
        failed: !!s.failed
      });
    }
    if (!s.success) {
      const err = new Error(s.errMsg || '查询解读任务失败');
      throw err;
    }
    if (s.done && s.failed) {
      throw new Error(s.errMsg || '解读失败');
    }
    if (s.done && s.data) {
      return normalizeReflectPair(s.data);
    }
  }
  emitDebugLog('H9', 'cloudAi.js:pollReflectJobUntilDone:timeout', 'poll timed out', {
    maxWaitMs,
    attempts
  });
  throw new Error('解读等待超时，请稍后再试');
}

/**
 * reflectJobStart 建任务 → reflectJobDispatch；必要时轮询 reflectJobStatus。
 * @param {*} wxCloud 传入 wx.cloud
 */
async function runReflectJobViaClient(wxCloud, { kind, payload, maxWaitMs }) {
  const pollMaxMs = Number(maxWaitMs) > 0 ? Number(maxWaitMs) : CLOUD_AI_POLL_MAX_MS;
  const wallMs = pollMaxMs + CLOUD_CALL_FUNCTION_MAX_MS + 45000;
  emitDebugLog('H9', 'cloudAi.js:runReflectJobViaClient:entry', 'runReflectJobViaClient config', {
    pollMaxMs,
    wallMs,
    kind
  });
  return withTimeout(
    runReflectJobViaClientInner(wxCloud, { kind, payload, maxWaitMs: pollMaxMs }),
    wallMs,
    '解读等待超时，请稍后再试'
  );
}

async function runReflectJobViaClientInner(wxCloud, { kind, payload, maxWaitMs }) {
  emitDebugLog('H7', 'cloudAi.js:runReflectJobViaClientInner:entry', 'enter runReflectJobViaClientInner', {
    kind,
    hasPayload: !!payload
  });
  const startRes = await wxCloud.callFunction(
    callQuickstartOpts({
      timeout: 20000,
      data: { type: 'reflectJobStart', data: { kind, payload } }
    })
  );
  const sr = (startRes && startRes.result) || {};
  emitDebugLog('H7', 'cloudAi.js:runReflectJobViaClientInner:startRes', 'reflectJobStart returned', {
    success: !!sr.success,
    hasJobId: !!sr.jobId,
    errMsg: sr.errMsg || ''
  });
  if (!sr.success || !sr.jobId) {
    throw new Error(sr.errMsg || '无法创建解读任务');
  }
  const jobId = sr.jobId;

  let wRes;
  try {
    emitDebugLog('H7', 'cloudAi.js:runReflectJobViaClientInner:beforeDispatch', 'before reflectJobDispatch', {
      jobId
    });
    wRes = await wxCloud.callFunction(
      callQuickstartOpts({
        data: { type: 'reflectJobDispatch', data: { jobId } },
        slow: true,
        timeout: CLOUD_CALL_FUNCTION_MAX_MS
      })
    );
    emitDebugLog('H7', 'cloudAi.js:runReflectJobViaClientInner:dispatchRes', 'reflectJobDispatch returned', {
      hasResult: !!(wRes && wRes.result)
    });
  } catch (e) {
    emitDebugLog('H7', 'cloudAi.js:runReflectJobViaClientInner:dispatchCatch', 'reflectJobDispatch threw', {
      errMsg: (e && (e.message || e.errMsg)) || '',
      timeoutLike: !!isCloudInvokeTimeout(e)
    });
    if (isCloudInvokeTimeout(e)) {
      // 在部分环境中 reflectJobDispatch 超时后任务可能未继续执行；补触发 worker 跑同一 jobId。
      // #region agent log
      emitDebugLog('H13', 'cloudAi.js:runReflectJobViaClientInner:kickWorkerStart', 'dispatch timeout, kick worker', {
        jobId,
        kind
      });
      // #endregion
      wxCloud
        .callFunction({
          name: 'emotionReflectWorker',
          slow: true,
          timeout: CLOUD_CALL_FUNCTION_MAX_MS,
          data: { reflectJobId: jobId, forceRun: true }
        })
        .then((kickRes) => {
          const kr = (kickRes && kickRes.result) || {};
          emitDebugLog('H13', 'cloudAi.js:runReflectJobViaClientInner:kickWorkerResolved', 'kick worker resolved', {
            jobId,
            ok: !!kr.ok,
            err: kr.err || '',
            hasData: !!kr.data
          });
        })
        .catch((kickErr) => {
          emitDebugLog('H13', 'cloudAi.js:runReflectJobViaClientInner:kickWorkerRejected', 'kick worker rejected', {
            jobId,
            errMsg: (kickErr && (kickErr.message || kickErr.errMsg)) || ''
          });
        });
      return await pollReflectJobUntilDone(wxCloud, jobId, { maxWaitMs });
    }
    throw e;
  }

  const wr = (wRes && wRes.result) || {};
  if (wr.ok && wr.data) {
    return normalizeReflectPair(wr.data);
  }
  if (wr.ok && wr.skipped && wr.processing) {
    return await pollReflectJobUntilDone(wxCloud, jobId, { maxWaitMs });
  }
  if (wr.ok && wr.skipped && wr.data) {
    return normalizeReflectPair(wr.data);
  }
  if (!wr.ok) {
    throw new Error(wr.err || '解读失败');
  }
  return await pollReflectJobUntilDone(wxCloud, jobId, { maxWaitMs });
}

module.exports = {
  CLOUD_CALL_FUNCTION_MAX_MS,
  CLOUD_AI_POLL_MAX_MS,
  CLOUD_AI_CLIENT_WALL_MS,
  DRY_RUN_PER_CALL_WALL_MS,
  DRY_RUN_FULL_UI_WALL_MS,
  CLOUD_AI_TIMEOUT_MS,
  isCloudInvokeTimeout,
  withTimeout,
  pollReflectJobUntilDone,
  runReflectJobViaClient
};
