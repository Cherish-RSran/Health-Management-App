/**
 * 一键打包 APK
 *
 * 跑法：npm run apk
 * 可选：node scripts/build-apk.js --release   （正式包，需要签名配置）
 *
 * 流程：前置检查 → 构建前端 → 同步到安卓工程 → gradle 打包 → 打印 APK 路径
 * 任何一步缺东西都会给出「怎么做」而不是干报错。
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'android');

const wantRelease = process.argv.indexOf('--release') >= 0;

function step(msg) {
  console.log('\n\x1b[36m▶ ' + msg + '\x1b[0m');
}

function die(msg) {
  console.error('\n\x1b[31m✗ ' + msg + '\x1b[0m');
  process.exit(1);
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ cwd: ROOT, shell: true }, opts || {}));
  return r;
}

/* ---------- 1. 找 Android SDK ---------- */
function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'android', 'sdk'),
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    path.join(os.homedir(), 'Android', 'Sdk')
  ].filter(Boolean);

  for (const p of candidates) {
    if (p && fs.existsSync(path.join(p, 'platforms'))) return p;
  }
  return null;
}

step('检查打包环境');

const sdk = findSdk();
if (!sdk) {
  die('没找到 Android SDK。\n'
    + '  最简单的办法：装 Android Studio → Settings → Android SDK → 勾选 '
    + 'Android SDK Platform 34 + Build-Tools 34 → Apply。\n'
    + '  装好后重跑本命令即可。');
}
console.log('  Android SDK：' + sdk);

const java = run('java', ['-version']);
if (java.status !== 0) {
  die('没找到 Java。请安装 JDK 17 或更高版本（https://adoptium.net），然后重跑。');
}
console.log('  Java：' + String(java.stderr || '').split('\n')[0]);

if (!fs.existsSync(ANDROID_DIR)) {
  die('还没有安卓工程。先跑一次：npx cap add android');
}

/* ---------- 2. 写 local.properties ---------- */
const props = 'sdk.dir=' + sdk.replace(/\\/g, '/') + '\n';
fs.writeFileSync(path.join(ANDROID_DIR, 'local.properties'), props, 'utf8');
console.log('  已写入 android/local.properties');

/* ---------- 2.5 路径含中文时关掉 AGP 的检查 ---------- */
// 本工程会放在「家庭健康档案小程序」这种中文目录下，AGP 8 默认直接拒绝构建。
const propsFile = path.join(ANDROID_DIR, 'gradle.properties');
let gprops = fs.readFileSync(propsFile, 'utf8');
if (/[^\u0000-\u007f]/.test(ROOT) && gprops.indexOf('android.overridePathCheck') < 0) {
  gprops += '\n# 工程目录含中文，按 AGP 提示关掉路径检查（构建链路实测正常）\n'
    + 'android.overridePathCheck=true\n';
  fs.writeFileSync(propsFile, gprops, 'utf8');
  console.log('  工程路径含中文，已关闭 AGP 的路径检查');
}

/* ---------- 3. 构建前端 ---------- */
step('构建前端（vite build）');
const build = run('npx', ['vite', 'build']);
if (build.status !== 0) {
  die('前端构建失败，上面的日志里有原因。');
}
console.log('  前端产物：' + path.join(ROOT, 'dist'));

/* ---------- 4. 同步到安卓工程 ---------- */
step('同步到安卓工程（cap sync）');
const sync = run('npx', ['cap', 'sync', 'android']);
if (sync.status !== 0) {
  die('cap sync 失败。');
}

/* ---------- 5. gradle 打包 ---------- */
const task = wantRelease ? 'assembleRelease' : 'assembleDebug';
step('gradle ' + task + '（首次会下载依赖，可能要几分钟）');

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const env = Object.assign({}, process.env, {
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk
});

const gradle = spawnSync(gradlew, [task, '--console=plain'], {
  cwd: ANDROID_DIR,
  shell: true,
  env: env,
  stdio: 'inherit'
});

if (gradle.status !== 0) {
  die('gradle 打包失败。常见原因：\n'
    + '  · 首次运行需要联网下载 Gradle 与依赖，网络不通会卡在这里\n'
    + '  · JDK 版本低于 17\n'
    + '  · Android SDK 缺 platform 34 或 build-tools 34（用 Android Studio 的 SDK Manager 补）');
}

/* ---------- 6. 找 APK ---------- */
const candidates = [
  path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
  path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
  path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk')
];

let apk = null;
for (const p of candidates) {
  if (fs.existsSync(p)) { apk = p; break; }
}
if (!apk) die('gradle 说成功了，但没找到 APK 文件，去 android/app/build/outputs/apk 看看。');

// 顺手复制一份到工程根目录，方便找到
const outName = wantRelease ? '家庭健康档案-release.apk' : '家庭健康档案-debug.apk';
const outPath = path.join(ROOT, outName);
fs.copyFileSync(apk, outPath);

const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);

console.log('\n' + '─'.repeat(58));
console.log('\x1b[32m打包完成\x1b[0m');
console.log('  APK：' + outPath);
console.log('  大小：' + sizeMB + ' MB');
console.log('─'.repeat(58));
console.log('\n装到手机：');
console.log('  1. 手机打开「开发者选项 → USB 调试」');
console.log('  2. adb install -r "' + outName + '"');
console.log('  或者直接把 APK 传到手机，点开安装（需允许「未知来源」）');

if (wantRelease) {
  console.log('\n注意：正式包默认打的是未签名包，上架前需要用你自己的 keystore 签名。');
}
