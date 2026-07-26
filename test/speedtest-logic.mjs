// 在 node 沙箱中加载真实 background.js，用 mock fetch 验证 speedTestPublic 的“选最快”逻辑。
// 覆盖：OpenAI 兼容多模型、Pollinations 免密钥预设、DeepSeek 缺 Key、百度 OAuth、全部不可用。
import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bgSrc = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
const smSrc = fs.readFileSync(path.join(root, 'src/summary-modes.js'), 'utf8');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 通用 OpenAI 兼容端点：openai/mistral/llama 可用且各有延迟；其余模型 500
const fakeLatency = { openai: 1.2, mistral: 0.5, llama: 3.1 };
const fakeFetch = async (url, opts) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.includes('/oauth/2.0/token')) {
    return { ok: true, status: 200, json: async () => ({ access_token: 'FAKE_TOKEN' }) };
  }
  if (url.includes('aip.baidubce.com') && url.includes('access_token=')) {
    await delay(400);
    return { ok: true, status: 200, json: async () => ({ result: 'hi baidu' }) };
  }
  const model = body && body.model;
  if (model && model in fakeLatency) {
    await delay(fakeLatency[model] * 200);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi:' + model } }] }) };
  }
  return { ok: false, status: 500, text: async () => 'no such model' };
};

const sandbox = {
  performance: { now: () => Date.now() },
  fetch: fakeFetch,
  AbortController: global.AbortController,
  setTimeout, clearTimeout, console, JSON, Math, Object, Array, Date,
  parseInt, parseFloat, String, Number, Boolean, isNaN, Error, encodeURIComponent, decodeURIComponent
};
sandbox.self = sandbox;
sandbox.importScripts = (f) => { vm.runInContext(smSrc, sandbox, { filename: f }); };
sandbox.chrome = {
  runtime: { onMessage: { addListener() {} }, sendMessage() {} },
  commands: { onCommand: { addListener() {} } },
  tabs: { query(cb) { cb && cb([]); } },
  storage: { sync: { get(cb) { cb && cb({}); }, set() {} } }
};
vm.createContext(sandbox);
vm.runInContext(bgSrc, sandbox, { filename: 'background.js' });

console.log('===== speedTestPublic 逻辑测试 =====');

// T1: 通用 OpenAI 端点多模型 → 选最快且可用
const r1 = await sandbox.speedTestPublic({ endpoint: 'https://x/openai', candidates: ['openai', 'mistral', 'llama', 'gpt-4o-mini'] });
assert(r1.ok && r1.fastest === 'mistral', `多模型选最快可用（mistral 0.5s），实际=${r1.fastest}`);
assert(r1.results.filter((x) => x.ok).length === 3, '应有 3 个可用模型');

// T2: Pollinations 免密钥预设（无 Key 也能跑）→ 选最快
const r2 = await sandbox.speedTestPublic({ preset: 'pollinations' });
assert(r2.ok && r2.fastest === 'mistral', `Pollinations 预设选最快，实际=${r2.fastest}`);
assert(r2.results.find((x) => x.model === 'openai-fast').ok === false, '不存在的 openai-fast 应标记不可用');

// T3: DeepSeek 预设缺 Key → 明确报错
const r3 = await sandbox.speedTestPublic({ preset: 'deepseek' });
assert(r3.ok === false && r3.code === 'NO_KEY', `DeepSeek 缺 Key 应报 NO_KEY，实际=${r3.code}`);

// T4: 百度文心走 OAuth（client_id:client_secret）→ 选最快
const r4 = await sandbox.speedTestPublic({ preset: 'baidu', apiKey: 'cid:csec' });
assert(r4.ok && r4.fastest === 'eb-instant', `百度 OAuth 预设选最快，实际=${r4.fastest}`);

// T5: 全部不可用 → fastest 为 null
const r5 = await sandbox.speedTestPublic({ endpoint: 'https://x/openai', candidates: ['nope1', 'nope2'] });
assert(r5.ok && r5.fastest === null, '全部不可用时 fastest 应为 null');

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
