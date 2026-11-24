/* eslint-disable */
/* ⚠️ 自动生成，请勿直接修改本文件。
 * 源文件：miniprogram/utils/validate.js
 * 同步命令：node scripts/sync-shared.js
 */
/**
 * 参数校验 · 声明式，纯函数
 */

const C = require('./constants');
const D = require('./date');

function isNonEmptyStr(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && (!max || v.length <= max);
}

function isPhone(v) {
  return /^1[3-9]\d{9}$/.test(String(v === undefined || v === null ? '' : v).trim());
}

function isDateStr(v) {
  return !!D.parseDateStr(v);
}

function isMonthStr(v) {
  return !!D.parseMonthStr(v);
}

function isMonthOrDate(v) {
  return isDateStr(v) || isMonthStr(v);
}

function isOneOf(v, list) {
  return (list || []).indexOf(v) >= 0;
}

function isSlots(v) {
  return Array.isArray(v) && v.length > 0
    && v.every(function (s) { return C.SLOT_ORDER.indexOf(s) >= 0; });
}

function isBool(v) {
  return v === true || v === false;
}

/**
 * 声明式校验。
 * rules: { field: { type, required, max, values, label, default } }
 * type: string | phone | date | month | monthOrDate | enum | slots | bool | number | array
 * @returns {{ok:boolean, errors:Array<{field:string,msg:string}>, value:object}}
 */
function validate(rules, payload) {
  const errors = [];
  const value = {};
  const src = payload || {};

  Object.keys(rules || {}).forEach(function (field) {
    const r = rules[field];
    const label = r.label || field;
    let v = src[field];

    // 注意：空数组**不算**未填，交给类型规则判断（slots 要求至少一项）
    const isEmpty = v === undefined || v === null || v === '';

    if (isEmpty) {
      if (r.required) {
        errors.push({ field: field, msg: label + '不能为空' });
        return;
      }
      if (r.default !== undefined) value[field] = r.default;
      return;
    }

    const fail = function (msg) { errors.push({ field: field, msg: msg }); };

    switch (r.type) {
      case 'string':
        if (typeof v !== 'string') { fail(label + '格式不正确'); return; }
        v = r.trim === false ? v : v.trim();
        if (v.length === 0) { fail(label + '不能为空'); return; }
        if (r.max && v.length > r.max) { fail(label + '不能超过 ' + r.max + ' 个字'); return; }
        break;
      case 'phone':
        if (!isPhone(v)) { fail(label + '格式不正确'); return; }
        v = String(v).trim();
        break;
      case 'date':
        if (!isDateStr(v)) { fail(label + '日期格式应为 YYYY-MM-DD'); return; }
        break;
      case 'month':
        if (!isMonthStr(v)) { fail(label + '格式应为 YYYY-MM'); return; }
        break;
      case 'monthOrDate':
        if (!isMonthOrDate(v)) { fail(label + '格式应为 YYYY-MM 或 YYYY-MM-DD'); return; }
        break;
      case 'enum':
        if (!isOneOf(v, r.values)) { fail(label + '取值不合法'); return; }
        break;
      case 'slots':
        if (!isSlots(v)) { fail(label + '至少选择一个有效时段'); return; }
        break;
      case 'bool':
        if (!isBool(v)) { fail(label + '应为布尔值'); return; }
        break;
      case 'number': {
        const n = Number(v);
        if (isNaN(n)) { fail(label + '应为数字'); return; }
        if (r.min !== undefined && n < r.min) { fail(label + '不能小于 ' + r.min); return; }
        if (r.max !== undefined && n > r.max) { fail(label + '不能大于 ' + r.max); return; }
        v = n;
        break;
      }
      case 'array':
        if (!Array.isArray(v)) { fail(label + '应为数组'); return; }
        if (r.required && v.length === 0) { fail(label + '不能为空'); return; }
        if (r.max && v.length > r.max) { fail(label + '最多 ' + r.max + ' 项'); return; }
        break;
      default:
        break;
    }

    value[field] = v;
  });

  return { ok: errors.length === 0, errors: errors, value: value };
}

/** 跨字段规则：日期区间（end 允许为空 = 长期） */
function checkDateRange(start, end, startLabel, endLabel) {
  if (!start || !end) return null;
  if (end < start) {
    return (endLabel || '结束日期') + '不能早于' + (startLabel || '开始日期');
  }
  return null;
}

/** 组装错误信息为单条可读文案 */
function firstError(result) {
  return result && result.errors && result.errors.length ? result.errors[0].msg : '';
}

module.exports = {
  isNonEmptyStr, isPhone, isDateStr, isMonthStr, isMonthOrDate,
  isOneOf, isSlots, isBool, validate, checkDateRange, firstError
};
