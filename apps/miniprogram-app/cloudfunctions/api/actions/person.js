/**
 * 档案人 + 常备档案（过敏 / 基础病 / 手术 / 用药 / 紧急联系人）
 *
 * 规则：
 *  - 代管档案必须记录「已获本人（或监护人）同意」，否则拒绝创建
 *  - 敏感字段（id_card、紧急联系人手机号）加密存储、脱敏返回
 *  - 用药用 end_date 区分长期 / 短期疗程
 *  - 一律软删除（status=deleted），不做物理删除
 */

const C = require('../lib/shared/constants');
const V = require('../lib/shared/validate');
const D = require('../lib/shared/date');
const F = require('../lib/shared/format');
const M = require('../lib/shared/model');
const E = require('../lib/errors');
const auth = require('../lib/auth');
const crypto = require('../lib/crypto');

/* ============================================================================
   档案表定义
   ============================================================================ */
const ARCHIVE_TYPES = {
  allergy: {
    coll: C.COLL.allergy,
    label: '过敏史',
    rules: {
      allergen: { type: 'string', required: true, max: 40, label: '过敏原' },
      allergen_type: { type: 'enum', values: ['drug', 'food', 'other'], default: 'other', label: '类型' },
      severity: { type: 'enum', values: ['mild', 'moderate', 'severe', 'unknown'], default: 'unknown', label: '严重程度' },
      reaction: { type: 'string', max: 60, label: '反应' },
      note: { type: 'string', max: 200, label: '备注' }
    }
  },
  chronic: {
    coll: C.COLL.chronic,
    label: '基础病',
    rules: {
      name: { type: 'string', required: true, max: 40, label: '疾病名称' },
      diagnosed_date: { type: 'monthOrDate', label: '确诊时间' },
      status: { type: 'enum', values: ['active', 'cured'], default: 'active', label: '状态' },
      note: { type: 'string', max: 200, label: '备注' }
    }
  },
  surgery: {
    coll: C.COLL.surgery,
    label: '手术史',
    rules: {
      name: { type: 'string', required: true, max: 40, label: '手术名称' },
      surgery_date: { type: 'monthOrDate', label: '手术时间' },
      hospital: { type: 'string', max: 60, label: '医院' },
      note: { type: 'string', max: 200, label: '备注' }
    }
  },
  medicine: {
    coll: C.COLL.medicine,
    label: '用药',
    rules: {
      name: { type: 'string', required: true, max: 40, label: '药品名称' },
      spec: { type: 'string', max: 30, label: '规格' },
      dosage: { type: 'string', max: 30, label: '单次剂量' },
      frequency: { type: 'string', max: 20, label: '频次' },
      time_slots: { type: 'slots', required: true, label: '服用时段' },
      start_date: { type: 'date', label: '开始日期' },
      end_date: { type: 'date', label: '结束日期' },
      // 这药是治哪个病的。故意做成可空、存名称而不是 ID：
      // 老人常有多个慢病，但家属未必记得清每种药对应哪个病；存名称也避免基础病被删后悬空。
      for_disease: { type: 'string', max: 40, label: '用于哪个病' },
      remaining: { type: 'number', min: 0, max: 100000, label: '剩余数量' },
      refill_at: { type: 'date', label: '续方/复诊日期' },
      status: { type: 'enum', values: ['active', 'paused', 'stopped'], default: 'active', label: '状态' },
      note: { type: 'string', max: 200, label: '备注' }
    }
  },
  contact: {
    coll: C.COLL.contact,
    label: '紧急联系人',
    rules: {
      name: { type: 'string', required: true, max: 20, label: '姓名' },
      relation: { type: 'string', max: 10, label: '关系' },
      phone: { type: 'phone', required: true, label: '手机号' },
      priority: { type: 'number', min: 1, max: 9, label: '优先级' }
    }
  }
};

/* ============================================================================
   输出转换（脱敏 / 附加展示字段）
   ============================================================================ */
