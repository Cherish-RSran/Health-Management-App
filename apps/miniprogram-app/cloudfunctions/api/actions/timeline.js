/**
 * 健康时间线（4 张表混排）
 *
 * 权限：只返回当前用户**有 person_access 权限**的档案的事件。
 * 一期采用「并行查 4 表 + 内存合并」，不建索引表（家庭级数据量没必要）。
 */

const C = require('../lib/shared/constants');
const V = require('../lib/shared/validate');
const D = require('../lib/shared/date');
const M = require('../lib/shared/model');
const E = require('../lib/errors');

/** 单表最多扫描条数，超出会在返回里标记 truncated */
const MAX_SCAN = 500;

/**
 * 当前用户在本家庭可访问的档案 ID 列表
 *
 * ⚠️ 必须与 lib/auth.getAccessLevel 保持一致的口径：
 * 除了 person_access，还要带上「本人档案（owner_user_id 指向自己）」的兜底，
 * 否则会出现「档案页能打开、首页与时间线却全空」的分裂。
 */
async function accessiblePersonIds(ctx) {
  const db = ctx.db;
  const set = {};

  const pa = await db.collection(C.COLL.personAccess)
    .where({ family_id: ctx.familyId, user_id: ctx.openid })
    .limit(C.MAX_PAGE_SIZE)
    .get();
  pa.data.forEach(function (x) {
    if (x.level && x.level !== C.ACCESS.none) set[x.person_id] = true;
  });

  // 兜底：本人档案
  const own = await db.collection(C.COLL.person)
    .where({
      family_id: ctx.familyId,
      owner_user_id: ctx.openid,
      status: C.RECORD_STATUS.active
    })
    .limit(C.MAX_PAGE_SIZE)
    .get();
  own.data.forEach(function (p) { set[p._id] = true; });

  return Object.keys(set);
}

/**
 * 时间线查询
 * payload: { person_id?, kinds?, keyword?, page?, size? }
 */
async function query(ctx, payload) {
  ctx.assureFamily();

  const r = V.validate({
    person_id: { type: 'string', max: 64, label: '档案' },
    kinds: { type: 'array', max: 6, label: '类型筛选' },
    keyword: { type: 'string', max: 40, label: '搜索词' },
    page: { type: 'number', min: 1, max: 9999, default: 1, label: '页码' },
    size: { type: 'number', min: 1, max: C.MAX_PAGE_SIZE, default: C.PAGE_SIZE, label: '每页条数' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const now = ctx.now();
  const today = D.todayStr(now);

  // 1. 确定可见档案范围
  let ids = await accessiblePersonIds(ctx);
  if (r.value.person_id) {
    await ctx.requireAccess(r.value.person_id, C.ACCESS.read);
    ids = [r.value.person_id];
  }

  const empty = {
    items: [], groups: [], total: 0,
    page: r.value.page, size: r.value.size, has_more: false,
    truncated: false, today: today
  };
  if (!ids.length) return empty;

  // 2. 并行查 4 张表
  const cmd = ctx.db.command;
  const inIds = cmd.in(ids);

  // condition 的 status 是 ongoing/ended，删除用 deleted 表示
  const condWhere = { family_id: ctx.familyId, person_id: inIds, status: cmd.neq(C.RECORD_STATUS.deleted) };
  const otherWhere = { family_id: ctx.familyId, person_id: inIds, status: C.RECORD_STATUS.active };

  const results = await Promise.all([
    ctx.db.collection(C.COLL.condition).where(condWhere).orderBy('start_date', 'desc').limit(MAX_SCAN).get(),
    ctx.db.collection(C.COLL.medicalRecord).where(otherWhere).orderBy('visit_date', 'desc').limit(MAX_SCAN).get(),
    ctx.db.collection(C.COLL.examReport).where(otherWhere).orderBy('report_date', 'desc').limit(MAX_SCAN).get(),
    ctx.db.collection(C.COLL.vaccine).where(otherWhere).orderBy('vaccinated_date', 'desc').limit(MAX_SCAN).get(),
    ctx.db.collection(C.COLL.vital).where(otherWhere).orderBy('vital_date', 'desc').limit(MAX_SCAN).get()
  ]);

  const sources = {
    conditions: results[0].data,
    records: results[1].data,
    exams: results[2].data,
    vaccines: results[3].data,
    vitals: results[4].data
  };

  const truncated = results.some(function (x) { return x.data.length >= MAX_SCAN; });

  // 3. 合并 + 排序 + 过滤
  const events = M.mergeTimeline(sources, {
    person_id: null,          // 已在查询层过滤
    kinds: r.value.kinds,
    keyword: r.value.keyword,
    today: today
  });

  // 4. 分页 + 分组
  const p = M.paginate(events, r.value.page, r.value.size);

  return {
    items: p.items.map(function (e) {
      return {
        id: e.ref_id,
        kind: e.kind,
        title: e.title,
        subtitle: e.subtitle,
        is_ongoing: e.is_ongoing,
        occurred_at: e.occurred_at,
        occurred_date: D.dateStrOf(e.occurred_at),
        occurred_label: D.fmtMD(D.dateStrOf(e.occurred_at)),
        person_id: e.person_id,
        ref_table: e.ref_table,
        ref_id: e.ref_id
      };
    }),
    groups: M.groupTimeline(p.items).map(function (g) {
      return {
        key: g.key,
        label: g.label,
        items: g.items.map(function (e) {
          return {
            id: e.ref_id, kind: e.kind, title: e.title, subtitle: e.subtitle,
            is_ongoing: e.is_ongoing,
            occurred_label: D.fmtMD(D.dateStrOf(e.occurred_at)),
            person_id: e.person_id, ref_id: e.ref_id, ref_table: e.ref_table
          };
        })
      };
    }),
    total: p.total,
    page: p.page,
    size: p.size,
    has_more: p.has_more,
    truncated: truncated,
    today: today
  };
}

module.exports = { query: query, accessiblePersonIds: accessiblePersonIds, MAX_SCAN: MAX_SCAN };
