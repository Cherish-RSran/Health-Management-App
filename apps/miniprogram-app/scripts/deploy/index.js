#!/usr/bin/env node
/**
 * 一键部署
 *
 *   node scripts/deploy/index.js --check      只看配置齐不齐，不连云端
 *   node scripts/deploy/index.js --dry-run    打印将要执行的操作，不产生任何改动
 *   node scripts/deploy/index.js --only=db    只建库（集合 + 索引）
 *   node scripts/deploy/index.js --only=fn    只部署云函数
 *   node scripts/deploy/index.js --only=upload 只上传小程序代码
 *   node scripts/deploy/index.js              全流程
 *
 * 配置来源：环境变量 > deploy.config.json
 */

const fs = require('fs');
const path = require('path');

const config = require('./config');
const S = require('./schema');
const initDb = require('./init-db');
const deployFn = require('./deploy-fn');
const upload = require('./upload');

/* ---------------------------------------------------------------------------
   参数解析
   --------------------------------------------------------------------------- */
function parseArgs(argv) {
  const out = { check: false, dryRun: false, only: '', help: false };
  (argv || process.argv.slice(2)).forEach(function (a) {
    if (a === '--check') out.check = true;
    else if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.indexOf('--only=') === 0) out.only = a.slice(7);
  });
  if (out.only && ['db', 'fn', 'upload'].indexOf(out.only) < 0) {
    throw new Error('--only 只能是 db / fn / upload');
  }
  return out;
}

/** 本次需要哪些配置项 */
function requiredFields(only) {
  if (only === 'upload') return ['appid', 'privateKeyPath'];
  if (only === 'db' || only === 'fn') return ['envId', 'secretId', 'secretKey'];
  return ['appid', 'privateKeyPath', 'envId', 'secretId', 'secretKey'];
}

function writeTemplate() {
  const tpl = {
    _readme: '把下面各项填好，然后运行 node scripts/deploy/index.js。本文件已在 .gitignore 中。',
    appid: '',
    envId: '',
    secretId: '',
    secretKey: '',
    privateKeyPath: '',
    encKey: config.genEncKey(),
    _help: config.HELP
  };
  fs.writeFileSync(config.CONFIG_FILE, JSON.stringify(tpl, null, 2) + '\n', 'utf8');
  return config.CONFIG_FILE;
}

function createCloudBase(cfg) {
  let CloudBase;
  try {
    CloudBase = require('@cloudbase/manager-node');
  } catch (e) {
    throw new Error('未安装 @cloudbase/manager-node，请先在项目根执行 npm install');
  }
  return new CloudBase({
    secretId: cfg.secretId,
    secretKey: cfg.secretKey,
    envId: cfg.envId
  });
}

/* ---------------------------------------------------------------------------
   主流程
   --------------------------------------------------------------------------- */
