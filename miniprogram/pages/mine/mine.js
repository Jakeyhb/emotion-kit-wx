const PREMISE_STORAGE_KEY = 'kit_user_premise';
const AVATAR_STORAGE_KEY = 'kit_user_avatar';
const NICK_STORAGE_KEY = 'kit_user_nickname';
const { envList } = require('../../envList');
const { CLOUD_AI_CLIENT_WALL_MS } = require('../../utils/cloudAi');
const { runDashScopeConnectionTest, runEmotionReflectDryRun } = require('../../utils/dashScopeConnectionTest');
const {
  getUserProfileFromCloud,
  mergeCloudProfileToLocal,
  upsertUserProfileToCloud
} = require('../../utils/userProfileCloud');

function persistAvatarPath(avatarUrl, cb) {
  if (!avatarUrl) {
    cb && cb('');
    return;
  }
  const done = (path) => {
    wx.setStorageSync(AVATAR_STORAGE_KEY, path);
    cb && cb(path);
  };
  if (avatarUrl.indexOf('http') === 0) {
    wx.downloadFile({
      url: avatarUrl,
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          wx.saveFile({
            tempFilePath: res.tempFilePath,
            success: (r) => done(r.savedFilePath),
            fail: () => done(res.tempFilePath)
          });
        } else done(avatarUrl);
      },
      fail: () => done(avatarUrl)
    });
    return;
  }
  wx.saveFile({
    tempFilePath: avatarUrl,
    success: (r) => done(r.savedFilePath),
    fail: () => done(avatarUrl)
  });
}

