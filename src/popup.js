// popup.js — 配置页面逻辑

const DEFAULT_CONFIG = {
  enabled: true,
  model: 'chrome', // 默认用 Chrome 内置 Gemini Nano（设备端·免Key·离线）；不可用时自动回退
  theme: 'auto',
  maxLength: 2000,
  hoverDelay: 800,
  triggerMode: 'select',
  outputLang: 'en', // 摘要输出语言（默认英语）
  bubbleHideDelay: 800, // 鼠标离开气泡后的保留(淡出)时间 ms
  duplicateCheck: true,
  duplicateEndpoint: 'http://127.0.0.1:8765',
  agnes: { endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions', apiKey: '', model: 'agnes-2.0-flash' },
  nvidia: { endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', apiKey: '', model: 'openai/gpt-oss-120b' },
  local: { endpoint: 'http://127.0.0.1:8000/v1/chat/completions', apiKey: '', model: '' },
  chrome: {}, // Chrome 内置 AI（Gemini Nano）：无需 endpoint / Key / 模型选择
  public: { preset: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions', apiKey: '', model: 'deepseek-chat' }
};

// 公开大模型预设（与 background.js 的 PUBLIC_PRESETS 对应，仅用于弹窗自动填充）
const PUBLIC_PRESETS_UI = {
  deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', keyHint: 'DeepSeek API Key（官网注册即送免费额度）' },
  qwen: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', keyHint: '阿里云 DashScope API Key（开通模型即送免费额度）' },
  hunyuan: { endpoint: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions', model: 'hunyuan-lite', keyHint: '腾讯云混元 API Key（控制台开通送免费额度）' },
  baidu: { endpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant', model: 'eb-instant', keyHint: '百度智能云：填 client_id:client_secret（两个密钥用冒号连接）' },
  pollinations: { endpoint: 'https://text.pollinations.ai/openai', model: 'openai', keyHint: '免密钥，留空即可（偶发服务端抖动，建议优先用上方国内大模型）' }
};

const $ = (id) => document.getElementById(id);
const modelSelect = $('model');
const delaySlider = $('hover-delay');
const delayValue = $('delay-value');
const maxLenSlider = $('max-length');
const maxLenValue = $('maxlen-value');
const outputLang = $('output-lang');
const hideSlider = $('bubble-hide-delay');
const hideValue = $('hide-value');
const triggerMode = $('trigger-mode');
const theme = $('theme');
const enabled = $('enabled');
const saveBtn = $('save');
const statusEl = $('status');

const configPanels = { agnes: $('cfg-agnes'), nvidia: $('cfg-nvidia'), local: $('cfg-local'), chrome: $('cfg-chrome'), public: $('cfg-public') };

function switchModelPanel(model) {
  Object.values(configPanels).forEach((p) => p.classList.remove('active'));
  if (configPanels[model]) configPanels[model].classList.add('active');
  // 懒加载：切到“本地模型”面板时才探测服务并拉取模型列表（其余时候不打扰本地服务）
  if (model === 'local') detectAndRefreshLocal();
  // 切到“Chrome 内置 AI”面板时检查可用性（并可在面板内手动触发下载）
  if (model === 'chrome') checkChromeAIStatus();
}

// 记录已保存的本地模型名，供探测完成后回填选中
let savedLocalModel = '';
let localDetecting = false;

// 自动探测本地服务地址（oMLX/LM Studio/Ollama/llama.cpp）→ 填充地址 → 列出模型
function detectAndRefreshLocal() {
  if (localDetecting) return;
  localDetecting = true;
  const sel = $('local-model');
  const box = $('detect-local');
  box.className = 'test-status';
  box.style.display = 'block';
  box.style.background = '#eef'; box.style.color = '#555';
  box.textContent = '⏳ 正在自动探测本地模型服务…';
  // 占位：探测期间下拉不可误选
  sel.innerHTML = '<option value="">— 正在探测… —</option>';

  const savedEp = ($('local-endpoint').value || '').trim();
  chrome.runtime.sendMessage({ action: 'detectLocalEndpoint', endpoint: savedEp }, (resp) => {
    localDetecting = false;
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      const msg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || (resp && resp.error) || '探测失败';
      box.className = 'test-status err';
      box.textContent = '❌ ' + msg;
      sel.innerHTML = '';
      // 保留已存模型（服务未启动时不丢配置）
      const o = document.createElement('option');
      if (savedLocalModel) {
        o.value = savedLocalModel; o.textContent = savedLocalModel + '（服务未连接）';
      } else {
        o.value = ''; o.textContent = '— 未发现本地服务 —';
      }
      sel.appendChild(o);
      return;
    }
    // 自动匹配到地址：直接填充，无需手填
    $('local-endpoint').value = resp.endpoint;
    const models = resp.models || [];
    sel.innerHTML = '<option value="">— 请选择模型 —</option>';
    models.forEach((m) => {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      sel.appendChild(o);
    });
    // 已保存的模型仍在列表中则选中；不在则补选项保留
    if (savedLocalModel && !models.includes(savedLocalModel)) {
      const o = document.createElement('option');
      o.value = savedLocalModel; o.textContent = savedLocalModel + '（已保存/未列出）';
      sel.appendChild(o);
    }
    sel.value = savedLocalModel || '';
    box.className = 'test-status ok';
    box.textContent = `✅ 已连接 ${resp.base.replace('http://', '')}，发现 ${models.length} 个模型` +
      (savedLocalModel ? '' : '，请在下方选择并确认加载');
  });
}

// 检查 Chrome 内置 AI 可用性（切到面板时自动调用）；不阻塞，仅展示状态
function checkChromeAIStatus() {
  const box = $('check-chrome');
  box.className = 'test-status';
  box.style.display = 'block';
  box.style.background = '#eef'; box.style.color = '#555';
  box.textContent = '⏳ 正在检查 Chrome 内置 AI…';
  chrome.runtime.sendMessage({ action: 'checkChromeAI' }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      box.className = 'test-status err';
      box.textContent = '❌ ' + ((resp && resp.reason) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '检查失败');
      return;
    }
    const s = resp.summarizer, l = resp.languageModel;
    const ready = (s === 'ready' || s === 'available') && (l === 'ready' || l === 'available');
    box.className = 'test-status ' + (ready ? 'ok' : '');
    box.style.background = ready ? '#e6f4ea' : '#fef7e0';
    box.style.color = ready ? '#1e7e34' : '#8a6d00';
    const fmt = (v) => (v === 'ready' || v === 'available') ? '✅ 就绪' : (v === 'downloadable' ? '⬇️ 可下载' : (v === 'downloading' ? '⬇️ 下载中' : (v === 'n/a' ? '—' : v)));
    box.textContent = `Summarizer: ${fmt(s)} ｜ LanguageModel: ${fmt(l)}` + (ready ? '（可直接使用）' : '（点击上方按钮触发下载）');
  });
}

// 「检查/下载 Chrome 内置模型」按钮：触发后台探测并尝试预下载（首次约 1.7GB，需耐心）
$('chrome-check').addEventListener('click', () => {
  const box = $('check-chrome');
  box.className = 'test-status';
  box.style.display = 'block';
  box.style.background = '#eef'; box.style.color = '#555';
  box.textContent = '⏳ 正在触发模型下载（首次约 1.7GB，请耐心等待）…';
  chrome.runtime.sendMessage({ action: 'checkChromeAI' }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      box.className = 'test-status err';
      box.textContent = '❌ ' + ((resp && resp.reason) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '操作失败');
      return;
    }
    const s = resp.summarizer, l = resp.languageModel;
    const ready = (s === 'ready' || s === 'available') && (l === 'ready' || l === 'available');
    box.className = 'test-status ' + (ready ? 'ok' : '');
    box.style.background = ready ? '#e6f4ea' : '#fef7e0';
    box.style.color = ready ? '#1e7e34' : '#8a6d00';
    const fmt = (v) => (v === 'ready' || v === 'available') ? '✅ 就绪' : (v === 'downloadable' ? '⬇️ 已可下载并触发下载' : (v === 'downloading' ? '⬇️ 下载中' : (v === 'n/a' ? '—' : v)));
    box.textContent = `Summarizer: ${fmt(s)} ｜ LanguageModel: ${fmt(l)}`;
  });
});

