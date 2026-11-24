const helper = require('../../utils/page');
const api = require('../../utils/api');
const D = require('../../utils/date');
const C = require('../../utils/constants');

const SYMPTOMS = ['咳嗽', '发热', '腹泻', '咽痛', '头痛', '皮疹', '其他'];

/** 指标标签 → 后端枚举值（form 里用的是中文标签，提交时要转回 key） */
const METRIC_RMAP = {
  '血压': 'blood_pressure', '血糖': 'blood_glucose', '体重': 'weight',
  '体温': 'temperature', '其他': 'other'
};

/* ---------- 各模式的表单定义 ---------- */
const FORMS = {
  visit: {
    title: '记录就诊', submitText: '保存',
    fields: [
      { k: 'date', label: '就诊日期', type: 'date', required: true },
      { k: 'hospital', label: '医院', type: 'text', required: true, placeholder: '如 市第一人民医院' },
      { k: 'department', label: '科室', type: 'text', placeholder: '如 呼吸内科' },
      { k: 'visit_type', label: '就诊类型', type: 'chips', options: ['门诊', '急诊', '住院', '复诊'], default: '门诊' },
      { k: 'doctor', label: '医生（可空）', type: 'text' },
      { k: 'diagnosis', label: '医生记录（照抄医生原话）', type: 'textarea',
        placeholder: '系统不会自动生成任何诊断，此处只记录医生说的话' },
      { k: 'advice', label: '医嘱（可空）', type: 'text' }
    ],
    toPayload: function (v) {
      return {
        date: v.date, hospital: v.hospital, department: v.department || '',
        visit_type: { '门诊': 'outpatient', '急诊': 'emergency', '住院': 'inpatient', '复诊': 'followup' }[v.visit_type] || 'outpatient',
        doctor: v.doctor || '', diagnosis: v.diagnosis || '', advice: v.advice || ''
      };
    }
  },
  exam: {
    title: '记录检查 / 体检', submitText: '保存',
    fields: [
      { k: 'report_type', label: '报告类型', type: 'chips', required: true, options: ['化验', '影像', '体检', '其他'],
        default: '化验', hint: '类型决定它在时间线上显示为「检查」还是「体检」' },
      { k: 'name', label: '项目名称', type: 'text', required: true, placeholder: '如 血常规 / 胸部 CT / 年度体检' },
      { k: 'date', label: '检查日期', type: 'date', required: true },
      { k: 'hospital', label: '医院 / 机构', type: 'text' },
      { k: 'summary', label: '结论摘要（可空）', type: 'textarea' }
    ],
    toPayload: function (v) {
      return {
        report_type: { '化验': 'lab', '影像': 'imaging', '体检': 'checkup', '其他': 'other' }[v.report_type] || 'other',
        name: v.name, date: v.date, hospital: v.hospital || '', summary: v.summary || ''
      };
    }
  },
  vital: {
    title: '记录体征', submitText: '保存',
    fields: [
      { k: 'metric_type', label: '指标类型', type: 'chips', required: true, options: ['血压', '血糖', '体重', '体温', '其他'], default: '血压' },
      { k: 'value', label: '测量值', type: 'text', required: true, placeholder: '如 120/80（血压）或 6.1（血糖）' },
      { k: 'unit', label: '单位（可空）', type: 'text', placeholder: '如 mmHg / kg / ℃' },
      { k: 'date', label: '测量日期', type: 'date', required: true },
      { k: 'note', label: '备注（可空）', type: 'textarea', placeholder: '如 餐后 2 小时 / 静息' }
    ],
    toPayload: function (v) {
      return {
        metric_type: METRIC_RMAP[v.metric_type] || 'other',
        value: v.value, unit: v.unit || '', date: v.date, note: v.note || ''
      };
    }
  },
  vaccine: {
    title: '记录疫苗', submitText: '保存',
    fields: [
      { k: 'name', label: '疫苗名称', type: 'text', required: true, placeholder: '如 流感疫苗' },
      { k: 'dose_no', label: '针次', type: 'chips', options: ['第 1 针', '第 2 针', '第 3 针', '加强针'], default: '第 1 针' },
      { k: 'date', label: '接种日期', type: 'date', required: true },
      { k: 'institution', label: '接种机构', type: 'text' },
      { k: 'next_date', label: '下一针日期（可空）', type: 'date', hint: '填写后会自动生成一条待办' }
    ],
    toPayload: function (v) {
      return {
        name: v.name,
        dose_no: { '第 1 针': 1, '第 2 针': 2, '第 3 针': 3, '加强针': 4 }[v.dose_no] || 1,
        date: v.date, institution: v.institution || '', next_date: v.next_date || ''
      };
    }
  },
  todo: {
    title: '添加待办', submitText: '保存',
    api: 'todo.add',                       // ⚠️ 待办走 todo.add，不是 record.add
    tip: '一期无推送，待办只在首页站内展示。',
    fields: [
      { k: 'type', label: '类型', type: 'chips', required: true, options: ['复查', '疫苗', '体检', '自定义'], default: '复查' },
      { k: 'title', label: '事项', type: 'text', required: true, placeholder: '如 呼吸内科复查' },
      { k: 'due_date', label: '日期', type: 'date', required: true },
      { k: 'note', label: '备注（可空）', type: 'text' }
    ],
    toPayload: function (v) {
      return {
        type: { '复查': 'recheck', '疫苗': 'vaccine', '体检': 'exam', '自定义': 'custom' }[v.type] || 'custom',
        title: v.title, due_date: v.due_date, note: v.note || ''
      };
    }
  }
};