Page({
  data: {
    premise: '',
    cloudOk: false,
    cloudEnvId: envList[0] || '',
    cloudInitBusy: false,
    aiPingBusy: false,
    deepReflectBusy: false,
    showPremiseEdit: false,
    premiseDraft: '',
    avatarUrl: '',
    nickName: ''
  },

  onShow() {
    const cloudOk = !!wx.cloud;
    const premise = wx.getStorageSync(PREMISE_STORAGE_KEY) || '';
    const avatarUrl = wx.getStorageSync(AVATAR_STORAGE_KEY) || '';
    const nickName = wx.getStorageSync(NICK_STORAGE_KEY) || '';
    this.setData({ cloudOk, premise, avatarUrl, nickName });
    if (wx.cloud) {
      getUserProfileFromCloud()
        .then((p) => {
          if (!p) return;
          mergeCloudProfileToLocal(p);
          this.setData({
            premise: wx.getStorageSync(PREMISE_STORAGE_KEY) || '',
            nickName: wx.getStorageSync(NICK_STORAGE_KEY) || ''
          });
        })
        .catch(() => {});
    }
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail || {};
    if (!avatarUrl) return;
    persistAvatarPath(avatarUrl, (path) => {
      this.setData({ avatarUrl: path });
      wx.showToast({ title: '头像已更新', icon: 'success' });
    });
  },

  /** 同步微信昵称：点键盘上方快捷昵称时常不触发有效 blur，需依赖 bindchange */
  syncNicknameStorageAndCloud(raw) {
    const v = raw != null ? String(raw).trim().slice(0, 32) : '';
    wx.setStorageSync(NICK_STORAGE_KEY, v);
    if (this.data.nickName !== v) this.setData({ nickName: v });
    upsertUserProfileToCloud({ nickName: v }).catch(() => {});
  },

  onNicknameChange(e) {
    const v = (e.detail && e.detail.value) != null ? e.detail.value : this.data.nickName;
    this.syncNicknameStorageAndCloud(v);
  },

  onNicknameBlur(e) {
    const v = (e.detail && e.detail.value) != null ? e.detail.value : this.data.nickName;
    this.syncNicknameStorageAndCloud(v);
  },

  onNicknameConfirm(e) {
    const v = (e.detail && e.detail.value) != null ? e.detail.value : this.data.nickName;
    this.syncNicknameStorageAndCloud(v);
  },

  onNicknameReview(e) {
    const { pass } = (e && e.detail) || {};
    if (pass === false) {
      wx.showToast({ title: '该昵称不可用，请换一个', icon: 'none' });
    }
  },

  openPremise() {
    this.setData({
      showPremiseEdit: true,
      premiseDraft: this.data.premise || ''
    });
  },

  closePremise() {
    this.setData({ showPremiseEdit: false, premiseDraft: '' });
  },

  onPremiseInput(e) {
    this.setData({ premiseDraft: (e.detail && e.detail.value) || '' });
  },

  savePremise() {
    const v = (this.data.premiseDraft || '').trim();
    wx.setStorageSync(PREMISE_STORAGE_KEY, v);
    this.setData({ premise: v, showPremiseEdit: false, premiseDraft: '' });
    upsertUserProfileToCloud({ aiPremise: v }).catch(() => {});
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  noop() {},

  /** 供 WXML bindtap 绑定（避免部分环境下 van-cell 的 bind:click 找不到页面方法） */
  onAiPingTap() {
    this.testDashScopePing();
  },

  onDeepReflectTap() {
    this.runDeepReflectSelfTest();
  },

  onInitCloudTap() {
    this.initCloudEnv();
  },

  async testDashScopePing() {
    if (!wx.cloud || this.data.aiPingBusy || this.data.deepReflectBusy) return;
    this.setData({ aiPingBusy: true });
    wx.showLoading({ title: '测试中…', mask: true });
    try {
      const r = await runDashScopeConnectionTest();
      wx.showModal({ title: r.title, content: r.content, showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ aiPingBusy: false });
    }
  },

  async runDeepReflectSelfTest() {
    if (!wx.cloud || this.data.deepReflectBusy || this.data.aiPingBusy) return;
    this.setData({ deepReflectBusy: true });
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
    const watchdogMs = CLOUD_AI_CLIENT_WALL_MS + 20000;
    watchdog = setTimeout(() => {
      if (uiSettled) return;
      uiSettled = true;
      clearTimers();
      wx.hideLoading();
      this.setData({ deepReflectBusy: false });
      wx.showModal({
        title: '调用失败',
        content:
          '深度自检等待过久已自动结束（可能网络卡住或云函数未返回）。请确认已部署 quickstartFunctions、云函数超时足够长，或稍后重试。',
        showCancel: false
      });
    }, watchdogMs);
    try {
      const r = await runEmotionReflectDryRun();
      if (uiSettled) return;
      uiSettled = true;
      clearTimers();
      wx.hideLoading();
      this.setData({ deepReflectBusy: false });
      wx.showModal({ title: r.title, content: r.content, showCancel: false });
    } catch (e) {
      if (uiSettled) return;
      uiSettled = true;
      clearTimers();
      wx.hideLoading();
      this.setData({ deepReflectBusy: false });
      wx.showModal({
        title: '调用失败',
        content: (e && e.message) || (e && e.errMsg) || String(e),
        showCancel: false
      });
    }
  },

  async initCloudEnv() {
    if (!wx.cloud || this.data.cloudInitBusy) return;
    this.setData({ cloudInitBusy: true });
    try {
      const r = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        timeout: 60000,
        data: { type: 'initEnv' }
      });
      const res = r.result || {};
      if (res.success) {
        wx.setStorageSync(`kitCloudEnvInit_${envList[0]}`, 1);
        wx.showToast({ title: '云数据库已就绪', icon: 'success' });
      } else {
        wx.showToast({ title: res.errMsg || '初始化失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '请上传云函数后重试', icon: 'none' });
    } finally {
      this.setData({ cloudInitBusy: false });
    }
  },

  clearAll() {
    wx.showModal({
      title: '清空记录',
      content: '将删除本机所有心情记录；若已开通云开发，会同步清空云端该小程序下的情绪数据。',
      confirmText: '清空',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        wx.setStorageSync('kitMoodRecords', []);
        if (wx.cloud) {
          try {
            await wx.cloud.callFunction({
              name: 'quickstartFunctions',
              timeout: 60000,
              data: { type: 'deleteAllEmotionRecords' }
            });
          } catch (e) {
            console.error(e);
          }
        }
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  }
});
