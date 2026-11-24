#!/usr/bin/env node
/**
 * 生成页面骨架（P0 用；P7 会填充真实内容）
 * 已存在的文件不会被覆盖，除非加 --force
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram', 'pages');
const FORCE = process.argv.indexOf('--force') >= 0;

const PAGES = [
  ['home',      '首页'],
  ['timeline',  '健康时间线'],
  ['family',    '家人'],
  ['me',        '我的'],
  ['person',    '健康档案'],
  ['condition', '病程详情'],
  ['record',    '补记'],
  ['summary',   '医生摘要']
];

PAGES.forEach(function (p) {
  const name = p[0], title = p[1];
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });

  const files = {};
  files[name + '.js'] =
    'Page({\n' +
    '  data: {},\n\n' +
    '  onLoad(options) {}\n' +
    '});\n';
  files[name + '.wxml'] =
    '<!-- ' + title + ' · 骨架，待实现 -->\n' +
    '<view class="page">\n' +
    '  <view class="placeholder">' + title + '</view>\n' +
    '</view>\n';
  files[name + '.wxss'] =
    '/* ' + title + ' */\n' +
    '.page { padding: 28rpx; }\n' +
    '.placeholder { color: #9CA3AF; font-size: 28rpx; }\n';
  files[name + '.json'] =
    JSON.stringify({ navigationBarTitleText: title, usingComponents: {} }, null, 2) + '\n';

  Object.keys(files).forEach(function (f) {
    const fp = path.join(dir, f);
    if (fs.existsSync(fp) && !FORCE) return;
    fs.writeFileSync(fp, files[f], 'utf8');
  });
});

console.log('已生成页面骨架：' + PAGES.map(function (p) { return p[0]; }).join(', '));
