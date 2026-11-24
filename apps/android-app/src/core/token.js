/**
 * 手机号+密码登录的会话 token
 *
 * 单独成一个模块是为了避开循环依赖：
 *   session.js -> api.js -> local.js -> token.js（谁都不反向依赖谁）
 *
 * 与小程序 utils/api.js 里的 getToken/setToken 是同一套语义。
 */

const KEY = 'fhr.token';

export function getToken() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch (e) {
    console.warn('[token] 持久化失败，仅本次会话有效');
  }
  return t || '';
}
