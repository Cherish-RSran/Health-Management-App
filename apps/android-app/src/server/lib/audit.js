/**
 * 审计日志
 * 健康数据敏感，谁看过、谁改过都要可追溯。
 * 写日志失败**不得影响主流程**。
 */

import C from '../../core/constants.js';

async function write(db, ctx, entry) {
  if (!ctx || !ctx.familyId) return null;
  try {
    const r = await db.collection(C.COLL.auditLog).add({
      data: {
        family_id: ctx.familyId,
        person_id: entry.person_id || '',
        actor_user_id: ctx.openid,
        actor_name: (ctx.user && ctx.user.nickname) || '',
        action: entry.action || 'update',
        target_table: entry.target_table || '',
        target_id: entry.target_id || '',
        detail: entry.detail || {},
        created_at: ctx.now()
      }
    });
    return r._id;
  } catch (e) {
    // 审计失败绝不影响业务
    console.error('[audit] 写入失败：', e && e.message);
    return null;
  }
}

/** 家庭动态列表（倒序分页） */
async function list(db, familyId, opts) {
  opts = opts || {};
  const limit = Math.min(Number(opts.limit) || C.PAGE_SIZE, C.MAX_PAGE_SIZE);
  const skip = Math.max(0, Number(opts.skip) || 0);
  const r = await db.collection(C.COLL.auditLog)
    .where({ family_id: familyId })
    .orderBy('created_at', 'desc')
    .skip(skip)
    .limit(limit)
    .get();
  return r.data;
}

const __exports = { write: write, list: list };
export { write };
export { list };
export default __exports;
