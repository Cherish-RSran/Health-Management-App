/**
 * 版本选择引导（安卓本机版）
 * 说明「本机版（本 App）」与「云端版（微信小程序）」的区别与适用场景。
 */

import { confirm } from './ui.js';

export const LOCAL_GUIDE = {
  title: '本机版 vs 云端版',
  content: '你正在使用【本机版（本安卓 App）】\n'
    + '数据只存这部手机、不联网、隐私更强、断网可用。\n'
    + '适合：单机自用、不愿上云、给老人专用机。\n\n'
    + '【云端版（微信小程序）】\n'
    + '数据存云端、家人共享、多端同步、换手机不丢。\n'
    + '适合：多人协作管家人档案、长期建档、经常换设备。\n\n'
    + '两个版本数据不互通，按习惯选一个用即可。'
};

const KEY = 'fhr_version_guide_seen';

export function showVersionGuide() {
  confirm(LOCAL_GUIDE.title, LOCAL_GUIDE.content, { showCancel: false, confirmText: '我知道了' });
}

export function markVersionGuideSeen() {
  try { localStorage.setItem(KEY, '1'); } catch (e) {}
}

export function shouldShowVersionGuide() {
  try { return !localStorage.getItem(KEY); } catch (e) { return false; }
}
