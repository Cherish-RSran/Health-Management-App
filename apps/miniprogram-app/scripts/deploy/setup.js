#!/usr/bin/env node
/**
 * 部署配置向导
 *
 *   node scripts/deploy/setup.js                          交互式填写（推荐）
 *   node scripts/deploy/setup.js --set appid=wx0123…      非交互式填写
 *   node scripts/deploy/setup.js --show                   只看当前配置（脱敏）
 *
 * 存在的意义：让用户不必打开 JSON 手工粘贴密钥。
 * 每填一项即时校验格式，错了当场指出，而不是等到部署时才炸。
 */

const fs = require('fs');
const path = require('path');

const config = require('./config');

const ROOT = config.ROOT;
const PROJECT_CONFIG = path.join(ROOT, 'project.config.json');

/* ---------------------------------------------------------------------------
   字段规则：格式校验 + 从哪里拿
   --------------------------------------------------------------------------- */
const RULES = [
  {
    key: 'appid',
    label: '小程序 AppID',
    eg: 'wx0123456789abcdef',
    hint: '微信公众平台 → 开发管理 → 开发设置 → AppID(小程序ID)',
    validate: function (v) {
      if (!/^wx[0-9a-fA-F]{16}$/.test(v)) {
        return 'AppID 应以 wx 开头、后跟 16 位十六进制字符（共 18 位），收到的是 ' + v.length + ' 位';
      }
      return null;
    }
  },
  {
    key: 'envId',
    label: '云开发环境 ID',
    eg: 'health-1a2b3c',
    hint: '微信开发者工具 → 云开发 → 环境设置 → 环境 ID',
    validate: function (v) {
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{4,48}$/.test(v)) {
        return '环境 ID 只能含字母、数字和连字符，且不能以连字符开头';
      }
      if (v.indexOf('-') < 0) {
        return '环境 ID 形如 xxx-1a2b3c，中间应有一个连字符';
      }
      return null;
    }
  },
  {
    key: 'secretId',
    label: '腾讯云 SecretId',
    eg: 'AKIDxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    hint: 'console.cloud.tencent.com → 访问管理 → API 密钥管理',
    secret: true,
    validate: function (v) {
      if (!/^AKID[A-Za-z0-9]{8,60}$/.test(v)) {
        return 'SecretId 通常以 AKID 开头（收到的是 ' + v.slice(0, 6) + '…），请确认是否复制完整';
      }
      return null;
    }
  },
  {
    key: 'secretKey',
    label: '腾讯云 SecretKey',
    eg: '（30 位左右的字符串）',
    hint: 'console.cloud.tencent.com → 访问管理 → API 密钥管理（与 SecretId 同一页面，创建时只显示一次）',
    secret: true,
    validate: function (v) {
      if (v.length < 20) {
        return 'SecretKey 看起来太短了（' + v.length + ' 位），通常 30 位以上';
      }
      if (/[\s]/.test(v)) return 'SecretKey 不应包含空格';
      return null;
    }
  },
  {
    key: 'privateKeyPath',
    label: '上传密钥文件路径',
    eg: 'C:/keys/private.wx0123456789abcdef.key',
    hint: '微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传 → 生成密钥并下载',
    validate: function (v) {
      if (!/\.key$/i.test(v)) {
        return '上传密钥文件应以 .key 结尾';
      }
      if (!fs.existsSync(v)) {
        return '文件不存在：' + v;
      }
      try {
        if (fs.statSync(v).size === 0) return '文件是空的，请重新下载密钥';
      } catch (e) {
        return '文件无法读取：' + e.message;
      }
      return null;
    }
  }
];

/** 取某条规则 */
function rule(key) {
  for (let i = 0; i < RULES.length; i++) {
    if (RULES[i].key === key) return RULES[i];
  }
  return null;
}

/**
 * 校验一组值
 * @returns {{ errors: object, ok: boolean }}
 */
function validateAll(values) {
  const errors = {};
  RULES.forEach(function (r) {
    const v = values[r.key];
    if (v === undefined || v === '') return;      // 未填不算错，只是缺
    const msg = r.validate(String(v));
    if (msg) errors[r.key] = msg;
  });
  return { errors: errors, ok: Object.keys(errors).length === 0 };
}

/** 哪些必填项还没填 */
function missingKeys(values) {
  return RULES.filter(function (r) {
    return !values[r.key];
  }).map(function (r) { return r.key; });
}

/* ---------------------------------------------------------------------------
   写入
   --------------------------------------------------------------------------- */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return {};
  }
}

/**
 * 落盘：deploy.config.json + project.config.json（appid 同步）
 * 留空的字段保留原值，不会被清掉。
 *
 * 路径可注入（测试用）：

 *   write(v, { paths: { configPath, projectConfigPath } })
 * —— 测试不该弄脏真实工程文件，这是被逼出来的：早期版本把假 AppID 写进了
 *    project.config.json，测试全绿但真机跑不起来，非常难查。
 */
