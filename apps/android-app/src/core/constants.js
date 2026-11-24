/**
 * 全局常量 · 与 docs/开发过程及成果.md §四保持一致
 * 该文件同时被小程序端与云函数端使用（scripts/sync-shared.js 负责同步）
 */

/* ---------- 集合名 ---------- */
const COLL = {
  user:          'user',
  family:        'family',
  userFamily:    'user_family',
  person:        'person',
  personAccess:  'person_access',
  allergy:       'allergy',
  chronic:       'chronic_disease',
  surgery:       'surgery',
  medicine:      'long_term_medicine',
  contact:       'emergency_contact',
  condition:     'condition',
  event:         'timeline_event',
  symptomDict:   'symptom_dict',
  medicalRecord: 'medical_record',
  examReport:    'exam_report',
  vaccine:       'vaccine',
  vital:         'vital_sign',
  todo:          'todo',
  file:          'file',
  auditLog:      'audit_log',
  userSetting:   'user_setting',
  credential:    'user_credential',
  session:       'user_session'
};

/** 一期需创建的集合（23 个）
 *  二期：exam_item / exam_item_dict
 *  后期预留：share_link
 */
const ONE_PHASE_COLLECTIONS = [
  'user', 'family', 'user_family',
  'person', 'person_access',
  'allergy', 'chronic_disease', 'surgery', 'long_term_medicine', 'emergency_contact',
  'condition', 'timeline_event', 'symptom_dict',
  'medical_record', 'exam_report', 'vaccine', 'vital_sign',
  'todo',
  'file', 'audit_log', 'user_setting',
  'user_credential', 'user_session'
];

/** 二期/后期预留，仅作声明，一期不建 */
const RESERVED_COLLECTIONS = ['exam_item', 'exam_item_dict', 'share_link'];

/* ---------- 病程事件类型 ---------- */
const EVENT_TYPE = {
  symptom:    'symptom',
  medication: 'medication',
  visit:      'visit',
  exam:       'exam',
  note:       'note'
};

/* ---------- 健康时间线的事件种类（混排 4 张表 + 病程） ---------- */
const KIND = {
  condition: 'condition',
  visit:     'visit',
  exam:      'exam',
  checkup:   'checkup',
  vaccine:   'vaccine',
  metric:    'metric'
};

/** 各种类的展示配置（徽标文字 + 颜色），小程序端直接用 */
const KIND_META = {
  condition: { label: '生病', short: '病', color: '#C2410C', bg: '#FFF1E7' },
  visit:     { label: '就诊', short: '诊', color: '#1D4ED8', bg: '#EAF1FF' },
  exam:      { label: '检查', short: '检', color: '#6D28D9', bg: '#F3EEFF' },
  checkup:   { label: '体检', short: '查', color: '#0E7490', bg: '#E4F6FB' },
  vaccine:   { label: '疫苗', short: '苗', color: '#15803D', bg: '#E7F7ED' },
  metric:    { label: '体征', short: '征', color: '#B45309', bg: '#FEF3E2' }
};

/* ---------- 体征指标类型（血压/血糖/体重/体温） ---------- */
const METRIC_TYPE = {
  blood_pressure: '血压',
  blood_glucose:  '血糖',
  weight:         '体重',
  temperature:    '体温',
  other:          '其他'
};
/**
 * 指标展示配置：默认单位 + 正常参考区间（仅展示用，不构成医疗建议）。
 * 血压为「收缩压/舒张压」，用 bp 标记走双值输入。
 */
const METRIC_META = {
  blood_pressure: { label: '血压', unit: 'mmHg', is_bp: true,  normal: '90~139 / 60~89' },
  blood_glucose:  { label: '血糖', unit: 'mmol/L', is_bp: false, normal: '3.9~6.1（空腹）' },
  weight:         { label: '体重', unit: 'kg',   is_bp: false, normal: '—' },
  temperature:    { label: '体温', unit: '℃',    is_bp: false, normal: '36.0~37.2' },
  other:          { label: '其他', unit: '',     is_bp: false, normal: '—' }
};

/* ---------- 用药时段 ---------- */
const SLOT = { morning: '早', noon: '中', evening: '晚', bedtime: '睡前' };
const SLOT_ORDER = ['morning', 'noon', 'evening', 'bedtime'];
/** 首页「今天要吃的药」只展示这三段 */
const SLOT_HOME = ['morning', 'noon', 'evening'];

