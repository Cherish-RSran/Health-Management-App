/**
 * 医疗记录三张表：就诊（medical_record）/ 检查报告（exam_report）/ 疫苗（vaccine）
 * 统一走 record.* 入口，用 type 区分。
 */

const C = require('../lib/shared/constants');
const V = require('../lib/shared/validate');
const D = require('../lib/shared/date');
const E = require('../lib/errors');
const auth = require('../lib/auth');

const TYPES = {
  visit: {
    coll: C.COLL.medicalRecord,
    label: '就诊记录',
    rules: {
      date: { type: 'date', required: true, label: '就诊日期' },
      hospital: { type: 'string', required: true, max: 60, label: '医院' },
      department: { type: 'string', max: 30, label: '科室' },
      doctor: { type: 'string', max: 20, label: '医生' },
      visit_type: { type: 'enum', values: ['outpatient', 'inpatient', 'emergency', 'followup'], default: 'outpatient', label: '就诊类型' },
      chief_complaint: { type: 'string', max: 100, label: '主诉' },
      diagnosis: { type: 'string', max: 200, label: '医生记录' },
      advice: { type: 'string', max: 200, label: '医嘱' },
      summary_note: { type: 'string', max: 200, label: '报告要点（人工标注）' }
    }
  },
  exam: {
    coll: C.COLL.examReport,
    label: '检查报告',
    rules: {
      report_type: { type: 'enum', values: ['lab', 'imaging', 'checkup', 'other'], required: true, label: '报告类型' },
      name: { type: 'string', required: true, max: 60, label: '项目名称' },
      date: { type: 'date', required: true, label: '检查日期' },
      hospital: { type: 'string', max: 60, label: '医院' },
      summary: { type: 'string', max: 200, label: '结论摘要' },
      summary_note: { type: 'string', max: 200, label: '报告要点（人工标注）' }
    }
  },
  vaccine: {
    coll: C.COLL.vaccine,
    label: '疫苗记录',
    rules: {
      name: { type: 'string', required: true, max: 40, label: '疫苗名称' },
      dose_no: { type: 'number', min: 1, max: 10, default: 1, label: '针次' },
      date: { type: 'date', required: true, label: '接种日期' },
      institution: { type: 'string', max: 60, label: '接种机构' },
      next_date: { type: 'date', label: '下一针日期' }
    }
  },
  vital: {
    coll: C.COLL.vital,
    label: '体征记录',
    rules: {
      metric_type: { type: 'enum', values: ['blood_pressure', 'blood_glucose', 'weight', 'temperature', 'other'], required: true, label: '指标类型' },
      value: { type: 'string', required: true, max: 20, label: '测量值' },
      unit: { type: 'string', max: 10, label: '单位' },
      date: { type: 'date', required: true, label: '测量日期' },
      note: { type: 'string', max: 200, label: '备注' }
    }
  }
};

function typeDef(type) {
  const def = TYPES[type];
  E.assert(def, C.ERR.E_INVALID_PARAM, '未知的记录类型：' + type);
  return def;
}

/** 前端字段 → 存储字段 */
function toStore(type, v, ctx, isCreate) {
  const data = {};
  if (isCreate) {
    data.family_id = ctx.familyId;
    data.status = C.RECORD_STATUS.active;
    data.created_by = ctx.openid;
    data.created_at = ctx.now();
    data.file_ids = [];
  }
  data.updated_at = ctx.now();

  if (type === 'visit') {
    if (v.date !== undefined) data.visit_date = D.startOfDayTs(v.date);
    ['hospital', 'department', 'doctor', 'visit_type', 'chief_complaint', 'diagnosis', 'advice']
      .forEach(function (k) { if (v[k] !== undefined) data[k] = v[k]; });
  } else if (type === 'exam') {
    if (v.date !== undefined) data.report_date = D.startOfDayTs(v.date);
    ['report_type', 'name', 'hospital', 'summary'].forEach(function (k) {
      if (v[k] !== undefined) data[k] = v[k];
    });
  } else if (type === 'vaccine') {
    if (v.date !== undefined) data.vaccinated_date = v.date;
    if (v.next_date !== undefined) data.next_date = v.next_date;
    ['name', 'dose_no', 'institution'].forEach(function (k) {
      if (v[k] !== undefined) data[k] = v[k];
    });
  } else if (type === 'vital') {
    if (v.date !== undefined) data.vital_date = D.startOfDayTs(v.date);
    ['metric_type', 'value', 'unit', 'note'].forEach(function (k) {
      if (v[k] !== undefined) data[k] = v[k];
    });
  }
  return data;
}

