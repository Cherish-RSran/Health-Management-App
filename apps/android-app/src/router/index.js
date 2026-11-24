/**
 * 路由 —— 对应小程序 app.json 的 pages + tabBar
 *
 * 用 hash 模式：Capacitor 以 file:// 加载本地页面，history 模式会 404。
 * tab 页（首页/时间线/家人/我的）对应 switchTab，其余用 push / back。
 */

import { createRouter, createWebHashHistory } from 'vue-router';
import { needLogin } from '../core/session.js';

const TAB_PATHS = ['/home', '/timeline', '/family', '/me'];

const routes = [
  { path: '/', redirect: '/home' },
  {
    path: '/login',
    component: () => import('../pages/Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/home',
    component: () => import('../pages/Home.vue'),
    meta: { title: '首页', tab: true }
  },
  {
    path: '/timeline',
    component: () => import('../pages/Timeline.vue'),
    meta: { title: '健康时间线', tab: true }
  },
  {
    path: '/family',
    component: () => import('../pages/Family.vue'),
    meta: { title: '家人', tab: true }
  },
  {
    path: '/me',
    component: () => import('../pages/Me.vue'),
    meta: { title: '我的', tab: true }
  },
  {
    path: '/person',
    component: () => import('../pages/Person.vue'),
    meta: { title: '健康档案' }
  },
  {
    path: '/condition',
    component: () => import('../pages/Condition.vue'),
    meta: { title: '病程详情（短期）' }
  },
  {
    path: '/record',
    component: () => import('../pages/Record.vue'),
    meta: { title: '记录' }
  },
  {
    path: '/summary',
    component: () => import('../pages/Summary.vue'),
    meta: { title: '医生摘要' }
  }
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes: routes
});

/**
 * 登录门禁：既没有 token、也没选过「仅本机使用」，就先去登录页。
 * 小程序不需要这一层（微信免登），所以这逻辑只存在于安卓版路由里。
 */
router.beforeEach(function (to) {
  if (to.path === '/login') return true;
  if (needLogin()) {
    return { path: '/login', query: to.fullPath ? { redirect: to.fullPath } : {} };
  }
  return true;
});

export function isTabPath(path) {
  return TAB_PATHS.indexOf(path) >= 0;
}

/** 对应 wx.navigateTo */
export function push(url) {
  return router.push(url);
}

/** 对应 wx.switchTab */
export function switchTab(url) {
  return router.replace(url);
}

/** 对应 wx.navigateBack */
export function back() {
  if (window.history.length > 1) router.back();
  else router.replace('/home');
}

/** 对应 wx.redirectTo */
export function redirect(url) {
  return router.replace(url);
}