modelSelect.addEventListener('change', () => switchModelPanel(modelSelect.value));
delaySlider.addEventListener('input', () => (delayValue.textContent = delaySlider.value));
maxLenSlider.addEventListener('input', () => (maxLenValue.textContent = maxLenSlider.value));
hideSlider.addEventListener('input', () => (hideValue.textContent = hideSlider.value));
outputLang.addEventListener('change', () => {
  // 切换输出语言即时落盘，下次总结即用新语言；不强制刷新已弹出气泡
  chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => flashStatus('✅ 输出语言已切换'));
});

// 加载已保存配置（深合并）
chrome.storage.sync.get('hoverSummaryConfig', (data) => {
  const cfg = Object.assign({}, DEFAULT_CONFIG, data.hoverSummaryConfig || {});
  cfg.agnes = Object.assign({}, DEFAULT_CONFIG.agnes, cfg.agnes || {});
  cfg.nvidia = Object.assign({}, DEFAULT_CONFIG.nvidia, cfg.nvidia || {});
  cfg.local = Object.assign({}, DEFAULT_CONFIG.local, cfg.local || {});
  cfg.public = Object.assign({}, DEFAULT_CONFIG.public, cfg.public || {});

  enabled.checked = cfg.enabled !== false;
  modelSelect.value = cfg.model || 'chrome';
  theme.value = cfg.theme || 'auto';
  triggerMode.value = cfg.triggerMode || 'select';
  delaySlider.value = cfg.hoverDelay || 800;
  delayValue.textContent = delaySlider.value;
  maxLenSlider.value = cfg.maxLength || 2000;
  maxLenValue.textContent = maxLenSlider.value;
  outputLang.value = cfg.outputLang || 'en';
  hideSlider.value = cfg.bubbleHideDelay || 800;
  hideValue.textContent = hideSlider.value;

  $('agnes-key').value = cfg.agnes.apiKey || '';
  $('agnes-model').value = cfg.agnes.model || 'agnes-2.0-flash';
  $('nvidia-key').value = cfg.nvidia.apiKey || '';
  $('nvidia-model').value = cfg.nvidia.model || 'openai/gpt-oss-120b';
  $('local-endpoint').value = cfg.local.endpoint || '';
  savedLocalModel = cfg.local.model || '';
  // 不在此处拉取模型列表：仅当用户选择/已选择“本地模型”时才探测（见 switchModelPanel）
  $('public-endpoint').value = cfg.public.endpoint || DEFAULT_CONFIG.public.endpoint;
  $('public-model').value = cfg.public.model || DEFAULT_CONFIG.public.model;
  $('public-key').value = cfg.public.apiKey || '';
  const preset = cfg.public.preset || 'deepseek';
  $('public-preset').value = preset;
  $('public-key-hint').textContent = (PUBLIC_PRESETS_UI[preset] && PUBLIC_PRESETS_UI[preset].keyHint) || '';

  $('dup-check').checked = cfg.duplicateCheck !== false;
  $('dup-endpoint').value = cfg.duplicateEndpoint || 'http://127.0.0.1:8765';

  switchModelPanel(cfg.model || 'chrome');
});

