#!/usr/bin/env node
/**
 * mock-ai-server.mjs · 假的 OpenAI 兼容接口
 * ------------------------------------------------------------
 * 用来端到端验证「划词解释 → 真实 HTTP 请求 → 渲染回答」这条链路，
 * 不需要任何真实 API Key。
 *
 * 用法：
 *   node tools/mock-ai-server.mjs 8899
 *   # 然后在网站的 ⚙ 里填 Base URL = http://127.0.0.1:8899/v1 ，模型随意，Key 随意
 *
 * 它会打印收到的完整 prompt（也就是本站拼接出来的提示词），方便人工核对。
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || 8899);
const received = [];

const server = http.createServer((req, res) => {
  // 允许浏览器跨域直连
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url.endsWith('/chat/completions') && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* ignore */ }
      const userMsg = (parsed.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n');
      received.push({ model: parsed.model, auth: req.headers.authorization, user: userMsg });
      console.log('\n===== 收到请求 =====');
      console.log('model :', parsed.model);
      console.log('auth  :', req.headers.authorization);
      console.log('prompt:\n' + userMsg);
      console.log('====================\n');

      const reply = '【模拟回答】把这件事想象成一群人共用一本不断加页的菜谱：' +
        '每道新菜都基于前面的做法。选中片段说的是「' +
        (userMsg.match(/【选中片段】(.*)/) || [, '（没解析到）'])[1].slice(0, 30) +
        '」，大意就是这一步在整本菜谱里的位置。';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock-1', object: 'chat.completion', model: parsed.model || 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));
    });
    return;
  }

  if (req.url === '/__received' || req.url === '/received') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(received, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'not found' } }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`模拟 AI 接口已启动：http://127.0.0.1:${PORT}/v1/chat/completions`);
});