async function main(argv) {
  const args = parseArgs(argv);
  const say = function (s) { process.stdout.write((s === undefined ? '' : s) + '\n'); };

  say('');
  say('╭──────────────────────────────────────────────────────────────╮');
  say('│  家庭健康档案小程序 · 部署                                  │');
  say('╰──────────────────────────────────────────────────────────────╯');
  say('');

  if (args.help) {
    say('用法：node scripts/deploy/index.js [--check|--dry-run|--only=db|fn|upload]');
    say('');
    return 0;
  }

  const cfg = config.load({ need: requiredFields(args.only), generateEncKey: true });

  /* --- 配置总览 --- */
  say('配置来源：' + (fs.existsSync(config.CONFIG_FILE) ? config.CONFIG_FILE : '（未创建，仅用环境变量）'));
  say('');
  const show = function (label, v, opts2) {
    const masked = (opts2 && opts2.secret) && v ? v.slice(0, 6) + '****' + v.slice(-4) : v;
    say('  ' + label + ' : ' + (masked || '（未配置）'));
  };
  show('appid          ', cfg.appid);
  show('envId          ', cfg.envId);
  show('secretId       ', cfg.secretId, { secret: true });
  show('secretKey      ', cfg.secretKey, { secret: true });
  show('privateKeyPath ', cfg.privateKeyPath);
  show('FHR_ENC_KEY    ', cfg.encKey ? (cfg._generatedEncKey ? '自动生成 ' : '已配置 ') + cfg.encKey.slice(0, 8) + '…（' + cfg.encKey.length + ' 位）' : '');
  say('');

  /* --- 只做配置体检 --- */
  if (args.check) {
    if (cfg._ok) {
      say('✅ 配置齐全，可以部署。');
      if (!fs.existsSync(config.CONFIG_FILE)) {
        say('   提示：当前全部来自环境变量，未生成 deploy.config.json。');
      }
    } else {
      say('❌ 还缺 ' + cfg._missing.length + ' 项：');
      say(config.explainMissing(cfg));
      say('');
      if (!fs.existsSync(config.CONFIG_FILE)) {
        say('   已为你生成配置模板：' + writeTemplate());
        say('   填好后重新运行即可。');
      } else {
        say('   请补全 ' + config.CONFIG_FILE);
      }
    }
    say('');
    return cfg._ok ? 0 : 2;
  }

  /* --- 缺配置 --- */
  if (!cfg._ok) {
    say('❌ 还缺 ' + cfg._missing.length + ' 项，无法部署：');
    say(config.explainMissing(cfg));
    say('');
    if (!fs.existsSync(config.CONFIG_FILE)) {
      const p = writeTemplate();
      say('已生成配置模板：' + p);
      say('（模板里的 encKey 已随机生成，可直接使用；填好其余各项后重新运行）');
    } else {
      say('请补全：' + config.CONFIG_FILE);
    }
    say('');
    return 2;
  }

  // 自动生成的加密密钥必须落盘，否则每次部署都会换密钥、旧数据解不开
  if (cfg._generatedEncKey) {
    const p = config.persist(cfg, { encKey: cfg.encKey });
    say('⚠ 已自动生成加密密钥并写入 ' + path.basename(p));
    say('  这个密钥用于加密手机号/身份证，**请务必备份**；丢失后已加密数据无法恢复。');
    say('');
  }

  const steps = args.only ? [args.only] : ['db', 'fn', 'upload'];
  const summary = { db: null, fn: null, upload: null };
  let exitCode = 0;

  /* --- 1. 建库 --- */
  if (steps.indexOf('db') >= 0) {
    say('① 建库（' + S.COLLECTIONS.length + ' 个集合 / ' + S.indexCount() + ' 个索引）');
    try {
      const app = createCloudBase(cfg);
      const r = await initDb.initDatabase(app, { log: say, dryRun: args.dryRun });
      summary.db = r;

      if (!args.dryRun) {
        say('');
        say('  唯一索引自检…');
        const v = await initDb.verifyUniqueIndexes(app, { log: say });
        if (v.ok) {
          say('  ✓ ' + v.present.length + ' 个唯一索引全部就位');
        } else {
          say('  ✗ 缺失唯一索引：' + v.missing.join('、'));
          say('    这些索引缺失会导致并发时产生重复家庭 / 重复成员，请立即补建。');
          exitCode = 1;
        }
      }
    } catch (e) {
      say('  ✗ 建库失败：' + (e && e.message ? e.message : e));
      if (e && e.preflight) exitCode = 1;
      else exitCode = 1;
      summary.db = { error: e && e.message ? e.message : String(e) };
    }
    say('');
  }

  /* --- 2. 部署云函数 --- */
  if (steps.indexOf('fn') >= 0) {
    say('② 部署云函数 api');
    try {
      const app = createCloudBase(cfg);
      const r = await deployFn.deployFunction(app, cfg, { log: say, dryRun: args.dryRun });
      summary.fn = r;
    } catch (e) {
      say('  ✗ 部署失败：' + (e && e.message ? e.message : e));
      summary.fn = { error: e && e.message ? e.message : String(e) };
      exitCode = 1;
    }
    say('');
  }

  /* --- 3. 上传小程序代码 --- */
  if (steps.indexOf('upload') >= 0) {
    say('③ 上传小程序代码');
    try {
      // dry-run 必须「什么都不动」，包括本地工程文件 ——
      // 否则预演一遍就把假 AppID 提交进版本库了
      if (!args.dryRun && upload.syncAppId(cfg.appid)) {
        say('  · 已把 appid 写入 project.config.json');
      }
      const r = await upload.uploadCode(cfg, { log: say, dryRun: args.dryRun });
      summary.upload = r;
    } catch (e) {
      say('  ✗ 上传失败：' + (e && e.message ? e.message : e));
      summary.upload = { error: e && e.message ? e.message : String(e) };
      exitCode = 1;
    }
    say('');
  }

  /* --- 汇总 --- */
  say('──────────────────────────────────────────────────────────────');
  if (exitCode === 0) {
    say('✅ 部署完成');
    if (args.dryRun) say('   （dry-run：云端未发生任何改动）');
  } else {
    say('⚠ 部署未全部成功，请查看上方 ✗ 项');
  }
  say('');

  return exitCode;
}

/* --- CLI 入口 --- */
if (require.main === module) {
  main().then(function (code) {
    process.exit(code || 0);
  }).catch(function (e) {
    process.stderr.write('\n部署脚本异常：' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(1);
  });
}

module.exports = {
  main: main,
  parseArgs: parseArgs,
  requiredFields: requiredFields,
  writeTemplate: writeTemplate,
  createCloudBase: createCloudBase
};
