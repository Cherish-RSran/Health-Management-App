const helper = require('../../utils/page');
const api = require('../../utils/api');
const C = require('../../utils/constants');

const KIND_TABS = [
  { key: 'all', label: '全部' },
  { key: 'condition', label: '生病' },
  { key: 'visit', label: '就诊' },
  { key: 'exam', label: '检查' },
  { key: 'checkup', label: '体检' },
  { key: 'vaccine', label: '疫苗' },
  { key: 'metric', label: '体征' }
];

/** 时间线来源表 → record.* 的类型参数 */
const TABLE2TYPE = {
  medical_record: 'visit',
  exam_report: 'exam',
  vaccine: 'vaccine',
  vital_sign: 'vital'
};

/**
 * 合并相邻的同 key 分组。
 * 后端的分组是按「当前页」现算的，跨页时同一个月会被拆成两段，wxml 的 wx:key 会冲突。
 */
function mergeGroups(groups) {
  const out = [];
  (groups || []).forEach(function (g) {
    const last = out[out.length - 1];
    if (last && last.key === g.key) {
      last.items = last.items.concat(g.items || []);
    } else {
      out.push({ key: g.key, label: g.label, items: (g.items || []).slice() });
    }
  });
  return out;
}

/** 给分组里的每条加上跳转所需字段 */
function decorate(groups) {
  return (groups || []).map(function (g) {
    return Object.assign({}, g, {
      items: (g.items || []).map(function (it) {
        return Object.assign({}, it, { rtype: TABLE2TYPE[it.ref_table] || '' });
      })
    });
  });
}

Page(helper.page({
  autoLoad: false,
  pageSize: 20,

  data: {
    persons: [],
    personId: '',
    kindTabs: KIND_TABS,
    kind: 'all',
    keyword: '',
    groups: [],
    page: 1,
    hasMore: false,
    loadingMore: false,
    total: 0
  },

  onShow() { this.load(); },

  fetch() {
    const kinds = this.data.kind === 'all' ? [] : [this.data.kind];
    return Promise.all([
      api.call('person.list', {}, { silent: true }),
      api.call('timeline.query', {
        person_id: this.data.personId || undefined,
        kinds: kinds.length ? kinds : undefined,
        keyword: this.data.keyword || undefined,
        page: 1,
        size: this.pageSize
      }, { silent: true })
    ]).then(function (res) {
      return {
        // 只列出有权限的成员，否则点了会整页变成错误态
        persons: res[0].persons.filter(function (p) { return p.access_level !== 'none'; }),
        groups: mergeGroups(decorate(res[1].groups)),
        page: 1,
        total: res[1].total,
        hasMore: res[1].has_more
      };
    });
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    const self = this;
    const next = this.data.page + 1;
    const kinds = this.data.kind === 'all' ? [] : [this.data.kind];
    this.setData({ loadingMore: true });

    api.call('timeline.query', {
      person_id: this.data.personId || undefined,
      kinds: kinds.length ? kinds : undefined,
      keyword: this.data.keyword || undefined,
      page: next,
      size: this.pageSize
    }, { silent: true }).then(function (r) {
      self.setData({
        groups: mergeGroups(self.data.groups.concat(decorate(r.groups))),
        page: next,
        hasMore: r.has_more,
        loadingMore: false
      });
    }).catch(function () {
      self.setData({ loadingMore: false });
    });
  },

  /* ---------- 筛选 ---------- */
  onPickPerson(e) {
    this.setData({ personId: e.currentTarget.dataset.id || '' });
    this.load();
  },

  onPickKind(e) {
    this.setData({ kind: e.currentTarget.dataset.key });
    this.load();
  },

  onSearch(e) {
    const v = (e.detail.value || '').trim();
    if (v === this.data.keyword) return;
    this.setData({ keyword: v });
    this.load();
  },

  onClearSearch() {
    this.setData({ keyword: '' });
    this.load();
  },

  /* ---------- 跳转 ---------- */
  onEvent(e) {
    const ds = e.currentTarget.dataset;
    if (ds.kind === 'condition') {
      wx.navigateTo({ url: '/pages/condition/condition?id=' + ds.id });
    } else {
      wx.navigateTo({
        url: '/pages/record/record?mode=detail&type=' + ds.table2 + '&id=' + ds.id
      });
    }
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/record/record' });
  }
}));
