/**
 * 家庭 / 成员 / 权限 相关 action
 *
 * 关键规则：
 *  - 一期一个用户只归属一个家庭
 *  - 邀请码 6 位、7 天有效、全局唯一
 *  - 加入家庭默认 pending，需管理员审批
 *  - **审批通过不等于能看别人档案**：档案可见性一律由 person_access 决定
 */

const C = require('../lib/shared/constants');
const V = require('../lib/shared/validate');
const D = require('../lib/shared/date');
const F = require('../lib/shared/format');
const E = require('../lib/errors');
const auth = require('../lib/auth');

const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混的 0O1I
const INVITE_TTL_DAYS = 7;

function genInviteCode() {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += INVITE_CHARS.charAt(Math.floor(Math.random() * INVITE_CHARS.length));
  }
  return s;
}

/** 生成唯一邀请码（最多重试 8 次） */
async function uniqueInviteCode(db) {
  for (let i = 0; i < 8; i++) {
    const code = genInviteCode();
    const exist = await auth.findWhere(db, C.COLL.family, { invite_code: code });
    if (!exist) return code;
  }
  E.fail(C.ERR.E_INTERNAL, '邀请码生成失败，请重试');
}

/* ============================================================================
   建家庭：同时创建「由我本人管理」的档案
   ============================================================================ */
