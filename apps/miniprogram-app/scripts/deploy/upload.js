/**
 * 上传小程序代码（miniprogram-ci）
 *
 * 这是「不打开微信开发者工具也能把代码传上去」的路径，
 * 前提是：AppID 已填 + 公众平台生成的「代码上传密钥」已下载 + 本机 IP 在白名单内。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_CONFIG = path.join(ROOT, 'project.config.json');

/** 上传前自检 */
function preflight(cfg) {
  const problems = [];

  if (!cfg.appid) {
    problems.push('未配置 appid');
  }
  if (!cfg.privateKeyPath) {
    problems.push('未配置 privateKeyPath（小程序代码上传密钥文件路径）');
  } else if (!fs.existsSync(cfg.privateKeyPath)) {
    problems.push('上传密钥文件不存在：' + cfg.privateKeyPath);
  }

  if (!fs.existsSync(PROJECT_CONFIG)) {
    problems.push('缺少 project.config.json');
  } else {
    try {
      const pc = JSON.parse(fs.readFileSync(PROJECT_CONFIG, 'utf8'));
      if (!pc.appid) {
        problems.push('project.config.json 里的 appid 为空');
      } else if (cfg.appid && pc.appid !== cfg.appid) {
        problems.push('project.config.json 的 appid（' + pc.appid + '）与配置不一致');
      }
      ['miniprogramRoot', 'cloudfunctionRoot'].forEach(function (k) {
        if (!pc[k]) problems.push('project.config.json 缺少 ' + k);
      });
    } catch (e) {
      problems.push('project.config.json 不是合法 JSON');
    }
  }

  // 小程序代码目录必须存在
  if (!fs.existsSync(path.join(ROOT, 'miniprogram', 'app.json'))) {
    problems.push('找不到 miniprogram/app.json');
  }

  return problems;
}

/** 把 appid 写进 project.config.json（用户只在 config 里填一次） */
function syncAppId(appid) {
  if (!appid || !fs.existsSync(PROJECT_CONFIG)) return false;
  const raw = fs.readFileSync(PROJECT_CONFIG, 'utf8');
  const pc = JSON.parse(raw);
  if (pc.appid === appid) return false;
  pc.appid = appid;
  fs.writeFileSync(PROJECT_CONFIG, JSON.stringify(pc, null, 2) + '\n', 'utf8');
  return true;
}

/**
 * @param {object} cfg   { appid, privateKeyPath, version, desc }
 * @param {object} opts  { log, dryRun }
 */
async function uploadCode(cfg, opts) {
  opts = opts || {};
  const log = opts.log || function () {};
  const dryRun = !!opts.dryRun;

  const problems = preflight(cfg);
  if (problems.length) {
    const err = new Error('上传前自检未通过：\n  ' + problems.join('\n  '));
    err.preflight = problems;
    throw err;
  }
  log('  ✓ 本地自检通过');

  if (dryRun) {
    log('  · 将上传代码 version=' + cfg.version + '（dry-run）');
    return { action: 'dry-run', version: cfg.version };
  }

  let ci;
  try {
    ci = require('miniprogram-ci');
  } catch (e) {
    throw new Error('未安装 miniprogram-ci，请先在项目根执行 npm install');
  }

  const project = new ci.Project({
    appid: cfg.appid,
    type: 'miniProgram',
    projectPath: ROOT,
    privateKeyPath: path.resolve(cfg.privateKeyPath),
    ignores: [
      'node_modules/**/*',
      'cloudfunctions/**/*',
      'scripts/**/*',
      'demo/**/*',
      '.workbuddy/**/*',
      '*.md'
    ]
  });

  log('  ↑ 上传中…（version=' + cfg.version + '）');
  const res = await ci.upload({
    project: project,
    version: cfg.version,
    desc: cfg.desc,
    setting: {
      es6: true,
      minify: true,
      minifyWXSS: true,
      minifyWXML: true,
      codeProtect: false,
      autoPrefixWXSS: true
    },
    onProgressUpdate: function (p) {
      if (p && typeof p === 'string') log('    ' + p);
    }
  });

  log('  ✓ 上传成功');
  return { action: 'uploaded', version: cfg.version, result: res };
}

module.exports = {
  preflight: preflight,
  syncAppId: syncAppId,
  uploadCode: uploadCode
};
