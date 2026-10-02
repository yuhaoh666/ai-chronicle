/* ============================================================
   app.js · 装配：数据规范化 → 渲染 → 导航条 → 搜索 → 术语表
   ============================================================ */
(function (global) {
  'use strict';

  var U = global.AICU;

  /* ============================================================
     数据规范化
     ============================================================ */

  var YEAR_ORDER = ['prehistory', '2022', '2023', '2024', '2025', '2026'];
  var ERA_SHORT = {
    prehistory: { label: 'AI 前史', year: 1956, note: '从达特茅斯会议到 AlphaGo' },
    2022: { label: '2022', year: 2022, note: 'ChatGPT 时刻' },
    2023: { label: '2023', year: 2023, note: '百模大战' },
    2024: { label: '2024', year: 2024, note: '多模态与推理' },
    2025: { label: '2025', year: 2025, note: '推理模型 · 智能体' },
    2026: { label: '2026', year: 2026, note: '智能体开始干活' }
  };

  // 用来画「AI 能力增长曲线」的示意指数（0-100）
  var CAPABILITY = { prehistory: 3, 2022: 14, 2023: 27, 2024: 45, 2025: 74, 2026: 100 };

  function normalize(raw) {
    var list = (raw || []).filter(function (e) { return e && e.date && e.title; });
    list.forEach(function (ev, i) {
      ev.id = ev.id || ('e' + (1000 + i));
      ev.title = U.cleanText(ev.title);
      ev.summary = U.cleanText(ev.summary);
      ev.background = U.cleanText(ev.background);
      ev.impact = U.cleanText(ev.impact);
      ev.date_note = U.cleanText(ev.date_note || '');
      ev.category = ev.category === 'social' ? 'social' : 'technical';
      ev.actors = Array.isArray(ev.actors) ? ev.actors.filter(Boolean) : [];
      ev.sources = Array.isArray(ev.sources) ? ev.sources.filter(Boolean) : [];
      ev.connections = Array.isArray(ev.connections) ? ev.connections.filter(Boolean) : [];
      ev.concepts = (Array.isArray(ev.concepts) ? ev.concepts : [])
        .filter(function (c) { return c && c.term && c.plain; })
        .map(function (c) { return { term: U.cleanText(c.term), plain: U.cleanText(c.plain) }; });

      var y = U.yearOf(ev.date);
      ev.year = y;
      ev.yearKey = (y && y >= 2022) ? String(y) : 'prehistory';
    });

    list.sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
    return list;
  }

  function buildGlossary(events) {
    var map = new Map();
    events.forEach(function (ev) {
      ev.concepts.forEach(function (c) {
        var key = c.term.toLowerCase();
        if (!map.has(key)) map.set(key, { term: c.term, plain: c.plain, count: 0, firstEvent: ev });
        map.get(key).count++;
      });
    });
    return Array.from(map.values()).sort(function (a, b) {
      return b.count - a.count || a.term.localeCompare(b.term);
    });
  }

  /* ============================================================
     主题切换（默认浅色，可切回深色）
     ============================================================ */

  function setupTheme(onChange) {
    var btn = U.qs('#themeToggle');
    var root = document.documentElement;

    function sync() {
      var dark = root.dataset.theme === 'dark';
      if (btn) {
        btn.textContent = dark ? '☀️' : '🌙';
        btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        btn.title = dark ? '切换到浅色主题' : '切换到深色主题';
      }
    }

    sync();
    if (btn) {
      btn.addEventListener('click', function () {
        var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        U.store.set('theme', next);
        sync();
        document.dispatchEvent(new CustomEvent('aichronicle:theme', { detail: next }));
        if (onChange) onChange(next);
      });
    }
    return { sync: sync };
  }

  /* ============================================================
     启动
     ============================================================ */

  function boot() {
    var raw = (global.AI_CHRONICLE && global.AI_CHRONICLE.events) || [];
    var declaredGlossary = (global.AI_CHRONICLE_GLOSSARY || []);
    var events = normalize(raw);

    var timelineEl = U.qs('#timeline');
    var emptyNote = U.qs('#emptyNote');
    var navCtl = null;

    if (!events.length) {
      if (emptyNote) emptyNote.hidden = false;
      U.qs('#statEvents').textContent = '0';
      return;
    }

    /* ---------- 统计 ---------- */
    var techCount = events.filter(function (e) { return e.category === 'technical'; }).length;
    var socialCount = events.length - techCount;
    var glossary = buildGlossary(events);
    var glossaryAll = glossary.length ? glossary : declaredGlossary.map(function (g) {
      return { term: g.term, plain: g.plain, count: 0 };
    });

    U.qs('#statEvents').textContent = events.length;
    U.qs('#statTech').textContent = techCount;
    U.qs('#statSocial').textContent = socialCount;
    U.qs('#statConcepts').textContent = glossaryAll.length;
    U.qs('#footCount').textContent = events.length;

    /* ---------- 渲染时间线 ---------- */
    var index = AITimeline.render(timelineEl, events);

    /* ---------- 划词解释 ---------- */
    var explainer = global.AIExplainer.create({ glossary: glossaryAll });
    U.qs('#footSettings').addEventListener('click', function () { explainer.openSettings(); });

    /* ---------- 搜索 ---------- */
    var searchInput = U.qs('#searchInput');
    var searchClear = U.qs('#searchClear');
    var resultBar = U.qs('#resultBar');
    var resultText = U.qs('#resultText');
    var chips = U.qsa('.chip');

    var search = global.AISearch.create({
      events: events,
      container: timelineEl,
      index: index,
      onResults: function (r) {
        var filtering = !!r.query || r.filter !== 'all';
        resultBar.hidden = !filtering;
        searchClear.hidden = !r.query;
        if (filtering) {
          resultText.innerHTML = '找到 <b>' + r.shown + '</b> 条' +
            (r.filter !== 'all' ? '（' + (r.filter === 'technical' ? '技术线' : '社会线') + '）' : '') +
            (r.query ? ' · 关键词「' + U.escapeHtml(r.query) + '」' : '');
        }
        if (emptyNote) emptyNote.hidden = r.shown !== 0;
        if (navCtl) navCtl.remeasure();
      }
    });

    var runSearch = U.debounce(function () {
      search.run(searchInput.value, null);
    }, 190);

    searchInput.addEventListener('input', runSearch);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { searchInput.value = ''; search.run('', null); searchInput.blur(); }
      if (e.key === 'Enter') {
        var first = U.qs('.event:not(.is-hidden)', timelineEl);
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    searchClear.addEventListener('click', function () {
      searchInput.value = '';
      search.run('', null);
      searchInput.focus();
    });
    U.qs('#resultReset').addEventListener('click', function () {
      searchInput.value = '';
      chips.forEach(function (c) { c.classList.toggle('is-active', c.dataset.filter === 'all'); });
      search.run('', 'all');
    });
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        search.run(null, chip.dataset.filter);
      });
    });

    // 按 / 聚焦搜索框
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });

    /* ---------- 全部展开 / 折叠 ---------- */
    U.qs('#expandAllBtn').addEventListener('click', function () {
      U.qsa('.event:not(.is-hidden)', timelineEl).forEach(function (a) { AITimeline.setOpen(a, true); });
    });
    U.qs('#collapseAllBtn').addEventListener('click', function () {
      U.qsa('.event', timelineEl).forEach(function (a) { AITimeline.setOpen(a, false); });
    });

    /* ---------- 术语总表 ---------- */
    var grid = U.qs('#glossaryGrid');
    U.qs('#glossaryCount').textContent = glossaryAll.length + ' 个术语';
    grid.innerHTML = glossaryAll.map(function (g) {
      return '<dl class="gloss-item" data-term="' + U.escapeHtml(g.term) + '">' +
        '<dt>' + U.escapeHtml(g.term) + '</dt>' +
        '<dd>' + U.escapeHtml(U.cleanText(g.plain)) + '</dd></dl>';
    }).join('');

    grid.addEventListener('click', function (e) {
      var item = e.target.closest('.gloss-item');
      if (!item) return;
      var term = item.dataset.term;
      var host = findEventWithTerm(events, term);
      if (!host) return;
      var article = index.byId.get(host.id);
      if (!article) return;
      AITimeline.setOpen(article, true);
      setTimeout(function () {
        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var concept = article.querySelector('.concept[data-term="' + cssEscape(term) + '"]');
        if (concept) {
          concept.style.transition = 'box-shadow .3s';
          concept.style.boxShadow = '0 0 0 3px rgba(139,92,246,.55)';
          setTimeout(function () { concept.style.boxShadow = 'none'; }, 1600);
        }
      }, 60);
    });

    function findEventWithTerm(list, term) {
      var lower = String(term).toLowerCase();
      for (var i = 0; i < list.length; i++) {
        if ((list[i].concepts || []).some(function (c) { return c.term.toLowerCase() === lower; })) return list[i];
      }
      return null;
    }

    function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

    /* ---------- 时间轴导航条 ---------- */
    navCtl = setupNav(events, timelineEl, index);

    /* ---------- 回到顶部 ---------- */
    var toTop = U.qs('#toTop');
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    /* ---------- 深链接 #event-xxx ---------- */
    if (location.hash && location.hash.indexOf('#event-') === 0) {
      var target = document.getElementById(location.hash.slice(1));
      if (target && target.classList.contains('event')) {
        AITimeline.setOpen(target, true);
        setTimeout(function () { target.scrollIntoView({ block: 'center' }); }, 200);
      }
    }

    /* ---------- 主题 ---------- */
    function pushTheme() {
      if (explainer && explainer.setTheme) {
        explainer.setTheme(document.documentElement.dataset.theme);
      }
    }
    setupTheme(function () {
      if (navCtl) navCtl.remeasure();
      pushTheme();
    });
    pushTheme();
  }

  /* ============================================================
     顶部时间轴：拖动 + 点击年份 + 随滚动联动
     ============================================================ */

  function setupNav(events, timelineEl, index) {
    var track = U.qs('#track');
    var thumb = U.qs('#trackThumb');
    var fill = U.qs('#trackFill');
    var ticksEl = U.qs('#trackTicks');
    var legendEl = U.qs('#trackLegend');
    var cursorEl = U.qs('#navCursor');
    var curvePath = U.qs('#curvePath');

    var years = YEAR_ORDER.filter(function (y) {
      return U.qs('#year-' + y, timelineEl);
    });

    var anchors = [];      // { year, p, scrollY }
    var domain = { start: 0, end: 1 };
    var dragging = false;

    function stickyOffset() {
      var nav = U.qs('#nav');
      var tb = U.qs('#toolbar');
      return (nav ? nav.offsetHeight : 0) + (tb ? tb.offsetHeight : 0) + 8;
    }

    /** 吸顶区域高度随窗口宽度变化，交给 JS 量准，别写死在 CSS 里 */
    function syncSticky() {
      var nav = U.qs('#nav');
      var tb = U.qs('#toolbar');
      if (!nav) return;
      document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px');
      // 跳转锚点要留出吸顶区的高度，否则年份胶囊会被压住
      var pad = nav.offsetHeight + (tb ? tb.offsetHeight : 0) + 28;
      document.documentElement.style.scrollPaddingTop = pad + 'px';
    }

    function measure() {
      syncSticky();
      anchors = [];
      var off = stickyOffset();
      var docTop = function (el) {
        return el.getBoundingClientRect().top + window.scrollY;
      };

      var firstTop = docTop(U.qs('#year-' + years[0], timelineEl));
      var lastSec = U.qs('#year-' + years[years.length - 1], timelineEl);
      var lastBottom = docTop(lastSec) + lastSec.offsetHeight;
      var maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      domain.start = U.clamp(firstTop - off, 0, maxScroll);
      domain.end = U.clamp(lastBottom - window.innerHeight * 0.55, domain.start + 1, maxScroll);

      years.forEach(function (y) {
        var sec = U.qs('#year-' + y, timelineEl);
        var top = U.clamp(docTop(sec) - off, domain.start, domain.end);
        var p = (top - domain.start) / (domain.end - domain.start);
        anchors.push({ year: y, sec: sec, p: p, scrollY: top });
      });
    }

    function scrollFromP(p) {
      return domain.start + U.clamp(p, 0, 1) * (domain.end - domain.start);
    }

    function pFromScroll(y) {
      var span = domain.end - domain.start;
      return span > 0 ? U.clamp((y - domain.start) / span, 0, 1) : 0;
    }

    /* --- 刻度 --- */
    function buildTicks() {
      ticksEl.innerHTML = '';
      anchors.forEach(function (a) {
        var meta = ERA_SHORT[a.year];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tick' + (a.year === 'prehistory' ? ' is-pre' : '');
        btn.dataset.year = a.year;
        btn.style.left = (a.p * 100) + '%';
        btn.innerHTML = '<i></i><span>' + (a.year === 'prehistory' ? '前史' : a.year) + '</span>';
        btn.title = meta ? (meta.label + ' · ' + meta.note) : a.year;
        btn.addEventListener('click', function () {
          jumpTo(a);
        });
        ticksEl.appendChild(btn);
      });

      legendEl.innerHTML = anchors.map(function (a) {
        var meta = ERA_SHORT[a.year] || {};
        return '<span class="lg ' + (a.year === 'prehistory' ? '' : (Number(a.year) >= 2025 ? 'social' : 'tech')) + '">' +
          '<span><b>' + U.escapeHtml(meta.label || a.year) + '</b> ' + U.escapeHtml(meta.note || '') + '</span></span>';
      }).join('');
    }

    function jumpTo(anchor) {
      window.scrollTo({ top: Math.max(0, anchor.scrollY), behavior: 'smooth' });
    }

    /* --- 能力曲线：按年份刻度画一条指数形状的上升曲线 --- */
    function drawCurve() {
      if (!curvePath) return;
      var area = U.qs('#curveArea');
      var LOW = 56, HIGH = 3;              // viewBox 高度 60
      var pts = anchors.map(function (a) {
        var v = (CAPABILITY[a.year] || 0) / 100;
        return { x: a.p * 1000, y: LOW - v * (LOW - HIGH) };
      });
      if (pts.length < 2) {
        curvePath.setAttribute('d', '');
        if (area) area.setAttribute('d', '');
        return;
      }

      var d = 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[i - 1] || pts[i];
        var p1 = pts[i];
        var p2 = pts[i + 1];
        var p3 = pts[i + 2] || p2;
        var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
        var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
        d += ' C ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ', ' +
          c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ', ' +
          p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
      }
      curvePath.setAttribute('d', d);
      if (area) {
        area.setAttribute('d', d + ' L ' + pts[pts.length - 1].x.toFixed(1) + ' 60 L ' +
          pts[0].x.toFixed(1) + ' 60 Z');
      }
    }

    /* --- 滚动联动 --- */
    var currentYear = null;

    function paint() {
      var y = window.scrollY;
      var p = pFromScroll(y);
      if (!dragging) {
        thumb.style.left = (p * 100) + '%';
        fill.style.width = (p * 100) + '%';
      }

      // 找到当前所在年份
      var active = anchors[0];
      for (var i = 0; i < anchors.length; i++) {
        if (y >= anchors[i].scrollY - 40) active = anchors[i];
      }
      var key = active ? active.year : null;
      if (key !== currentYear) {
        currentYear = key;
        U.qsa('.tick', ticksEl).forEach(function (t) {
          t.classList.toggle('is-active', t.dataset.year === key);
        });
        if (active) {
          var meta = ERA_SHORT[active.year] || {};
          cursorEl.innerHTML = U.escapeHtml(meta.label || active.year) +
            '<em>' + U.escapeHtml(meta.note || '') + '</em>';
          track.setAttribute('aria-valuenow', meta.year || 2026);
        }
      }

      var show = y > 600;
      U.qs('#toTop').hidden = !show;
    }

    /* --- 拖动 --- */
    function pointerP(clientX) {
      var rect = track.getBoundingClientRect();
      return U.clamp((clientX - rect.left) / rect.width, 0, 1);
    }

    function onDown(e) {
      if (e.target.closest('.tick')) return;   // 点刻度走点击逻辑
      dragging = true;
      track.classList.add('is-dragging');
      // 拖动期间必须关掉平滑滚动，否则滚动动画追不上手指
      document.documentElement.style.scrollBehavior = 'auto';
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      onMove(e);
    }

    function onMove(e) {
      if (!dragging) return;
      var p = pointerP(e.clientX);
      thumb.style.left = (p * 100) + '%';
      fill.style.width = (p * 100) + '%';
      window.scrollTo(0, scrollFromP(p));
      e.preventDefault();
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('is-dragging');
      document.documentElement.style.scrollBehavior = '';
      try { track.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }

    track.addEventListener('pointerdown', onDown);
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);

    // 键盘可访问性
    track.addEventListener('keydown', function (e) {
      var idx = anchors.findIndex(function (a) { return a.year === currentYear; });
      if (idx < 0) idx = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault(); jumpTo(anchors[Math.min(idx + 1, anchors.length - 1)]);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault(); jumpTo(anchors[Math.max(idx - 1, 0)]);
      } else if (e.key === 'Home') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (e.key === 'End') { e.preventDefault(); jumpTo(anchors[anchors.length - 1]); }
    });

    /* --- 尺寸变化时重新测量 --- */
    var relayout = U.debounce(function () {
      measure(); buildTicks(); drawCurve(); paint();
    }, 180);

    if (global.ResizeObserver) {
      var ro = new ResizeObserver(relayout);
      ro.observe(document.body);
    }
    window.addEventListener('resize', relayout);

    // 卡片展开会改变文档高度 → 重测
    timelineEl.addEventListener('transitionend', function (e) {
      if (e.propertyName === 'max-height') relayout();
    });

    var first = true;   // 首帧不做滚动联动，避免页面加载时抖动
    var onScroll = U.throttle(function () { paint(); }, 60);
    window.addEventListener('scroll', onScroll, { passive: true });

    // 字体加载完成后再量一次，避免位置漂移
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { relayout(); });
    }

    requestAnimationFrame(function () {
      measure();
      buildTicks();
      drawCurve();
      paint();
      first = false;
      void first;
    });

    return { remeasure: relayout, jumpToYear: function (y) { var a = anchors.find(function (x) { return x.year === String(y); }); if (a) jumpTo(a); } };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