// 公开大模型预设切换：自动填充端点 / 模型名 / Key 提示
$('public-preset').addEventListener('change', () => {
  const p = $('public-preset').value;
  const ui = PUBLIC_PRESETS_UI[p];
  if (!ui) return;
  $('public-endpoint').value = ui.endpoint;
  $('public-model').value = ui.model;
  $('public-key-hint').textContent = ui.keyHint || '';
});

// 本地模型：重新探测 / 刷新列表（端点手改后也重新探测）
$('local-refresh').addEventListener('click', () => detectAndRefreshLocal());
$('local-endpoint').addEventListener('change', () => detectAndRefreshLocal());
// 用户在下拉框选中模型后，记住这次选择（探测刷新时保持选中）
$('local-model').addEventListener('change', () => { savedLocalModel = $('local-model').value; });

// 本地 oMLX：确认并加载选中的单个模型（写入设置 + 预热载入 oMLX 内存，避免无关模型占用内存）
$('local-load').addEventListener('click', () => {
  const box = $('load-local');
  const model = $('local-model').value.trim();
  const endpoint = $('local-endpoint').value.trim() || DEFAULT_CONFIG.local.endpoint;
  if (!model) {
    box.className = 'test-status err';
    box.textContent = '❌ 请先在下拉框选择一个模型';
    return;
  }
  // 1) 先把选中的模型写入配置（与“保存设置”等效）
  chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => flashStatus('✅ 已保存：' + model));
  // 2) 触发 oMLX 只加载该模型
  box.className = 'test-status';
  box.textContent = '⏳ 正在加载「' + model + '」…';
  box.classList.add('ok');
  box.style.background = '#eef'; box.style.color = '#555';
  chrome.runtime.sendMessage({ action: 'loadLocalModel', endpoint, model }, (resp) => {
    if (chrome.runtime.lastError) {
      box.className = 'test-status err';
      box.textContent = '❌ ' + chrome.runtime.lastError.message;
      return;
    }
    if (resp && resp.ok) {
      box.className = 'test-status ok';
      box.textContent = `✅ 已加载并确认：「${model}」（加载耗时 ${resp.latency}s）。之后总结只用此模型。`;
    } else {
      box.className = 'test-status err';
      box.textContent = '❌ 加载失败：' + ((resp && resp.error) || '未知错误') + '（设置已保存，可重试）';
    }
  });
});

