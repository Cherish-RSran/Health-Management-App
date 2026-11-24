/**
 * 业务模型 · 纯函数集合（无副作用、不依赖数据库/微信 API）
 * 小程序端与云函数端共用，是最核心的可测层。
 */

import C from './constants.js';
import D from './date.js';

/* ============================================================================
   一、用药
   ============================================================================ */

/** 是否长期用药：没有 end_date 即为长期 */
function isLongTerm(med) {
  return !med || !med.end_date;
}

/** 该药在指定日期是否"在服" */
function isMedActive(med, today) {
  if (!med) return false;
  if (med.status && med.status !== 'active') return false;
  const t = today || D.todayStr();
  if (!med.end_date) return true;          // 长期
  return med.end_date >= t;                // 短期：未到期
}

/** 在服的药（含长期 + 未到期短期） */
function activeMeds(meds, today) {
  return (meds || []).filter(function (m) { return isMedActive(m, today); });
}

/** 已结束的短期药 */
function expiredMeds(meds, today) {
  const t = today || D.todayStr();
  return (meds || []).filter(function (m) { return !!m.end_date && m.end_date < t; });
}

/** 长期用药（用于医生摘要的「长期用药」区，短期药不能混进来） */
function longTermMeds(meds, today) {
  return activeMeds(meds, today).filter(isLongTerm);
}

/** 在服中的短期药 */
function shortTermMeds(meds, today) {
  return activeMeds(meds, today).filter(function (m) { return !isLongTerm(m); });
}

/**
 * 按早/中/晚分组（首页「今天要吃的药」）
 * @returns {Array<{slot:string,label:string,items:Array}>} 空分组被剔除
 */
function groupMedsBySlot(meds, today) {
  const act = activeMeds(meds, today);
  const groups = C.SLOT_HOME.map(function (slot) {
    return {
      slot: slot,
      label: C.SLOT[slot],
      items: act.filter(function (m) { return (m.time_slots || []).indexOf(slot) >= 0; })
    };
  }).filter(function (g) { return g.items.length > 0; });

  const noSlot = act.filter(function (m) { return !(m.time_slots || []).length; });
  if (noSlot.length) groups.push({ slot: 'other', label: '未定时段', items: noSlot });
  return groups;
}

/** 用药周期文案：'长期服用' / '短期 · 10.14 → 10.17' */
function medPeriodText(med) {
  if (!med) return '';
  if (isLongTerm(med)) return '长期服用';
  const s = med.start_date ? D.fmtMD(med.start_date) : '';
  const e = D.fmtMD(med.end_date);
  return '短期 · ' + (s ? s + ' → ' + e : e);
}

/* ============================================================================
   二、健康时间线（4 张表混排）
   ============================================================================ */

/** 检查报告类型 → 时间线种类（体检 or 检查） */
function classifyExam(reportType) {
  return reportType === C.REPORT_TYPE.checkup ? C.KIND.checkup : C.KIND.exam;
}

function _condSubtitle(c, today) {
  if (c.status === C.CONDITION_STATUS.ongoing) {
    // 「已 N 天」与「持续 N 天」统一口径：含首日（10.13 → 10.16 记 4 天）
    return D.fmtMD(c.start_date) + ' 起 · 已 ' + D.durationDays(c.start_date, null, today) + ' 天';
  }
  if (c.summary) return c.summary;
  if (c.end_date) {
    return D.durationDays(c.start_date, c.end_date) + ' 天 · 已结束';
  }
  return '已结束';
}

function fromConditionRow(row, today) {
  return {
    kind: C.KIND.condition,
    occurred_at: D.startOfDayTs(row.start_date),
    title: row.title,
    subtitle: _condSubtitle(row, today),
    is_ongoing: row.status === C.CONDITION_STATUS.ongoing,
    person_id: row.person_id,
    ref_table: C.COLL.condition,
    ref_id: row._id,
    raw: row
  };
}

function fromMedicalRecordRow(row) {
  return {
    kind: C.KIND.visit,
    occurred_at: Number(row.visit_date) || D.startOfDayTs(row.visit_date_str || ''),
    title: [row.hospital, row.department].filter(Boolean).join(' · '),
    subtitle: [C.VISIT_TYPE[row.visit_type] || row.visit_type, row.diagnosis]
      .filter(Boolean).join(' · '),
    is_ongoing: false,
    person_id: row.person_id,
    ref_table: C.COLL.medicalRecord,
    ref_id: row._id,
    raw: row
  };
}

