const helper = require('../../utils/page');
const api = require('../../utils/api');
const guide = require('../../utils/guide');

const CARD_LABEL = {
  meds: '今天要吃的药',
  todos: '今日待办',
  emg: '紧急信息卡',
  quick: '快捷操作'
};

Page(helper.page({
  autoLoad: false,

  data: {
    dashboard: null,
    order: ['meds', 'todos', 'emg', 'quick'],
    cardLabel: CARD_LABEL,
    sortMode: false,
    nowSlot: '',
    taken: {}
  },

  onShow() {
    this.setData({ nowSlot: computeNowSlot() });
    this.load();
    if (guide.shouldShowVersionGuide()) {
      guide.showVersionGuide();
      guide.markVersionGuideSeen();
    }
  },

  /* 当前用药时段：早（<11）/ 中（11–15）/ 晚（≥16） */
  onToggleMed(e) {
    const id = e.currentTarget.dataset.id;
    const taken = Object.assign({}, this.data.taken);
    taken[id] = !taken[id];
    this.setData({ taken: taken });
  },

  fetch() {
    return api.call('home.dashboard', {}, { silent: true }).then(function (d) {
      return {
        dashboard: d,
        order: (d.setting && d.setting.card_order) || ['meds', 'todos', 'emg', 'quick'],
        needFamily: !!d.needs_family
      };
    });
  },

  /* ---------- 成员 ---------- */
  onPerson(e) {
    wx.navigateTo({ url: '/pages/person/person?id=' + e.currentTarget.dataset.id });
  },

  /* ---------- 待办 ---------- */
  onToggleTodo(e) {
    const id = e.currentTarget.dataset.id;
    const self = this;
    api.call('todo.toggle', { todo_id: id }, { silent: true })
      .then(function () { self.load(); })
      .catch(function () {});
  },

  onTodoLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title;
    const self = this;
    wx.showActionSheet({
      itemList: ['修改日期', '删除'],
      success(res) {
        if (res.tapIndex === 0) return self.pickDateForTodo(id);
        api.confirm('删除', '确认删除「' + title + '」？').then(function (ok) {
          if (!ok) return;
          api.call('todo.remove', { todo_id: id }).then(function () {
            api.toastOk('已删除');
            self.load();
          });
        });
      }
    });
  },

  pickDateForTodo(id) {
    const self = this;
    wx.showModal({
      title: '修改日期（YYYY-MM-DD）',
      editable: true,
      placeholderText: '如 2026-10-20',
      success(res) {
        if (!res.confirm || !res.content) return;
        api.call('todo.update', { todo_id: id, due_date: res.content }).then(function () {
          api.toastOk('已更新');
          self.load();
        });
      }
    });
  },

  /* ---------- 卡片排序 ---------- */
  onCardLongPress() {
    if (this.data.sortMode) return;
    this.setData({ sortMode: true });
    api.toast('点箭头调整顺序，完成后保存');
  },

  onMove(e) {
    const key = e.currentTarget.dataset.key;
    const dir = Number(e.currentTarget.dataset.dir);
    const order = this.data.order.slice();
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    order.splice(i, 1);
    order.splice(j, 0, key);
    this.setData({ order: order });
  },

  onSaveOrder() {
    const self = this;
    api.call('auth.updateSetting', { card_order: this.data.order }, { silent: true })
      .then(function () {
        self.setData({ sortMode: false });
        api.toastOk('顺序已保存');
      })
      .catch(function () { self.setData({ sortMode: false }); });
  },

  /* ---------- 快捷操作 ---------- */
  onQuick() {
    wx.showActionSheet({
      itemList: ['补记一次病程', '记录就诊', '记录检查 / 体检', '记录疫苗', '记录体征', '添加待办'],
      success(res) {
        const urls = [
          '/pages/record/record',
          '/pages/record/record?mode=visit',
          '/pages/record/record?mode=exam',
          '/pages/record/record?mode=vaccine',
          '/pages/record/record?mode=vital',
          '/pages/record/record?mode=todo'
        ];
        wx.navigateTo({ url: urls[res.tapIndex] });
      }
    });
  },

  goRecord() { this.onQuick(); },

  onGoingAddMed() {
    const persons = (this.data.dashboard && this.data.dashboard.persons) || [];
    if (!persons.length) return api.toast('请先添加成员档案');
    wx.navigateTo({ url: '/pages/person/person?id=' + persons[0].id + '&open=medicine' });
  },

  onEmergency() {
    const persons = (this.data.dashboard && this.data.dashboard.persons) || [];
    if (!persons.length) return api.toast('还没有可查看的档案');
    wx.navigateTo({ url: '/pages/person/person?id=' + persons[0].id + '&open=emergency' });
  },

  onInvite() { wx.switchTab({ url: '/pages/me/me' }); },
  onTimeline() { wx.switchTab({ url: '/pages/timeline/timeline' }); },

  /* 首页直接切换大字模式（前置入口，照顾老人） */
  onToggleBigHome() {
    const next = !this.data.big;
    const app = getApp();
    this.setData({ big: next });
    if (app) {
      app.globalData.setting.large_font = next;
      app.globalData.setting.big = next;
    }
    api.call('auth.updateSetting', { large_font: next }, { silent: true });
    wx.showToast({ title: next ? '已开启大字模式' : '已关闭大字模式', icon: 'none' });
  }
}));

/** 根据当前小时推算应高亮的用药时段标签 */
function computeNowSlot() {
  const h = new Date().getHours();
  if (h < 11) return '早';
  if (h < 16) return '中';
  return '晚';
}
