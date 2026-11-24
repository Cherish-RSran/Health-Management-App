/**
 * 业务调用统一入口 —— 对应小程序 utils/api.js
 *
 * 小程序版走 wx.cloud.callFunction 访问云函数；
 * 这里改成直接调用同机的业务逻辑（server/local.js），全程不联网。
 * 对页面而言签名完全一样：call(action, payload, { loading, silent })
 */

import { handle } from '../server/local.js';
import { toast, toastOk, showLoading, hideLoading, confirm } from './ui.js';
import C from './constants.js';

/** 「未登录 / 没家庭」这类错误不弹提示，由页面引导用户 */
function isAuthError(code) {
  return code === C.ERR.E_NOT_LOGIN || code === C.ERR.E_NO_FAMILY;
}

/**
 * @param {string} action  如 'family.create'
 * @param {object} [payload]
 * @param {{silent?:boolean, loading?:string}} [opts]
 * @returns {Promise<any>}
 */
export async function call(action, payload, opts) {
  opts = opts || {};
  if (opts.loading) showLoading(opts.loading);

  let result;
  try {
    result = await handle(action, payload || {});
  } catch (e) {
    hideLoading();
    const err = new Error('操作失败，请稍后重试');
    err.code = C.ERR.E_INTERNAL;
    if (!opts.silent) toast(err.message);
    throw err;
  }

  hideLoading();

  if (result.code !== C.ERR.OK) {
    const err = new Error(result.message || '请求失败，请稍后重试');
    err.code = result.code || C.ERR.E_INTERNAL;
    err.detail = result.detail;
    if (!opts.silent && !isAuthError(err.code)) {
      console.warn('[api]', action, err.code, err.message);
      toast(err.message);
    }
    throw err;
  }
  return result.data;
}

export { toast, toastOk, confirm, isAuthError };

/** 兼容小程序写法：api.toast('x') */
export function toastError(e) {
  if (isAuthError(e && e.code)) return;
  toast((e && e.message) || '操作失败');
}
