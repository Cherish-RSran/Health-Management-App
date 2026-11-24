<script setup>
/** 我的（对应 pages/me） */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { usePage } from '../core/page.js';
import * as api from '../core/api.js';
import { actionSheet, prompt, toast, toastOk, setClipboard } from '../core/ui.js';
import { setting, patchSetting, session, logout } from '../core/session.js';
import { showVersionGuide } from '../core/guide.js';

const router = useRouter();

const { state, load } = usePage({
  data: {
    family: null,
    members: [],
    pending: [],
    isAdmin: false,
    logs: [],
    stats: null,
    me: null,
    showLogs: false
  },
  fetch: async function () {
    const res = await Promise.all([
      api.call('family.members', {}, { silent: true }),
      api.call('audit.list', { limit: 15 }, { silent: true }),
      api.call('export.stats', {}, { silent: true })
    ]);
    const m = res[0];
    return {
      family: m.family,
      members: m.members || [],
      pending: m.pending || [],
      isAdmin: m.is_admin,
      logs: (res[1] && res[1].logs) || [],
      stats: res[2],
      big: !!(setting.value && setting.value.large_font),
      me: session.user || null,
      needFamily: false
    };
  }
});

const stats = computed(function () { return state.stats || {}; });

/* ---------- 建家庭 ---------- */
async function onCreateFamily() {
  const name = await prompt('创建家庭', '给家庭起个名字，如「示例家庭」');
  if (!name) return;
  const myName = await prompt('你的姓名', '用于建立你自己的档案');
  if (!myName) return;
  await api.call('family.create', {
    name: name.trim() || '我的家',
    my_name: myName.trim()
  }, { loading: '创建中' });
  toastOk('家庭已创建');
  load();
}

async function onJoinFamily() {
  const code = await prompt('加入家庭', '输入 6 位邀请码');
  if (!code) return;
  await api.call('family.join', { code: code.trim() }, { loading: '提交中' });
  toast('申请已提交，等待管理员同意');
  load();
}

/* ---------- 个人信息 ---------- */
async function onEditName() {
  const v = await prompt('修改昵称', '输入昵称（最多 30 字）');
  if (!v) return;
  await api.call('auth.updateProfile', { nickname: v.trim() });
  if (session.user) session.user.nickname = v.trim();
  toastOk('已保存');
  load();
}

/* ---------- 手机号 ---------- */
async function onEditPhone() {
  const cur = (state.me && state.me.phone) || '';
  if (!cur) {
    const v = await prompt('填写手机号', '11 位手机号');
    if (!v) return;
    return savePhone(v.trim());
  }
  const idx = await actionSheet(['修改手机号', '清除手机号'], '当前：' + cur);
  if (idx === 0) {
    const v = await prompt('修改手机号', '11 位手机号', cur);
    if (!v) return;
    return savePhone(v.trim());
  }
  if (idx === 1) {
    const ok = await api.confirm('清除手机号',
      '清除后，添加紧急联系人时不再自动填入你的号码。确认继续？');
    if (!ok) return;
    return savePhone('');
  }
}

async function savePhone(phone) {
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) return toast('手机号格式不正确');
  await api.call('auth.updatePhone', { phone: phone }, { loading: '保存中' });
  if (session.user) session.user.phone = phone;
  toastOk(phone ? '已保存' : '已清除');
  load();
}

/* ---------- 登录密码 ---------- */
async function onEditPassword() {
  const has = !!(state.me && state.me.has_password);
  const curPhone = (state.me && state.me.phone) || '';
  if (!/^1[3-9]\d{9}$/.test(curPhone)) return toast('请先填写手机号，再设置密码');

  let oldPwd = '';
  if (has) {
    oldPwd = await prompt('修改密码', '请输入当前密码');
    if (!oldPwd) return;
  }
  const np = await prompt(has ? '设置新密码' : '设置登录密码', '至少 6 位，不能全是数字');
  if (!np) return;
  if (np.length < 6 || /^\d+$/.test(np)) return toast('密码至少 6 位，且不能全是数字');

  await api.call('auth.updatePassword', {
    old_password: oldPwd,
    new_password: np
  }, { loading: '保存中' });
  if (session.user) session.user.has_password = true;
  toastOk('密码已设置');
  load();
}

async function onLogout() {
  const ok = await api.confirm('退出登录',
    '退出后需要重新用「手机号 + 密码」登录。本机已记录的数据不会被删除。');
  if (!ok) return;
  await logout();
  router.replace('/login');
}

/* ---------- 家庭管理 ---------- */
async function onApprove(id) {
  await api.call('family.approve', { membership_id: id, approve: true });
  toastOk('已同意');
  load();
}

