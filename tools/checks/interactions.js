/* 交互自检脚本（由 tools/probe.mjs 注入执行）
   覆盖：划词 → 浮动按钮 → 面板 → 提示词拼接 → 本地回答 → 搜索 → 导航拖动 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const fails = [];
const ok = (cond, name, extra) => {
  out[name] = extra === undefined ? !!cond : extra;
  if (!cond) fails.push(name);
};

const host = document.querySelector('[data-ai-explain]');
ok(host && host.shadowRoot, 'shadow_host_exists');
const sr = host.shadowRoot;

/* ---------- 1. 太短的选区不该触发 ---------- */
{
  const lede = document.querySelector('.event .card-lede');
  const r = document.createRange();
  r.setStart(lede.firstChild, 0);
  r.setEnd(lede.firstChild, 2);              // 只有 2 个字
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
  await sleep(260);
  ok(!sr.querySelector('.fab').classList.contains('is-on'), 'short_selection_ignored');
}

/* ---------- 2. 卡片外划词不该触发 ---------- */
{
  const hero = document.querySelector('.hero-sub');
  const r = document.createRange();
  r.selectNodeContents(hero);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
  await sleep(260);
  ok(!sr.querySelector('.fab').classList.contains('is-on'), 'outside_card_ignored');
}

/* ---------- 3. 卡片内划词 → 浮动按钮出现 ---------- */
let selectedText = '';
{
  const lede = document.querySelector('.event .card-lede');
  selectedText = lede.textContent.trim().slice(0, 26);
  const r = document.createRange();
  r.selectNodeContents(lede);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
  await sleep(300);
  const fab = sr.querySelector('.fab');
  ok(fab.classList.contains('is-on'), 'fab_shown_in_card');
  out.fab_pos = { left: fab.style.left, top: fab.style.top };
}

/* ---------- 4. 点按钮 → 面板打开并预填 ---------- */
{
  sr.querySelector('.fab').click();
  await sleep(200);
  const panel = sr.querySelector('.panel');
  ok(panel.classList.contains('is-open'), 'panel_opened');
  const ta = panel.querySelector('[data-q]');
  ok(ta.value.includes(selectedText.slice(0, 8)), 'input_prefilled', ta.value.slice(0, 24));
  out.origin = panel.querySelector('[data-origin]').textContent;
  out.mode = panel.querySelector('[data-mode]').textContent;
}

/* ---------- 5. Enter 发送 → 本地词典回答 + 提示词 ---------- */
{
  const panel = sr.querySelector('.panel');
  const ta = panel.querySelector('[data-q]');
  ta.value = selectedText + ' 这跟之前有什么区别？';     // 模拟用户追加提问
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  ta.dispatchEvent(ev);
  await sleep(900);

  const bubbles = [...panel.querySelectorAll('.bubble')].map((b) => b.className + ' | ' + b.textContent.trim().slice(0, 48));
  out.bubbles = bubbles;
  ok(bubbles.some((b) => b.indexOf('bubble user') === 0), 'user_bubble');
  ok(bubbles.some((b) => b.indexOf('bubble ai') === 0), 'ai_bubble');

  const pre = panel.querySelector('.p-prompt pre');
  const prompt = pre ? pre.textContent : '';
  out.prompt = prompt;
  ok(prompt.includes('以下是AI大事记网站中的一段内容：'), 'prompt_header');
  ok(prompt.includes('【上下文】'), 'prompt_context');
  ok(prompt.includes('【选中片段】'), 'prompt_selected');
  ok(prompt.includes('【用户问题】'), 'prompt_question');
  ok(prompt.includes('这跟之前有什么区别？'), 'prompt_carries_followup');
  ok(prompt.includes('控制在 200 字以内'), 'prompt_length_rule');

  // 选中片段与用户问题确实被拆开了
  const q = window.AIExplainer.deriveQuestion(selectedText + ' 这跟之前有什么区别？', selectedText);
  ok(q === '这跟之前有什么区别？', 'derive_question_split', q);
  ok(window.AIExplainer.deriveQuestion(selectedText, selectedText) === '', 'derive_question_default');

  // 用户改动了预填文字之后再追问，不能把改动过的前半段漏进【用户问题】
  const edited = selectedText.slice(0, Math.max(10, selectedText.length - 4)) + ' 顺便说说它的代价';
  const q2 = window.AIExplainer.deriveQuestion(edited, selectedText);
  ok(q2 === '顺便说说它的代价', 'derive_question_after_edit', q2);

  // 整段重写时，整段都算问题
  ok(window.AIExplainer.deriveQuestion('它为什么重要？', selectedText) === '它为什么重要？', 'derive_question_rewrite');
}

