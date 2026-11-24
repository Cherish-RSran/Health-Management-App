/**
 * 本地数据库 · 用 IndexedDB 复刻微信云数据库的那套 API
 *
 * 之所以要"复刻 API"而不是重写业务：云函数目录 cloudfunctions/api 里的
 * 全部业务逻辑（20 个集合、40+ action）都是围绕 db.collection()... 写的，
 * 保持接口一致 = 业务代码一行不改，风险最小。
 *
 * 支持的写法（与微信一致）：
 *   db.collection(c).add({ data })
 *   db.collection(c).doc(id).get() / .update({ data }) / .set({ data }) / .remove()
 *   db.collection(c).where(w).get() / .count() / .update({ data }) / .remove()
 *   .where(w).orderBy(f, 'asc'|'desc').skip(n).limit(n).get()
 *   db.command.in(arr) / .neq(v) / .inc(n) / .gt / .gte / .lt / .lte / .exists(b)
 */

const DB_NAME = 'family_health_db';
const STORE = 'records';
const COLL_KEY = '__coll';
const PK_KEY = '__pk';

/**
 * 内部主键 = 集合名 + 分隔符 + _id
 *
 * ⚠️ 不能直接用 _id 当主键：云数据库里 _id 只在「集合内」唯一，
 *    而 user 集合和 user_setting 集合都用 openid 当 _id（同名！）。
 *    早期版本直接用 _id 做 keyPath，结果建完 user 再建 user_setting 会把 user 覆盖掉，
 *    表现为「设置存了又变回默认」这类极难归因的问题。
 */
function pkOf(coll, id) {
  return coll + '::' + id;
}

/* ==========================================================================
   底层：IndexedDB 薄封装
   ========================================================================== */

function openIDB() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: PK_KEY });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
    req.onblocked = function () { reject(new Error('IndexedDB 被其他页面占用')); };
  });
}

function reqToPromise(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

/* ==========================================================================
   查询指令
   ========================================================================== */

function makeCmd(type, value) {
  return { __cmd: type, __value: value };
}

const command = {
  in: function (arr) { return makeCmd('in', arr || []); },
  nin: function (arr) { return makeCmd('nin', arr || []); },
  neq: function (v) { return makeCmd('neq', v); },
  eq: function (v) { return makeCmd('eq', v); },
  gt: function (v) { return makeCmd('gt', v); },
  gte: function (v) { return makeCmd('gte', v); },
  lt: function (v) { return makeCmd('lt', v); },
  lte: function (v) { return makeCmd('lte', v); },
  exists: function (b) { return makeCmd('exists', !!b); },
  inc: function (n) { return makeCmd('inc', Number(n) || 0); },
  remove: function () { return makeCmd('remove', true); }
};

function isCmd(v) {
  return !!v && typeof v === 'object' && typeof v.__cmd === 'string';
}

/** 单字段比对（语义对齐 MongoDB，云数据库的 $ne 也匹配"字段缺失"） */
function matchField(actual, expect) {
  if (isCmd(expect)) {
    const v = expect.__value;
    switch (expect.__cmd) {
      case 'in': return Array.isArray(v) && v.indexOf(actual) >= 0;
      case 'nin': return Array.isArray(v) && v.indexOf(actual) < 0;
      case 'neq': return actual !== v;
      case 'eq': return actual === v;
      case 'gt': return actual > v;
      case 'gte': return actual >= v;
      case 'lt': return actual < v;
      case 'lte': return actual <= v;
      case 'exists': return (actual !== undefined && actual !== null) === v;
      default: return false;
    }
  }
  if (expect && typeof expect === 'object' && expect instanceof Date) {
    return actual instanceof Date && actual.getTime() === expect.getTime();
  }
  return actual === expect;
}

function matchDoc(doc, cond) {
  const keys = Object.keys(cond || {});
  for (let i = 0; i < keys.length; i++) {
    if (!matchField(doc[keys[i]], cond[keys[i]])) return false;
  }
  return true;
}

/* ==========================================================================
   ID 与序列化
   ========================================================================== */

function genId() {
  const rnd = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(rnd);
  } else {
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.floor(Math.random() * 256);
  }
  let s = Date.now().toString(16);
  for (let i = 0; i < rnd.length; i++) s += ('0' + rnd[i].toString(16)).slice(-2);
  return s;
}

