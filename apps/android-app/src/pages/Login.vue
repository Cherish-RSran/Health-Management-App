<script setup>
/**
 * 登录 / 注册
 *
 * 小程序没有这一页 —— 微信 openid 免登。安卓版没有微信身份，
 * 所以要自己建账号；登录后拿到的 token 由内核换成 user_id（见 lib/app.js）。
 *
 * 另外给了一条「仅本机使用」：不注册也能用，数据只落在这台机器上、不联网。
 */
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  loginByPassword, register, bootstrap, resetSession, markGuest
} from '../core/session.js';
import { toastOk } from '../core/api.js';

const route = useRoute();
const router = useRouter();

const mode = ref('login');
const phone = ref('');
const password = ref('');
const nickname = ref('');
const err = ref('');
const busy = ref(false);

const isReg = computed(function () { return mode.value === 'register'; });

function switchMode(m) {
  mode.value = m;
  err.value = '';
}

function check() {
  if (!/^1[3-9]\d{9}$/.test(phone.value.trim())) {
    err.value = '请填写 11 位手机号';
    return false;
  }
  if (password.value.length < 6) {
    err.value = '密码至少 6 位';
    return false;
  }
  if (/^\d+$/.test(password.value)) {
    err.value = '密码不能全是数字';
    return false;
  }
  err.value = '';
  return true;
}

async function submit() {
  if (busy.value) return;
  if (!check()) return;
  busy.value = true;
  try {
    if (isReg.value) {
      await register(phone.value.trim(), password.value, nickname.value.trim());
      toastOk('注册成功');
    } else {
      await loginByPassword(phone.value.trim(), password.value);
      toastOk('登录成功');
    }
    const to = (route.query && route.query.redirect) || '/home';
    resetSession();
    await bootstrap();
    router.replace(to);
  } catch (e) {
    // api.call 已经弹过 toast，这里只把错误留在页面上看得见
    err.value = (e && e.message) || '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}

async function useLocalOnly() {
  markGuest();
  resetSession();
  await bootstrap();
  router.replace('/home');
}
</script>

<template>
  <div class="page">
    <div class="login-wrap">
      <div class="lg-logo">🏥</div>
      <div class="lg-title">家庭健康档案</div>
      <div class="lg-sub">
        记录家人档案与病程，就诊时给医生看提炼摘要。<br />
        本产品为信息记录工具，不提供问诊、诊断、用药建议。
      </div>
    </div>

    <div class="lg-tabs">
      <div class="lg-tab" :class="{ on: !isReg }" @click="switchMode('login')">登录</div>
      <div class="lg-tab" :class="{ on: isReg }" @click="switchMode('register')">注册</div>
    </div>

    <div v-if="err" class="lg-err">{{ err }}</div>

    <div class="card" style="margin-top:0">
      <div class="lg-fld">
        <div class="lg-label">手机号</div>
        <input v-model="phone" type="tel" inputmode="numeric"
               maxlength="11" placeholder="11 位手机号" />
      </div>
      <div class="lg-fld">
        <div class="lg-label">密码</div>
        <input v-model="password" type="password"
               maxlength="64" placeholder="至少 6 位，不能全是数字" />
      </div>
      <div v-if="isReg" class="lg-fld">
        <div class="lg-label">昵称（可留空）</div>
        <input v-model="nickname" type="text" maxlength="30" placeholder="如 用户A" />
        <div class="lg-hint">手机号加密存储；用它登录可以在别的设备上继续用同一份档案。</div>
      </div>
    </div>

    <div class="btn btn-primary btn-block" :class="{ 'btn-disabled': busy }" @click="submit">
      {{ isReg ? '注册并进入' : '登录' }}
    </div>

    <div class="lg-guest" @click="useLocalOnly">跳过，仅本机使用 ›</div>

    <div class="footer-note">
      不注册也能用：数据只存在这台手机上，卸载会一起清掉。
    </div>
  </div>
</template>
