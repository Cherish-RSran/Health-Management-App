/**
 * 展示格式化 · 纯函数
 */

/** 手机号脱敏，**幂等**（已脱敏的不会二次打码） */
function maskPhone(s) {
  const v = String(s === undefined || s === null ? '' : s);
  if (/^\d{11}$/.test(v)) return v.replace(/(\d{3})\d{4}(\d{2})/, '$1****$2');
  return v;
}

/** 身份证脱敏：保留前 6 后 4 */
function maskIdCard(s) {
  const v = String(s === undefined || s === null ? '' : s);
  if (v.length >= 10) return v.slice(0, 6) + '********' + v.slice(-4);
  if (v.length > 4) return v.slice(0, 2) + '****' + v.slice(-2);
  return v;
}

/** 文本截断 */
function truncate(s, max) {
  const v = String(s === undefined || s === null ? '' : s);
  const m = max || 20;
  return v.length > m ? v.slice(0, m) + '…' : v;
}

/** 频次 → 每日次数 */
function freqTimes(fq) {
  if (!fq) return 0;
  if (fq.indexOf('3') >= 0) return 3;
  if (fq.indexOf('2') >= 0) return 2;
  if (fq.indexOf('1') >= 0) return 1;
  return 0;
}

/** 姓名取首字用于头像 */
function initialOf(name) {
  const v = String(name || '').trim();
  return v ? v.slice(0, 1) : '?';
}

/** 数字安全取整 */
function toInt(v, def) {
  const n = parseInt(v, 10);
  return isNaN(n) ? (def === undefined ? 0 : def) : n;
}

/** 千分位（大数据量展示） */
function thousands(n) {
  return String(n === undefined || n === null ? 0 : n)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const __exports = { maskPhone, maskIdCard, truncate, freqTimes, initialOf, toInt, thousands };
export { maskPhone };
export { maskIdCard };
export { truncate };
export { freqTimes };
export { initialOf };
export { toInt };
export { thousands };
export default __exports;
