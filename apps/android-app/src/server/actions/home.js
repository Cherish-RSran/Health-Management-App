/**
 * 首页仪表盘 + 待办
 *
 * 一期**零推送**：提醒全部站内，首页卡片「看一眼就行」。
 */

import C from '../../core/constants.js';
import V from '../../core/validate.js';
import D from '../../core/date.js';
import M from '../../core/model.js';
import E from '../lib/errors.js';
import auth from '../lib/auth.js';
import timeline from './timeline.js';
import Q from '../lib/query.js';

const DEFAULT_CARD_ORDER = ['meds', 'todos', 'emg', 'quick'];

/* ============================================================================
   首页
   ============================================================================ */
async function dashboard(ctx) {
  const db = ctx.db;
  const now = ctx.now();
  const today = D.todayStr(now);

  // 还没通过审批时，不要报「请先创建家庭」——用户其实已经提交了申请
  if (!ctx.family) {
    if (ctx.pendingJoin) {
      return {
        needs_family: true,
        join_status: C.JOIN_STATUS.pending,
        pending_family_name: (ctx.pendingFamily && ctx.pendingFamily.name) || '家庭',
        family: null, persons: [], medicines: [], todos: [],
        pending_count: 0, is_admin: false,
        setting: { large_font: false, card_order: DEFAULT_CARD_ORDER.slice() },
        today: today
      };
    }
    E.fail(C.ERR.E_NO_FAMILY, '请先创建或加入家庭');
  }

  // 1. 可见档案
  const ids = await timeline.accessiblePersonIds(ctx);
  let persons = [];
  if (ids.length) {
    const pr = await db.collection(C.COLL.person)
      .where({ _id: db.command.in(ids), status: C.RECORD_STATUS.active })
      .orderBy('created_at', 'asc')
      .limit(C.MAX_PAGE_SIZE)
      .get();
    persons = pr.data;
  }

  const nameOf = {};
  persons.forEach(function (p) { nameOf[p._id] = p.name; });

  // 2. 「今天要吃的药」——按人 × 早/中/晚分组，只显示在服的药
  //    一次批量取回再内存分组，避免按人串行查询（N+1）
  const medsByPerson = {};
  if (ids.length) {
    const mr = await Q.fetchAll(db, C.COLL.medicine, {
      person_id: db.command.in(ids),
      status: C.RECORD_STATUS.active
    });
    mr.rows.forEach(function (m) {
      if (!medsByPerson[m.person_id]) medsByPerson[m.person_id] = [];
      medsByPerson[m.person_id].push(m);
    });
  }

  const medicines = [];
  persons.forEach(function (p) {
    const groups = M.groupMedsBySlot(medsByPerson[p._id] || [], today);
    if (!groups.length) return;

    medicines.push({
      person: {
        id: p._id, name: p.name, relation: p.relation || '',
        age: D.calcAge(p.birth_date, today)
      },
      groups: groups.map(function (g) {
        return {
          slot: g.slot,
          label: g.label,
          items: g.items.map(function (m) {
            return {
              id: m._id,
              name: m.name,
              spec: m.spec || '',
              is_short_term: !!m.end_date,
              period_text: M.medPeriodText(m),
              remaining: (m.remaining === undefined || m.remaining === null) ? null : m.remaining,
              refill_at: m.refill_at || '',
              refill_hint: medRefillHint(m, today)
            };
          })
        };
      })
    });
  });

  // 3. 今日待办
  let todos = [];
  if (ids.length) {
    const tr = await db.collection(C.COLL.todo)
      .where({
        family_id: ctx.familyId,
        person_id: db.command.in(ids),
        status: db.command.neq(C.TODO_STATUS.skipped)
      })
      .orderBy('due_date', 'asc')
      .limit(C.MAX_PAGE_SIZE)
      .get();
    todos = tr.data.map(function (t) { return todoOut(t, today, nameOf); });
  }

  // 4. 待审批人数（仅管理员可见）
  let pendingCount = 0;
  if (ctx.isAdmin()) {
    const cr = await db.collection(C.COLL.userFamily)
      .where({ family_id: ctx.familyId, join_status: C.JOIN_STATUS.pending })
      .limit(C.MAX_PAGE_SIZE)
      .get();
    pendingCount = cr.data.length;
  }

  // 5. 用户设置（卡片顺序、大字模式）
  const st = await auth.findOne(db, C.COLL.userSetting, ctx.openid);

  return {
    family: {
      id: ctx.family._id,
      name: ctx.family.name,
      invite_code: ctx.isAdmin() ? ctx.family.invite_code : '',
      member_count: ctx.family.member_count || 0
    },
    is_admin: ctx.isAdmin(),
    persons: persons.map(function (p) {
      return {
        id: p._id, name: p.name, relation: p.relation || '',
        gender: p.gender, age: D.calcAge(p.birth_date, today),
        blood_type: p.blood_type || '', profile_type: p.profile_type,
        avatar_url: p.avatar_url || ''
      };
    }),
    medicines: medicines,
    todos: todos,
    pending_count: pendingCount,
    setting: {
      large_font: !!(st && st.large_font),
      card_order: (st && st.card_order && st.card_order.length) ? st.card_order : DEFAULT_CARD_ORDER.slice()
    },
    today: today
  };
}

