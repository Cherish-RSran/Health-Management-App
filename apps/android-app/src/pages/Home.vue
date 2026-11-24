<script setup>
/** 首页 · 今天该做什么的仪表盘（对应 pages/home） */
import { onMounted } from 'vue';
import { usePage } from '../core/page.js';
import * as api from '../core/api.js';
import { actionSheet, prompt, toast, toastOk } from '../core/ui.js';
import { push, switchTab } from '../router/index.js';
import { patchSetting } from '../core/session.js';
import { showVersionGuide, markVersionGuideSeen, shouldShowVersionGuide } from '../core/guide.js';

const CARD_LABEL = {
  meds: '今天要吃的药',
  todos: '今日待办',
  emg: '紧急信息卡',
  quick: '快捷操作'
};

onMounted(function () {
  state.nowSlot = computeNowSlot();
  if (shouldShowVersionGuide()) {
    showVersionGuide();
    markVersionGuideSeen();
  }
});

/* 当前用药时段：早（<11）/ 中（11–15）/ 晚（≥16） */
function computeNowSlot() {
  const h = new Date().getHours();
  if (h < 11) return '早';
  if (h < 16) return '中';
  return '晚';
}

/* 本地临时「已服」标记（不写入云端、不打卡，仅本次浏览提示） */
function onToggleMed(id) {
  if (!state.taken) state.taken = {};
  state.taken[id] = !state.taken[id];
}

const DEFAULT_ORDER = ['meds', 'todos', 'emg', 'quick'];

const { state, load } = usePage({
  data: {
    dashboard: null,
    order: DEFAULT_ORDER.slice(),
    cardLabel: CARD_LABEL,
    sortMode: false,
    nowSlot: '',
    taken: {}
  },
  fetch: async function () {
    const d = await api.call('home.dashboard', {}, { silent: true });
    return {
      dashboard: d,
      order: (d.setting && d.setting.card_order) || DEFAULT_ORDER.slice(),
      needFamily: !!d.needs_family
    };
  }
});

const persons = function () {
  return (state.dashboard && state.dashboard.persons) || [];
};

/* ---------- 成员 ---------- */
function onPerson(id) {
  push('/person?id=' + id);
}

/* ---------- 待办 ---------- */
function onToggleTodo(id) {
  api.call('todo.toggle', { todo_id: id }, { silent: true })
    .then(function () { load(); })
    .catch(function () {});
}

async function onTodoLongPress(id, title) {
  const idx = await actionSheet(['修改日期', '删除']);
  if (idx === 0) return pickDateForTodo(id);
  if (idx !== 1) return;
  const ok = await api.confirm('删除', '确认删除「' + title + '」？');
  if (!ok) return;
  await api.call('todo.remove', { todo_id: id });
  toastOk('已删除');
  load();
}

async function pickDateForTodo(id) {
  const v = await prompt('修改日期（YYYY-MM-DD）', '如 2026-10-20');
  if (!v) return;
  await api.call('todo.update', { todo_id: id, due_date: v });
  toastOk('已更新');
  load();
}

/* ---------- 卡片排序 ---------- */
function onCardLongPress() {
  if (state.sortMode) return;
  state.sortMode = true;
  toast('点箭头调整顺序，完成后保存');
}

function onMove(key, dir) {
  const order = state.order.slice();
  const i = order.indexOf(key);
  const j = i + Number(dir);
  if (i < 0 || j < 0 || j >= order.length) return;
  order.splice(i, 1);
  order.splice(j, 0, key);
  state.order = order;
}

async function onSaveOrder() {
  try {
    await api.call('auth.updateSetting', { card_order: state.order }, { silent: true });
    patchSetting({ card_order: state.order.slice() });
    toastOk('顺序已保存');
  } catch (e) {
    /* 静默失败也要退出排序模式 */
  }
  state.sortMode = false;
}

/* ---------- 快捷操作 ---------- */
async function onQuick() {
  const idx = await actionSheet([
    '补记一次病程', '记录就诊', '记录检查 / 体检', '记录疫苗', '记录体征', '添加待办'
  ]);
  const urls = [
    '/record',
    '/record?mode=visit',
    '/record?mode=exam',
    '/record?mode=vaccine',
    '/record?mode=vital',
    '/record?mode=todo'
  ];
  if (idx >= 0 && idx < urls.length) push(urls[idx]);
}