/** 去掉内部字段，还原成调用方存进去的样子 */
function strip(row) {
  if (!row) return row;
  const out = Object.assign({}, row);
  delete out[COLL_KEY];
  delete out[PK_KEY];
  return out;
}

/** 打上内部字段，准备落盘 */
function seal(row, coll) {
  const out = Object.assign({}, row);
  out[COLL_KEY] = coll;
  out[PK_KEY] = pkOf(coll, row._id);
  return out;
}

function applyPatch(doc, patch) {
  const out = Object.assign({}, doc);
  Object.keys(patch || {}).forEach(function (k) {
    const v = patch[k];
    if (isCmd(v) && v.__cmd === 'inc') {
      out[k] = (Number(out[k]) || 0) + v.__value;
    } else if (isCmd(v) && v.__cmd === 'remove') {
      delete out[k];
    } else {
      out[k] = v;
    }
  });
  return out;
}

function sortRows(rows, orders) {
  if (!orders || !orders.length) return rows;
  const list = rows.slice();
  list.sort(function (a, b) {
    for (let i = 0; i < orders.length; i++) {
      const f = orders[i][0];
      const dir = orders[i][1] === 'desc' ? -1 : 1;
      let av = a[f];
      let bv = b[f];
      if (av === undefined) av = null;
      if (bv === undefined) bv = null;
      if (av === bv) continue;
      if (av === null) return -1 * dir;
      if (bv === null) return 1 * dir;
      if (av > bv) return 1 * dir;
      return -1 * dir;
    }
    return 0;
  });
  return list;
}

/* ==========================================================================
   查询 / 文档 / 集合
   ========================================================================== */

class Query {
  constructor(db, coll) {
    this._db = db;
    this._coll = coll;
    this._cond = {};
    this._orders = [];
    this._skip = 0;
    this._limit = null;
  }
  where(cond) {
    this._cond = Object.assign({}, this._cond, cond || {});
    return this;
  }
  orderBy(field, dir) {
    this._orders.push([field, dir || 'asc']);
    return this;
  }
  skip(n) { this._skip = Number(n) || 0; return this; }
  limit(n) { this._limit = Number(n) || 0; return this; }

  async _fetch() {
    const all = await this._db._allOfColl(this._coll);
    let rows = all.filter(function (r) { return matchDoc(r, this._cond); }, this);
    if (this._orders.length) rows = sortRows(rows, this._orders);
    if (this._skip) rows = rows.slice(this._skip);
    if (this._limit) rows = rows.slice(0, this._limit);
    return rows;
  }

  async get() {
    const rows = await this._fetch();
    return { data: rows.map(strip), errMsg: 'collection.get:ok' };
  }

  async count() {
    const rows = await this._fetch();
    return { total: rows.length };
  }

  async update(opt) {
    const rows = await this._fetch();
    const patch = (opt && opt.data) || {};
    const next = rows.map(function (r) { return applyPatch(r, patch); });
    await this._db._putMany(next);
    return { stats: { updated: next.length } };
  }

  async remove() {
    const rows = await this._fetch();
    await this._db._deleteMany(rows.map(function (r) { return r[PK_KEY]; }));
    return { stats: { removed: rows.length } };
  }
}

class Doc {
  constructor(db, coll, id) {
    this._db = db;
    this._coll = coll;
    this._id = id;
  }
  async get() {
    const row = await this._db._get(this._id, this._coll);
    return { data: row ? strip(row) : null };
  }
  async set(opt) {
    const data = (opt && opt.data) || {};
    await this._db._putMany([seal(Object.assign({}, data, { _id: this._id }), this._coll)]);
    return { stats: { updated: 1 } };
  }
  async update(opt) {
    const cur = await this._db._get(this._id, this._coll);
    if (!cur) return { stats: { updated: 0 } };
    const next = applyPatch(cur, (opt && opt.data) || {});
    next._id = this._id;
    await this._db._putMany([seal(next, this._coll)]);
    return { stats: { updated: 1 } };
  }
  async remove() {
    const cur = await this._db._get(this._id, this._coll);
    if (!cur) return { stats: { removed: 0 } };
    await this._db._deleteMany([pkOf(this._coll, this._id)]);
    return { stats: { removed: 1 } };
  }
}

