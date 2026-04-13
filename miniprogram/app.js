const { envList } = require('./envList');

App({
  onLaunch() {
    if (wx.cloud) {
      const envId = envList[0];
      wx.cloud.init({
        env: envId,
        traceUser: true
      });
      const initFlag = `kitCloudEnvInit_${envId}`;
      if (!wx.getStorageSync(initFlag)) {
        wx.cloud
          .callFunction({
            name: 'quickstartFunctions',
            timeout: 60000,
            data: { type: 'initEnv' }
          })
          .then((r) => {
            if (r.result && r.result.success) wx.setStorageSync(initFlag, 1);
          })
          .catch(() => {});
      }
    }
    if (!wx.getStorageSync('kitMoodRecords')) {
      wx.setStorageSync('kitMoodRecords', []);
    }
  }
});