function onGoingAddMed() {
  if (!persons().length) return toast('请先添加成员档案');
  push('/person?id=' + persons()[0].id + '&open=medicine');
}

function onEmergency() {
  if (!persons().length) return toast('还没有可查看的档案');
  push('/person?id=' + persons()[0].id + '&open=emergency');
}

function onInvite() { switchTab('/me'); }
function onTimeline() { switchTab('/timeline'); }
function goCreateFamily() { switchTab('/me'); }

/* 首页直接切换大字模式（前置入口，照顾老人） */
function onToggleBigHome() {
  const next = !state.big;
  state.big = next;
  patchSetting({ large_font: next });
  toast(next ? '已开启大字模式' : '已关闭大字模式');
}
</script>

<template>
  <div class="page" :class="{ 'big-mode': state.big }">

    <div v-if="state.loading" class="empty">加载中…</div>

    <template v-else-if="state.dashboard && state.dashboard.needs_family && state.dashboard.join_status === 'pending'">
      <div class="empty">
        <div class="ic">⏳</div>
        <div>申请已提交</div>
        <div class="muted">正在等待「{{ state.dashboard.pending_family_name }}」的管理员同意</div>
      </div>
      <div class="btn btn-ghost btn-block" @click="load">刷新看看</div>
    </template>

    <template v-else-if="state.needFamily">
      <div class="empty">
        <div class="ic">🏠</div>
        <div>还没有家庭</div>
        <div class="muted">先创建一个家庭，再把家人加进来</div>
      </div>
      <div class="btn btn-primary btn-block" @click="goCreateFamily">去创建家庭</div>
    </template>

    <template v-else-if="state.error">
      <div class="empty">{{ state.error }}</div>
      <div class="btn btn-primary btn-block" @click="load">重试</div>
    </template>

    <template v-else-if="state.dashboard">
      <!-- 家庭横幅 -->
      <div class="hero">
        <div>
          <div class="fam">{{ state.dashboard.family.name }}</div>
          <div class="sub">
            {{ persons().length }} 位成员
            <span v-if="state.dashboard.family.invite_code"> · 邀请码 {{ state.dashboard.family.invite_code }}</span>
          </div>
        </div>
        <div class="hero-actions">
          <div class="big-toggle" :class="{ on: state.big }" @click="onToggleBigHome">{{ state.big ? '大字 开' : '大字 关' }}</div>
          <div class="invite" @click="onInvite">＋ 邀请</div>
        </div>
      </div>

      <!-- 成员横条 -->
      <div class="avatars">
        <div class="av" v-for="p in persons()" :key="p.id" @click="onPerson(p.id)">
          <div class="b" :style="{ background: p.profile_type === 'self' ? '#0E9F6E' : '#3B82F6' }">
            {{ p.name }}
          </div>
          <div class="n">{{ p.relation || '成员' }}</div>
        </div>
        <div v-if="!persons().length" class="av-empty">还没有档案，去「我的」添加</div>
      </div>

      <!-- 待审批提醒（仅管理员） -->
      <div v-if="state.dashboard.pending_count > 0" class="card card-flat notice" @click="onInvite">
        <div class="row">
          <div class="ic" style="background:#FEF3C7;color:#B45309">待</div>
          <div class="tx">
            <div class="t1">有 {{ state.dashboard.pending_count }} 位成员待审批</div>
            <div class="t2">去「我的 → 家庭管理」处理</div>
          </div>
          <div class="go">›</div>
        </div>
      </div>

      <!-- 卡片区（顺序由用户设置决定；长按进入排序模式） -->
      <template v-for="cardKey in state.order" :key="cardKey">
        <div class="card-wrap">

          <div v-if="state.sortMode" class="sort-bar">
            <span class="sort-label">{{ state.cardLabel[cardKey] }}</span>
            <div class="sort-btns">
              <div class="sort-btn" @click="onMove(cardKey, -1)">↑</div>
              <div class="sort-btn" @click="onMove(cardKey, 1)">↓</div>
            </div>
          </div>

          <!-- 今天要吃的药 -->
          <div v-else-if="cardKey === 'meds'" class="card" v-longpress="onCardLongPress">
            <div class="sec-title">
              <div class="h"><div class="bar"></div>今天要吃的药</div>
              <div class="more">看一眼就行</div>
            </div>
            <template v-if="state.dashboard.medicines && state.dashboard.medicines.length">
              <template v-for="(m, mi) in state.dashboard.medicines" :key="mi">
                <div class="med-person">
                  <div class="ph">
                    <span class="bold">{{ m.person.name }}</span>
                    <span class="muted">{{ m.person.age }} 岁 · {{ m.person.relation }}</span>
                  </div>
                  <div class="slot" v-for="g in (m.groups || [])" :key="g.slot">
                    <div class="slot-tag" :class="{ 'slot-now': g.label === state.nowSlot }">{{ g.label }}</div>
                    <div class="pills">
                      <div class="pill" v-for="it in (g.items || [])" :key="it.id"
                           :class="{ taken: state.taken && state.taken[it.id] }"
                           @click="onToggleMed(it.id)">
                        <span class="pill-check" v-if="state.taken && state.taken[it.id]">✓</span>
                        <span>{{ it.name }}</span>
                        <span class="pill-spec">{{ it.spec }}</span>
                        <span v-if="it.is_short_term" class="tag tag-short">短期</span>
                        <span v-if="it.refill_hint" class="pill-hint">{{ it.refill_hint }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </template>
            <div v-else class="muted">暂无在服用的药</div>
            <div class="addline" @click="onGoingAddMed">＋ 添加用药</div>
          </div>

          <!-- 今日待办 -->
          <div v-else-if="cardKey === 'todos'" class="card" v-longpress="onCardLongPress">
            <div class="sec-title">
              <div class="h"><div class="bar"></div>今日待办</div>
              <div class="more">{{ (state.dashboard.todos || []).length }} 项</div>
            </div>
            <template v-if="(state.dashboard.todos || []).length">
              <div class="todo" v-for="t in state.dashboard.todos" :key="t.id"
                   v-longpress="() => onTodoLongPress(t.id, t.title)">
                <div class="dot" :class="'urgency-' + t.urgency"></div>
                <div class="tx">
                  <div class="t1" :class="{ done: t.is_done }">{{ t.title }}</div>
                  <div class="t2">{{ t.person_name }} · {{ t.urgency_text }}</div>
                </div>
                <div class="todo-act" :class="{ on: t.is_done }"
                     @click.stop="onToggleTodo(t.id)">{{ t.is_done ? '✓' : '' }}</div>
              </div>
            </template>
            <div v-else class="muted">暂无待办</div>
            <div class="addline" @click="onQuick">＋ 添加待办</div>
          </div>

          <!-- 紧急信息卡 -->
          <div v-else-if="cardKey === 'emg'" class="card emg-row"
               v-longpress="onCardLongPress" @click="onEmergency">
            <div class="ic emg-ic">急</div>
            <div class="tx">
              <div class="t1">紧急信息卡</div>
              <div class="t2">血型 · 过敏 · 用药 · 联系人</div>
            </div>
            <div class="go">›</div>
          </div>

          <!-- 快捷操作 -->
          <div v-else-if="cardKey === 'quick'" class="card" v-longpress="onCardLongPress">
            <div class="sec-title"><div class="h"><div class="bar"></div>快捷操作</div></div>
            <div class="quick-grid">
              <div class="quick-item" @click="onQuick">＋ 补记病程</div>
              <div class="quick-item" @click="onTimeline">健康时间线</div>
            </div>
          </div>

        </div>
      </template>

      <div v-if="state.sortMode" class="btn btn-primary btn-block sort-save" @click="onSaveOrder">完成排序</div>
      <div v-else class="sort-hint">长按卡片可调整顺序</div>

      <div class="footer-note">
        本产品为家庭健康信息记录工具，不提供问诊、诊断、用药建议
      </div>
    </template>
  </div>
</template>