Page(helper.page({
  autoLoad: false,

  data: {
    mode: '',
    // 补记流程
    rec: { step: 1, person_id: '', title: '', start_date: '', days: [], ended: null },
    symptoms: SYMPTOMS,
    persons: [],
    recDays: [],
    // 通用表单
    form: { show: false, title: '', tip: '', submitText: '保存', fields: [], values: {} },
    formMode: '',
    // 详情模式
    detail: null,
    detailType: '',
    noteDraft: ''
  },

  onLoad(options) {
    const mode = options.mode || '';
    this.setData({ mode: mode });
    this.opts = options;

    if (mode === 'detail') {
      this.loadDetail(options.type, options.id);
      return;
    }
    if (FORMS[mode]) {
      this.openModeForm(mode);
      return;
    }
    this.initBackfill();
  },

  onShow() {
    if (this.data.mode === 'detail') this.loadDetail(this.opts.type, this.opts.id);
  },

  /* ================= 补记（3 步） ================= */
  initBackfill() {
    const self = this;
    const today = D.todayStr();
    api.call('person.list', {}, { silent: true }).then(function (d) {
      const persons = d.persons.filter(function (p) { return p.access_level !== 'none'; });
      self.setData({
        loading: false,
        ready: true,
        persons: persons,
        rec: {
          step: 1,
          person_id: persons.length ? persons[0].id : '',
          title: '',
          start_date: D.addDays(today, -1),
          days: [{ d: D.fmtMD(today), date: today, s: '', m: '' }],
          ended: null
        }
      });
      if (!persons.length) api.toast('还没有可记录的档案');
    }).catch(function (e) {
      self.setData({ loading: false, ready: true, error: e.message });
    });
  },

  onPickPerson(e) {
    const d = {};
    d['rec.person_id'] = e.currentTarget.dataset.id;
    this.setData(d);
  },

  onPickSymptom(e) {
    const d = {};
    d['rec.title'] = e.currentTarget.dataset.v;
    this.setData(d);
  },

  onStartDate(e) {
    const d = {};
    d['rec.start_date'] = e.detail.value;
    this.setData(d);
  },

  onDayInput(e) {
    const i = e.currentTarget.dataset.i;
    const k = e.currentTarget.dataset.k;
    const d = {};
    d['rec.days[' + i + '].' + k] = e.detail.value;
    this.setData(d);
  },

  onDayDate(e) {
    const i = e.currentTarget.dataset.i;
    const d = {};
    d['rec.days[' + i + '].date'] = e.detail.value;
    d['rec.days[' + i + '].d'] = D.fmtMD(e.detail.value);
    this.setData(d);
  },

  addDay() {
    const days = this.data.rec.days.slice();
    const last = days[days.length - 1];
    const next = D.addDays(last ? last.date : D.todayStr(), 1);
    days.push({ d: D.fmtMD(next), date: next, s: '', m: '' });
    this.setData({ 'rec.days': days });
  },

  removeDay(e) {
    const i = e.currentTarget.dataset.i;
    const days = this.data.rec.days.slice();
    if (days.length <= 1) return;
    days.splice(i, 1);
    this.setData({ 'rec.days': days });
  },

  nextStep() {
    const rec = this.data.rec;
    if (rec.step === 1) {
      if (!rec.person_id) return api.toast('请选择给谁记');
      if (!rec.title) return api.toast('请选择症状');
      return this.setData({ 'rec.step': 2 });
    }
    if (rec.step === 2) return this.setData({ 'rec.step': 3 });
  },

  prevStep() {
    const s = Math.max(1, this.data.rec.step - 1);
    this.setData({ 'rec.step': s });
  },

  onEnded(e) {
    this.setData({ 'rec.ended': e.currentTarget.dataset.v === '1' });
  },

  submitBackfill() {
    const rec = this.data.rec;
    if (rec.ended === null) return api.toast('请选择是否已结束');

    const self = this;
    api.call('condition.backfill', {
      person_id: rec.person_id,
      title: rec.title,
      start_date: rec.start_date,
      ended: rec.ended,
      days: rec.days.map(function (d) {
        return {
          date: d.date,
          symptoms: d.s ? [d.s] : undefined,
          medication: d.m || undefined
        };
      })
    }, { loading: '保存中' }).then(function (r) {
      api.toast('补记已保存，共 ' + r.day_count + ' 天');
      setTimeout(function () { wx.navigateBack(); }, 900);
    });
  },

  /* ================= 其他模式 ================= */
  openModeForm(mode) {
    const f = FORMS[mode];
    const self = this;
    const values = {};
    (f.fields || []).forEach(function (x) {
      if (x.default !== undefined) values[x.k] = x.default;
      if (x.type === 'date' && !values[x.k]) values[x.k] = D.todayStr();
    });

    api.call('person.list', {}, { silent: true }).then(function (d) {
      const persons = d.persons.filter(function (p) { return p.access_level !== 'none'; });
      if (!persons.length) {
        self.setData({ loading: false, ready: true, error: '还没有可记录的档案' });
        return;
      }
      self.setData({
        loading: false,
        ready: true,
        persons: persons,
        formMode: mode,
        form: {
          show: false, title: f.title, tip: f.tip || '', submitText: f.submitText || '保存',
          fields: f.fields, values: values
        }
      });
    }).catch(function (e) {
      self.setData({ loading: false, ready: true, error: e.message });
    });
  },

  onPickTarget() {
    const self = this;
    const persons = this.data.persons;
    wx.showActionSheet({
      itemList: persons.map(function (p) { return p.name + '（' + (p.relation || '成员') + '）'; }),
      success(res) {
        const p = persons[res.tapIndex];
        self.setData({
          'form.values.pid': p.id,
          'form.values._name': p.name,
          'form.show': true
        });
      }
    });
  },

  onFormSubmit(e) {
    const mode = this.data.formMode;
    const f = FORMS[mode];
    const v = e.detail.values;
    const pid = this.data.form.values.pid;
    if (!pid) return api.toast('请选择成员');

    const target = f.api || 'record.add';
    const base = Object.assign({ person_id: pid }, f.toPayload(v));
    // record.add 用 mode 作为记录类型；todo.add 的 type 由 toPayload 给出（复查/疫苗/…）
    const payload = target === 'record.add' ? Object.assign({ type: mode }, base) : base;
    const self = this;

    api.call(target, payload, { loading: '保存中' }).then(function (r) {
      api.toast('已保存' + (r.todo_id ? '，并生成待办' : ''));
      setTimeout(function () { wx.navigateBack(); }, 900);
    });
  },

  onFormCancel() {
    this.setData({ 'form.show': false });
    setTimeout(function () { wx.navigateBack(); }, 200);
  },

  /* ================= 详情模式 ================= */
  loadDetail(type, id) {
    const self = this;
    if (!type || !id) return;
    api.call('record.detail', { type: type, id: id }, { silent: true }).then(function (d) {
      const r = d.record;
      const rows = [];
      if (type === 'visit') {
        rows.push({ k: '日期', v: r.date }, { k: '医院', v: r.hospital },
          { k: '科室', v: r.department || '—' }, { k: '类型', v: r.visit_type_text },
          { k: '医生', v: r.doctor || '—' }, { k: '医生记录', v: r.diagnosis || '—' },
          { k: '医嘱', v: r.advice || '—' });
        if (r.summary_note) rows.push({ k: '报告要点（人工标注）', v: r.summary_note });
      } else if (type === 'exam') {
        rows.push({ k: '日期', v: r.date }, { k: '项目', v: r.name },
          { k: '类型', v: r.is_checkup ? '年度体检' : '检查' },
          { k: '医院', v: r.hospital || '—' }, { k: '结论摘要', v: r.summary || '—' });
        if (r.summary_note) rows.push({ k: '报告要点（人工标注）', v: r.summary_note });
      } else if (type === 'vital') {
        rows.push({ k: '日期', v: r.date }, { k: '指标', v: C.METRIC_TYPE[r.metric_type] || r.metric_type },
          { k: '测量值', v: r.value + (r.unit ? (' ' + r.unit) : '') },
          { k: '备注', v: r.note || '—' });
      } else {
        rows.push({ k: '接种日期', v: r.date }, { k: '疫苗', v: r.name },
          { k: '针次', v: '第 ' + r.dose_no + ' 针' },
          { k: '机构', v: r.institution || '—' }, { k: '下一针', v: r.next_date || '—' });
      }
      const detail = {
        rows: rows,
        title: type === 'vital' ? ((C.METRIC_TYPE[r.metric_type] || '体征') + ' ' + r.value) : (r.name || r.hospital || '记录'),
        files: [],
        summaryNote: (type === 'exam' || type === 'visit') ? (r.summary_note || '') : ''
      };
      const fileIds = r.file_ids || [];
      self.setData({ loading: false, ready: true, detail: detail, detailType: type, noteDraft: detail.summaryNote });
      if (fileIds.length && wx.cloud && wx.cloud.getTempFileURL) {
        wx.cloud.getTempFileURL({ fileList: fileIds }).then(function (res) {
          const files = (res.fileList || []).map(function (f, i) {
            return { id: fileIds[i], url: f.tempFileURL || '' };
          }).filter(function (f) { return f.url; });
          if (files.length) self.setData({ 'detail.files': files });
        }).catch(function () {});
      }
    }).catch(function (e) {
      self.setData({ loading: false, ready: true, error: e.message });
    });
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url;
    const files = this.data.detail.files || [];
    const urls = files.map(function (f) { return f.url; });
    if (wx.previewImage) wx.previewImage({ current: url, urls: urls });
  },

  onDeleteDetail() {
    const self = this;
    api.confirm('删除', '确认删除这条记录？').then(function (ok) {
      if (!ok) return;
      api.call('record.remove', { type: self.data.detailType, id: self.opts.id }).then(function () {
        api.toastOk('已删除');
        setTimeout(function () { wx.navigateBack(); }, 700);
      });
    });
  },

  /* 报告要点（人工标注）：详情页内联保存，避免整套编辑流程 */
  onNoteInput(e) {
    this.setData({ noteDraft: e.detail.value });
  },

  onSaveNote() {
    const self = this;
    const note = (this.data.noteDraft || '').trim();
    api.call('record.update', {
      type: this.data.detailType, id: this.opts.id, summary_note: note
    }, { loading: '保存中' }).then(function (r) {
      api.toastOk('要点已保存');
      self.setData({ 'detail.summaryNote': note });
      // 同步到 kv 行（若已展示）
      const rows = (self.data.detail.rows || []).slice();
      let found = false;
      rows.forEach(function (row) {
        if (row.k === '报告要点（人工标注）') { row.v = note || '—'; found = true; }
      });
      if (!found && note) rows.push({ k: '报告要点（人工标注）', v: note });
      self.setData({ 'detail.rows': rows });
    });
  }
}));
