/**
 * 医生摘要
 *
 * 两条铁律：
 *  1. **过敏史永远第一个**，且不可取消
 *  2. **长期用药与短期用药严格分离**（感冒药不能混进长期用药区）
 *
 * 摘要不是「另存一份」，而是从已有档案里**提炼**；每个区块都能溯源到来源表与 ID。
 */

const C = require('../lib/shared/constants');
const V = require('../lib/shared/validate');
const D = require('../lib/shared/date');
const M = require('../lib/shared/model');
const E = require('../lib/errors');
const auth = require('../lib/auth');

async function listActive(db, coll, personId) {
  const r = await db.collection(coll)
    .where({ person_id: personId, status: C.RECORD_STATUS.active })
    .orderBy('created_at', 'asc')
    .limit(C.MAX_PAGE_SIZE)
    .get();
  return r.data;
}

function normalizeOptions(o) {
  o = o || {};
  return {
    surgery: o.surgery !== false,
    history: o.history !== false,
    exam: o.exam !== false,
    metric: o.metric !== false
  };
}

/** 记住上次勾选，复诊一键复用 */
async function saveOptions(ctx, options) {
  try {
    const exist = await auth.findOne(ctx.db, C.COLL.userSetting, ctx.openid);
    if (exist) {
      await ctx.db.collection(C.COLL.userSetting).doc(ctx.openid).update({
        data: { summary_options: options, updated_at: ctx.now() }
      });
    } else {
      await ctx.db.collection(C.COLL.userSetting).add({
        data: {
          _id: ctx.openid,
          large_font: false,
          card_order: ['meds', 'todos', 'emg', 'quick'],
          default_person_id: '',
          summary_options: options,
          updated_at: ctx.now()
        }
      });
    }
  } catch (e) {
    console.error('[summary] 保存勾选失败', e && e.message);
  }
}

/**
 * 生成摘要
 * payload: { person_id, condition_id?, options? }
 */
async function build(ctx, payload) {
  const r = V.validate({
    person_id: { type: 'string', required: true, max: 64, label: '档案' },
    condition_id: { type: 'string', max: 64, label: '病程' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.read);
  const db = ctx.db;
  const now = ctx.now();
  const today = D.todayStr(now);

  // 1. 常备档案（并行）
  const packs = await Promise.all([
    listActive(db, C.COLL.allergy, person._id),
    listActive(db, C.COLL.chronic, person._id),
    listActive(db, C.COLL.surgery, person._id),
    listActive(db, C.COLL.medicine, person._id)
  ]);

  // 2. 确定要展示的病程
  let cond = null;
  if (r.value.condition_id) {
    cond = await auth.findOne(db, C.COLL.condition, r.value.condition_id);
    E.assert(cond && cond.person_id === person._id && cond.status !== C.RECORD_STATUS.deleted,
      C.ERR.E_NOT_FOUND, '病程不存在');
  } else {
    cond = await auth.findWhere(db, C.COLL.condition,
      { person_id: person._id, status: C.CONDITION_STATUS.ongoing }, ['start_date', 'desc']);
    if (!cond) {
      cond = await auth.findWhere(db, C.COLL.condition,
        { person_id: person._id, status: C.CONDITION_STATUS.ended }, ['start_date', 'desc']);
    }
  }

  // 3. 本次病程的事件与用药汇总
  let events = [];
  let medSummary = '';
  if (cond) {
    const er = await db.collection(C.COLL.event)
      .where({ condition_id: cond._id, status: C.RECORD_STATUS.active })
      .orderBy('occurred_at', 'asc')
      .limit(C.MAX_PAGE_SIZE)
      .get();
    events = er.data;
    const names = [];
    events.forEach(function (e) {
      if (e.event_type === C.EVENT_TYPE.medication && e.content && e.content.name
        && names.indexOf(e.content.name) < 0) {
        names.push(e.content.name);
      }
    });
    medSummary = names.length ? names.join('、') : '';
  }

  // 4. 相关历史病程：同名的已结束病程优先
  const histRes = await db.collection(C.COLL.condition)
    .where({ person_id: person._id, status: C.CONDITION_STATUS.ended })
    .orderBy('start_date', 'desc')
    .limit(10)
    .get();
  const related = histRes.data
    .filter(function (x) { return !cond || x._id !== cond._id; })
    .filter(function (x) {
      if (!cond) return true;
      return x.title === cond.title || String(x.title).indexOf(cond.title) >= 0;
    })
    .slice(0, 2);

  // 5. 近期检查
  const examRes = await db.collection(C.COLL.examReport)
    .where({ person_id: person._id, status: C.RECORD_STATUS.active })
    .orderBy('report_date', 'desc')
    .limit(3)
    .get();

  // 5.5 近期体征（最新若干条，由 buildSummary 按类型取最新）
  const vitalRes = await db.collection(C.COLL.vital)
    .where({ person_id: person._id, status: C.RECORD_STATUS.active })
    .orderBy('vital_date', 'desc')
    .limit(50)
    .get();

  // 6. 组装
  const options = normalizeOptions(payload.options);
  const summary = M.buildSummary({
    today: today,
    generated_at: now,
    person: {
      name: person.name,
      gender: person.gender,
      birth_date: person.birth_date,
      blood_type: person.blood_type
    },
    allergy: packs[0],
    chronic: packs[1],
    surgery: packs[2],
    medicines: packs[3],
    condition: cond,
    condition_events: events,
    course_med_summary: medSummary,
    related_conditions: related,
    recent_exams: examRes.data,
    vitals: vitalRes.data,
    options: options
  });

  await saveOptions(ctx, options);

  // 摘要属于「查看敏感信息」，按 view 记审计
  await ctx.audit({
    action: 'view', target_table: C.COLL.person, target_id: person._id,
    person_id: person._id, detail: { summary: true, condition_id: cond ? cond._id : '' }
  });

  return {
    summary: summary,
    options: options,
    condition_id: cond ? cond._id : '',
    // 供前端展示「可勾选」区块是否可用
    availability: {
      surgery: packs[2].length > 0,
      history: related.length > 0,
      exam: examRes.data.length > 0,
      metric: vitalRes.data.length > 0
    }
  };
}

/** 读取上次的勾选（进入配置页时预填） */
async function options(ctx) {
  const s = await auth.findOne(ctx.db, C.COLL.userSetting, ctx.openid);
  return { options: normalizeOptions(s && s.summary_options) };
}

module.exports = { build: build, options: options, normalizeOptions: normalizeOptions };