async function onReject(id) {
  await api.call('family.approve', { membership_id: id, approve: false });
  toast('已拒绝');
  load();
}

async function onCopyCode() {
  const code = state.family && state.family.invite_code;
  if (!code) return toast('仅管理员可查看');
  const ok = await setClipboard(code);
  toast(ok ? '邀请码已复制' : '复制失败');
}

async function onRefreshCode() {
  const ok = await api.confirm('刷新邀请码', '刷新后旧邀请码立即失效，确认继续？');
  if (!ok) return;
  const r = await api.call('family.refreshCode', {}, { loading: '生成中' });
  toast('新邀请码：' + r.invite_code);
  load();
}

async function onRemoveMember(id, name) {
  const ok = await api.confirm('移出家庭', '确认将「' + (name || '该成员') + '」移出家庭？');
  if (!ok) return;
  await api.call('family.removeMember', { user_id: id });
  toastOk('已移出');
  load();
}

/* ---------- 动态 ---------- */
function onToggleLogs() { state.showLogs = !state.showLogs; }

/* ---------- 设置 ---------- */
function onToggleBig() {
  const next = !state.big;
  state.big = next;
  patchSetting({ large_font: next });
  api.call('auth.updateSetting', { large_font: next }, { silent: true });
  toast(next ? '已开启大字模式' : '已关闭大字模式');
}

/* ---------- 导出 ---------- */
async function onExport() {
  const idx = await actionSheet(['导出全量 JSON', '生成文本摘要（可复制）']);
  if (idx === 0) return doExportJson();
  if (idx === 1) return doExportText();
}

async function doExportJson() {
  const d = await api.call('export.data', {}, { loading: '导出中', silent: true });
  const text = JSON.stringify(d);
  const ok = await setClipboard(text);
  toast(ok
    ? '数据已复制到剪贴板（' + Math.round(text.length / 1024) + ' KB）'
    : '数据过大，复制失败', 2400);
}

async function doExportText() {
  const persons = (state.members || []).map(function (m) { return m.nickname || '成员'; });
  const s = stats.value;
  const lines = [
    '【' + ((state.family && state.family.name) || '家庭') + '】健康档案概览',
    '成员：' + persons.join('、'),
    '档案数：' + (s.persons || 0) + ' 份',
    '病程记录：' + (s.conditions || 0) + ' 次',
    '病程事件：' + (s.events || 0) + ' 条',
    '用药记录：' + (s.medicines || 0) + ' 条',
    '导出时间：' + new Date().toLocaleString()
  ];
  const ok = await setClipboard(lines.join('\n'));
  toast(ok ? '概览已复制' : '复制失败');
}

/* ---------- 隐私 ---------- */
function onPrivacy() {
  api.confirm('隐私与授权',
    '· 健康信息属敏感个人信息，处理前须取得单独同意\n'
    + '· 档案共享以归属人本人授权为前提\n'
    + '· 手机号、身份证号等加密存储\n'
    + '· 附件为私有资源，只发临时链接\n'
    + '· 不与任何第三方共享，不对接医院系统',
    { confirmText: '我知道了', showCancel: false });
}

function onAbout() {
  api.confirm('关于',
    '家庭健康档案 v1.0（安卓本机版）\n\n'
    + '记录家人档案与病程，就诊时给医生看提炼摘要。\n'
    + '本产品为信息记录工具，不提供问诊、诊断、处方、用药建议等医疗服务。\n'
    + '全部数据保存在本机，不上传任何服务器。',
    { showCancel: false });
}

function onVersionGuide() {
  showVersionGuide();
}

/* ---------- 本机数据 ---------- */
async function onBackup() {
  const idx = await actionSheet(['导出备份到文件', '从备份文件恢复'], '本机数据');
  if (idx === 0) return exportFile();
  if (idx === 1) return importFile();
}

async function exportFile() {
  const pwd = await prompt('设置备份密码（可选）', '留空则不加密');
  const { rawDB } = await import('../server/local.js');
  const db = await rawDB();
  const dump = await db.dump();
  let text = JSON.stringify({ app: 'family-health', version: 1, at: Date.now(), data: dump });
  let encNote = '';
  if (pwd) {
    try { text = await encryptText(text, pwd); encNote = '（已加密）'; }
    catch (e) { toast('加密失败，已改为不加密导出'); }
  }
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '家庭健康档案备份-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('备份已导出' + encNote + '（' + Math.round(text.length / 1024) + ' KB）', 2600);
  } catch (e) {
    toast('导出失败：' + e.message);
  }
}

