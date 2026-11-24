/**
 * 通用表单弹层
 *
 * fields: [{ k, label, type, options, placeholder, hint, required }]
 *   type: text | textarea | number | date | chips（单选）| multi（多选）
 * 使用：
 *   <form-sheet show="{{form.show}}" title="..." fields="{{form.fields}}"
 *               values="{{form.values}}" bind:submit="onFormSubmit" bind:cancel="onFormCancel" />
 */

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    tip: { type: String, value: '' },
    submitText: { type: String, value: '保存' },
    fields: { type: Array, value: [] },
    values: { type: Object, value: {} }
  },

  data: {
    v: {}
  },

  observers: {
    // 只在「打开」时同步一次初值。
    // 若同时监听 values，父级后续任何 setData 都会重置用户正在输入的内容。
    'show': function (show) {
      if (show) this.setData({ v: Object.assign({}, this.data.values || {}) });
    }
  },

  methods: {
    onInput(e) {
      const k = e.currentTarget.dataset.k;
      const d = {};
      d['v.' + k] = e.detail.value;
      this.setData(d);
    },

    onDate(e) {
      const k = e.currentTarget.dataset.k;
      const d = {};
      d['v.' + k] = e.detail.value;
      this.setData(d);
    },

    /** 清空日期（例如短期药改回「长期服用」） */
    onClearDate(e) {
      const k = e.currentTarget.dataset.k;
      const d = {};
      d['v.' + k] = '';
      this.setData(d);
    },

    onChip(e) {
      const k = e.currentTarget.dataset.k;
      const val = e.currentTarget.dataset.v;
      const multi = e.currentTarget.dataset.multi === '1';
      if (!multi) {
        const d = {}; d['v.' + k] = this.data.v[k] === val ? '' : val;
        return this.setData(d);
      }
      const arr = (this.data.v[k] || []).slice();
      const i = arr.indexOf(val);
      if (i >= 0) arr.splice(i, 1); else arr.push(val);
      const d2 = {}; d2['v.' + k] = arr;
      this.setData(d2);
    },

    onSubmit() {
      // 必填校验
      const fields = this.data.fields || [];
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        if (!f.required) continue;
        const val = this.data.v[f.k];
        const empty = val === undefined || val === null || val === ''
          || (Array.isArray(val) && !val.length);
        if (empty) {
          wx.showToast({ title: '请填写：' + (f.label || f.k), icon: 'none' });
          return;
        }
      }
      this.triggerEvent('submit', { values: this.data.v });
    },

    onCancel() {
      this.triggerEvent('cancel');
    },

    noop() {}
  }
});