function toOut(type, row) {
  const base = {
    id: row._id, person_id: row.person_id, type: type,
    created_at: row.created_at || 0, updated_at: row.updated_at || 0
  };
  if (type === 'visit') {
    return Object.assign(base, {
      date: D.dateStrOf(row.visit_date),
      date_label: D.fmtMD(D.dateStrOf(row.visit_date)),
      hospital: row.hospital || '',
      department: row.department || '',
      doctor: row.doctor || '',
      visit_type: row.visit_type || 'outpatient',
      visit_type_text: C.VISIT_TYPE[row.visit_type] || '',
      chief_complaint: row.chief_complaint || '',
      diagnosis: row.diagnosis || '',
      advice: row.advice || '',
      summary_note: row.summary_note || '',
      file_ids: row.file_ids || []
    });
  }
  if (type === 'exam') {
    return Object.assign(base, {
      date: D.dateStrOf(row.report_date),
      date_label: D.fmtMD(D.dateStrOf(row.report_date)),
      report_type: row.report_type || 'other',
      name: row.name || '',
      hospital: row.hospital || '',
      summary: row.summary || '',
      summary_note: row.summary_note || '',
      is_checkup: row.report_type === C.REPORT_TYPE.checkup,
      file_ids: row.file_ids || []
    });
  }
  if (type === 'vital') {
    return Object.assign(base, {
      date: D.dateStrOf(row.vital_date),
      date_label: D.fmtMD(D.dateStrOf(row.vital_date)),
      metric_type: row.metric_type || 'other',
      value: row.value || '',
      unit: row.unit || '',
      note: row.note || '',
      file_ids: row.file_ids || []
    });
  }
  return Object.assign(base, {
    date: row.vaccinated_date || '',
    date_label: D.fmtMD(row.vaccinated_date),
    name: row.name || '',
    dose_no: row.dose_no || 1,
    institution: row.institution || '',
    next_date: row.next_date || '',
    file_ids: row.file_ids || []
  });
}

function optional(rules) {
  const out = {};
  Object.keys(rules).forEach(function (k) {
    out[k] = Object.assign({}, rules[k]);
    delete out[k].required;
  });
  return out;
}

/* ============================================================================
   新增
   ============================================================================ */
async function add(ctx, payload) {
  const def = typeDef(payload.type);

  const r = V.validate(Object.assign({
    person_id: { type: 'string', required: true, max: 64, label: '档案' }
  }, def.rules), payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.edit);

  const v = Object.assign({}, r.value);
  delete v.person_id;
  delete v.type;

  const data = toStore(payload.type, v, ctx, true);
  data.person_id = person._id;

  const res = await ctx.db.collection(def.coll).add({ data: data });

  await ctx.audit({
    action: 'create', target_table: def.coll, target_id: res._id,
    person_id: person._id, detail: { type: payload.type }
  });

  const row = await auth.findOne(ctx.db, def.coll, res._id);

  // 疫苗填了下一针日期 → 自动生成待办（一期站内，无推送）
  let todo_id = null;
  if (payload.type === 'vaccine' && v.next_date) {
    const t = await ctx.db.collection(C.COLL.todo).add({
      data: {
        family_id: ctx.familyId,
        person_id: person._id,
        type: C.TODO_TYPE.vaccine,
        title: v.name + ' · 下一针',
        due_date: v.next_date,
        remind_ahead_days: 3,
        status: C.TODO_STATUS.pending,
        source_table: C.COLL.vaccine,
        source_id: res._id,
        note: '由疫苗记录自动生成',
        created_at: ctx.now(),
        created_by: ctx.openid
      }
    });
    todo_id = t._id;
  }

  return { record: toOut(payload.type, row), todo_id: todo_id };
}

/* ============================================================================
   详情 / 更新 / 删除
   ============================================================================ */
async function detail(ctx, payload) {
  const def = typeDef(payload.type);
  const r = V.validate({
    type: { type: 'enum', values: Object.keys(TYPES), required: true, label: '类型' },
    id: { type: 'string', required: true, max: 64, label: '记录' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const row = await auth.findOne(ctx.db, def.coll, r.value.id);
  E.assert(row && row.status === C.RECORD_STATUS.active, C.ERR.E_NOT_FOUND, '记录不存在');
  await ctx.requireAccess(row.person_id, C.ACCESS.read);

  return { record: toOut(payload.type, row) };
}

async function update(ctx, payload) {
  const def = typeDef(payload.type);
  const r = V.validate(Object.assign({
    type: { type: 'enum', values: Object.keys(TYPES), required: true, label: '类型' },
    id: { type: 'string', required: true, max: 64, label: '记录' }
  }, optional(def.rules)), payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const row = await auth.findOne(ctx.db, def.coll, r.value.id);
  E.assert(row && row.status === C.RECORD_STATUS.active, C.ERR.E_NOT_FOUND, '记录不存在');
  await ctx.requireAccess(row.person_id, C.ACCESS.edit);

  const v = Object.assign({}, r.value);
  delete v.id;
  delete v.person_id;
  delete v.type;

  await ctx.db.collection(def.coll).doc(row._id).update({ data: toStore(payload.type, v, ctx, false) });
  await ctx.audit({
    action: 'update', target_table: def.coll, target_id: row._id, person_id: row.person_id
  });

  const updated = await auth.findOne(ctx.db, def.coll, row._id);
  return { record: toOut(payload.type, updated) };
}

async function remove(ctx, payload) {
  const def = typeDef(payload.type);
  const r = V.validate({
    type: { type: 'enum', values: Object.keys(TYPES), required: true, label: '类型' },
    id: { type: 'string', required: true, max: 64, label: '记录' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const row = await auth.findOne(ctx.db, def.coll, r.value.id);
  E.assert(row && row.status === C.RECORD_STATUS.active, C.ERR.E_NOT_FOUND, '记录不存在');
  await ctx.requireAccess(row.person_id, C.ACCESS.edit);

  await ctx.db.collection(def.coll).doc(row._id).update({
    data: { status: C.RECORD_STATUS.deleted, updated_at: ctx.now() }
  });
  await ctx.audit({
    action: 'delete', target_table: def.coll, target_id: row._id, person_id: row.person_id
  });
  return { ok: true };
}

module.exports = {
  add: add, detail: detail, update: update, remove: remove,
  TYPES: TYPES, typeDef: typeDef, toOut: toOut
};