async function create(ctx, payload) {
  ctx.assureLogin();

  const r = V.validate({
    name: { type: 'string', max: 20, label: '家庭名称' },
    my_name: { type: 'string', max: 20, label: '我的姓名' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  // 已有家庭则直接返回（幂等），不重复创建
  if (ctx.family) {
    return { family: ctx.family, membership: ctx.membership, created: false };
  }

  const db = ctx.db;
  const now = ctx.now();
  const user = ctx.user || {};
  const code = await uniqueInviteCode(db);

  let familyRes;
  try {
    familyRes = await db.collection(C.COLL.family).add({
      data: {
        name: r.value.name || (user.nickname ? user.nickname + '家' : '我的家'),
        owner_user_id: ctx.openid,
        invite_code: code,
        invite_code_expires_at: now + INVITE_TTL_DAYS * D.DAY_MS,
        member_count: 1,
        status: C.RECORD_STATUS.active,
        created_at: now,
        created_by: ctx.openid
      }
    });
  } catch (e) {
    // 并发建家庭：唯一索引 (owner_user_id) 拦截后返回已有家庭
    if (/duplicate key/i.test(String(e && e.message))) {
      const existFamily = await auth.findWhere(db, C.COLL.family, { owner_user_id: ctx.openid });
      if (existFamily) {
        return { family: existFamily, membership: null, created: false };
      }
    }
    throw e;
  }
  const familyId = familyRes._id;

  await db.collection(C.COLL.userFamily).add({
    data: {
      user_id: ctx.openid,
      family_id: familyId,
      role: C.ROLE.admin,
      join_status: C.JOIN_STATUS.approved,
      relation_label: '本人',
      invited_by: '',
      joined_at: now
    }
  });

  // 本人档案（profile_type=self，owner 指向自己）
  const personRes = await db.collection(C.COLL.person).add({
    data: {
      family_id: familyId,
      name: r.value.my_name || user.nickname || '我',
      gender: 'unknown',
      birth_date: '',
      id_card: '',
      blood_type: '',
      relation: '本人',
      profile_type: C.PROFILE_TYPE.self,
      owner_user_id: ctx.openid,
      custodian_user_id: '',
      consent_note: '',
      avatar_url: user.avatar_url || '',
      status: C.RECORD_STATUS.active,
      created_by: ctx.openid,
      created_at: now,
      updated_at: now
    }
  });

  await db.collection(C.COLL.personAccess).add({
    data: {
      family_id: familyId,
      person_id: personRes._id,
      user_id: ctx.openid,
      level: C.ACCESS.owner,
      source: 'self',
      granted_by: ctx.openid,
      granted_at: now
    }
  });

  const family = await auth.findOne(db, C.COLL.family, familyId);
  // 重新载入上下文里的家庭，让本次请求后续逻辑可用
  ctx.family = family;
  ctx.membership = await auth.findWhere(db, C.COLL.userFamily, {
    user_id: ctx.openid, family_id: familyId
  });

  await ctx.audit({
    action: 'create',
    target_table: C.COLL.family,
    target_id: familyId,
    detail: { name: family.name }
  });

  return {
    family: family,
    membership: ctx.membership,
    person_id: personRes._id,
    created: true
  };
}

/* ============================================================================
   凭邀请码加入（需管理员审批）
   ============================================================================ */
async function join(ctx, payload) {
  ctx.assureLogin();

  const r = V.validate({
    code: { type: 'string', max: 12, required: true, label: '邀请码' },
    relation_label: { type: 'string', max: 10, label: '称呼' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const code = String(r.value.code).trim().toUpperCase();
  const db = ctx.db;
  const now = ctx.now();

  const family = await auth.findWhere(db, C.COLL.family, { invite_code: code });
  E.assert(family, C.ERR.E_INVITE_INVALID, '邀请码无效');
  E.assert(
    !family.invite_code_expires_at || family.invite_code_expires_at > now,
    C.ERR.E_INVITE_INVALID,
    '邀请码已过期，请向家人索取新的邀请码'
  );

  // 已经在该家庭（任意状态）时保持幂等
  const exist = await auth.findWhere(db, C.COLL.userFamily, {
    user_id: ctx.openid,
    family_id: family._id
  });

  if (exist) {
    if (exist.join_status === C.JOIN_STATUS.approved) {
      return { status: C.JOIN_STATUS.approved, family_id: family._id, already: true };
    }
    if (exist.join_status === C.JOIN_STATUS.pending) {
      return { status: C.JOIN_STATUS.pending, family_id: family._id, already: true };
    }
    // 曾被拒绝 / 移除 → 允许重新申请
    await db.collection(C.COLL.userFamily).doc(exist._id).update({
      data: { join_status: C.JOIN_STATUS.pending, joined_at: now, relation_label: r.value.relation_label || '' }
    });
    await ctx.audit({ action: 'create', target_table: C.COLL.userFamily, target_id: exist._id });
    return { status: C.JOIN_STATUS.pending, family_id: family._id, already: false };
  }

  let res;
  try {
    res = await db.collection(C.COLL.userFamily).add({
      data: {
        user_id: ctx.openid,
        family_id: family._id,
        role: C.ROLE.member,
        join_status: C.JOIN_STATUS.pending,
        relation_label: r.value.relation_label || '',
        invited_by: family.owner_user_id,
        joined_at: now
      }
    });
  } catch (e) {
    // 并发申请：唯一索引 (user_id, family_id) 拦截后按幂等处理
    if (/duplicate key/i.test(String(e && e.message))) {
      const again = await auth.findWhere(db, C.COLL.userFamily, {
        user_id: ctx.openid, family_id: family._id
      });
      return {
        status: again ? again.join_status : C.JOIN_STATUS.pending,
        family_id: family._id,
        membership_id: again ? again._id : '',
        already: true
      };
    }
    throw e;
  }

  await ctx.audit({
    action: 'create',
    target_table: C.COLL.userFamily,
    target_id: res._id,
    detail: { family_id: family._id }
  });

  return { status: C.JOIN_STATUS.pending, family_id: family._id, membership_id: res._id, already: false };
}

/* ============================================================================
   审批
   ============================================================================ */
async function approve(ctx, payload) {
  ctx.requireAdmin();

  const r = V.validate({
    membership_id: { type: 'string', required: true, max: 64, label: '申请记录' },
    approve: { type: 'bool', default: true, label: '是否通过' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const db = ctx.db;
  const now = ctx.now();
  const m = await auth.findOne(db, C.COLL.userFamily, r.value.membership_id);
  E.assert(m, C.ERR.E_NOT_FOUND, '申请记录不存在');
  E.assert(m.family_id === ctx.familyId, C.ERR.E_NO_PERMISSION, '无权处理该申请');

  const pass = r.value.approve !== false;

  // 幂等：已是目标状态则直接返回
  const target = pass ? C.JOIN_STATUS.approved : C.JOIN_STATUS.rejected;
  if (m.join_status === target) {
    return { join_status: target, already: true };
  }

  await db.collection(C.COLL.userFamily).doc(m._id).update({
    data: { join_status: target, joined_at: now }
  });

  if (pass) {
    // member_count 只在该成员此前不是 approved 时 +1
    if (m.join_status !== C.JOIN_STATUS.approved) {
      await db.collection(C.COLL.family).doc(ctx.familyId).update({
        data: { member_count: db.command.inc(1) }
      });
    }
  } else if (m.join_status === C.JOIN_STATUS.approved) {
    // 从已通过改为拒绝 → 回退计数
    await db.collection(C.COLL.family).doc(ctx.familyId).update({
      data: { member_count: db.command.inc(-1) }
    });
  }

  await ctx.audit({
    action: pass ? 'create' : 'delete',
    target_table: C.COLL.userFamily,
    target_id: m._id,
    detail: { user_id: m.user_id, result: target }
  });

  return { join_status: target, already: false };
}

/* ============================================================================
   成员列表
   ============================================================================ */
async function members(ctx) {
  ctx.assureFamily();
  const db = ctx.db;

  const res = await db.collection(C.COLL.userFamily)
    .where({ family_id: ctx.familyId })
    .orderBy('joined_at', 'asc')
    .limit(C.MAX_PAGE_SIZE)
    .get();

  // 一次性取回所有成员的用户信息，避免逐个查询
  const userIds = res.data.map(function (m) { return m.user_id; });
  const userMap = {};
  if (userIds.length) {
    const ur = await db.collection(C.COLL.user)
      .where({ _id: db.command.in(userIds) })
      .limit(C.MAX_PAGE_SIZE)
      .get();
    ur.data.forEach(function (u) { userMap[u._id] = u; });
  }

  const list = [];
  for (let i = 0; i < res.data.length; i++) {
    const m = res.data[i];
    const u = userMap[m.user_id];
    list.push({
      membership_id: m._id,
      user_id: m.user_id,
      nickname: (u && u.nickname) || '',
      avatar_url: (u && u.avatar_url) || '',
      phone: F.maskPhone((u && u.phone) || ''),
      role: m.role,
      join_status: m.join_status,
      relation_label: m.relation_label || '',
      joined_at: m.joined_at || 0,
      is_me: m.user_id === ctx.openid
    });
  }

  return {
    family: ctx.family,
    members: list.filter(function (x) { return x.join_status === C.JOIN_STATUS.approved; }),
    pending: list.filter(function (x) { return x.join_status === C.JOIN_STATUS.pending; }),
    is_admin: ctx.isAdmin()
  };
}

/* ============================================================================
   移除成员
   ============================================================================ */
async function removeMember(ctx, payload) {
  ctx.requireAdmin();

  const r = V.validate({
    user_id: { type: 'string', required: true, max: 64, label: '成员' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const userId = r.value.user_id;
  E.assert(userId !== ctx.openid, C.ERR.E_INVALID_PARAM, '不能移除自己');
  E.assert(userId !== ctx.family.owner_user_id, C.ERR.E_INVALID_PARAM, '不能移除家庭创建者');

  const db = ctx.db;
  const m = await auth.findWhere(db, C.COLL.userFamily, {
    user_id: userId, family_id: ctx.familyId
  });
  E.assert(m, C.ERR.E_NOT_FOUND, '该成员不在家庭中');

  if (m.join_status === C.JOIN_STATUS.removed) {
    return { ok: true, already: true };
  }

  const wasMember = m.join_status === C.JOIN_STATUS.approved;
  await db.collection(C.COLL.userFamily).doc(m._id).update({
    data: { join_status: C.JOIN_STATUS.removed, removed_at: ctx.now() }
  });

  if (wasMember) {
    await db.collection(C.COLL.family).doc(ctx.familyId).update({
      data: { member_count: db.command.inc(-1) }
    });
  }

  // 同时撤销该用户对本家庭所有档案的权限
  await db.collection(C.COLL.personAccess)
    .where({ user_id: userId, family_id: ctx.familyId })
    .remove();

  await ctx.audit({
    action: 'delete', target_table: C.COLL.userFamily, target_id: m._id,
    detail: { user_id: userId }
  });

  return { ok: true, already: false };
}

/* ============================================================================
   权限授予 / 回收（档案归属人授权）
   ============================================================================ */
async function grantAccess(ctx, payload) {
  ctx.assureFamily();

  const r = V.validate({
    person_id: { type: 'string', required: true, max: 64, label: '档案' },
    user_id: { type: 'string', required: true, max: 64, label: '成员' },
    level: { type: 'enum', values: [C.ACCESS.owner, C.ACCESS.read, C.ACCESS.edit, C.ACCESS.none],
      required: true, label: '权限' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  // 不允许修改自己的权限：一旦把自己降为 none，就再也升不回来（grantAccess 需要 owner）
  E.assert(r.value.user_id !== ctx.openid, C.ERR.E_INVALID_PARAM,
    '不能修改自己的档案权限，请让其他有权限的家人操作');

  const db = ctx.db;
  const now = ctx.now();
  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.owner);

  // 被授权人必须是本家庭的已通过成员
  const m = await auth.findWhere(db, C.COLL.userFamily, {
    user_id: r.value.user_id, family_id: ctx.familyId, join_status: C.JOIN_STATUS.approved
  });
  E.assert(m, C.ERR.E_NOT_FOUND, '该成员不在家庭中');

  const exist = await auth.findWhere(db, C.COLL.personAccess, {
    person_id: r.value.person_id, user_id: r.value.user_id
  });

  if (exist) {
    await db.collection(C.COLL.personAccess).doc(exist._id).update({
      data: { level: r.value.level, granted_by: ctx.openid, granted_at: now }
    });
  } else {
    await db.collection(C.COLL.personAccess).add({
      data: {
        family_id: ctx.familyId,
        person_id: r.value.person_id,
        user_id: r.value.user_id,
        level: r.value.level,
        source: 'delegated',
        granted_by: ctx.openid,
        granted_at: now
      }
    });
  }

  await ctx.audit({
    action: 'share',
    target_table: C.COLL.personAccess,
    target_id: r.value.person_id,
    detail: { to: r.value.user_id, level: r.value.level, person: person.name }
  });

  return { ok: true };
}

/* ============================================================================
   重新生成邀请码
   ============================================================================ */
async function refreshCode(ctx) {
  ctx.requireAdmin();
  const db = ctx.db;
  const now = ctx.now();
  const code = await uniqueInviteCode(db);

  await db.collection(C.COLL.family).doc(ctx.familyId).update({
    data: { invite_code: code, invite_code_expires_at: now + INVITE_TTL_DAYS * D.DAY_MS }
  });

  await ctx.audit({ action: 'update', target_table: C.COLL.family, target_id: ctx.familyId });
  return { invite_code: code, expires_at: now + INVITE_TTL_DAYS * D.DAY_MS };
}

/* ============================================================================
   移交管理员
   ============================================================================ */
async function transferOwner(ctx, payload) {
  ctx.assureFamily();
  E.assert(ctx.family.owner_user_id === ctx.openid, C.ERR.E_NOT_ADMIN, '仅家庭创建者可移交');
  ctx.requireAdmin();

  const r = V.validate({
    user_id: { type: 'string', required: true, max: 64, label: '成员' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const db = ctx.db;
  const target = await auth.findWhere(db, C.COLL.userFamily, {
    user_id: r.value.user_id, family_id: ctx.familyId, join_status: C.JOIN_STATUS.approved
  });
  E.assert(target, C.ERR.E_NOT_FOUND, '该成员不在家庭中');
  E.assert(r.value.user_id !== ctx.openid, C.ERR.E_INVALID_PARAM, '不能移交给自己');

  const mine = await auth.findWhere(db, C.COLL.userFamily, {
    user_id: ctx.openid, family_id: ctx.familyId
  });

  await db.collection(C.COLL.family).doc(ctx.familyId).update({
    data: { owner_user_id: r.value.user_id }
  });
  await db.collection(C.COLL.userFamily).doc(target._id).update({ data: { role: C.ROLE.admin } });
  if (mine) {
    await db.collection(C.COLL.userFamily).doc(mine._id).update({ data: { role: C.ROLE.member } });
  }

  await ctx.audit({
    action: 'update', target_table: C.COLL.family, target_id: ctx.familyId,
    detail: { transfer_to: r.value.user_id }
  });

  return { ok: true };
}

module.exports = {
  create: create,
  join: join,
  approve: approve,
  members: members,
  removeMember: removeMember,
  grantAccess: grantAccess,
  refreshCode: refreshCode,
  transferOwner: transferOwner,
  genInviteCode: genInviteCode,
  INVITE_TTL_DAYS: INVITE_TTL_DAYS
};
