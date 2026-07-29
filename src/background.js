// background.js — Service Worker (Manifest V3)
// 处理所有 API 调用（绕过 CORS），并负责模式路由、缓存与错误分类。

// 复用模式定义（与 content.js 同源，避免逻辑分叉）
importScripts('summary-modes.js');
const { buildMessages, resolveLang } = self.HS_MODES;

const DEFAULT_CONFIG = {
  enabled: true,
  model: 'chrome', // 默认用 Chrome 内置 Gemini Nano（设备端·免Key·离线）；不可用时自动回退
  theme: 'auto', // auto | light | dark
  maxLength: 2000, // 送入模型的文本上限（全局）
  maxOutput: 800, // 单次摘要最大输出 token：防小模型陷入重复循环，可在设置里调小（如 0.5B 设 256）
  maxLocalInput: 1500, // 本地小模型输入上限（字符）：避免长文触发重复/超时，仅在本地模型生效
  hoverDelay: 800,
  triggerMode: 'select', // select | hover | shift+hover
  lang: 'auto', // 统一展示/摘要语言：auto=跟随系统，或 zh-CN/en/ja/ko/fr/de/es/ru
  outputLang: 'en', // 由 lang 解析得到的有效输出语言（内部用）
  bubbleHideDelay: 3000, // 鼠标离开气泡后的保留(淡出)时间 ms（默认约 3 秒）
  duplicateCheck: true, // 悬停时并行检测换皮
  duplicateEndpoint: 'http://127.0.0.1:8765', // 本地换皮检测服务
  agnes: {
    endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions',
    apiKey: '',
    model: 'agnes-2.0-flash'
  },
  nvidia: {
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiKey: '',
    model: 'openai/gpt-oss-120b'
  },
  local: {
    endpoint: 'http://127.0.0.1:8000/v1/chat/completions',
    apiKey: '',
    model: '' // 不预设模型：由弹窗自动探测服务地址并列出模型后，用户显式选择
  },
  // Chrome 内置 AI（Gemini Nano，设备端离线运行）：无需 endpoint / Key / 模型选择。
  // 由浏览器内置，走 Summarizer API（摘要/要点）+ Prompt API（解释/翻译/追问）。
  chrome: {},
  // 网上公开大模型：默认用 DeepSeek 官方 API（OpenAI 兼容、注册送免费额度、稳定快速、中文好）。
  // 弹窗可一键切换 阿里通义千问 / 腾讯混元 / 百度文心 / Pollinations(免密钥)。
  public: {
    preset: 'deepseek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKey: '',
    model: 'deepseek-chat'
  },
  // NVIDIA NIM 可用模型列表（2026-07-16 实测通过中英文摘要的 15 个最新模型）
  nvidia_models: [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'deepseek-ai/deepseek-v4-flash',
    'deepseek-ai/deepseek-v4-pro',
    'google/gemma-4-31b-it',
    'google/gemma-2-2b-it',
    'google/gemma-3n-e2b-it',
    'google/gemma-3n-e4b-it',
    'minimaxai/minimax-m2.7',
    'minimaxai/minimax-m3',
    'mistralai/mistral-medium-3.5-128b',
    'mistralai/mistral-small-4-119b-2603',
    'nvidia/nemotron-3-nano-30b-a3b',
    'nvidia/nemotron-3-super-120b-a12b',
    'nvidia/nemotron-3-ultra-550b-a55b'
  ]
};

// 公开大模型预设（弹窗一键切换）。除 Pollinations 外均需填入对应平台的免费 API Key。
const PUBLIC_PRESETS = {
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    needKey: true,
    openai: true,
    keyHint: 'DeepSeek API Key（官网注册即送免费额度）'
  },
  qwen: {
    label: '阿里通义千问',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    needKey: true,
    openai: true,
    keyHint: '阿里云 DashScope API Key（开通模型即送免费额度）'
  },
  hunyuan: {
    label: '腾讯混元',
    endpoint: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
    models: ['hunyuan-lite', 'hunyuan-standard', 'hunyuan-pro'],
    needKey: true,
    openai: true,
    keyHint: '腾讯云混元 API Key（控制台开通送免费额度）'
  },
  baidu: {
    label: '百度文心',
    endpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant',
    models: ['eb-instant'],
    needKey: true,
    openai: false,
    keyHint: '百度智能云：填 client_id:client_secret（两个密钥用冒号连接）'
  },
  pollinations: {
    label: 'Pollinations(免密钥)',
    endpoint: 'https://text.pollinations.ai/openai',
    models: ['openai', 'openai-fast', 'mistral', 'llama'],
    needKey: false,
    openai: true,
    keyHint: '免密钥，留空即可（偶发服务端抖动，建议优先用上方国内大模型）'
  }
};

