/**
 * 集合与索引的**单一事实来源**
 *
 * 与 `docs/开发过程及成果.md` §4.4「索引」逐条对应。
 * init-db 脚本直接读这里建库 —— 避免文档、脚本两处各写一份。
 *
 * 修改本文件后必须同步 04 文档。
 */

/* ---------------------------------------------------------------------------
   集合（20 个）
   --------------------------------------------------------------------------- */
const COLLECTIONS = [
  // 账号与家庭
  'user',
  'family',
  'user_family',
  // 档案与权限
  'person',
  'person_access',
  // 常备档案
  'allergy',
  'chronic_disease',
  'surgery',
  'long_term_medicine',
  'emergency_contact',
  // 病程（核心）
  'condition',
  'timeline_event',
  'symptom_dict',
  // 医疗记录
  'medical_record',
  'exam_report',
  'vaccine',
  // 提醒 / 附件 / 审计 / 偏好
  'todo',
  'file',
  'audit_log',
  'user_setting'
];

/* ---------------------------------------------------------------------------
   索引
   keys: [字段, 方向]  方向 1=升序 -1=降序
   --------------------------------------------------------------------------- */
const INDEXES = {
  // ⭐ 唯一索引：一期「一人一家庭」「一码一家庭」的并发保护全靠它。
  //    漏建会出现重复家庭 / 重复成员，且是静默的。
  family: [
    { name: 'idx_invite_code', keys: [['invite_code', 1]], unique: true },
    { name: 'idx_owner_user_id', keys: [['owner_user_id', 1]], unique: true }
  ],

  user_family: [
    { name: 'idx_user_family_uniq', keys: [['user_id', 1], ['family_id', 1]], unique: true },
    { name: 'idx_family_join_status', keys: [['family_id', 1], ['join_status', 1]] }
  ],

  person: [
    { name: 'idx_family_status', keys: [['family_id', 1], ['status', 1]] }
  ],

  person_access: [
    { name: 'idx_person_user_uniq', keys: [['person_id', 1], ['user_id', 1]], unique: true }
  ],

  condition: [
    { name: 'idx_person_status_start', keys: [['person_id', 1], ['status', 1], ['start_date', -1]] },
    { name: 'idx_family_start', keys: [['family_id', 1], ['start_date', -1]] }
  ],

  timeline_event: [
    { name: 'idx_condition_occurred', keys: [['condition_id', 1], ['occurred_at', 1]] },
    { name: 'idx_person_occurred', keys: [['person_id', 1], ['occurred_at', -1]] },
    { name: 'idx_family_occurred', keys: [['family_id', 1], ['occurred_at', -1]] }
  ],

  medical_record: [
    { name: 'idx_person_visit_date', keys: [['person_id', 1], ['visit_date', -1]] }
  ],

  exam_report: [
    { name: 'idx_person_report_date', keys: [['person_id', 1], ['report_date', -1]] }
  ],

  vaccine: [
    { name: 'idx_person_vaccinated', keys: [['person_id', 1], ['vaccinated_date', -1]] }
  ],

  todo: [
    { name: 'idx_family_status_due', keys: [['family_id', 1], ['status', 1], ['due_date', 1]] }
  ],

  audit_log: [
    { name: 'idx_family_created', keys: [['family_id', 1], ['created_at', -1]] },
    { name: 'idx_person_created', keys: [['person_id', 1], ['created_at', -1]] }
  ],

  // 常备档案：全部按 person_id 查
  allergy: [{ name: 'idx_person', keys: [['person_id', 1]] }],
  chronic_disease: [{ name: 'idx_person', keys: [['person_id', 1]] }],
  surgery: [{ name: 'idx_person', keys: [['person_id', 1]] }],
  long_term_medicine: [{ name: 'idx_person', keys: [['person_id', 1]] }],
  emergency_contact: [{ name: 'idx_person', keys: [['person_id', 1]] }],

  // 附件：按档案 / 家庭查（一期预留，不产生公开 URL）
  file: [
    { name: 'idx_person', keys: [['person_id', 1]] },
    { name: 'idx_family', keys: [['family_id', 1]] }
  ],

  // user_setting：_id 即 openid，无需额外索引
  user_setting: [],

  // symptom_dict：系统字典表，全量读取，无需索引
  symptom_dict: [],
  user: []
};

/** 把内部结构转成 CloudBase 的 CreateIndex 结构 */
function toCreateIndex(idx) {
  return {
    IndexName: idx.name,
    MgoKeySchema: {
      MgoIndexKeys: idx.keys.map(function (k) {
        return { Name: k[0], Direction: String(k[1]) };
      }),
      MgoIsUnique: !!idx.unique
    }
  };
}

/** 索引总数（用于报告） */
function indexCount() {
  return Object.keys(INDEXES).reduce(function (n, k) { return n + INDEXES[k].length; }, 0);
}

/** 唯一索引清单（启动时断言用） */
function uniqueIndexes() {
  const out = [];
  Object.keys(INDEXES).forEach(function (coll) {
    INDEXES[coll].forEach(function (idx) {
      if (idx.unique) out.push(coll + '.' + idx.name);
    });
  });
  return out;
}

module.exports = {
  COLLECTIONS: COLLECTIONS,
  INDEXES: INDEXES,
  toCreateIndex: toCreateIndex,
  indexCount: indexCount,
  uniqueIndexes: uniqueIndexes
};
