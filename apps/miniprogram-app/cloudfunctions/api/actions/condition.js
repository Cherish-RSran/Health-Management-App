/**
 * 病程（condition）与病程事件（timeline_event）
 *
 * ⭐ 核心约定：occurred_at（实际发生）与 recorded_at（补录时间）**必须分开**。
 *    因为真实场景是「子女下班后补记」：10.13 咳嗽这条，occurred_at = 10.13，
 *    recorded_at = 10.14 晚上。所有排序与统计用 occurred_at，
 *    「这条什么时候补的」与审计用 recorded_at。
 */

const C = require('../lib/shared/constants');
const V = require('../lib/shared/validate');
const D = require('../lib/shared/date');
const M = require('../lib/shared/model');
const E = require('../lib/errors');
const auth = require('../lib/auth');
const Q = require('../lib/query');

/** 补记判定阈值：录入时间比发生时间晚超过 12 小时 */
const BACKFILL_THRESHOLD_MS = 12 * 3600 * 1000;

const CONDITION_RULES = {
  person_id: { type: 'string', required: true, max: 64, label: '档案' },
  title: { type: 'string', required: true, max: 40, label: '病程名称' },
  start_date: { type: 'date', required: true, label: '开始日期' },
  end_date: { type: 'date', label: '结束日期' },
  summary: { type: 'string', max: 200, label: '概述' }
};

const SEVERITY_VALUES = ['mild', 'moderate', 'severe'];

/* ============================================================================
   输出转换
   ============================================================================ */
function conditionOut(c, today) {
  const t = today || D.todayStr();
  // 天数口径统一为「含首日」：10.13 → 10.16 记 4 天
  return {
    id: c._id,
    person_id: c.person_id,
    title: c.title,
    start_date: c.start_date,
    end_date: c.end_date || '',
    status: c.status,
    is_ongoing: c.status === C.CONDITION_STATUS.ongoing,
    duration_days: c.status === C.CONDITION_STATUS.ongoing
      ? D.durationDays(c.start_date, null, t)
      : D.durationDays(c.start_date, c.end_date),
    max_severity: c.max_severity || '',
    summary: c.summary || '',
    created_at: c.created_at || 0,
    archived_at: c.archived_at || null
  };
}

function eventOut(e) {
  const occurred = Number(e.occurred_at) || 0;
  const recorded = Number(e.recorded_at) || 0;
  return {
    id: e._id,
    condition_id: e.condition_id,
    person_id: e.person_id,
    event_type: e.event_type,
    occurred_at: occurred,
    occurred_date: D.dateStrOf(occurred),
    occurred_label: D.fmtMD(D.dateStrOf(occurred)),
    recorded_at: recorded,
    content: e.content || {},
    file_ids: e.file_ids || [],
    // 便于前端标注「这条是事后补的」
    is_backfilled: !!(recorded && occurred && (recorded - occurred) > BACKFILL_THRESHOLD_MS)
  };
}

/* ============================================================================
   病程 CRUD
   ============================================================================ */
async function create(ctx, payload) {
  const r = V.validate(CONDITION_RULES, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));
  const v = r.value;

  const person = await ctx.requireAccess(v.person_id, C.ACCESS.edit);
  const rangeErr = V.checkDateRange(v.start_date, v.end_date, '开始日期', '结束日期');
  E.assert(!rangeErr, C.ERR.E_INVALID_PARAM, rangeErr);

  const now = ctx.now();
  const ended = !!v.end_date;

  const res = await ctx.db.collection(C.COLL.condition).add({
    data: {
      family_id: ctx.familyId,
      person_id: person._id,
      title: v.title,
      start_date: v.start_date,
      end_date: v.end_date || '',
      status: ended ? C.CONDITION_STATUS.ended : C.CONDITION_STATUS.ongoing,
      max_severity: '',
      summary: v.summary || '',
      created_by: ctx.openid,
      created_at: now,
      updated_at: now,
      archived_at: ended ? now : null
    }
  });

  await ctx.audit({
    action: 'create', target_table: C.COLL.condition, target_id: res._id,
    person_id: person._id, detail: { title: v.title }
  });

  const cond = await auth.findOne(ctx.db, C.COLL.condition, res._id);
  return { condition: conditionOut(cond, D.todayStr(now)) };
}

