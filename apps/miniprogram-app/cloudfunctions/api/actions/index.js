/**
 * action 路由表
 *
 * 每一项：
 *   handler  (ctx, payload) => Promise<data>
 *   auth     false = 无需登录（默认 true）
 *   load     false = 不加载用户/家庭上下文（默认 true）
 *
 * 后端新增功能时只在这里注册，前端用 api.call('命名空间.动作')。
 */

const authActions = require('./auth');
const familyActions = require('./family');
const personActions = require('./person');
const conditionActions = require('./condition');
const recordActions = require('./record');
const timelineActions = require('./timeline');
const summaryActions = require('./summary');
const homeActions = require('./home');
const meActions = require('./me');

const ROUTES = {};

function reg(name, route) {
  if (ROUTES[name]) throw new Error('重复注册 action：' + name);
  ROUTES[name] = route;
}

/* ---- 健康检查（无需登录） ---- */
reg('ping', {
  auth: false,
  load: false,
  handler: async function () { return { pong: true, ts: Date.now() }; }
});

/* ---- 账号 ---- */
reg('auth.login',         { auth: false, handler: authActions.login });
reg('auth.whoami',        { auth: true,  handler: authActions.whoami });
reg('auth.updateProfile', { auth: true,  handler: authActions.updateProfile });
reg('auth.updateSetting', { auth: true,  handler: authActions.updateSetting });
/* 手机号 + 密码账号：注册与登录无需登录态（本来就是为了拿登录态） */
reg('auth.register',        { auth: false, handler: authActions.register });
reg('auth.loginByPassword', { auth: false, handler: authActions.loginByPassword });
reg('auth.bindCredential',  { auth: true,  handler: authActions.bindCredential });
reg('auth.updatePhone',     { auth: true,  handler: authActions.updatePhone });
reg('auth.updatePassword',  { auth: true,  handler: authActions.updatePassword });
reg('auth.logout',          { auth: false, handler: authActions.logout });

/* ---- 家庭与成员 ---- */
reg('family.create',      { auth: true, handler: familyActions.create });
reg('family.join',        { auth: true, handler: familyActions.join });
reg('family.approve',     { auth: true, handler: familyActions.approve });
reg('family.members',     { auth: true, handler: familyActions.members });
reg('family.removeMember',{ auth: true, handler: familyActions.removeMember });
reg('family.grantAccess', { auth: true, handler: familyActions.grantAccess });
reg('family.refreshCode', { auth: true, handler: familyActions.refreshCode });
reg('family.transfer',    { auth: true, handler: familyActions.transferOwner });

/* ---- 档案人 ---- */
reg('person.list',        { auth: true, handler: personActions.list });
reg('person.get',         { auth: true, handler: personActions.get });
reg('person.create',      { auth: true, handler: personActions.create });
reg('person.update',      { auth: true, handler: personActions.update });
reg('person.archive',     { auth: true, handler: personActions.archive });

/* ---- 常备档案（过敏 / 基础病 / 手术 / 用药 / 紧急联系人） ---- */
reg('archive.list',       { auth: true, handler: personActions.archiveList });
reg('archive.add',        { auth: true, handler: personActions.archiveAdd });
reg('archive.update',     { auth: true, handler: personActions.archiveUpdate });
reg('archive.remove',     { auth: true, handler: personActions.archiveRemove });
reg('person.accessList',  { auth: true, handler: personActions.accessList });

/* ---- 病程与病程事件 ---- */
reg('condition.create',   { auth: true, handler: conditionActions.create });
reg('condition.update',   { auth: true, handler: conditionActions.update });
reg('condition.end',      { auth: true, handler: conditionActions.end });
reg('condition.reopen',   { auth: true, handler: conditionActions.reopen });
reg('condition.remove',   { auth: true, handler: conditionActions.remove });
reg('condition.detail',   { auth: true, handler: conditionActions.detail });
reg('condition.backfill', { auth: true, handler: conditionActions.backfill });
reg('event.add',          { auth: true, handler: conditionActions.addEvent });
reg('event.update',       { auth: true, handler: conditionActions.updateEvent });
reg('event.remove',       { auth: true, handler: conditionActions.removeEvent });

/* ---- 健康时间线 ---- */
reg('timeline.query',     { auth: true, handler: timelineActions.query });

/* ---- 就诊 / 检查 / 疫苗 ---- */
reg('record.add',         { auth: true, handler: recordActions.add });
reg('record.detail',      { auth: true, handler: recordActions.detail });
reg('record.update',      { auth: true, handler: recordActions.update });
reg('record.remove',      { auth: true, handler: recordActions.remove });

/* ---- 医生摘要 ---- */
reg('summary.build',      { auth: true, handler: summaryActions.build });
reg('summary.options',    { auth: true, handler: summaryActions.options });

/* ---- 首页与待办 ---- */
reg('home.dashboard',     { auth: true, handler: homeActions.dashboard });
reg('todo.list',          { auth: true, handler: homeActions.todoList });
reg('todo.add',           { auth: true, handler: homeActions.todoAdd });
reg('todo.update',        { auth: true, handler: homeActions.todoUpdate });
reg('todo.toggle',        { auth: true, handler: homeActions.todoToggle });
reg('todo.remove',        { auth: true, handler: homeActions.todoRemove });

/* ---- 我的：家庭动态 / 导出 ---- */
reg('audit.list',         { auth: true, handler: meActions.logs });
reg('export.data',        { auth: true, handler: meActions.exportData });
reg('export.stats',       { auth: true, handler: meActions.stats });

module.exports = ROUTES;
