/* 真实 HTTP 链路自检：划词 → 面板 → 发送 → 打到本地模拟接口 → 渲染回答
   前置条件：先跑 tools/mock-ai-server.mjs 8899，并把 localStorage 里的
   ai-chronicle.ai-settings 指向 http://127.0.0.1:8899/v1（见 tools/checks/README） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const fails = [];
const ok = (c, name, extra) => { out[name] = extra === undefined ? !!c : extra; if (!c) fails.push(name); };

const host = document.querySelector('[data-ai-explain]');
const sr = host.shadowRoot;
const panel = sr.querySelector('.panel');

out.settings = JSON.parse(localStorage.getItem('ai-chronicle.ai-settings') || 'null');
ok(out.settings && out.settings.base, 'settings_in_localstorage', out.settings && out.settings.base);

/* 记录服务端已收到的请求数作为基线（模拟服务可能是常驻的） */
let baseline = 0;
try {
  const pre = await fetch('http://127.0.0.1:8899/__received').then((x) => x.json());
  baseline = pre.length;
} catch (e) { baseline = -1; }
out.baseline_requests = baseline;
ok(baseline >= 0, 'mock_server_reachable', baseline);

/* 划词 */
const lede = document.querySelectorAll('.event .card-lede')[3];
const selected = lede.textContent.trim().slice(0, 30);
const r = document.createRange();
r.selectNodeContents(lede);
const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
document.dispatchEvent(new Event('selectionchange'));
await sleep(300);
ok(sr.querySelector('.fab').classList.contains('is-on'), 'fab_shown');

/* 打开面板：此时模式应为「AI · <模型名>」，不再是本地词典 */
sr.querySelector('.fab').click();
await sleep(200);
out.mode = panel.querySelector('[data-mode]').textContent;
ok(out.mode.indexOf('AI · ') === 0 && out.mode.indexOf('deepseek') !== -1, 'mode_shows_ai', out.mode);

/* 追加提问后发送 */
const ta = panel.querySelector('[data-q]');
ta.value = selected + ' 用一句话打个比方';
ta.dispatchEvent(new Event('input', { bubbles: true }));
ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

/* 等真实网络往返 */
let reply = '';
for (let i = 0; i < 40; i++) {
  await sleep(150);
  const bubbles = [...panel.querySelectorAll('.bubble.ai')];
  if (bubbles.length && bubbles[bubbles.length - 1].textContent.indexOf('模拟回答') !== -1) {
    reply = bubbles[bubbles.length - 1].textContent;
    break;
  }
}
ok(reply.indexOf('模拟回答') !== -1, 'ai_reply_rendered', reply.slice(0, 60));
ok(reply.indexOf('菜谱') !== -1, 'reply_body_from_server');

const prompt = (panel.querySelector('.p-prompt pre') || {}).textContent || '';
out.prompt_len = prompt.length;
ok(prompt.indexOf('【上下文】') !== -1 && prompt.indexOf('【选中片段】') !== -1 &&
   prompt.indexOf('【用户问题】') !== -1, 'prompt_sections');
ok(prompt.indexOf('用一句话打个比方') !== -1, 'prompt_has_followup');

/* 错误处理与「服务端确实收到了这条提示词」的硬证据 */
await fetch('http://127.0.0.1:8899/__received').then((x) => x.json()).then((d) => {
  out.server_received = d.length;
  const mine = d.slice(baseline);
  out.new_requests = mine.length;
  const last = mine[mine.length - 1] || {};
  out.server_prompt = last.user || null;
  out.server_auth = last.auth || null;
  out.server_model = last.model || null;
}).catch(() => { out.server_received = 'unreachable'; });
ok(out.new_requests === 1, 'server_received_exactly_one_new_request', out.new_requests);
ok((out.server_prompt || '').indexOf('【选中片段】') !== -1, 'server_got_full_prompt');
ok(out.server_auth === 'Bearer ' + out.settings.key, 'server_got_auth_header', out.server_auth);
ok(out.server_model === out.settings.model, 'server_got_model_name', out.server_model);

out.__fails = fails;
out.__passed = Object.keys(out).filter((k) => k.indexOf('__') !== 0).length - fails.length;
return out;
