/**
 * 云函数调用统一入口
 * 所有服务端请求都从这里走，不散落在页面里。
 */

const C = require('./constants');

const FN_NAME = 'api';
const PROTOCOL_VERSION = 1;

/* ---------- 手机号+密码登录的会话 token ----------
 * 微信免登（openid）时不需要它；用账号密码登录后，服务端每次凭 token 认人。
 */
const TOKEN_KEY = 'fhr.token';
let _token = '';
try { _token = wx.getStorageSync(TOKEN_KEY) || ''; } catch (e) { _token = ''; }

function getToken() { return _token; }

function setToken(t) {
  _token = t || '';
  try {
    if (_token) wx.setStorageSync(TOKEN_KEY, _token);
    else wx.removeStorageSync(TOKEN_KEY);
  } catch (e) {
    console.warn('[api] token 持久化失败，仅本次会话有效');
  }
  return _token;
}

/** 是否为可忽略的「未登录」类错误 */
function isAuthError(code) {
  return code === C.ERR.E_NOT_LOGIN || code === C.ERR.E_NO_FAMILY;
}

/**
 * 调用云函数
 * @param {string} action  业务动作，如 'family.create'
 * @param {object} [payload]
 * @param {{silent?:boolean, loading?:string}} [opts]
 * @returns {Promise<any>} 成功时 resolve 业务数据；失败时 reject 带 code 的 Error
 */
function call(action, payload, opts) {
  opts = opts || {};
  let loadingShown = false;
  if (opts.loading) {
    wx.showLoading({ title: opts.loading, mask: true });
    loadingShown = true;
  }
  const hide = function () {
    if (loadingShown) { wx.hideLoading(); loadingShown = false; }
  };

  return wx.cloud.callFunction({
    name: FN_NAME,
    data: {
      action: action, payload: payload || {}, v: PROTOCOL_VERSION,
      _token: _token
    }
  }).then(function (res) {
    hide();
    const r = (res && res.result) || {};
    if (r.code !== C.ERR.OK) {
      const err = new Error(r.message || '请求失败，请稍后重试');
      err.code = r.code || C.ERR.E_INTERNAL;
      err.detail = r.detail;
      if (!opts.silent) console.warn('[api]', action, r.code, r.message);
      throw err;
    }
    return r.data;
  }).catch(function (e) {
    hide();
    if (!e.code) {
      e.code = C.ERR.E_INTERNAL;
      e.message = '网络异常，请检查网络后重试';
      console.error('[api] callFunction failed', action, e);
    }
    if (!opts.silent) toastError(e);
    throw e;
  });
}

/** 统一错误提示；未登录类错误不弹（由调用方引导） */
function toastError(e) {
  if (isAuthError(e && e.code)) return;
  wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none', duration: 2000 });
}

/** 成功提示 */
function toastOk(title) {
  wx.showToast({ title: title || '已完成', icon: 'success', duration: 1500 });
}

/** 轻提示 */
function toast(title, duration) {
  wx.showToast({ title: title, icon: 'none', duration: duration || 1600 });
}

/** 确认框（Promise 化） */
function confirm(title, content) {
  return new Promise(function (resolve) {
    wx.showModal({
      title: title || '确认',
      content: content || '',
      success: function (res) { resolve(!!res.confirm); },
      fail: function () { resolve(false); }
    });
  });
}

module.exports = {
  call: call,
  toastOk: toastOk,
  toast: toast,
  toastError: toastError,
  confirm: confirm,
  isAuthError: isAuthError,
  getToken: getToken,
  setToken: setToken,
  FN_NAME: FN_NAME
};
