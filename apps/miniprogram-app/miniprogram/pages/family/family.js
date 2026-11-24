const helper = require('../../utils/page');
const api = require('../../utils/api');

Page(helper.page({
  data: {
    persons: [],
    family: null,
    pending: [],
    isAdmin: false
  },

  fetch() {
    return Promise.all([
      api.call('person.list', {}, { silent: true }),
      api.call('family.members', {}, { silent: true })
    ]).then(function (res) {
      return {
        persons: res[0].persons,
        family: res[1].family,
        pending: res[1].pending,
        isAdmin: res[1].is_admin
      };
    });
  },

  onPerson(e) {
    wx.navigateTo({ url: '/pages/person/person?id=' + e.currentTarget.dataset.id });
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/person/person?new=1' });
  },

  onGoMe() {
    wx.switchTab({ url: '/pages/me/me' });
  },

  onCopyCode() {
    const code = this.data.family && this.data.family.invite_code;
    if (!code) return api.toast('仅管理员可查看邀请码');
    wx.setClipboardData({ data: code, success: function () { api.toast('邀请码已复制'); } });
  }
}));