function fromExamReportRow(row) {
  return {
    kind: classifyExam(row.report_type),
    occurred_at: Number(row.report_date) || D.startOfDayTs(row.report_date_str || ''),
    title: row.name,
    subtitle: row.summary || row.hospital || '见报告',
    is_ongoing: false,
    person_id: row.person_id,
    ref_table: C.COLL.examReport,
    ref_id: row._id,
    raw: row
  };
}

function fromVaccineRow(row) {
  return {
    kind: C.KIND.vaccine,
    occurred_at: D.startOfDayTs(row.vaccinated_date),
    title: row.name + (row.dose_no ? ' · 第 ' + row.dose_no + ' 针' : ''),
    subtitle: row.institution || '',
    is_ongoing: false,
    person_id: row.person_id,
    ref_table: C.COLL.vaccine,
    ref_id: row._id,
    raw: row
  };
}

function fromVitalRow(row) {
  const meta = C.METRIC_META[row.metric_type] || C.METRIC_META.other;
  const label = meta.label || '体征';
  const value = row.value || '';
  const unit = row.unit || meta.unit || '';
  return {
    kind: C.KIND.metric,
    occurred_at: D.startOfDayTs(row.vital_date),
    title: label + (value ? ' ' + value + (unit ? ' ' + unit : '') : ''),
    subtitle: row.note || '',
    is_ongoing: false,
    person_id: row.person_id,
    ref_table: C.COLL.vital,
    ref_id: row._id,
    raw: row
  };
}

/**
 * 合并 4 张表 + 体征 → 统一事件数组
 * @param {{conditions?:Array, records?:Array, exams?:Array, vaccines?:Array, vitals?:Array}} sources
 * @param {{person_id?:string, kinds?:string[], keyword?:string, today?:string}} [opts]
 */
function mergeTimeline(sources, opts) {
  sources = sources || {};
  opts = opts || {};
  const today = opts.today || D.todayStr();
  let events = [];

  (sources.conditions || []).forEach(function (r) {
    if (r && r.status !== C.RECORD_STATUS.deleted) events.push(fromConditionRow(r, today));
  });
  (sources.records || []).forEach(function (r) {
    if (r && r.status !== C.RECORD_STATUS.deleted) events.push(fromMedicalRecordRow(r));
  });
  (sources.exams || []).forEach(function (r) {
    if (r && r.status !== C.RECORD_STATUS.deleted) events.push(fromExamReportRow(r));
  });
  (sources.vaccines || []).forEach(function (r) {
    if (r && r.status !== C.RECORD_STATUS.deleted) events.push(fromVaccineRow(r));
  });
  (sources.vitals || []).forEach(function (r) {
    if (r && r.status !== C.RECORD_STATUS.deleted) events.push(fromVitalRow(r));
  });

  if (opts.person_id) {
    events = events.filter(function (e) { return e.person_id === opts.person_id; });
  }
  if (opts.kinds && opts.kinds.length) {
    events = events.filter(function (e) { return opts.kinds.indexOf(e.kind) >= 0; });
  }
  if (opts.keyword) {
    const k = String(opts.keyword).toLowerCase();
    events = events.filter(function (e) {
      return (e.title + ' ' + e.subtitle).toLowerCase().indexOf(k) >= 0;
    });
  }

  // 进行中置顶 → 其余按发生时间倒序
  events.sort(function (a, b) {
    if (a.is_ongoing !== b.is_ongoing) return a.is_ongoing ? -1 : 1;
    return b.occurred_at - a.occurred_at;
  });
  return events;
}

/** 按月分组；进行中的统一归入 'ongoing' 组且必在最前 */
function groupTimeline(events) {
  const groups = [];
  let cur = null;
  (events || []).forEach(function (e) {
    const key = e.is_ongoing ? 'ongoing' : D.monthKeyOf(e.occurred_at);
    if (!cur || cur.key !== key) {
      cur = {
        key: key,
        label: key === 'ongoing' ? '进行中' : D.fmtMonth(key),
        items: []
      };
      groups.push(cur);
    }
    cur.items.push(e);
  });
  return groups;
}

