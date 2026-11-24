<script setup>
/** 病程详情（对应 pages/condition） */
import { useRoute } from 'vue-router';
import { usePage } from '../core/page.js';
import * as api from '../core/api.js';
import { toastOk } from '../core/ui.js';
import { push } from '../router/index.js';
import FormSheet from '../components/FormSheet.vue';

const route = useRoute();
const cid = route.query.id || '';

const SEV_MAP = { mild: '轻', moderate: '中', severe: '重' };

const EVENT_FIELDS = [
  { k: 'occurred_date', label: '日期', type: 'date', required: true },
  { k: 'occurred_time', label: '时间（可空）', type: 'text', placeholder: '如 15:30' },
  { k: 'event_type', label: '类型', type: 'chips', required: true,
    options: ['症状', '用药', '备注'], default: '症状' },
  { k: 'text', label: '内容', type: 'text', required: true, placeholder: '如 咳嗽 / 服用 XX / 夜里咳得厉害' },
  { k: 'severity', label: '严重程度', type: 'chips', options: ['轻', '中', '重'] },
  { k: 'temperature', label: '体温（可空）', type: 'number', placeholder: '如 38.2' }
];

const TYPE2API = { '症状': 'symptom', '用药': 'medication', '备注': 'note' };
const SEV2API = { '轻': 'mild', '中': 'moderate', '重': 'severe' };

function describeEvent(ev) {
  const c = ev.content || {};
  if (ev.event_type === 'symptom') {
    let s = (c.symptoms || []).join('、') || '症状';
    if (c.temperature) s += ' · 体温 ' + c.temperature + '℃';
    return s;
  }
  if (ev.event_type === 'medication') return '服用 ' + (c.name || '药');
  if (ev.event_type === 'visit') return '就诊 ' + (c.hospital || '');
  if (ev.event_type === 'exam') return '检查 ' + (c.name || '');
  return c.text || '';
}

function reversType(t) {
  if (t === 'medication') return '用药';
  if (t === 'note') return '备注';
  return '症状';
}

function reversSev(s) {
  return { mild: '轻', moderate: '中', severe: '重' }[s] || '';
}

/** 事件内容 → 可编辑文本 */
function eventText(ev) {
  if (!ev) return '';
  const c = ev.content || {};
  if (ev.event_type === 'symptom') return (c.symptoms || []).join('、');
  if (ev.event_type === 'medication') return c.name || '';
  if (ev.event_type === 'note') return c.text || '';
  if (ev.event_type === 'visit') return c.hospital || '';
  if (ev.event_type === 'exam') return c.name || '';
  return '';
}

/** 时间戳 → 'HH:mm' */
function timeOf(ts) {
  const d = new Date(Number(ts) + 8 * 3600 * 1000);
  const hh = d.getUTCHours(), mm = d.getUTCMinutes();
  if (hh === 0 && mm === 0) return '';
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}

const { state, load } = usePage({
  data: {
    condition: null,
    person: null,
    daily: [],
    events: [],
    summary: null,
    sevMap: SEV_MAP,
    form: { show: false, title: '', fields: EVENT_FIELDS, values: {} },
    editing: null
  },
  fetch: async function () {
    const d = await api.call('condition.detail', { condition_id: cid }, { silent: true });
    return {
      condition: d.condition,
      person: d.person,
      events: d.events || [],
      daily: (d.daily || []).map(function (row) {
        const ev = row.event;
        return {
          date: row.date,
          label: row.label,
          empty: row.empty,
          eventId: ev ? ev.id : '',
          eventType: ev ? ev.event_type : '',
          text: ev ? describeEvent(ev) : '—（无记录）',
          severity: ev && ev.content ? ev.content.severity : '',
          temperature: ev && ev.content ? ev.content.temperature : null,
          isAlert: !!(ev && ev.content && ev.content.severity === 'severe'),
          isBackfilled: ev ? ev.is_backfilled : false
        };
      }),
      summary: d.summary
    };
  }
});

/* ---------- 插入 / 编辑 ---------- */
function onInsert() {
  state.editing = null;
  state.form = {
    show: true, title: '插入一天', fields: EVENT_FIELDS,
    values: { occurred_date: state.condition.start_date, event_type: '症状' }
  };
}

function onEditDay(i) {
  const row = state.daily[i];
  if (row.empty) return onInsert();
  const ev = (state.events || []).filter(function (x) { return x.id === row.eventId; })[0];
  state.editing = row.eventId;
  state.form = {
    show: true, title: '编辑 ' + row.label, fields: EVENT_FIELDS,
    values: {
      occurred_date: row.date,
      occurred_time: ev && ev.occurred_at ? timeOf(ev.occurred_at) : '',
      event_type: reversType(row.eventType),
      // 必须回填：text 是必填项，留空会逼用户把内容重打一遍
      text: eventText(ev),
      severity: reversSev(row.severity),
      temperature: row.temperature || ''
    }
  };
}

