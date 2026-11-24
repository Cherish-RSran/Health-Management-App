#!/usr/bin/env node
/**
 * 把小程序端的公共纯函数模块同步到云函数端
 *
 *   node scripts/sync-shared.js          同步
 *   node scripts/sync-shared.js --check  只检查是否一致（CI 用）
 *
 * 小程序与云函数必须使用同一份业务规则，否则会出现
 * 「前端算短期药已结束、后端还算在服」这类不一致。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'miniprogram', 'utils');
const DST_DIR = path.join(ROOT, 'cloudfunctions', 'api', 'lib', 'shared');

const FILES = ['constants.js', 'date.js', 'format.js', 'model.js', 'validate.js'];

const HEADER = '/* eslint-disable */\n'
  + '/* ⚠️ 自动生成，请勿直接修改本文件。\n'
  + ' * 源文件：miniprogram/utils/{name}\n'
  + ' * 同步命令：node scripts/sync-shared.js\n'
  + ' */\n';

function build(name) {
  const src = fs.readFileSync(path.join(SRC_DIR, name), 'utf8');
  return HEADER.replace('{name}', name) + src;
}

function main() {
  const checkOnly = process.argv.indexOf('--check') >= 0;
  fs.mkdirSync(DST_DIR, { recursive: true });

  const drift = [];
  FILES.forEach(function (name) {
    const content = build(name);
    const dst = path.join(DST_DIR, name);
    const exists = fs.existsSync(dst);
    const same = exists && fs.readFileSync(dst, 'utf8') === content;

    if (checkOnly) {
      if (!same) drift.push(name);
    } else if (!same) {
      fs.writeFileSync(dst, content, 'utf8');
      console.log('  ✓ 同步 ' + name);
    }
  });

  if (checkOnly) {
    if (drift.length) {
      console.log('\x1b[31m✗ 以下共享模块与源文件不一致：' + drift.join('、') + '\x1b[0m');
      console.log('  请运行：node scripts/sync-shared.js');
      process.exit(1);
    }
    console.log('\x1b[32m✓ 共享模块一致（' + FILES.length + ' 个）\x1b[0m');
    return;
  }

  console.log('共享模块同步完成 → ' + path.relative(ROOT, DST_DIR));
}

main();
