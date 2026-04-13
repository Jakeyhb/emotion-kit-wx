/**
 * 友好提示弹窗：统一文案风格，温和、不评判
 * 支持自定义提示（传入 page 实例）或原生提示
 */

const DEFAULT_SUCCESS = '完成啦～';
const DEFAULT_FAIL = '出错了，稍后再试哦';
const DEFAULT_LOADING = '稍等哦…';

// 当前页面实例（用于自定义提示）
let currentPage = null;

// 设置当前页面实例
function setPage(page) {
  currentPage = page;
}

function show(options, page) {
  const opts = typeof options === 'string' ? { title: options } : { ...options };
  opts.duration = opts.duration != null ? opts.duration : 2000;
  
  // 如果提供了 page 实例或已设置 currentPage，使用自定义提示
  const targetPage = page || currentPage;
  if (targetPage && typeof targetPage.showCustomToast === 'function') {
    const type = opts.icon === 'success' ? 'success' : opts.icon === 'error' ? 'error' : 'info';
    targetPage.showCustomToast(opts.title, type, opts.duration);
    return;
  }
  
  // 否则使用原生提示
  wx.showToast(opts);
}

function success(message, duration, page) {
  show({
    title: message || DEFAULT_SUCCESS,
    icon: 'success',
    duration: duration != null ? duration : 2000
  }, page);
}

function fail(message, duration, page) {
  show({
    title: message || DEFAULT_FAIL,
    icon: 'error',
    duration: duration != null ? duration : 2500
  }, page);
}

function loading(message, page) {
  // loading 始终使用原生，因为自定义提示不支持 loading
  show({
    title: message || DEFAULT_LOADING,
    icon: 'loading',
    duration: 0
  }, null);
}

function hint(message, duration, page) {
  show({
    title: message || '',
    icon: 'none',
    duration: duration != null ? duration : 2500
  }, page);
}

module.exports = {
  setPage,
  show,
  success,
  fail,
  loading,
  hint
};
