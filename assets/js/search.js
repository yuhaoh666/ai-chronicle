/* ============================================================
   search.js · 关键词搜索、线索筛选与命中高亮
   ============================================================ */
(function (global) {
  'use strict';

  var U = global.AICU;

  function buildHaystack(ev) {
    var parts = [
      ev.date, U.formatDate(ev.date), ev.title, ev.summary, ev.background,
      ev.impact, ev.date_note, (ev.actors || []).join(' '),
      (ev.connections || []).join(' ')
    ];
    (ev.concepts || []).forEach(function (c) { parts.push(c.term, c.plain); });
    return parts.join(' \u0001 ').toLowerCase();
  }

  function clearMarks(root) {
    var marks = root.querySelectorAll('mark');
    Array.prototype.forEach.call(marks, function (m) {
      var t = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(t, m);
    });
    if (marks.length) root.normalize();
  }

  function markIn(root, reGlobal, reTest) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) {
      var v = n.nodeValue;
      if (!v || !v.trim()) continue;
      reTest.lastIndex = 0;
      if (reTest.test(v)) nodes.push(n);
    }
    nodes.forEach(function (node) {
      var text = node.nodeValue, m, last = 0;
      var frag = document.createDocumentFragment();
      reGlobal.lastIndex = 0;
      while ((m = reGlobal.exec(text)) !== null) {
        if (m[0] === '') { reGlobal.lastIndex++; continue; }
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var mk = document.createElement('mark');
        mk.textContent = m[0];
        frag.appendChild(mk);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      if (frag.childNodes.length) node.parentNode.replaceChild(frag, node);
    });
  }

  /**
   * 告诉用户"这条是被哪个字段命中的"。
   * 比自动展开所有命中卡片更好用：页面高度稳定，扫读不会被撑爆。
   */
  var FIELD_LABELS = [
    ['title', '标题'],
    ['summary', '概述'],
    ['concepts', '术语'],
    ['background', '来龙去脉'],
    ['impact', '影响'],
    ['actors', '机构'],
    ['connections', '关联']
  ];

  function hitFields(ev, terms) {
    var hit = function (text) {
      if (!text) return false;
      var lower = String(text).toLowerCase();
      return terms.some(function (t) { return lower.indexOf(t) !== -1; });
    };
    return FIELD_LABELS.filter(function (pair) {
      var key = pair[0];
      if (key === 'concepts') {
        return (ev.concepts || []).some(function (c) { return hit(c.term) || hit(c.plain); });
      }
      if (key === 'actors' || key === 'connections') {
        return (ev[key] || []).some(hit);
      }
      return hit(ev[key]);
    }).map(function (p) { return p[1]; });
  }

  function setHitTag(article, labels) {
    var meta = article.querySelector('.card-meta');
    if (!meta) return;
    var old = meta.querySelector('.hit-tags');
    if (old) old.remove();
    if (!labels.length) return;
    var shown = labels.slice(0, 3);
    var span = document.createElement('span');
    span.className = 'hit-tags';
    span.title = '这条被以下位置命中：' + labels.join('、');
    span.textContent = '命中 ' + shown.join(' · ') + (labels.length > shown.length ? ' …' : '');
    meta.appendChild(span);
  }

  function clearHitTags(root) {
    U.qsa('.hit-tags', root).forEach(function (n) { n.remove(); });
  }

  /**
   * @param {Object} opts
   *   events    规范化后的事件数组
   *   container  时间线容器
   *   index      AITimeline.render 的返回值
   *   onResults  function({shown, total, query, filter, first})
   */
  function create(opts) {
    var events = opts.events;
    var container = opts.container;
    var index = opts.index;
    var onResults = opts.onResults || function () {};

    var hay = new Map();
    events.forEach(function (ev) { hay.set(ev.id, buildHaystack(ev)); });

    var state = { query: '', filter: 'all' };

    function match(ev) {
      if (state.filter !== 'all' && ev.category !== state.filter) return false;
      if (!state.query) return true;
      var terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
      var text = hay.get(ev.id) || '';
      return terms.every(function (t) { return text.indexOf(t) !== -1; });
    }

    function run(query, filter) {
      if (typeof query === 'string') state.query = query.trim();
      if (filter) state.filter = filter;

      // 1. 先清掉上一次的高亮与命中标签
      clearMarks(container);
      clearHitTags(container);

      var terms = state.query ? state.query.toLowerCase().split(/\s+/).filter(Boolean) : [];

      // 2. 逐条判定（不自动展开：页面高度保持稳定，便于扫读）
      var shown = 0, first = null;
      events.forEach(function (ev) {
        var article = index.byId.get(ev.id);
        if (!article) return;
        var ok = match(ev);
        article.classList.toggle('is-hidden', !ok);
        if (ok) {
          shown++;
          if (!first) first = article;
          if (terms.length) setHitTag(article, hitFields(ev, terms));
        }
      });

      // 3. 年份分组：整组都被过滤掉就隐藏
      U.qsa('.year', container).forEach(function (sec) {
        var visible = U.qsa('.event:not(.is-hidden)', sec).length;
        sec.classList.toggle('is-hidden', visible === 0);
        var cnt = sec.querySelector('.yp-count');
        if (cnt) {
          var total = U.qsa('.event', sec).length;
          cnt.textContent = visible === total ? total + ' 条' : visible + ' / ' + total + ' 条';
        }
      });

      // 4. 命中高亮
      if (state.query) {
        var terms = state.query.split(/\s+/).filter(Boolean).map(U.escapeRegExp);
        if (terms.length) {
          var reGlobal = new RegExp('(' + terms.join('|') + ')', 'gi');
          var reTest = new RegExp('(' + terms.join('|') + ')', 'i');
          U.qsa('.event:not(.is-hidden)', container).forEach(function (a) {
            markIn(a, reGlobal, reTest);
          });
        }
      }

      onResults({
        shown: shown,
        total: events.length,
        query: state.query,
        filter: state.filter,
        first: first
      });
    }

    return {
      run: run,
      getState: function () { return { query: state.query, filter: state.filter }; },
      clear: function () { run('', 'all'); }
    };
  }

  global.AISearch = { create: create };
})(window);
