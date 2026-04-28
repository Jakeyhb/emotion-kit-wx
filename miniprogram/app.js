App({
  onLaunch() {
    if (!wx.getStorageSync('kitMoodRecords')) {
      wx.setStorageSync('kitMoodRecords', []);
    }
  }
});