function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async function () {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed = JSON.parse(text);
      const encrypted = parsed && parsed.enc === 1;
      if (encrypted) {
        const pwd = await prompt('输入备份密码', '该备份已加密');
        if (!pwd) return;
        text = await decryptText(text, pwd);
        parsed = JSON.parse(text);
      }
      const data = parsed && parsed.data ? parsed.data : parsed;
      const ok = await api.confirm('恢复备份',
        '恢复会覆盖本机的全部现有数据，确认继续？');
      if (!ok) return;
      const { rawDB } = await import('../server/local.js');
      const db = await rawDB();
      const n = await db.restore(data);
      toastOk('已恢复 ' + n + ' 条记录');
      load();
    } catch (e) {
      toast('恢复失败：文件格式不正确或密码错误');
    }
  };
  input.click();
}

/* ---------- 备份加密（WebCrypto AES-GCM + PBKDF2） ---------- */
function b64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64dec(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
async function encryptText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({
    app: 'family-health', enc: 1, version: 1, at: Date.now(),
    salt: b64(salt), iv: b64(iv), data: b64(ct)
  });
}
async function decryptText(payload, password) {
  const p = JSON.parse(payload);
  const key = await deriveKey(password, b64dec(p.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(p.iv) }, key, b64dec(p.data));
  return new TextDecoder().decode(pt);
}
</script>