// 从当前 UI 收集完整配置（保存 / 开关即时生效共用）
function collectConfig() {
  return {
    enabled: enabled.checked,
    model: modelSelect.value,
    theme: theme.value,
    maxLength: parseInt(maxLenSlider.value, 10),
    hoverDelay: parseInt(delaySlider.value, 10),
    outputLang: outputLang.value,
    bubbleHideDelay: parseInt(hideSlider.value, 10),
    triggerMode: triggerMode.value,
    duplicateCheck: $('dup-check').checked,
    duplicateEndpoint: $('dup-endpoint').value.trim() || 'http://127.0.0.1:8765',
    agnes: {
      endpoint: DEFAULT_CONFIG.agnes.endpoint,
      apiKey: $('agnes-key').value.trim(),
      model: $('agnes-model').value.trim() || DEFAULT_CONFIG.agnes.model
    },
    nvidia: {
      endpoint: DEFAULT_CONFIG.nvidia.endpoint,
      apiKey: $('nvidia-key').value.trim(),
      model: $('nvidia-model').value
    },
    local: {
      endpoint: $('local-endpoint').value.trim() || DEFAULT_CONFIG.local.endpoint,
      apiKey: '',
      model: $('local-model').value.trim() // 不预设：为空则总结时提示先选择模型
    },
    chrome: {}, // 无需任何字段
    public: {
      preset: $('public-preset').value,
      endpoint: $('public-endpoint').value.trim() || DEFAULT_CONFIG.public.endpoint,
      apiKey: $('public-key').value.trim(),
      model: $('public-model').value.trim() || DEFAULT_CONFIG.public.model
    }
  };
}

function flashStatus(msg) {
  statusEl.textContent = msg || '✅ 已保存';
  statusEl.classList.add('show');
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(() => statusEl.classList.remove('show'), 2000);
}

// 保存
saveBtn.addEventListener('click', () => {
  const cfg = collectConfig();
  chrome.storage.sync.set({ hoverSummaryConfig: cfg }, () => {
    if (cfg.model === 'local' && !cfg.local.model) {
      flashStatus('⚠️ 已保存，但尚未选择本地模型');
    } else {
      flashStatus('✅ 已保存');
    }
  });
});

// 开关即时生效：点击即落盘（content.js 通过 storage.onChanged 实时更新启用/换皮状态）
enabled.addEventListener('change', () => {
  chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => flashStatus('✅ 已生效'));
});
$('dup-check').addEventListener('change', () => {
  chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => flashStatus('✅ 已生效'));
});

// 测试连接
document.querySelectorAll('.test-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const provider = btn.dataset.provider;
    const box = $('test-' + provider);
    box.className = 'test-status';
    box.textContent = '⏳ 测试中…';
    box.classList.add('ok'); // 仅用于显示（颜色稍后覆盖）
    box.style.background = '#eef'; box.style.color = '#555';
    chrome.runtime.sendMessage({ action: 'testConnection', provider }, (resp) => {
      if (chrome.runtime.lastError) {
        box.className = 'test-status err';
        box.textContent = '❌ ' + chrome.runtime.lastError.message;
        return;
      }
      if (resp && resp.ok) {
        box.className = 'test-status ok';
        box.textContent = `✅ 连接成功（${resp.model || ''}，${resp.latency}s）`;
      } else {
        box.className = 'test-status err';
        box.textContent = '❌ ' + ((resp && resp.error) || '未知错误');
      }
    });
  });
});

// ⚡ 公开大模型「测速并选用最快」：实测候选模型延迟，自动选最快且可用的写入配置
$('speed-test').addEventListener('click', () => {
  const box = $('speed-public');
  box.className = 'test-status';
  box.textContent = '⏳ 正在测速（对每个候选模型发一次请求）…';
  box.classList.add('ok');
  box.style.background = '#eef'; box.style.color = '#555';
  const endpoint = $('public-endpoint').value.trim() || DEFAULT_CONFIG.public.endpoint;
  const apiKey = $('public-key').value.trim();
  const preset = $('public-preset').value;
  chrome.runtime.sendMessage({ action: 'speedTestPublic', opts: { preset, endpoint, apiKey } }, (resp) => {
    if (chrome.runtime.lastError) {
      box.className = 'test-status err';
      box.textContent = '❌ ' + chrome.runtime.lastError.message;
      return;
    }
    if (!resp || !resp.ok) {
      box.className = 'test-status err';
      box.textContent = '❌ ' + ((resp && resp.error) || '测速失败');
      return;
    }
    const rows = (resp.results || []).map((r) => `${r.model}: ${r.ok ? r.latency + 's' : '✗'}`);
    if (resp.fastest) {
      const fast = resp.results.find((r) => r.model === resp.fastest);
      $('public-model').value = resp.fastest;
      if (modelSelect.value !== 'public') {
        modelSelect.value = 'public';
        switchModelPanel('public');
      }
      // 立即落盘，下次总结直接用最快模型
      chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => {
        box.className = 'test-status ok';
        box.textContent = `⚡ 最快可用：${resp.fastest}（${fast.latency}s）。已写入并选中「公开大模型」。  明细：${rows.join('  ·  ')}`;
        flashStatus('⚡ 已选用 ' + resp.fastest);
      });
    } else {
      box.className = 'test-status err';
      box.textContent = '⚠️ 所有候选模型均不可用，请检查端点。  明细：' + rows.join('  ·  ');
    }
  });
});