class Collection {
  constructor(db, name) {
    this._db = db;
    this._name = name;
  }
  where(cond) { return new Query(this._db, this._name).where(cond); }
  doc(id) { return new Doc(this._db, this._name, id); }
  orderBy(field, dir) { return new Query(this._db, this._name).orderBy(field, dir); }
  limit(n) { return new Query(this._db, this._name).limit(n); }
  skip(n) { return new Query(this._db, this._name).skip(n); }

  async add(opt) {
    const data = (opt && opt.data) || {};
    const id = data._id || genId();
    await this._db._putMany([seal(Object.assign({}, data, { _id: id }), this._name)]);
    return { _id: id };
  }

  async get() {
    const rows = await this._db._allOfColl(this._name);
    return { data: rows.map(strip) };
  }

  async count() {
    const rows = await this._db._allOfColl(this._name);
    return { total: rows.length };
  }
}

/* ==========================================================================
   数据库主体
   ========================================================================== */

class LocalDB {
  constructor(idb) {
    this._idb = idb;
    this.command = command;
  }
  collection(name) { return new Collection(this, name); }

  /**
   * 取某个集合的全部记录。
   * 这里用全表扫描而不是 index：家庭档案的数据量是几百条量级，
   * 全表扫描的性能完全够，而且能绕开 IndexedDB 索引在部分环境（含 Node 测试用的
   * fake-indexeddb）上偶发读不到刚写入数据的问题，正确性优先。
   */
  async _allOfColl(coll) {
    const t = this._idb.transaction(STORE, 'readonly');
    const rows = await reqToPromise(t.objectStore(STORE).getAll());
    return (rows || []).filter(function (r) { return r[COLL_KEY] === coll; });
  }

  async _get(id, coll) {
    const row = await reqToPromise(
      this._idb.transaction(STORE, 'readonly').objectStore(STORE).get(pkOf(coll, id))
    );
    if (!row || row[COLL_KEY] !== coll) return null;
    return row;
  }

  async _putMany(rows) {
    if (!rows.length) return;
    const t = this._idb.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    rows.forEach(function (r) { store.put(r); });
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }

  async _deleteMany(ids) {
    if (!ids.length) return;
    const t = this._idb.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    ids.forEach(function (id) { store.delete(id); });
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }

  /** 全量导出（备份用），返回 { coll: [rows] } */
  async dump() {
    const t = this._idb.transaction(STORE, 'readonly');
    const rows = await reqToPromise(t.objectStore(STORE).getAll());
    const out = {};
    (rows || []).forEach(function (r) {
      const c = r[COLL_KEY] || '_unknown';
      (out[c] = out[c] || []).push(strip(r));
    });
    return out;
  }

  /** 全量导入（恢复用） */
  async restore(dumped) {
    const rows = [];
    Object.keys(dumped || {}).forEach(function (coll) {
      (dumped[coll] || []).forEach(function (r) {
        if (!r || !r._id) return;
        rows.push(seal(r, coll));
      });
    });
    await this._wipe();
    await this._putMany(rows);
    return rows.length;
  }

  async _wipe() {
    const t = this._idb.transaction(STORE, 'readwrite');
    t.objectStore(STORE).clear();
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }

  async clear() { return this._wipe(); }
}

let _instance = null;
let _opening = null;

/** 打开（单例） */
export async function openDB() {
  if (_instance) return _instance;
  if (!_opening) {
    _opening = openIDB().then(function (idb) {
      _instance = new LocalDB(idb);
      return _instance;
    }).catch(function (e) {
      _opening = null;
      throw e;
    });
  }
  return _opening;
}

export { LocalDB, command, genId };