function toOut(type, row, opts) {
  opts = opts || {};
  const o = {
    id: row._id,
    person_id: row.person_id,
    created_at: row.created_at || 0,
    updated_at: row.updated_at || 0
  };

  if (type === 'allergy') {
    o.allergen = row.allergen;
    o.allergen_type = row.allergen_type || 'other';
    o.severity = row.severity || 'unknown';
    o.reaction = row.reaction || '';
    o.note = row.note || '';
  } else if (type === 'chronic') {
    o.name = row.name;
    o.diagnosed_date = row.diagnosed_date || '';
    o.status = row.status || 'active';
    o.note = row.note || '';
  } else if (type === 'surgery') {
    o.name = row.name;
    o.surgery_date = row.surgery_date || '';
    o.hospital = row.hospital || '';
    o.note = row.note || '';
  } else if (type === 'medicine') {
    o.name = row.name;
    o.spec = row.spec || '';
    o.dosage = row.dosage || '';
    o.frequency = row.frequency || '';
    o.time_slots = row.time_slots || [];
    o.start_date = row.start_date || '';
    o.end_date = row.end_date || '';
    o.for_disease = row.for_disease || '';
    o.status = row.status || 'active';
    o.is_long_term = !row.end_date;
    o.period_text = M.medPeriodText(row);
    o.remaining = (row.remaining === undefined || row.remaining === null) ? null : row.remaining;
    o.refill_at = row.refill_at || '';
    o.refill_at_label = row.refill_at ? D.fmtMD(row.refill_at) : '';
  } else if (type === 'contact') {
    const plain = crypto.decrypt(row.phone || '');
    o.name = row.name;
    o.relation = row.relation || '';
    // 展示一律脱敏；只有对档案有编辑权限的人（家人本人/管理员）才额外拿到可拨打的完整号码
    o.phone = F.maskPhone(plain);
    o.phone_full = opts.fullPhone ? plain : '';
    o.priority = row.priority || 1;
  }
  return o;
}

/** 入库前的字段处理（加密等） */
function toStore(type, typeDef, patch, ctx, isCreate) {
  const data = Object.assign({}, patch);

  if (type === 'contact' && data.phone !== undefined) {
    data.phone = crypto.encrypt(data.phone);
  }
  if (isCreate) {
    data.family_id = ctx.familyId;
    data.status = C.RECORD_STATUS.active;
    data.created_by = ctx.openid;
    data.created_at = ctx.now();
  }
  data.updated_at = ctx.now();
  return data;
}

/* ============================================================================
   档案人 CRUD
   ============================================================================ */
const PERSON_RULES = {
  name: { type: 'string', required: true, max: 20, label: '姓名' },
  gender: { type: 'enum', values: ['male', 'female', 'unknown'], default: 'unknown', label: '性别' },
  birth_date: { type: 'date', label: '出生日期' },
  id_card: { type: 'string', max: 30, label: '身份证号' },
  blood_type: { type: 'enum', values: ['A', 'B', 'O', 'AB', '未知', ''], label: '血型' },
  relation: { type: 'string', max: 10, label: '关系' },
  profile_type: { type: 'enum', values: ['self', 'managed'], required: true, label: '档案类型' },
  consent_note: { type: 'string', max: 100, label: '授权说明' },
  avatar_url: { type: 'string', max: 500, label: '头像' }
};

/** 把必填要求去掉，用于「部分更新」场景 */
function optionalRules(rules) {
  const out = {};
  Object.keys(rules).forEach(function (k) {
    out[k] = Object.assign({}, rules[k]);
    delete out[k].required;
  });
  return out;
}

function personOut(p, level, today) {
  return {
    id: p._id,
    name: p.name,
    relation: p.relation || '',
    gender: p.gender || 'unknown',
    birth_date: p.birth_date || '',
    // 年龄一律按「请求时刻的北京时间」计算，不用运行时系统时钟
    age: D.calcAge(p.birth_date, today || D.todayStr()),
    blood_type: p.blood_type || '',
    profile_type: p.profile_type,
    owner_user_id: p.owner_user_id || '',
    custodian_user_id: p.custodian_user_id || '',
    consent_note: p.consent_note || '',
    avatar_url: p.avatar_url || '',
    // 身份证号脱敏返回，且只有 owner 才拿到
    id_card: level === C.ACCESS.owner ? F.maskIdCard(crypto.decrypt(p.id_card || '')) : '',
    has_id_card: !!p.id_card,
    access_level: level,
    created_at: p.created_at || 0
  };
}

