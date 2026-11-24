<script setup>
/** 记录：补记 / 就诊 / 检查 / 疫苗 / 待办 / 详情（对应 pages/record） */
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { usePage } from '../core/page.js';
import * as api from '../core/api.js';
import { toast, toastOk, actionSheet } from '../core/ui.js';
import { back } from '../router/index.js';
import D from '../core/date.js';
import C from '../core/constants.js';
import FormSheet from '../components/FormSheet.vue';

const route = useRoute();

const SYMPTOMS = ['咳嗽', '发热', '腹泻', '咽痛', '头痛', '皮疹', '其他'];

/** 指标标签 → 后端枚举值（form 里用中文标签，提交时转回 key） */
const METRIC_RMAP = {
  '血压': 'blood_pressure', '血糖': 'blood_glucose', '体重': 'weight',
  '体温': 'temperature', '其他': 'other'
};

/* ---------- 各模式的表单定义 ---------- */
const FORMS = {
  visit: {
    title: '记录就诊', submitText: '保存',
    fields: [
      { k: 'date', label: '就诊日期', type: 'date', required: true },
      { k: 'hospital', label: '医院', type: 'text', required: true, placeholder: '如 市第一人民医院' },
      { k: 'department', label: '科室', type: 'text', placeholder: '如 呼吸内科' },
      { k: 'visit_type', label: '就诊类型', type: 'chips', options: ['门诊', '急诊', '住院', '复诊'], default: '门诊' },
      { k: 'doctor', label: '医生（可空）', type: 'text' },
      { k: 'diagnosis', label: '医生记录（照抄医生原话）', type: 'textarea',
        placeholder: '系统不会自动生成任何诊断，此处只记录医生说的话' },
      { k: 'advice', label: '医嘱（可空）', type: 'text' }
    ],
    toPayload: function (v) {
      return {
        date: v.date, hospital: v.hospital, department: v.department || '',
        visit_type: { '门诊': 'outpatient', '急诊': 'emergency', '住院': 'inpatient', '复诊': 'followup' }[v.visit_type] || 'outpatient',
        doctor: v.doctor || '', diagnosis: v.diagnosis || '', advice: v.advice || ''
      };
    }
  },
  exam: {
    title: '记录检查 / 体检', submitText: '保存',
    fields: [
      { k: 'report_type', label: '报告类型', type: 'chips', required: true, options: ['化验', '影像', '体检', '其他'],
        default: '化验', hint: '类型决定它在时间线上显示为「检查」还是「体检」' },
      { k: 'name', label: '项目名称', type: 'text', required: true, placeholder: '如 血常规 / 胸部 CT / 年度体检' },
      { k: 'date', label: '检查日期', type: 'date', required: true },
      { k: 'hospital', label: '医院 / 机构', type: 'text' },
      { k: 'summary', label: '结论摘要（可空）', type: 'textarea' }
    ],
    toPayload: function (v) {
      return {
        report_type: { '化验': 'lab', '影像': 'imaging', '体检': 'checkup', '其他': 'other' }[v.report_type] || 'other',
        name: v.name, date: v.date, hospital: v.hospital || '', summary: v.summary || ''
      };
    }
  },
  vital: {
    title: '记录体征', submitText: '保存',
    fields: [
      { k: 'metric_type', label: '指标类型', type: 'chips', required: true, options: ['血压', '血糖', '体重', '体温', '其他'], default: '血压' },
      { k: 'value', label: '测量值', type: 'text', required: true, placeholder: '如 120/80（血压）或 6.1（血糖）' },
      { k: 'unit', label: '单位（可空）', type: 'text', placeholder: '如 mmHg / kg / ℃' },
      { k: 'date', label: '测量日期', type: 'date', required: true },
      { k: 'note', label: '备注（可空）', type: 'textarea', placeholder: '如 餐后 2 小时 / 静息' }
    ],
    toPayload: function (v) {
      return {
        metric_type: METRIC_RMAP[v.metric_type] || 'other',
        value: v.value, unit: v.unit || '', date: v.date, note: v.note || ''
      };
    }
  },
  vaccine: {
    title: '记录疫苗', submitText: '保存',
    fields: [
      { k: 'name', label: '疫苗名称', type: 'text', required: true, placeholder: '如 流感疫苗' },
      { k: 'dose_no', label: '针次', type: 'chips', options: ['第 1 针', '第 2 针', '第 3 针', '加强针'], default: '第 1 针' },
      { k: 'date', label: '接种日期', type: 'date', required: true },
      { k: 'institution', label: '接种机构', type: 'text' },
      { k: 'next_date', label: '下一针日期（可空）', type: 'date', hint: '填写后会自动生成一条待办' }
    ],
    toPayload: function (v) {
      return {
        name: v.name,
        dose_no: { '第 1 针': 1, '第 2 针': 2, '第 3 针': 3, '加强针': 4 }[v.dose_no] || 1,
        date: v.date, institution: v.institution || '', next_date: v.next_date || ''
      };
    }
  },
  todo: {
    title: '添加待办', submitText: '保存',
    api: 'todo.add',                       // 待办走 todo.add，不是 record.add
    tip: '一期无推送，待办只在首页站内展示。',
    fields: [
      { k: 'type', label: '类型', type: 'chips', required: true, options: ['复查', '疫苗', '体检', '自定义'], default: '复查' },
      { k: 'title', label: '事项', type: 'text', required: true, placeholder: '如 呼吸内科复查' },
      { k: 'due_date', label: '日期', type: 'date', required: true },
      { k: 'note', label: '备注（可空）', type: 'text' }
    ],
    toPayload: function (v) {
      return {
        type: { '复查': 'recheck', '疫苗': 'vaccine', '体检': 'exam', '自定义': 'custom' }[v.type] || 'custom',
        title: v.title, due_date: v.due_date, note: v.note || ''
      };
    }
  }
};