async function update(ctx, payload) {
  const r = V.validate(Object.assign({
    condition_id: { type: 'string', required: true, max: 64, label: '病程' }
  }, optional(CONDITION_RULES)), payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const cond = await loadCondition(ctx, r.value.condition_id);
  await ctx.requireAccess(cond.person_id, C.ACCESS.edit);

  const v = r.value;
  const start = v.start_date !== undefined ? v.start_date : cond.start_date;
  const end = v.end_date !== undefined ? v.end_date : cond.end_date;
  const rangeErr = V.checkDateRange(start, end, '开始日期', '结束日期');
  E.assert(!rangeErr, C.ERR.E_INVALID_PARAM, rangeErr);

  const patch = { updated_at: ctx.now() };
  ['title', 'start_date', 'end_date', 'summary'].forEach(function (k) {
    if (v[k] !== undefined) patch[k] = v[k];
  });
  // 结束日期变化时同步状态
  if (patch.end_date !== undefined) {
    patch.status = patch.end_date ? C.CONDITION_STATUS.ended : C.CONDITION_STATUS.ongoing;
    patch.archived_at = patch.end_date ? ctx.now() : null;
  }

  await ctx.db.collection(C.COLL.condition).doc(cond._id).update({ data: patch });
  await ctx.audit({
    action: 'update', target_table: C.COLL.condition, target_id: cond._id, person_id: cond.person_id
  });

  const updated = await auth.findOne(ctx.db, C.COLL.condition, cond._id);
  return { condition: conditionOut(updated, D.todayStr(ctx.now())) };
}

/** 结束病程（归档） */
async function end(ctx, payload) {
  const r = V.validate({
    condition_id: { type: 'string', required: true, max: 64, label: '病程' },
    end_date: { type: 'date', label: '结束日期' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const cond = await loadCondition(ctx, r.value.condition_id);
  await ctx.requireAccess(cond.person_id, C.ACCESS.edit);

  const now = ctx.now();
  const endDate = r.value.end_date || D.todayStr(now);
  const rangeErr = V.checkDateRange(cond.start_date, endDate, '开始日期', '结束日期');
  E.assert(!rangeErr, C.ERR.E_INVALID_PARAM, rangeErr);

  await ctx.db.collection(C.COLL.condition).doc(cond._id).update({
    data: {
      status: C.CONDITION_STATUS.ended,
      end_date: endDate,
      archived_at: now,
      updated_at: now
    }
  });
  await ctx.audit({
    action: 'update', target_table: C.COLL.condition, target_id: cond._id,
    person_id: cond.person_id, detail: { ended: true }
  });

  const updated = await auth.findOne(ctx.db, C.COLL.condition, cond._id);
  return { condition: conditionOut(updated, D.todayStr(now)) };
}

/** 重新开启（误结束） */
async function reopen(ctx, payload) {
  const r = V.validate({
    condition_id: { type: 'string', required: true, max: 64, label: '病程' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const cond = await loadCondition(ctx, r.value.condition_id);
  await ctx.requireAccess(cond.person_id, C.ACCESS.edit);

  await ctx.db.collection(C.COLL.condition).doc(cond._id).update({
    data: {
      status: C.CONDITION_STATUS.ongoing,
      end_date: '',
      archived_at: null,
      updated_at: ctx.now()
    }
  });
  await ctx.audit({
    action: 'update', target_table: C.COLL.condition, target_id: cond._id, person_id: cond.person_id
  });

  const updated = await auth.findOne(ctx.db, C.COLL.condition, cond._id);
  return { condition: conditionOut(updated, D.todayStr(ctx.now())) };
}

async function remove(ctx, payload) {
  const r = V.validate({
    condition_id: { type: 'string', required: true, max: 64, label: '病程' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const cond = await loadCondition(ctx, r.value.condition_id);
  await ctx.requireAccess(cond.person_id, C.ACCESS.edit);

  await ctx.db.collection(C.COLL.condition).doc(cond._id).update({
    data: { status: C.RECORD_STATUS.deleted, updated_at: ctx.now() }
  });
  await ctx.db.collection(C.COLL.event).where({ condition_id: cond._id }).update({
    data: { status: C.RECORD_STATUS.deleted, updated_at: ctx.now() }
  });
  await ctx.audit({
    action: 'delete', target_table: C.COLL.condition, target_id: cond._id, person_id: cond.person_id
  });
  return { ok: true };
}

/** 病程详情 + 逐日记录 */
async function detail(ctx, payload) {
  const r = V.validate({
    condition_id: { type: 'string', required: true, max: 64, label: '病程' },
    person_id: { type: 'string', max: 64, label: '档案' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const cond = await loadCondition(ctx, r.value.condition_id);
  const person = await ctx.requireAccess(cond.person_id, C.ACCESS.read);
  const now = ctx.now();
  const today = D.todayStr(now);

  // 逐日视图必须拿全：病程事件可能超过单次查询上限
  const evRes = await Q.fetchAll(ctx.db, C.COLL.event,
    { condition_id: cond._id, status: C.RECORD_STATUS.active },
    { orderBy: ['occurred_at', 'asc'] });
  const eventRows = evRes.rows;

  const events = eventRows.map(eventOut);

  // 逐日（缺失的天补成空，空记录也是有效信息）
  const daily = M.buildDailyRecords(
    { start_date: cond.start_date, end_date: cond.end_date, status: cond.status },
    eventRows,
    today
  ).map(function (row) {
    return {
      date: row.date,
      label: row.dateLabel,
      empty: row.empty,
      event: row.event ? eventOut(row.event) : null
    };
  });

  // 本次用药汇总（从 medication 事件聚合）
  const medNames = [];
  eventRows.forEach(function (e) {
    if (e.event_type === C.EVENT_TYPE.medication && e.content && e.content.name) {
      if (medNames.indexOf(e.content.name) < 0) medNames.push(e.content.name);
    }
  });

  const visited = eventRows.some(function (e) {
    return e.event_type === C.EVENT_TYPE.visit;
  });

  return {
    truncated: evRes.truncated,
    condition: conditionOut(cond, today),
    person: {
      id: person._id, name: person.name, relation: person.relation || '',
      gender: person.gender, age: D.calcAge(person.birth_date, today), blood_type: person.blood_type || ''
    },
    events: events,
    daily: daily,
    summary: {
      med_names: medNames,
      med_summary: medNames.length ? medNames.join('、') : '—',
      visited: visited ? '已就诊' : '未就诊'
    }
  };
}

/* ============================================================================
   补记（一次补好几天）
   ============================================================================ */
const DAY_RULES = {
  date: { type: 'date', required: true, label: '日期' },
  time: { type: 'string', max: 5, label: '时间' },
  symptoms: { type: 'array', max: 10, label: '症状' },
  severity: { type: 'enum', values: SEVERITY_VALUES, label: '严重程度' },
  temperature: { type: 'number', min: 30, max: 45, label: '体温' },
  medication: { type: 'string', max: 60, label: '用药' },
  note: { type: 'string', max: 200, label: '备注' }
};

/**
 * 补记：一次提交多天
 * payload: { person_id, title, start_date, ended, days: [DAY_RULES] }
 */
async function backfill(ctx, payload) {
  const r = V.validate({
    person_id: { type: 'string', required: true, max: 64, label: '档案' },
    title: { type: 'string', required: true, max: 40, label: '病程名称' },
    start_date: { type: 'date', label: '开始日期' },
    ended: { type: 'bool', default: false, label: '是否已结束' },
    end_date: { type: 'date', label: '结束日期' },
    days: { type: 'array', max: 60, label: '逐日记录' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.edit);
  const days = Array.isArray(payload.days) ? payload.days : [];
  E.assert(days.length > 0, C.ERR.E_INVALID_PARAM, '至少需要一天记录');

  // 逐日校验
  const cleanDays = [];
  for (let i = 0; i < days.length; i++) {
    const dr = V.validate(DAY_RULES, days[i]);
    E.assert(dr.ok, C.ERR.E_INVALID_PARAM,
      '第 ' + (i + 1) + ' 天：' + V.firstError(dr));
    cleanDays.push(dr.value);
  }

  const now = ctx.now();
  const sorted = cleanDays.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
  });
  const startDate = r.value.start_date || sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;
  const ended = r.value.ended === true;
  const endDate = ended ? (r.value.end_date || lastDate) : '';
  const rangeErr = V.checkDateRange(startDate, endDate, '开始日期', '结束日期');
  E.assert(!rangeErr, C.ERR.E_INVALID_PARAM, rangeErr);

  // 1. 建病程
  const condRes = await ctx.db.collection(C.COLL.condition).add({
    data: {
      family_id: ctx.familyId,
      person_id: person._id,
      title: r.value.title,
      start_date: startDate,
      end_date: endDate,
      status: ended ? C.CONDITION_STATUS.ended : C.CONDITION_STATUS.ongoing,
      max_severity: highestSeverity(sorted),
      summary: '',
      created_by: ctx.openid,
      created_at: now,
      updated_at: now,
      archived_at: ended ? now : null
    }
  });

  // 2. 建逐日事件（occurred_at 用实际日期，recorded_at 统一用补录时间）
  let created = 0;
  for (let i = 0; i < sorted.length; i++) {
    const day = sorted[i];
    const base = D.startOfDayTs(day.date);
    E.assert(!isNaN(base), C.ERR.E_INVALID_PARAM, '日期不合法：' + day.date);
    const occurred = base + timeOffset(day.time);

    if (day.symptoms && day.symptoms.length) {
      await ctx.db.collection(C.COLL.event).add({
        data: {
          family_id: ctx.familyId, person_id: person._id, condition_id: condRes._id,
          event_type: C.EVENT_TYPE.symptom,
          occurred_at: occurred, recorded_at: now,
          content: {
            symptoms: day.symptoms,
            severity: day.severity || '',
            temperature: day.temperature || null,
            note: day.note || ''
          },
          file_ids: [],
          status: C.RECORD_STATUS.active,
          created_by: ctx.openid, created_at: now, updated_at: now
        }
      });
      created++;
    }

    if (day.medication) {
      await ctx.db.collection(C.COLL.event).add({
        data: {
          family_id: ctx.familyId, person_id: person._id, condition_id: condRes._id,
          event_type: C.EVENT_TYPE.medication,
          occurred_at: occurred, recorded_at: now,
          content: { name: day.medication, dosage: '', source: 'temporary', long_term_medicine_id: null },
          file_ids: [],
          status: C.RECORD_STATUS.active,
          created_by: ctx.openid, created_at: now, updated_at: now
        }
      });
      created++;
    }

    if (day.note && !day.symptoms) {
      await ctx.db.collection(C.COLL.event).add({
        data: {
          family_id: ctx.familyId, person_id: person._id, condition_id: condRes._id,
          event_type: C.EVENT_TYPE.note,
          occurred_at: occurred, recorded_at: now,
          content: { text: day.note },
          file_ids: [],
          status: C.RECORD_STATUS.active,
          created_by: ctx.openid, created_at: now, updated_at: now
        }
      });
      created++;
    }
  }

  await ctx.audit({
    action: 'create', target_table: C.COLL.condition, target_id: condRes._id,
    person_id: person._id,
    detail: { title: r.value.title, days: sorted.length, events: created, backfill: true }
  });

  const cond = await auth.findOne(ctx.db, C.COLL.condition, condRes._id);
  return {
    condition: conditionOut(cond, D.todayStr(now)),
    day_count: sorted.length,
    event_count: created
  };
}

/* ============================================================================
   单个事件 CRUD
   ============================================================================ */
const CONTENT_RULES = {
  symptom: {
    symptoms: { type: 'array', required: true, max: 10, label: '症状' },
    severity: { type: 'enum', values: SEVERITY_VALUES, label: '严重程度' },
    temperature: { type: 'number', min: 30, max: 45, label: '体温' },
    note: { type: 'string', max: 200, label: '备注' }
  },
  medication: {
    name: { type: 'string', required: true, max: 60, label: '药品名称' },
    dosage: { type: 'string', max: 30, label: '剂量' },
    source: { type: 'enum', values: ['temporary', 'long_term'], default: 'temporary', label: '来源' }
  },
  visit: {
    hospital: { type: 'string', max: 60, label: '医院' },
    department: { type: 'string', max: 30, label: '科室' },
    medical_record_id: { type: 'string', max: 64, label: '病历' }
  },
  exam: {
    name: { type: 'string', max: 60, label: '项目' },
    exam_report_id: { type: 'string', max: 64, label: '报告' }
  },
  note: {
    text: { type: 'string', required: true, max: 200, label: '备注' }
  }
};

async function addEvent(ctx, payload) {
  const r = V.validate({
    condition_id: { type: 'string', required: true, max: 64, label: '病程' },
    occurred_date: { type: 'date', required: true, label: '发生日期' },
    occurred_time: { type: 'string', max: 5, label: '发生时间' },
    event_type: { type: 'enum', values: Object.keys(C.EVENT_TYPE), required: true, label: '事件类型' },
    file_ids: { type: 'array', max: 9, label: '附件' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const cond = await loadCondition(ctx, r.value.condition_id);
  await ctx.requireAccess(cond.person_id, C.ACCESS.edit);

  const type = r.value.event_type;
  const cr = V.validate(CONTENT_RULES[type] || {}, payload.content || {});
  E.assert(cr.ok, C.ERR.E_INVALID_PARAM, V.firstError(cr));

  // 外键校验：关联的病历 / 检查报告必须属于同一个成员，避免存下悬空引用
  if (type === C.EVENT_TYPE.visit && cr.value.medical_record_id) {
    const rec = await auth.findOne(ctx.db, C.COLL.medicalRecord, cr.value.medical_record_id);
    E.assert(rec && rec.person_id === cond.person_id, C.ERR.E_INVALID_PARAM,
      '关联的病历不属于该成员');
  }
  if (type === C.EVENT_TYPE.exam && cr.value.exam_report_id) {
    const rep = await auth.findOne(ctx.db, C.COLL.examReport, cr.value.exam_report_id);
    E.assert(rep && rep.person_id === cond.person_id, C.ERR.E_INVALID_PARAM,
      '关联的检查报告不属于该成员');
  }

  const now = ctx.now();
  const occurred = D.startOfDayTs(r.value.occurred_date) + timeOffset(r.value.occurred_time);

  const res = await ctx.db.collection(C.COLL.event).add({
    data: {
      family_id: ctx.familyId,
      person_id: cond.person_id,
      condition_id: cond._id,
      event_type: type,
      occurred_at: occurred,
      recorded_at: now,
      content: cr.value,
      file_ids: r.value.file_ids || [],
      status: C.RECORD_STATUS.active,
      created_by: ctx.openid, created_at: now, updated_at: now
    }
  });

  await refreshMaxSeverity(ctx, cond);
  await ctx.audit({
    action: 'create', target_table: C.COLL.event, target_id: res._id,
    person_id: cond.person_id, detail: { type: type }
  });

  const row = await auth.findOne(ctx.db, C.COLL.event, res._id);
  return { event: eventOut(row) };
}

async function updateEvent(ctx, payload) {
  const r = V.validate({
    event_id: { type: 'string', required: true, max: 64, label: '事件' },
    occurred_date: { type: 'date', label: '发生日期' },
    occurred_time: { type: 'string', max: 5, label: '发生时间' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const row = await auth.findOne(ctx.db, C.COLL.event, r.value.event_id);
  E.assert(row && row.status === C.RECORD_STATUS.active, C.ERR.E_NOT_FOUND, '记录不存在');

  const cond = await loadCondition(ctx, row.condition_id);
  await ctx.requireAccess(cond.person_id, C.ACCESS.edit);

  const cr = V.validate(optional(CONTENT_RULES[row.event_type] || {}), payload.content || {});
  E.assert(cr.ok, C.ERR.E_INVALID_PARAM, V.firstError(cr));

  const patch = { updated_at: ctx.now() };
  if (payload.content !== undefined) {
    patch.content = Object.assign({}, row.content, cr.value);
  }
  if (r.value.occurred_date !== undefined) {
    patch.occurred_at = D.startOfDayTs(r.value.occurred_date)
      + timeOffset(r.value.occurred_time !== undefined ? r.value.occurred_time : '');
  } else if (r.value.occurred_time !== undefined) {
    patch.occurred_at = D.startOfDayTs(D.dateStrOf(row.occurred_at)) + timeOffset(r.value.occurred_time);
  }
  // 注意：recorded_at 保持不变 —— 它是「这条什么时候录的」，不因编辑而改变

  await ctx.db.collection(C.COLL.event).doc(row._id).update({ data: patch });
  await refreshMaxSeverity(ctx, cond);
  await ctx.audit({
    action: 'update', target_table: C.COLL.event, target_id: row._id, person_id: cond.person_id
  });

  const updated = await auth.findOne(ctx.db, C.COLL.event, row._id);
  return { event: eventOut(updated) };
}

async function removeEvent(ctx, payload) {
  const r = V.validate({ event_id: { type: 'string', required: true, max: 64, label: '事件' } }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const row = await auth.findOne(ctx.db, C.COLL.event, r.value.event_id);
  E.assert(row && row.status === C.RECORD_STATUS.active, C.ERR.E_NOT_FOUND, '记录不存在');

  const cond = await loadCondition(ctx, row.condition_id);
  await ctx.requireAccess(cond.person_id, C.ACCESS.edit);

  await ctx.db.collection(C.COLL.event).doc(row._id).update({
    data: { status: C.RECORD_STATUS.deleted, updated_at: ctx.now() }
  });
  await refreshMaxSeverity(ctx, cond);
  await ctx.audit({
    action: 'delete', target_table: C.COLL.event, target_id: row._id, person_id: cond.person_id
  });
  return { ok: true };
}

/* ============================================================================
   内部工具
   ============================================================================ */
async function loadCondition(ctx, conditionId) {
  if (!conditionId) E.fail(C.ERR.E_INVALID_PARAM, '缺少病程 ID');
  const cond = await auth.findOne(ctx.db, C.COLL.condition, conditionId);
  E.assert(cond && cond.status !== C.RECORD_STATUS.deleted, C.ERR.E_NOT_FOUND, '病程不存在');
  E.assert(cond.family_id === ctx.familyId, C.ERR.E_NO_PERMISSION, '无权访问该病程');
  return cond;
}

/** 'HH:mm' → 当日毫秒偏移 */
function timeOffset(t) {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return 0;
  const p = t.split(':');
  return (+p[0]) * 3600 * 1000 + (+p[1]) * 60 * 1000;
}

function highestSeverity(days) {
  const order = { severe: 3, moderate: 2, mild: 1 };
  let best = '';
  days.forEach(function (d) {
    if (d.severity && (order[d.severity] || 0) > (order[best] || 0)) best = d.severity;
  });
  return best;
}

/** 维护 condition.max_severity 冗余字段（列表展示免聚合） */
async function refreshMaxSeverity(ctx, cond) {
  const res = await Q.fetchAll(ctx.db, C.COLL.event,
    { condition_id: cond._id, event_type: C.EVENT_TYPE.symptom, status: C.RECORD_STATUS.active },
    { max: 2000 });
  const days = res.rows.map(function (e) { return { severity: e.content && e.content.severity }; });
  await ctx.db.collection(C.COLL.condition).doc(cond._id).update({
    data: { max_severity: highestSeverity(days), updated_at: ctx.now() }
  });
}

/** 去掉必填要求（部分更新用） */
function optional(rules) {
  const out = {};
  Object.keys(rules).forEach(function (k) {
    out[k] = Object.assign({}, rules[k]);
    delete out[k].required;
  });
  return out;
}

module.exports = {
  create: create,
  update: update,
  end: end,
  reopen: reopen,
  remove: remove,
  detail: detail,
  backfill: backfill,
  addEvent: addEvent,
  updateEvent: updateEvent,
  removeEvent: removeEvent,
  conditionOut: conditionOut,
  eventOut: eventOut,
  timeOffset: timeOffset,
  BACKFILL_THRESHOLD_MS: BACKFILL_THRESHOLD_MS
};
