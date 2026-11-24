<script setup>
/** 健康时间线 · 生病/就诊/检查/体检/疫苗 混排（对应 pages/timeline） */
import { ref, onMounted, onUnmounted } from 'vue';
import { usePage } from '../core/page.js';
import * as api from '../core/api.js';
import { push } from '../router/index.js';

const KIND_TABS = [
  { key: 'all', label: '全部' },
  { key: 'condition', label: '生病' },
  { key: 'visit', label: '就诊' },
  { key: 'exam', label: '检查' },
  { key: 'checkup', label: '体检' },
  { key: 'vaccine', label: '疫苗' },
  { key: 'metric', label: '体征' }
];

/** 时间线来源表 → record.* 的类型参数 */
const TABLE2TYPE = {
  medical_record: 'visit',
  exam_report: 'exam',
  vaccine: 'vaccine',
  vital_sign: 'vital'
};

const KIND_SHORT = {
  condition: '病', visit: '诊', exam: '检', checkup: '查', vaccine: '苗', metric: '征'
};

const PAGE_SIZE = 20;

/**
 * 合并相邻的同 key 分组。
 * 后端的分组是按「当前页」现算的，跨页时同一个月会被拆成两段，key 会重复。
 */
function mergeGroups(groups) {
  const out = [];
  (groups || []).forEach(function (g) {
    const last = out[out.length - 1];
    if (last && last.key === g.key) {
      last.items = last.items.concat(g.items || []);
    } else {
      out.push({ key: g.key, label: g.label, items: (g.items || []).slice() });
    }
  });
  return out;
}

/** 给分组里的每条加上跳转所需字段 */
function decorate(groups) {
  return (groups || []).map(function (g) {
    return Object.assign({}, g, {
      items: (g.items || []).map(function (it) {
        return Object.assign({}, it, { rtype: TABLE2TYPE[it.ref_table] || '' });
      })
    });
  });
}

const keywordInput = ref('');

const { state, load } = usePage({
  data: {
    persons: [],
    personId: '',
    kindTabs: KIND_TABS,
    kind: 'all',
    keyword: '',
    groups: [],
    page: 1,
    hasMore: false,
    loadingMore: false,
    total: 0
  },
  fetch: async function () {
    const kinds = state.kind === 'all' ? [] : [state.kind];
    const res = await Promise.all([
      api.call('person.list', {}, { silent: true }),
      api.call('timeline.query', {
        person_id: state.personId || undefined,
        kinds: kinds.length ? kinds : undefined,
        keyword: state.keyword || undefined,
        page: 1,
        size: PAGE_SIZE
      }, { silent: true })
    ]);
    return {
      // 只列出有权限的成员，否则点了会整页变成错误态
      persons: (res[0].persons || []).filter(function (p) { return p.access_level !== 'none'; }),
      groups: mergeGroups(decorate(res[1].groups)),
      page: 1,
      total: res[1].total,
      hasMore: res[1].has_more
    };
  }
});

async function loadMore() {
  if (!state.hasMore || state.loadingMore) return;
  const next = state.page + 1;
  const kinds = state.kind === 'all' ? [] : [state.kind];
  state.loadingMore = true;
  try {
    const r = await api.call('timeline.query', {
      person_id: state.personId || undefined,
      kinds: kinds.length ? kinds : undefined,
      keyword: state.keyword || undefined,
      page: next,
      size: PAGE_SIZE
    }, { silent: true });
    state.groups = mergeGroups(state.groups.concat(decorate(r.groups)));
    state.page = next;
    state.hasMore = r.has_more;
  } catch (e) {
    /* 保持 hasMore，用户可再滑一次重试 */
  }
  state.loadingMore = false;
}

/* 触底加载（对应 onReachBottom） */
function onScroll() {
  const doc = document.documentElement;
  if (doc.scrollHeight - doc.scrollTop - window.innerHeight < 120) loadMore();
}

onMounted(function () { window.addEventListener('scroll', onScroll, { passive: true }); });
onUnmounted(function () { window.removeEventListener('scroll', onScroll); });

/* ---------- 筛选 ---------- */
function onPickPerson(id) {
  state.personId = id || '';
  load();
}

function onPickKind(key) {
  state.kind = key;
  load();
}

function onSearch() {
  const v = (keywordInput.value || '').trim();
  if (v === state.keyword) return;
  state.keyword = v;
  load();
}

function onClearSearch() {
  keywordInput.value = '';
  state.keyword = '';
  load();
}

/* ---------- 跳转 ---------- */
function onEvent(item) {
  if (item.kind === 'condition') {
    push('/condition?id=' + item.ref_id);
  } else {
    push('/record?mode=detail&type=' + item.rtype + '&id=' + item.ref_id);
  }
}

function onAdd() { push('/record'); }
</script>

<template>
  <div class="page" :class="{ 'big-mode': state.big }">

    <!-- 筛选条 -->
    <div class="filters">
      <div class="frow">
        <div class="f" :class="{ on: state.personId === '' }" @click="onPickPerson('')">全部成员</div>
        <div class="f" :class="{ on: state.personId === p.id }"
             v-for="p in state.persons" :key="p.id"
             @click="onPickPerson(p.id)">{{ p.name }}</div>
      </div>
      <div class="frow">
        <div class="f" :class="{ on: state.kind === t.key }"
             v-for="t in state.kindTabs" :key="t.key"
             @click="onPickKind(t.key)">{{ t.label }}</div>
      </div>
      <div class="searchwrap">
        <div class="search">
          <span class="search-ic">🔍</span>
          <input placeholder="搜索症状、医院、检查项目"
                 v-model="keywordInput"
                 @keyup.enter="onSearch"
                 @blur="onSearch" />
          <span v-if="keywordInput" class="search-clear" @click="onClearSearch">✕</span>
        </div>
      </div>
    </div>

    <!-- 内容 -->
    <div v-if="state.loading" class="empty">加载中…</div>

    <template v-else-if="state.needFamily">
      <div class="empty">还没有家庭，先去「我的」创建</div>
    </template>

    <template v-else-if="state.error">
      <div class="empty">{{ state.error }}</div>
      <div class="btn btn-primary btn-block" @click="load">重试</div>
    </template>

    <template v-else>
      <template v-if="state.groups.length">
        <div v-for="group in state.groups" :key="group.key">
          <div class="tl-month" :class="{ 'ongoing-label': group.key === 'ongoing' }">{{ group.label }}</div>
          <div class="tl">
            <div class="ev" :class="{ on: item.is_ongoing }"
                 v-for="item in group.items" :key="item.ref_id"
                 @click="onEvent(item)">
              <div class="badge" :class="'kind-' + item.kind">{{ KIND_SHORT[item.kind] }}</div>
              <div class="body">
                <div class="r1">
                  <span class="ev-title">{{ item.title }}</span>
                  <span v-if="item.is_ongoing" class="ongoing-tag">进行中</span>
                </div>
                <div class="r2">{{ item.subtitle }} · {{ item.occurred_label }}</div>
              </div>
              <div class="arrow">›</div>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="empty">
        <span v-if="state.keyword">没有匹配「{{ state.keyword }}」的记录</span>
        <span v-else>该筛选下暂无记录</span>
        <div class="muted">点右下 ＋ 可以补记一条</div>
      </div>

      <div v-if="state.loadingMore" class="loading-more">加载中…</div>
      <div v-else-if="state.groups.length && !state.hasMore" class="loading-more">共 {{ state.total }} 条记录</div>
    </template>

    <!-- 悬浮新增 -->
    <div class="fab" @click="onAdd">＋</div>
  </div>
</template>
