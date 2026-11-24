/**
 * 账号相关 action
 */

const C = require('../lib/shared/constants');
const V = require('../lib/shared/validate');
const F = require('../lib/shared/format');
const E = require('../lib/errors');
const auth = require('../lib/auth');
const crypto = require('../lib/crypto');
const pwd = require('../lib/pwd');

const DEFAULT_CARD_ORDER = ['meds', 'todos', 'emg', 'quick'];

/** 会话有效期：180 天 */
const SESSION_TTL = 180 * 24 * 3600 * 1000;

/**
 * 对外输出的用户信息
 * @param {object} u  user 记录
 * @param {{raw?:boolean}} [opts]  raw=true 时手机号不脱敏（仅用于「本人看自己」）
 */
function publicUser(u, opts) {
  if (!u) return null;
  const raw = !!(opts && opts.raw);
  const phone = crypto.decrypt(u.phone || '');
  return {
    id: u._id,
    nickname: u.nickname || '',
    avatar_url: u.avatar_url || '',
    phone: raw ? phone : F.maskPhone(phone),
    phone_verified: !!u.phone_verified_at,
    has_password: !!u.has_password,
    status: u.status || 'active'
  };
}

function settingOut(s) {
  if (!s) {
    return { large_font: false, card_order: DEFAULT_CARD_ORDER.slice(), default_person_id: '' };
  }
  return {
    large_font: !!s.large_font,
    card_order: (s.card_order && s.card_order.length) ? s.card_order : DEFAULT_CARD_ORDER.slice(),
    default_person_id: s.default_person_id || ''
  };
}

/** 首次调用自动建号；重复调用幂等 */
async function login(ctx) {
  const db = ctx.db;
  const openid = ctx.openid;
  E.assert(openid, C.ERR.E_NOT_LOGIN, '请先登录');

  let user = ctx.user;
  if (!user) {
    try {
      await db.collection(C.COLL.user).add({
        data: {
          _id: openid,
          unionid: '',
          phone: '',
          phone_verified_at: null,
          nickname: '',
          avatar_url: '',
          status: C.RECORD_STATUS.active,
          created_at: ctx.now(),
          updated_at: ctx.now()
        }
      });
    } catch (e) {
      // 并发首次登录时可能已被创建，忽略重复
      if (!/duplicate key/i.test(String(e && e.message))) throw e;
    }
    user = await auth.findOne(db, C.COLL.user, openid);
  }

  // 用户设置：不存在则初始化
  let setting = await auth.findOne(db, C.COLL.userSetting, openid);
  if (!setting) {
    try {
      await db.collection(C.COLL.userSetting).add({
        data: {
          _id: openid,
          large_font: false,
          card_order: DEFAULT_CARD_ORDER.slice(),
          default_person_id: '',
          updated_at: ctx.now()
        }
      });
    } catch (e) {
      if (!/duplicate key/i.test(String(e && e.message))) throw e;
    }
    setting = await auth.findOne(db, C.COLL.userSetting, openid);
  }

  return {
    // 登录返回的是「本人」记录，手机号给明文，方便页面上直接编辑、一键填到紧急联系人
    user: publicUser(user, { raw: true }),
    family: ctx.family || null,
    membership: ctx.membership || null,
    setting: settingOut(setting)
  };
}

async function whoami(ctx) {
  return {
    openid: ctx.openid,
    user: publicUser(ctx.user, { raw: true }),
    family_id: ctx.familyId,
    is_admin: ctx.isAdmin()
  };
}

