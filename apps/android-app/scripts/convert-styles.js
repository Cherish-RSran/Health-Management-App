/**
 * wxss -> css
 *
 * 只做最小必要的三处改写，其余原样保留，保证视觉与小程序一致：
 *   1. Nrpx          -> calc(N * var(--rpx))，--rpx = 100vw/750（rpx 是 750 分屏宽）
 *   2. page { ... }  -> :root { ... }（小程序的 page 是根容器，H5 里用 html）
 *   3. 小程序标签选择器 -> 通配选择器（H5 里没有 view/text/scroll-view）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// 注意：深度分组后小程序已在 apps/miniprogram-app/ 下，路径需带上该层
const SRC = path.resolve(ROOT, '..', 'miniprogram-app', 'miniprogram');
const OUT = path.join(ROOT, 'src', 'styles');

fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true });

/** rpx -> calc() */
function rpx(css) {
  return css.replace(/(-?\d+(?:\.\d+)?)rpx/g, function (m, n) {
    return 'calc(' + n + ' * var(--rpx))';
  });
}

/**
 * 小程序特有容器标签 -> 通配选择器
 * 只换 view / text / scroll-view 这三类「小程序才有」的标签；
 * input / textarea / button / label 在 H5 里同名同义，保持不动，
 * 否则 `.search input` 这类后代选择器会被误伤成 `.search *`。
 */
function tags(css) {
  return css.replace(/(^|[\s,])(view|text|scroll-view)(?=[\s,.{>:])/gm, '$1*');
}

/** page -> :root */
function root(css) {
  return css
    .replace(/^page\.big-mode,/m, '.big-mode,')
    .replace(/^page\s*\{/m, ':root {')
    .replace(/^page\b/m, ':root');
}

function convert(css) {
  return tags(root(rpx(css)));
}

/* ---------- 全局样式 ---------- */
let base = fs.readFileSync(path.join(SRC, 'app.wxss'), 'utf8');
base = convert(base);
// box-sizing 那条原本是给小程序标签列的，H5 里直接通配
base = base.replace(/[^{}]*\{\s*box-sizing:\s*border-box;\s*\}/,
  '\n*, *::before, *::after { box-sizing: border-box; }\n');

const BASE_HEAD = `/* 由 miniprogram/app.wxss 自动转换，请勿手改 */
:root {
  /* rpx 基准：小程序设计稿 750rpx = 屏宽 */
  --rpx: calc(100vw / 750);
}

html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background: var(--bg);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}

/* 小程序 scroll-view 的横向/纵向滚动，H5 里补上 */
.avatars, .frow { overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; }
.avatars::-webkit-scrollbar, .frow::-webkit-scrollbar { display: none; }
.bd, .doc-body { overflow-y: auto; -webkit-overflow-scrolling: touch; }

/* 页面容器：tabBar 之上的滚动区 */
.app-main {
  min-height: 100vh;
}

`;
fs.writeFileSync(path.join(OUT, 'base.css'), BASE_HEAD + base, 'utf8');

/* ---------- 页面样式 ---------- */
const PAGES = ['home', 'timeline', 'family', 'me', 'person', 'condition', 'record', 'summary'];
const imports = ["@import './base.css';"];
PAGES.forEach(function (p) {
  const src = fs.readFileSync(path.join(SRC, 'pages', p, p + '.wxss'), 'utf8');
  const out = '/* 由 miniprogram/pages/' + p + '/' + p + '.wxss 自动转换 */\n' + convert(src);
  fs.writeFileSync(path.join(OUT, 'pages', p + '.css'), out, 'utf8');
  imports.push("@import './pages/" + p + ".css';");
});

/* ---------- 组件样式 ---------- */
const comp = fs.readFileSync(
  path.join(SRC, 'components', 'form-sheet', 'form-sheet.wxss'), 'utf8'
);
fs.writeFileSync(
  path.join(OUT, 'form-sheet.css'),
  '/* 由 miniprogram/components/form-sheet/form-sheet.wxss 自动转换 */\n' + convert(comp)
);
imports.push("@import './form-sheet.css';");

fs.writeFileSync(path.join(OUT, 'index.css'), imports.join('\n') + '\n', 'utf8');
console.log('[styles] 生成 base + ' + PAGES.length + ' 个页面 + 1 个组件样式');