/** 分页（内存分页，供云函数在合并后切片） */
function paginate(list, page, size) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.max(1, Number(size) || C.PAGE_SIZE);
  const start = (p - 1) * s;
  const slice = (list || []).slice(start, start + s);
  return {
    items: slice,
    page: p,
    size: s,
    total: (list || []).length,
    has_more: start + s < (list || []).length
  };
}

/* ============================================================================
   三、病程逐日
   ============================================================================ */

/**
 * 把病程事件整理成"逐日"结构：缺失的天补成 empty（空记录也是有效信息）
 * @param {object} condition
 * @param {Array} events timeline_event 数组
 */
function buildDailyRecords(condition, events, today) {
  const list = (events || []).slice().sort(function (a, b) {
    return (Number(a.occurred_at) || 0) - (Number(b.occurred_at) || 0);
  });
  const start = condition.start_date;
  const end = condition.end_date || (condition.status === C.CONDITION_STATUS.ongoing
    ? (today || D.todayStr()) : start);

  const rows = [];
  let cursor = start;
  let guard = 0;
  // 逐日推进，插入空白天
  while (cursor && cursor <= end && guard < 400) {
    guard++;
    // 注意：note（备注）也占一天。过滤掉它会导致「写了备注却显示无记录」
    const dayEvents = list.filter(function (e) {
      return D.dateStrOf(e.occurred_at) === cursor;
    });
    if (dayEvents.length) {
      dayEvents.forEach(function (e) {
        rows.push({ date: cursor, dateLabel: D.fmtMD(cursor), event: e, empty: false });
      });
    } else {
      rows.push({ date: cursor, dateLabel: D.fmtMD(cursor), event: null, empty: true });
    }
    cursor = D.addDays(cursor, 1);
  }

  // 落在区间外的事件（如补记到更早日期）也一并带上
  list.forEach(function (e) {
    const ds = D.dateStrOf(e.occurred_at);
    if (ds < start || ds > end) {
      rows.push({ date: ds, dateLabel: D.fmtMD(ds), event: e, empty: false });
    }
  });
  rows.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  return rows;
}

/** 病程事件 → 一行文字（给医生摘要用） */
function condenseCourse(events) {
  const list = (events || [])
    .filter(function (e) { return e.event_type !== C.EVENT_TYPE.note; })
    .slice()
    .sort(function (a, b) { return (Number(a.occurred_at) || 0) - (Number(b.occurred_at) || 0); });
  return list.map(function (e) {
    const c = e.content || {};
    let txt = '';
    if (e.event_type === C.EVENT_TYPE.symptom) {
      txt = (c.symptoms || []).join('、') || '症状';
      if (c.severity && C.SEVERITY[c.severity]) txt += '（' + C.SEVERITY[c.severity] + '）';
      if (c.temperature) txt += ' 体温' + c.temperature + '℃';
    } else if (e.event_type === C.EVENT_TYPE.medication) {
      txt = '服' + (c.name || '药');
    } else if (e.event_type === C.EVENT_TYPE.visit) {
      txt = '就诊 ' + (c.hospital || '');
    } else if (e.event_type === C.EVENT_TYPE.exam) {
      txt = '检查 ' + (c.name || '');
    }
    return D.fmtMD(D.dateStrOf(e.occurred_at)) + ' ' + txt;
  }).join(' → ');
}

/* ============================================================================
   三-二、体征指标
   ============================================================================ */

/** 每种类型取最新一条（按日期倒序），用于摘要展示 */
function summarizeVitals(rows) {
  const map = {};
  (rows || []).forEach(function (r) {
    if (!r || r.status === C.RECORD_STATUS.deleted) return;
    const t = r.metric_type;
    const cur = map[t];
    if (!cur || (r.vital_date || '') > (cur.vital_date || '')) map[t] = r;
  });
  return Object.keys(map).map(function (t) {
    const r = map[t];
    const meta = C.METRIC_META[t] || C.METRIC_META.other;
    return {
      type: t,
      label: meta.label || '体征',
      value: r.value || '',
      unit: r.unit || meta.unit || '',
      normal: meta.normal || '',
      date: r.vital_date || '',
      date_label: D.fmtMD(r.vital_date),
      note: r.note || ''
    };
  });
}

