/**
 * 云函数唯一入口
 *
 * 这里是与微信环境接触的**唯一**文件：初始化 SDK、取 openid，
 * 其余全部逻辑在 lib/ 下，可在 Node 中直接测试。
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { createApp } = require('./lib/app');

const app = createApp({
  db: cloud.database(),
  now: function () { return Date.now(); }
});

exports.main = async function (event, context) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';

  let result;
  try {
    result = await app.handle(event, { openid: openid });
  } catch (e) {
    // 兜底：内核理论上不会抛，这里防止任何意外导致调用方拿到非结构化结果
    console.error('[api] 未捕获异常', e);
    result = { code: 'E_INTERNAL', message: '服务异常，请稍后重试' };
  }

  return Object.assign({
    _meta: {
      openid: openid ? openid.slice(0, 6) + '***' : '',
      env: wxContext.ENV || '',
      ts: Date.now()
    }
  }, result);
};