async function list(ctx) {
  ctx.assureFamily();
  const today = D.todayStr(ctx.now());
  const res = await ctx.db.collection(C.COLL.person)
    .where({ family_id: ctx.familyId, status: C.RECORD_STATUS.active })
    .orderBy('created_at', 'asc')
    .limit(C.MAX_PAGE_SIZE)
    .get();

  const out = [];
  for (let i = 0; i < res.data.length; i++) {
    const p = res.data[i];
    const level = await auth.getAccessLevel(ctx.db, p._id, ctx.openid);
    out.push(personOut(p, level, today));
  }
  return { persons: out };
}

async function get(ctx, payload) {
  const r = V.validate({ person_id: { type: 'string', required: true, max: 64, label: '档案' } }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.read);
  const level = await auth.getAccessLevel(ctx.db, person._id, ctx.openid);
  return { person: personOut(person, level, D.todayStr(ctx.now())) };
}

async function create(ctx, payload) {
  ctx.assureFamily();
  const r = V.validate(PERSON_RULES, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const v = r.value;
  const isManaged = v.profile_type === C.PROFILE_TYPE.managed;

  // 代管档案必须有授权说明
  E.assert(
    !isManaged || (v.consent_note && v.consent_note.length > 0),
    C.ERR.E_CONSENT_REQUIRED,
    '代管档案需记录「已获本人（或监护人）同意」'
  );

  const now = ctx.now();
  const data = {
    family_id: ctx.familyId,
    name: v.name,
    gender: v.gender || 'unknown',
    birth_date: v.birth_date || '',
    id_card: v.id_card ? crypto.encrypt(v.id_card) : '',
    blood_type: v.blood_type || '',
    relation: v.relation || '',
    profile_type: v.profile_type,
    owner_user_id: v.profile_type === C.PROFILE_TYPE.self ? ctx.openid : '',
    custodian_user_id: isManaged ? ctx.openid : '',
    consent_note: isManaged ? (v.consent_note || '') : '',
    avatar_url: v.avatar_url || '',
    status: C.RECORD_STATUS.active,
    created_by: ctx.openid,
    created_at: now,
    updated_at: now
  };

  const res = await ctx.db.collection(C.COLL.person).add({ data: data });

  // 创建者自动获得 owner 权限
  await ctx.db.collection(C.COLL.personAccess).add({
    data: {
      family_id: ctx.familyId,
      person_id: res._id,
      user_id: ctx.openid,
      level: C.ACCESS.owner,
      source: isManaged ? 'delegated' : 'self',
      granted_by: ctx.openid,
      granted_at: now
    }
  });

  await ctx.audit({
    action: 'create', target_table: C.COLL.person, target_id: res._id,
    person_id: res._id, detail: { name: v.name }
  });

  const created = await auth.findOne(ctx.db, C.COLL.person, res._id);
  return { person: personOut(created, C.ACCESS.owner, D.todayStr(ctx.now())) };
}

async function update(ctx, payload) {
  const r = V.validate(
    Object.assign(
      { person_id: { type: 'string', required: true, max: 64, label: '档案' } },
      optionalRules(PERSON_RULES)   // 部分更新：不强制必填
    ),
    payload
  );
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.owner);

  const v = Object.assign({}, r.value);
  delete v.person_id;

  const patch = { updated_at: ctx.now() };
  ['name', 'gender', 'birth_date', 'blood_type', 'relation', 'avatar_url', 'consent_note'].forEach(function (k) {
    if (v[k] !== undefined) patch[k] = v[k];
  });
  if (v.id_card !== undefined) patch.id_card = v.id_card ? crypto.encrypt(v.id_card) : '';
  if (v.profile_type !== undefined && v.profile_type !== person.profile_type) {
    E.fail(C.ERR.E_INVALID_PARAM, '档案类型不可更改');
  }

  await ctx.db.collection(C.COLL.person).doc(person._id).update({ data: patch });
  await ctx.audit({
    action: 'update', target_table: C.COLL.person, target_id: person._id, person_id: person._id
  });

  const updated = await auth.findOne(ctx.db, C.COLL.person, person._id);
  return { person: personOut(updated, C.ACCESS.owner, D.todayStr(ctx.now())) };
}