/**
 * 取某类型的时序数据（升序），供趋势图使用。
 * @returns {Array<{date:string, date_label:string, value:string, ts:number}>}
 */
function vitalSeries(rows, type) {
  return (rows || [])
    .filter(function (r) { return r && r.status !== C.RECORD_STATUS.deleted && r.metric_type === type; })
    .sort(function (a, b) { return (a.vital_date || '').localeCompare(b.vital_date || ''); })
    .map(function (r) {
      return {
        date: r.vital_date || '',
        date_label: D.fmtMD(r.vital_date),
        value: r.value || '',
        ts: D.startOfDayTs(r.vital_date)
      };
    });
}

/* ============================================================================
   四、医生摘要
   ============================================================================ */

/**
 * 生成医生摘要结构。
 * 规则：过敏史**永远第一个**且不可取消；长期与短期用药严格分离。
 * 每个区块都带 source 以便溯源。
 */
function buildSummary(input) {
  input = input || {};
  const today = input.today || D.todayStr();
  const p = input.person || {};
  const opt = input.options || {};
  const blocks = [];

  const alive = function (arr) {
    return (arr || []).filter(function (x) { return x && x.status !== C.RECORD_STATUS.deleted; });
  };

  /* --- 必带 1：过敏史（固定第一位） --- */
  blocks.push({
    key: 'allergy',
    label: '过敏史',
    required: true,
    emphasis: true,
    items: alive(input.allergy).map(function (a) {
      return {
        text: a.allergen + (a.severity && a.severity !== 'unknown'
          ? '（' + C.ALLERGY_SEVERITY[a.severity] + '）' : '')
          + (a.reaction ? ' · ' + a.reaction : ''),
        source: { table: C.COLL.allergy, id: a._id }
      };
    }),
    empty_text: '无已知过敏'
  });

  /* --- 必带 2：基础病（即长期病） ---
     只列「在治」的：已愈的病不进摘要。医生摘要回答的是「当前身体状况」，
     把已经治好的病列进去只会干扰用药判断。既往史若重要，由家属写在备注里。 */
  const treating = function (arr) {
    return alive(arr).filter(function (x) {
      return x.status !== C.CHRONIC_STATUS.cured;
    });
  };

  blocks.push({
    key: 'chronic',
    label: '基础病（长期）',
    required: true,
    items: treating(input.chronic).map(function (x) {
      return {
        text: x.name + (x.diagnosed_date ? '（' + String(x.diagnosed_date).slice(0, 4) + '）' : ''),
        source: { table: C.COLL.chronic, id: x._id }
      };
    }),
    empty_text: '无'
  });

  /* --- 必带 3：长期用药（**不含**短期药） ---
     药名后面带上「治哪个病」，医生一眼能对上，尤其是同时吃好几种药的老人。 */
  const meds = alive(input.medicines);
  blocks.push({
    key: 'long_term_med',
    label: '长期用药',
    required: true,
    items: longTermMeds(meds, today).map(function (m) {
      return {
        text: [m.name, m.spec, m.frequency].filter(Boolean).join(' ')
          + (m.for_disease ? '（' + m.for_disease + '）' : ''),
        source: { table: C.COLL.medicine, id: m._id }
      };
    }),
    empty_text: '无'
  });

  /* --- 必带 4：近期在服（短期疗程） --- */
  const shorts = shortTermMeds(meds, today);
  if (shorts.length) {
    blocks.push({
      key: 'short_term_med',
      label: '近期在服（短期）',
      required: true,
      items: shorts.map(function (m) {
        return {
          text: [m.name, m.spec].filter(Boolean).join(' ')
            + (m.for_disease ? '（' + m.for_disease + '）' : '')
            + '（' + medPeriodText(m) + '）',
          source: { table: C.COLL.medicine, id: m._id }
        };
      })
    });
  }

  /* --- 可勾选：手术史 --- */
  if (opt.surgery !== false) {
    const list = alive(input.surgery);
    if (list.length) {
      blocks.push({
        key: 'surgery',
        label: '手术史',
        required: false,
        items: list.map(function (s) {
          return {
            text: (s.surgery_date ? String(s.surgery_date).slice(0, 4) + ' ' : '') + s.name,
            source: { table: C.COLL.surgery, id: s._id }
          };
        })
      });
    }
  }

  /* --- 必带 5：本次病程 --- */
  const cond = input.condition;
  if (cond) {
    const text = condenseCourse(input.condition_events) || (cond.summary || '');
    if (text) {
      blocks.push({
        key: 'course',
        label: '本次病程',
        required: true,
        compact: true,
        items: [{ text: text, source: { table: C.COLL.condition, id: cond._id } }]
      });
    }
  }

  /* --- 必带 6：本次用药 --- */
  if (cond && input.course_med_summary) {
    blocks.push({
      key: 'course_med',
      label: '本次用药',
      required: true,
      items: [{ text: input.course_med_summary, source: { table: C.COLL.condition, id: cond._id } }]
    });
  }

  /* --- 可勾选：相关历史病程 --- */
  if (opt.history !== false) {
    const list = alive(input.related_conditions);
    if (list.length) {
      blocks.push({
        key: 'history',
        label: '相关历史',
        required: false,
        items: list.map(function (c) {
          return {
            text: D.fmtMD(c.start_date) + ' ' + c.title
              + (c.end_date ? '（' + D.durationDays(c.start_date, c.end_date) + ' 天，已结束）' : ''),
            source: { table: C.COLL.condition, id: c._id }
          };
        })
      });
    }
  }

  /* --- 可勾选：近期检查 --- */
  if (opt.exam !== false) {
    const list = alive(input.recent_exams);
    if (list.length) {
      blocks.push({
        key: 'exam',
        label: '近期检查',
        required: false,
        items: list.map(function (e) {
          return {
            text: D.fmtMD(e.report_date ? D.dateStrOf(e.report_date) : e.report_date_str)
              + ' ' + e.name,
            source: { table: C.COLL.examReport, id: e._id }
          };
        })
      });
    }
  }

  /* --- 可勾选：近期体征（血压/血糖/体重/体温） --- */
  if (opt.metric !== false) {
    const list = summarizeVitals(input.vitals);
    if (list.length) {
      blocks.push({
        key: 'metric',
        label: '近期体征',
        required: false,
        items: list.map(function (v) {
          return {
            text: v.label + ' ' + v.value + (v.unit ? ' ' + v.unit : '')
              + (v.normal ? '（参考 ' + v.normal + '）' : ''),
            source: { table: C.COLL.vital, id: v.date }
          };
        })
      });
    }
  }

  return {
    header: {
      name: p.name || '',
      sex: p.gender === 'male' ? '男' : (p.gender === 'female' ? '女' : ''),
      age: D.calcAge(p.birth_date, today),
      blood_type: p.blood_type || '',
      generated_at: input.generated_at || D.nowTs()
    },
    blocks: blocks,
    // 摘要整体可溯源
    sources: blocks.map(function (b) { return { key: b.key, count: b.items.length }; })
  };
}

