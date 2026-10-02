#!/usr/bin/env node
/**
 * build-data.mjs
 * 把 research/*.json（研究员产出的原始事件数据）清洗、校验、合并成站点直接可用的
 * assets/js/data/events.js 与 assets/js/data/glossary.js，并输出校验报告。
 *
 * 用法：node tools/build-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH = path.join(ROOT, 'research');
const OUT_DIR = path.join(ROOT, 'assets', 'js', 'data');

const SOURCES = [
  '2022-2023',
  '2024',
  '2024-extra',
  '2025h1',
  '2025h2',
  '2026'
].map((base) => {
  // 规范化稿优先（由内容规范流程产出），没有就用原始研究稿
  const norm = `${base}.norm.json`;
  return fs.existsSync(path.join(RESEARCH, norm)) ? norm : `${base}.json`;
});

const LIMITS = { title: 20, summary: 200, plainMin: 80, plainMax: 150 };

/* ---------------- 文本清洗 ---------------- */

const clean = (v) =>
  String(v ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/^["'“”]|["'“”]$/g, '')
    .trim();

const len = (s) => [...String(s ?? '')].length;

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(clean).filter(Boolean);

/* ---------------- 读取 ---------------- */

const problems = [];
const notes = [];
const all = [];

const readJson = (file) => {
  const full = path.join(RESEARCH, file);
  if (!fs.existsSync(full)) { problems.push(`缺少研究文件：${file}`); return []; }
  const text = fs.readFileSync(full, 'utf8').trim();
  const body = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) throw new Error('不是一个 JSON 数组');
    return parsed;
  } catch (err) {
    problems.push(`${file} 解析失败：${err.message}`);
    return [];
  }
};

for (const file of SOURCES) {
  const list = readJson(file);
  notes.push(`${file}: ${list.length} 条`);
  list.forEach((ev) => all.push({ ...ev, __file: file }));
}

/* ---------------- 规范化 + 校验 ---------------- */

const seen = new Set();
const events = [];

all.forEach((raw, i) => {
  const where = `${raw.__file} · ${raw.date} ${raw.title}`;
  const date = clean(raw.date);
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) {
    problems.push(`[日期格式] ${where}`);
    return;
  }
  const title = clean(raw.title);
  const summary = clean(raw.summary);
  if (!title || !summary) { problems.push(`[缺标题或概述] ${where}`); return; }

  const key = date + '|' + title;
  if (seen.has(key)) { problems.push(`[重复事件，已跳过] ${where}`); return; }
  seen.add(key);

  const category = raw.category === 'social' ? 'social' : 'technical';
  const year = parseInt(date.slice(0, 4), 10);
  const concepts = (Array.isArray(raw.concepts) ? raw.concepts : [])
    .filter((c) => c && (c.term || c.name) && (c.plain || c.explain))
    .map((c) => ({ term: clean(c.term || c.name), plain: clean(c.plain || c.explain) }))
    .filter((c) => c.term && c.plain);

  const ev = {
    id: 'e' + String(i + 1).padStart(3, '0') + '-' + date.replace(/-/g, ''),
    date,
    date_note: clean(raw.date_note),
    title,
    category,
    actors: arr(raw.actors).slice(0, 6),
    era: year >= 2022 ? String(year) : 'prehistory',
    summary,
    background: clean(raw.background),
    concepts,
    impact: clean(raw.impact),
    connections: arr(raw.connections),
    sources: arr(raw.sources).filter((u) => /^https?:\/\//.test(u)),
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium'
  };

  /* --- 校验 --- */
  if (len(ev.title) > LIMITS.title) problems.push(`[标题 ${len(ev.title)} 字 > ${LIMITS.title}] ${where}`);
  if (len(ev.summary) > LIMITS.summary) problems.push(`[概述 ${len(ev.summary)} 字 > ${LIMITS.summary}] ${where}`);
  if (len(ev.summary) < 60) problems.push(`[概述过短 ${len(ev.summary)} 字] ${where}`);
  if (!ev.background) problems.push(`[缺 background] ${where}`);
  else if (len(ev.background) < 80) problems.push(`[background 偏短 ${len(ev.background)} 字] ${where}`);
  if (!ev.impact) problems.push(`[缺 impact] ${where}`);
  if (!ev.concepts.length) problems.push(`[缺 concepts] ${where}`);
  if (!ev.sources.length) problems.push(`[无来源链接] ${where}`);
  if (ev.confidence === 'low' && !ev.date_note) problems.push(`[low 置信但没写 date_note] ${where}`);
  ev.concepts.forEach((c) => {
    const n = len(c.plain);
    if (n < LIMITS.plainMin || n > LIMITS.plainMax) {
      problems.push(`[术语「${c.term}」解释 ${n} 字，期望 ${LIMITS.plainMin}-${LIMITS.plainMax}] ${where}`);
    }
  });
  if (year >= 2022 && !/→|->/.test(ev.summary)) {
    problems.push(`[概述没有用「→」分出三段] ${where}`);
  }

  events.push(ev);
});

