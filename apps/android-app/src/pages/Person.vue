<script setup>
/** 健康档案（对应 pages/person） */
import { onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { usePage } from '../core/page.js';
import * as api from '../core/api.js';
import { toast, toastOk, actionSheet, makePhoneCall } from '../core/ui.js';
import { push, redirect, back } from '../router/index.js';
import { session } from '../core/session.js';
import FormSheet from '../components/FormSheet.vue';

const route = useRoute();

/* ---------- 档案类型的表单定义与值映射 ---------- */
const TYPE_OPTIONS = ['药物', '食物', '其他'];
const SEV_OPTIONS = ['轻微', '中等', '严重'];
const SLOT_OPTIONS = ['早', '中', '晚', '睡前'];

const TYPE_MAP = { '药物': 'drug', '食物': 'food', '其他': 'other' };
const TYPE_RMAP = { drug: '药物', food: '食物', other: '其他' };
const SEV_MAP = { '轻微': 'mild', '中等': 'moderate', '严重': 'severe' };
const SEV_RMAP = { mild: '轻微', moderate: '中等', severe: '严重' };
const SLOT_MAP = { '早': 'morning', '中': 'noon', '晚': 'evening', '睡前': 'bedtime' };
const SLOT_RMAP = { morning: '早', noon: '中', evening: '晚', bedtime: '睡前' };

const FORMS = {
  allergy: {
    title: '过敏史',
    fields: [
      { k: 'allergen', label: '过敏原', type: 'text', required: true, placeholder: '如 青霉素 / 海鲜' },
      { k: 'allergen_type', label: '类型', type: 'chips', options: TYPE_OPTIONS, default: '药物' },
      { k: 'severity', label: '严重程度', type: 'chips', options: SEV_OPTIONS, default: '中等' },
      { k: 'reaction', label: '过敏反应', type: 'text', placeholder: '如 皮疹、呼吸困难' }
    ]
  },
  chronic: {
    title: '基础病',
    fields: [
      { k: 'name', label: '疾病名称', type: 'text', required: true, placeholder: '如 高血压' },
      { k: 'diagnosed_date', label: '确诊时间', type: 'text', placeholder: '如 2015-03' },
      { k: 'status', label: '状态', type: 'chips', options: ['在治', '已愈'], default: '在治',
        hint: '标成「已愈」后，这个病不会再出现在医生摘要里' }
    ]
  },
  surgery: {
    title: '手术史',
    fields: [
      { k: 'name', label: '手术名称', type: 'text', required: true, placeholder: '如 胆囊切除' },
      { k: 'surgery_date', label: '手术时间', type: 'text', placeholder: '如 2018-05' },
      { k: 'hospital', label: '医院', type: 'text', placeholder: '如 市第一人民医院' }
    ]
  },
  medicine: {
    title: '用药',
    tip: '长期服用的药会一直在首页；短期药填了结束日期，到期后自动从首页移除。',
    fields: [
      { k: 'name', label: '药品名称', type: 'text', required: true, placeholder: '如 氨氯地平' },
      { k: 'spec', label: '规格', type: 'text', placeholder: '如 5mg' },
      { k: 'dosage', label: '单次剂量', type: 'text', placeholder: '如 1 片' },
      { k: 'frequency', label: '频次', type: 'chips', options: ['每日 1 次', '每日 2 次', '每日 3 次', '按需'], default: '每日 1 次' },
      { k: 'slots', label: '服用时段', type: 'multi', required: true, options: SLOT_OPTIONS, default: ['早'],
        hint: '首页「今天要吃的药」按此时段分组' },
      { k: 'start_date', label: '开始日期', type: 'date' },
      { k: 'end_date', label: '结束日期', type: 'date', hint: '留空 = 长期服用；填了就按短期疗程处理' },
      { k: 'remaining', label: '剩余数量（可空）', type: 'number', placeholder: '还余下的药量，如 5 盒' },
      { k: 'refill_at', label: '续方 / 复诊日期（可空）', type: 'date', hint: '填了之后，首页会在临近时提醒「该续方」' },
      // options 留空是故意的：打开表单时会用本人已有的基础病列表动态填上（见 fieldsFor）
      { k: 'for_disease', label: '用于哪个病', type: 'chips', options: [],
        hint: '选了之后，医生摘要里会显示成「药名（病名）」。记不清就留空' }
    ]
  },
  contact: {
    title: '紧急联系人',
    tip: '手机号加密存储，仅展示脱敏结果；拨打时使用完整号码。',
    fields: [
      { k: 'name', label: '姓名', type: 'text', required: true },
      { k: 'relation', label: '关系', type: 'text', placeholder: '如 女儿' },
      // 打开表单时会默认填上本人的手机号（见 onAddItem），家属多数情况就是填自己
      { k: 'phone', label: '手机号', type: 'text', required: true, placeholder: '11 位手机号',
        hint: '已默认填入你的手机号；如果是别人，直接改成他的号码' }
    ]
  }
};

const TYPE_LABEL = {
  allergy: '过敏史', chronic: '基础病', surgery: '手术史',
  medicine: '用药', contact: '紧急联系人'
};

/**
 * 取某类档案的字段定义。
 *
 * 用药的「用于哪个病」选项是**动态**的 —— 来自这个人已登记的基础病列表，
 * 而不是写死的一串枚举。一条基础病都没登记时，这个字段直接不显示，
 * 让人对着空列表选没有意义。
 */
function fieldsFor(type, archives) {
  const fields = (FORMS[type] && FORMS[type].fields) || [];
  if (type !== 'medicine') return fields;

  const names = (((archives || {}).chronic) || [])
    .filter(function (c) { return c && c.name; })
    .map(function (c) { return c.name; });

  if (!names.length) {
    return fields.filter(function (f) { return f.k !== 'for_disease'; });
  }
  return fields.map(function (f) {
    return f.k === 'for_disease' ? Object.assign({}, f, { options: names }) : f;
  });
}

/** 表单值 → 接口入参 */
function toPayload(type, v) {
  if (type === 'allergy') {
    return {
      allergen: v.allergen,
      allergen_type: TYPE_MAP[v.allergen_type] || 'other',
      severity: SEV_MAP[v.severity] || 'unknown',
      reaction: v.reaction || ''
    };
  }
  if (type === 'chronic') {
    return {
      name: v.name,
      diagnosed_date: v.diagnosed_date || '',
      status: v.status === '已愈' ? 'cured' : 'active'
    };
  }
  if (type === 'surgery') {
    return { name: v.name, surgery_date: v.surgery_date || '', hospital: v.hospital || '' };
  }
  if (type === 'medicine') {
    const p = {
      name: v.name, spec: v.spec || '', dosage: v.dosage || '', frequency: v.frequency || '',
      time_slots: (v.slots || []).map(function (x) { return SLOT_MAP[x]; }).filter(Boolean),
      start_date: v.start_date || '', end_date: v.end_date || ''
    };
    if (v.remaining !== undefined && v.remaining !== '') p.remaining = Number(v.remaining);
    if (v.refill_at) p.refill_at = v.refill_at;
    return p;
  }
  return { name: v.name, relation: v.relation || '', phone: String(v.phone || '') };
}

/** 接口数据 → 表单值（编辑回填） */
function toForm(type, item) {
  if (type === 'allergy') {
    return {
      allergen: item.allergen,
      allergen_type: TYPE_RMAP[item.allergen_type] || '其他',
      severity: SEV_RMAP[item.severity] || '中等',
      reaction: item.reaction || ''
    };
  }
  if (type === 'chronic') {
    return {
      name: item.name,
      diagnosed_date: item.diagnosed_date || '',
      status: item.status === 'cured' ? '已愈' : '在治'
    };
  }
  if (type === 'surgery') {
    return { name: item.name, surgery_date: item.surgery_date || '', hospital: item.hospital || '' };
  }
  if (type === 'medicine') {
    return {
      name: item.name, spec: item.spec || '', dosage: item.dosage || '',
      frequency: item.frequency || '', slots: (item.time_slots || []).map(function (x) { return SLOT_RMAP[x]; }),
      start_date: item.start_date || '', end_date: item.end_date || '',
      remaining: (item.remaining === null || item.remaining === undefined) ? '' : String(item.remaining),
      refill_at: item.refill_at || ''
    };
  }
  // 必须回填完整号码：列表里的 phone 是脱敏格式，直接提交过不了手机号校验
  return {
    name: item.name,
    relation: item.relation || '',
    phone: item.phone_full || item.phone || ''
  };
}

const EMPTY_ARCHIVES = { allergy: [], chronic: [], surgery: [], medicine: [], contact: [] };

const personId = route.query.id || '';
const isNew = route.query.new === '1';
// 首页跳过来的深链：open=medicine 直接打开用药表单，open=emergency 展开急救卡
let openTarget = route.query.open || '';

const { state, load } = usePage({
  autoLoad: !isNew,
  data: {
    person: null,
    archives: Object.assign({}, EMPTY_ARCHIVES),
    medSummary: null,
    typeLabel: TYPE_LABEL,
    showEmergency: false,
    form: { show: false, title: '', tip: '', fields: [], values: {} },
    formCtx: { type: '', id: '' },
    personForm: { show: false, fields: [], values: {} },
    canManage: false,
    accessList: []
  },
  fetch: async function () {
    if (!personId) return {};
    const d = await api.call('archive.list', { person_id: personId }, { silent: true });
    const wantEmergency = openTarget === 'emergency';
    if (wantEmergency) openTarget = '';
    const canManage = d.person && d.person.access_level === 'owner';
    const base = {
      person: d.person,
      archives: Object.assign({}, EMPTY_ARCHIVES, d.archives || {}),
      medSummary: d.medicine_summary,
      showEmergency: wantEmergency,
      canManage: canManage,
      accessList: []
    };
    if (!canManage) return base;
    try {
      const a = await api.call('person.accessList', { person_id: personId }, { silent: true });
      base.accessList = a.members || [];
    } catch (e) { /* 权限列表非关键，失败不阻塞 */ }
    return base;
  }
});

const archives = computed(function () {
  return Object.assign({}, EMPTY_ARCHIVES, state.archives || {});
});

onMounted(function () {
  if (isNew) {
    state.loading = false;
    state.ready = true;
    state.needFamily = false;
    openPersonForm();
    return;
  }
  load().then(function () {
    if (openTarget === 'medicine') {
      openTarget = '';
      setTimeout(function () { onAddItem('medicine'); }, 250);
    }
  }).catch(function () {});
});

/* ---------- 成员信息 ---------- */
function openPersonForm() {
  const p = state.person;
  state.personForm = {
    show: true,
    fields: [
      { k: 'name', label: '姓名', type: 'text', required: true },
      { k: 'relation', label: '关系', type: 'chips', options: ['本人', '父亲', '母亲', '配偶', '儿子', '女儿', '其他'] },
      { k: 'gender', label: '性别', type: 'chips', options: ['男', '女'] },
      { k: 'birth_date', label: '出生日期', type: 'date' },
      { k: 'blood_type', label: '血型', type: 'chips', options: ['A', 'B', 'O', 'AB', '未知'] },
      { k: 'profile_type', label: '档案类型', type: 'chips', required: true, options: ['本人档案', '代管档案'] },
      { k: 'consent_note', label: '代管授权', type: 'chips', options: ['已获本人（或监护人）同意'],
        hint: '代管他人档案必须取得本人同意' }
    ],
    values: p ? {
      name: p.name,
      relation: p.relation,
      gender: p.gender === 'male' ? '男' : (p.gender === 'female' ? '女' : ''),
      birth_date: p.birth_date,
      blood_type: p.blood_type,
      profile_type: p.profile_type === 'self' ? '本人档案' : '代管档案',
      consent_note: p.consent_note ? '已获本人（或监护人）同意' : ''
    } : {
      relation: '父亲', profile_type: '代管档案'
    }
  };
}

async function onPersonFormSubmit(e) {
  const v = e.values;
  const isManaged = v.profile_type !== '本人档案';
  if (isManaged && !v.consent_note) {
    return toast('代管档案需勾选「已获本人同意」');
  }
  const payload = {
    name: v.name,
    relation: v.relation || '',
    gender: v.gender === '男' ? 'male' : (v.gender === '女' ? 'female' : 'unknown'),
    birth_date: v.birth_date || '',
    blood_type: v.blood_type || '',
    profile_type: isManaged ? 'managed' : 'self',
    consent_note: isManaged ? (v.consent_note || '') : ''
  };

  if (state.person) {
    payload.person_id = state.person.id;
    await api.call('person.update', payload, { loading: '保存中' });
    state.personForm.show = false;
    toastOk('已保存');
    load();
    return;
  }

  const r = await api.call('person.create', payload, { loading: '创建中' });
  // 先关弹层再跳：路由重建需要一帧，不关的话会看到弹层一闪
  state.personForm.show = false;
  toastOk('已创建');
  redirect('/person?id=' + r.person.id);
}

function onPersonFormCancel() {
  state.personForm.show = false;
  if (isNew) back();
}

/* ---------- 档案项 ---------- */
function onAddItem(type) {
  const form = FORMS[type];
  const fields = fieldsFor(type, archives.value);
  const values = {};
  fields.forEach(function (f) {
    if (f.default !== undefined) values[f.k] = f.default;
  });
  // 紧急联系人：默认填本人手机号。家属录「第一联系人」时填的大多就是自己，
  // 少输一次号码；填了也能随手改，不会锁死。
  if (type === 'contact') {
    const mine = (session.user && session.user.phone) || '';
    if (mine) values.phone = mine;
  }
  state.formCtx = { type: type, id: '' };
  state.form = {
    show: true, title: '添加' + form.title, tip: form.tip || '',
    fields: fields, values: values
  };
}

function onEditItem(type, id) {
  const list = archives.value[type] || [];
  const item = list.filter(function (x) { return x.id === id; })[0];
  if (!item) return;
  const form = FORMS[type];
  state.formCtx = { type: type, id: id };
  state.form = {
    show: true, title: '编辑' + form.title, tip: form.tip || '',
    fields: fieldsFor(type, archives.value), values: toForm(type, item)
  };
}

async function onFormSubmit(e) {
  const type = state.formCtx.type;
  const id = state.formCtx.id;
  const payload = Object.assign({
    person_id: personId,
    type: type
  }, toPayload(type, e.values));

  if (id) {
    payload.id = id;
    await api.call('archive.update', payload, { loading: '保存中' });
  } else {
    // 新增用药时，提示同名药重复录入
    if (type === 'medicine') {
      const name = String(payload.name || '').trim().toLowerCase();
      const exists = (archives.medicine || []).some(function (m) {
        return String(m.name || '').trim().toLowerCase() === name;
      });
      if (exists) {
        const ok = await api.confirm('已有同名药', '该成员已登记同名药品，重复录入可能造成混淆，仍要添加？');
        if (!ok) return;
      }
    }
    await api.call('archive.add', payload, { loading: '保存中' });
  }
  state.form.show = false;
  toastOk('已保存');
  load();
}

function onFormCancel() { state.form.show = false; }

async function onItemLongPress(type, id, name) {
  const idx = await actionSheet(['编辑', '删除']);
  if (idx === 0) return onEditItem(type, id);
  if (idx !== 1) return;
  const ok = await api.confirm('删除', '确认删除「' + name + '」？');
  if (!ok) return;
  await api.call('archive.remove', { person_id: personId, type: type, id: id });
  toastOk('已删除');
  load();
}

/* ---------- 共享权限（仅档案归属人可设置） ---------- */
async function onSetAccess(uid, level) {
  try {
    await api.call('family.grantAccess', { person_id: personId, user_id: uid, level: level }, { loading: '保存中' });
    const list = (state.accessList || []).map(function (m) {
      return m.user_id === uid ? Object.assign({}, m, { level: level }) : m;
    });
    state.accessList = list;
    toastOk('权限已更新');
  } catch (e) { /* 静默 */ }
}

/* ---------- 医生摘要 / 病程 ---------- */
function onSummary() { push('/summary?person_id=' + personId); }
function onEmergency() { state.showEmergency = !state.showEmergency; }
function onCall(phone) { makePhoneCall(phone); }

function slotText(arr) {
  if (!arr || !arr.length) return '—';
  return arr.map(function (s) { return SLOT_RMAP[s] || s; }).join('');
}
function genderText(g) {
  return g === 'male' ? '男' : (g === 'female' ? '女' : '—');
}
function allergyTypeText(t) {
  return t === 'drug' ? '药物' : (t === 'food' ? '食物' : '其他');
}
function sevText(s) {
  return s === 'severe' ? '严重' : (s === 'moderate' ? '中等' : (s === 'mild' ? '轻微' : '未知'));
}
</script>

<template>
  <div class="page" :class="{ 'big-mode': state.big }">

    <div v-if="state.loading" class="empty">加载中…</div>

    <template v-else-if="state.error">
      <div class="empty">{{ state.error }}</div>
      <div class="btn btn-primary btn-block" @click="load">重试</div>
    </template>

    <template v-else-if="state.person">
      <!-- 头部 -->
      <div class="head">
        <div class="head-avatar">{{ state.person.relation || state.person.name }}</div>
        <div class="flex1">
          <div class="head-name">
            {{ state.person.name }}
            <span class="tag" :class="state.person.profile_type === 'self' ? 'tag-md' : 'tag-short'">
              {{ state.person.profile_type === 'self' ? '本人档案' : '代管档案' }}
            </span>
          </div>
          <div class="head-sub">
            {{ genderText(state.person.gender) }}
            <span v-if="state.person.age || state.person.age === 0"> · {{ state.person.age }} 岁</span>
            <span v-if="state.person.blood_type"> · {{ state.person.blood_type }} 型</span>
          </div>
        </div>
        <div class="edit-btn" @click="openPersonForm">编辑</div>
      </div>

      <!-- 代管授权 -->
      <div v-if="state.person.profile_type === 'managed'" class="card auth-note">
        <div class="auth-title">代管授权</div>
        <div class="auth-body">
          {{ state.person.consent_note || '未记录授权说明' }}
          <div class="muted">《个人信息保护法》第 29 条：处理敏感个人信息须取得单独同意</div>
        </div>
      </div>

      <!-- 过敏史 -->
      <div class="card block">
        <div class="sec-title">
          <div class="h"><div class="bar danger-bar"></div>过敏史</div>
          <div class="more">{{ archives.allergy.length }} 条</div>
        </div>
        <div class="item" v-for="a in archives.allergy" :key="a.id"
             v-longpress="() => onItemLongPress('allergy', a.id, a.allergen)">
          <div class="item-k">{{ a.allergen }}</div>
          <div class="item-v danger">
            {{ allergyTypeText(a.allergen_type) }}
            · {{ sevText(a.severity) }}
            <span v-if="a.reaction"> · {{ a.reaction }}</span>
          </div>
        </div>
        <div v-if="!archives.allergy.length" class="muted pad">暂无记录</div>
        <div class="addline" @click="onAddItem('allergy')">＋ 添加</div>
      </div>

      <!-- 基础病（长期病）：会一直带着，已愈的不进医生摘要 -->
      <div class="card block">
        <div class="sec-title">
          <div class="h"><div class="bar"></div>基础病（长期）</div>
          <div class="more">{{ archives.chronic.length }} 条</div>
        </div>
        <div class="item" v-for="c in archives.chronic" :key="c.id"
             v-longpress="() => onItemLongPress('chronic', c.id, c.name)">
          <div class="item-k">{{ c.diagnosed_date || '—' }}</div>
          <div class="item-v">
            {{ c.name }}
            <span v-if="c.status === 'cured'" class="tag tag-grey">已愈</span>
          </div>
        </div>
        <div v-if="!archives.chronic.length" class="muted pad">暂无记录</div>
        <div class="addline" @click="onAddItem('chronic')">＋ 添加</div>
      </div>

      <!-- 用药 -->
      <div class="card block">
        <div class="sec-title">
          <div class="h"><div class="bar"></div>用药</div>
          <div class="more">在服 {{ state.medSummary ? state.medSummary.active : 0 }} 种</div>
        </div>
        <div class="item" v-for="m in archives.medicine" :key="m.id"
             v-longpress="() => onItemLongPress('medicine', m.id, m.name)">
          <div class="item-k">{{ slotText(m.time_slots) }}</div>
          <div class="item-v">
            <span class="bold">{{ m.name }}</span>
            <span v-if="m.for_disease" class="muted">（{{ m.for_disease }}）</span>
            <span class="muted"> {{ m.spec }}{{ m.dosage ? ' · ' + m.dosage : '' }} · {{ m.frequency }}</span>
            <div class="period" :class="{ short: !m.is_long_term }">{{ m.period_text }}</div>
            <div v-if="m.remaining !== null && m.remaining !== undefined && m.remaining !== ''" class="med-extra">剩 {{ m.remaining }}</div>
            <div v-if="m.refill_at_label" class="med-extra warn">续方 / 复诊 {{ m.refill_at_label }}</div>
          </div>
        </div>
        <div v-if="!archives.medicine.length" class="muted pad">暂无记录</div>
        <div class="addline" @click="onAddItem('medicine')">＋ 添加用药</div>
      </div>

      <!-- 手术史 -->
      <div class="card block">
        <div class="sec-title">
          <div class="h"><div class="bar"></div>手术史</div>
          <div class="more">{{ archives.surgery.length }} 条</div>
        </div>
        <div class="item" v-for="s in archives.surgery" :key="s.id"
             v-longpress="() => onItemLongPress('surgery', s.id, s.name)">
          <div class="item-k">{{ s.surgery_date || '—' }}</div>
          <div class="item-v">{{ s.name }}
            <span v-if="s.hospital" class="muted"> · {{ s.hospital }}</span>
          </div>
        </div>
        <div v-if="!archives.surgery.length" class="muted pad">暂无记录</div>
        <div class="addline" @click="onAddItem('surgery')">＋ 添加</div>
      </div>

      <!-- 紧急联系人 -->
      <div class="card block">
        <div class="sec-title">
          <div class="h"><div class="bar"></div>紧急联系人</div>
          <div class="more">{{ archives.contact.length }} 人</div>
        </div>
        <div class="item" v-for="c in archives.contact" :key="c.id"
             v-longpress="() => onItemLongPress('contact', c.id, c.name)">
          <div class="item-k">{{ c.relation || '—' }}</div>
          <div class="item-v">
            {{ c.name }} · {{ c.phone }}
            <span v-if="c.phone_full" class="call" @click.stop="onCall(c.phone_full)">拨打</span>
          </div>
        </div>
        <div v-if="!archives.contact.length" class="muted pad">暂无记录</div>
        <div class="addline" @click="onAddItem('contact')">＋ 添加</div>
      </div>

      <!-- 共享权限（仅档案归属人可设置每位家人的权限） -->
      <div v-if="state.canManage" class="card block">
        <div class="sec-title">
          <div class="h"><div class="bar"></div>共享权限</div>
          <div class="more">{{ state.accessList.length }} 位</div>
        </div>
        <div class="acc" v-for="m in state.accessList" :key="m.user_id">
          <div class="acc-name">{{ m.nickname }}</div>
          <div class="acc-levels">
            <div class="lv" :class="{ on: m.level === 'none' }" @click="onSetAccess(m.user_id, 'none')">无</div>
            <div class="lv" :class="{ on: m.level === 'read' }" @click="onSetAccess(m.user_id, 'read')">查看</div>
            <div class="lv" :class="{ on: m.level === 'edit' }" @click="onSetAccess(m.user_id, 'edit')">记录</div>
          </div>
        </div>
        <div v-if="!state.accessList.length" class="muted pad">家庭成员不足 2 人时无需设置</div>
      </div>

      <!-- 紧急信息卡 -->
      <div class="card emergency-toggle" @click="onEmergency">
        <div class="emg-title">紧急信息卡</div>
        <div class="muted">血型 · 过敏史 · 在服药物 · 紧急联系人，急救时可直接出示</div>
      </div>

      <div v-if="state.showEmergency" class="card emg-card">
        <div class="emg-name">{{ state.person.name }}</div>
        <div class="muted">
          {{ genderText(state.person.gender) }} · {{ state.person.age }} 岁 · {{ state.person.blood_type }} 型
        </div>
        <div class="emg-line">
          <div class="emg-k">过敏史</div>
          <div class="emg-v danger">
            <template v-if="archives.allergy.length">
              <span v-for="a in archives.allergy" :key="a.id">{{ a.allergen }} </span>
            </template>
            <template v-else>无已知过敏</template>
          </div>
        </div>
        <div class="emg-line">
          <div class="emg-k">基础病</div>
          <div class="emg-v">
            <template v-if="archives.chronic.length">
              <span v-for="c in archives.chronic" :key="c.id">{{ c.name }} </span>
            </template>
            <template v-else>无</template>
          </div>
        </div>
        <div class="emg-line">
          <div class="emg-k">在服药物</div>
          <div class="emg-v">
            <template v-if="state.medSummary && (state.medSummary.active_items || []).length">
              <div v-for="it in state.medSummary.active_items" :key="it.name">
                {{ it.name }} {{ it.spec }}<span v-if="!it.is_long_term" class="tag tag-short">短期</span>
              </div>
            </template>
            <template v-else>无</template>
          </div>
        </div>
        <div class="emg-note">本卡为家庭自填记录，非医疗机构出具。紧急情况请立即拨打 120。</div>
      </div>

      <div class="bottom-actions">
        <div class="btn btn-ghost flex1" @click="openPersonForm">编辑成员</div>
        <div class="btn btn-primary sum-btn" @click="onSummary">医生摘要 →</div>
      </div>
    </template>

    <!-- 新增模式下的空态 -->
    <div v-else-if="!state.loading" class="empty">请填写成员信息</div>

    <!-- 档案项表单 -->
    <FormSheet :show="state.form.show" :title="state.form.title" :tip="state.form.tip"
               :fields="state.form.fields" :values="state.form.values"
               @submit="onFormSubmit" @cancel="onFormCancel" />

    <!-- 成员表单 -->
    <FormSheet :show="state.personForm.show"
               :title="state.person ? '编辑成员' : '添加家庭成员'"
               :tip="state.person ? '' : '给老人或小孩代管档案时，必须取得本人（或监护人）同意'"
               :fields="state.personForm.fields" :values="state.personForm.values"
               @submit="onPersonFormSubmit" @cancel="onPersonFormCancel" />
  </div>
</template>
