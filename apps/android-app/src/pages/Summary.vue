<script setup>
/** 医生摘要（对应 pages/summary） */
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { usePage } from '../core/page.js';
import * as api from '../core/api.js';
import { toast, toastOk, setClipboard, actionSheet } from '../core/ui.js';

const route = useRoute();
const pid = route.query.person_id || '';
const cid = route.query.condition_id || '';
const canvasRef = ref(null);

const OPT_META = [
  { k: 'surgery', label: '手术史' },
  { k: 'history', label: '相关历史病程' },
  { k: 'exam', label: '近期检查报告' },
  { k: 'metric', label: '近期体征' }
];

const { state, load } = usePage({
  autoLoad: false,
  data: {
    person: null,
    summary: null,
    availability: {},
    options: { surgery: true, history: true, exam: true, metric: true },
    optMeta: OPT_META,
    mode: 'config',
    generating: false
  },
  fetch: async function () {
    const o = await api.call('summary.options', {}, { silent: true });
    state.options = o.options;
    return build(o.options);
  }
});

onMounted(function () { load(); });

async function build(options) {
  const d = await api.call('summary.build', {
    person_id: pid,
    condition_id: cid || undefined,
    options: options
  }, { silent: true });
  return {
    summary: d.summary,
    availability: d.availability || {},
    options: d.options,
    person: { id: pid }
  };
}

async function onToggleOption(k) {
  const options = Object.assign({}, state.options);
  options[k] = !options[k];
  state.options = options;
  state.generating = true;
  try {
    Object.assign(state, await build(options));
  } catch (e) {
    /* 保留上一次生成的摘要 */
  }
  state.generating = false;
}

function onShowDoctor() {
  if (!state.summary) return;
  state.mode = 'doctor';
}

function onExitDoctor() { state.mode = 'config'; }

async function onExport() {
  const s = state.summary;
  if (!s) return;
  const idx = await actionSheet(['复制文本', '保存为图片'], '导出 / 分享');
  if (idx === 0) return doExportText();
  if (idx === 1) return doExportImage();
}

function doExportText() {
  const s = state.summary;
  if (!s) return;
  const lines = [];
  lines.push('【本次就诊摘要】' + s.header.name + ' · ' + s.header.sex + ' ' + (s.header.age === null ? '' : s.header.age + ' 岁')
    + (s.header.blood_type ? ' · ' + s.header.blood_type + ' 型' : ''));
  lines.push('────────────');
  s.blocks.forEach(function (b) {
    const text = b.items.length ? b.items.map(function (i) { return i.text; }).join('、') : (b.empty_text || '无');
    lines.push(b.label + '：' + text);
  });
  setClipboard(lines.join('\n')).then(function (ok) {
    toast(ok ? '摘要已复制，可粘贴发给医生' : '复制失败');
  });
}

/** 保存为图片（HTML5 canvas 绘制摘要卡片，离线下载到本机） */
function doExportImage() {
  const s = state.summary;
  if (!s) return;
  const canvas = canvasRef.value;
  if (!canvas) return doExportText();
  const ctx = canvas.getContext('2d');
  const W = 640;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 2;
  canvas.width = W * dpr;

  const rows = [{ label: '姓名', text: s.header.name + ' · ' + s.header.sex
    + (s.header.age === null ? '' : ' ' + s.header.age + ' 岁')
    + (s.header.blood_type ? ' ' + s.header.blood_type + ' 型' : '') }];
  s.blocks.forEach(function (b) {
    const text = b.items.length ? b.items.map(function (i) { return i.text; }).join('、') : (b.empty_text || '无');
    rows.push({ label: b.label, text: text, danger: b.emphasis });
  });

  const pad = 28 * dpr;
  const lh = 30 * dpr;
  const labelH = 26 * dpr;
  let y = pad;
  let maxH = pad;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, 4000 * dpr);
  ctx.fillStyle = '#0E9F6E';
  ctx.font = '600 ' + (20 * dpr) + 'px sans-serif';
  ctx.fillText('本次就诊摘要 · 家庭健康档案', pad, y + 18 * dpr);
  y += 40 * dpr;

  rows.forEach(function (r) {
    ctx.fillStyle = r.danger ? '#C2410C' : '#6B7280';
    ctx.font = '600 ' + (16 * dpr) + 'px sans-serif';
    ctx.fillText(r.label, pad, y + 14 * dpr);
    y += labelH;
    ctx.fillStyle = '#16191F';
    ctx.font = (15 * dpr) + 'px sans-serif';
    const text = clip(ctx, r.text, canvas.width - pad * 2, 15 * dpr);
    ctx.fillText(text, pad, y + 14 * dpr);
    y += lh;
    maxH = y + pad;
  });

  canvas.height = maxH;

  canvas.toBlob(function (blob) {
    if (!blob) return doExportText();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (s.header.name || '家人') + '_就诊摘要.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toastOk('已保存为图片');
  }, 'image/png');

  function clip(c, str, maxW, px) {
    if (c.measureText(str).width <= maxW) return str;
    let out = str;
    while (out.length > 1 && c.measureText(out + '…').width > maxW) out = out.slice(0, -1);
    return out + '…';
  }
}
</script>

