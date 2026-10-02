/* ============================================================
   explainer.js · 划词 AI 解释
   ------------------------------------------------------------
   · 原生 Selection API 取词，getBoundingClientRect 定位浮动按钮
   · 浮动按钮与面板全部放进 Shadow DOM，样式与事件与页面完全隔离
   · Prompt 按「上下文 / 选中片段 / 用户问题」三段拼接
   · 未配置接口时退回本地术语词典，绝不假装是 AI
   ============================================================ */
(function (global) {
  'use strict';

  var U = global.AICU;

  var MIN_CHARS = 3;            // 少于 3 个字不触发
  var CONTEXT_LIMIT = 600;      // 上下文最多带多少字
  var Z_INDEX = 2147483000;

  /* ============================================================
     1. 提示词拼接
     ============================================================ */

  var SYSTEM_PROMPT =
    '你是《AI 大事记》网站的科普讲解员。读者是对技术和商业完全陌生的普通人。' +
    '回答时：不要使用任何未解释的术语；如果必须用专业词，先用一句日常生活的类比说明它，再展开；' +
    '不要客套，不要重复问题，直接给答案；总长度控制在 200 字以内。';

  /**
   * 按网站约定的三段式拼接 Prompt。
   * 上下文必须带上，否则模型无法判断这句在讲什么。
   */
  function buildPrompt(opts) {
    var ctx = String(opts.context || '').replace(/\s+/g, ' ').trim();
    if (ctx.length > CONTEXT_LIMIT) ctx = ctx.slice(0, CONTEXT_LIMIT) + '…';

    var selected = String(opts.selected || '').trim();
    var question = String(opts.question || '').trim();

    var origin = '';
    if (opts.title) {
      origin = '（出自事件《' + opts.title + '》' + (opts.date ? '，' + opts.date : '') + '）';
    }

    return [
      '以下是AI大事记网站中的一段内容：',
      '【上下文】' + origin + ctx,
      '【选中片段】' + selected,
      '【用户问题】' + (question || '请解释这个片段'),
      '',
      '请用完全不懂技术的人能理解的语言解释。如果涉及技术术语，先用一句生活化的类比说明，再展开。控制在 200 字以内。'
    ].join('\n');
  }

  /**
   * 输入框里预填了选中文字，用户可能在后面追加问题。
   * 这里把「选中文字」和「用户真正想问的」分开。
   *
   * 三种情况：
   *   1) 原样没改，只在后面追加  → 切掉前缀
   *   2) 改动了预填的文字后再追问 → 用最长公共前缀把它切掉
   *   3) 整段重写                → 整段都算问题
   */
  function deriveQuestion(inputValue, selected) {
    var trimLead = function (t) {
      return String(t || '').replace(/^[\s，,。.、;；:：!！?？\-—~～]+/, '').trim();
    };

    var v = String(inputValue || '').trim();
    var s = String(selected || '').trim();
    if (!v) return '';
    if (v === s) return '';

    // 情况 1：输入以选中文字开头
    if (s && v.indexOf(s) === 0) {
      var rest = trimLead(v.slice(s.length));
      return rest.length >= 2 ? rest : '';
    }

    // 情况 2：用户动了预填文字。取最长公共前缀，够长就认为是同一段文字
    if (s) {
      var n = 0;
      var max = Math.min(v.length, s.length);
      while (n < max && v.charCodeAt(n) === s.charCodeAt(n)) n++;
      if (n >= 8 && n >= s.length * 0.5) {
        var tail = trimLead(v.slice(n));
        if (tail.length >= 2) return tail;
      }
    }

    // 情况 3：整段当问题
    var whole = trimLead(v);
    return whole.length >= 2 ? whole : '';
  }

  /* ============================================================
     2. 本地术语词典（离线兜底）
     ============================================================ */

  var Glossary = {
    map: new Map(),      // 归一化术语 -> {term, plain}
    aliases: new Map(),  // 别名 -> 正式术语
    ready: false,

    init: function (list) {
      var self = this;
      (list || []).forEach(function (item) { self.add(item.term, item.plain); });
      this.ready = this.map.size > 0;
    },

    add: function (term, plain) {
      if (!term || !plain) return;
      var key = String(term).trim();
      var lower = key.toLowerCase();
      if (!this.map.has(lower)) {
        this.map.set(lower, { term: key, plain: U.cleanText(plain) });
      }
      // 常见别名，让划选也能命中
      String(term).split(/[（(·/／]|英文|简称/).forEach(function (piece) {
        var p = piece.replace(/[)）\s]/g, '').trim().toLowerCase();
        if (p.length >= 2 && !Glossary.aliases.has(p)) Glossary.aliases.set(p, lower);
      });
    },

    /** 从一段文字里找出所有能命中的术语 */
    find: function (text) {
      if (!text || !this.ready) return [];
      var lower = String(text).toLowerCase();
      var hits = [];
      var seen = new Set();
      this.map.forEach(function (item, key) {
        if (lower.indexOf(key) !== -1) {
          if (!seen.has(key)) { seen.add(key); hits.push(item); }
        }
      });
      this.aliases.forEach(function (target, alias) {
        if (lower.indexOf(alias) !== -1 && !seen.has(target)) {
          var item = Glossary.map.get(target);
          if (item) { seen.add(target); hits.push(item); }
        }
      });
      // 长术语优先
      hits.sort(function (a, b) { return b.term.length - a.term.length; });
      return hits.slice(0, 4);
    }
  };

  /* ============================================================
     3. AI 服务设置
     ============================================================ */

  var PRESETS = [
    { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { id: 'qwen', name: '通义千问（兼容模式）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { id: 'zhipu', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { id: 'moonshot', name: '月之暗面 Kimi', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { id: 'ollama', name: '本地 Ollama', base: 'http://localhost:11434/v1', model: 'qwen2.5' },
    { id: 'custom', name: '自定义（任何 OpenAI 兼容接口）', base: '', model: '' }
  ];

  var Settings = {
    data: { base: '', key: '', model: '', preset: 'deepseek' },
    load: function () {
      var saved = U.store.get('ai-settings', null);
      if (saved && typeof saved === 'object') {
        this.data = Object.assign(this.data, saved);
      }
      return this.data;
    },
    save: function (patch) {
      Object.assign(this.data, patch || {});
      U.store.set('ai-settings', this.data);
      return this.data;
    },
    get configured() {
      return !!(this.data.base && this.data.model && this.data.key);
    },
    endpoint: function () {
      return String(this.data.base || '').replace(/\/+$/, '') + '/chat/completions';
    }
  };

  /* ============================================================
     4. AI 调用
     ============================================================ */

  function callAI(prompt) {
    var s = Settings.data;
    var body = {
      model: s.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 800,
      stream: false
    };

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 60000);

    return fetch(Settings.endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.key
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('接口返回 ' + res.status + '：' + String(t).slice(0, 200));
        });
      }
      return res.json();
    }).then(function (json) {
      var text = json && json.choices && json.choices[0] &&
        (json.choices[0].message ? json.choices[0].message.content : json.choices[0].text);
      if (!text) throw new Error('接口没有返回文本内容');
      return String(text).trim();
    }).catch(function (err) {
      if (err && err.name === 'AbortError') throw new Error('请求超时（60 秒）。可以换个更快的模型或检查网络。');
      if (err instanceof TypeError) {
        throw new Error('无法连接到接口。常见原因：地址写错、浏览器跨域（CORS）被拦、或本地服务未启动。' +
          '详细说明见 README 的「跨域」一节。');
      }
      throw err;
    });
  }

  /* ============================================================
     5. 本地回答
     ============================================================ */

  function localAnswer(ctx) {
    var hits = Glossary.find(ctx.selected);
    if (hits.length < 2) {
      // 选中片段里没有术语时，把上下文也扫一遍
      var extra = Glossary.find(ctx.context).filter(function (h) {
        return !hits.some(function (x) { return x.term === h.term; });
      });
      hits = hits.concat(extra).slice(0, 3);
    }

    var lines = [];
    lines.push('**本地词典模式**（还没有配置 AI 接口，我只能在自带词典里查。）');
    lines.push('');

    if (ctx.title) {
      lines.push('这段话出自 **' + ctx.date + '《' + ctx.title + '》**。');
      lines.push('');
    }

    if (hits.length) {
      lines.push('你划的这句里，我能解释这些词：');
      lines.push('');
      hits.forEach(function (h) {
        lines.push('**' + h.term + '**');
        lines.push(h.plain);
        lines.push('');
      });
    } else {
      lines.push('这段文字里没有出现我词典里收录的术语，所以没法给你一个可靠的解释。');
      lines.push('');
      lines.push('两个办法：一是试着划选包含术语的句子（比如带「推理」「智能体」「算力」这种词的部分）；' +
        '二是点右上角的 ⚙ 配一个 AI 接口，我就能真正回答任何问题了。');
    }

    return lines.join('\n').trim();
  }

  /* ============================================================
     6. 样式（注入 Shadow DOM）
     ============================================================ */

  var CSS = [
    ':host{ all:initial; }',
    '*{ box-sizing:border-box; }',
    '.sr{',
    '  position:absolute; top:0; left:0; width:0; height:0; pointer-events:none;',
    '  --p-bg-1:#ffffff;',
    '  --p-bg-2:#fafcff;',
    '  --p-border:rgba(20,32,60,.14);',
    '  --p-line:rgba(20,32,60,.10);',
    '  --p-text:#101728;',
    '  --p-muted:#67748d;',
    '  --p-faint:#95a1b6;',
    '  --p-faint-2:#7b88a1;',
    '  --p-strong:#14538f;',
    '  --p-on-accent:#ffffff;',
    '  --p-accent:#1f6fd0;',
    '  --p-accent-soft:rgba(31,111,208,.12);',
    '  --p-accent-line:rgba(31,111,208,.34);',
    '  --p-mode-text:#14538f;',
    '  --p-mode-bg:rgba(31,111,208,.10);',
    '  --p-mode-line:rgba(31,111,208,.30);',
    '  --p-mode-local-text:#8f4a06;',
    '  --p-mode-local-bg:rgba(207,109,9,.10);',
    '  --p-mode-local-line:rgba(207,109,9,.30);',
    '  --p-shadow:0 30px 70px -30px rgba(22,38,74,.40), 0 0 0 1px rgba(255,255,255,.65) inset;',
    '  --p-fab-bg:rgba(255,255,255,.88);',
    '  --p-fab-line:rgba(31,111,208,.38);',
    '  --p-fab-text:#14538f;',
    '  --p-fab-hover-bg:#ffffff;',
    '  --p-fab-shadow:0 14px 34px -16px rgba(22,38,74,.35), 0 0 0 1px rgba(255,255,255,.7) inset;',
    '  --p-kbd:#7b88a1;',
    '  --p-kbd-line:rgba(20,32,60,.18);',
    '  --p-btn-hover-bg:rgba(20,32,60,.07);',
    '  --p-btn-hover-text:#101728;',
    '  --p-scroll:rgba(20,32,60,.16);',
    '  --p-bubble-user-bg:rgba(31,111,208,.12);',
    '  --p-bubble-user-line:rgba(31,111,208,.32);',
    '  --p-bubble-ai-bg:rgba(20,32,60,.035);',
    '  --p-bubble-ai-line:rgba(20,32,60,.10);',
    '  --p-err-bg:rgba(200,40,40,.08);',
    '  --p-err-line:rgba(200,40,40,.30);',
    '  --p-err-text:#9c2020;',
    '  --p-head-bg:linear-gradient(180deg, rgba(20,32,60,.045), transparent);',
    '  --p-prompt-bg:rgba(20,32,60,.05);',
    '  --p-prompt-line:rgba(20,32,60,.10);',
    '  --p-prompt-text:#4a5670;',
    '  --p-foot-bg:rgba(20,32,60,.03);',
    '  --p-input-bg:rgba(20,32,60,.035);',
    '  --p-input-border:rgba(20,32,60,.14);',
    '  --p-focus-line:rgba(31,111,208,.55);',
    '  --p-send-line:rgba(31,111,208,.45);',
    '  --p-send-1:#2f7fe0;',
    '  --p-send-2:#1f6fd0;',
    '  --p-btn-bg:rgba(20,32,60,.05);',
    '  --p-btn-line:rgba(20,32,60,.16);',
    '  --p-sys-line:rgba(20,32,60,.14);',
    '}',
    '.sr[data-theme="dark"]{',
    '  --p-bg-1:rgba(20,27,46,.97);',
    '  --p-bg-2:rgba(11,15,26,.98);',
    '  --p-border:rgba(140,170,230,.28);',
    '  --p-line:rgba(255,255,255,.09);',
    '  --p-text:#e9eefb;',
    '  --p-muted:#8593ad;',
    '  --p-faint:#5d6a82;',
    '  --p-faint-2:#6f7f9c;',
    '  --p-strong:#cfe3ff;',
    '  --p-on-accent:#ffffff;',
    '  --p-accent:#6ea8ff;',
    '  --p-accent-soft:rgba(77,159,255,.14);',
    '  --p-accent-line:rgba(77,159,255,.34);',
    '  --p-mode-text:#9fd0ff;',
    '  --p-mode-bg:rgba(77,159,255,.14);',
    '  --p-mode-line:rgba(77,159,255,.34);',
    '  --p-mode-local-text:#ffcb92;',
    '  --p-mode-local-bg:rgba(255,159,67,.13);',
    '  --p-mode-local-line:rgba(255,159,67,.34);',
    '  --p-shadow:0 40px 90px -30px rgba(0,0,0,1), 0 0 0 1px rgba(255,255,255,.04) inset;',
    '  --p-fab-bg:rgba(16,22,40,.82);',
    '  --p-fab-line:rgba(160,190,255,.45);',
    '  --p-fab-text:#e8f0ff;',
    '  --p-fab-hover-bg:rgba(28,40,72,.92);',
    '  --p-fab-shadow:0 14px 34px -14px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.05) inset;',
    '  --p-kbd:#8fa6c8;',
    '  --p-kbd-line:rgba(255,255,255,.18);',
    '  --p-btn-hover-bg:rgba(255,255,255,.08);',
    '  --p-btn-hover-text:#ffffff;',
    '  --p-scroll:rgba(255,255,255,.14);',
    '  --p-bubble-user-bg:rgba(77,159,255,.16);',
    '  --p-bubble-user-line:rgba(77,159,255,.34);',
    '  --p-bubble-ai-bg:rgba(255,255,255,.045);',
    '  --p-bubble-ai-line:rgba(255,255,255,.09);',
    '  --p-err-bg:rgba(255,86,86,.1);',
    '  --p-err-line:rgba(255,86,86,.35);',
    '  --p-err-text:#ffc9c9;',
    '  --p-head-bg:linear-gradient(180deg, rgba(255,255,255,.05), transparent);',
    '  --p-prompt-bg:rgba(0,0,0,.4);',
    '  --p-prompt-line:rgba(255,255,255,.08);',
    '  --p-prompt-text:#a9b8d4;',
    '  --p-foot-bg:rgba(0,0,0,.18);',
    '  --p-input-bg:rgba(255,255,255,.05);',
    '  --p-input-border:rgba(255,255,255,.13);',
    '  --p-focus-line:rgba(110,168,255,.7);',
    '  --p-send-line:rgba(110,168,255,.5);',
    '  --p-send-1:#3b82f6;',
    '  --p-send-2:#2563eb;',
    '  --p-btn-bg:rgba(255,255,255,.06);',
    '  --p-btn-line:rgba(255,255,255,.16);',
    '  --p-sys-line:rgba(255,255,255,.14);',
    '}',
    '.sr > *{ pointer-events:auto; }',

    /* 浮动按钮 */
    '.fab{',
    '  position:absolute; transform:translate(-50%,-100%) scale(.92); opacity:0;',
    '  display:inline-flex; align-items:center; gap:7px;',
    '  padding:8px 14px 8px 11px; border-radius:999px; border:1px solid var(--p-fab-line);',
    '  background:var(--p-fab-bg); backdrop-filter:blur(10px) saturate(160%);',
    '  -webkit-backdrop-filter:blur(10px) saturate(160%);',
    '  color:var(--p-fab-text); font:600 13.5px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;',
    '  box-shadow:var(--p-fab-shadow);',
    '  cursor:pointer; transition:opacity .16s ease, transform .16s cubic-bezier(.22,.61,.36,1), background .16s;',
    '  white-space:nowrap; z-index:3;',
    '}',
    '.fab.is-on{ opacity:1; transform:translate(-50%,-100%) scale(1); }',
    '.fab:hover{ background:var(--p-fab-hover-bg); border-color:var(--p-accent); }',
    '.fab .ico{ width:16px; height:16px; display:block; }',
    '.fab .kbd{ font:500 10.5px/1 ui-monospace,Menlo,monospace; color:var(--p-kbd); border:1px solid var(--p-kbd-line);',
    '  border-radius:4px; padding:2px 4px; }',

    /* 面板 */
    '.panel{',
    '  position:fixed; width:min(430px,94vw); max-height:min(76vh,620px);',
    '  display:none; flex-direction:column;',
    '  background:linear-gradient(180deg,var(--p-bg-1),var(--p-bg-2));',
    '  border:1px solid var(--p-border); border-radius:16px;',
    '  box-shadow:var(--p-shadow);',
    '  color:var(--p-text); overflow:hidden; z-index:5;',
    '  font:400 14px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;',
    '  backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);',
    '}',
    '.panel.is-open{ display:flex; animation:pop .18s cubic-bezier(.22,.61,.36,1); }',
    '@keyframes pop{ from{ opacity:0; transform:translateY(8px) scale(.98);} to{ opacity:1; transform:none; } }',

    '.p-head{ display:flex; align-items:center; gap:8px; padding:11px 12px 11px 14px;',
    '  border-bottom:1px solid var(--p-line); cursor:grab; user-select:none;',
    '  background:var(--p-head-bg); }',
    '.p-head.is-drag{ cursor:grabbing; }',
    '.p-grip{ color:var(--p-faint); letter-spacing:-2px; font-size:15px; }',
    '.p-title{ font-weight:700; font-size:14px; letter-spacing:.02em; }',
    '.p-mode{ margin-left:auto; font:500 10.5px/1 ui-monospace,Menlo,monospace; padding:4px 7px; border-radius:999px;',
    '  color:var(--p-mode-text); background:var(--p-mode-bg); border:1px solid var(--p-mode-line); white-space:nowrap; }',
    '.p-mode.local{ color:var(--p-mode-local-text); background:var(--p-mode-local-bg); border-color:var(--p-mode-local-line); }',
    '.p-btn{ width:26px; height:26px; border-radius:8px; border:1px solid transparent; background:transparent;',
    '  color:var(--p-muted); font-size:14px; line-height:1; display:grid; place-items:center; cursor:pointer; }',
    '.p-btn:hover{ background:var(--p-btn-hover-bg); color:var(--p-btn-hover-text); }',

    '.p-body{ flex:1 1 auto; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:11px;',
    '  scrollbar-width:thin; }',
    '.p-body::-webkit-scrollbar{ width:8px; }',
    '.p-body::-webkit-scrollbar-thumb{ background:var(--p-scroll); border-radius:8px; }',
    '.p-origin{ font:500 11.5px/1.5 ui-monospace,Menlo,monospace; color:var(--p-muted); }',

    '.bubble{ border-radius:12px; padding:10px 12px; font-size:13.8px; overflow-wrap:anywhere; }',
    '.bubble.user{ align-self:flex-end; max-width:88%; background:var(--p-bubble-user-bg);',
    '  border:1px solid var(--p-bubble-user-line); white-space:pre-wrap; }',
    '.bubble.ai{ background:var(--p-bubble-ai-bg); border:1px solid var(--p-bubble-ai-line); }',
    '.bubble.ai p{ margin:0 0 8px; }',
    '.bubble.ai p:last-child{ margin-bottom:0; }',
    '.bubble.ai strong{ color:var(--p-strong); }',
    '.bubble.err{ background:var(--p-err-bg); border-color:var(--p-err-line); color:var(--p-err-text); }',
    '.bubble.sys{ font-size:12.6px; color:var(--p-muted); background:transparent; border:1px dashed var(--p-sys-line); }',

    '.typing{ display:inline-flex; gap:4px; align-items:center; }',
    '.typing i{ width:6px; height:6px; border-radius:50%; background:var(--p-accent); animation:bl 1s infinite ease-in-out; }',
    '.typing i:nth-child(2){ animation-delay:.15s; } .typing i:nth-child(3){ animation-delay:.3s; }',
    '@keyframes bl{ 0%,80%,100%{ opacity:.25; transform:translateY(0);} 40%{ opacity:1; transform:translateY(-3px);} }',

    '.p-prompt{ margin-top:2px; }',
    '.p-prompt summary{ cursor:pointer; font-size:11.8px; color:var(--p-faint-2); list-style:none; }',
    '.p-prompt summary::-webkit-details-marker{ display:none; }',
    '.p-prompt summary::before{ content:"▸ "; }',
    '.p-prompt[open] summary::before{ content:"▾ "; }',
    '.p-prompt pre{ margin:8px 0 0; padding:10px; border-radius:10px; background:var(--p-prompt-bg);',
    '  border:1px solid var(--p-prompt-line); color:var(--p-prompt-text); font:11.6px/1.65 ui-monospace,Menlo,monospace;',
    '  white-space:pre-wrap; overflow-wrap:anywhere; max-height:190px; overflow:auto; }',

    '.p-input{ border-top:1px solid var(--p-line); padding:10px; display:flex; gap:8px; align-items:flex-end;',
    '  background:var(--p-foot-bg); }',
    '.p-input textarea{ flex:1; resize:none; min-height:44px; max-height:120px; padding:10px 11px; border-radius:11px;',
    '  background:var(--p-input-bg); border:1px solid var(--p-input-border); color:var(--p-text);',
    '  font:400 13.6px/1.6 inherit; outline:none; }',
    '.p-input textarea:focus{ border-color:var(--p-focus-line); box-shadow:0 0 0 3px var(--p-accent-soft); }',
    '.p-send{ flex:none; padding:0 15px; height:44px; border-radius:11px; border:1px solid var(--p-send-line);',
    '  background:linear-gradient(180deg,var(--p-send-1),var(--p-send-2)); color:var(--p-on-accent); font-weight:600; font-size:13.5px; cursor:pointer; }',
    '.p-send:hover{ filter:brightness(1.1); }',
    '.p-send:disabled{ opacity:.5; cursor:not-allowed; }',
    '.p-foot{ padding:0 12px 10px; font-size:11px; color:var(--p-faint); }',

    /* 设置视图 */
    '.settings{ display:none; padding:14px; gap:11px; flex-direction:column; overflow-y:auto; }',
    '.settings.is-on{ display:flex; }',
    '.panel.settings-on .p-body, .panel.settings-on .p-input, .panel.settings-on .p-foot{ display:none; }',
    '.fld{ display:flex; flex-direction:column; gap:5px; }',
    '.fld label{ font-size:11.5px; letter-spacing:.08em; color:var(--p-muted); text-transform:uppercase; }',
    '.fld input, .fld select{ padding:9px 10px; border-radius:9px; background:var(--p-input-bg);',
    '  border:1px solid var(--p-input-border); color:var(--p-text); font:400 13px/1.4 ui-monospace,Menlo,monospace; outline:none; }',
    '.fld input:focus, .fld select:focus{ border-color:var(--p-focus-line); }',
    '.hint{ font-size:11.6px; color:var(--p-faint-2); line-height:1.6; }',
    '.s-row{ display:flex; gap:8px; margin-top:2px; }',
    '.s-row button{ flex:1; padding:9px; border-radius:9px; border:1px solid var(--p-btn-line);',
    '  background:var(--p-btn-bg); color:var(--p-text); font-size:13px; cursor:pointer; }',
    '.s-row button.primary{ background:linear-gradient(180deg,var(--p-send-1),var(--p-send-2)); border-color:var(--p-send-line); }',
    '.s-row button:hover{ filter:brightness(1.12); }'
  ].join('\n');

  /* ============================================================
     7. 主控制器
     ============================================================ */

  function create(options) {
    options = options || {};
    var glossaryList = options.glossary || [];
    Glossary.init(glossaryList);
    Settings.load();

    /* ---- Shadow DOM 挂载 ---- */
    var host = document.createElement('div');
    host.id = 'ai-explain-host';
    host.setAttribute('data-ai-explain', '');
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:' + Z_INDEX + ';pointer-events:none;';
    (document.body || document.documentElement).appendChild(host);

    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'sr';
    wrap.setAttribute('data-theme',
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    root.appendChild(wrap);

    /* ---- 浮动按钮 ---- */
    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'fab';
    fab.innerHTML =
      '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/>' +
      '<path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z"/></svg>' +
      '<span>解释</span><span class="kbd">E</span>';
    fab.setAttribute('aria-label', '解释选中的文字');
    wrap.appendChild(fab);

    /* ---- 面板 ---- */
    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'AI 解释面板');
    panel.innerHTML = [
      '<div class="p-head">',
      '  <span class="p-grip">⠿</span>',
      '  <span class="p-title">AI 解释</span>',
      '  <span class="p-mode" data-mode>本地词典</span>',
      '  <button class="p-btn" data-act="settings" title="AI 服务设置" aria-label="AI 服务设置">⚙</button>',
      '  <button class="p-btn" data-act="close" title="关闭" aria-label="关闭面板">✕</button>',
      '</div>',
      '<div class="p-origin" data-origin style="padding:10px 14px 0"></div>',
      '<div class="p-body" data-body></div>',
      '<div class="p-input">',
      '  <textarea data-q rows="2" placeholder="可以在这里追问，比如「这个和上一个有什么区别」"></textarea>',
      '  <button class="p-send" data-act="send">发送</button>',
      '</div>',
      '<div class="p-foot">Enter 发送 · Shift + Enter 换行 · Esc 关闭 · 拖动标题栏可移动</div>',
      '<div class="settings" data-settings>',
      '  <div class="fld"><label>接口预设</label><select data-f="preset"></select></div>',
      '  <div class="fld"><label>接口地址（Base URL）</label><input data-f="base" placeholder="https://api.deepseek.com/v1" spellcheck="false"></div>',
      '  <div class="fld"><label>模型名</label><input data-f="model" placeholder="deepseek-chat" spellcheck="false"></div>',
      '  <div class="fld"><label>API Key</label><input data-f="key" type="password" placeholder="sk-..." spellcheck="false"></div>',
      '  <p class="hint">Key 只保存在你自己的浏览器里（localStorage），不会上传到任何第三方服务器，' +
      '也不会写进这个网站的代码。请求直接由你的浏览器发往你填的接口。</p>',
      '  <p class="hint">若浏览器提示跨域（CORS）失败：请用本地 HTTP 服务打开本页（见 README），' +
      '或改用支持浏览器直连的接口 / 自建一个转发代理。</p>',
      '  <div class="s-row">',
      '    <button data-act="save" class="primary">保存</button>',
      '    <button data-act="clear">清空配置</button>',
      '    <button data-act="back">返回对话</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    wrap.appendChild(panel);

    var $ = function (sel) { return panel.querySelector(sel); };
    var bodyEl = $('[data-body]');
    var qEl = $('[data-q]');
    var originEl = $('[data-origin]');
    var modeEl = $('[data-mode]');
    var settingsEl = $('[data-settings]');
    var presetEl = $('[data-f="preset"]');

    /* ---- 预设下拉 ---- */
    PRESETS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      presetEl.appendChild(o);
    });

    function fillSettings() {
      presetEl.value = Settings.data.preset || 'custom';
      $('[data-f="base"]').value = Settings.data.base || '';
      $('[data-f="model"]').value = Settings.data.model || '';
      $('[data-f="key"]').value = Settings.data.key || '';
    }
    function refreshMode() {
      if (Settings.configured) {
        modeEl.textContent = 'AI · ' + (Settings.data.model || '');
        modeEl.classList.remove('local');
      } else {
        modeEl.textContent = '本地词典';
        modeEl.classList.add('local');
      }
    }
    fillSettings();
    refreshMode();

    /* ---- 状态 ---- */
    var state = {
      selected: '',
      context: '',
      title: '',
      date: '',
      rect: null,
      open: false,
      busy: false
    };

    /* ---- Esc 关闭 ---- */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (panel.classList.contains('is-open')) { closePanel(); }
      else { hideFab(); }
    });

    /* ---- 浮动按钮定位 ---- */
    function placeFab() {
      if (!state.rect) return;
      var r = state.rect;
      var pageX = r.left + window.scrollX + r.width / 2;
      var pageY = r.top + window.scrollY - 10;
      var minY = window.scrollY + 8;
      if (r.top < 56) pageY = r.bottom + window.scrollY + 46;   // 贴近顶部时放到下方
      pageY = Math.max(pageY, minY);
      pageX = U.clamp(pageX, 70, document.documentElement.clientWidth - 70);
      fab.style.left = pageX + 'px';
      fab.style.top = pageY + 'px';
    }

    function showFab() { fab.classList.add('is-on'); placeFab(); }
    function hideFab() { fab.classList.remove('is-on'); }

    /* ---- 选区处理 ---- */
    function readSelection() {
      var sel = global.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

      var text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < MIN_CHARS) return null;

      var range = sel.getRangeAt(0);
      var node = range.commonAncestorContainer;
      if (node.nodeType === 3) node = node.parentNode;
      if (!node || !node.closest) return null;

      // 只在事件卡片内容区域内生效
      var card = node.closest('.card');
      if (!card) return null;
      if (host.contains(node)) return null;

      // 上下文 = 选中文字所在的那一整段
      var block = node.closest('p, .step, .concept, li, .conn, .card-title, .card-lede, .block-title') || card;
      var context = (block.textContent || '').replace(/\s+/g, ' ').trim();
      if (context.length < text.length) context = (card.textContent || '').replace(/\s+/g, ' ').trim();

      var titleNode = card.querySelector('.card-title');
      var dateNode = card.querySelector('.card-date');

      var rect;
      try { rect = range.getBoundingClientRect(); } catch (e) { rect = null; }
      if (!rect || (!rect.width && !rect.height)) rect = block.getBoundingClientRect();

      return {
        selected: text,
        context: context,
        title: titleNode ? titleNode.textContent.trim() : '',
        date: dateNode ? dateNode.textContent.trim() : '',
        rect: rect
      };
    }

    function handleSelectionChange() {
      var found = readSelection();
      if (!found) { hideFab(); return; }
      state.selected = found.selected;
      state.context = found.context;
      state.title = found.title;
      state.date = found.date;
      state.rect = found.rect;
      if (!state.open) showFab();
    }

    var onSelChange = U.throttle(handleSelectionChange, 120);
    document.addEventListener('selectionchange', onSelChange);
    // 触屏上 selectionchange 时机不稳，额外在抬手时补一次
    document.addEventListener('touchend', function () {
      setTimeout(handleSelectionChange, 60);
    }, { passive: true });

    // 滚动/缩放时重新贴合选区
    window.addEventListener('scroll', function () {
      if (!fab.classList.contains('is-on')) return;
      var found = readSelection();
      if (!found) { hideFab(); return; }
      state.rect = found.rect;
      placeFab();
    }, { passive: true });
    window.addEventListener('resize', function () {
      if (fab.classList.contains('is-on')) placeFab();
      clampPanel();
    });

    // 点击页面其他地方 → 收起按钮（点按钮本身不算，且要保住选区）
    document.addEventListener('mousedown', function (e) {
      if (host.contains(e.target)) return;
      if (!fab.classList.contains('is-on')) return;
      // 延迟到浏览器更新选区之后再判断
      setTimeout(function () {
        var sel = global.getSelection();
        if (!sel || sel.isCollapsed) hideFab();
      }, 0);
    }, true);

    /* ---- 面板开合 ---- */
    function openPanel() {
      if (!state.selected) return;
      hideFab();
      state.open = true;
      panel.classList.add('is-open');
      panel.classList.remove('settings-on');

      originEl.textContent = state.title
        ? '来自 ' + state.date + '《' + state.title + '》'
        : '来自时间线上的一段内容';

      bodyEl.innerHTML = '';
      addBubble('sys', '已选中 ' + state.selected.length + ' 个字。' +
        (Settings.configured ? '按 Enter 或点「发送」让 AI 解释。' : '当前是本地词典模式，点 ⚙ 可以接入真正的 AI。'));

      qEl.value = state.selected;
      qEl.style.height = 'auto';
      qEl.style.height = Math.min(qEl.scrollHeight, 120) + 'px';
      qEl.focus();
      try { qEl.setSelectionRange(qEl.value.length, qEl.value.length); } catch (e) { /* ignore */ }

      positionPanel();
      refreshMode();
    }

    function closePanel() {
      state.open = false;
      panel.classList.remove('is-open');
      panel.classList.remove('settings-on');
    }

    function positionPanel() {
      var r = state.rect || { left: 80, right: 80, top: 120, bottom: 140, width: 0 };
      var w = panel.offsetWidth || Math.min(430, window.innerWidth * 0.94);
      var h = panel.offsetHeight || 360;
      var left = U.clamp(r.left, 12, Math.max(12, window.innerWidth - w - 12));
      var top = r.bottom + 14;
      if (top + h > window.innerHeight - 12) {
        top = Math.max(12, r.top - h - 14);
      }
      if (top < 12) top = 12;
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    }

    function clampPanel() {
      if (!panel.classList.contains('is-open')) return;
      var w = panel.offsetWidth, h = panel.offsetHeight;
      var l = parseFloat(panel.style.left) || 12;
      var t = parseFloat(panel.style.top) || 12;
      panel.style.left = U.clamp(l, 8, Math.max(8, window.innerWidth - w - 8)) + 'px';
      panel.style.top = U.clamp(t, 8, Math.max(8, window.innerHeight - h - 8)) + 'px';
    }

    /* ---- 气泡 ---- */
    function addBubble(kind, text) {
      var b = document.createElement('div');
      b.className = 'bubble ' + kind;
      if (kind === 'ai') b.innerHTML = miniMarkdown(text);
      else b.textContent = text;
      bodyEl.appendChild(b);
      bodyEl.scrollTop = bodyEl.scrollHeight;
      clampPanel();          // 内容变高后重新夹回视口内，免得回答被切掉
      return b;
    }

    function addTyping() {
      var b = document.createElement('div');
      b.className = 'bubble ai';
      b.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      bodyEl.appendChild(b);
      bodyEl.scrollTop = bodyEl.scrollHeight;
      clampPanel();
      return b;
    }

    /** 极简 markdown：粗体、行内代码、段落 —— 先转义再替换 */
    function miniMarkdown(text) {
      var safe = U.escapeHtml(text);
      safe = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      safe = safe.replace(/`([^`\n]+)`/g, '<strong>$1</strong>');
      return safe.split(/\n{2,}/).map(function (p) {
        return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
      }).join('');
    }

    /* ---- 发送 ---- */
    function send() {
      if (state.busy || !state.selected) return;
      var question = deriveQuestion(qEl.value, state.selected);
      var prompt = buildPrompt({
        context: state.context,
        selected: state.selected,
        question: question,
        title: state.title,
        date: state.date
      });

      var shown = question || '请解释：' + state.selected;
      addBubble('user', shown);

      var promptBox = document.createElement('details');
      promptBox.className = 'p-prompt';
      promptBox.innerHTML = '<summary>查看发送给 AI 的提问</summary><pre></pre>';
      promptBox.querySelector('pre').textContent = prompt;
      bodyEl.appendChild(promptBox);
      clampPanel();

      state.busy = true;
      var sendBtn = panel.querySelector('[data-act="send"]');
      sendBtn.disabled = true;
      var typing = addTyping();

      var runner = Settings.configured
        ? callAI(prompt).then(function (text) { return { text: text, local: false }; })
        : new Promise(function (resolve) {
            setTimeout(function () {
              resolve({
                text: localAnswer({
                  selected: state.selected, context: state.context,
                  title: state.title, date: state.date, question: question
                }),
                local: true
              });
            }, 340);
          });

      runner.then(function (res) {
        typing.remove();
        var b = addBubble('ai', res.text);
        if (res.local) {
          var tip = document.createElement('div');
          tip.className = 'bubble sys';
          tip.textContent = '这是离线词典的答案。点右上角 ⚙ 配置接口后，同样的提问会由真正的 AI 来回答。';
          b.appendChild(tip);
        }
      }).catch(function (err) {
        typing.remove();
        addBubble('err', (err && err.message) || '请求失败，请检查接口设置。');
      }).then(function () {
        state.busy = false;
        sendBtn.disabled = false;
        qEl.focus();
      });
    }

    /* ---- 事件绑定 ---- */
    fab.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 保住选区
    fab.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPanel();
    });

    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'close') closePanel();
      else if (act === 'send') send();
      else if (act === 'settings') {
        panel.classList.add('settings-on');
        fillSettings();
      }
      else if (act === 'back') panel.classList.remove('settings-on');
      else if (act === 'save') {
        Settings.save({
          preset: presetEl.value,
          base: panel.querySelector('[data-f="base"]').value.trim(),
          model: panel.querySelector('[data-f="model"]').value.trim(),
          key: panel.querySelector('[data-f="key"]').value.trim()
        });
        refreshMode();
        panel.classList.remove('settings-on');
        addBubble('sys', Settings.configured
          ? '已保存，现在由「' + Settings.data.model + '」来回答。'
          : '还没有填完整（地址、模型名、Key 三个都要）。继续用本地词典。');
      }
      else if (act === 'clear') {
        Settings.save({ base: '', model: '', key: '', preset: 'custom' });
        fillSettings();
        refreshMode();
        addBubble('sys', '配置已清空，回到本地词典模式。');
      }
    });

    presetEl.addEventListener('change', function () {
      var p = PRESETS.filter(function (x) { return x.id === presetEl.value; })[0];
      if (!p || p.id === 'custom') return;
      panel.querySelector('[data-f="base"]').value = p.base;
      panel.querySelector('[data-f="model"]').value = p.model;
    });

    // Enter 发送（Shift+Enter 换行，中文输入法组合中不发送）
    qEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      send();
    });
    qEl.addEventListener('input', function () {
      qEl.style.height = 'auto';
      qEl.style.height = Math.min(qEl.scrollHeight, 120) + 'px';
    });

    /* ---- 拖动面板 ---- */
    var head = panel.querySelector('.p-head');
    var drag = null;
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      drag = {
        dx: e.clientX - (parseFloat(panel.style.left) || 0),
        dy: e.clientY - (parseFloat(panel.style.top) || 0),
        id: e.pointerId
      };
      head.classList.add('is-drag');
      try { head.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var w = panel.offsetWidth, h = panel.offsetHeight;
      panel.style.left = U.clamp(e.clientX - drag.dx, 8, Math.max(8, window.innerWidth - w - 8)) + 'px';
      panel.style.top = U.clamp(e.clientY - drag.dy, 8, Math.max(8, window.innerHeight - h - 8)) + 'px';
    });
    function endDrag(e) {
      if (!drag) return;
      drag = null;
      head.classList.remove('is-drag');
      try { head.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);

    /* ---- 快捷键：选中文字后按 E ---- */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'e' && e.key !== 'E') return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (state.open) return;
      var found = readSelection();
      if (!found) return;
      state.selected = found.selected;
      state.context = found.context;
      state.title = found.title;
      state.date = found.date;
      state.rect = found.rect;
      openPanel();
    });

    /* ---- 对外接口 ---- */
    return {
      /** 跟随页面主题切换面板配色 */
      setTheme: function (theme) {
        wrap.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
      },
      openForSelection: function () {
        var found = readSelection();
        if (!found) return false;
        Object.assign(state, found);
        openPanel();
        return true;
      },
      openSettings: function () {
        state.open = true;
        panel.classList.add('is-open', 'settings-on');
        fillSettings();
        if (!panel.style.left) positionPanel();
      },
      close: closePanel,
      glossary: Glossary,
      buildPrompt: buildPrompt,
      deriveQuestion: deriveQuestion,
      _host: host,
      _panel: panel,
      _settings: Settings
    };
  }

  global.AIExplainer = {
    create: create,
    buildPrompt: buildPrompt,
    deriveQuestion: deriveQuestion,
    SYSTEM_PROMPT: SYSTEM_PROMPT
  };
})(window);
