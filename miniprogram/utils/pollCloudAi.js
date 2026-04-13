/**
 * 轮询云端 emotion_kit_records 上的 AI 结果（兜底：主流程为小程序直调 emotionReflectWorker；超时或旧版仍可能走轮询）。
 */
const { CLOUD_AI_POLL_MAX_MS } = require('./cloudAi');

function pollEmotionAiFromCloud(recordId, options) {
  const intervalMs = (options && options.intervalMs) || 2500;
  const maxWaitMs = (options && options.maxWaitMs) || CLOUD_AI_POLL_MAX_MS;
  const deadline = Date.now() + maxWaitMs;

  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error('云端解读超时，请稍后在详情页重试'));
        return;
      }
      try {
        const res = await wx.cloud.callFunction({
          name: 'quickstartFunctions',
          timeout: 25000,
          data: { type: 'getEmotionAiStatus', data: { id: recordId } }
        });
        const r = res.result || {};
        if (r.success && r.failed) {
          reject(new Error(r.errMsg || 'AI 解读失败'));
          return;
        }
        if (r.success && r.done && r.data) {
          resolve(r.data);
          return;
        }
      } catch (e) {
        /* 单次查询失败则继续轮询 */
      }
      setTimeout(tick, intervalMs);
    };
    setTimeout(tick, 600);
  });
}

module.exports = {
  pollEmotionAiFromCloud
};
