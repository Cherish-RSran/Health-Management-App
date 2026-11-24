/**
 * 鉴权与权限
 *
 * 三条铁律：
 *  1. family_id 一律由服务端从登录态反查，**绝不信任前端传参**
 *  2. 权限判定走 person_access，**不看 role**（role=admin 只管成员进出）
 *  3. 所有查询都必须带上服务端反查出的 family_id
 */

import C from '../../core/constants.js';
import { fail } from './errors.js';

/** 按 _id 取单条（不存在返回 null） */
async function findOne(db, coll, id) {
  if (!id) return null;
  const r = await db.collection(coll).where({ _id: id }).limit(1).get();
  return r.data[0] || null;
}

/** 按条件取单条 */
async function findWhere(db, coll, where, order) {
  let q = db.collection(coll).where(where);
  if (order) q = q.orderBy(order[0], order[1]);
  const r = await q.limit(1).get();
  return r.data[0] || null;
}

/**
 * 取用户当前生效的家庭（一期一个用户只归属一个家庭）
 *
 * 注意：**不依赖 user 记录是否存在**。user_family 才是家庭归属的唯一依据，
 * 这样即使调用方没有先走一次 login，也能正确解析家庭上下文。
 */
async function loadContext(db, openid) {
  if (!openid) return { user: null, membership: null, family: null, pending: null };

  const user = await findOne(db, C.COLL.user, openid);

  const membership = await findWhere(db, C.COLL.userFamily, {
    user_id: openid,
    join_status: C.JOIN_STATUS.approved
  }, ['joined_at', 'asc']);

  let family = null;
  if (membership) {
    family = await findOne(db, C.COLL.family, membership.family_id);
  }

  // 已提交但尚未通过的加入申请 —— 用于首页显示「等待管理员同意」而不是「去创建家庭」
  const pending = await findWhere(db, C.COLL.userFamily, {
    user_id: openid,
    join_status: C.JOIN_STATUS.pending
  }, ['joined_at', 'desc']);

  return { user, membership: membership, family: family, pending: pending };
}

/** 权限等级比较 */
function atLeast(level, need) {
  const a = C.ACCESS_RANK[level];
  const b = C.ACCESS_RANK[need];
  if (a === undefined || b === undefined) return false;
  return a >= b;
}

/**
 * 取用户对某份档案的权限等级
 * 优先 person_access；兜底看 person.owner_user_id（本人档案）
 */
async function getAccessLevel(db, personId, userId) {
  if (!personId || !userId) return C.ACCESS.none;

  const pa = await findWhere(db, C.COLL.personAccess, {
    person_id: personId,
    user_id: userId
  });
  if (pa && pa.level) return pa.level;

  const person = await findOne(db, C.COLL.person, personId);
  // 兜底仅对「仍有效」的本人档案生效；已归档/删除的档案不因 owner_user_id 而获得权限
  if (person
    && person.status === C.RECORD_STATUS.active
    && person.owner_user_id
    && person.owner_user_id === userId) {
    return C.ACCESS.owner;
  }
  return C.ACCESS.none;
}

/**
 * 断言并返回权限等级
 * @throws AppError E_NO_PERMISSION
 */
async function requireAccess(db, personId, userId, need) {
  const level = await getAccessLevel(db, personId, userId);
  if (!atLeast(level, need || C.ACCESS.read)) {
    fail(C.ERR.E_NO_PERMISSION, '无权访问该档案');
  }
  return level;
}

/**
 * 断言档案属于当前家庭（跨家庭一律按「不存在」处理，避免泄露其他家庭的数据存在性）
 */
async function requirePersonInFamily(db, personId, familyId) {
  const person = await findOne(db, C.COLL.person, personId);
  if (!person || person.status === C.RECORD_STATUS.deleted) {
    fail(C.ERR.E_NOT_FOUND, '档案不存在');
  }
  if (person.family_id !== familyId) {
    fail(C.ERR.E_NOT_FOUND, '档案不存在');
  }
  return person;
}

const __exports = {
  findOne, findWhere, loadContext, atLeast,
  getAccessLevel, requireAccess, requirePersonInFamily
};
export { findOne };
export { findWhere };
export { loadContext };
export { atLeast };
export { getAccessLevel };
export { requireAccess };
export { requirePersonInFamily };
export default __exports;
