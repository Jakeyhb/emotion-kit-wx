/**
 * 用户资料云同步：集合 emotion_kit_users，由 quickstartFunctions 读写。
 */
const CF_NAME = 'quickstartFunctions';
const CF_TIMEOUT_MS = 60000;

function cloudCall(type, data) {
  return wx.cloud.callFunction({
    name: CF_NAME,
    timeout: CF_TIMEOUT_MS,
    data: data != null ? { type, data } : { type }
  });
}

/** @returns {Promise<{ nickName: string, aiPremise: string, updatedAt?: any, createdAt?: any } | null>} */
async function getUserProfileFromCloud() {
  if (!wx.cloud) return null;
  try {
    const r = await cloudCall('getUserProfile');
    const res = (r && r.result) || {};
    if (!res.success || !res.data) return null;
    return res.data;
  } catch (e) {
    console.error('getUserProfileFromCloud', e);
    return null;
  }
}

/**
 * 将云端非空字段写回本地（与 mine / mood 使用的 key 一致）
 * @param {{ nickName?: string, aiPremise?: string }} profile
 */
function mergeCloudProfileToLocal(profile) {
  if (!profile) return;
  const cloudP = (profile.aiPremise != null ? String(profile.aiPremise) : '').trim();
  const cloudN = (profile.nickName != null ? String(profile.nickName) : '').trim();
  if (cloudP) wx.setStorageSync('kit_user_premise', profile.aiPremise || '');
  if (cloudN) wx.setStorageSync('kit_user_nickname', profile.nickName || '');
}

/** @param {{ nickName?: string, aiPremise?: string }} patch */
async function upsertUserProfileToCloud(patch) {
  if (!wx.cloud || !patch) return { ok: false };
  if (patch.nickName === undefined && patch.aiPremise === undefined) return { ok: false };
  try {
    const r = await cloudCall('upsertUserProfile', patch);
    const res = (r && r.result) || {};
    return { ok: !!res.success, errMsg: res.errMsg };
  } catch (e) {
    console.error('upsertUserProfileToCloud', e);
    return { ok: false, errMsg: e.errMsg || e.message };
  }
}

module.exports = {
  getUserProfileFromCloud,
  mergeCloudProfileToLocal,
  upsertUserProfileToCloud
};