async function onFormSubmit(e) {
  const v = e.values;
  const type = TYPE2API[v.event_type] || 'symptom';
  const content = {};
  if (type === 'symptom') {
    content.symptoms = [v.text];
    if (v.severity) content.severity = SEV2API[v.severity];
    if (v.temperature) content.temperature = Number(v.temperature);
  } else if (type === 'medication') {
    content.name = v.text;
  } else {
    content.text = v.text;
  }

  const done = function () {
    state.form.show = false;
    toastOk('已保存');
    load();
  };

  if (state.editing) {
    await api.call('event.update', {
      event_id: state.editing,
      occurred_date: v.occurred_date,
      occurred_time: v.occurred_time || '',
      content: content
    }, { loading: '保存中' });
    return done();
  }

  await api.call('event.add', {
    condition_id: cid,
    occurred_date: v.occurred_date,
    occurred_time: v.occurred_time || '',
    event_type: type,
    content: content
  }, { loading: '保存中' });
  done();
}

function onFormCancel() { state.form.show = false; }

async function onDeleteDay(i) {
  const row = state.daily[i];
  if (row.empty || !row.eventId) return;
  const ok = await api.confirm('删除', '确认删除 ' + row.label + ' 这条记录？');
  if (!ok) return;
  await api.call('event.remove', { event_id: row.eventId });
  toastOk('已删除');
  load();
}

/* ---------- 病程状态 ---------- */
async function onEnd() {
  const ok = await api.confirm('结束病程', '结束后归档进历史，仍可查看。确认结束？');
  if (!ok) return;
  await api.call('condition.end', { condition_id: cid });
  toastOk('已结束并归档');
  load();
}

async function onReopen() {
  await api.call('condition.reopen', { condition_id: cid });
  toastOk('已重新开启');
  load();
}

function onSummary() {
  push('/summary?person_id=' + state.condition.person_id + '&condition_id=' + cid);
}

function genderText(g) {
  return g === 'male' ? '男' : (g === 'female' ? '女' : '—');
}
function sevText(s) {
  return s === 'severe' ? '重' : (s === 'moderate' ? '中' : '轻');
}
</script>

<template>
  <div class="page" :class="{ 'big-mode': state.big }">

    <div v-if="state.loading" class="empty">加载中…</div>

    <template v-else-if="state.error">
      <div class="empty">{{ state.error }}</div>
      <div class="btn btn-primary btn-block" @click="load">重试</div>
    </template>

    <template v-else-if="state.condition">
      <!-- 病程头 -->
      <div class="cond-head">
        <div class="cond-title">
          {{ state.condition.title }}
          <span v-if="state.condition.is_ongoing" class="ongoing-tag">进行中</span>
          <span v-else class="tag tag-grey">已结束</span>
        </div>
        <div class="cond-sub">
          {{ state.person.name }} · {{ genderText(state.person.gender) }} {{ state.person.age }} 岁 · {{ state.person.blood_type }} 型
          <div>{{ state.condition.start_date }} 开始 · {{ state.condition.duration_days }} 天 · {{ state.daily.length }} 条记录</div>
        </div>
      </div>

      <!-- 逐日 -->
      <div class="card">
        <div class="sec-title">
          <div class="h"><div class="bar"></div>逐日记录</div>
          <div class="more">缺记录的天也保留</div>
        </div>

        <div class="day" v-for="(row, i) in state.daily" :key="row.date">
          <div class="day-rail">
            <div class="dot" :class="{ empty: row.empty, alert: row.isAlert }"></div>
            <div class="line"></div>
          </div>
          <div class="day-body">
            <div class="day-date">
              {{ row.label }}
              <span v-if="row.isBackfilled" class="backfill-tag">补记</span>
            </div>
            <div class="day-text" :class="{ 'empty-text': row.empty }">
              {{ row.text }}
              <span v-if="row.severity" class="sev" :class="'sev-' + row.severity">
                {{ sevText(row.severity) }}
              </span>
            </div>
            <div class="day-ops">
              <span class="op" @click="onEditDay(i)">{{ row.empty ? '补充这天' : '编辑' }}</span>
              <span v-if="!row.empty" class="op danger" @click="onDeleteDay(i)">删除</span>
            </div>
          </div>
        </div>

        <div class="addline" @click="onInsert">＋ 插入一天</div>
      </div>

      <!-- 汇总 -->
      <div class="card">
        <div class="kv">
          <div class="k">本次用药</div>
          <div class="v">{{ state.summary ? state.summary.med_summary : '' }}</div>
        </div>
        <div class="kv">
          <div class="k">是否就诊</div>
          <div class="v">{{ state.summary ? state.summary.visited : '' }}</div>
        </div>
        <div class="kv">
          <div class="k">病程状态</div>
          <div class="v">
            {{ state.condition.is_ongoing ? '进行中' : '已结束（' + state.condition.end_date + '）' }}
          </div>
        </div>
      </div>

      <div class="bottom-actions">
        <div class="btn btn-plain flex1" @click="state.condition.is_ongoing ? onEnd() : onReopen()">
          {{ state.condition.is_ongoing ? '结束病程' : '重新开启' }}
        </div>
        <div class="btn btn-primary sum-btn" @click="onSummary">生成医生摘要 →</div>
      </div>
    </template>

    <FormSheet :show="state.form.show" :title="state.form.title"
               :fields="state.form.fields" :values="state.form.values"
               @submit="onFormSubmit" @cancel="onFormCancel" />
  </div>
</template>
