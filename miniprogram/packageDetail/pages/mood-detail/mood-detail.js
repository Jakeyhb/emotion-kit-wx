const STORAGE_KEY = 'kitMoodRecords';
const toast = require('../../../utils/toast');
const { pollEmotionAiFromCloud } = require('../../../utils/pollCloudAi');
const {
  CLOUD_AI_CLIENT_WALL_MS,
  CLOUD_AI_POLL_MAX_MS,
  isCloudInvokeTimeout,
  runReflectJobViaClient
} = require('../../../utils/cloudAi');
const { runDashScopeConnectionTest, runEmotionReflectDryRun } = require('../../../utils/dashScopeConnectionTest');

const CLOUD_DEFAULT_TIMEOUT_MS = 60000;
const PENDING_STALE_MS = 90 * 1000;
const DEBUG_RUN_ID = 'dryrun-debug';
/** 与「我的」页深度自检一致：须长于 cloudAi 内层墙钟，避免先弹「等待过久」而任务仍在跑 */
const DRY_RUN_UI_WALL_MS = CLOUD_AI_CLIENT_WALL_MS + 20000;

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

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

const MOOD_COLORS = {
  very_low: '#a8b5c4', low: '#8b9cb0', neutral_low: '#7b8fa3', neutral: '#6b8cae',
  calm: '#7ba3a8', ok: '#6b9b8a', good: '#5a9a7a', unsure: '#9a9a9a'
};

const DEGREE_LABEL = { 1: '很轻', 2: '较轻', 3: '中等', 4: '较强', 5: '很强' };

/** 云同步 / 旧数据里 degree 可能是字符串，与数字比较会导致强度条全不亮 */
function clampDegree(v) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return n;
  return 3;
}

// 解析「我怎么做」中的《重点》…《/重点》为分段，用于详情页划线/高亮展示
function parseWhatToDoSegments(whatToDo) {
  if (!whatToDo || typeof whatToDo !== 'string') return [];
  const openTag = '《重点》';
  const closeTag = '《/重点》';
  const segments = [];
  let pos = 0;
  while (true) {
    const i = whatToDo.indexOf(openTag, pos);
    if (i === -1) {
      if (pos < whatToDo.length) segments.push({ type: 'normal', text: whatToDo.slice(pos) });
      break;
    }
    if (i > pos) segments.push({ type: 'normal', text: whatToDo.slice(pos, i) });
    const j = whatToDo.indexOf(closeTag, i + openTag.length);
    if (j === -1) {
      segments.push({ type: 'highlight', text: whatToDo.slice(i + openTag.length) });
      break;
    }
    segments.push({ type: 'highlight', text: whatToDo.slice(i + openTag.length, j) });
    pos = j + closeTag.length;
  }
  return segments.length ? segments : [{ type: 'normal', text: whatToDo }];
}

// 强度 1–5 对应线的颜色：越强颜色越深（同一色系）
const DEGREE_LINE_COLOR = {
  1: '#d0dcd8',  // 很轻
  2: '#a8c0b8',  // 较轻
  3: '#7a9a8e',  // 中等
  4: '#5a7a6e',  // 较强
  5: '#4a6a5a'   // 很强
};

const EMOTION_COLORS = {
  焦虑: '#8b9cb0', 愤怒: '#a87a7a', 悲伤: '#7a8a9a', 羞耻: '#9a8a7a', 内疚: '#7a7a8a',
  恐惧: '#6a7a8a', 空虚: '#8a8a8a', 愉悦: '#5a9a7a', 平静: '#7ba3a8', 委屈: '#8b8a9a',
  嫉妒: '#7a6a8a', 爱: '#9a7a7a', 感恩: '#6b9b8a', 麻木: '#9a9a9a', 其他: '#8b9cb0'
};