const mode = route.query.mode || '';

const { state } = usePage({
  autoLoad: false,
  data: {
    mode: mode,
    // 补记流程
    rec: { step: 1, person_id: '', title: '', start_date: '', days: [], ended: null },
    symptoms: SYMPTOMS,
    persons: [],
    recDays: [],
    // 通用表单
    form: { show: false, title: '', tip: '', submitText: '保存', fields: [], values: {} },
    formMode: '',
    // 详情模式
    detail: null,
    detailType: '',
    noteDraft: ''
  },
  fetch: async function () { return {}; }
});

onMounted(function () {
  if (mode === 'detail') {
    loadDetail(route.query.type, route.query.id);
    return;
  }
  if (FORMS[mode]) {
    openModeForm(mode);
    return;
  }
  initBackfill();
});

/* ================= 补记（3 步） ================= */
async function initBackfill() {
  const today = D.todayStr();
  try {
    const d = await api.call('person.list', {}, { silent: true });
    const persons = (d.persons || []).filter(function (p) { return p.access_level !== 'none'; });
    state.loading = false;
    state.ready = true;
    state.persons = persons;
    state.rec = {
      step: 1,
      person_id: persons.length ? persons[0].id : '',
      title: '',
      start_date: D.addDays(today, -1),
      days: [{ d: D.fmtMD(today), date: today, s: '', m: '' }],
      ended: null
    };
    if (!persons.length) toast('还没有可记录的档案');
  } catch (e) {
    state.loading = false;
    state.ready = true;
    state.error = e.message;
  }
}

function onPickPerson(id) { state.rec.person_id = id; }
function onPickSymptom(v) { state.rec.title = v; }
function onStartDate(e) { state.rec.start_date = e.target.value; }

function onDayInput(i, k, e) {
  state.rec.days[i][k] = e.target.value;
}

function onDayDate(i, e) {
  const v = e.target.value;
  state.rec.days[i].date = v;
  state.rec.days[i].d = D.fmtMD(v);
}

function addDay() {
  const days = state.rec.days.slice();
  const last = days[days.length - 1];
  const next = D.addDays(last ? last.date : D.todayStr(), 1);
  days.push({ d: D.fmtMD(next), date: next, s: '', m: '' });
  state.rec.days = days;
}

function removeDay(i) {
  const days = state.rec.days.slice();
  if (days.length <= 1) return;
  days.splice(i, 1);
  state.rec.days = days;
}

function nextStep() {
  const rec = state.rec;
  if (rec.step === 1) {
    if (!rec.person_id) return toast('请选择给谁记');
    if (!rec.title) return toast('请选择症状');
    state.rec.step = 2;
    return;
  }
  if (rec.step === 2) state.rec.step = 3;
}

function prevStep() {
  state.rec.step = Math.max(1, state.rec.step - 1);
}

function onEnded(v) { state.rec.ended = v; }

