/**
 * 长按指令 v-longpress —— 对应小程序的 bindlongpress
 *
 * 浏览器没有长按事件，用 touch 计时实现；触发后要把紧随的 click 吞掉，
 * 否则会出现「长按弹菜单 + 顺带点了一下」的双触发。
 */

const DELAY = 500;

export const longpress = {
  mounted: function (el, binding) {
    const value = binding.value;
    const handler = typeof value === 'function' ? value : (value && value.handler);
    if (!handler) return;

    let timer = null;
    let sx = 0;
    let sy = 0;

    function pos(e) { return e.touches && e.touches[0] ? e.touches[0] : e; }

    function clear() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    function start(e) {
      const p = pos(e);
      sx = p.clientX; sy = p.clientY;
      clear();
      timer = setTimeout(function () {
        timer = null;
        handler(e);
        // 吞掉紧随的 click
        const block = function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener('click', block, { capture: true, once: true });
        setTimeout(function () {
          el.removeEventListener('click', block, { capture: true });
        }, 700);
      }, DELAY);
    }

    function move(e) {
      const p = pos(e);
      if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) clear();
    }

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', clear, { passive: true });
    el.addEventListener('touchcancel', clear, { passive: true });

    el._longpressCleanup = function () {
      clear();
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', clear);
      el.removeEventListener('touchcancel', clear);
    };
  },

  unmounted: function (el) {
    if (el._longpressCleanup) el._longpressCleanup();
  }
};
