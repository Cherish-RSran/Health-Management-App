/**
 * 全局会话 —— 对应小程序 app.js 的 globalData
 *
 * 两种身份来源，二选一：
 *   1. 本机免登：读本机固定 ID（相当于微信 openid），打开即用，数据只在这台机器上
 *   2. 手机号+密码：登录后拿 token，服务端凭 token 认人（为后续云端同步预留）
 */

import { ref, reactive } from 'vue';
import { call } from './api.js';
import { getToken, setToken } from './token.js';

/** 用户设置（大字模式、首页卡片顺序） */
export const setting = ref({
  large_font: false,
  card_order: ['meds', 'todos', 'emg', 'quick']
});

/** 当前用户与家庭 */
export const session = reactive({
  inited: false,
  user: null,
  family: null,
  /** 是否已用手机号登录（token 有效且换回了用户） */
  loggedIn: false
});

/** 「仅本机使用」开关：没登录也能进，数据只在本机 */
const GUEST_KEY = 'fhr.guest';
export function isGuest() {
  try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { return false; }
}
export function markGuest() {
  try { localStorage.setItem(GUEST_KEY, '1'); } catch (e) { /* 无存储也能继续用 */ }
}
export function clearGuest() {
  try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* 同上 */ }
}

/** 是否需要先登录：既没 token 也没选过「仅本机使用」 */
export function needLogin() {
  return !getToken() && !isGuest();
}

let _ready = null;

/** 建立会话，返回 { user, family, setting } */
export function bootstrap() {
  if (_ready) return _ready;
  _ready = call('auth.login', {}, { silent: true })
    .then(function (data) {
      session.user = data.user || null;
      session.family = data.family || null;
      session.loggedIn = !!getToken() && !!(data && data.user);
      if (data && data.setting) {
        setting.value = Object.assign({}, setting.value, data.setting);
      }
      session.inited = true;
      return data;
    })
    .catch(function (e) {
      console.warn('[session] bootstrap 失败', e && e.code, e && e.message);
      session.inited = true;
      return null;
    });
  return _ready;
}

/** 页面可调用：确保初始化完成后再取数据 */
export function ensureReady() {
  return bootstrap();
}

/** 更新本机设置（改完立即生效） */
export function patchSetting(patch) {
  setting.value = Object.assign({}, setting.value, patch || {});
  return setting.value;
}

/** 数据变更后刷新家庭信息 */
export function setFamily(family) {
  if (family) session.family = family;
  return session.family;
}

/** 手机号 + 密码登录 */
export async function loginByPassword(phone, password) {
  const data = await call('auth.loginByPassword', { phone: phone, password: password },
    { loading: '登录中' });
  if (data && data.token) setToken(data.token);
  clearGuest();
  applyLogin(data);
  return data;
}

/** 手机号 + 密码注册 */
export async function register(phone, password, nickname) {
  const data = await call('auth.register',
    { phone: phone, password: password, nickname: nickname || '' },
    { loading: '注册中' });
  if (data && data.token) setToken(data.token);
  clearGuest();
  applyLogin(data);
  return data;
}

/** 退出登录 */
export async function logout() {
  const t = getToken();
  if (t) {
    try {
      await call('auth.logout', { token: t }, { silent: true });
    } catch (e) {
      // 服务端删不掉也照样清本地，不阻塞退出
    }
  }
  setToken('');
  resetSession();
}

function applyLogin(data) {
  if (!data) return;
  session.user = data.user || null;
  session.family = data.family || null;
  session.loggedIn = true;
  session.inited = true;
  if (data.setting) setting.value = Object.assign({}, setting.value, data.setting);
}

/** 退出当前会话缓存（切换数据时用） */
export function resetSession() {
  _ready = null;
  session.inited = false;
  session.user = null;
  session.family = null;
  session.loggedIn = false;
}