// 时间戳 → 中国时区 YYYY-MM-DD HH:mm
function formatChinaDateTime(ms) {
  const d = new Date(ms + CHINA_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function getRecordsArray() {
  const raw = wx.getStorageSync(STORAGE_KEY);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.entries(raw)
      .filter(([d]) => d.length === 10)
      .map(([date, r]) => ({ id: `${date}_${(r.savedAt || Date.now())}`, date, ...r }));
  }
  return [];
}

function updateRecordInStorage(id, updater) {
  const records = getRecordsArray();
  const idx = records.findIndex(r => r.id === id);
  if (idx < 0) return false;
  Object.assign(records[idx], updater(records[idx]));
  wx.setStorageSync(STORAGE_KEY, records);
  return true;
}

function normalizeRecord(record) {
  if (!record) return record;
  let tagsDisplay = '';
  if (record.tags != null) {
    if (Array.isArray(record.tags)) tagsDisplay = record.tags.join('、');
    else if (typeof record.tags === 'string') tagsDisplay = record.tags;
  }
  let emotionsDisplay = '';
  let emotionsForDisplay = []; // 用于详情页芯片展示：{ name, degreeLabel, color }
  if (record.emotions && Array.isArray(record.emotions) && record.emotions.length) {
    emotionsDisplay = record.emotions
      .map((e) => `${e.name}（${DEGREE_LABEL[clampDegree(e.degree)] || '中等'}）`)
      .join('、');
    emotionsForDisplay = record.emotions.map((e, ei) => {
      const degree = clampDegree(e.degree);
      const degreeSegments = [1, 2, 3, 4, 5].map((d) => ({
        value: d,
        lineColor: DEGREE_LINE_COLOR[d] || DEGREE_LINE_COLOR[3],
        isActive: d === degree
      }));
      return {
        rowKey: `${e.name}-${ei}`,
        name: e.name,
        degreeLabel: DEGREE_LABEL[degree] || '中等',
        color: EMOTION_COLORS[e.name] || '#7a9a8e',
        lineColor: DEGREE_LINE_COLOR[degree] || DEGREE_LINE_COLOR[3],
        degreeSegments
      };
    });
  }
  const moodColor = (record.emotions && record.emotions[0] && record.emotions[0].name)
    ? (EMOTION_COLORS[record.emotions[0].name] || '#7a9a8e')
    : (MOOD_COLORS[record.mood] || '#8b9cb0');
  let aiResult = record.aiResult;
  if (aiResult && aiResult.whatToDo) {
    const whatToDoSegments = parseWhatToDoSegments(aiResult.whatToDo);
    aiResult = { ...aiResult, whatToDoSegments };
  }
  return { ...record, tagsDisplay, emotionsDisplay, emotionsForDisplay, moodColor, aiResult };
}

function markRecordFailed(id, msg, fallbackRecord) {
  updateRecordInStorage(id, () => ({ aiStatus: 'failed', aiError: msg }));
  return normalizeRecord(getRecordsArray().find((x) => x.id === id) || fallbackRecord || null);
}

Page({
  data: {
    record: null,
    displayTime: '',
    cloudOk: false,
    aiLinkTestBusy: false,
    aiDryRunBusy: false
  },

  _pollAiTimer: null,
  _pendingCloudPolls: 0,

  onLoad(options) {
    // 先清空，避免复用页面时先闪出上一条的详情内容
    this.setData({ record: null, displayTime: '', cloudOk: !!wx.cloud });

    const id = options.id || '';
    if (!id) {
      toast.hint('这条记录找不到啦～');
      return;
    }
    const records = getRecordsArray();
    let record = records.find(r => r.id === id) || null;
    if (record) record = normalizeRecord(record);
    const displayTime = record && record.savedAt ? formatChinaDateTime(record.savedAt) : '';
    this.setData({ record, displayTime });
    this.startPollingIfPending();
  },

  onShow() {
    emitDebugLog('H11', 'mood-detail.js:onShow', 'page onShow', {});
    // 从后台切回或从其他页返回时，若当前是「生成中」则继续轮询
    this.startPollingIfPending();
  },

  onHide() {
    emitDebugLog('H11', 'mood-detail.js:onHide', 'page onHide', {
      aiDryRunBusy: !!this.data.aiDryRunBusy
    });
  },

  onUnload() {
    this.stopPolling();
  },

  startPollingIfPending() {
    this.stopPolling();
    const { record } = this.data;
    if (!record || record.aiStatus !== 'pending') return;
    const id = record.id;
    const that = this;
    that._pendingCloudPolls = 0;

    const tick = async () => {
      const records = getRecordsArray();
      const raw = records.find((r) => r.id === id);
      if (!raw) {
        that.stopPolling();
        return;
      }
      if (raw.aiStatus !== 'pending') {
        that.stopPolling();
        const next = normalizeRecord(raw);
        const displayTime = next.savedAt ? formatChinaDateTime(next.savedAt) : that.data.displayTime;
        that.setData({ record: next, displayTime });
        if (next.aiStatus === 'done') toast.success('解读好了～');
        return;
      }
      if (!wx.cloud) {
        that.stopPolling();
        const next = markRecordFailed(id, '当前环境不支持云函数，请稍后重试', raw);
        if (next) that.setData({ record: next });
        return;
      }

      const pendingAt = Number(raw.aiPendingAt || raw.savedAt || 0);
      if (pendingAt > 0 && Date.now() - pendingAt >= PENDING_STALE_MS) {
        that.stopPolling();
        const next = markRecordFailed(id, 'AI 解读等待超时，请点「重试」重新生成', raw);
        if (next) that.setData({ record: next });
        return;
      }

      const done = await that.fetchAndMergeAiStatus(id, raw);
      if (done) return;

      that._pendingCloudPolls += 1;
      if (that._pendingCloudPolls >= 50) {
        that.stopPolling();
        updateRecordInStorage(id, () => ({
          aiStatus: 'failed',
          aiError: '长时间未收到云端解读，请检查网络与云开发环境后点「重试」'
        }));
        const next = normalizeRecord(getRecordsArray().find((x) => x.id === id) || raw);
        that.setData({ record: next });
      }
    };

    void tick();
    that._pollAiTimer = setInterval(() => {
      void tick();
    }, 2500);
  },

  /** 拉一次云端解读状态并写入本地；若已终态返回 true（并已 stopPolling） */
  async fetchAndMergeAiStatus(id, rawRef) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        timeout: 20000,
        data: { type: 'getEmotionAiStatus', data: { id } }
      });
      const r = res.result || {};
      if (!r.success) {
        this.stopPolling();
        const next = markRecordFailed(id, r.errMsg || '状态查询失败，请重试', rawRef);
        this.setData({ record: next });
        return true;
      }
      if (r.success && r.done && r.failed) {
        this.stopPolling();
        const next = markRecordFailed(id, r.errMsg || '解读失败', rawRef);
        this.setData({ record: next });
        return true;
      }
      if (r.success && r.done && r.data) {
        this.stopPolling();
        const { whatIsWrong, whatToDo } = r.data;
        updateRecordInStorage(id, () => ({
          aiResult: { whatIsWrong, whatToDo },
          aiStatus: 'done',
          aiError: undefined,
          aiPendingAt: undefined
        }));
        const r2 = getRecordsArray().find((x) => x.id === id);
        if (r2 && wx.cloud) {
          wx.cloud
            .callFunction({
              name: 'quickstartFunctions',
              timeout: CLOUD_DEFAULT_TIMEOUT_MS,
              data: { type: 'upsertEmotionRecord', data: { id: r2.id, date: r2.date, record: r2 } }
            })
            .catch(() => {});
        }
        const next = normalizeRecord(getRecordsArray().find((x) => x.id === id) || rawRef);
        const displayTime = next.savedAt ? formatChinaDateTime(next.savedAt) : this.data.displayTime;
        this.setData({ record: next, displayTime });
        toast.success('解读好了～');
        return true;
      }
    } catch (e) {
      if (isCloudInvokeTimeout(e)) return false;
      this.stopPolling();
      const msg = (e && (e.message || e.errMsg)) || '状态查询失败，请重试';
      const next = markRecordFailed(id, msg, rawRef);
      this.setData({ record: next });
      return true;
    }
    return false;
  },

  stopPolling() {
    if (this._pollAiTimer) {
      clearInterval(this._pollAiTimer);
      this._pollAiTimer = null;
    }
    this._pendingCloudPolls = 0;
  },

  onReady() {
    // 等页面渲染完再滚到顶部，避免先看到底部「怎么做」
    setTimeout(() => {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    }, 50);
  },

  async retryAi() {
    const { record } = this.data;
    if (!record || !record.id) return;
    if (!wx.cloud) {
      toast.hint('当前环境不支持云函数哦');
      return;
    }

    const retryPendingAt = Date.now();
    updateRecordInStorage(record.id, () => ({ aiStatus: 'pending', aiError: undefined, aiPendingAt: retryPendingAt }));
    this.setData({ record: { ...record, aiStatus: 'pending', aiError: undefined, aiPendingAt: retryPendingAt } });

    const premise = wx.getStorageSync('kit_user_premise') || '';
    try {
      const raw = getRecordsArray().find((r) => r.id === record.id);
      if (raw) {
        await wx.cloud.callFunction({
          name: 'quickstartFunctions',
          timeout: CLOUD_DEFAULT_TIMEOUT_MS,
          data: { type: 'upsertEmotionRecord', data: { id: raw.id, date: raw.date, record: raw } }
        });
      }

      const finishOk = (whatIsWrong, whatToDo) => {
        updateRecordInStorage(record.id, () => ({
          aiResult: { whatIsWrong, whatToDo },
          aiStatus: 'done',
          aiError: undefined,
          aiPendingAt: undefined
        }));
        const r2 = getRecordsArray().find((r) => r.id === record.id);
        if (r2 && wx.cloud) {
          wx.cloud
            .callFunction({
              name: 'quickstartFunctions',
              timeout: CLOUD_DEFAULT_TIMEOUT_MS,
              data: { type: 'upsertEmotionRecord', data: { id: r2.id, date: r2.date, record: r2 } }
            })
            .catch(() => {});
        }
        const nextRec = normalizeRecord(getRecordsArray().find((r) => r.id === record.id) || record);
        const displayTime = nextRec && nextRec.savedAt ? formatChinaDateTime(nextRec.savedAt) : this.data.displayTime;
        this.setData({ record: nextRec, displayTime });
        toast.success('解读好了～');
      };

      const failRetry = (msg) => {
        updateRecordInStorage(record.id, () => ({ aiStatus: 'failed', aiError: msg, aiPendingAt: undefined }));
        const nextRec = normalizeRecord(getRecordsArray().find((r) => r.id === record.id) || record);
        this.setData({ record: nextRec });
        toast.fail(msg, 2500);
      };

      try {
        const { whatIsWrong, whatToDo } = await runReflectJobViaClient(wx.cloud, {
          kind: 'emotion',
          payload: {
            recordId: record.id,
            date: record.date,
            emotions: record.emotions,
            question3: record.question3,
            premise: (premise && premise.trim()) || undefined
          }
        });
        finishOk(whatIsWrong, whatToDo);
      } catch (aiErr) {
        try {
          const { whatIsWrong, whatToDo } = await pollEmotionAiFromCloud(record.id, {
            maxWaitMs: CLOUD_AI_POLL_MAX_MS
          });
          finishOk(whatIsWrong, whatToDo);
        } catch (pe) {
          if (isCloudInvokeTimeout(aiErr)) {
            failRetry(pe.message || '解读暂时没跟上，稍后再试哦～');
          } else {
            throw aiErr;
          }
        }
      }
    } catch (e) {
      const msg = isCloudInvokeTimeout(e)
        ? '等待超时，请稍后再试或检查网络'
        : (e.errMsg || e.message || '').indexOf('cloud function') >= 0 || (e.errMsg || '').indexOf('callFunction') >= 0
          ? '网络或服务暂时不可用，稍后再试哦～'
          : '解读暂时没跟上，稍后再试哦～';
      updateRecordInStorage(record.id, () => ({ aiStatus: 'failed', aiError: msg, aiPendingAt: undefined }));
      this.setData({ record: { ...record, aiStatus: 'failed', aiError: msg } });
      toast.fail(msg, 2500);
    }
  },

  /** 与记下心情、我的页「测试 AI 连接」相同链路，便于在「暂无解读」处单独排查 */
  async testAiLinkConnectivity() {
    if (!wx.cloud || this.data.aiLinkTestBusy || this.data.aiDryRunBusy) return;
    this.setData({ aiLinkTestBusy: true });
    wx.showLoading({ title: '检测中…', mask: true });
    try {
      const r = await runDashScopeConnectionTest();
      wx.showModal({ title: r.title, content: r.content, showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ aiLinkTestBusy: false });
    }
  },

  async testDeepReflectDryRun() {
    emitDebugLog('H1', 'mood-detail.js:testDeepReflectDryRun:entry', 'enter deep dry run', {
      hasCloud: !!wx.cloud,
      aiDryRunBusy: !!this.data.aiDryRunBusy,
      aiLinkTestBusy: !!this.data.aiLinkTestBusy,
      wallMs: CLOUD_AI_CLIENT_WALL_MS
    });
    if (!wx.cloud || this.data.aiDryRunBusy || this.data.aiLinkTestBusy) return;
    this.setData({ aiDryRunBusy: true });
    emitDebugLog('H1', 'mood-detail.js:testDeepReflectDryRun:setBusy', 'set aiDryRunBusy true', {});
    wx.showLoading({ title: '深度自检中（百炼约需 1～2 分钟）…', mask: true });
    let uiSettled = false;
    let loadingSec = 0;
    const loadingTickId = setInterval(() => {
      if (uiSettled) return;
      loadingSec += 15;
      wx.showLoading({
        title: `深度自检中（已等待 ${loadingSec}s，请勿关闭页面）…`,
        mask: true
      });
    }, 15000);
    let watchdog = null;
    const clearTimers = () => {
      clearInterval(loadingTickId);
      if (watchdog != null) clearTimeout(watchdog);
    };
    watchdog = setTimeout(() => {
      if (uiSettled) return;
      emitDebugLog('H2', 'mood-detail.js:testDeepReflectDryRun:watchdog', 'watchdog fired', {
        loadingSec
      });
      uiSettled = true;
      clearTimers();
      wx.hideLoading();
      this.setData({ aiDryRunBusy: false });
      wx.showModal({
        title: '调用失败',
        content:
          '深度自检等待过久已自动结束（可能网络卡住或云函数未返回）。请确认已部署 quickstartFunctions、云函数超时足够长，或稍后重试。',
        showCancel: false
      });
    }, DRY_RUN_UI_WALL_MS);
    emitDebugLog('H2', 'mood-detail.js:testDeepReflectDryRun:watchdogScheduled', 'watchdog scheduled', {
      timeoutMs: DRY_RUN_UI_WALL_MS
    });
    try {
      const r = await runEmotionReflectDryRun();
      emitDebugLog('H3', 'mood-detail.js:testDeepReflectDryRun:resolved', 'runEmotionReflectDryRun resolved', {
        ok: !!(r && r.ok),
        title: r && r.title
      });
      if (uiSettled) return;
      uiSettled = true;
      clearTimers();
      wx.hideLoading();
      this.setData({ aiDryRunBusy: false });
      wx.showModal({ title: r.title, content: r.content, showCancel: false });
      emitDebugLog('H12', 'mood-detail.js:testDeepReflectDryRun:modalShown', 'result modal shown', {
        ok: !!(r && r.ok),
        title: r && r.title
      });
    } catch (e) {
      emitDebugLog('H4', 'mood-detail.js:testDeepReflectDryRun:catch', 'runEmotionReflectDryRun threw', {
        errMsg: (e && (e.message || e.errMsg)) || ''
      });
      if (uiSettled) return;
      uiSettled = true;
      clearTimers();
      wx.hideLoading();
      this.setData({ aiDryRunBusy: false });
      wx.showModal({
        title: '调用失败',
        content: (e && e.message) || (e && e.errMsg) || String(e),
        showCancel: false
      });
      emitDebugLog('H12', 'mood-detail.js:testDeepReflectDryRun:modalShownCatch', 'catch modal shown', {
        errMsg: (e && (e.message || e.errMsg)) || ''
      });
    }
  }
});
