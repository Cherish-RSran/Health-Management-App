<script setup>
/** 家人 · 档案列表（对应 pages/family） */
import { usePage } from '../core/page.js';
import * as api from '../core/api.js';
import { toast, setClipboard } from '../core/ui.js';
import { push, switchTab } from '../router/index.js';

const { state, load } = usePage({
  data: { persons: [], family: null, pending: [], isAdmin: false },
  fetch: async function () {
    const res = await Promise.all([
      api.call('person.list', {}, { silent: true }),
      api.call('family.members', {}, { silent: true })
    ]);
    return {
      persons: (res[0].persons || []),
      family: res[1].family,
      pending: res[1].pending || [],
      isAdmin: res[1].is_admin
    };
  }
});

function onPerson(id) { push('/person?id=' + id); }
function onAdd() { push('/person?new=1'); }
function onGoMe() { switchTab('/me'); }

async function onCopyCode() {
  const code = state.family && state.family.invite_code;
  if (!code) return toast('仅管理员可查看邀请码');
  const ok = await setClipboard(code);
  toast(ok ? '邀请码已复制' : '复制失败');
}

function genderText(g) {
  return g === 'male' ? '男' : (g === 'female' ? '女' : '—');
}
</script>

<template>
  <div class="page" :class="{ 'big-mode': state.big }">

    <div v-if="state.loading" class="empty">加载中…</div>

    <template v-else-if="state.needFamily">
      <div class="empty">还没有家庭，先去「我的」创建</div>
    </template>

    <template v-else-if="state.error">
      <div class="empty">{{ state.error }}</div>
      <div class="btn btn-primary btn-block" @click="load">重试</div>
    </template>

    <template v-else>
      <div class="tip">
        每份档案的可见性由 person_access 决定。
        <span class="tip-em">代管档案须归属人本人授权。</span>
      </div>

      <!-- 待审批提醒 -->
      <div v-if="state.pending.length" class="card card-flat notice" @click="onGoMe">
        <div class="row">
          <div class="ic" style="background:#FEF3C7;color:#B45309">待</div>
          <div class="tx">
            <div class="t1">有 {{ state.pending.length }} 位成员待审批</div>
            <div class="t2">去「我的 → 家庭管理」处理</div>
          </div>
          <div class="go">›</div>
        </div>
      </div>

      <!-- 档案卡片 -->
      <div class="pcard" v-for="p in state.persons" :key="p.id" @click="onPerson(p.id)">
        <div class="pcard-avatar" :class="p.profile_type === 'self' ? 'self' : 'managed'">
          {{ p.relation || p.name }}
        </div>
        <div class="pcard-body">
          <div class="pcard-name">
            {{ p.name }}
            <span class="tag" :class="p.profile_type === 'self' ? 'tag-md' : 'tag-short'">
              {{ p.profile_type === 'self' ? '本人' : '代管' }}
            </span>
            <span v-if="p.access_level === 'none'" class="tag tag-grey">无权限</span>
          </div>
          <div class="pcard-sub">
            {{ genderText(p.gender) }}
            <span v-if="p.age || p.age === 0"> · {{ p.age }} 岁</span>
            <span v-if="p.blood_type"> · {{ p.blood_type }} 型</span>
          </div>
        </div>
        <div class="arrow">›</div>
      </div>

      <div v-if="!state.persons.length" class="empty">
        还没有档案
        <div class="muted">先给自己或家人建一份</div>
      </div>

      <div class="btn btn-primary btn-block" @click="onAdd">＋ 添加家庭成员</div>
      <div class="footer-note">本产品不提供问诊、诊断、用药建议</div>
    </template>
  </div>
</template>
