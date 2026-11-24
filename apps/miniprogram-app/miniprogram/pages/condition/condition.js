const helper = require('../../utils/page');
const api = require('../../utils/api');
const C = require('../../utils/constants');

const SEV_MAP = { mild: '轻', moderate: '中', severe: '重' };

const EVENT_FIELDS = [
  { k: 'occurred_date', label: '日期', type: 'date', required: true },
  { k: 'occurred_time', label: '时间（可空）', type: 'text', placeholder: '如 15:30' },
  { k: 'event_type', label: '类型', type: 'chips', required: true,
    options: ['症状', '用药', '备注'], default: '症状' },
  { k: 'text', label: '内容', type: 'text', required: true, placeholder: '如 咳嗽 / 服用 XX / 夜里咳得厉害' },
  { k: 'severity', label: '严重程度', type: 'chips', options: ['轻', '中', '重'] },
  { k: 'temperature', label: '体温（可空）', type: 'number', placeholder: '如 38.2' }
];

const TYPE2API = { '症状': 'symptom', '用药': 'medication', '备注': 'note' };
const SEV2API = { '轻': 'mild', '中': 'moderate', '重': 'severe' };

Page(helper.page({
  data: {
    condition: null,
    person: null,
    daily: [],
    summary: null,
    sevMap: SEV_MAP,
    form: { show: false, title: '', fields: EVENT_FIELDS, values: {} },
    editing: null
  },

  onLoad(options) {
    this.cid = options.id || '';
  },

  fetch() {
    return api.call('condition.detail', { condition_id: this.cid }, { silent: true })
      .then(function (d) {
        return {
          condition: d.condition,
          person: d.person,
          events: d.events,
          daily: d.daily.map(function (row) {
            const ev = row.event;
            return {
              date: row.date,
              label: row.label,
              empty: row.empty,
              eventId: ev ? ev.id : '',
              eventType: ev ? ev.event_type : '',
              text: ev ? describeEvent(ev) : '—（无记录）',
              severity: ev && ev.content ? ev.content.severity : '',
              temperature: ev && ev.content ? ev.content.temperature : null,
              isAlert: !!(ev && ev.content && ev.content.severity === 'severe'),
              isBackfilled: ev ? ev.is_backfilled : false
            };
          }),
          summary: d.summary
        };
      });
  },

  /* ---------- 插入 / 编辑 ---------- */
  onInsert() {
    this.setData({
      editing: null,
      form: {
        show: true, title: '插入一天', fields: EVENT_FIELDS,
        values: { occurred_date: this.data.condition.start_date, event_type: '症状' }
      }
    });
  },

  onEditDay(e) {
    const row = this.data.daily[e.currentTarget.dataset.i];
    if (row.empty) return this.onInsert();
    const ev = (this.data.events || []).filter(function (x) { return x.id === row.eventId; })[0];
    this.setData({
      editing: row.eventId,
      form: {
        show: true, title: '编辑 ' + row.label, fields: EVENT_FIELDS,
        values: {
          occurred_date: row.date,
          occurred_time: ev && ev.occurred_at ? timeOf(ev.occurred_at) : '',
          event_type: reversType(row.eventType),
          // 必须回填：text 是必填项，留空会逼用户把内容重打一遍
          text: eventText(ev),
          severity: reversSev(row.severity),
          temperature: row.temperature || ''
        }
      }
    });
  },

  onFormSubmit(e) {
    const v = e.detail.values;
    const type = TYPE2API[v.event_type] || 'symptom';
    const content = {};
    if (type === 'symptom') {
      content.symptoms = [v.text];
      if (v.severity) content.severity = SEV2API[v.severity];
      if (v.temperature) content.temperature = Number(v.temperature);
    } else if (type === 'medication') {
      content.name = v.text;
    } else {
      content.text = v.text;
    }

    const self = this;
    const done = function () {
      self.setData({ 'form.show': false });
      api.toastOk('已保存');
      self.load();
    };

    if (this.data.editing) {
      api.call('event.update', {
        event_id: this.data.editing,
        occurred_date: v.occurred_date,
        occurred_time: v.occurred_time || '',
        content: content
      }, { loading: '保存中' }).then(done);
      return;
    }

    api.call('event.add', {
      condition_id: this.cid,
      occurred_date: v.occurred_date,
      occurred_time: v.occurred_time || '',
      event_type: type,
      content: content
    }, { loading: '保存中' }).then(done);
  },

  onFormCancel() { this.setData({ 'form.show': false }); },

  onDeleteDay(e) {
    const row = this.data.daily[e.currentTarget.dataset.i];
    if (row.empty || !row.eventId) return;
    const self = this;
    api.confirm('删除', '确认删除 ' + row.label + ' 这条记录？').then(function (ok) {
      if (!ok) return;
      api.call('event.remove', { event_id: row.eventId }).then(function () {
        api.toastOk('已删除');
        self.load();
      });
    });
  },

  /* ---------- 病程状态 ---------- */
  onEnd() {
    const self = this;
    api.confirm('结束病程', '结束后归档进历史，仍可查看。确认结束？').then(function (ok) {
      if (!ok) return;
      api.call('condition.end', { condition_id: self.cid }).then(function () {
        api.toastOk('已结束并归档');
        self.load();
      });
    });
  },

  onReopen() {
    const self = this;
    api.call('condition.reopen', { condition_id: this.cid }).then(function () {
      api.toastOk('已重新开启');
      self.load();
    });
  },

  onSummary() {
    wx.navigateTo({
      url: '/pages/summary/summary?person_id=' + this.data.condition.person_id
        + '&condition_id=' + this.cid
    });
  }
}));

function describeEvent(ev) {
  const c = ev.content || {};
  if (ev.event_type === 'symptom') {
    let s = (c.symptoms || []).join('、') || '症状';
    if (c.temperature) s += ' · 体温 ' + c.temperature + '℃';
    return s;
  }
  if (ev.event_type === 'medication') return '服用 ' + (c.name || '药');
  if (ev.event_type === 'visit') return '就诊 ' + (c.hospital || '');
  if (ev.event_type === 'exam') return '检查 ' + (c.name || '');
  return c.text || '';
}

function reversType(t) {
  if (t === 'medication') return '用药';
  if (t === 'note') return '备注';
  return '症状';
}

function reversSev(s) {
  return { mild: '轻', moderate: '中', severe: '重' }[s] || '';
}

/** 事件内容 → 可编辑文本 */
function eventText(ev) {
  if (!ev) return '';
  const c = ev.content || {};
  if (ev.event_type === 'symptom') return (c.symptoms || []).join('、');
  if (ev.event_type === 'medication') return c.name || '';
  if (ev.event_type === 'note') return c.text || '';
  if (ev.event_type === 'visit') return c.hospital || '';
  if (ev.event_type === 'exam') return c.name || '';
  return '';
}

/** 时间戳 → 'HH:mm' */
function timeOf(ts) {
  const d = new Date(Number(ts) + 8 * 3600 * 1000);
  const hh = d.getUTCHours(), mm = d.getUTCMinutes();
  if (hh === 0 && mm === 0) return '';
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}
