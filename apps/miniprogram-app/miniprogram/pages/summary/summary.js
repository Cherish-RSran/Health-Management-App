const helper = require('../../utils/page');
const api = require('../../utils/api');

const OPT_META = [
  { k: 'surgery', label: '手术史' },
  { k: 'history', label: '相关历史病程' },
  { k: 'exam', label: '近期检查报告' },
  { k: 'metric', label: '近期体征' }
];

Page(helper.page({
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

  onLoad(options) {
    this.pid = options.person_id || '';
    this.cid = options.condition_id || '';
  },

  onShow() { this.load(); },

  fetch() {
    const self = this;
    return api.call('summary.options', {}, { silent: true }).then(function (o) {
      self.setData({ options: o.options });
      return self.build(o.options);
    });
  },

  build(options) {
    const self = this;
    return api.call('summary.build', {
      person_id: this.pid,
      condition_id: this.cid || undefined,
      options: options
    }, { silent: true }).then(function (d) {
      return {
        summary: d.summary,
        availability: d.availability,
        options: d.options,
        person: { id: self.pid }
      };
    });
  },

  onToggleOption(e) {
    const k = e.currentTarget.dataset.k;
    const options = Object.assign({}, this.data.options);
    options[k] = !options[k];
    this.setData({ options: options, generating: true });

    const self = this;
    this.build(options).then(function () {
      self.setData({ generating: false });
    }).catch(function () {
      self.setData({ generating: false });
    });
  },

  onShowDoctor() {
    if (!this.data.summary) return;
    this.setData({ mode: 'doctor' });
  },

  onExitDoctor() {
    this.setData({ mode: 'config' });
  },

  onExport() {
    const self = this;
    wx.showActionSheet({
      itemList: ['复制文本', '转发给医生', '保存为图片'],
      success(res) {
        if (res.tapIndex === 0) return self.doExportText();
        if (res.tapIndex === 1) return self.doForward();
        return self.doExportImage();
      }
    });
  },

  doExportText() {
    const s = this.data.summary;
    if (!s) return;
    const lines = [];
    lines.push('【本次就诊摘要】' + s.header.name + ' · ' + s.header.sex + ' ' + (s.header.age === null ? '' : s.header.age + ' 岁')
      + (s.header.blood_type ? ' · ' + s.header.blood_type + ' 型' : ''));
    lines.push('────────────');
    s.blocks.forEach(function (b) {
      const text = b.items.length ? b.items.map(function (i) { return i.text; }).join('、') : (b.empty_text || '无');
      lines.push(b.label + '：' + text);
    });
    wx.setClipboardData({
      data: lines.join('\n'),
      success: function () { api.toast('摘要已复制，可粘贴发给医生'); }
    });
  },

  /** 转发：分享「摘要页」本身，医生点开即看，无需截图 */
  doForward() {
    if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: false });
    api.toast('点右上角「…」即可转发给医生');
  },

  onShareAppMessage() {
    const s = this.data.summary || {};
    const name = (s.header && s.header.name) || '家人';
    return {
      title: name + ' 的就诊摘要 · 家庭健康档案',
      path: '/pages/summary/summary?person_id=' + (this.pid || '')
        + (this.cid ? '&condition_id=' + this.cid : '')
    };
  },

  /** 保存为图片（canvas 2D 绘制摘要卡片，兜底回退到复制文本） */
  doExportImage() {
    const s = this.data.summary;
    const self = this;
    if (!s) return;
    const q = wx.createSelectorQuery();
    q.select('#exportCanvas').fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) return self.doExportText();
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const W = 640;
      const dpr = wx.getSystemInfoSync().pixelRatio || 2;
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
      ctx.font = (bold(22) ) + ' ' + (20 * dpr) + 'px sans-serif';
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
      wx.canvasToTempFilePath({
        canvas: canvas,
        success: function (r) {
          wx.saveImageToPhotosAlbum({
            filePath: r.tempFilePath,
            success: function () { api.toastOk('已保存到相册'); },
            fail: function () { self.doExportText(); }
          });
        },
        fail: function () { self.doExportText(); }
      });
    });

    function bold() { return '600'; }
    function clip(c, str, maxW, px) {
      if (c.measureText(str).width <= maxW) return str;
      let out = str;
      while (out.length > 1 && c.measureText(out + '…').width > maxW) out = out.slice(0, -1);
      return out + '…';
    }
  }
}));
