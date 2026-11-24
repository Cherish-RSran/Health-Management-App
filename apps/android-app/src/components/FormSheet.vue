<script setup>
/**
 * 通用表单弹层 —— 对应小程序 components/form-sheet
 *
 * fields: [{ k, label, type, options, placeholder, hint, required }]
 *   type: text | textarea | number | date | chips（单选）| multi（多选）
 * 用法与小程序一致：
 *   <form-sheet :show="form.show" title="..." :fields="form.fields" :values="form.values"
 *               @submit="onFormSubmit" @cancel="onFormCancel" />
 */
import { ref, watch } from 'vue';
import { toast } from '../core/ui.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  tip: { type: String, default: '' },
  submitText: { type: String, default: '保存' },
  fields: { type: Array, default: function () { return []; } },
  values: { type: Object, default: function () { return {}; } }
});

const emit = defineEmits(['submit', 'cancel']);

const v = ref({});

// 只在「打开」的瞬间同步一次初值。
// 若持续跟 values 同步，父级任何一次 setState 都会把用户正在输入的内容冲掉。
watch(function () { return props.show; }, function (show) {
  if (show) v.value = Object.assign({}, props.values || {});
});

function setVal(k, val) {
  v.value = Object.assign({}, v.value, { [k]: val });
}

function onChip(f, opt) {
  if (f.type === 'multi') {
    const arr = (v.value[f.k] || []).slice();
    const i = arr.indexOf(opt);
    if (i >= 0) arr.splice(i, 1); else arr.push(opt);
    return setVal(f.k, arr);
  }
  setVal(f.k, v.value[f.k] === opt ? '' : opt);
}

function isOn(f, opt) {
  if (f.type === 'multi') {
    const arr = v.value[f.k] || [];
    return arr.indexOf(opt) >= 0;
  }
  return v.value[f.k] === opt;
}

function onSubmit() {
  const fields = props.fields || [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f.required) continue;
    const val = v.value[f.k];
    const empty = val === undefined || val === null || val === ''
      || (Array.isArray(val) && !val.length);
    if (empty) {
      toast('请填写：' + (f.label || f.k));
      return;
    }
  }
  emit('submit', { values: Object.assign({}, v.value) });
}

function onCancel() { emit('cancel'); }
</script>

<template>
  <div v-if="show" class="mask" @click="onCancel">
    <div class="sheet" @click.stop>
      <div class="hd">
        <div class="hd-title">{{ title }}</div>
        <div class="hd-close" @click="onCancel">✕</div>
      </div>

      <div class="bd">
        <div v-if="tip" class="tip">{{ tip }}</div>

        <div class="fld" v-for="f in fields" :key="f.k">
          <div class="label">{{ f.label }}<span v-if="f.required" class="req">*</span></div>

          <!-- 文本 -->
          <input v-if="f.type === 'text' || f.type === 'number' || !f.type"
                 class="input"
                 :type="f.type === 'number' ? 'number' : 'text'"
                 :placeholder="f.placeholder"
                 :value="v[f.k]"
                 @input="setVal(f.k, $event.target.value)" />

          <!-- 多行 -->
          <textarea v-else-if="f.type === 'textarea'" class="textarea"
                    :placeholder="f.placeholder"
                    :value="v[f.k]"
                    @input="setVal(f.k, $event.target.value)"></textarea>

          <!-- 日期 -->
          <div v-else-if="f.type === 'date'" class="date-row">
            <input class="picker flex1" type="date"
                   :value="v[f.k] || ''"
                   @change="setVal(f.k, $event.target.value)" />
            <div v-if="v[f.k]" class="date-clear" @click="setVal(f.k, '')">清空</div>
          </div>

          <!-- 单选 / 多选 -->
          <div v-else class="chips">
            <div v-for="opt in (f.options || [])" :key="opt"
                 class="chip" :class="{ on: isOn(f, opt) }"
                 @click="onChip(f, opt)">{{ opt }}</div>
          </div>

          <div v-if="f.hint" class="hint">{{ f.hint }}</div>
        </div>
      </div>

      <div class="ft">
        <div class="btn btn-ghost flex1" @click="onCancel">取消</div>
        <div class="btn btn-primary ft-submit" @click="onSubmit">{{ submitText }}</div>
      </div>
    </div>
  </div>
</template>