/** 默认勾选（复诊复用）：全部可选项默认开 */
function defaultSummaryOptions() {
  return { surgery: true, history: true, exam: true, metric: true };
}

const __exports = {
  // 用药
  isLongTerm, isMedActive, activeMeds, expiredMeds,
  longTermMeds, shortTermMeds, groupMedsBySlot, medPeriodText,
  // 时间线
  classifyExam,
  fromConditionRow, fromMedicalRecordRow, fromExamReportRow, fromVaccineRow, fromVitalRow,
  mergeTimeline, groupTimeline, paginate,
  // 病程
  buildDailyRecords, condenseCourse,
  // 体征
  summarizeVitals, vitalSeries,
  // 摘要
  buildSummary, defaultSummaryOptions
};
export { isLongTerm };
export { isMedActive };
export { activeMeds };
export { expiredMeds };
export { longTermMeds };
export { shortTermMeds };
export { groupMedsBySlot };
export { medPeriodText };
export { classifyExam };
export { fromConditionRow };
export { fromMedicalRecordRow };
export { fromExamReportRow };
export { fromVaccineRow };
export { fromVitalRow };
export { mergeTimeline };
export { groupTimeline };
export { paginate };
export { buildDailyRecords };
export { condenseCourse };
export { summarizeVitals };
export { vitalSeries };
export { buildSummary };
export { defaultSummaryOptions };
export default __exports;