/* ---------------- 排序 ---------------- */

events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

/* ---------------- 术语总表 ---------------- */

const gmap = new Map();
for (const ev of events) {
  for (const c of ev.concepts) {
    const k = c.term.toLowerCase();
    const prev = gmap.get(k);
    if (!prev) gmap.set(k, { term: c.term, plain: c.plain, count: 1 });
    else {
      prev.count++;
      if (len(c.plain) > len(prev.plain)) prev.plain = c.plain;   // 取更完整的解释
    }
  }
}
const glossary = [...gmap.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

/* ---------------- 写出 ---------------- */

fs.mkdirSync(OUT_DIR, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
const banner =
  `/* 自动生成，请勿手改。\n` +
  `   源数据：research/*.json  生成脚本：tools/build-data.mjs  生成日期：${stamp}\n` +
  `   共 ${events.length} 条事件。*/\n`;

fs.writeFileSync(
  path.join(OUT_DIR, 'events.js'),
  banner + 'window.AI_CHRONICLE = ' +
    JSON.stringify({ generatedAt: stamp, count: events.length, events }, null, 0) + ';\n',
  'utf8'
);

fs.writeFileSync(
  path.join(OUT_DIR, 'glossary.js'),
  banner + 'window.AI_CHRONICLE_GLOSSARY = ' +
    JSON.stringify(glossary, null, 0) + ';\n',
  'utf8'
);

/* ---------------- 报告 ---------------- */

const byEra = {};
for (const ev of events) byEra[ev.era] = (byEra[ev.era] || 0) + 1;
const byCat = { technical: 0, social: 0 };
for (const ev of events) byCat[ev.category]++;

const report = [
  `# 数据校验报告`,
  ``,
  `生成时间：${new Date().toISOString()}`,
  ``,
  `## 汇总`,
  ``,
  `- 事件总数：**${events.length}**`,
  `- 技术线：${byCat.technical} 条 / 社会线：${byCat.social} 条`,
  `- 年份分布：${Object.entries(byEra).map(([k, v]) => `${k}=${v}`).join('，')}`,
  `- 术语总数：**${glossary.length}**`,
  `- 来源文件：${notes.join('；')}`,
  ``,
  `## 待修问题（${problems.length}）`,
  ``,
  problems.length ? problems.map((p) => `- ${p}`).join('\n') : '无 ✅',
  ``
].join('\n');

fs.writeFileSync(path.join(RESEARCH, 'report.md'), report, 'utf8');

console.log(report);

const hardFail = problems.filter((p) => /解析失败|缺少研究文件|缺标题|日期格式/.test(p));
if (hardFail.length) {
  console.error('\n存在致命问题，构建仍已产出，但请先修复以上条目。');
  process.exitCode = 1;
}
