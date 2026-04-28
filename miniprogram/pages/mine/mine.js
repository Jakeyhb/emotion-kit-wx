const PREMISE_STORAGE_KEY = 'kit_user_premise';
const AVATAR_STORAGE_KEY = 'kit_user_avatar';
const NICK_STORAGE_KEY = 'kit_user_nickname';

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
    showPremiseEdit: false,
    premiseDraft: '',
    avatarUrl: '',
    nickName: ''
  },

  onShow() {
    const premise = wx.getStorageSync(PREMISE_STORAGE_KEY) || '';
    const avatarUrl = wx.getStorageSync(AVATAR_STORAGE_KEY) || '';
    const nickName = wx.getStorageSync(NICK_STORAGE_KEY) || '';
    this.setData({ premise, avatarUrl, nickName });
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail || {};
    if (!avatarUrl) return;
    persistAvatarPath(avatarUrl, (path) => {
      this.setData({ avatarUrl: path });
      wx.showToast({ title: '头像已更新', icon: 'success' });
    });
  },

  syncNicknameStorage(raw) {
    const v = raw != null ? String(raw).trim().slice(0, 32) : '';
    wx.setStorageSync(NICK_STORAGE_KEY, v);
    if (this.data.nickName !== v) this.setData({ nickName: v });
  },

  onNicknameChange(e) {
    const v = (e.detail && e.detail.value) != null ? e.detail.value : this.data.nickName;
    this.syncNicknameStorage(v);
  },

  onNicknameBlur(e) {
    const v = (e.detail && e.detail.value) != null ? e.detail.value : this.data.nickName;
    this.syncNicknameStorage(v);
  },

  onNicknameConfirm(e) {
    const v = (e.detail && e.detail.value) != null ? e.detail.value : this.data.nickName;
    this.syncNicknameStorage(v);
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
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  noop() {},

  clearAll() {
    wx.showModal({
      title: '清空记录',
      content: '将删除本机所有心情记录，此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#c62828',
      success: (res) => {
        if (!res.confirm) return;
        wx.setStorageSync('kitMoodRecords', []);
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  }
});
