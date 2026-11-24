/**
 * 云函数内核
 *
 * 设计要点：
 *  - 只有 index.js 接触 wx-server-sdk，本文件接收注入的 { db, openid, now }
 *  - handle() **永不抛出异常**，一律返回 { code, message, data }
 *  - family_id 由服务端反查，前端传入的同名字段一律忽略
 */

import C from '../../core/constants.js';
import E from './errors.js';
import auth from './auth.js';
import audit from './audit.js';
import ROUTES from '../actions/index.js';

/**
 * @param {{db:object, openid?:string, now?:function}} deps
 */
function createApp(deps) {
  deps = deps || {};
  const db = deps.db;
  const defaultOpenid = deps.openid || '';

  /**
   * @param {{action:string, payload?:object, v?:number}} event
   * @param {{openid?:string}} [runtime]
   * @returns {Promise<{code:string, message:string, data?:any, detail?:any}>}
   */
  async function handle(event, runtime) {
    try {
      event = event || {};
      const action = typeof event.action === 'string' ? event.action.trim() : '';
      const payload = (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload))
        ? event.payload
        : {};
      // 手机号+密码登录拿到的 token：优先于 openid 决定「我是谁」。
      // 这样同一套业务 action 不用改，就能同时服务「微信免登」和「账号密码」两种身份来源。
      const token = (event && typeof event._token === 'string') ? event._token : '';
      const now = deps.now || function () { return Date.now(); };
      let openid = (runtime && runtime.openid) || defaultOpenid;
      if (token) {
        const uid = await resolveToken(db, token, now);
        if (uid) openid = uid;
      }

      const route = ROUTES[action];
      if (!route) {
        return { code: C.ERR.E_UNKNOWN_ACTION, message: '未知操作：' + (action || '(空)') };
      }

      // 登录态校验（白名单外的 action 必须有 openid）
      if (route.auth !== false && !openid) {
        return { code: C.ERR.E_NOT_LOGIN, message: '请先登录' };
      }

      const ctx = await buildContext({
        db: db,
        openid: openid,
        now: now,
        load: route.load !== false
      });

      const data = await route.handler(ctx, payload);
      return { code: C.ERR.OK, message: 'ok', data: data === undefined ? null : data };
    } catch (err) {
      return E.toResult(err);
    }
  }

  return { handle: handle, routes: ROUTES };
}

/**
 * 会话 token -> user_id
 * token 不存在或已过期时返回空串，调用方会退回 openid（微信免登路径不受影响）
 */
async function resolveToken(db, token, now) {
  if (!db || !token) return '';
  try {
    const r = await db.collection(C.COLL.session).where({ _id: token }).limit(1).get();
    const s = (r && r.data && r.data[0]) || null;
    if (!s) return '';
    if (s.expires_at && s.expires_at < now()) return '';
    return s.user_id || '';
  } catch (e) {
    // 集合还没建 / 查询异常：不阻断主流程，退回 openid
    return '';
  }
}

/**
 * 构造请求上下文（含权限与审计辅助）
 */
async function buildContext(opt) {
  const db = opt.db;
  const openid = opt.openid;
  const now = opt.now;

  const ctx = {
    db: db,
    openid: openid,
    now: now,
    user: null,
    membership: null,
    family: null
  };

  Object.defineProperty(ctx, 'familyId', {
    enumerable: true,
    get: function () { return ctx.family ? ctx.family._id : ''; }
  });

  if (opt.load !== false && openid) {
    const c = await auth.loadContext(db, openid);
    ctx.user = c.user;
    ctx.membership = c.membership;
    ctx.family = c.family;
    ctx.pendingJoin = c.pending || null;
    if (ctx.pendingJoin) {
      ctx.pendingFamily = await auth.findOne(db, C.COLL.family, ctx.pendingJoin.family_id);
    }
  }

  ctx.assureLogin = function () {
    if (!ctx.openid) E.fail(C.ERR.E_NOT_LOGIN, '请先登录');
    return ctx.openid;
  };

  ctx.assureFamily = function () {
    if (!ctx.family) E.fail(C.ERR.E_NO_FAMILY, '请先创建或加入家庭');
    return ctx.family;
  };

  ctx.isAdmin = function () {
    return !!(ctx.membership && ctx.membership.role === C.ROLE.admin);
  };

  ctx.requireAdmin = function () {
    ctx.assureFamily();
    if (!ctx.isAdmin()) E.fail(C.ERR.E_NOT_ADMIN, '仅家庭管理员可操作');
    return true;
  };

  ctx.access = function (personId) {
    return auth.getAccessLevel(db, personId, openid);
  };

  /** 校验「档案属于本家庭」+「有相应权限」 */
  ctx.requireAccess = async function (personId, need) {
    ctx.assureFamily();
    const person = await auth.requirePersonInFamily(db, personId, ctx.familyId);
    await auth.requireAccess(db, personId, openid, need || C.ACCESS.read);
    return person;
  };

  ctx.audit = function (entry) {
    return audit.write(db, ctx, entry);
  };

  return ctx;
}

const __exports = { createApp: createApp, buildContext: buildContext };
export { createApp };
export { buildContext };
export default __exports;
