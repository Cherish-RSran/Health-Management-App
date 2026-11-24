const helper = require('../../utils/page');
const api = require('../../utils/api');

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
      // 用 text 而非 digit：digit 键盘无法承载脱敏号，且长度校验由服务端负责
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
  // ⚠️ 必须回填完整号码：列表里的 phone 是脱敏格式，直接提交过不了手机号校验
  return {
    name: item.name,
    relation: item.relation || '',
    phone: item.phone_full || item.phone || ''
  };
}

Page(helper.page({
  autoLoad: false,

  data: {
    person: null,
    archives: { allergy: [], chronic: [], surgery: [], medicine: [], contact: [] },
    medSummary: null,
    typeLabel: TYPE_LABEL,
    showEmergency: false,
    canManage: false,
    accessList: [],
    form: { show: false, title: '', tip: '', fields: [], values: {} },
    formCtx: { type: '', id: '' },
    personForm: { show: false, fields: [], values: {} }
  },

  onLoad(options) {
    this.personId = options.id || '';
    this.isNew = options.new === '1';
    // 从首页跳过来的深链：open=medicine 直接打开用药表单，open=emergency 展开急救卡
    this.openTarget = options.open || '';
    if (this.isNew) {
      this.setData({ loading: false, ready: true, needFamily: false });
      this.openPersonForm();
    }
  },

  onShow() {
    if (this.isNew) return;
    const self = this;
    this.load().then(function () {
      if (self.openTarget === 'medicine') {
        self.openTarget = '';
        setTimeout(function () {
          self.onAddItem({ currentTarget: { dataset: { type: 'medicine' } } });
        }, 250);
      }
    }).catch(function () {});
  },

  fetch() {
    if (!this.personId) return Promise.resolve({});
    const self = this;
    return api.call('archive.list', { person_id: this.personId }, { silent: true })
      .then(function (d) {
        const wantEmergency = self.openTarget === 'emergency';
        if (wantEmergency) self.openTarget = '';
        const canManage = d.person.access_level === 'owner';
        const base = {
          person: d.person,
          archives: d.archives,
          medSummary: d.medicine_summary,
          showEmergency: wantEmergency,
          canManage: canManage
        };
        if (!canManage) return base;
        return api.call('person.accessList', { person_id: self.personId }, { silent: true })
          .then(function (a) {
            base.accessList = a.members || [];
            return base;
          });
      });
  },

  /* ---------- 成员信息 ---------- */
  openPersonForm() {
    const p = this.data.person;
    this.setData({
      personForm: {
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
      }
    });
  },

  onPersonFormSubmit(e) {
    const v = e.detail.values;
    const isManaged = v.profile_type !== '本人档案';
    if (isManaged && !v.consent_note) {
      return api.toast('代管档案需勾选「已获本人同意」');
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
    const self = this;

    if (this.data.person) {
      payload.person_id = this.data.person.id;
      api.call('person.update', payload, { loading: '保存中' }).then(function () {
        self.setData({ 'personForm.show': false });
        api.toastOk('已保存');
        self.load();
      });
      return;
    }

    api.call('person.create', payload, { loading: '创建中' }).then(function (r) {
      api.toastOk('已创建');
      wx.redirectTo({ url: '/pages/person/person?id=' + r.person.id });
    });
  },

  onPersonFormCancel() {
    this.setData({ 'personForm.show': false });
    if (this.isNew) wx.navigateBack();
  },

  /* ---------- 档案项 ---------- */
  onAddItem(e) {
    const type = e.currentTarget.dataset.type;
    const form = FORMS[type];
    const fields = fieldsFor(type, this.data.archives);
    const values = {};
    fields.forEach(function (f) {
      if (f.default !== undefined) values[f.k] = f.default;
    });
    // 紧急联系人：默认填本人手机号。家属录「第一联系人」时填的大多就是自己，
    // 少输一次号码；填了也能随手改，不会锁死。
    if (type === 'contact') {
      const app = getApp();
      const mine = (app && app.globalData.user && app.globalData.user.phone) || '';
      if (mine) values.phone = mine;
    }
    this.setData({
      formCtx: { type: type, id: '' },
      form: {
        show: true, title: '添加' + form.title, tip: form.tip || '',
        fields: fields, values: values
      }
    });
  },

  onEditItem(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    const list = this.data.archives[type] || [];
    const item = list.filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    const form = FORMS[type];
    this.setData({
      formCtx: { type: type, id: id },
      form: {
        show: true, title: '编辑' + form.title, tip: form.tip || '',
        fields: fieldsFor(type, this.data.archives), values: toForm(type, item)
      }
    });
  },

  onFormSubmit(e) {
    const type = this.data.formCtx.type;
    const id = this.data.formCtx.id;
    const payload = Object.assign({
      person_id: this.personId,
      type: type
    }, toPayload(type, e.detail.values));
    const self = this;

    if (id) {
      payload.id = id;
      api.call('archive.update', payload, { loading: '保存中' }).then(function () {
        self.setData({ 'form.show': false });
        api.toastOk('已保存');
        self.load();
      });
      return;
    }

    // 新增用药时，提示同名药重复录入
    if (type === 'medicine') {
      const name = String(payload.name || '').trim().toLowerCase();
      const exists = (self.data.archives.medicine || []).some(function (m) {
        return String(m.name || '').trim().toLowerCase() === name;
      });
      if (exists) {
        api.confirm('已有同名药', '该成员已登记同名药品，重复录入可能造成混淆，仍要添加？').then(function (ok) {
          if (!ok) return;
          self.doAddArchive(payload);
        });
        return;
      }
    }

    self.doAddArchive(payload);
  },

  doAddArchive(payload) {
    const self = this;
    api.call('archive.add', payload, { loading: '保存中' }).then(function () {
      self.setData({ 'form.show': false });
      api.toastOk('已保存');
      self.load();
    });
  },

  onFormCancel() {
    this.setData({ 'form.show': false });
  },

  onItemLongPress(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    const self = this;
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success(res) {
        if (res.tapIndex === 0) {
          return self.onEditItem({ currentTarget: { dataset: { type: type, id: id } } });
        }
        api.confirm('删除', '确认删除「' + name + '」？').then(function (ok) {
          if (!ok) return;
          api.call('archive.remove', { person_id: self.personId, type: type, id: id })
            .then(function () {
              api.toastOk('已删除');
              self.load();
            });
        });
      }
    });
  },

  /* ---------- 医生摘要 / 病程 ---------- */
  onSummary() {
    wx.navigateTo({ url: '/pages/summary/summary?person_id=' + this.personId });
  },

  onEmergency() {
    this.setData({ showEmergency: !this.data.showEmergency });
  },

  onCall(e) {
    const phone = e.currentTarget.dataset.phone;
    wx.makePhoneCall({ phoneNumber: phone, fail: function () {} });
  },

  /* ---------- 档案共享权限（仅档案归属人可设置） ---------- */
  onSetAccess(e) {
    const uid = e.currentTarget.dataset.uid;
    const level = e.currentTarget.dataset.level;
    const self = this;
    api.call('family.grantAccess', {
      person_id: this.personId, user_id: uid, level: level
    }, { loading: '保存中' }).then(function () {
      api.toastOk('已更新');
      const list = (self.data.accessList || []).map(function (m) {
        return m.user_id === uid ? Object.assign({}, m, { level: level }) : m;
      });
      self.setData({ accessList: list });
    }).catch(function () {});
  }
}));