/* ---------- 严重程度 ---------- */
const SEVERITY = { mild: '轻', moderate: '中', severe: '重' };
const ALLERGY_SEVERITY = { mild: '轻微', moderate: '中等', severe: '严重', unknown: '未知' };

/* ---------- 权限级别（person_access.level） ---------- */
const ACCESS = { owner: 'owner', edit: 'edit', read: 'read', none: 'none' };
const ACCESS_RANK = { none: 0, read: 1, edit: 2, owner: 3 };

/* ---------- 状态枚举 ---------- */
const CONDITION_STATUS = { ongoing: 'ongoing', ended: 'ended' };
const JOIN_STATUS = { pending: 'pending', approved: 'approved', rejected: 'rejected', removed: 'removed' };
const ROLE = { admin: 'admin', member: 'member' };
const PROFILE_TYPE = { self: 'self', managed: 'managed' };
const TODO_STATUS = { pending: 'pending', done: 'done', skipped: 'skipped' };
const TODO_TYPE = { recheck: 'recheck', vaccine: 'vaccine', exam: 'exam', custom: 'custom' };
const RECORD_STATUS = { active: 'active', archived: 'archived', deleted: 'deleted' };
/** 基础病（长期病）的治疗状态，与 RECORD_STATUS 不是一回事，别混用 */
const CHRONIC_STATUS = { active: 'active', cured: 'cured' };
const REPORT_TYPE = { lab: 'lab', imaging: 'imaging', checkup: 'checkup', other: 'other' };
const VISIT_TYPE = { outpatient: '门诊', inpatient: '住院', emergency: '急诊', followup: '复诊' };

/* ---------- 错误码 ---------- */
const ERR = {
  OK:                'OK',
  E_UNKNOWN_ACTION:  'E_UNKNOWN_ACTION',
  E_NOT_LOGIN:       'E_NOT_LOGIN',
  E_NO_FAMILY:       'E_NO_FAMILY',
  E_NO_PERMISSION:   'E_NO_PERMISSION',
  E_NOT_FOUND:       'E_NOT_FOUND',
  E_INVALID_PARAM:   'E_INVALID_PARAM',
  E_DUPLICATE:       'E_DUPLICATE',
  E_INVITE_INVALID:  'E_INVITE_INVALID',
  E_NOT_ADMIN:       'E_NOT_ADMIN',
  E_CONSENT_REQUIRED:'E_CONSENT_REQUIRED',
  E_AUTH_FAIL:       'E_AUTH_FAIL',
  E_INTERNAL:        'E_INTERNAL'
};

/** 无需登录态即可调用的 action（其余一律要求已登录） */
const AUTH_FREE_ACTIONS = [
  'ping', 'auth.login', 'auth.register', 'auth.loginByPassword'
];

/** 默认分页 */
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const __exports = {
  COLL, ONE_PHASE_COLLECTIONS, RESERVED_COLLECTIONS,
  EVENT_TYPE, KIND, KIND_META, METRIC_TYPE, METRIC_META,
  SLOT, SLOT_ORDER, SLOT_HOME,
  SEVERITY, ALLERGY_SEVERITY,
  ACCESS, ACCESS_RANK,
  CONDITION_STATUS, JOIN_STATUS, ROLE, PROFILE_TYPE,
  TODO_STATUS, TODO_TYPE, RECORD_STATUS, CHRONIC_STATUS, REPORT_TYPE, VISIT_TYPE,
  ERR, AUTH_FREE_ACTIONS, PAGE_SIZE, MAX_PAGE_SIZE
};
export { COLL };
export { ONE_PHASE_COLLECTIONS };
export { RESERVED_COLLECTIONS };
export { EVENT_TYPE };
export { KIND };
export { KIND_META };
export { METRIC_TYPE };
export { METRIC_META };
export { SLOT };
export { SLOT_ORDER };
export { SLOT_HOME };
export { SEVERITY };
export { ALLERGY_SEVERITY };
export { ACCESS };
export { ACCESS_RANK };
export { CONDITION_STATUS };
export { JOIN_STATUS };
export { ROLE };
export { PROFILE_TYPE };
export { TODO_STATUS };
export { TODO_TYPE };
export { RECORD_STATUS };
export { CHRONIC_STATUS };
export { REPORT_TYPE };
export { VISIT_TYPE };
export { ERR };
export { AUTH_FREE_ACTIONS };
export { PAGE_SIZE };
export { MAX_PAGE_SIZE };
export default __exports;
