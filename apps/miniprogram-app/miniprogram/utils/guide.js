/**
 * 版本选择引导：说明「云端版（本小程序）」与「本机版（安卓 App）」的区别与适用场景。
 * 两端共用同一套口径，文案随当前所在版本略有侧重。
 */

const CLOUD_GUIDE = {
  title: '云端版 vs 本机版',
  content: '你正在使用【云端版（本小程序）】\n'
    + '数据存云端、家人共享、多端同步、换手机不丢。\n'
    + '适合：多人协作管家人档案、长期建档、经常换设备。\n\n'
    + '【本机版（安卓 App）】\n'
    + '数据只存这部手机、不联网、隐私更强、断网可用。\n'
    + '适合：单机自用、不愿上云、给老人专用机。\n\n'
    + '两个版本数据不互通，按习惯选一个用即可。'
};

const LOCAL_GUIDE = {
  title: '本机版 vs 云端版',
  content: '你正在使用【本机版（本安卓 App）】\n'
    + '数据只存这部手机、不联网、隐私更强、断网可用。\n'
    + '适合：单机自用、不愿上云、给老人专用机。\n\n'
    + '【云端版（微信小程序）】\n'
    + '数据存云端、家人共享、多端同步、换手机不丢。\n'
    + '适合：多人协作管家人档案、长期建档、经常换设备。\n\n'
    + '两个版本数据不互通，按习惯选一个用即可。'
};

function showVersionGuide() {
  const g = (typeof wx !== 'undefined' && wx.getStorageSync && wx.getStorageSync('fhr_edition') === 'local')
    ? LOCAL_GUIDE : CLOUD_GUIDE;
  wx.showModal({
    title: g.title,
    content: g.content,
    showCancel: false,
    confirmText: '我知道了'
  });
}

function markVersionGuideSeen() {
  try { wx.setStorageSync('fhr_version_guide_seen', 1); } catch (e) {}
}

function shouldShowVersionGuide() {
  try { return !wx.getStorageSync('fhr_version_guide_seen'); } catch (e) { return false; }
}

module.exports = { showVersionGuide, markVersionGuideSeen, shouldShowVersionGuide, CLOUD_GUIDE, LOCAL_GUIDE };