/** 昵称 / 头像（使用微信「头像昵称填写能力」，用户在页面里填写后提交） */
async function updateProfile(ctx, payload) {
  ctx.assureLogin();
  const r = V.validate({
    nickname: { type: 'string', max: 30, label: '昵称' },
    avatar_url: { type: 'string', max: 500, label: '头像地址' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const patch = { updated_at: ctx.now() };
  if (r.value.nickname !== undefined) patch.nickname = r.value.nickname;
  if (r.value.avatar_url !== undefined) patch.avatar_url = r.value.avatar_url;

  await ctx.db.collection(C.COLL.user).doc(ctx.openid).update({ data: patch });
  await ctx.audit({ action: 'update', target_table: C.COLL.user, target_id: ctx.openid });
  return { ok: true };
}

/** 用户偏好（大字模式、首页卡片顺序） */
async function updateSetting(ctx, payload) {
  ctx.assureLogin();
  const r = V.validate({
    large_font: { type: 'bool', label: '大字模式' },
    card_order: { type: 'array', max: 8, label: '卡片顺序' },
    default_person_id: { type: 'string', max: 64, label: '默认成员' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const patch = { updated_at: ctx.now() };
  if (r.value.large_font !== undefined) patch.large_font = r.value.large_font;
  if (r.value.card_order !== undefined) patch.card_order = r.value.card_order;
  if (r.value.default_person_id !== undefined) patch.default_person_id = r.value.default_person_id;

  const coll = ctx.db.collection(C.COLL.userSetting);
  const exists = await auth.findOne(ctx.db, C.COLL.userSetting, ctx.openid);
  if (exists) {
    await coll.doc(ctx.openid).update({ data: patch });
  } else {
    await coll.add({
      data: Object.assign({
        _id: ctx.openid,
        large_font: false,
        card_order: DEFAULT_CARD_ORDER.slice(),
        default_person_id: ''
      }, patch)
    });
  }
  return { ok: true };
}

/* ============================================================================
   手机号 + 密码 账号
   ----------------------------------------------------------------------------
   与微信 openid 账号**并行存在、互不覆盖**：
     - 小程序里 openid 账号由 auth.login 自动建立，再用 bindCredential 补上手机号密码；
     - 安卓 / 无 openid 环境用 register 直接建一个手机号账号，凭 token 访问。
   会话存在 user_session 表里，由 lib/app.js 在内核层把 token 换成 user_id，
   业务 action 依旧只认 ctx.openid —— 上层代码一行都不用改。
   ============================================================================ */

/** 取（或初始化）用户设置 */
async function ensureSetting(db, uid, now) {
  const s = await auth.findOne(db, C.COLL.userSetting, uid);
  if (s) return s;
  try {
    await db.collection(C.COLL.userSetting).add({
      data: {
        _id: uid,
        large_font: false,
        card_order: DEFAULT_CARD_ORDER.slice(),
        default_person_id: '',
        updated_at: now()
      }
    });
  } catch (e) {
    if (!/duplicate key/i.test(String(e && e.message))) throw e;
  }
  return await auth.findOne(db, C.COLL.userSetting, uid);
}

/** 建会话，返回 token（token 本身就是 user_session 的 _id） */
async function createSession(db, uid, now) {
  const token = pwd.randomHex(24);
  await db.collection(C.COLL.session).add({
    data: { _id: token, user_id: uid, created_at: now(), expires_at: now() + SESSION_TTL }
  });
  return token;
}

/** 组装「登录成功」返回体 —— register / loginByPassword / token 续期共用 */
async function bundle(db, uid, token, now) {
  const c = await auth.loadContext(db, uid);
  const setting = await ensureSetting(db, uid, now);
  return {
    token: token,
    user: publicUser(c.user, { raw: true }),
    family: c.family || null,
    membership: c.membership || null,
    setting: settingOut(setting)
  };
}

/** 手机号 + 密码注册（无需登录态） */
async function register(ctx, payload) {
  const r = V.validate({
    phone: { type: 'phone', required: true, label: '手机号' },
    password: { type: 'string', required: true, max: 64, label: '密码' },
    nickname: { type: 'string', max: 30, label: '昵称' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const pcheck = pwd.checkStrength(r.value.password);
  E.assert(pcheck.ok, C.ERR.E_INVALID_PARAM, pcheck.reason);

  const now = ctx.now;
  const db = ctx.db;
  const phone = r.value.phone;
  const hash = pwd.phoneLookupHash(phone);

  const dup = await auth.findWhere(db, C.COLL.credential, { phone_hash: hash });
  E.assert(!dup, C.ERR.E_DUPLICATE, '该手机号已注册，请直接登录');

  const added = await db.collection(C.COLL.user).add({
    data: {
      unionid: '',
      phone: crypto.encrypt(phone),
      phone_verified_at: null,
      has_password: true,
      nickname: r.value.nickname || '',
      avatar_url: '',
      status: C.RECORD_STATUS.active,
      created_at: now(),
      updated_at: now()
    }
  });
  const uid = added._id;

  await db.collection(C.COLL.credential).add({
    data: {
      user_id: uid,
      phone_enc: crypto.encrypt(phone),
      phone_hash: hash,
      password: pwd.hashPassword(r.value.password),
      created_at: now(),
      updated_at: now()
    }
  });

  const token = await createSession(db, uid, now);
  return await bundle(db, uid, token, now);
}

/** 手机号 + 密码登录（无需登录态） */
async function loginByPassword(ctx, payload) {
  const r = V.validate({
    phone: { type: 'phone', required: true, label: '手机号' },
    password: { type: 'string', required: true, max: 64, label: '密码' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const now = ctx.now;
  const db = ctx.db;
  const cred = await auth.findWhere(db, C.COLL.credential, {
    phone_hash: pwd.phoneLookupHash(r.value.phone)
  });
  // 手机号不存在与密码错误返回同一句话，避免被用来探测某个手机号是否注册过
  E.assert(cred, C.ERR.E_AUTH_FAIL, '手机号或密码不正确');
  E.assert(pwd.verifyPassword(r.value.password, cred.password),
    C.ERR.E_AUTH_FAIL, '手机号或密码不正确');

  const token = await createSession(db, cred.user_id, now);
  return await bundle(db, cred.user_id, token, now);
}

/** 给「已登录的 openid 账号」补上手机号 + 密码（小程序里走这条） */
async function bindCredential(ctx, payload) {
  ctx.assureLogin();
  const r = V.validate({
    phone: { type: 'phone', required: true, label: '手机号' },
    password: { type: 'string', required: true, max: 64, label: '密码' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));
  const pcheck = pwd.checkStrength(r.value.password);
  E.assert(pcheck.ok, C.ERR.E_INVALID_PARAM, pcheck.reason);

  const uid = ctx.openid;
  const now = ctx.now;
  const db = ctx.db;
  const phone = r.value.phone;
  const hash = pwd.phoneLookupHash(phone);

  const other = await auth.findWhere(db, C.COLL.credential, { phone_hash: hash });
  E.assert(!other || other.user_id === uid, C.ERR.E_DUPLICATE, '该手机号已被其他账号使用');

  const mine = await auth.findWhere(db, C.COLL.credential, { user_id: uid });
  if (mine) {
    await db.collection(C.COLL.credential).doc(mine._id).update({
      data: {
        phone_enc: crypto.encrypt(phone),
        phone_hash: hash,
        password: pwd.hashPassword(r.value.password),
        updated_at: now()
      }
    });
  } else {
    await db.collection(C.COLL.credential).add({
      data: {
        user_id: uid,
        phone_enc: crypto.encrypt(phone),
        phone_hash: hash,
        password: pwd.hashPassword(r.value.password),
        created_at: now(),
        updated_at: now()
      }
    });
  }

  await db.collection(C.COLL.user).doc(uid).update({
    data: { phone: crypto.encrypt(phone), has_password: true, updated_at: now() }
  });
  await ctx.audit({ action: 'update', target_table: C.COLL.user, target_id: uid });
  return { ok: true };
}

/** 改绑手机号（传空串 = 解绑） */
async function updatePhone(ctx, payload) {
  ctx.assureLogin();
  const r = V.validate({ phone: { type: 'string', max: 20, label: '手机号' } }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const phone = String(r.value.phone || '').trim();
  if (phone) {
    E.assert(/^1[3-9]\d{9}$/.test(phone), C.ERR.E_INVALID_PARAM, '手机号格式不正确');
  }

  const uid = ctx.openid;
  const now = ctx.now;
  const db = ctx.db;
  const hash = phone ? pwd.phoneLookupHash(phone) : '';

  if (hash) {
    const other = await auth.findWhere(db, C.COLL.credential, { phone_hash: hash });
    E.assert(!other || other.user_id === uid, C.ERR.E_DUPLICATE, '该手机号已被其他账号使用');
    const mine = await auth.findWhere(db, C.COLL.credential, { user_id: uid });
    if (mine) {
      await db.collection(C.COLL.credential).doc(mine._id).update({
        data: { phone_enc: crypto.encrypt(phone), phone_hash: hash, updated_at: now() }
      });
    }
  }

  await db.collection(C.COLL.user).doc(uid).update({
    data: { phone: crypto.encrypt(phone), updated_at: now() }
  });
  await ctx.audit({ action: 'update', target_table: C.COLL.user, target_id: uid });
  return { ok: true };
}

/** 设置 / 修改密码 */
async function updatePassword(ctx, payload) {
  ctx.assureLogin();
  const r = V.validate({
    old_password: { type: 'string', max: 64, label: '原密码' },
    new_password: { type: 'string', required: true, max: 64, label: '新密码' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));
  const pcheck = pwd.checkStrength(r.value.new_password);
  E.assert(pcheck.ok, C.ERR.E_INVALID_PARAM, pcheck.reason);

  const uid = ctx.openid;
  const now = ctx.now;
  const db = ctx.db;

  const mine = await auth.findWhere(db, C.COLL.credential, { user_id: uid });
  if (mine && mine.password) {
    E.assert(r.value.old_password, C.ERR.E_INVALID_PARAM, '请输入原密码');
    E.assert(pwd.verifyPassword(r.value.old_password, mine.password),
      C.ERR.E_AUTH_FAIL, '原密码不正确');
  }

  if (mine) {
    await db.collection(C.COLL.credential).doc(mine._id).update({
      data: { password: pwd.hashPassword(r.value.new_password), updated_at: now() }
    });
  } else {
    // 还没绑过：用当前手机号补建一条
    const phone = crypto.decrypt((ctx.user && ctx.user.phone) || '');
    E.assert(phone, C.ERR.E_INVALID_PARAM, '请先绑定手机号，再设置密码');
    await db.collection(C.COLL.credential).add({
      data: {
        user_id: uid,
        phone_enc: crypto.encrypt(phone),
        phone_hash: pwd.phoneLookupHash(phone),
        password: pwd.hashPassword(r.value.new_password),
        created_at: now(),
        updated_at: now()
      }
    });
  }

  await db.collection(C.COLL.user).doc(uid).update({
    data: { has_password: true, updated_at: now() }
  });
  await ctx.audit({ action: 'update', target_table: C.COLL.user, target_id: uid });
  return { ok: true };
}

/** 登出：删掉会话记录 */
async function logout(ctx, payload) {
  const token = (payload && payload.token) || '';
  if (!token) return { ok: true };
  try {
    await ctx.db.collection(C.COLL.session).doc(token).remove();
  } catch (e) {
    // 会话本来就不存在也算登出成功
  }
  return { ok: true };
}

module.exports = {
  login: login,
  whoami: whoami,
  updateProfile: updateProfile,
  updateSetting: updateSetting,
  register: register,
  loginByPassword: loginByPassword,
  bindCredential: bindCredential,
  updatePhone: updatePhone,
  updatePassword: updatePassword,
  logout: logout,
  publicUser: publicUser,
  settingOut: settingOut,
  DEFAULT_CARD_ORDER: DEFAULT_CARD_ORDER
};
