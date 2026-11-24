/**
 * 把微信云函数的业务逻辑（cloudfunctions/api）转成浏览器可直接用的 ESM。
 *
 * 不做任何业务改写，只做三件事：
 *   1. require(...)      -> import ...
 *   2. module.exports    -> 同时产出「具名导出」与「默认导出」
 *   3. 路径重映射：shared/* 指向 src/core/*（与小程序端共用同一份纯函数）
 *
 * 之所以要具名 + 默认双导出：原代码里两种写法都有
 *   const E = require('./errors')        -> E.fail(...)
 *   const { fail } = require('./errors') -> fail(...)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// 注意：深度分组后小程序已在 apps/miniprogram-app/ 下，路径需带上该层
const SRC_API = path.resolve(ROOT, '..', 'miniprogram-app', 'cloudfunctions', 'api');
const SRC_UTILS = path.resolve(ROOT, '..', 'miniprogram-app', 'miniprogram', 'utils');
const OUT_SERVER = path.join(ROOT, 'src', 'server');
const OUT_CORE = path.join(ROOT, 'src', 'core');

/** 依赖路径重映射：相对引用 -> 目标 ESM 路径 */
function mapSpecifier(spec, fromFile) {
  // lib/shared/* 与 miniprogram/utils/* 是同一份，统一用 core
  let m = /^\.\.\/lib\/shared\/(\w+)$/.exec(spec);
  if (m) return '../../core/' + m[1] + '.js';

  // lib/xxx.js 里的 './shared/constants' —— 同样指向 core
  m = /^\.\/shared\/(\w+)$/.exec(spec);
  if (m) return '../../core/' + m[1] + '.js';

  m = /^\.\/(\w+)$/.exec(spec);
  if (m) {
    // actions/ 内部互引
    return './' + m[1] + '.js';
  }

  // server/ 目录结构原样保留，所以 ../lib/errors 依旧指向 ../lib/errors
  m = /^\.\.\/lib\/(\w+)$/.exec(spec);
  if (m) return '../lib/' + m[1] + '.js';

  // lib/app.js 里的 '../actions' 指向 actions/index.js
  if (spec === '../actions') return '../actions/index.js';

  // lib/shared 内部：./constants ./date ...
  m = /^\.\/(\w+)$/.exec(spec);
  if (m) return './' + m[1] + '.js';

  throw new Error('未处理的依赖：' + spec + '（来自 ' + fromFile + '）');
}

const REQUIRE_RE = /^(\s*)const\s+(\{[^}]*\}|\w+)\s*=\s*require\(['"]([^'"]+)['"]\);\s*$/;

/** 源文件是 CRLF，末尾的 \r 会干扰行级正则，统一先归一成 LF */
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function convertRequire(line, fromFile) {
  const m = REQUIRE_RE.exec(line);
  if (!m) return null;
  const [, indent, binding, spec] = m;
  let target;
  if (spec === 'crypto') {
    target = './crypto.js';
  } else {
    target = mapSpecifier(spec, fromFile);
  }
  return `${indent}import ${binding} from '${target}';`;
}

/** module.exports = { a, b: c } -> 具名导出 + 默认导出 */
function convertExports(src) {
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  let changed = 0;

  while (i < lines.length) {
    const line = lines[i];
    const single = /^module\.exports\s*=\s*(.*)$/.exec(line);

    if (!single) { out.push(line); i++; continue; }

    const expr = single[1].trim();

    // 对象字面量：module.exports = { ... }（可能是单行的，也可能跨多行）
    if (expr.startsWith('{')) {
      // 收集完整的对象字面量（可能跨多行）
      let depth = 0;
      let body = '';
      let j = i;
      let done = false;
      for (; j < lines.length; j++) {
        body += (j === i ? lines[j].slice(line.indexOf('{')) : lines[j]) + '\n';
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        if (depth === 0) { done = true; break; }
      }
      if (!done) throw new Error('module.exports 对象未闭合：' + line);

      // 先按行去掉注释，否则「// 用药\n isLongTerm」会被当成一个非法片段而漏掉导出
      const inner = body.slice(1, body.lastIndexOf('}'))
        .split('\n')
        .map(function (l) { return l.replace(/\/\/.*$/, ''); })
        .join('\n');
      const names = [];
      inner.split(',').forEach(function (part) {
        const p = part.trim();
        if (!p) return;
        const kv = /^([A-Za-z_$][\w$]*)\s*:\s*(.+)$/.exec(p);
        if (kv) {
          names.push({ exported: kv[1], local: kv[2].trim() });
        } else if (/^[A-Za-z_$][\w$]*$/.test(p)) {
          names.push({ exported: p, local: p });
        }
      });

      out.push('const __exports = ' + body.trim().replace(/;$/, '') + ';');
      // 用 `export { 局部 as 导出名 }` 而不是 `export const 导出名 = ...`：
      // 后者在导出名与模块内已有标识符同名时（如 createApp）会重复声明报错
      names.forEach(function (n) {
        if (!/^[A-Za-z_$][\w$]*$/.test(n.local)) return;
        out.push(n.exported === n.local
          ? `export { ${n.local} };`
          : `export { ${n.local} as ${n.exported} };`);
      });
      out.push('export default __exports;');
      changed++;
      i = j + 1;
      continue;
    }

    // 简单标识符：module.exports = ROUTES;
    out.push('export default ' + expr + ';');
    changed++;
    i++;
  }

  return { code: out.join('\n'), changed: changed };
}

function convertFile(src, fromFile) {
  const lines = src.split('\n').map(function (l) {
    return convertRequire(l, fromFile) || l;
  });
  return convertExports(lines.join('\n'));
}

/** 纯函数层（utils/*）转成 ESM，供前端与后端共用 */
function convertCore(src) {
  let code = src.split('\n').map(function (l) {
    const m = REQUIRE_RE.exec(l);
    if (!m) return l;
    const target = m[3].startsWith('./') ? m[3] + '.js' : './' + m[3] + '.js';
    return `${m[1]}import ${m[2]} from '${target}';`;
  }).join('\n');
  const r = convertExports(code);
  return r.code;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

/* ---------- 1. 纯函数层 ---------- */
const CORE_FILES = ['constants', 'date', 'format', 'model', 'validate'];
CORE_FILES.forEach(function (name) {
  const src = readText(path.join(SRC_UTILS, name + '.js'));
  write(path.join(OUT_CORE, name + '.js'), convertCore(src));
});
console.log('[core] 已生成 ' + CORE_FILES.length + ' 个纯函数模块');

/* ---------- 2. 服务端 ---------- */
let count = 0;
function walk(dir, rel) {
  fs.readdirSync(dir).forEach(function (name) {
    const abs = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    if (fs.statSync(abs).isDirectory()) return walk(abs, r);
    if (!name.endsWith('.js')) return;

    // 入口 index.js 依赖 wx-server-sdk，跳过（浏览器版由 src/server/local.js 代替）
    if (r === 'index.js') return;
    // lib/shared 已由 core 代替
    if (r.startsWith('lib/shared/')) return;
    // crypto 用浏览器实现单独手写
    if (r === 'lib/crypto.js') return;

    const src = readText(abs);
    const { code } = convertFile(src, r);
    // lib/xxx.js -> lib/xxx.js（去掉 lib 层级不需要，保持原结构便于对照）
    write(path.join(OUT_SERVER, r), code);
    count++;
  });
}
walk(SRC_API, '');
console.log('[server] 已生成 ' + count + ' 个业务模块');
