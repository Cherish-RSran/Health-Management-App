/**
 * 日期工具 · 纯函数，无副作用，可被小程序端与云函数端共用
 *
 * 时区约定：业务全部按**北京时间（UTC+8）**处理。
 * 云函数运行在 UTC，小程序的 Date 依赖设备时区，所以这里统一用
 * 「时间戳 + 8h 后读 UTC 字段」的方式取"北京时间的年月日"，避免跨天错位。
 */

const TZ_OFFSET = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 当前毫秒时间戳 */
function nowTs() {
  return Date.now();
}

/** Date（其 UTC 字段已被调整为北京时间）→ 'YYYY-MM-DD' */
function fmtDateStr(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/** 取"北京时间的今天"，返回 'YYYY-MM-DD'。可传时间戳用于测试。 */
function todayStr(ts) {
  const d = ts === undefined
    ? new Date(Date.now() + TZ_OFFSET)
    : new Date(ts + TZ_OFFSET);
  return fmtDateStr(d);
}

/** 时间戳 → 北京时间日期串 */
function dateStrOf(ts) {
  if (ts === undefined || ts === null) return '';
  return fmtDateStr(new Date(Number(ts) + TZ_OFFSET));
}

/** 'YYYY-MM-DD' → 该日北京时间 00:00:00 的时间戳 */
function startOfDayTs(dateStr) {
  const p = parseDateStr(dateStr);
  if (!p) return NaN;
  return Date.UTC(p.y, p.m - 1, p.d) - TZ_OFFSET;
}

/** 'YYYY-MM-DD' → 该日北京时间 23:59:59.999 的时间戳 */
function endOfDayTs(dateStr) {
  const s = startOfDayTs(dateStr);
  return isNaN(s) ? NaN : s + DAY_MS - 1;
}

/** 解析 'YYYY-MM-DD'，非法返回 null */
function parseDateStr(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 校验真实存在（如 2026-02-30 应被拒）
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

/** 解析 'YYYY-MM'（年月），非法返回 null */
function parseMonthStr(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  return { y: +m[1], m: mo };
}

/** 日期串加减天数 */
function addDays(dateStr, n) {
  const p = parseDateStr(dateStr);
  if (!p) return '';
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(n || 0)));
  return fmtDateStr(dt);
}

/** a - b 的天数差（a、b 均为 'YYYY-MM-DD'） */
function daysBetween(a, b) {
  const ta = startOfDayTs(a), tb = startOfDayTs(b);
  if (isNaN(ta) || isNaN(tb)) return NaN;
  return Math.round((ta - tb) / DAY_MS);
}

/** 两个 'YYYY-MM' 或 'YYYY-MM-DD' 的先后比较，返回 -1 / 0 / 1 */
function compareMonthOrDate(a, b) {
  const sa = String(a || '').slice(0, 10);
  const sb = String(b || '').slice(0, 10);
  if (!sa && !sb) return 0;
  if (!sa) return -1;
  if (!sb) return 1;
  return sa < sb ? -1 : (sa > sb ? 1 : 0);
}

/**
 * 计算年龄。出生日期当天即算满岁。
 * @param {string} birth 'YYYY-MM-DD'
 * @param {string} [ref] 参考日期，默认今天（北京时间）
 * @returns {number|null}
 */
function calcAge(birth, ref) {
  const p = parseDateStr(birth);
  if (!p) return null;
  const r = parseDateStr(ref || todayStr());
  if (!r) return null;
  let age = r.y - p.y;
  if (r.m < p.m || (r.m === p.m && r.d < p.d)) age--;
  return age < 0 ? null : age;
}

/** 从出生日期串算年龄；支持 'YYYY-MM' 或 'YYYY-MM-DD'，只精确到年时用 01-01 近似 */
function calcAgeLoose(birth, ref) {
  if (!birth) return null;
  const s = String(birth).length === 7 ? birth + '-01' : birth;
  return calcAge(s, ref);
}

/** 时间戳 → 'MM.DD' */
function fmtMD(input) {
  if (input === undefined || input === null || input === '') return '';
  let ds;
  if (typeof input === 'number') ds = dateStrOf(input);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(input)) ds = input;
  else if (/^\d{4}-\d{2}-\d{2}T/.test(input)) ds = dateStrOf(new Date(input).getTime());
  else ds = String(input);
  return ds.slice(5).replace('-', '.');
}

/** 时间戳 → 'YYYY.MM.DD HH:mm'（北京时间） */
function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) + TZ_OFFSET);
  return d.getUTCFullYear() + '.' + pad2(d.getUTCMonth() + 1) + '.' + pad2(d.getUTCDate())
    + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

/** 'YYYY-MM' → '2026.10' */
function fmtMonth(key) {
  return String(key || '').replace('-', '.');
}

/** 取月份 key：'YYYY-MM' */
function monthKeyOf(input) {
  if (typeof input === 'number') return dateStrOf(input).slice(0, 7);
  return String(input || '').slice(0, 7);
}

/** 相对今天的自然语言：今天 / 昨天 / 明天 / N 天前 / N 天后 */
function relativeDay(dateStr, ref) {
  const d = daysBetween(dateStr, ref || todayStr());
  if (isNaN(d)) return '';
  if (d === 0) return '今天';
  if (d === 1) return '明天';
  if (d === -1) return '昨天';
  return d > 0 ? d + ' 天后' : (-d) + ' 天前';
}

/**
 * 病程持续天数（含首日）
 * @param {string} start 'YYYY-MM-DD'
 * @param {string} [end] 不传 = 至今
 */
function durationDays(start, end, ref) {
  const e = end || ref || todayStr();
  const d = daysBetween(e, start);
  return isNaN(d) ? 0 : d + 1;
}

/** 判断 yyyy-mm-dd 是否在 [start, end] 区间内（end 为空的表示长期） */
function inRange(dateStr, start, end) {
  if (!dateStr) return false;
  if (start && dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

const __exports = {
  TZ_OFFSET, DAY_MS,
  pad2, nowTs, todayStr, dateStrOf, fmtDateStr,
  startOfDayTs, endOfDayTs,
  parseDateStr, parseMonthStr,
  addDays, daysBetween, compareMonthOrDate,
  calcAge, calcAgeLoose,
  fmtMD, fmtDateTime, fmtMonth, monthKeyOf,
  relativeDay, durationDays, inRange
};
export { TZ_OFFSET };
export { DAY_MS };
export { pad2 };
export { nowTs };
export { todayStr };
export { dateStrOf };
export { fmtDateStr };
export { startOfDayTs };
export { endOfDayTs };
export { parseDateStr };
export { parseMonthStr };
export { addDays };
export { daysBetween };
export { compareMonthOrDate };
export { calcAge };
export { calcAgeLoose };
export { fmtMD };
export { fmtDateTime };
export { fmtMonth };
export { monthKeyOf };
export { relativeDay };
export { durationDays };
export { inRange };
export default __exports;
