/**
 * 统一错误处理
 * 约定：对外只返回结构化结果，**永不抛出原始异常**给调用方。
 */

const C = require('./shared/constants');

class AppError extends Error {
  constructor(code, message, detail) {
    super(message || '操作失败');
    this.name = 'AppError';
    this.code = code || C.ERR.E_INTERNAL;
    this.detail = detail;
  }
}

/** 抛出业务错误 */
function fail(code, message, detail) {
  throw new AppError(code, message, detail);
}

/** 断言，失败即抛业务错误 */
function assert(cond, code, message, detail) {
  if (!cond) fail(code, message, detail);
}

/**
 * 把任意异常规整为对外的结构化结果
 * @returns {{code:string, message:string, detail?:any}}
 */
function toResult(err) {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, detail: err.detail };
  }
  // 云数据库的「文档不存在」
  if (err && (err.errCode === -1 || /does not exist/.test(String(err.message || '')))) {
    return { code: C.ERR.E_NOT_FOUND, message: '记录不存在' };
  }
  // 云数据库唯一索引冲突
  if (err && (err.errCode === -501001 || /duplicate key/i.test(String(err.message || '')))) {
    return { code: C.ERR.E_DUPLICATE, message: '记录已存在' };
  }
  return {
    code: C.ERR.E_INTERNAL,
    message: '服务异常，请稍后重试',
    detail: String((err && err.message) || err)
  };
}

module.exports = { AppError, fail, assert, toResult };
