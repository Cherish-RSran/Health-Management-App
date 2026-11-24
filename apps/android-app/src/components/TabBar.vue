<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const TABS = [
  { path: '/home', text: '首页', icon: '🏠' },
  { path: '/timeline', text: '健康时间线', icon: '🕒' },
  { path: '/family', text: '家人', icon: '👨‍👩‍👧' },
  { path: '/me', text: '我的', icon: '我' }
];

const current = computed(function () { return route.path; });

function go(path) {
  if (path === current.value) return;
  router.replace(path);
}
</script>

<template>
  <div class="tabbar">
    <div v-for="t in TABS" :key="t.path"
         class="item" :class="{ on: current === t.path }"
         @click="go(t.path)">
      <div class="ico">{{ t.icon }}</div>
      <div>{{ t.text }}</div>
    </div>
  </div>
</template>