/* ============================================================================
   待办
   ============================================================================ */
function urgencyOf(t, today) {
  if (t.status === C.TODO_STATUS.done) return 'done';
  const d = D.daysBetween(t.due_date, today);   // 正数 = 还没到
  if (isNaN(d)) return 'normal';
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 3) return 'soon';
  return 'normal';
}

/** 用药余量 / 续方提示（站内，不依赖推送） */
function medRefillHint(m, today) {
  const hints = [];
  if (m.remaining !== undefined && m.remaining !== null && !isNaN(m.remaining) && m.remaining <= 3) {
    hints.push('余量不足 ' + m.remaining);
  }
  if (m.refill_at) {
    const d = D.daysBetween(m.refill_at, today);
    if (!isNaN(d)) {
      if (d < 0) hints.push('续方已逾期 ' + Math.abs(d) + ' 天');
      else if (d === 0) hints.push('今天该续方');
      else if (d <= 7) hints.push(D.relativeDay(m.refill_at, today) + ' 该续方');
    }
  }
  return hints.join(' · ');
}

function todoOut(t, today, nameOf) {
  const urgency = urgencyOf(t, today);
  return {
    id: t._id,
    person_id: t.person_id,
    person_name: (nameOf && nameOf[t.person_id]) || '',
    type: t.type,
    title: t.title,
    due_date: t.due_date,
    due_label: D.fmtMD(t.due_date),
    urgency: urgency,
    urgency_text: {
      overdue: '已逾期 ' + Math.abs(D.daysBetween(t.due_date, today)) + ' 天',
      today: '今天',
      soon: D.relativeDay(t.due_date, today),
      normal: D.relativeDay(t.due_date, today),
      done: '已完成'
    }[urgency],
    status: t.status,
    is_done: t.status === C.TODO_STATUS.done,
    note: t.note || '',
    source_table: t.source_table || '',
    source_id: t.source_id || '',
    created_at: t.created_at || 0,
    done_at: t.done_at || null
  };
}

async function todoList(ctx, payload) {
  ctx.assureFamily();
  const today = D.todayStr(ctx.now());
  const ids = await timeline.accessiblePersonIds(ctx);
  if (!ids.length) return { todos: [], today: today };

  const r = await ctx.db.collection(C.COLL.todo)
    .where({
      family_id: ctx.familyId,
      person_id: ctx.db.command.in(ids),
      // 已删除（skipped）的不返回
      status: ctx.db.command.neq(C.TODO_STATUS.skipped)
    })
    .orderBy('due_date', 'asc')
    .limit(C.MAX_PAGE_SIZE)
    .get();

  const nameOf = {};
  const pr = await ctx.db.collection(C.COLL.person)
    .where({ _id: ctx.db.command.in(ids), status: C.RECORD_STATUS.active })
    .limit(C.MAX_PAGE_SIZE).get();
  pr.data.forEach(function (p) { nameOf[p._id] = p.name; });

  return {
    todos: r.data.map(function (t) { return todoOut(t, today, nameOf); }),
    today: today
  };
}