// 结果缓存（Service Worker 存活期间有效，避免同一段文字重复调用）
const _cache = new Map();
const CACHE_MAX = 200;

async function getConfig() {
  const stored = await chrome.storage.sync.get('hoverSummaryConfig');
  const cfg = { ...DEFAULT_CONFIG, ...(stored.hoverSummaryConfig || {}) };
  cfg.agnes = { ...DEFAULT_CONFIG.agnes, ...(cfg.agnes || {}) };
  cfg.nvidia = { ...DEFAULT_CONFIG.nvidia, ...(cfg.nvidia || {}) };
  cfg.local = { ...DEFAULT_CONFIG.local, ...(cfg.local || {}) };
  cfg.public = { ...DEFAULT_CONFIG.public, ...(cfg.public || {}) };
  // 统一语言：lang 优先；旧存储仅有 outputLang 时沿用之（向后兼容），否则默认 auto
  cfg.lang = cfg.lang || cfg.outputLang || DEFAULT_CONFIG.lang;
  cfg.outputLang = resolveLang(cfg.lang);
  if (!cfg.bubbleHideDelay) cfg.bubbleHideDelay = DEFAULT_CONFIG.bubbleHideDelay;
  cfg.chrome = { ...DEFAULT_CONFIG.chrome, ...(cfg.chrome || {}) };
  // 迁移：旧版把损坏/已删除的模型（如 Gemma-4-E4B-4bit）写进了存储，清空让用户重新选择
  if (cfg.local && cfg.local.model === 'Gemma-4-E4B-4bit') {
    cfg.local.model = '';
  }
  // 迁移：旧版默认 model 是 public，如果没对应 key 就切到 nvidia
  if (cfg.model === 'public' && !(cfg.public && cfg.public.apiKey)) {
    cfg.model = 'nvidia';
  }
  // 一次性持久化迁移
  const oldStored = stored.hoverSummaryConfig || {};
  if (oldStored.agnes?.apiKey === '' || oldStored.nvidia?.apiKey === '' || oldStored.model === 'public') {
    await chrome.storage.sync.set({ hoverSummaryConfig: cfg });
  }
  return cfg;
}

// ── 消息路由 ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    handleSummarize(request, sender)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: e.message, code: 'UNKNOWN' }));
    return true;
  }
  if (request.action === 'getConfig') {
    getConfig().then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (request.action === 'setEnabled') {
    getConfig()
      .then((cfg) => {
        cfg.enabled = !!request.enabled;
        return chrome.storage.sync.set({ hoverSummaryConfig: cfg });
      })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (request.action === 'testConnection') {
    testConnection(request.provider)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message, code: 'UNKNOWN' }));
    return true;
  }
  if (request.action === 'speedTestPublic') {
    speedTestPublic(request.opts || request)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message, code: 'UNKNOWN' }));
    return true;
  }
  if (request.action === 'detectDuplicate') {
    handleDetectDuplicate(request)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (request.action === 'fetchPageContent') {
    fetchPageContent(request.url)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (request.action === 'listLocalModels') {
    listLocalModels(request.endpoint)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message, code: 'UNKNOWN' }));
    return true;
  }
  if (request.action === 'detectLocalEndpoint') {
    detectLocalEndpoint(request.endpoint)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message, code: 'UNKNOWN' }));
    return true;
  }
  if (request.action === 'loadLocalModel') {
    loadLocalModel(request.endpoint, request.model)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message, code: e.code || 'LOAD_FAIL' }));
    return true;
  }
  if (request.action === 'checkChromeAI') {
    checkChromeAI()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (request.action === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
});

// 快捷键：Ctrl/Cmd + Shift + H 切换启用状态
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-enabled') {
      getConfig()
        .then((cfg) => {
          cfg.enabled = !cfg.enabled;
          return chrome.storage.sync.set({ hoverSummaryConfig: cfg }).then(() => cfg.enabled);
        })
        .then((enabled) => {
          // 通知所有标签页的内容脚本刷新 enabled 状态
          chrome.tabs &&
            chrome.tabs.query({}, (tabs) => {
              (tabs || []).forEach((t) => {
                if (t.id) chrome.tabs.sendMessage(t.id, { action: 'setEnabled', enabled }).catch(() => {});
              });
            });
        })
        .catch(() => {});
    }
  });
}

