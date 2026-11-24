/**
 * 查询辅助
 *
 * 云数据库单次查询有条数上限（云函数端默认 100，最大 1000），
 * 凡是「必须拿全」的场景（导出、病程逐日、聚合统计）都要循环分页，不能只写一个 limit。
 */

const PAGE = 100;

/**
 * 循环分页拉全某条件的记录
 * @param {object} db
 * @param {string} coll
 * @param {object} where
 * @param {{max?:number, orderBy?:[string,string]}} [opts]
 * @returns {Promise<{rows:Array, truncated:boolean}>}
 */
async function fetchAll(db, coll, where, opts) {
  opts = opts || {};
  const max = opts.max || 5000;
  const rows = [];
  let skip = 0;

  for (;;) {
    let q = db.collection(coll).where(where || {});
    if (opts.orderBy) q = q.orderBy(opts.orderBy[0], opts.orderBy[1]);
    const r = await q.skip(skip).limit(PAGE).get();
    const batch = r.data || [];
    rows.push.apply(rows, batch);

    if (batch.length < PAGE) return { rows: rows, truncated: false };
    if (rows.length >= max) return { rows: rows, truncated: true };
    skip += PAGE;
  }
}

/** 只取条数上限内的一页（用于列表展示），返回 truncated 标记 */
async function fetchCapped(db, coll, where, limit) {
  const cap = limit || 500;
  const r = await db.collection(coll).where(where || {}).limit(cap).get();
  return { rows: r.data || [], truncated: (r.data || []).length >= cap };
}

const __exports = { fetchAll: fetchAll, fetchCapped: fetchCapped, PAGE: PAGE };
export { fetchAll };
export { fetchCapped };
export { PAGE };
export default __exports;