async function submitBackfill() {
  const rec = state.rec;
  if (rec.ended === null) return toast('请选择是否已结束');
  const r = await api.call('condition.backfill', {
    person_id: rec.person_id,
    title: rec.title,
    start_date: rec.start_date,
    ended: rec.ended,
    days: rec.days.map(function (d) {
      return {
        date: d.date,
        symptoms: d.s ? [d.s] : undefined,
        medication: d.m || undefined
      };
    })
  }, { loading: '保存中' });
  toast('补记已保存，共 ' + r.day_count + ' 天');
  setTimeout(function () { back(); }, 900);
}

/* ================= 其他模式 ================= */
async function openModeForm(m) {
  const f = FORMS[m];
  const values = {};
  (f.fields || []).forEach(function (x) {
    if (x.default !== undefined) values[x.k] = x.default;
    if (x.type === 'date' && !values[x.k]) values[x.k] = D.todayStr();
  });

  try {
    const d = await api.call('person.list', {}, { silent: true });
    const persons = (d.persons || []).filter(function (p) { return p.access_level !== 'none'; });
    if (!persons.length) {
      state.loading = false;
      state.ready = true;
      state.error = '还没有可记录的档案';
      return;
    }
    state.loading = false;
    state.ready = true;
    state.persons = persons;
    state.formMode = m;
    state.form = {
      show: false, title: f.title, tip: f.tip || '', submitText: f.submitText || '保存',
      fields: f.fields, values: values
    };
  } catch (e) {
    state.loading = false;
    state.ready = true;
    state.error = e.message;
  }
}

async function onPickTarget() {
  const persons = state.persons;
  const idx = await actionSheet(persons.map(function (p) {
    return p.name + '（' + (p.relation || '成员') + '）';
  }));
  if (idx < 0 || !persons[idx]) return;
  state.form.values.pid = persons[idx].id;
  state.form.values._name = persons[idx].name;
  state.form.show = true;
}

async function onFormSubmit(e) {
  const m = state.formMode;
  const f = FORMS[m];
  const v = e.values;
  const pid = state.form.values.pid;
  if (!pid) return toast('请选择成员');

  const target = f.api || 'record.add';
  const base = Object.assign({ person_id: pid }, f.toPayload(v));
  // record.add 用 mode 作为记录类型；todo.add 的 type 由 toPayload 给出（复查/疫苗/…）
  const payload = target === 'record.add' ? Object.assign({ type: m }, base) : base;

  const r = await api.call(target, payload, { loading: '保存中' });
  toast('已保存' + (r.todo_id ? '，并生成待办' : ''));
  setTimeout(function () { back(); }, 900);
}

function onFormCancel() {
  state.form.show = false;
  setTimeout(function () { back(); }, 200);
}

/* ================= 详情模式 ================= */
async function loadDetail(type, id) {
  if (!type || !id) return;
  try {
    const d = await api.call('record.detail', { type: type, id: id }, { silent: true });
    const r = d.record;
    const rows = [];
    if (type === 'visit') {
      rows.push({ k: '日期', v: r.date }, { k: '医院', v: r.hospital },
        { k: '科室', v: r.department || '—' }, { k: '类型', v: r.visit_type_text },
        { k: '医生', v: r.doctor || '—' }, { k: '医生记录', v: r.diagnosis || '—' },
        { k: '医嘱', v: r.advice || '—' });
      if (r.summary_note) rows.push({ k: '报告要点（人工标注）', v: r.summary_note });
    } else if (type === 'exam') {
      rows.push({ k: '日期', v: r.date }, { k: '项目', v: r.name },
        { k: '类型', v: r.is_checkup ? '年度体检' : '检查' },
        { k: '医院', v: r.hospital || '—' }, { k: '结论摘要', v: r.summary || '—' });
      if (r.summary_note) rows.push({ k: '报告要点（人工标注）', v: r.summary_note });
    } else if (type === 'vital') {
      rows.push({ k: '日期', v: r.date }, { k: '指标', v: (C.METRIC_TYPE[r.metric_type] || r.metric_type) },
        { k: '测量值', v: r.value + (r.unit ? (' ' + r.unit) : '') },
        { k: '备注', v: r.note || '—' });
    } else {
      rows.push({ k: '接种日期', v: r.date }, { k: '疫苗', v: r.name },
        { k: '针次', v: '第 ' + r.dose_no + ' 针' },
        { k: '机构', v: r.institution || '—' }, { k: '下一针', v: r.next_date || '—' });
    }
    const isExamVisit = (type === 'visit' || type === 'exam');
    state.loading = false;
    state.ready = true;
    state.detail = {
      rows: rows,
      title: type === 'vital' ? ((C.METRIC_TYPE[r.metric_type] || '体征') + ' ' + r.value) : (r.name || r.hospital || '记录'),
      files: isExamVisit ? (r.file_urls || []) : [],
      summaryNote: isExamVisit ? (r.summary_note || '') : ''
    };
    state.noteDraft = state.detail.summaryNote;
    state.detailType = type;
  } catch (e) {
    state.loading = false;
    state.error = e.message;
  }
}