/** 软删除，同时清掉所有人的访问权限 */
async function archive(ctx, payload) {
  const r = V.validate({ person_id: { type: 'string', required: true, max: 64, label: '档案' } }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.owner);

  await ctx.db.collection(C.COLL.person).doc(person._id).update({
    data: { status: C.RECORD_STATUS.archived, updated_at: ctx.now() }
  });
  await ctx.db.collection(C.COLL.personAccess).where({ person_id: person._id }).remove();

  await ctx.audit({
    action: 'delete', target_table: C.COLL.person, target_id: person._id, person_id: person._id
  });
  return { ok: true };
}

/* ============================================================================
   常备档案（5 张表统一入口）
   ============================================================================ */
function typeDef(type) {
  const def = ARCHIVE_TYPES[type];
  E.assert(def, C.ERR.E_INVALID_PARAM, '未知的档案类型：' + type);
  return def;
}

/** 一次取齐某人全部常备档案 */
async function archiveList(ctx, payload) {
  const r = V.validate({ person_id: { type: 'string', required: true, max: 64, label: '档案' } }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.read);
  const today = D.todayStr(ctx.now());
  const level = await auth.getAccessLevel(ctx.db, person._id, ctx.openid);
  const outOpts = { fullPhone: auth.atLeast(level, C.ACCESS.edit) };

  const out = {};
  const keys = Object.keys(ARCHIVE_TYPES);
  for (let i = 0; i < keys.length; i++) {
    const type = keys[i];
    const def = ARCHIVE_TYPES[type];
    const res = await ctx.db.collection(def.coll)
      .where({ person_id: person._id, status: C.RECORD_STATUS.active })
      .orderBy('created_at', 'asc')
      .limit(C.MAX_PAGE_SIZE)
      .get();
    out[type] = res.data.map(function (row) { return toOut(type, row, outOpts); });
  }

  // 用药附加：当前在服 / 已结束
  const meds = out.medicine.map(function (m) {
    return {
      _id: m.id, name: m.name, spec: m.spec, dosage: m.dosage, frequency: m.frequency,
      time_slots: m.time_slots, start_date: m.start_date, end_date: m.end_date, status: m.status
    };
  });

  return {
    person: personOut(person, await auth.getAccessLevel(ctx.db, person._id, ctx.openid), today),
    archives: out,
    medicine_summary: {
      active: M.activeMeds(meds, today).length,
      long_term: M.longTermMeds(meds, today).length,
      short_term: M.shortTermMeds(meds, today).length,
      expired: M.expiredMeds(meds, today).length,
      groups: M.groupMedsBySlot(meds, today).map(function (g) {
        return { slot: g.slot, label: g.label, names: g.items.map(function (x) { return x.name; }) };
      }),
      active_items: M.activeMeds(meds, today).map(function (x) {
        return { name: x.name, spec: x.spec, is_long_term: !x.end_date, period_text: M.medPeriodText(x) };
      })
    }
  };
}

async function archiveAdd(ctx, payload) {
  const def = typeDef(payload.type);
  const r = V.validate(
    Object.assign({ person_id: { type: 'string', required: true, max: 64, label: '档案' } }, def.rules),
    payload
  );
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.edit);

  const v = Object.assign({}, r.value);
  delete v.person_id;

  if (payload.type === 'medicine') {
    const rangeErr = V.checkDateRange(v.start_date, v.end_date);
    E.assert(!rangeErr, C.ERR.E_INVALID_PARAM, rangeErr);
  }

  const data = toStore(payload.type, def, v, ctx, true);
  data.person_id = person._id;

  const res = await ctx.db.collection(def.coll).add({ data: data });
  await ctx.audit({
    action: 'create', target_table: def.coll, target_id: res._id, person_id: person._id,
    detail: { type: payload.type }
  });

  const row = await auth.findOne(ctx.db, def.coll, res._id);
  return { item: toOut(payload.type, row) };
}

