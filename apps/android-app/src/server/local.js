/**
 * 本地「服务端」入口 —— 对应云函数 cloudfunctions/api/index.js
 *
 * 云函数版从 wx-server-sdk 拿 openid、用云数据库；这里换成
 *   1. 本机固定用户 ID（首次启动时生成，存在 App 私有存储里）
 *   2. IndexedDB（见 core/localdb.js，API 与云数据库一致）
 * 其余业务逻辑（actions/*、lib/*）与云端完全同一份代码。
 */

import { createApp } from './lib/app.js';
import { openDB, genId } from '../core/localdb.js';
import { getToken } from '../core/token.js';

const UID_KEY = 'fhr.uid';

/** 本机用户 ID，相当于微信的 openid */
export function localUserId() {
  let uid = '';
  try {
    uid = localStorage.getItem(UID_KEY) || '';
  } catch (e) {
    uid = '';
  }
  if (!uid) {
    uid = 'local_' + genId();
    try {
      localStorage.setItem(UID_KEY, uid);
    } catch (e) {
      console.warn('[local] 无法持久化用户 ID');
    }
  }
  return uid;
}

let _app = null;

/** 惰性创建内核（业务路由表在 actions/index.js，与云端同一份） */
export async function getApp() {
  if (!_app) {
    const db = await openDB();
    _app = createApp({
      db: db,
      openid: localUserId(),
      now: function () { return Date.now(); }
    });
  }
  return _app;
}

/**
 * 调用业务动作
 * @returns {Promise<{code:string, message:string, data?:any}>} 永不抛异常
 */
export async function handle(action, payload) {
  const app = await getApp();
  return app.handle(
    { action: action, payload: payload || {}, v: 1, _token: getToken() },
    { openid: localUserId() }
  );
}

/** 取底层 db（备份 / 恢复 / 清空用） */
export async function rawDB() {
  return openDB();
}

/** 测试用：丢弃内核实例 */
export function resetApp() {
  _app = null;
}