async function todoAdd(ctx, payload) {
  ctx.assureFamily();
  const r = V.validate({
    person_id: { type: 'string', required: true, max: 64, label: '成员' },
    type: { type: 'enum', values: ['recheck', 'vaccine', 'exam', 'custom'], default: 'custom', label: '类型' },
    title: { type: 'string', required: true, max: 40, label: '事项' },
    due_date: { type: 'date', required: true, label: '日期' },
    remind_ahead_days: { type: 'number', min: 0, max: 30, default: 3, label: '提前天数' },
    note: { type: 'string', max: 200, label: '备注' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const person = await ctx.requireAccess(r.value.person_id, C.ACCESS.read);
  const now = ctx.now();

  const res = await ctx.db.collection(C.COLL.todo).add({
    data: {
      family_id: ctx.familyId,
      person_id: person._id,
      type: r.value.type,
      title: r.value.title,
      due_date: r.value.due_date,
      remind_ahead_days: r.value.remind_ahead_days === undefined ? 3 : r.value.remind_ahead_days,
      status: C.TODO_STATUS.pending,
      source_table: '',
      source_id: '',
      note: r.value.note || '',
      created_at: now,
      created_by: ctx.openid
    }
  });

  await ctx.audit({
    action: 'create', target_table: C.COLL.todo, target_id: res._id,
    person_id: person._id, detail: { title: r.value.title }
  });

  const row = await auth.findOne(ctx.db, C.COLL.todo, res._id);
  const nameOf = {};
  nameOf[person._id] = person.name;
  return { todo: todoOut(row, D.todayStr(now), nameOf) };
}

async function todoUpdate(ctx, payload) {
  const r = V.validate({
    todo_id: { type: 'string', required: true, max: 64, label: '待办' },
    title: { type: 'string', max: 40, label: '事项' },
    due_date: { type: 'date', label: '日期' },
    note: { type: 'string', max: 200, label: '备注' },
    status: { type: 'enum', values: ['pending', 'done', 'skipped'], label: '状态' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const todo = await loadTodo(ctx, r.value.todo_id);

  const patch = {};
  if (r.value.title !== undefined) patch.title = r.value.title;
  if (r.value.due_date !== undefined) patch.due_date = r.value.due_date;
  if (r.value.note !== undefined) patch.note = r.value.note;
  if (r.value.status !== undefined) {
    patch.status = r.value.status;
    patch.done_at = r.value.status === C.TODO_STATUS.done ? ctx.now() : null;
  }

  await ctx.db.collection(C.COLL.todo).doc(todo._id).update({ data: patch });
  await ctx.audit({
    action: 'update', target_table: C.COLL.todo, target_id: todo._id, person_id: todo.person_id
  });

  const row = await auth.findOne(ctx.db, C.COLL.todo, todo._id);
  return { todo: todoOut(row, D.todayStr(ctx.now()), null) };
}

/** 完成 / 取消完成（幂等） */
async function todoToggle(ctx, payload) {
  const r = V.validate({
    todo_id: { type: 'string', required: true, max: 64, label: '待办' },
    done: { type: 'bool', label: '是否完成' }
  }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const todo = await loadTodo(ctx, r.value.todo_id);
  const target = r.value.done === undefined ? !(todo.status === C.TODO_STATUS.done) : r.value.done === true;
  const newStatus = target ? C.TODO_STATUS.done : C.TODO_STATUS.pending;

  if (todo.status === newStatus) {
    const row0 = await auth.findOne(ctx.db, C.COLL.todo, todo._id);
    return { todo: todoOut(row0, D.todayStr(ctx.now()), null), already: true };
  }

  await ctx.db.collection(C.COLL.todo).doc(todo._id).update({
    data: { status: newStatus, done_at: target ? ctx.now() : null }
  });
  await ctx.audit({
    action: 'update', target_table: C.COLL.todo, target_id: todo._id,
    person_id: todo.person_id, detail: { done: target }
  });

  const row = await auth.findOne(ctx.db, C.COLL.todo, todo._id);
  return { todo: todoOut(row, D.todayStr(ctx.now()), null), already: false };
}

async function todoRemove(ctx, payload) {
  const r = V.validate({ todo_id: { type: 'string', required: true, max: 64, label: '待办' } }, payload);
  E.assert(r.ok, C.ERR.E_INVALID_PARAM, V.firstError(r));

  const todo = await loadTodo(ctx, r.value.todo_id);
  await ctx.db.collection(C.COLL.todo).doc(todo._id).update({
    data: { status: C.TODO_STATUS.skipped }
  });
  await ctx.audit({
    action: 'delete', target_table: C.COLL.todo, target_id: todo._id, person_id: todo.person_id
  });
  return { ok: true };
}

async function loadTodo(ctx, todoId) {
  const t = await auth.findOne(ctx.db, C.COLL.todo, todoId);
  E.assert(t && t.family_id === ctx.familyId, C.ERR.E_NOT_FOUND, '待办不存在');
  await ctx.requireAccess(t.person_id, C.ACCESS.read);
  return t;
}

const __exports = {
  dashboard: dashboard,
  todoList: todoList,
  todoAdd: todoAdd,
  todoUpdate: todoUpdate,
  todoToggle: todoToggle,
  todoRemove: todoRemove,
  todoOut: todoOut,
  urgencyOf: urgencyOf
};
export { dashboard };
export { todoList };
export { todoAdd };
export { todoUpdate };
export { todoToggle };
export { todoRemove };
export { todoOut };
export { urgencyOf };
export default __exports;