/* ---------- 6. 拖拽面板 ---------- */
{
  const panel = sr.querySelector('.panel');
  const head = panel.querySelector('.p-head');
  const before = panel.style.left;
  head.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 200, pointerId: 7, bubbles: true }));
  head.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 260, pointerId: 7, bubbles: true }));
  head.dispatchEvent(new PointerEvent('pointerup', { clientX: 220, clientY: 260, pointerId: 7, bubbles: true }));
  await sleep(60);
  ok(panel.style.left !== before, 'panel_draggable', before + ' -> ' + panel.style.left);
}

/* ---------- 7. 关闭面板 ---------- */
{
  const panel = sr.querySelector('.panel');
  panel.querySelector('[data-act="close"]').click();
  await sleep(80);
  ok(!panel.classList.contains('is-open'), 'panel_closed');
  ok(document.querySelectorAll('.event').length > 0, 'page_still_alive');
}

/* ---------- 8. 设置面板 ---------- */
{
  const panel = sr.querySelector('.panel');
  panel.querySelector('[data-act="settings"]').click();
  await sleep(80);
  ok(panel.classList.contains('settings-on'), 'settings_opened');
  out.presets = panel.querySelectorAll('[data-f="preset"] option').length;
  panel.querySelector('[data-act="back"]').click();
}

/* ---------- 9. 搜索 ---------- */
{
  const input = document.querySelector('#searchInput');
  input.value = '开源';
  input.dispatchEvent(new Event('input'));
  await sleep(700);
  const shown = document.querySelectorAll('.event:not(.is-hidden)').length;
  ok(shown > 0 && shown < document.querySelectorAll('.event').length, 'search_filters', shown);
  out.marks = document.querySelectorAll('mark').length;
  ok(out.marks > 0, 'search_highlights', out.marks);
  ok(document.querySelector('#resultBar').hidden === false, 'result_bar_visible');
  out.result_text = document.querySelector('#resultText').textContent;
  const tags = [...document.querySelectorAll('.hit-tags')].map((t) => t.textContent);
  ok(tags.length > 0, 'hit_tags_shown', tags.slice(0, 3));
  ok(document.querySelectorAll('.event.is-open').length === 0, 'search_does_not_auto_expand');

  input.value = '这个词根本不存在xyzzy';
  input.dispatchEvent(new Event('input'));
  await sleep(700);
  ok(document.querySelectorAll('.event:not(.is-hidden)').length === 0, 'search_empty_state');
  ok(document.querySelector('#emptyNote').hidden === false, 'empty_note_visible');

  document.querySelector('#resultReset').click();
  await sleep(500);
  ok(document.querySelectorAll('.event:not(.is-hidden)').length === document.querySelectorAll('.event').length, 'search_reset');
}

/* ---------- 10. 展开 / 折叠 ---------- */
{
  const ev = document.querySelectorAll('.event')[4];
  ev.querySelector('.card-head').click();
  await sleep(600);
  ok(ev.classList.contains('is-open'), 'card_expands');
  out.detail_h = Math.round(ev.querySelector('.card-detail').getBoundingClientRect().height);
  ok(out.detail_h > 200, 'detail_has_height', out.detail_h);
  ev.querySelector('.card-head').click();
  await sleep(600);
  ok(!ev.classList.contains('is-open'), 'card_collapses');
}

