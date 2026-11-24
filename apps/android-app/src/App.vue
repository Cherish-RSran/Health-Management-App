<script setup>
/**
 * 应用外壳
 *  - 顶部导航栏：tab 页不显示（小程序里 tab 页没有返回键）
 *  - 底部 tabBar：只在 4 个 tab 页显示
 *  - 全局 toast / loading / modal / actionSheet：对应微信的原生组件
 *  - 安卓返回键：交给路由回退，栈顶时退出应用
 */
import { onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import TabBar from './components/TabBar.vue';
import { ui } from './core/ui.js';
import { setting, bootstrap } from './core/session.js';
import { isTabPath } from './router/index.js';

const route = useRoute();

const isTab = computed(function () { return isTabPath(route.path); });
const big = computed(function () { return !!(setting.value && setting.value.large_font); });
const title = computed(function () { return route.meta.title || ''; });

function goBack() {
  if (isTab.value) return;
  if (window.history.length > 1) window.history.back();
  else window.location.hash = '#/home';
}

/* 安卓物理返回键 */
onMounted(async function () {
  bootstrap();

  // Android 15 起，targetSdk 35 会强制 edge-to-edge：状态栏变透明、内容延伸到它下面，
  // 页面顶部的导航栏会被盖住。关掉 overlay 让 WebView 回到状态栏下方，与小程序一致。
  try {
    const mod = await import('@capacitor/status-bar');
    const StatusBar = mod.StatusBar || mod.default;
    if (StatusBar && StatusBar.setOverlaysWebView) {
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch (e) {
    /* 浏览器预览时没有这个插件，忽略 */
  }
  try {
    const mod = await import('@capacitor/app');
    const App = mod.App || mod.default;
    if (App && App.addListener) {
      App.addListener('backButton', function () {
        if (isTab.value && route.path === '/home') {
          App.exitApp && App.exitApp();
        } else {
          goBack();
        }
      });
    }
  } catch (e) {
    document.addEventListener('backbutton', function () { goBack(); }, false);
  }
});

/* 弹窗输入值的本地副本 */
const modalValue = computed({
  get: function () { return ui.modal ? ui.modal.value : ''; },
  set: function (val) { if (ui.modal) ui.modal.value = val; }
});

function modalOk() {
  if (!ui.modal) return;
  if (ui.modal.editable) ui.modal.resolve((ui.modal.value || '').trim() || null);
  else ui.modal.resolve(true);
}

function modalCancel() {
  if (!ui.modal) return;
  ui.modal.resolve(ui.modal.editable ? null : false);
}

function sheetPick(i) {
  if (!ui.sheet) return;
  ui.sheet.resolve(i);
}

watch(function () { return route.fullPath; }, function () {
  // 路由变化时关掉可能还开着的弹层，避免跨页残留
  if (ui.sheet) ui.sheet.resolve(-1);
  if (ui.modal) ui.modal.resolve(ui.modal.editable ? null : false);
});
</script>

<template>
  <div class="app-root" :class="{ 'big-mode': big }">
    <div class="app-main" :class="{ 'has-tabbar': isTab }">
      <div v-if="!isTab" class="navbar">
        <div class="back" @click="goBack">‹</div>
        <div class="title">{{ title }}</div>
        <div class="right"></div>
      </div>
      <!-- key 用 fullPath：小程序里每次 navigateTo / redirectTo 都是「新建一个页面」，
           同路由不同参数（如 /person?new=1 → /person?id=xx）必须重建，
           否则组件被复用，弹层、表单初值这些状态会残留 -->
      <router-view :key="route.fullPath" />
    </div>

    <TabBar v-if="isTab" />

    <!-- 轻提示 -->
    <div v-if="ui.toast.show" class="toast">
      <span v-if="ui.toast.icon === 'ok'" class="ok">✓</span>{{ ui.toast.text }}
    </div>

    <!-- 全屏 loading -->
    <div v-if="ui.loading.show" class="loading-mask">
      <div class="loading-box">
        <span class="spin"></span>{{ ui.loading.text }}
      </div>
    </div>

    <!-- 确认框 / 输入框 -->
    <div v-if="ui.modal" class="modal-mask" @click.self="modalCancel">
      <div class="modal">
        <div class="m-title">{{ ui.modal.title }}</div>
        <div v-if="ui.modal.content" class="m-content">{{ ui.modal.content }}</div>
        <input v-if="ui.modal.editable"
               class="m-input"
               v-model="modalValue"
               :placeholder="ui.modal.placeholder || ''" />
        <div class="m-ft">
          <div v-if="ui.modal.showCancel" @click="modalCancel">{{ ui.modal.cancelText }}</div>
          <div class="ok" @click="modalOk">{{ ui.modal.confirmText }}</div>
        </div>
      </div>
    </div>

    <!-- 动作菜单 -->
    <div v-if="ui.sheet" class="sheet-mask" @click.self="sheetPick(-1)">
      <div class="action-sheet">
        <div v-if="ui.sheet.title" class="as-head">{{ ui.sheet.title }}</div>
        <div v-for="(it, i) in ui.sheet.items" :key="i"
             class="as-item" @click="sheetPick(i)">{{ it }}</div>
        <div class="as-cancel" @click="sheetPick(-1)">取消</div>
      </div>
    </div>
  </div>
</template>
