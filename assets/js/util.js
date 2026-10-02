/* ============================================================
   util.js · 通用工具
   ============================================================ */
(function (global) {
  'use strict';

  var U = {};

  /* ---------- 文本 ---------- */

  U.escapeHtml = function (str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  U.escapeRegExp = function (str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  /** 清掉 markdown 残留、统一标点，让正文看起来干净 */
  U.cleanText = function (str) {
    return String(str == null ? '' : str)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*#{1,6}\s*/gm, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s*\n\s*/g, ' ')
      .trim();
  };

  /** "2026-10-02" → "2026年10月2日" */
  U.formatDate = function (iso) {
    var s = String(iso || '').trim();
    var m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (!m) return s;
    var y = m[1];
    if (!m[2]) return y + '年';
    var mo = parseInt(m[2], 10);
    if (!m[3]) return y + '年' + mo + '月';
    return y + '年' + mo + '月' + parseInt(m[3], 10) + '日';
  };

  /** 只取年份数字 */
  U.yearOf = function (iso) {
    var m = String(iso || '').match(/^(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  };

  /**
   * summary 拆成「发生了什么 / 为什么重要 / 对一般社会公众意味着什么」三段。
   * 优先按箭头拆；没有箭头就按句号切成三组；都不行就整段返回。
   */
  var STEP_LABELS = ['发生了什么', '为什么重要', '对一般社会公众意味着什么'];

  U.splitSummary = function (summary) {
    var text = U.cleanText(summary);
    if (!text) return [];

    var parts = text.split(/\s*(?:→|->|➜|⇒)\s*/).map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; });

    if (parts.length >= 2) {
      return parts.slice(0, 3).map(function (t, i) {
        return { label: STEP_LABELS[i] || ('第' + (i + 1) + '点'), text: t };
      });
    }

    var sentences = text.match(/[^。！？!?]+[。！？!?]?/g) || [text];
    sentences = sentences.map(function (t) { return t.trim(); }).filter(Boolean);
    if (sentences.length >= 3) {
      var n = sentences.length;
      var a = Math.ceil(n / 3);
      var b = Math.ceil((n - a) / 2) + a;
      return [
        { label: STEP_LABELS[0], text: sentences.slice(0, a).join('') },
        { label: STEP_LABELS[1], text: sentences.slice(a, b).join('') },
        { label: STEP_LABELS[2], text: sentences.slice(b).join('') }
      ].filter(function (s) { return s.text; });
    }
    return [{ label: STEP_LABELS[0], text: text }];
  };

  /** 折叠卡片上的摘要：去掉三段之间的箭头，读起来像一句话 */
  U.summaryPlain = function (summary) {
    return U.cleanText(summary)
      .split(/\s*(?:→|->|➜|⇒)\s*/)
      .map(function (t) { return t.trim(); })
      .filter(Boolean)
      .join(' ');
  };

  /* ---------- 搜索高亮 ---------- */
  U.highlight = function (text, query) {
    var safe = U.escapeHtml(text);
    if (!query) return safe;
    var terms = String(query).trim().split(/\s+/).filter(function (t) { return t.length > 0; });
    if (!terms.length) return safe;
    var re = new RegExp('(' + terms.map(U.escapeRegExp).join('|') + ')', 'gi');
    // 只在标签之外替换：这里 safe 已经没有裸 < >，因此简单替换是安全的
    return safe.replace(re, '<mark>$1</mark>');
  };

  /* ---------- DOM ---------- */

  U.el = function (tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  };

  U.qs = function (sel, root) { return (root || document).querySelector(sel); };
  U.qsa = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* ---------- 杂项 ---------- */

  U.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 160);
    };
  };

  U.throttle = function (fn, wait) {
    var last = 0, timer = null, lastArgs = null;
    return function () {
      var now = Date.now(), self = this;
      lastArgs = arguments;
      if (now - last >= (wait || 60)) { last = now; fn.apply(self, lastArgs); }
      else if (!timer) {
        timer = setTimeout(function () {
          timer = null; last = Date.now(); fn.apply(self, lastArgs);
        }, (wait || 60) - (now - last));
      }
    };
  };

  U.clamp = function (v, min, max) { return Math.max(min, Math.min(max, v)); };

  var PREFIX = 'ai-chronicle.';
  U.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* 隐私模式忽略 */ }
    },
    del: function (key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
    }
  };

  /** 域名简称，用于来源链接的显示 */
  U.prettyHost = function (url) {
    try {
      var h = new URL(url).hostname.replace(/^www\./, '');
      return h;
    } catch (e) { return String(url).slice(0, 40); }
  };

  global.AICU = U;
})(window);
