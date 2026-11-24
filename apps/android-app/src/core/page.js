/**
 * 页面公共行为 —— 对应小程序 utils/page.js
 *
 * 小程序里是 Page(helper.page({ data, fetch, ... }))；
 * Vue 里换成组合式函数：const { state, load } = usePage({ data, fetch })
 * state 就是小程序的 this.data，fetch 返回的对象会被合并进 state。
 */

import { reactive, onMounted } from 'vue';
import { setting } from './session.js';
import { confirm } from './ui.js';

/**
 * @param {{data?:object, fetch?:Function, autoLoad?:boolean}} opts
 */
export function usePage(opts) {
  opts = opts || {};
  const state = reactive(Object.assign({
    loading: true,
    ready: false,
    error: '',
    needFamily: false,
    big: false
  }, opts.data || {}));

  let pending = null;

  async function load() {
    if (!opts.fetch) return;
    if (pending) return pending;

    state.loading = true;
    state.error = '';

    pending = Promise.resolve()
      .then(function () { return opts.fetch(); })
      .then(function (data) {
        Object.assign(state, data || {});
        state.loading = false;
        state.ready = true;
        pending = null;
        return data;
      })
      .catch(function (e) {
        state.loading = false;
        state.ready = true;
        state.error = (e && e.message) || '加载失败';
        state.needFamily = (e && e.code) === 'E_NO_FAMILY';
        pending = null;
        // 注意：这里**不往外抛**。页面的错误已经通过 state.error 表达了，
        // 再抛出去只会变成一堆没人管的 unhandled rejection（"还没有家庭"就是最常见的一个）。
        return null;
      });

    return pending;
  }

  function syncBig() {
    const big = !!(setting.value && setting.value.large_font);
    if (state.big !== big) state.big = big;
  }

  onMounted(function () {
    syncBig();
    if (opts.autoLoad !== false) load();
  });

  return { state: state, load: load, syncBig: syncBig };
}

/** 统一确认框（对应小程序 helper 里的 this.confirm） */
export function pageConfirm(content, title) {
  return confirm(title || '确认', content);
}