<template>
  <div class="page" :class="{ 'big-mode': state.big }">

    <div v-if="state.loading" class="empty">加载中…</div>

    <template v-else-if="state.error">
      <div class="empty">{{ state.error }}</div>
      <div class="btn btn-primary btn-block" @click="load">重试</div>
    </template>

    <!-- ============ 配置视图 ============ -->
    <template v-else-if="state.mode === 'config' && state.summary">
      <div class="card auto-card">
        <div class="auto-title">自动必带（不可取消）</div>
        <div class="auto-body">
          过敏史 · 基础病 · 长期用药 · 年龄性别血型 · 本次病程与本次用药
        </div>
      </div>

      <div class="card">
        <div class="sec-title">
          <div class="h"><div class="bar"></div>可选择加入</div>
          <div class="more">{{ state.generating ? '生成中…' : '可随时调整' }}</div>
        </div>
        <div class="row" v-for="o in state.optMeta" :key="o.k" @click="onToggleOption(o.k)">
          <div class="ic" :style="{ background: state.options[o.k] ? '#E7F6F0' : '#F2F5F8', color: state.options[o.k] ? '#0B8057' : '#9CA3AF' }">
            {{ state.options[o.k] ? '✓' : '' }}
          </div>
          <div class="tx">
            <div class="t1">{{ o.label }}</div>
            <div class="t2">{{ state.availability[o.k] ? '有数据可加入' : '暂无数据' }}</div>
          </div>
          <div class="switch" :class="{ on: state.options[o.k] }"><div class="knob"></div></div>
        </div>
      </div>

      <!-- 摘要预览 -->
      <div class="card preview">
        <div class="sec-title"><div class="h"><div class="bar"></div>摘要预览</div></div>
        <div class="pv-head">
          <div class="pv-name">{{ state.summary.header.name }}</div>
          <div class="pv-meta">
            {{ state.summary.header.sex }}
            <span v-if="state.summary.header.age || state.summary.header.age === 0"> · {{ state.summary.header.age }} 岁</span>
            <span v-if="state.summary.header.blood_type"> · {{ state.summary.header.blood_type }} 型</span>
          </div>
        </div>
        <div class="pv-block" :class="{ 'pv-danger': b.emphasis }"
             v-for="b in state.summary.blocks" :key="b.key">
          <div class="pv-label">{{ b.label }}</div>
          <div class="pv-text">
            <template v-if="b.items.length">
              <div v-for="it in b.items" :key="it.text">{{ it.text }}</div>
            </template>
            <template v-else>{{ b.empty_text }}</template>
          </div>
        </div>
      </div>

      <div class="bottom-actions">
        <div class="btn btn-ghost flex1" @click="onExport">导出 / 分享</div>
        <div class="btn btn-primary sum-btn" @click="onShowDoctor">全屏出示 →</div>
      </div>
    </template>

    <!-- ============ 全屏医生模式 ============ -->
    <div v-else-if="state.mode === 'doctor'" class="doctor">
      <div class="doc-head">
        <div class="doc-tag">本次就诊摘要</div>
        <div class="doc-name">{{ state.summary.header.name }}</div>
        <div class="doc-meta">
          {{ state.summary.header.sex }}
          <span v-if="state.summary.header.age || state.summary.header.age === 0"> · {{ state.summary.header.age }} 岁</span>
          <span v-if="state.summary.header.blood_type"> · {{ state.summary.header.blood_type }} 型</span>
        </div>
        <div class="doc-time">由家庭健康档案生成</div>
      </div>

      <div class="doc-body">
        <div class="dsec" :class="{ allergy: b.emphasis }"
             v-for="b in state.summary.blocks" :key="b.key">
          <div class="dsec-label">{{ b.emphasis ? '⚠ ' : '' }}{{ b.label }}</div>
          <div class="dsec-text">
            <template v-if="b.items.length">
              <div v-for="it in b.items" :key="it.text">{{ it.text }}</div>
            </template>
            <template v-else>{{ b.empty_text }}</template>
          </div>
        </div>
        <div class="doc-note">本摘要由家庭自填记录整理，非医疗机构出具</div>
      </div>

      <div class="doc-foot">
        <div class="btn btn-ghost flex1" @click="onExitDoctor">返回</div>
        <div class="btn btn-plain flex1 ml20" @click="onExport">导出 / 分享</div>
      </div>
    </div>

    <!-- 离屏画布：仅供「保存为图片」导出摘要卡片使用 -->
    <canvas ref="canvasRef" class="export-canvas"></canvas>
  </div>
</template>

<style scoped>
.export-canvas {
  position: fixed;
  left: -9999px;
  top: 0;
  width: 640px;
  height: 200px;
}
</style>