/* ---------- 11. 时间轴拖动 ---------- */
{
  const track = document.querySelector('#track');
  const r = track.getBoundingClientRect();
  const x = r.left + r.width * 0.75;
  window.scrollTo(0, 0);
  await sleep(80);
  track.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: r.top + 20, pointerId: 3, bubbles: true }));
  await sleep(200);
  out.scroll_after_drag = Math.round(window.scrollY);
  out.thumb = document.querySelector('#trackThumb').style.left;
  ok(out.scroll_after_drag > 1000, 'track_drag_scrolls', out.scroll_after_drag);
  track.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: r.top + 20, pointerId: 3, bubbles: true }));
}

/* ---------- 12. 点年份跳转 ---------- */
{
  const ticks = [...document.querySelectorAll('.tick')];
  out.ticks = ticks.map((t) => t.dataset.year);
  ticks[ticks.length - 1].click();
  await sleep(1600);
  const last = Math.round(window.scrollY);
  const lastActive = ticks[ticks.length - 1].classList.contains('is-active');
  ticks[0].click();
  await sleep(1700);
  const first = Math.round(window.scrollY);
  out.scroll_last_tick = last;
  out.scroll_first_tick = first;
  ok(last > 3000 && lastActive, 'tick_click_jumps_to_year', { last, lastActive });
  ok(first < last - 2000, 'tick_click_back_to_start', first);
}

/* ---------- 13. 术语总表跳转 ---------- */
{
  const details = document.querySelector('.glossary-details');
  details.open = true;
  await sleep(120);
  out.glossary_items = document.querySelectorAll('.gloss-item').length;
  const item = document.querySelectorAll('.gloss-item')[0];
  const term = item.dataset.term;
  item.click();
  await sleep(900);
  const opened = document.querySelector('.event.is-open');
  ok(!!opened, 'glossary_jumps_to_event', term + ' -> ' + (opened && opened.dataset.id));
  if (opened) {
    ok(!!opened.querySelector('.concept[data-term="' + CSS.escape(term) + '"], .concept'),
      'glossary_target_has_concept');
  }
}

/* ---------- 14. 无障碍与结构 ---------- */
{
  const track = document.querySelector('#track');
  ok(track.getAttribute('role') === 'slider', 'track_has_slider_role');
  ok(track.getAttribute('aria-valuenow') !== null, 'track_has_aria_valuenow');
  ok(document.querySelectorAll('.card-head[aria-expanded]').length ===
     document.querySelectorAll('.event').length, 'cards_have_aria_expanded');
  out.actor_count = document.querySelectorAll('.actor').length;
  out.term_count = document.querySelectorAll('.concept-term').length;
}

/* ---------- 15. 主题切换 ---------- */
{
  const root = document.documentElement;
  const btn = document.querySelector('#themeToggle');
  ok(!!btn, 'theme_toggle_exists');
  const start = root.dataset.theme;
  out.theme_start = start;
  btn.click();
  await sleep(150);
  const after = root.dataset.theme;
  ok(after !== start, 'theme_toggles', start + ' -> ' + after);
  ok(document.body.getBoundingClientRect().width > 0, 'page_alive_after_toggle');
  // 划词面板必须跟着一起换配色
  const wrap = document.querySelector('[data-ai-explain]').shadowRoot.querySelector('.sr');
  ok(wrap.getAttribute('data-theme') === after, 'explain_panel_follows_theme', wrap.getAttribute('data-theme'));
  // 切回去，确认可逆
  btn.click();
  await sleep(150);
  ok(root.dataset.theme === start, 'theme_toggles_back', root.dataset.theme);
}

/* ---------- 16. 三段式标签文案 ---------- */
{
  const ev = [...document.querySelectorAll('.event')].find((e) => e.querySelector('.step'));
  const labels = ev ? [...ev.querySelectorAll('.step b')].map((b) => b.textContent) : [];
  out.step_labels = labels;
  ok(labels[2] === '对一般社会公众意味着什么', 'step_label_renamed', labels[2]);
}

/* ---------- 汇总 ---------- */
out.__fails = fails;
out.__passed = Object.keys(out).filter((k) => k.indexOf('__') !== 0).length - fails.length;
return out;
