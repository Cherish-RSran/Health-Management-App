/**
 * 小程序入口
 *
 * 启动流程：init 云开发 → 调用 login 建立/恢复会话 → 缓存家庭与设置
 */

const api = require('./utils/api');

App({
  globalData: {
    /** 是否已完成初始化 */
    inited: false,
    user: null,
    family: null,
    setting: {
      large_font: false,
      card_order: ['meds', 'todos', 'emg', 'quick']
    },
    /** 初始化 Promise，页面可通过 ensureReady() 等待 */
    _ready: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('[app] 基础库版本过低，请使用 2.2.3 及以上');
      wx.showModal({
        title: '版本过低',
        content: '当前微信版本不支持云开发，请升级微信后重试',
        showCancel: false
      });
      return;
    }
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true
    });
    this.globalData._ready = this.bootstrap();
  },

  /** 建立会话，返回 { user, family, setting } */
  bootstrap() {
    const self = this;
    return api.call('auth.login', {}, { silent: true })
      .then(function (data) {
        self.globalData.user = data.user || null;
        self.globalData.family = data.family || null;
        if (data.token) api.setToken(data.token);
        if (data.setting) {
          self.globalData.setting = Object.assign(self.globalData.setting, data.setting);
        }
        self.globalData.inited = true;
        return data;
      })
      .catch(function (e) {
        console.warn('[app] bootstrap 失败', e && e.code, e && e.message);
        self.globalData.inited = true;
        return null;
      });
  },

  /** 页面调用：确保初始化完成后再取数据 */
  ensureReady() {
    if (!this.globalData._ready) this.globalData._ready = this.bootstrap();
    return this.globalData._ready;
  },

  /** 供页面在数据变更后刷新全局家庭信息 */
  setFamily(family) {
    this.globalData.family = family || this.globalData.family;
    return this.globalData.family;
  },

  /** 更新本地设置（大字模式、卡片顺序等） */
  setSetting(patch) {
    this.globalData.setting = Object.assign(this.globalData.setting, patch || {});
    return this.globalData.setting;
  }
});
