#!/usr/bin/env node
/**
 * probe.mjs · 零依赖的 Chrome DevTools Protocol 探针
 * ------------------------------------------------------------
 * 用无头 Chrome 打开页面，收集控制台报错、执行断言、截图。
 *
 * 用法：
 *   node tools/probe.mjs --url=http://127.0.0.1:8787/index.html --out=/tmp/shot.png
 *   node tools/probe.mjs --url=... --eval="document.querySelectorAll('.event').length" --wait=2000
 *   node tools/probe.mjs --url=... --eval-file=tools/checks/home.js
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/s);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);

const URL_ = args.url || 'http://127.0.0.1:8787/index.html';
const OUT = args.out || '';
const WAIT = Number(args.wait || 2200);
const PORT = Number(args.port || 9333);
const WIDTH = Number(args.width || 1440);
const HEIGHT = Number(args.height || 1000);
const FULL = args.full !== 'false';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Chromium，可设置 CHROME_PATH'); process.exit(2); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-prof-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--hide-scrollbars',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let stderrBuf = '';
chrome.stderr.on('data', (d) => { stderrBuf += d.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('DevTools 端口没起来：\n' + stderrBuf.slice(0, 2000));
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const events = [];
    let id = 0;
    const send = (method, params = {}) => new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    ws.addEventListener('open', () => resolve({ send, events, close: () => ws.close() }));
    ws.addEventListener('error', (e) => reject(new Error('WebSocket 错误 ' + (e.message || ''))));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    });
  });
}

(async () => {
  const version = await waitForDevtools();
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = await connect(target.webSocketDebuggerUrl);

  const consoleMsgs = [];
  const errors = [];

  cdp.events.length = 0;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  // 无头 Chrome 有最小窗宽，用设备指标覆盖才能测真机尺寸
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1,
    mobile: args.mobile === 'true' || args.mobile === true
  });
  if (args.mobile === 'true' || args.mobile === true) {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  // 在页面任何脚本执行之前注入（用于预置 localStorage 等）
  let preScript = args['pre-eval'];
  if (args['pre-eval-file']) preScript = fs.readFileSync(args['pre-eval-file'], 'utf8');
  if (preScript) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: preScript });
  }

  const pump = setInterval(() => {
    while (cdp.events.length) {
      const msg = cdp.events.shift();
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        consoleMsgs.push({ type: msg.params.type, text });
        if (msg.params.type === 'error') errors.push('console.error: ' + text);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push('未捕获异常: ' + (d.exception?.description || d.text));
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry;
        consoleMsgs.push({ type: e.level, text: e.text });
        if (e.level === 'error' && !/favicon/i.test(e.text)) errors.push('log.error: ' + e.text + (e.url ? ' @ ' + e.url : ''));
      } else if (msg.method === 'Network.loadingFailed') {
        const t = msg.params.type;
        if (t !== 'Image' && t !== 'Font') {
          errors.push('资源加载失败: ' + t + ' ' + (msg.params.errorText || ''));
        }
      }
    }
  }, 40);

  const loaded = new Promise((resolve) => {
    const t = setInterval(() => {
      if (cdp.events.some((e) => e.method === 'Page.loadEventFired')) { clearInterval(t); resolve(); }
    }, 40);
    setTimeout(() => { clearInterval(t); resolve(); }, 15000);
  });

  await cdp.send('Page.navigate', { url: URL_ });
  await loaded;
  await sleep(WAIT);

  let evalResult = null;
  let evalError = null;
  let expr = args.eval;
  if (args['eval-file']) expr = fs.readFileSync(args['eval-file'], 'utf8');
  if (expr) {
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(async () => { ${expr} })()`,
        returnByValue: true, awaitPromise: true, userGesture: true
      });
      if (r.exceptionDetails) {
        evalError = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
      } else {
        evalResult = r.result.value;
      }
    } catch (e) { evalError = e.message; }
  }

  if (OUT) {
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: !!FULL
    });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  }

  const report = {
    url: URL_,
    browser: version.Browser,
    errors,
    console: consoleMsgs.slice(0, 40),
    evalResult,
    evalError,
    screenshot: OUT || null
  };
  console.log(JSON.stringify(report, null, 2));

  clearInterval(pump);
  try { await cdp.send('Browser.close'); } catch { /* ignore */ }
  cdp.close();
  chrome.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(errors.length || evalError ? 1 : 0);
})().catch(async (err) => {
  console.error('探针失败：', err.message);
  chrome.kill('SIGKILL');
  process.exit(2);
});
