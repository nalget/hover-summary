// 用 5 个可用 oMLX 本地模型依次总结同一个百度链接的正文，对比【速度】与【质量】。
// 复用扩展 summary-modes.js 的总结 prompt 与 background.js 的 per-model 处理（reasoning 放大 / gemma 关思考 / gemma 合并 system）。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '..');
const EP = 'http://127.0.0.1:8000/v1/chat/completions';

// 复用真实扩展的总结 prompt 构建逻辑
const smMod = await import(path.join(root, 'src/summary-modes.js'));
const { buildMessages } = smMod.default ? smMod.default : smMod;

// 读取要总结的页面正文（来自 WebFetch 抓取的百度 SERP 可见文本）
let text = fs.readFileSync('/tmp/baidu_text.txt', 'utf8').trim();
const MAX = 2000;
if (text.length > MAX) text = text.slice(0, MAX);
console.log(`页面正文长度：${text.length} 字（已截断到 ${MAX}）\n`);

const MODELS = [
  'DeepSeek-R1-1.5B-4bit',
  'Nanbeige4.1-3B-8bit',
  'Qwen2.5-0.5B-Instruct-4bit',
  'Qwen2.5-VL-3B-Instruct-4bit',
  'gemma-4-e4b-it-4bit'
];

const SYSTEM = '你是一个严谨、简洁的阅读助手，只回答与所给内容相关的问题。不要输出任何分析过程、思考步骤或自我说明，只输出最终结果。';
const SUM_INSTR_ZH = '请用一两句话（中文）概括下面这段内容的核心意思，不要复述细节，也不要使用列表：\n\n';

function buildBody(model) {
  const { messages, maxTokens, temperature } = buildMessages('summary', text, {});
  // 复刻 background.js 的判定
  const isReasoning = /agnes|deepseek-r|reasoner|o1|o3|gpt-oss|nemotron|think|nanbeige/i.test(model);
  const effMax = isReasoning ? Math.min(Math.max(Math.maxTokens * 4, 700), 3000) : maxTokens;
  const noSystem = /gemma/i.test(model);
  let msgs = messages;
  if (noSystem) {
    msgs = messages.map((m) => (m.role === 'system' ? { role: 'user', content: m.content } : m));
    const merged = [];
    for (const m of msgs) {
      const last = merged[merged.length - 1];
      if (last && last.role === 'user' && m.role === 'user') last.content += '\n\n' + m.content;
      else merged.push({ ...m });
    }
    msgs = merged;
  }
  const body = { model, messages: msgs, max_tokens: effMax, temperature, stream: false };
  if (/gemma-?4/i.test(model)) body.enable_thinking = false; // 关掉 Gemma-4 思考，避免挤占正文
  return body;
}

function stripThink(s) {
  return (s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function summarize(model) {
  const body = buildBody(model);
  const start = performance.now();
  const resp = await fetch(EP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const elapsed = parseFloat(((performance.now() - start) / 1000).toFixed(2));
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 200);
    return { ok: false, latency: elapsed, error: `HTTP ${resp.status}: ${detail}` };
  }
  const data = await resp.json();
  const choice = data.choices && data.choices[0];
  const raw = (choice && (choice.message?.content || choice.text)) || '';
  const summary = stripThink(raw);
  return { ok: true, latency: elapsed, summary, chars: summary.length, usage: data.usage || null };
}

const results = [];
console.log('开始逐个模型总结（每个模型首次加载约 5–20s）...\n');
for (const m of MODELS) {
  process.stdout.write(`▶ ${m} ... `);
  const r = await summarize(m);
  if (r.ok) {
    console.log(`✅ ${r.latency}s, ${r.chars} 字`);
  } else {
    console.log(`❌ ${r.error}`);
  }
  results.push({ model: m, ...r });
}

// 输出表格
console.log('\n================ 速度对比 ================');
console.log('模型'.padEnd(30), '耗时(s)'.padStart(10), '字数'.padStart(8));
for (const r of results) {
  const lat = r.ok ? r.latency : '-';
  const ch = r.ok ? r.chars : '-';
  console.log(String(r.model).padEnd(30), String(lat).padStart(10), String(ch).padStart(8));
}

console.log('\n================ 质量对比（各模型输出） ================');
for (const r of results) {
  console.log(`\n----- ${r.model} ${r.ok ? '(耗时 ' + r.latency + 's)' : '(失败: ' + r.error + ')'} -----`);
  console.log(r.ok ? r.summary : '（无输出）');
}

// 写 markdown 报告
const md = ['# oMLX 本地模型总结对比（同一百度链接）', '',
  `> 页面正文长度：${text.length} 字（截断到 2000）`,
  '> 总结模式：summary（一两句话概括核心意思，中文，不列表）',
  '> 端点：' + EP, '',
  '## 速度对比', '',
  '| 模型 | 耗时(s) | 输出字数 |',
  '| --- | --- | --- |'
].concat(results.map((r) => `| ${r.model} | ${r.ok ? r.latency : 'ERR'} | ${r.ok ? r.chars : '-'} |`))
  .concat(['', '## 质量对比', '']).concat(
    results.map((r) => `### ${r.model} ${r.ok ? '(耗时 ' + r.latency + 's)' : '(失败)'}\n\n${r.ok ? r.summary : r.error}\n`)
  ).join('\n');

const outPath = path.join(root, 'test', 'model-comparison-report.md');
fs.writeFileSync(outPath, md);
console.log('\n报告已写入：' + outPath);
