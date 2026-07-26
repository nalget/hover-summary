// 在 node 沙箱加载真实 background.js，对【真实 oMLX 服务器】(127.0.0.1:8000) 做端到端验证：
// 1) listLocalModels 能列出当前 5 个可用模型（已删除损坏的 Gemma-4-E4B-4bit）
// 2) 可用模型(Nanbeige)能正常总结
// 3) gemma-4 走 enable_thinking:false 仍能总结
// 4) loadLocalModel 能只预热加载指定的单个模型并返回耗时
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '..');
const bgSrc = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
const smSrc = fs.readFileSync(path.join(root, 'src/summary-modes.js'), 'utf8');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

const sandbox = {
  performance: { now: () => performance.now() },
  fetch: global.fetch,
  AbortController: global.AbortController,
  setTimeout, clearTimeout, console, JSON, Math, Object, Array, Date,
  parseInt, parseFloat, String, Number, Boolean, isNaN, Error, encodeURIComponent, decodeURIComponent
};
sandbox.self = sandbox;
sandbox.importScripts = (f) => vm.runInContext(smSrc, sandbox, { filename: f });
const mkConfig = (model) => ({ hoverSummaryConfig: { model: 'local', local: { endpoint: 'http://127.0.0.1:8000/v1/chat/completions', model } } });
sandbox.chrome = {
  runtime: { onMessage: { addListener() {} }, sendMessage() {} },
  commands: { onCommand: { addListener() {} } },
  tabs: { query(cb) { cb && cb([]); } },
  storage: { sync: { get(keys, cb) { const r = mkConfig(sandbox.__model || 'Nanbeige4.1-3B-8bit'); if (typeof cb === 'function') cb(r); return Promise.resolve(r); }, set() {} } }
};
vm.createContext(sandbox);
vm.runInContext(bgSrc, sandbox, { filename: 'background.js' });

const TEXT = '北京是中国的首都，拥有悠久的历史和丰富的文化遗产，如故宫、长城与颐和园。';
const EP = 'http://127.0.0.1:8000/v1/chat/completions';

console.log('===== T1: listLocalModels 列出真实 oMLX 模型 =====');
const lm = await sandbox.listLocalModels(EP);
assert(lm.ok, 'listLocalModels 成功');
assert(Array.isArray(lm.models) && lm.models.length === 5, `应列出 5 个模型，实际=${lm.models.length}: ${lm.models.join(', ')}`);
assert(lm.models.includes('Nanbeige4.1-3B-8bit'), '列表含 Nanbeige4.1-3B-8bit');
assert(lm.models.includes('gemma-4-e4b-it-4bit'), '列表含 gemma-4-e4b-it-4bit(已修复)');
assert(!lm.models.includes('Gemma-4-E4B-4bit'), '已删除的损坏模型 Gemma-4-E4B-4bit 不应出现');

console.log('\n===== T2: 可用模型 Nanbeige 总结 =====');
sandbox.__model = 'Nanbeige4.1-3B-8bit';
const r2 = await sandbox.handleSummarize({ text: TEXT, mode: 'summary' });
assert(r2.success && r2.summary && r2.summary.length > 0, 'Nanbeige 返回非空摘要');
assert(!/<think>/i.test(r2.summary || ''), 'Nanbeige 摘要已剥离 <think> 思考块');

console.log('\n===== T3: gemma-4 走 enable_thinking:false 总结 =====');
sandbox.__model = 'gemma-4-e4b-it-4bit';
const r3 = await sandbox.handleSummarize({ text: TEXT, mode: 'summary' });
assert(r3.success && r3.summary && r3.summary.length > 0, 'gemma-4 返回非空摘要');

console.log('\n===== T4: loadLocalModel 只预热加载指定模型 =====');
const r4 = await sandbox.loadLocalModel(EP, 'Nanbeige4.1-3B-8bit');
assert(r4.ok, 'loadLocalModel 成功：' + (r4.latency != null ? r4.latency + 's' : ''));
assert(typeof r4.latency === 'number', '返回加载耗时 latency');

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