<template>
  <div class="page" :class="{ 'big-mode': state.big }">

    <div v-if="state.loading" class="empty">加载中…</div>

    <template v-else-if="state.needFamily">
      <div class="empty">
        <div>还没有家庭</div>
        <div class="muted">创建家庭后即可开始记录</div>
      </div>
      <div class="btn btn-primary btn-block" @click="onCreateFamily">创建家庭</div>
    </template>

    <template v-else-if="state.error">
      <div class="empty">{{ state.error }}</div>
      <div class="btn btn-primary btn-block" @click="load">重试</div>
    </template>

    <template v-else>
      <!-- 个人信息 -->
      <div class="card profile" @click="onEditName">
        <div class="avatar">{{ (state.me && state.me.nickname) || '我' }}</div>
        <div class="flex1">
          <div class="p-name">
            {{ (state.me && state.me.nickname) || '未设置昵称' }}
            <span v-if="state.isAdmin" class="tag tag-md">管理员</span>
          </div>
          <div class="p-sub">
            {{ state.family ? state.family.name : '' }} ·
            {{ (state.me && state.me.phone) || '未绑定手机号' }}
          </div>
        </div>
        <div class="go">›</div>
      </div>

      <!-- 账号：手机号 / 登录密码 -->
      <div class="card card-tight">
        <div class="row" @click="onEditPhone">
          <div class="ic" style="background:#E7F6F0;color:#0B8057">机</div>
          <div class="tx">
            <div class="t1">手机号</div>
            <div class="t2">{{ (state.me && state.me.phone) || '未填写 · 填了可一键填进紧急联系人' }}</div>
          </div>
          <div class="go">›</div>
        </div>
        <div class="row" @click="onEditPassword">
          <div class="ic" style="background:#FEF3C7;color:#B45309">密</div>
          <div class="tx">
            <div class="t1">登录密码</div>
            <div class="t2">
              {{ (state.me && state.me.has_password) ? '已设置，可修改' : '未设置 · 设置后可用手机号+密码登录' }}
            </div>
          </div>
          <div class="go">›</div>
        </div>
        <div v-if="!session.loggedIn" class="row" @click="router.push('/login')">
          <div class="ic" style="background:#EAF1FF;color:#1D4ED8">登</div>
          <div class="tx">
            <div class="t1">登录 / 注册</div>
            <div class="t2">当前是「仅本机使用」，登录后可在别的设备继续</div>
          </div>
          <div class="go">›</div>
        </div>
        <div v-else class="row" @click="onLogout">
          <div class="ic" style="background:#F2F5F8;color:#6B7280">出</div>
          <div class="tx">
            <div class="t1">退出登录</div>
            <div class="t2">本机数据保留，退出后需重新登录</div>
          </div>
          <div class="go">›</div>
        </div>
      </div>

      <!-- 家庭管理 -->
      <div class="card">
        <div class="sec-title">
          <div class="h"><div class="bar"></div>家庭管理</div>
          <div class="more">{{ state.members.length }} 位成员</div>
        </div>

        <div v-if="state.isAdmin" class="invite-row">
          <div class="code">{{ state.family ? state.family.invite_code : '' }}</div>
          <div class="mini-btn no" @click.stop="onCopyCode">复制</div>
          <div class="mini-btn no" @click.stop="onRefreshCode">刷新</div>
        </div>

        <div class="row" v-for="m in state.members" :key="m.user_id">
          <div class="ic" style="background:var(--brand-2);color:var(--brand-3)">
            {{ m.nickname || '成员' }}
          </div>
          <div class="tx">
            <div class="t1">
              {{ m.nickname || '未设置昵称' }}
              <span v-if="m.role === 'admin'" class="tag tag-md">管理员</span>
              <span v-if="m.is_me" class="tag tag-grey">我</span>
            </div>
            <div class="t2">{{ m.relation_label || '家人' }}{{ m.phone ? ' · ' + m.phone : '' }}</div>
          </div>
          <div v-if="state.isAdmin && !m.is_me" class="mini-btn no"
               @click.stop="onRemoveMember(m.user_id, m.nickname)">移除</div>
        </div>

        <template v-if="state.pending.length">
          <div class="sub-label">待审批</div>
          <div class="pend" v-for="p in state.pending" :key="p.membership_id">
            <div class="flex1">
              <div class="t1">{{ p.nickname || '新成员' }}</div>
              <div class="t2">{{ p.relation_label || '家人' }} · {{ p.phone || '' }}</div>
            </div>
            <div class="mini-btn ok" @click.stop="onApprove(p.membership_id)">同意</div>
            <div class="mini-btn no" @click.stop="onReject(p.membership_id)">拒绝</div>
          </div>
        </template>

        <div class="perm-note">
          管理员只负责成员进出，<span class="bold">不代表能查看所有档案</span>。
          档案可见性由 person_access 决定（owner / edit / read / none）。
        </div>
      </div>

      <!-- 设置 -->
      <div class="card card-tight">
        <div class="row" @click="onToggleBig">
          <div class="ic" style="background:#EEF0FF;color:#4F46E5">字</div>
          <div class="tx">
            <div class="t1">大字模式</div>
            <div class="t2">给老人使用，字号整体放大</div>
          </div>
          <div class="switch" :class="{ on: state.big }"><div class="knob"></div></div>
        </div>
      </div>

      <!-- 数据 -->
      <div class="card card-tight">
        <div class="row" @click="onExport">
          <div class="ic" style="background:#F3EEFF;color:#6D28D9">导</div>
          <div class="tx">
            <div class="t1">数据导出 / 备份</div>
            <div class="t2">
              档案 {{ stats.persons }} 份 · 病程 {{ stats.conditions }} 次 · 用药 {{ stats.medicines }} 条
            </div>
          </div>
          <div class="go">›</div>
        </div>
        <div class="row" @click="onBackup">
          <div class="ic" style="background:#E7F6F0;color:#0B8057">本</div>
          <div class="tx">
            <div class="t1">本机数据备份</div>
            <div class="t2">导出成文件 / 从文件恢复（换手机时用）</div>
          </div>
          <div class="go">›</div>
        </div>
        <div class="row" @click="onToggleLogs">
          <div class="ic" style="background:#EAF1FF;color:#1D4ED8">动</div>
          <div class="tx">
            <div class="t1">家庭动态</div>
            <div class="t2">谁在什么时候看了 / 改了什么</div>
          </div>
          <div class="go">{{ state.showLogs ? '⌃' : '›' }}</div>
        </div>
        <template v-if="state.showLogs">
          <div class="logitem" v-for="l in state.logs" :key="l.id">
            <div class="log-ic">{{ l.action_text }}</div>
            <div class="flex1">
              <div class="log-line">{{ l.who }}{{ l.is_me ? '（我）' : '' }} {{ l.action_text }}</div>
              <div class="log-at">{{ l.at }}</div>
            </div>
          </div>
          <div v-if="!state.logs.length" class="muted" style="padding:20px 0">暂无记录</div>
        </template>
      </div>

      <!-- 隐私 -->
      <div class="card card-tight">
        <div class="row" @click="onPrivacy">
          <div class="ic" style="background:#FFF1E7;color:#C2410C">隐</div>
          <div class="tx">
            <div class="t1">隐私与授权</div>
            <div class="t2">敏感信息处理说明</div>
          </div>
          <div class="go">›</div>
        </div>
        <div class="row" @click="onVersionGuide">
          <div class="ic" style="background:#E8FBF3;color:#0B8057">版</div>
          <div class="tx">
            <div class="t1">本机版 vs 云端版</div>
            <div class="t2">两种版本的区别与怎么选</div>
          </div>
          <div class="go">›</div>
        </div>
        <div class="row" @click="onAbout">
          <div class="ic" style="background:#F2F5F8;color:#6B7280">关</div>
          <div class="tx">
            <div class="t1">关于</div>
            <div class="t2">v1.0</div>
          </div>
          <div class="go">›</div>
        </div>
      </div>

      <div class="footer-note">
        本产品为家庭健康信息记录工具
        <div>不提供问诊、诊断、处方、用药建议等医疗服务</div>
        <div>数据全部保存在本机，不上传服务器</div>
      </div>
    </template>
  </div>
</template>
