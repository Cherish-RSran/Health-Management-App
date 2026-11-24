/**
 * 全局 UI 中间层
 *
 * 小程序里页面直接调 wx.showToast / wx.showModal / wx.showActionSheet，
 * 这些在浏览器里没有对应物，所以统一收敛到这里，由 App.vue 渲染真实 DOM。
 * 全部 Promise 化，页面代码形状与小程序版保持一致。
 */

import { reactive } from 'vue';

export const ui = reactive({
  toast: { show: false, text: '', icon: 'none' },
  loading: { show: false, text: '' },
  modal: null,   // { title, content, placeholder, value, editable, confirmText, cancelText, resolve }
  sheet: null    // { title, items, resolve }
});

let toastTimer = null;

export function toast(text, duration) {
  ui.toast.text = String(text === undefined || text === null ? '' : text);
  ui.toast.icon = 'none';
  ui.toast.show = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { ui.toast.show = false; }, duration || 1800);
}

export function toastOk(text) {
  ui.toast.text = text || '已完成';
  ui.toast.icon = 'ok';
  ui.toast.show = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { ui.toast.show = false; }, 1500);
}

export function showLoading(text) {
  ui.loading.text = text || '加载中';
  ui.loading.show = true;
}

export function hideLoading() {
  ui.loading.show = false;
}

/**
 * 确认框
 * @returns {Promise<boolean>}
 */
export function confirm(title, content, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    ui.modal = {
      title: title || '确认',
      content: content || '',
      editable: false,
      confirmText: opts.confirmText || '确定',
      cancelText: opts.cancelText || '取消',
      showCancel: opts.showCancel !== false,
      resolve: function (v) { ui.modal = null; resolve(v); }
    };
  });
}

/**
 * 带输入框的弹窗（对应 wx.showModal({ editable: true })）
 * @returns {Promise<string|null>} 取消时返回 null
 */
export function prompt(title, placeholder, defaultValue) {
  return new Promise(function (resolve) {
    ui.modal = {
      title: title || '请输入',
      content: '',
      editable: true,
      placeholder: placeholder || '',
      value: defaultValue === undefined ? '' : defaultValue,
      confirmText: '确定',
      cancelText: '取消',
      showCancel: true,
      resolve: function (v) { ui.modal = null; resolve(v); }
    };
  });
}

/**
 * 底部动作菜单（对应 wx.showActionSheet）
 * @param {string[]} items
 * @returns {Promise<number>} 选中下标，取消为 -1
 */
export function actionSheet(items, title) {
  return new Promise(function (resolve) {
    ui.sheet = {
      title: title || '',
      items: items || [],
      resolve: function (i) { ui.sheet = null; resolve(i); }
    };
  });
}

/** 复制到剪贴板（对应 wx.setClipboardData） */
export async function setClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(String(text));
      return true;
    }
  } catch (e) {
    /* 降级到 execCommand */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = String(text);
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

/** 拨号（对应 wx.makePhoneCall） */
export function makePhoneCall(phone) {
  if (!phone) return;
  window.location.href = 'tel:' + String(phone).replace(/\s/g, '');
}
