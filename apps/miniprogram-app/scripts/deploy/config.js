/**
 * 部署配置加载与校验
 *
 * 配置来源优先级：环境变量 > deploy.config.json > 自动生成
 *
 * 敏感信息一律不进版本库（deploy.config.json 已在 .gitignore）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(ROOT, 'deploy.config.json');

/** 缺什么、去哪拿 —— 直接告诉用户，不让他猜 */
const HELP = {
  appid: '小程序 AppID。微信公众平台 → 开发管理 → 开发设置 → AppID(小程序ID)',
  envId: '云开发环境 ID。微信开发者工具 → 云开发 → 环境设置 → 环境 ID（形如 xxx-1a2b3c）',
  secretId: '腾讯云 API 密钥 ID。console.cloud.tencent.com → 访问管理 → API密钥管理',
  secretKey: '腾讯云 API 密钥 Key（同上页面）',
  privateKeyPath: '小程序代码上传密钥文件。微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传 → 生成密钥并下载'
};

function readConfigFile(file) {
  const target = file || CONFIG_FILE;
  if (!fs.existsSync(target)) return {};
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    throw new Error((file ? file : 'deploy.config.json') + ' 不是合法 JSON：' + e.message);
  }
}

function pick(fileCfg, envName, fileKey) {
  const v = process.env[envName];
  if (v !== undefined && v !== '') return String(v);
  const f = fileCfg[fileKey];
  if (f !== undefined && f !== null && f !== '') return String(f);
  return '';
}

/** 生成 32 字节（64 位十六进制）的加密密钥 */
function genEncKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 解析配置
 * @param {object} opts
 *   opts.need  —— 本次需要的字段（缺哪个报哪个），如 ['appid','envId','secretId','secretKey']
 *   opts.generateEncKey —— 无密钥时是否自动生成并落盘
 *   opts.configFile —— 从别处读配置（测试隔离用）
 */
function load(opts) {
  opts = opts || {};
  const need = opts.need || [];
  const fileCfg = readConfigFile(opts.configFile);

  const cfg = {
    appid: pick(fileCfg, 'FHR_APPID', 'appid'),
    envId: pick(fileCfg, 'FHR_ENV_ID', 'envId'),
    secretId: pick(fileCfg, 'TENCENT_SECRET_ID', 'secretId'),
    secretKey: pick(fileCfg, 'TENCENT_SECRET_KEY', 'secretKey'),
    privateKeyPath: pick(fileCfg, 'FHR_UPLOAD_KEY_PATH', 'privateKeyPath'),
    encKey: pick(fileCfg, 'FHR_ENC_KEY', 'encKey'),

    // 云函数规格（可选）
    runtime: pick(fileCfg, 'FHR_RUNTIME', 'runtime') || 'Nodejs16.13',
    timeout: Number(pick(fileCfg, 'FHR_FN_TIMEOUT', 'timeout')) || 20,
    memorySize: Number(pick(fileCfg, 'FHR_FN_MEMORY', 'memorySize')) || 256,

    // 上传版本信息（可选）
    version: pick(fileCfg, 'FHR_VERSION', 'version') || '1.0.0',
    desc: pick(fileCfg, 'FHR_DESC', 'desc') || '家庭健康档案 · 部署',

    _file: CONFIG_FILE
  };

  // 自动补加密密钥
  if (!cfg.encKey && opts.generateEncKey) {
    cfg.encKey = genEncKey();
    cfg._generatedEncKey = true;
  }

  // 校验
  const missing = [];
  need.forEach(function (k) {
    if (!cfg[k]) missing.push(k);
  });

  cfg._missing = missing;
  cfg._ok = missing.length === 0;
  return cfg;
}

/** 把缺失项渲染成一段可读的指引 */
function explainMissing(cfg) {
  if (!cfg._missing.length) return '';
  return cfg._missing.map(function (k) {
    return '  ✗ ' + k + '\n      ' + (HELP[k] || '');
  }).join('\n');
}

/** 写回 deploy.config.json（用于保存自动生成的密钥等） */
function persist(cfg, extra) {
  const base = readConfigFile();
  const out = Object.assign({}, base, extra || {});
  const ordered = {
    _readme: '本文件含敏感信息，已在 .gitignore 中排除，请勿提交或分享。',
    appid: out.appid || cfg.appid,
    envId: out.envId || cfg.envId,
    secretId: out.secretId || cfg.secretId,
    secretKey: out.secretKey || cfg.secretKey,
    privateKeyPath: out.privateKeyPath || cfg.privateKeyPath,
    encKey: out.encKey || cfg.encKey,
    runtime: out.runtime || cfg.runtime,
    timeout: out.timeout || cfg.timeout,
    memorySize: out.memorySize || cfg.memorySize
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
  return CONFIG_FILE;
}

module.exports = {
  ROOT: ROOT,
  CONFIG_FILE: CONFIG_FILE,
  HELP: HELP,
  load: load,
  explainMissing: explainMissing,
  persist: persist,
  genEncKey: genEncKey
};