// ── 带超时的 fetch ────────────────────────────────────────
function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(tid));
}

// ── 抓取链接目标页面的纯文本内容 ───────────────────────────
async function fetchPageContent(url) {
  if (!url) return { success: false, error: '无 URL' };
  try {
    // 用 background fetch 获取页面 HTML
    const resp = await fetchWithTimeout(url, {}, 10000);
    if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
    const html = await resp.text();
    // 提取纯文本：移除 script/style，提取 body 文字，清理空白
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 20) return { success: false, error: '页面内容太少' };
    // 检测「需 JavaScript 渲染」的页面（X/Twitter、Instagram、LinkedIn 等 SPA）：
    // 这类站点无 JS 时只返回一段提示（如 "JavaScript is not available"），不能当正文总结。
    if (/javascript is (?:not available|disabled)|enable javascript|turn on javascript|javascript required|your browser does (?:not|doesn'?t) (?:support|have) javascript|请(启用|开启|打开).{0,4}javascript|需要.{0,4}javascript/i.test(text)) {
      return { success: false, error: 'JS_REQUIRED: 该页面需 JavaScript 渲染（如 X / Twitter 等动态站点），无法抓取正文' };
    }
    return { success: true, text: text.slice(0, 5000) }; // 最多取 5000 字
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function hashKey(str) {
  // 轻量 djb2，仅用于缓存键
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// 去除模型陷入重复循环产生的“车轱辘话”：从文本末尾回溯，检测同一小片段是否循环 ≥3 次，
// 若命中则只保留第一组重复单元、截断其后，保证气泡里不会出现一长串重复文本。
function dedupeRepetition(text) {
  if (!text || text.length < 40) return text;
  const L = text.length;
  for (let uLen = 4; uLen <= 60; uLen++) {
    const u = text.slice(-uLen);
    if (!u.trim()) continue;
    let reps = 0;
    let pos = L;
    while (pos >= uLen && text.slice(pos - uLen, pos) === u) {
      reps++;
      pos -= uLen;
    }
    if (reps >= 3) {
      const cut = pos + uLen; // 保留第一组重复单元，截断其后
      if (cut >= L) return text;
      return text.slice(0, cut).trim() + ' …';
    }
  }
  return text;
}

// ── 列出本地 oMLX 可用模型（GET /v1/models）──────────────
// 让弹窗能动态感知 oMLX 当前实际加载的模型，而不是写死一个名字。
async function listLocalModels(endpoint) {
  const ep = (endpoint || 'http://127.0.0.1:8000/v1/chat/completions').trim();
  const base = ep.replace(/\/v1\/chat\/completions$/, '').replace(/\/$/, '');
  const url = base + '/v1/models';
  try {
    const resp = await fetchWithTimeout(url, { method: 'GET' }, 8000);
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}（${url}）`, code: 'HTTP' };
    const data = await resp.json().catch(() => null);
    const models = (data && Array.isArray(data.data) ? data.data : [])
      .map((m) => (m && m.id) || '')
      .filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    const code = e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
    return {
      ok: false,
      code,
      error: (code === 'TIMEOUT' ? '连接 oMLX 超时（>8s）' : '无法连接本地 oMLX（' + url + '）') +
        '：请确认已运行 `omlx serve`'
    };
  }
}

// ── 自动探测本地模型服务地址 ──────────────────────────────
// 依次并行探测常见本地推理服务端口（oMLX/LM Studio/Ollama/llama.cpp），
// 返回第一个能列出模型的地址 + 模型列表，弹窗据此自动填充，无需手填。
const LOCAL_CANDIDATE_BASES = [
  'http://127.0.0.1:8000',  // oMLX 默认
  'http://localhost:8000',  // 同上（个别代理策略下 127.0.0.1 与 localhost 表现不同）
  'http://127.0.0.1:1234',  // LM Studio 默认
  'http://127.0.0.1:11434', // Ollama（OpenAI 兼容 /v1）
  'http://127.0.0.1:8080'   // llama.cpp server 默认
];

async function probeModels(base, timeoutMs = 2500) {
  const resp = await fetchWithTimeout(base + '/v1/models', { method: 'GET' }, timeoutMs);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  const models = (Array.isArray(data && data.data) ? data.data : [])
    .map((m) => (m && m.id) || '')
    .filter(Boolean);
  if (!models.length) throw new Error('无模型');
  return models;
}

async function detectLocalEndpoint(savedEndpoint) {
  // 已保存的地址优先探测（用户可能自定义过端口）
  const savedBase = savedEndpoint
    ? savedEndpoint.trim().replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/$/, '')
    : null;
  const bases = [...new Set([savedBase, ...LOCAL_CANDIDATE_BASES].filter(Boolean))];
  const probes = bases.map((b) => probeModels(b).then(
    (models) => ({ base: b, models }),
    () => null
  ));
  const results = await Promise.all(probes);
  const hit = results.find(Boolean); // 按候选顺序取第一个成功的
  if (!hit) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      error: '未发现本地模型服务（已探测 ' + bases.map((b) => b.replace('http://', '')).join(' / ') + '），请确认已启动 omlx serve / LM Studio / Ollama'
    };
  }
  return { ok: true, base: hit.base, endpoint: hit.base + '/v1/chat/completions', models: hit.models };
}

// 仅加载（预热）指定的本地 oMLX 模型：发一次极小请求，把该模型载入 oMLX 内存。
// oMLX 自带内存看守会自动淘汰其它模型，所以“一次只加载一个”不会堆积内存。
async function loadLocalModel(endpoint, model) {
  if (!model) return { ok: false, error: '未选择模型', code: 'NO_MODEL' };
  const cfg = { endpoint: endpoint || 'http://127.0.0.1:8000/v1/chat/completions', apiKey: '', model };
  try {
    const res = await callChatAPI(cfg, [{ role: 'user', content: 'ping' }], { maxTokens: 8, temperature: 0.1, isLocal: true });
    if (!res || !res.summary) return { ok: false, error: '模型返回为空', code: 'EMPTY' };
    return { ok: true, model, latency: res.elapsed };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || 'LOAD_FAIL' };
  }
}

// ── Chrome 内置 AI（Gemini Nano，设备端离线）─────────────
// 重要：Chrome 内置 AI（Prompt API / Summarizer）属于“内置 AI API”，
// 按 Chrome 官方文档 **无法在 Web Worker / 扩展 Service Worker 中使用**，
// 只能在顶级窗口或页面主世界（MAIN world）访问。因此后台 Service Worker 里
// self.LanguageModel / self.Summarizer 恒为 undefined。
// 解决方案：把实际调用代理到“主世界桥接脚本”(chrome-ai-bridge.js)，
// 由它访问 window.LanguageModel / window.Summarizer 并返回结果。
// 弹窗“检查”仅走主世界桥接查询可用性（不下载）。
async function callChromeAI(mode, payload, tabId) {
  if (!tabId) {
    const e = new Error('Chrome 内置 AI 需在页面主世界调用（缺少来源标签页）');
    e.code = 'NO_CHROME_AI';
    throw e;
  }
  let r;
  try {
    r = await chrome.tabs.sendMessage(tabId, {
      action: 'chromeAiCall',
      payload: {
        mode,
        text: payload.text,
        messages: payload.messages,
        question: payload.question,
        history: payload.history
      }
    });
  } catch (e) {
    const err = new Error('Chrome 内置 AI 桥接不可用：' + e.message);
    err.code = 'NO_CHROME_AI';
    throw err;
  }
  if (!r) {
    const e = new Error('Chrome 内置 AI 桥接无响应（页面可能未注入主世界脚本）');
    e.code = 'NO_CHROME_AI';
    throw e;
  }
  if (r.error) {
    const e = new Error(r.error);
    e.code = r.code || 'NO_CHROME_AI';
    throw e;
  }
  return { summary: r.summary, elapsed: r.elapsed };
}

// 选一个可用回退 provider：本地 oMLX > NVIDIA NIM > Agnes（按已配置情况）
function pickFallbackProvider(config) {
  if (config.local && config.local.model) return { provider: 'local', label: '本地 oMLX', cfg: config.local };
  if (config.nvidia && config.nvidia.apiKey) return { provider: 'nvidia', label: 'NVIDIA NIM', cfg: config.nvidia };
  if (config.agnes && config.agnes.apiKey) return { provider: 'agnes', label: 'Agnes', cfg: config.agnes };
  return null;
}

// 探测内置 AI 可用性（仅查询，不下载）。
// 返回各子 API 的 availability 状态；downloadable/downloading 表示需浏览器自带模型，本扩展不引导下载。
async function checkChromeAI() {
  const LM = self.LanguageModel;
  const Sum = self.Summarizer;
  if (!LM && !Sum) {
    return {
      ok: false,
      available: false,
      reason: '此 Chrome 版本未开放内置 AI：需 Chrome 138+ 并到 chrome://flags 开启 optimization-guide-on-device-model 与 prompt-api-for-gemini-nano，且为桌面端。'
    };
  }
  const out = { ok: true, available: true, summarizer: 'n/a', languageModel: 'n/a' };
  if (Sum) {
    try {
      out.summarizer = await Sum.availability({ type: 'tldr', format: 'markdown', length: 'short' }).catch(() => 'unavailable');
    } catch (e) {
      out.summarizer = 'error: ' + e.message;
    }
  }
  if (LM) {
    try {
      out.languageModel = await LM.availability().catch(() => 'unavailable');
    } catch (e) {
      out.languageModel = 'error: ' + e.message;
    }
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────────
async function handleSummarize(req, sender) {
  const config = await getConfig();
  if (!config.enabled) return { success: false, error: '扩展已关闭，请在设置中开启', code: 'DISABLED' };

  const provider = config.model;
  const isLocal = provider === 'local';
  const mode = req.mode && self.HS_MODES.SUMMARY_MODES[req.mode] ? req.mode : 'summary';
  // 本地小模型（如 0.5B）输入过长易触发重复/超时：单独限制 maxLocalInput
  const inputCap = isLocal ? Math.min(config.maxLength || 2000, config.maxLocalInput || 1500) : (config.maxLength || 2000);
  const text = (req.text || '').slice(0, inputCap);
  if (!text || text.trim().length < 2) return { success: false, error: '没有可总结的文本内容', code: 'EMPTY_TEXT' };

  if (isLocal && !(config.local && config.local.model)) {
    return { success: false, error: '未选择本地模型：请打开扩展设置，在本地模型列表中选择并确认加载', code: 'NO_LOCAL_MODEL' };
  }
  const isChrome = provider === 'chrome';
  const isPublic = provider === 'public';
  const isKeylessPublic = isPublic && /text\.pollinations\.ai/.test((config.public && config.public.endpoint) || '');
  // 本地 oMLX、Pollinations(免密钥)、Chrome 内置 AI 均无需 Key；其余公开大模型需填 Key
  if (!isLocal && !isKeylessPublic && !isChrome) {
    const key = config[provider] && config[provider].apiKey;
    if (!key) return { success: false, error: `未配置 ${provider} 的 API Key`, code: 'NO_KEY' };
  }

  // 非追问模式走缓存
  const cacheKey = mode === 'followup' ? null : hashKey(provider + '|' + mode + '|' + text);
  if (cacheKey && _cache.has(cacheKey)) {
    const hit = _cache.get(cacheKey);
    return { success: true, summary: hit.summary, elapsed: 0, cached: true };
  }

  const { messages, maxTokens, temperature } = buildMessages(mode, text, {
    question: req.question,
    history: req.history,
    lang: config.outputLang || 'en'
  });

  try {
    let result;
    if (isChrome) {
      try {
        result = await callChromeAI(mode, { text, messages, question: req.question, history: req.history }, sender && sender.tab && sender.tab.id);
      } catch (e) {
        // 内置 AI 不可用 → 自动回退到其它已配置 provider（本地 oMLX > NVIDIA > Agnes）
        if (e.code === 'NO_CHROME_AI') {
          const fb = pickFallbackProvider(config);
          if (fb) {
            console.warn('[hover-summary] Chrome 内置 AI 不可用，回退到', fb.label, '-', e.message);
            result = await callChatAPI(fb.cfg, messages, { maxTokens, temperature, isLocal: fb.provider === 'local', maxOutput: config.maxOutput });
            result.fallbackNote = '（已自动回退到 ' + fb.label + '）';
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    } else {
      result = await callChatAPI(config[provider], messages, { maxTokens, temperature, isLocal, maxOutput: config.maxOutput });
    }
    if (cacheKey) {
      _cache.set(cacheKey, { summary: result.summary });
      if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    }
    return { success: true, summary: result.summary, elapsed: result.elapsed, cached: false, fallbackNote: result.fallbackNote };
  } catch (e) {
    return { success: false, error: e.message, code: e.code || 'UNKNOWN' };
  }
}

// 百度文心鉴权：API Key 形如 "client_id:client_secret"，先换 access_token
async function getBaiduToken(apiKey) {
  if (!apiKey || !apiKey.includes(':')) throw new Error('百度 Key 格式应为 client_id:client_secret');
  const [clientId, secret] = apiKey.split(':');
  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}`;
  const resp = await fetchWithTimeout(url, { method: 'POST' }, 15000);
  const data = await resp.json().catch(() => null);
  if (!data || !data.access_token) {
    throw new Error((data && (data.error_description || data.error)) || 'HTTP ' + resp.status);
  }
  return data.access_token;
}

// 统一的 chat 调用（兼容 OpenAI 兼容端点 与 百度文心非兼容端点）
async function callChatAPI(cfg, messages, { maxTokens = 256, temperature = 0.3, isLocal = false, maxOutput = 0 }) {
  const start = performance.now();
  const isBaidu = /aip\.baidubce\.com/.test(cfg.endpoint || '');
  const localEp = isLocal || /(127\.0\.0\.1|localhost)/.test(cfg.endpoint || '');

  let ep = cfg.endpoint;
  let headers = { 'Content-Type': 'application/json' };
  let bodyObj;

  if (isBaidu) {
    // 百度文心：先取 access_token，再用 ?access_token= 鉴权，响应为 { result }
    const token = await getBaiduToken(cfg.apiKey).catch((e) => {
      const err = new Error('百度鉴权失败：' + e.message);
      err.code = 'AUTH';
      throw err;
    });
    ep = cfg.endpoint + (cfg.endpoint.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token);
    bodyObj = { messages: messages.map((m) => ({ role: m.role, content: m.content })) };
  } else {
    // OpenAI 兼容：仅对“真正会思考”的模型放大 token 预算，避免正文被“思考”截断。
    // 注意：不再用 localEp 一刀切（本地也有非推理模型如 Qwen/Gemma），也不再用 4\.1 误判 Gemma-4。
    const isReasoningModel = /agnes|deepseek-r|reasoner|o1|o3|gpt-oss|nemotron|think|nanbeige/i.test(cfg.model || '') || /agnes-ai\.com/.test(cfg.endpoint || '');
    let effMax = isReasoningModel ? Math.min(Math.max(Math.round(maxTokens * 4), 700), 3000) : maxTokens;
    // 输出上限：防小模型陷入重复循环（0.5B 设小如 256 即可）
    const outCap = (maxOutput && maxOutput > 0) ? maxOutput : 800;
    effMax = Math.min(effMax, outCap);
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    // 部分模型（如 Gemma 2）不支持 system role，把 system 内容合并到首条 user 消息
    let msgs = messages;
    const noSystemModels = /gemma/i.test(cfg.model || '');
    if (noSystemModels) {
      msgs = messages.map((m) => {
        if (m.role === 'system') return { role: 'user', content: m.content };
        return m;
      });
      // 合并连续的 user 消息
      const merged = [];
      for (const m of msgs) {
        const last = merged[merged.length - 1];
        if (last && last.role === 'user' && m.role === 'user') {
          last.content += '\n\n' + m.content;
        } else {
          merged.push({ ...m });
        }
      }
      msgs = merged;
    }
    bodyObj = { model: cfg.model, messages: msgs, max_tokens: effMax, temperature, stream: false };
    // 防小模型重复循环：本地(llama.cpp/oMLX/LM Studio)用 repeat_penalty，云端 OpenAI 兼容用 frequency_penalty
    if (localEp) {
      bodyObj.repeat_penalty = 1.15;
      bodyObj.frequency_penalty = 0.5;
    } else {
      bodyObj.frequency_penalty = 0.6;
    }
    // Gemma-4 系列需要显式关闭思考，否则会先输出大段思考过程，挤占总结正文
    if (localEp && /gemma-?4/i.test(cfg.model || '')) bodyObj.enable_thinking = false;
  }

  const body = JSON.stringify(bodyObj);
  const sendOnce = (endpoint) => fetchWithTimeout(endpoint, { method: 'POST', headers, body }, 15000);

  let resp;
  try {
    resp = await sendOnce(ep);
  } catch (e) {
    const code = e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
    const err = new Error(localEp ? '无法连接本地模型服务（' + cfg.endpoint + '）：请确认 oMLX 已启动' : '网络请求失败：' + e.message);
    err.code = code;
    throw err;
  }

  // 本地模型若误配成 /v1/completions（要求 prompt 字段），自动改投 chat 端点兼容
  if (!isBaidu && !resp.ok && resp.status === 422 && /\bprompt\b/i.test(await resp.clone().text().catch(() => '')) && !/\/chat\/completions$/.test(cfg.endpoint)) {
    const chatEp = cfg.endpoint.replace(/\/v1\/completions$/, '') + '/v1/chat/completions';
    try {
      const r2 = await sendOnce(chatEp);
      if (r2.ok) resp = r2;
    } catch (e) {
      /* 忽略，沿用原 422 报错 */
    }
  }

  const elapsed = parseFloat(((performance.now() - start) / 1000).toFixed(2));
  if (!resp.ok) {
    let detail = (await resp.text().catch(() => '') || '').substring(0, 120);
    if (resp.status === 401) detail = 'API Key 无效或未填写（HTTP 401）';
    else if (resp.status === 422 && /\bprompt\b/i.test(detail)) detail = '端点似乎不是 chat/completions，请在设置中改为以 /v1/chat/completions 结尾的地址。';
    else if (localEp && resp.status === 500) detail = 'oMLX 本地推理返回 500：该模型可能已损坏或当前 oMLX/transformers 版本不兼容（常见于量化格式或 tokenizer 不被支持）。请换一个模型，或在 oMLX 中重新下载/转换该模型。';
    const err = new Error(`HTTP ${resp.status}：${detail}`);
    err.code = 'HTTP';
    throw err;
  }

  const data = await resp.json().catch(() => null);
  let summary;
  if (isBaidu) {
    summary = (data && (data.result || '')) || '';
  } else {
    const choice = (data && data.choices && data.choices[0]) || {};
    const msg = choice.message || {};
    // 只取正文 content；reasoning_content 是“思考过程”，绝不展示；兜底去掉 <think> 块
    summary = (msg.content || choice.text || '').trim();
    summary = summary.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    summary = dedupeRepetition(summary);
  }
  if (!summary) {
    const raw = data ? JSON.stringify(data).slice(0, 200) : '(无法解析 JSON)';
    const err = new Error(isBaidu ? '百度文心未返回内容：' + raw : '模型未返回正文（本地推理模型可能把 token 花在了思考上）。请重试，或在设置中调大本地 max_tokens。原始响应：' + raw);
    err.code = 'EMPTY';
    throw err;
  }
  return { summary, elapsed };
}

// ── 换皮检测：调用本地 story-duplicate-detector 服务 ──────
async function handleDetectDuplicate(req) {
  const config = await getConfig();
  if (!config.duplicateCheck) return { ok: false, error: '换皮检测已关闭' };

  const endpoint = (config.duplicateEndpoint || 'http://127.0.0.1:8765').replace(/\/$/, '');
  const text = (req.text || '').slice(0, 5000);
  const title = req.title || '';
  const author = req.author || '';
  const url = req.url || '';

  if (!text || text.trim().length < 10) {
    return { ok: false, error: 'Text too short' };
  }

  try {
    const resp = await fetchWithTimeout(
      endpoint + '/api/detect',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title, author, url, store: true })
      },
      8000
    );
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    return data;
  } catch (e) {
    const isLocal = /127\.0\.0\.1|localhost/.test(endpoint);
    const msg = e.name === 'AbortError'
      ? (isLocal ? '换皮检测服务超时（>8s），请确认 server.py 已启动' : '换皮检测服务超时')
      : (isLocal ? '无法连接换皮检测服务（' + endpoint + '），请确认已运行 python server.py' : '连接失败：' + e.message);
    return { ok: false, error: msg };
  }
}

