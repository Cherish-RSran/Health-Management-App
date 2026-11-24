/**
 * 部署云函数
 *
 * 单一云函数 `api`（action 路由）。首次创建，之后只更新代码 + 配置。
 * 关键：**必须带上 FHR_ENC_KEY 环境变量**，否则加密字段会退回开发默认密钥。
 */

const path = require('path');
const fs = require('fs');

const FN_NAME = 'api';
const ROOT = path.resolve(__dirname, '..', '..');
const FN_ROOT = path.join(ROOT, 'cloudfunctions');
const FN_DIR = path.join(FN_ROOT, FN_NAME);

/** 部署前的本地自检 —— 把低级错误挡在上传之前 */
function preflight() {
  const problems = [];

  if (!fs.existsSync(FN_DIR)) {
    problems.push('找不到云函数目录：' + FN_DIR);
  } else {
    ['index.js', 'package.json'].forEach(function (f) {
      if (!fs.existsSync(path.join(FN_DIR, f))) problems.push('云函数缺少 ' + f);
    });
    // 共享模块必须已同步
    const sharedDir = path.join(FN_DIR, 'lib', 'shared');
    if (!fs.existsSync(sharedDir)) {
      problems.push('缺少 lib/shared（先运行 node scripts/sync-shared.js）');
    }
    // 业务目录
    if (!fs.existsSync(path.join(FN_DIR, 'actions', 'index.js'))) {
      problems.push('缺少 actions/index.js（action 路由表）');
    }
  }

  // 语法自检
  if (!problems.length) {
    const files = [];
    (function walk(dir) {
      fs.readdirSync(dir).forEach(function (name) {
        if (name === 'node_modules') return;
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.js$/.test(name)) files.push(p);
      });
    })(FN_DIR);

    // 只做语法解析，不执行 —— 云函数依赖 wx-server-sdk，本地不存在，执行会误报
    try {
      const vm = require('vm');
      files.forEach(function (f) {
        new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
      });
    } catch (e) {
      problems.push('云函数存在语法错误：' + e.message);
    }
  }

  return problems;
}

/**
 * @param {object} app   CloudBase 实例（或 mock）
 * @param {object} cfg   部署配置
 * @param {object} opts  { log, dryRun }
 */
async function deployFunction(app, cfg, opts) {
  opts = opts || {};
  const log = opts.log || function () {};
  const dryRun = !!opts.dryRun;

  const func = {
    name: FN_NAME,
    runtime: cfg.runtime || 'Nodejs16.13',
    timeout: cfg.timeout || 20,
    memorySize: cfg.memorySize || 256,
    handler: 'index.main',
    installDependency: true,
    envVariables: {
      FHR_ENC_KEY: cfg.encKey || ''
    }
  };

  const result = {
    name: FN_NAME,
    action: 'unchanged',
    runtime: func.runtime,
    envVariables: Object.keys(func.envVariables),
    hasEncKey: !!cfg.encKey
  };

  const local = preflight();
  if (local.length) {
    const err = new Error('云函数本地自检未通过：\n  ' + local.join('\n  '));
    err.preflight = local;
    throw err;
  }
  log('  ✓ 本地自检通过（目录完整、语法正确）');

  if (dryRun) {
    log('  · 将部署云函数 ' + FN_NAME + '（dry-run）');
    log('    runtime=' + func.runtime + ' timeout=' + func.timeout + 's memory=' + func.memorySize + 'MB');
    log('    环境变量 FHR_ENC_KEY=' + (cfg.encKey ? '***已配置(' + cfg.encKey.length + '位)***' : '**缺失**'));
    result.action = 'dry-run';
    return result;
  }

  const exists = await functionExists(app, FN_NAME);

  if (!exists) {
    log('  + 创建云函数 ' + FN_NAME);
    await app.functions.createFunction({
      func: func,
      functionRootPath: FN_ROOT,
      force: true
    });
    result.action = 'created';
  } else {
    log('  ~ 更新云函数代码 ' + FN_NAME);
    await app.functions.updateFunctionCode({
      func: func,
      functionRootPath: FN_ROOT,
      force: true
    });
    log('  ~ 更新云函数配置（环境变量 / 超时 / 内存）');
    await app.functions.updateFunctionConfig(func);
    result.action = 'updated';
  }

  return result;
}

async function functionExists(app, name) {
  try {
    const d = await app.functions.getFunctionDetail(name);
    return !!d;
  } catch (e) {
    return false;
  }
}

module.exports = {
  FN_NAME: FN_NAME,
  FN_ROOT: FN_ROOT,
  FN_DIR: FN_DIR,
  preflight: preflight,
  deployFunction: deployFunction
};