function onPreviewImage(url) {
  if (url && typeof window !== 'undefined') window.open(url, '_blank');
}

/* 报告要点（人工标注）：详情页内联保存，避免整套编辑流程 */
function onNoteInput(e) {
  state.noteDraft = e.target.value;
}

async function onSaveNote() {
  const note = (state.noteDraft || '').trim();
  await api.call('record.update', {
    type: state.detailType, id: route.query.id, summary_note: note
  }, { loading: '保存中' });
  toastOk('要点已保存');
  state.detail.summaryNote = note;
  const rows = (state.detail.rows || []).slice();
  let found = false;
  rows.forEach(function (row) {
    if (row.k === '报告要点（人工标注）') { row.v = note || '—'; found = true; }
  });
  if (!found && note) rows.push({ k: '报告要点（人工标注）', v: note });
  state.detail.rows = rows;
}

async function onDeleteDetail() {
  const ok = await api.confirm('删除', '确认删除这条记录？');
  if (!ok) return;
  await api.call('record.remove', { type: state.detailType, id: route.query.id });
  toastOk('已删除');
  setTimeout(function () { back(); }, 700);
}
</script>

<template>
  <div class="page" :class="{ 'big-mode': state.big }">

    <!-- 加载 / 错误 -->
    <div v-if="state.loading" class="empty">加载中…</div>
    <template v-else-if="state.error">
      <div class="empty">{{ state.error }}</div>
    </template>

    <!-- ============ 详情模式 ============ -->
    <template v-else-if="state.mode === 'detail'">
      <div class="detail-title">{{ state.detail ? state.detail.title : '' }}</div>
      <div class="card">
        <div class="kv" v-for="r in (state.detail ? state.detail.rows : [])" :key="r.k">
          <div class="k">{{ r.k }}</div>
          <div class="v">{{ r.v }}</div>
        </div>
      </div>

      <!-- 报告要点（人工标注）：系统不自动解读，由本人填写关键结论 -->
      <div v-if="state.detail && (state.detailType === 'exam' || state.detailType === 'visit')" class="card">
        <div class="sec-title"><div class="h"><div class="bar"></div>报告要点（人工标注）</div></div>
        <textarea class="note-area" :value="state.noteDraft" @input="onNoteInput"></textarea>
        <div class="addline" @click="onSaveNote">保存要点</div>
      </div>

      <div v-if="state.detail && state.detail.files && state.detail.files.length" class="card">
        <div class="sec-title"><div class="h"><div class="bar"></div>附件 / 报告图片</div></div>
        <div class="img-grid">
          <img v-for="f in state.detail.files" :key="f.id" class="img-cell"
               :src="f.url" @click="onPreviewImage(f.url)" />
        </div>
        <div class="hint">点击图片可放大查看</div>
      </div>

      <div class="bottom-actions">
        <div class="btn btn-plain flex1" @click="onDeleteDetail">删除这条记录</div>
      </div>
    </template>

    <!-- ============ 补记（3 步） ============ -->
    <template v-else-if="!state.mode && state.rec.step === 1">
      <div class="steps-bar">
        <div class="step-dot on"></div><div class="step-dot"></div><div class="step-dot"></div>
      </div>
      <div class="card">
        <div class="label">这是补记入口</div>
        <div class="muted">用于记录已经发生、但当时没空记的病情。开始日期可回溯到过去任意一天；系统会把「实际发生时间」和「本次补录时间」分开保存，不会弄乱时间线顺序。</div>
      </div>
      <div class="card">
        <div class="fld">
          <div class="label">给谁记</div>
          <div class="chips">
            <div class="chip" :class="{ on: state.rec.person_id === p.id }"
                 v-for="p in state.persons" :key="p.id"
                 @click="onPickPerson(p.id)">{{ p.name }}</div>
          </div>
        </div>
        <div class="fld">
          <div class="label">症状 / 病程名称</div>
          <div class="chips">
            <div class="chip" :class="{ on: state.rec.title === s }"
                 v-for="s in state.symptoms" :key="s"
                 @click="onPickSymptom(s)">{{ s }}</div>
          </div>
        </div>
        <div class="fld">
          <div class="label">开始日期（可回溯）</div>
          <input class="picker" type="date" :value="state.rec.start_date" @change="onStartDate" />
          <div class="hint">补记模式：实际发生时间与补录时间会分开保存</div>
        </div>
      </div>
      <div class="bottom-actions">
        <div class="btn btn-primary flex1" @click="nextStep">下一步</div>
      </div>
    </template>

    <template v-else-if="!state.mode && state.rec.step === 2">
      <div class="steps-bar">
        <div class="step-dot on"></div><div class="step-dot on"></div><div class="step-dot"></div>
      </div>
      <div class="tip-line">一次把几天补完 · 允许某天留空（空也是有价值的信息）</div>
      <div class="card" v-for="(day, i) in state.rec.days" :key="day.date">
        <div class="day-head">
          <!-- 日期文字照旧显示，透明的原生日期控件盖在上面，点文字即弹选择器 -->
          <div class="day-date-wrap">
            <div class="day-date">{{ day.d }}</div>
            <input class="day-date-input" type="date" :value="day.date"
                   @change="onDayDate(i, $event)" />
          </div>
          <div class="day-remove" v-if="state.rec.days.length > 1" @click="removeDay(i)">删除</div>
        </div>
        <input class="input" placeholder="症状（如 咳嗽 轻 / 无）" :value="day.s"
               @input="onDayInput(i, 's', $event)" />
        <input class="input mt16" placeholder="用药 / 体温 / 备注" :value="day.m"
               @input="onDayInput(i, 'm', $event)" />
      </div>
      <div class="addline" @click="addDay">＋ 添加一天</div>
      <div class="bottom-actions">
        <div class="btn btn-ghost flex1" @click="prevStep">上一步</div>
        <div class="btn btn-primary sum-btn" @click="nextStep">下一步</div>
      </div>
    </template>

    <template v-else-if="!state.mode && state.rec.step === 3">
      <div class="steps-bar">
        <div class="step-dot on"></div><div class="step-dot on"></div><div class="step-dot on"></div>
      </div>
      <div class="card">
        <div class="fld">
          <div class="label">本次病程状态</div>
          <div class="chips">
            <div class="chip" :class="{ on: state.rec.ended === false }" @click="onEnded(false)">还在继续</div>
            <div class="chip" :class="{ on: state.rec.ended === true }" @click="onEnded(true)">已结束</div>
          </div>
        </div>
        <div class="kv"><div class="k">病程</div><div class="v">{{ state.rec.title }}</div></div>
        <div class="kv"><div class="k">开始</div><div class="v">{{ state.rec.start_date }}</div></div>
        <div class="kv"><div class="k">记录</div><div class="v">{{ state.rec.days.length }} 天</div></div>
        <div class="kv"><div class="k">状态</div>
          <div class="v">{{ state.rec.ended === null ? '未选择' : (state.rec.ended ? '已结束' : '进行中') }}</div>
        </div>
      </div>
      <div class="bottom-actions">
        <div class="btn btn-ghost flex1" @click="prevStep">上一步</div>
        <div class="btn btn-primary sum-btn" @click="submitBackfill">保存补记</div>
      </div>
    </template>

    <!-- ============ 其他模式：先选人，再填表 ============ -->
    <template v-else-if="state.mode">
      <div class="card">
        <div class="fld">
          <div class="label">给谁记<span class="req">*</span></div>
          <div class="picker" :class="{ picked: state.form.values.pid }" @click="onPickTarget">
            {{ state.form.values._name ? '已选择：' + state.form.values._name + '（点击更换）' : '点击选择成员' }}
          </div>
          <div class="hint">选择成员后会弹出「{{ state.form.title }}」表单</div>
        </div>
      </div>
      <div class="empty">先选择成员，再填写记录内容</div>
    </template>

    <FormSheet :show="state.form.show" :title="state.form.title" :tip="state.form.tip"
               :submit-text="state.form.submitText"
               :fields="state.form.fields" :values="state.form.values"
               @submit="onFormSubmit" @cancel="onFormCancel" />
  </div>
</template>
