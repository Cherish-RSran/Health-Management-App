#!/usr/bin/env node
/**
 * 工程结构校验
 *   node scripts/check-project.js
 *
 * 校验内容：
 *   1. project.config.json 可解析，miniprogramRoot / cloudfunctionRoot 存在
 *   2. miniprogram/app.json 可解析
 *   3. pages 中每个页面都有 .js / .wxml / .json / .wxss
 *   4. tabBar.list 的 pagePath 必须在 pages 中
 *   5. 每个页面 .json 可解析
 *   6. utils 纯函数模块可被 Node 加载（保证不误用 wx API）
 *   7. 云函数（若存在）入口与 package.json 齐备
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function checkProject(opts) {
  opts = opts || {};
  const errors = [];
  const stats = {};

  const err = function (msg) { errors.push(msg); };

  /* 1. project.config.json */
  const pcPath = path.join(ROOT, 'project.config.json');
  let pc = null;
  if (!fs.existsSync(pcPath)) {
    err('缺少 project.config.json');
  } else {
    try {
      pc = readJson(pcPath);
    } catch (e) {
      err('project.config.json 不是合法 JSON：' + e.message);
    }
  }
  if (pc) {
    const mpRoot = path.join(ROOT, pc.miniprogramRoot || 'miniprogram/');
    if (!fs.existsSync(mpRoot)) err('miniprogramRoot 指向的目录不存在：' + pc.miniprogramRoot);
    if (pc.cloudfunctionRoot) {
      const cfRoot = path.join(ROOT, pc.cloudfunctionRoot);
      if (!fs.existsSync(cfRoot)) err('cloudfunctionRoot 指向的目录不存在：' + pc.cloudfunctionRoot);
    }
  }

  /* 2. app.json */
  const appJsonPath = path.join(MP, 'app.json');
  let app = null;
  if (!fs.existsSync(appJsonPath)) {
    err('缺少 miniprogram/app.json');
    return { ok: false, errors: errors, stats: stats };
  }
  try {
    app = readJson(appJsonPath);
  } catch (e) {
    err('app.json 不是合法 JSON：' + e.message);
    return { ok: false, errors: errors, stats: stats };
  }

  const pages = app.pages || [];
  stats.pages = pages.length;
  if (!pages.length) err('app.json 的 pages 为空');

  /* 3. 页面四件套 */
  const missing = [];
  pages.forEach(function (p) {
    ['.js', '.wxml', '.json', '.wxss'].forEach(function (ext) {
      const fp = path.join(MP, p + ext);
      if (!fs.existsSync(fp)) missing.push(p + ext);
    });
  });
  if (missing.length) err('以下页面文件缺失：' + missing.join('、'));
  stats.pageFiles = pages.length * 4 - missing.length;

  /* 4. tabBar */
  const tb = app.tabBar;
  if (tb && tb.list) {
    stats.tabs = tb.list.length;
    if (tb.list.length < 2 || tb.list.length > 5) {
      err('tabBar 数量应为 2~5 个，当前 ' + tb.list.length);
    }
    tb.list.forEach(function (item) {
      if (pages.indexOf(item.pagePath) < 0) {
        err('tabBar 的 pagePath 不在 pages 中：' + item.pagePath);
      }
    });
  }

  /* 5. 页面 json 可解析 */
  pages.forEach(function (p) {
    const fp = path.join(MP, p + '.json');
    if (!fs.existsSync(fp)) return;
    try {
      readJson(fp);
    } catch (e) {
      err(p + '.json 不是合法 JSON：' + e.message);
    }
  });

  /* 6. utils 可加载（纯函数层不得引用 wx） */
  const pureUtils = ['constants', 'date', 'format', 'model', 'validate'];
  pureUtils.forEach(function (name) {
    const fp = path.join(MP, 'utils', name + '.js');
    if (!fs.existsSync(fp)) { err('缺少 utils/' + name + '.js'); return; }
    try {
      // eslint-disable-next-line global-require
      require(fp);
    } catch (e) {
      err('utils/' + name + '.js 无法加载：' + e.message);
    }
  });

  /* 7. 云函数 */
  const cfRoot = path.join(ROOT, (pc && pc.cloudfunctionRoot) || 'cloudfunctions/');
  if (fs.existsSync(cfRoot)) {
    const fns = fs.readdirSync(cfRoot).filter(function (d) {
      try { return fs.statSync(path.join(cfRoot, d)).isDirectory(); } catch (e) { return false; }
    });
    stats.cloudfunctions = fns.length;
    fns.forEach(function (fn) {
      const dir = path.join(cfRoot, fn);
      if (!fs.existsSync(path.join(dir, 'index.js'))) err('云函数 ' + fn + ' 缺少 index.js');
      if (!fs.existsSync(path.join(dir, 'package.json'))) err('云函数 ' + fn + ' 缺少 package.json');
    });
  } else {
    stats.cloudfunctions = 0;
  }

  /* 8. sitemap */
  if (app.sitemapLocation) {
    const sp = path.join(MP, app.sitemapLocation);
    if (!fs.existsSync(sp)) err('sitemap 文件不存在：' + app.sitemapLocation);
  }

  return { ok: errors.length === 0, errors: errors, stats: stats };
}

module.exports = { checkProject: checkProject };

/* CLI */
if (require.main === module) {
  const r = checkProject();
  console.log('工程结构校验');
  console.log('  页面数：' + (r.stats.pages || 0)
    + ' | 页面文件：' + (r.stats.pageFiles || 0)
    + ' | Tab：' + (r.stats.tabs || 0)
    + ' | 云函数：' + (r.stats.cloudfunctions || 0));
  if (r.ok) {
    console.log('\x1b[32m✓ 结构校验通过\x1b[0m');
  } else {
    console.log('\x1b[31m✗ 发现 ' + r.errors.length + ' 个问题：\x1b[0m');
    r.errors.forEach(function (e) { console.log('  · ' + e); });
  }
  process.exit(r.ok ? 0 : 1);
}
