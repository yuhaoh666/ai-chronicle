/* ============================================================
   timeline.js · 竖向双线时间线的渲染与展开/折叠
   ============================================================ */
(function (global) {
  'use strict';

  var U = global.AICU;

  var YEAR_META = {
    prehistory: { label: '从达特茅斯到 AlphaGo', tag: 'prehistory' },
    2022: { label: 'ChatGPT 时刻', tag: '2022' },
    2023: { label: '百模大战', tag: '2023' },
    2024: { label: '多模态与推理', tag: '2024' },
    2025: { label: '推理模型 · 智能体' , tag: '2025' },
    2026: { label: '智能体开始干活', tag: '2026' }
  };

  var CATEGORY_LABEL = { technical: '技术线', social: '社会线' };

  var CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  /* ---------- 单张卡片 ---------- */

  function buildSteps(event) {
    var steps = U.splitSummary(event.summary);
    if (!steps.length) return '';
    return '<div class="block"><div class="block-title">这件事是什么</div><div class="steps">' +
      steps.map(function (s) {
        return '<div class="step"><b>' + U.escapeHtml(s.label) + '</b><p>' +
          U.escapeHtml(s.text) + '</p></div>';
      }).join('') + '</div></div>';
  }

  function buildConcepts(event) {
    var list = event.concepts || [];
    if (!list.length) return '';
    return '<div class="block"><div class="block-title">术语翻译机</div><div class="concepts">' +
      list.map(function (c) {
        return '<div class="concept" data-term="' + U.escapeHtml(c.term) + '">' +
          '<div class="concept-term">' + U.escapeHtml(c.term) + '</div>' +
          '<p>' + U.escapeHtml(U.cleanText(c.plain)) + '</p></div>';
      }).join('') + '</div></div>';
  }

  function buildImpact(event) {
    if (!event.impact) return '';
    var text = U.cleanText(event.impact);
    var sentences = text.match(/[^。！？!?]+[。！？!?]?/g) || [text];
    sentences = sentences.map(function (s) { return s.trim(); }).filter(Boolean);
    var inner = sentences.length > 1
      ? '<ul class="impact-list">' + sentences.map(function (s) {
          return '<li>' + U.escapeHtml(s) + '</li>';
        }).join('') + '</ul>'
      : '<p>' + U.escapeHtml(text) + '</p>';
    return '<div class="block"><div class="block-title">后来发生了什么</div>' + inner + '</div>';
  }

  function buildConnections(event) {
    var list = event.connections || [];
    if (!list.length) return '';
    return '<div class="block"><div class="block-title">时间线上的关联</div><div class="conn-list">' +
      list.map(function (c) {
        return '<div class="conn"><span>' + U.escapeHtml(U.cleanText(c)) + '</span></div>';
      }).join('') + '</div></div>';
  }

  function buildBackground(event) {
    if (!event.background) return '';
    return '<div class="block"><div class="block-title">来龙去脉</div><p>' +
      U.escapeHtml(U.cleanText(event.background)) + '</p></div>';
  }

  function buildSources(event) {
    var list = (event.sources || []).filter(Boolean);
    var notes = [];
    if (event.date_note) {
      notes.push('<div class="conn"><span>' + U.escapeHtml(U.cleanText(event.date_note)) + '</span></div>');
    }
    var srcHtml = list.length
      ? '<div class="sources">' + list.map(function (url) {
          return '<a class="source-link" href="' + U.escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
            U.escapeHtml(U.prettyHost(url)) + ' ↗</a>';
        }).join('') + '</div>'
      : '';
    if (!notes.length && !srcHtml) return '';
    return '<div class="block"><div class="block-title">' +
      (srcHtml ? '信息来源与日期说明' : '关于日期') + '</div>' +
      (notes.length ? '<div class="conn-list" style="margin-bottom:10px">' + notes.join('') + '</div>' : '') +
      srcHtml + '</div>';
  }

  function buildCard(event) {
    var cat = event.category === 'social' ? 'social' : 'technical';
    var actors = (event.actors || []).slice(0, 4).map(function (a) {
      return '<span class="actor">' + U.escapeHtml(a) + '</span>';
    }).join('');

    var flag = (event.confidence === 'low' || /存疑|不确定|待考/.test(event.date_note || ''))
      ? '<span class="card-flag" title="日期或细节存在不确定性，请以来源为准">日期待考</span>' : '';

    var article = U.el('article', 'event ' + cat);
    article.id = 'event-' + event.id;
    article.dataset.id = event.id;
    article.dataset.category = cat;
    article.dataset.year = event.yearKey;

    article.innerHTML =
      '<div class="connector" aria-hidden="true"></div>' +
      '<div class="node" aria-hidden="true"></div>' +
      '<div class="card">' +
        '<button class="card-head" type="button" aria-expanded="false">' +
          '<div class="card-meta">' +
            '<span class="card-date">' + U.escapeHtml(U.formatDate(event.date)) + '</span>' +
            '<span class="badge ' + cat + '">' + CATEGORY_LABEL[cat] + '</span>' +
            flag +
          '</div>' +
          '<h3 class="card-title">' + U.escapeHtml(U.cleanText(event.title)) + '</h3>' +
          '<div class="card-lede">' + U.escapeHtml(U.summaryPlain(event.summary)) + '</div>' +
          '<div class="card-actions">' +
            '<div class="ca-left">' + actors + '</div>' +
            '<span class="expand-hint"><span class="t-open">展开详情</span>' +
            '<span class="t-close">收起</span> ' + CHEVRON + '</span>' +
          '</div>' +
        '</button>' +
        '<div class="card-detail"><div class="detail-inner event-body">' +
          buildSteps(event) + buildBackground(event) + buildConcepts(event) +
          buildImpact(event) + buildConnections(event) + buildSources(event) +
        '</div></div>' +
      '</div>';

    return article;
  }

  /* ---------- 展开 / 折叠 ---------- */

  function setOpen(article, open) {
    var card = article.querySelector('.card');
    var detail = article.querySelector('.card-detail');
    var head = article.querySelector('.card-head');
    if (!card || !detail) return;

    if (open) {
      if (card.classList.contains('is-open')) return;
      card.classList.add('is-open');
      article.classList.add('is-open');
      head.setAttribute('aria-expanded', 'true');
      detail.style.maxHeight = detail.scrollHeight + 'px';
      var onEnd = function (e) {
        if (e.propertyName !== 'max-height') return;
        detail.style.maxHeight = 'none';
        detail.removeEventListener('transitionend', onEnd);
      };
      detail.addEventListener('transitionend', onEnd);
    } else {
      if (!card.classList.contains('is-open')) return;
      detail.style.maxHeight = detail.scrollHeight + 'px';
      // 强制回流后再归零，保证动画生效
      void detail.offsetHeight;
      card.classList.remove('is-open');
      article.classList.remove('is-open');
      head.setAttribute('aria-expanded', 'false');
      requestAnimationFrame(function () { detail.style.maxHeight = '0px'; });
    }
  }

  function toggle(article) {
    var card = article.querySelector('.card');
    setOpen(article, !(card && card.classList.contains('is-open')));
  }

  /* ---------- 渲染整条时间线 ---------- */

  function render(container, events) {
    // 只清掉自己上次渲染出来的东西，保留容器里的静态节点
    U.qsa('.year, .timeline-spine', container).forEach(function (n) { n.remove(); });
    var spine = U.el('div', 'timeline-spine');
    spine.setAttribute('aria-hidden', 'true');
    container.appendChild(spine);

    var byYear = new Map();
    events.forEach(function (ev) {
      if (!byYear.has(ev.yearKey)) byYear.set(ev.yearKey, []);
      byYear.get(ev.yearKey).push(ev);
    });

    var years = Array.from(byYear.keys());
    var index = { byId: new Map(), articles: [] };

    years.forEach(function (yearKey) {
      var list = byYear.get(yearKey);
      var meta = YEAR_META[yearKey] || { label: '' };

      var section = U.el('section', 'year');
      section.id = 'year-' + yearKey;
      section.dataset.year = yearKey;

      var headLabel = yearKey === 'prehistory' ? 'AI 前史' : yearKey + ' 年';
      var head = U.el('div', 'year-head',
        '<div class="year-pill"><b>' + U.escapeHtml(headLabel) + '</b>' +
        (meta.label ? '<em>' + U.escapeHtml(meta.label) + '</em>' : '') +
        '<span class="yp-count">' + list.length + ' 条</span></div>');
      section.appendChild(head);

      list.forEach(function (ev) {
        var article = buildCard(ev);
        section.appendChild(article);
        index.byId.set(ev.id, article);
        index.articles.push(article);
      });

      container.appendChild(section);
    });

    // 事件委托：展开 / 折叠
    container.addEventListener('click', function (e) {
      var head = e.target.closest('.card-head');
      if (!head || !container.contains(head)) return;
      // 划词后立刻点展开按钮不算（有选区时不触发切换）
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 2) return;
      toggle(head.closest('.event'));
    });

    return index;
  }

  global.AITimeline = {
    render: render,
    setOpen: setOpen,
    toggle: toggle,
    YEAR_META: YEAR_META
  };
})(window);
