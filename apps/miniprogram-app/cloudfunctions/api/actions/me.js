/**
 * 「我的」相关：家庭动态、数据导出
 */

const C = require('../lib/shared/constants');
const V = require('../lib/shared/validate');
const D = require('../lib/shared/date');
const M = require('../lib/shared/model');
const E = require('../lib/errors');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const timeline = require('./timeline');
const Q = require('../lib/query');
const F = require('../lib/shared/format');
const crypto = require('../lib/crypto');

/** 家庭动态（audit_log） */
async function logs(ctx, payload) {
  ctx.assureFamily();
  const r = V.validate({
    limit: { type: 'number', min: 1, max: C.MAX_PAGE_SIZE, default: 20, label: '条数' },
    skip: { type: 'number', min: 0, default: 0, label: '偏移' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const rows = await audit.list(ctx.db, ctx.familyId, r.value);

  // 批量取操作者昵称（避免逐条查询）
  const actorIds = [];
  rows.forEach(function (l) {
    if (!l.actor_name && l.actor_user_id && actorIds.indexOf(l.actor_user_id) < 0) {
      actorIds.push(l.actor_user_id);
    }
  });
  const nameMap = {};
  if (actorIds.length) {
    const ur = await ctx.db.collection(C.COLL.user)
      .where({ _id: ctx.db.command.in(actorIds) })
      .limit(C.MAX_PAGE_SIZE)
      .get();
    ur.data.forEach(function (u) { nameMap[u._id] = u.nickname || ''; });
  }

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i];
    let name = l.actor_name;
    if (!name) {
      // 没设昵称时用 ID 后 4 位区分，避免动态里全是「家人」
      name = nameMap[l.actor_user_id] || ('成员' + String(l.actor_user_id).slice(-4));
    }
    out.push({
      id: l._id,
      who: name,
      is_me: l.actor_user_id === ctx.openid,
      action: l.action,
      action_text: {
        create: '新增', update: '修改', delete: '删除', view: '查看', export: '导出', share: '授权'
      }[l.action] || l.action,
      target_table: l.target_table,
      target_id: l.target_id,
      person_id: l.person_id || '',
      detail: l.detail || {},
      at: D.fmtDateTime(l.created_at),
      created_at: l.created_at
    });
  }
  return { logs: out };
}

/**
 * 全量导出（只导出当前用户**有权限**的档案）
 *
 * 注意：必须循环分页拉全，单次 limit 会静默截断，"全量导出"就不成立了。
 */
async function exportData(ctx) {
  ctx.assureFamily();
  const db = ctx.db;
  const familyId = ctx.familyId;

  const ids = await timeline.accessiblePersonIds(ctx);
  if (!ids.length) {
    return { exported_at: D.fmtDateTime(ctx.now()), family: ctx.family, persons: [], archives: {} };
  }

  const inIds = db.command.in(ids);
  const active = C.RECORD_STATUS.active;
  let anyTruncated = false;

  // 每个查询都是「必须拿全」的，统一走 fetchAll
  const all = async function (coll, where) {
    const r = await Q.fetchAll(db, coll, where);
    if (r.truncated) anyTruncated = true;
    return r.rows;
  };

  const persons = await all(C.COLL.person, { _id: inIds, status: active });
  const allergy = await all(C.COLL.allergy, { person_id: inIds, status: active });
  const chronic = await all(C.COLL.chronic, { person_id: inIds, status: active });
  const surgery = await all(C.COLL.surgery, { person_id: inIds, status: active });
  const medicine = await all(C.COLL.medicine, { person_id: inIds, status: active });
  const contacts = await all(C.COLL.contact, { person_id: inIds, status: active });
  const conditions = await all(C.COLL.condition, { person_id: inIds, status: db.command.neq(C.RECORD_STATUS.deleted) });
  const events = await all(C.COLL.event, { person_id: inIds, status: active });
  const records = await all(C.COLL.medicalRecord, { person_id: inIds, status: active });
  const exams = await all(C.COLL.examReport, { person_id: inIds, status: active });
  const vaccines = await all(C.COLL.vaccine, { person_id: inIds, status: active });
  const todos = await all(C.COLL.todo, { person_id: inIds });

  // 手机号等敏感字段在导出时保持脱敏，避免明文外泄
  const contactOut = contacts.map(function (c) {
    return {
      person_id: c.person_id, name: c.name, relation: c.relation,
      phone_masked: F.maskPhone(crypto.decrypt(c.phone || '')),
      priority: c.priority
    };
  });

  await ctx.audit({
    action: 'export', target_table: C.COLL.person, target_id: '',
    detail: { persons: ids.length, truncated: anyTruncated }
  });

  return {
    exported_at: D.fmtDateTime(ctx.now()),
    truncated: anyTruncated,
    counts: {
      persons: persons.length,
      archives: allergy.length + chronic.length + surgery.length + medicine.length + contacts.length,
      conditions: conditions.length,
      events: events.length,
      records: records.length,
      exams: exams.length,
      vaccines: vaccines.length,
      todos: todos.length
    },
    family: { name: ctx.family.name, member_count: ctx.family.member_count },
    persons: persons.map(function (p) {
      return {
        id: p._id, name: p.name, relation: p.relation, gender: p.gender,
        birth_date: p.birth_date, blood_type: p.blood_type,
        profile_type: p.profile_type, consent_note: p.consent_note || ''
      };
    }),
    archives: {
      allergy: allergy, chronic: chronic, surgery: surgery,
      medicine: medicine, contact: contactOut
    },
    conditions: conditions,
    timeline_events: events,
    medical_records: records,
    exam_reports: exams,
    vaccines: vaccines,
    todos: todos
  };
}

/** 数据概览（导出页展示） */
async function stats(ctx) {
  ctx.assureFamily();
  const db = ctx.db;
  const ids = await timeline.accessiblePersonIds(ctx);
  if (!ids.length) {
    return { persons: 0, conditions: 0, events: 0, archives: 0, todos: 0 };
  }
  const inIds = db.command.in(ids);
  const active = C.RECORD_STATUS.active;

  const rs = await Promise.all([
    db.collection(C.COLL.person).where({ _id: inIds, status: active }).count(),
    db.collection(C.COLL.condition).where({ person_id: inIds, status: db.command.neq(C.RECORD_STATUS.deleted) }).count(),
    db.collection(C.COLL.event).where({ person_id: inIds, status: active }).count(),
    db.collection(C.COLL.medicine).where({ person_id: inIds, status: active }).count(),
    db.collection(C.COLL.todo).where({ person_id: inIds }).count()
  ]);

  return {
    persons: rs[0].total,
    conditions: rs[1].total,
    events: rs[2].total,
    medicines: rs[3].total,
    todos: rs[4].total
  };
}

module.exports = { logs: logs, exportData: exportData, stats: stats };