// ── 测试连接：用一次极小请求验证 Key / 端点可用性 ──────────
async function testConnection(provider) {
  const config = await getConfig();
  const p = provider || config.model;
  const cfg = config[p];
  if (!cfg) return { ok: false, error: `未知模型: ${p}`, code: 'NO_PROVIDER' };
  const isLocal = p === 'local';
  if (isLocal && !cfg.model) return { ok: false, error: '未选择本地模型：请先在上方列表选择', code: 'NO_LOCAL_MODEL' };
  const isKeylessPublic = p === 'public' && /text\.pollinations\.ai/.test(cfg.endpoint || '');
  if (!isLocal && !isKeylessPublic && !cfg.apiKey) return { ok: false, error: '未配置 API Key', code: 'NO_KEY' };

  const isBaidu = /aip\.baidubce\.com/.test(cfg.endpoint || '');
  let ep = cfg.endpoint;
  let headers = { 'Content-Type': 'application/json' };
  let bodyObj;
  if (isBaidu) {
    const token = await getBaiduToken(cfg.apiKey).catch(() => null);
    if (!token) return { ok: false, error: '百度鉴权失败：请检查 client_id:client_secret', code: 'AUTH' };
    ep = cfg.endpoint + (cfg.endpoint.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token);
    bodyObj = { messages: [{ role: 'user', content: 'ping' }] };
  } else {
    // 推理模型（如 Agnes / DeepSeek-R1 / Nanbeige）需要更多 token，否则全被 reasoning 吃掉
    const isReasoningModel = /agnes|deepseek-r1|o1|o3|think|gpt-oss|nemotron|nanbeige/i.test(cfg.model || '');
    const maxTok = (isLocal || /(127\.0\.0\.1|localhost)/.test(cfg.endpoint || '')) ? 256 : (isReasoningModel ? 300 : 8);
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    bodyObj = { model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: maxTok, temperature: 0.1, stream: false };
    // Gemma-4 本地模型需要显式关闭思考，避免测试时输出大段思考过程
    if (isLocal && /gemma-?4/i.test(cfg.model || '')) bodyObj.enable_thinking = false;
  }

  const start = performance.now();
  try {
    const resp = await fetchWithTimeout(ep, { method: 'POST', headers, body: JSON.stringify(bodyObj) }, 15000);
    const elapsed = parseFloat(((performance.now() - start) / 1000).toFixed(2));
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}：${(await resp.text().catch(() => '') || '').substring(0, 120)}`, code: 'HTTP', latency: elapsed };
    const data = await resp.json().catch(() => null);
    const ok = isBaidu
      ? !!(data && data.result && data.result.trim())
      : !!(data && data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].message?.reasoning_content || data.choices[0].text || '').trim());
    return ok
      ? { ok: true, model: cfg.model, latency: elapsed }
      : { ok: false, error: '模型返回为空' + (data ? '：' + JSON.stringify(data).slice(0, 160) : ''), code: 'EMPTY', latency: elapsed };
  } catch (e) {
    const code = e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
    return { ok: false, error: code === 'TIMEOUT' ? '连接超时' : '连接失败：' + e.message, code };
  }
}

// ── 公开大模型「测速选最快」──────────────────────────────
// 接收 { preset, endpoint, apiKey }：测试该预设下的各候选模型（或自定义端点+模型），
// 返回按延迟升序的结果与最快可用模型。百度文心走 OAuth，其余走 OpenAI 兼容。
async function speedTestPublic(opts = {}) {
  const preset = (opts.preset && PUBLIC_PRESETS[opts.preset]) ? PUBLIC_PRESETS[opts.preset] : null;
  const ep = (opts.endpoint || (preset && preset.endpoint) || 'https://text.pollinations.ai/openai').trim();
  const isBaidu = /aip\.baidubce\.com/.test(ep);
  const apiKey = opts.apiKey || (preset && '') || '';
  const list = (opts.candidates && opts.candidates.length ? opts.candidates : (preset ? preset.models : ['openai', 'mistral', 'llama']))
    .map((m) => String(m).trim()).filter(Boolean);

  if (preset && preset.needKey && !apiKey) return { ok: false, error: '该平台需要 API Key，请先在上方填入', code: 'NO_KEY' };
  if (isBaidu && (!apiKey || !apiKey.includes(':'))) return { ok: false, error: '百度 Key 格式应为 client_id:client_secret', code: 'NO_KEY' };

  let baiduToken = null;
  if (isBaidu) {
    baiduToken = await getBaiduToken(apiKey).catch(() => null);
    if (!baiduToken) return { ok: false, error: '百度鉴权失败，请检查 client_id:client_secret', code: 'AUTH' };
  }

  const results = [];
  for (const model of list) {
    const start = performance.now();
    try {
      const targetEp = isBaidu ? ep + (ep.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(baiduToken) : ep;
      const bodyObj = isBaidu
        ? { messages: [{ role: 'user', content: 'ping' }] }
        : { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8, temperature: 0.1, stream: false };
      const headers = isBaidu
        ? { 'Content-Type': 'application/json' }
        : Object.assign({ 'Content-Type': 'application/json' }, apiKey ? { Authorization: `Bearer ${apiKey}` } : {});
      const resp = await fetchWithTimeout(targetEp, { method: 'POST', headers, body: JSON.stringify(bodyObj) }, 20000);
      const elapsed = parseFloat(((performance.now() - start) / 1000).toFixed(2));
      let ok = false;
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        const c = isBaidu ? (data && data.result) : (data && data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].text || ''));
        ok = !!(c && c.trim().length > 0);
      }
      results.push({ model, ok, latency: elapsed, error: resp.ok ? null : `HTTP ${resp.status}` });
    } catch (e) {
      const elapsed = parseFloat(((performance.now() - start) / 1000).toFixed(2));
      results.push({ model, ok: false, latency: elapsed, error: e.name === 'AbortError' ? 'TIMEOUT' : e.message });
    }
  }

  const okList = results.filter((r) => r.ok).sort((a, b) => a.latency - b.latency);
  return { ok: true, fastest: okList.length ? okList[0].model : null, results, preset: opts.preset || null };
}
