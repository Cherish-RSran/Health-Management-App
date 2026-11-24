const helper = require('../../utils/page');
const api = require('../../utils/api');
const guide = require('../../utils/guide');

Page(helper.page({
  autoLoad: false,

  data: {
    family: null,
    members: [],
    pending: [],
    isAdmin: false,
    logs: [],
    stats: null,
    me: null,
    showLogs: false
  },

  onShow() { this.load(); },

  fetch() {
    const app = getApp();
    const setting = (app && app.globalData.setting) || {};
    return Promise.all([
      api.call('family.members', {}, { silent: true }),
      api.call('audit.list', { limit: 15 }, { silent: true }),
      api.call('export.stats', {}, { silent: true })
    ]).then(function (res) {
      const m = res[0];
      return {
        family: m.family,
        members: m.members,
        pending: m.pending,
        isAdmin: m.is_admin,
        logs: res[1].logs,
        stats: res[2],
        big: !!setting.large_font,
        me: (app && app.globalData.user) || null,
        needFamily: false
      };
    });
  },

  /* ---------- 建家庭 ---------- */
  onCreateFamily() {
    const self = this;
    wx.showModal({
      title: '创建家庭',
      editable: true,
      placeholderText: '给家庭起个名字，如「示例家庭」',
      success(r1) {
        if (!r1.confirm) return;
        const name = (r1.content || '').trim() || '我的家';
        wx.showModal({
          title: '你的姓名',
          editable: true,
          placeholderText: '用于建立你自己的档案',
          success(r2) {
            if (!r2.confirm) return;
            api.call('family.create', { name: name, my_name: (r2.content || '').trim() }, { loading: '创建中' })
              .then(function () {
                api.toastOk('家庭已创建');
                self.load();
              });
          }
        });
      }
    });
  },

  onJoinFamily() {
    const self = this;
    wx.showModal({
      title: '加入家庭',
      editable: true,
      placeholderText: '输入 6 位邀请码',
      success(r) {
        if (!r.confirm || !r.content) return;
        api.call('family.join', { code: (r.content || '').trim() }, { loading: '提交中' })
          .then(function () {
            api.toast('申请已提交，等待管理员同意');
            self.load();
          });
      }
    });
  },

  /* ---------- 个人信息 ---------- */
  onEditName() {
    const self = this;
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '输入昵称（最多 30 字）',
      success(r) {
        if (!r.confirm || !r.content) return;
        api.call('auth.updateProfile', { nickname: (r.content || '').trim() }).then(function () {
          const app = getApp();
          if (app && app.globalData.user) app.globalData.user.nickname = r.content.trim();
          api.toastOk('已保存');
          self.load();
        });
      }
    });
  },

  /* ---------- 手机号 ---------- */
  onEditPhone() {
    const self = this;
    const cur = (this.data.me && this.data.me.phone) || '';
    wx.showModal({
      title: cur ? '修改手机号' : '填写手机号',
      content: (cur ? '当前：' + cur : '当前未填写') + '\n\n录入后可在添加紧急联系人时一键填入。\n留空并确定 = 清除。',
      editable: true,
      placeholderText: '11 位手机号',
      success(r) {
        if (!r.confirm) return;
        const phone = String((r.content || '')).trim();
        if (phone && !/^1[3-9]\d{9}$/.test(phone)) return api.toast('手机号格式不正确');
        api.call('auth.updatePhone', { phone: phone }, { loading: '保存中' }).then(function () {
          const app = getApp();
          if (app && app.globalData.user) app.globalData.user.phone = phone;
          api.toastOk(phone ? '已保存' : '已清除');
          self.load();
        });
      }
    });
  },

  /* ---------- 登录密码 ---------- */
  onEditPassword() {
    const self = this;
    const has = !!(this.data.me && this.data.me.has_password);

    if (!has) {
      wx.showModal({
        title: '设置登录密码',
        content: '至少 6 位，不能全是数字。设置后可用「手机号 + 密码」登录。',
        editable: true,
        placeholderText: '输入密码',
        success(r) {
          if (!r.confirm) return;
          self.doSetPassword('', r.content || '');
        }
      });
      return;
    }

    wx.showModal({
      title: '修改密码',
      content: '先输入当前密码',
      editable: true,
      placeholderText: '原密码',
      success(r1) {
        if (!r1.confirm) return;
        wx.showModal({
          title: '修改密码',
          content: '至少 6 位，不能全是数字',
          editable: true,
          placeholderText: '新密码',
          success(r2) {
            if (!r2.confirm) return;
            self.doSetPassword(r1.content || '', r2.content || '');
          }
        });
      }
    });
  },

  doSetPassword(oldPwd, newPwd) {
    const self = this;
    if (!/^1[3-9]\d{9}$/.test((this.data.me && this.data.me.phone) || '')) {
      return api.toast('请先填写手机号，再设置密码');
    }
    api.call('auth.updatePassword', {
      old_password: oldPwd,
      new_password: newPwd
    }, { loading: '保存中' }).then(function () {
      const app = getApp();
      if (app && app.globalData.user) app.globalData.user.has_password = true;
      api.toastOk('密码已设置');
      self.load();
    });
  },

  /* ---------- 家庭管理 ---------- */
  onApprove(e) {
    const self = this;
    api.call('family.approve', { membership_id: e.currentTarget.dataset.id, approve: true })
      .then(function () { api.toastOk('已同意'); self.load(); });
  },

  onReject(e) {
    const self = this;
    api.call('family.approve', { membership_id: e.currentTarget.dataset.id, approve: false })
      .then(function () { api.toast('已拒绝'); self.load(); });
  },

  onCopyCode() {
    const code = this.data.family && this.data.family.invite_code;
    if (!code) return api.toast('仅管理员可查看');
    wx.setClipboardData({ data: code, success: function () { api.toast('邀请码已复制'); } });
  },

  onRefreshCode() {
    const self = this;
    api.confirm('刷新邀请码', '刷新后旧邀请码立即失效，确认继续？').then(function (ok) {
      if (!ok) return;
      api.call('family.refreshCode', {}, { loading: '生成中' }).then(function (r) {
        api.toast('新邀请码：' + r.invite_code);
        self.load();
      });
    });
  },

  onRemoveMember(e) {
    const self = this;
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '该成员';
    api.confirm('移出家庭', '确认将「' + name + '」移出家庭？').then(function (ok) {
      if (!ok) return;
      api.call('family.removeMember', { user_id: id }).then(function () {
        api.toastOk('已移出');
        self.load();
      });
    });
  },

  /* ---------- 动态 ---------- */
  onToggleLogs() {
    this.setData({ showLogs: !this.data.showLogs });
  },

  /* ---------- 设置 ---------- */
  onToggleBig() {
    const self = this;
    const next = !this.data.big;
    const app = getApp();
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1];

    // 立即生效：给页面根节点加类名由 app.wxss 的变量覆盖驱动
    this.setData({ big: next });
    if (app) {
      app.globalData.setting.large_font = next;
      app.globalData.setting.big = next;
    }
    api.call('auth.updateSetting', { large_font: next }, { silent: true });

    wx.showToast({ title: next ? '已开启大字模式' : '已关闭大字模式', icon: 'none' });
    // 让其他已打开页面在返回时也生效
    pages.forEach(function (p) {
      if (p.setData && p.route !== cur.route) p.setData({ big: next });
    });
  },

  /* ---------- 导出 ---------- */
  onExport() {
    const self = this;
    wx.showActionSheet({
      itemList: ['导出全量 JSON', '生成文本摘要（可复制）'],
      success(res) {
        if (res.tapIndex === 0) return self.doExportJson();
        self.doExportText();
      }
    });
  },

  doExportJson() {
    wx.showLoading({ title: '导出中', mask: true });
    api.call('export.data', {}, { silent: true }).then(function (d) {
      wx.hideLoading();
      const text = JSON.stringify(d);
      // 小程序无文件下载，写入剪贴板 + 提示（真机可配合云存储下载）
      wx.setClipboardData({
        data: text,
        success: function () {
          api.toast('数据已复制到剪贴板（' + Math.round(text.length / 1024) + ' KB）', 2200);
        }
      });
    }).catch(function () { wx.hideLoading(); });
  },

  doExportText() {
    const self = this;
    const persons = (this.data.members || []).map(function (m) { return m.nickname || '成员'; });
    const s = this.data.stats || {};
    const lines = [
      '【' + ((this.data.family && this.data.family.name) || '家庭') + '】健康档案概览',
      '成员：' + persons.join('、'),
      '档案数：' + (s.persons || 0) + ' 份',
      '病程记录：' + (s.conditions || 0) + ' 次',
      '病程事件：' + (s.events || 0) + ' 条',
      '用药记录：' + (s.medicines || 0) + ' 条',
      '导出时间：' + new Date().toLocaleString()
    ];
    wx.setClipboardData({
      data: lines.join('\n'),
      success: function () { api.toast('概览已复制'); }
    });
  },

  /* ---------- 隐私 ---------- */
  onPrivacy() {
    wx.showModal({
      title: '隐私与授权',
      content: '· 健康信息属敏感个人信息，处理前须取得单独同意\n'
        + '· 档案共享以归属人本人授权为前提\n'
        + '· 手机号、身份证号等加密存储\n'
        + '· 附件为私有资源，只发临时链接\n'
        + '· 不与任何第三方共享，不对接医院系统',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  onAbout() {
    wx.showModal({
      title: '关于',
      content: '家庭健康档案 v1.0\n\n'
        + '记录家人档案与病程，就诊时给医生看提炼摘要。\n'
        + '本产品为信息记录工具，不提供问诊、诊断、处方、用药建议等医疗服务。\n'
        + '一期无任何推送，提醒均为站内展示。',
      showCancel: false
    });
  },

  onVersionGuide() {
    guide.showVersionGuide();
  }
}));