function write(values, opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const paths = opts.paths || {};

  const targetFile = paths.configPath || config.CONFIG_FILE;
  const projectFile = paths.projectConfigPath || PROJECT_CONFIG;

  const base = readJson(targetFile);

  const out = Object.assign({}, base);
  Object.keys(values).forEach(function (k) {
    const v = values[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  });

  // 加密密钥：没有就生成一把。**绝不覆盖已有密钥** —— 换密钥等于让旧数据作废。
  let keyGenerated = false;
  if (!out.encKey) {
    out.encKey = config.genEncKey();
    keyGenerated = true;
  }

  const ordered = {
    _readme: '本文件含敏感信息，已在 .gitignore 中排除，请勿提交或分享。',
    appid: out.appid || '',
    envId: out.envId || '',
    secretId: out.secretId || '',
    secretKey: out.secretKey || '',
    privateKeyPath: out.privateKeyPath || '',
    encKey: out.encKey,
    runtime: out.runtime || 'Nodejs16.13',
    timeout: out.timeout || 20,
    memorySize: out.memorySize || 256,
    version: out.version || '1.0.0',
    _help: config.HELP
  };

  const changed = {
    configPath: targetFile,
    projectConfigPath: projectFile,
    projectUpdated: false,
    keyGenerated: keyGenerated,
    written: !dryRun
  };

  if (dryRun) return changed;

  fs.writeFileSync(targetFile, JSON.stringify(ordered, null, 2) + '\n', 'utf8');

  // 非 Windows 上收紧权限；Windows 无 chmod 语义，忽略即可
  if (process.platform !== 'win32') {
    try { fs.chmodSync(targetFile, 0o600); } catch (e) { /* 忽略 */ }
  }

  // appid 同步进 project.config.json，省掉第二次手改
  if (ordered.appid && fs.existsSync(projectFile)) {
    try {
      const pc = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      if (pc.appid !== ordered.appid) {
        pc.appid = ordered.appid;
        fs.writeFileSync(projectFile, JSON.stringify(pc, null, 2) + '\n', 'utf8');
        changed.projectUpdated = true;
      }
    } catch (e) {
      // project.config.json 坏了不该中断配置写入，交由后续 check 报错
      changed.projectError = e.message;
    }
  }

  return changed;
}

/* ---------------------------------------------------------------------------
   展示
   --------------------------------------------------------------------------- */
function mask(key, v) {
  if (!v) return '（未配置）';
  const r = rule(key);
  if (key === 'privateKeyPath') {
    const base = path.basename(v);
    return base.length > 12 ? base.slice(0, 8) + '…' + base.slice(-4) : base;
  }
  if (key === 'encKey') return v.slice(0, 8) + '…（' + v.length + ' 位）';
  if (r && r.secret) return v.length > 10 ? v.slice(0, 6) + '****' + v.slice(-4) : '****';
  return v;
}

/* ---------------------------------------------------------------------------
   命令行参数：--set k=v / --show
   --------------------------------------------------------------------------- */
function parseArgs(argv) {
  const out = { sets: {}, show: false, help: false };
  const list = argv || process.argv.slice(2);

  const assign = function (body, src) {
    const i = body.indexOf('=');
    if (i < 0) throw new Error('--set 格式应为 --set key=value，收到：' + src);
    out.sets[body.slice(0, i).trim()] = body.slice(i + 1).trim();
  };

  // 两种写法都支持：--set k=v 和 --set=k=v（前者更符合直觉）
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--show') out.show = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--set') {
      const next = list[i + 1];
      if (!next) throw new Error('--set 后面缺内容，正确写法：--set appid=wx0123456789abcdef');
      assign(next, a + ' ' + next);
      i++;
    } else if (a.indexOf('--set=') === 0) {
      assign(a.slice(6), a);
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
   主流程
   --------------------------------------------------------------------------- */
async function main(argv, opts) {
  const args = parseArgs(argv);
  opts = opts || {};
  const paths = opts.paths || {};   // 测试注入用；正常运行时为空，写真实路径
  const say = function (s) { process.stdout.write((s === undefined ? '' : s) + '\n'); };

  say('');
  say('╭──────────────────────────────────────────────────────────────╮');
  say('│  部署配置向导 · 家庭健康档案小程序                          │');
  say('╰──────────────────────────────────────────────────────────────╯');
  say('');

  const current = config.load(paths.configPath ? { configFile: paths.configPath } : {});
  const values = {
    appid: current.appid,
    envId: current.envId,
    secretId: current.secretId,
    secretKey: current.secretKey,
    privateKeyPath: current.privateKeyPath
  };

  /* --- 只看现状 --- */
  if (args.show) {
    RULES.forEach(function (r) {
      say('  ' + pad(r.label) + mask(r.key, values[r.key]));
    });
    say('  ' + pad('加密密钥') + mask('encKey', current.encKey));
    say('');
    const miss = missingKeys(values);
    if (miss.length) {
      say('  还缺 ' + miss.length + ' 项：' + miss.join('、'));
    } else {
      say('  ✅ 五项都已配置，可以运行 npm run deploy。');
    }
    say('');
    return 0;
  }

  /* --- 非交互写入 --- */
  const setKeys = Object.keys(args.sets);
  if (setKeys.length) {
    const unknown = setKeys.filter(function (k) { return !rule(k); });
    if (unknown.length) {
      say('  ✗ 未知配置项：' + unknown.join('、'));
      say('    可用：' + RULES.map(function (r) { return r.key; }).join(' / '));
      say('');
      return 2;
    }
    const v = validateAll(args.sets);
    if (!v.ok) {
      Object.keys(v.errors).forEach(function (k) {
        say('  ✗ ' + k + ' → ' + v.errors[k]);
      });
      say('');
      say('  配置未写入，请修正后重试。');
      say('');
      return 2;
    }
    const r = write(args.sets, { paths: paths });
    say('  ✓ 已写入 ' + path.basename(r.configPath));
    if (r.projectUpdated) say('  ✓ 已同步 appid 到 project.config.json');
    if (r.keyGenerated) {
      say('  ⚠ 已自动生成加密密钥，请备份：换密钥后旧加密数据无法解开。');
    }
    say('');
    return 0;
  }

  /* --- 交互式 --- */
  // 没有可交互的输入流时（CI、管道、重定向）不能卡住等答案
  if (!process.stdin.isTTY) {
    say('  ⚠ 当前不是交互终端，没法问答。请改用：');
    say('     node scripts/deploy/setup.js --set appid=wx0123456789abcdef');
    say('     node scripts/deploy/setup.js --set envId=你的环境ID --set secretId=… --set secretKey=…');
    say('');
    return 2;
  }

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: !!process.stdout.isTTY
  });

  const ask = function (q) {
    return new Promise(function (resolve) { rl.question(q, resolve); });
  };

  say('  逐项填写，直接回车表示「保留原值」。粘贴后回车即可。');
  say('');

  try {
    for (let i = 0; i < RULES.length; i++) {
      const r = RULES[i];
      say('  【' + (i + 1) + '/' + RULES.length + '】' + r.label);
      say('        去哪拿：' + r.hint);
      say('        示例：' + r.eg);
      if (values[r.key]) {
        say('        当前：' + mask(r.key, values[r.key]));
      }

      // 格式不对就一直问，但不无限循环折磨人：给 5 次机会
      for (let attempt = 0; attempt < 5; attempt++) {
        const line = (await ask('        > ')).trim();
        if (!line) break;                            // 保留原值
        const msg = r.validate(line);
        if (!msg) { values[r.key] = line; break; }
        say('        ✗ ' + msg + '（再试一次，或回车跳过）');
        if (attempt === 4) say('        · 已跳过，稍后可运行 npm run deploy:setup 补填');
      }
      say('');
    }
  } finally {
    rl.close();
  }

  const v = validateAll(values);
  if (!v.ok) {
    Object.keys(v.errors).forEach(function (k) { say('  ✗ ' + k + ' → ' + v.errors[k]); });
  }

  const r = write(values, { paths: paths });
  say('  ✓ 已写入 ' + path.basename(r.configPath) + '（本文件已在 .gitignore 中，不会进版本库）');
  if (r.projectUpdated) say('  ✓ 已把 appid 同步到 project.config.json');
  if (r.projectError) say('  ⚠ project.config.json 写入失败：' + r.projectError);
  if (r.keyGenerated) {
    say('  ⚠ 已自动生成加密密钥（encKey）。这是解不开旧密码的唯一钥匙，请备份。');
  }
  say('');

  const miss = missingKeys(values);
  if (miss.length) {
    say('  ⚠ 还缺 ' + miss.length + ' 项：' + miss.join('、'));
    say('    补齐后再运行：npm run deploy');
  } else {
    say('  ✅ 配置齐全。下一步：');
    say('     npm run deploy:check     先体检');
    say('     npm run deploy -- --dry-run   预演一遍');
    say('     npm run deploy           真正部署');
  }
  say('');
  return miss.length ? 2 : 0;
}

function pad(s) {
  const w = 20;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n += s.charCodeAt(i) > 127 ? 2 : 1;
  }
  return s + ' '.repeat(Math.max(1, w - n));
}

/* --- CLI 入口 --- */
if (require.main === module) {
  main().then(function (code) {
    process.exit(code || 0);
  }).catch(function (e) {
    if (e && e.code === 'ERR_USE_AFTER_CLOSE') {
      process.stdout.write('\n已取消（输入流已关闭）。\n');
      process.exit(130);
    }
    process.stderr.write('\n配置向导异常：' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(1);
  });
}

module.exports = {
  RULES: RULES,
  rule: rule,
  validateAll: validateAll,
  missingKeys: missingKeys,
  write: write,
  mask: mask,
  parseArgs: parseArgs,
  main: main
};
