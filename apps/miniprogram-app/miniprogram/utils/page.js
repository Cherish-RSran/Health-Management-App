/**
 * 页面公共行为：统一 loading / 空态 / 错误态 + 下拉刷新
 *
 * 用法：
 *   Page(helper.page({
 *     data: {...},
 *     fetch() { return api.call(动作名).then(d => ({...})) },
 *     onTapXxx(e) {...}
 *   }))
 */

const api = require('./api');

function page(opts) {
  const fetchFn = opts.fetch;

  const base = {
    data: Object.assign({
      loading: true,
      ready: false,
      error: '',
      needFamily: false,
      /** 大字模式：由 app.globalData.setting.large_font 驱动，根节点加 .big-mode 即可放大 */
      big: false
    }, opts.data || {}),

    onLoad(options) {
      this.pageOptions = options || {};
      this.syncBigMode();
      if (opts.onLoad) opts.onLoad.call(this, options);
    },

    onShow() {
      this.syncBigMode();
      if (opts.onShow) { opts.onShow.call(this); return; }
      if (opts.autoLoad !== false) this.load();
    },

    syncBigMode() {
      const app = getApp();
      const s = (app && app.globalData) ? app.globalData.setting : null;
      const big = !!(s && s.large_font);
      if (this.data.big !== big) this.setData({ big: big });
    },

    onPullDownRefresh() {
      const self = this;
      this.load().then(function () { wx.stopPullDownRefresh(); })
        .catch(function () { wx.stopPullDownRefresh(); });
    },

    /** 拉取数据并写入 data（同一页面并发调用会复用同一次请求） */
    load() {
      const self = this;
      if (!fetchFn) return Promise.resolve();
      if (this._pending) return this._pending;

      this.setData({ loading: true, error: '' });
      this._pending = fetchFn.call(this).then(function (data) {
        self.setData(Object.assign({ loading: false, ready: true }, data || {}));
        self._pending = null;
        return data;
      }).catch(function (e) {
        const code = (e && e.code) || '';
        self.setData({
          loading: false,
          ready: true,
          error: (e && e.message) || '加载失败',
          needFamily: code === 'E_NO_FAMILY'
        });
        self._pending = null;
        throw e;
      });
      return this._pending;
    },

    retry() { this.load(); },

    /** 跳转到「我的」去建家庭 */
    goCreateFamily() {
      wx.switchTab({ url: '/pages/me/me' });
    },

    /** 统一封装确认框 */
    confirm(content, title) {
      return api.confirm(title || '确认', content);
    }
  };

  Object.keys(opts).forEach(function (k) {
    if (['data', 'fetch', 'onLoad', 'onShow', 'autoLoad'].indexOf(k) < 0) {
      base[k] = opts[k];
    }
  });

  return base;
}

module.exports = { page: page };