async function archiveUpdate(ctx, payload) {
  const def = typeDef(payload.type);
  const r = V.validate(
    Object.assign({
      person_id: { type: 'string', required: true, max: 64, label: '档案' },
      id: { type: 'string', required: true, max: 64, label: '记录' }
    }, optionalRules(def.rules)),   // 部分更新：不强制必填
    payload
  );
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.edit);

  const row = await auth.findOne(ctx.db, def.coll, r.value.id);
  E.assert(row && row.person_id === person._id && row.status === C.RECORD_STATUS.active,
    C.ERR.E_NOT_FOUND, '记录不存在');

  const v = Object.assign({}, r.value);
  delete v.person_id;
  delete v.id;

  if (payload.type === 'medicine') {
    const start = v.start_date !== undefined ? v.start_date : row.start_date;
    const end = v.end_date !== undefined ? v.end_date : row.end_date;
    const rangeErr = V.checkDateRange(start, end);
    E.assert(!rangeErr, C.ERR.E_INVALID_PARAM, rangeErr);
  }

  await ctx.db.collection(def.coll).doc(row._id).update({
    data: toStore(payload.type, def, v, ctx, false)
  });

  await ctx.audit({
    action: 'update', target_table: def.coll, target_id: row._id, person_id: person._id
  });

  const updated = await auth.findOne(ctx.db, def.coll, row._id);
  return { item: toOut(payload.type, updated) };
}

async function archiveRemove(ctx, payload) {
  const def = typeDef(payload.type);
  const r = V.validate({
    person_id: { type: 'string', required: true, max: 64, label: '档案' },
    id: { type: 'string', required: true, max: 64, label: '记录' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.edit);
  const row = await auth.findOne(ctx.db, def.coll, r.value.id);
  E.assert(row && row.person_id === person._id, C.ERR.E_NOT_FOUND, '记录不存在');

  await ctx.db.collection(def.coll).doc(row._id).update({
    data: { status: C.RECORD_STATUS.deleted, updated_at: ctx.now() }
  });

  await ctx.audit({
    action: 'delete', target_table: def.coll, target_id: row._id, person_id: person._id
  });
  return { ok: true };
}

/* ============================================================================
   档案共享权限列表（档案归属人查看 / 设置每位家人的权限）
   ============================================================================ */
async function accessList(ctx, payload) {
  const r = V.validate({ person_id: { type: 'string', required: true, max: 64, label: '档案' } }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.owner);
  const db = ctx.db;

  // 本家庭已通过成员
  const memRes = await db.collection(C.COLL.userFamily)
    .where({ family_id: ctx.familyId, join_status: C.JOIN_STATUS.approved })
    .limit(C.MAX_PAGE_SIZE).get();
  const userIds = memRes.data.map(function (m) { return m.user_id; });

  const userMap = {};
  if (userIds.length) {
    const ur = await db.collection(C.COLL.user)
      .where({ _id: db.command.in(userIds) })
      .limit(C.MAX_PAGE_SIZE).get();
    ur.data.forEach(function (u) { userMap[u._id] = u; });
  }

  // 现有授权
  const accRes = await db.collection(C.COLL.personAccess).where({ person_id: person._id }).get();
  const accMap = {};
  accRes.data.forEach(function (a) { accMap[a.user_id] = a.level; });

  // 排除自己（不能改自己的权限），默认 none（未授权 = 看不到）
  const members = memRes.data
    .filter(function (m) { return m.user_id !== ctx.openid; })
    .map(function (m) {
      return {
        user_id: m.user_id,
        nickname: (userMap[m.user_id] && userMap[m.user_id].nickname) || '成员',
        level: accMap[m.user_id] || C.ACCESS.none
      };
    });

  return { person_name: person.name, members: members };
}

module.exports = {
  list: list,
  get: get,
  create: create,
  update: update,
  archive: archive,
  archiveList: archiveList,
  archiveAdd: archiveAdd,
  archiveUpdate: archiveUpdate,
  archiveRemove: archiveRemove,
  accessList: accessList,
  ARCHIVE_TYPES: ARCHIVE_TYPES,
  PERSON_RULES: PERSON_RULES,
  personOut: personOut
};
