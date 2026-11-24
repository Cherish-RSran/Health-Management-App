/**
 * 建库：创建全部集合 + 索引
 *
 * 这一步把「控制台手工点 20 次集合 + 逐个建索引」变成一条命令，
 * 并且**保证唯一索引不会漏建**（漏了会在并发加入家庭时静默产生重复成员）。
 *
 * 只导出纯函数，云端客户端由调用方注入 —— 这样测试可以直接跑逻辑。
 */

const S = require('./schema');

/**
 * @param {object} app   CloudBase 实例（或 mock）
 * @param {object} opts  { log, dryRun }
 * @returns {Promise<object>} 结果摘要
 */
async function initDatabase(app, opts) {
  opts = opts || {};
  const log = opts.log || function () {};
  const dryRun = !!opts.dryRun;

  const result = {
    collections: { created: [], existed: [], total: S.COLLECTIONS.length },
    indexes: { created: [], existed: [], failed: [], total: S.indexCount() }
  };

  // ---- 1. 集合 ----
  for (let i = 0; i < S.COLLECTIONS.length; i++) {
    const name = S.COLLECTIONS[i];
    if (dryRun) {
      log('  · 集合 ' + name + '（dry-run）');
      result.collections.created.push(name);
      continue;
    }
    const r = await app.database.createCollectionIfNotExists(name);
    if (r && r.IsCreated) {
      result.collections.created.push(name);
      log('  + 新建集合 ' + name);
    } else {
      result.collections.existed.push(name);
      log('  = 集合已存在 ' + name);
    }
  }

  if (dryRun) {
    log('');
    log('  索引计划：');
    Object.keys(S.INDEXES).forEach(function (coll) {
      S.INDEXES[coll].forEach(function (idx) {
        log('    · ' + coll + ' → ' + idx.name
          + (idx.unique ? ' [唯一]' : '')
          + ' (' + idx.keys.map(function (k) { return k[0] + ':' + (k[1] > 0 ? 'asc' : 'desc'); }).join(', ') + ')');
      });
    });
    return result;
  }

  // ---- 2. 索引 ----
  const colls = Object.keys(S.INDEXES);
  for (let i = 0; i < colls.length; i++) {
    const coll = colls[i];
    const list = S.INDEXES[coll];
    for (let j = 0; j < list.length; j++) {
      const idx = list[j];
      await ensureIndex(app, coll, idx, result, log);
    }
  }

  return result;
}

async function ensureIndex(app, coll, idx, result, log) {
  const label = coll + '.' + idx.name;
  let exists = false;
  try {
    const r = await app.database.checkIndexExists(coll, idx.name);
    exists = !!(r && r.Exists);
  } catch (e) {
    // 集合刚建好时某些实现会抛错，按「不存在」处理
    exists = false;
  }

  if (exists) {
    result.indexes.existed.push(label);
    log('  = 索引已存在 ' + label);
    return;
  }

  try {
    await app.database.updateCollection(coll, { CreateIndexes: [S.toCreateIndex(idx)] });
    result.indexes.created.push(label);
    log('  + 新建索引 ' + label + (idx.unique ? ' [唯一]' : ''));
  } catch (e) {
    // 建索引失败必须显式暴露：唯一索引缺失是并发脏数据的直接原因
    result.indexes.failed.push({ index: label, message: e && e.message ? e.message : String(e) });
    log('  ✗ 建索引失败 ' + label + ' —— ' + (e && e.message ? e.message : e));
  }
}

/**
 * 校验：唯一索引是否齐全（部署后自检用）
 */
async function verifyUniqueIndexes(app, opts) {
  opts = opts || {};
  const expected = S.uniqueIndexes();
  const missing = [];
  const present = [];

  for (let i = 0; i < expected.length; i++) {
    const parts = expected[i].split('.');
    const coll = parts[0];
    const name = parts.slice(1).join('.');
    let ok = false;
    try {
      const r = await app.database.checkIndexExists(coll, name);
      ok = !!(r && r.Exists);
    } catch (e) {
      ok = false;
    }
    (ok ? present : missing).push(expected[i]);
  }

  return { expected: expected, present: present, missing: missing, ok: missing.length === 0 };
}

module.exports = {
  initDatabase: initDatabase,
  verifyUniqueIndexes: verifyUniqueIndexes
};
