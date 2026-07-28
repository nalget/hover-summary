// content.js — 注入页面：触发检测 + 浮窗 UI（划词 / 悬停 / Shift+悬停 三种模式）

const HS = (typeof self !== 'undefined' && self.HS_MODES) || (typeof window !== 'undefined' && window.HS_MODES);
const { SUMMARY_MODES, MODE_ORDER } = HS || { SUMMARY_MODES: {}, MODE_ORDER: [] };

// 气泡界面文案本地化（跟随 outputLang）；缺省回退英文
const UI_I18N = {
  'zh-CN': { title: 'AI 摘要', modes: { summary: '摘要', points: '要点', explain: '解释', translate: '翻译', followup: '追问' }, copy: '📋 复制', copied: '✓ 已复制', source: '来源', followupPlaceholder: '基于此内容提问…', loading: '加载中…', error: '请求失败，请稍后重试', notAvailable: '该模型不可用' },
  'en': { title: 'AI Summary', modes: { summary: 'Summary', points: 'Key Points', explain: 'Explain', translate: 'Translate', followup: 'Ask' }, copy: '📋 Copy', copied: '✓ Copied', source: 'Source', followupPlaceholder: 'Ask a follow-up about this content…', loading: 'Loading…', error: 'Request failed, please retry', notAvailable: 'Model unavailable' },
  'ja': { title: 'AI 要約', modes: { summary: '要約', points: '要点', explain: '解説', translate: '翻訳', followup: '質問' }, copy: '📋 コピー', copied: '✓ コピー済', source: '出典', followupPlaceholder: 'この内容について質問…', loading: '読み込み中…', error: 'リクエスト失敗、再試行してください', notAvailable: 'モデル利用不可' },
  'ko': { title: 'AI 요약', modes: { summary: '요약', points: '핵심', explain: '설명', translate: '번역', followup: '질문' }, copy: '📋 복사', copied: '✓ 복사됨', source: '출처', followupPlaceholder: '이 내용에 대해 질문하기…', loading: '불러오는 중…', error: '요청 실패, 다시 시도하세요', notAvailable: '모델 사용 불가' },
  'fr': { title: 'Résumé IA', modes: { summary: 'Résumé', points: 'Points', explain: 'Expliquer', translate: 'Traduire', followup: 'Question' }, copy: '📋 Copier', copied: '✓ Copié', source: 'Source', followupPlaceholder: 'Posez une question sur ce contenu…', loading: 'Chargement…', error: 'Échec de la requête, réessayez', notAvailable: 'Modèle indisponible' },
  'de': { title: 'KI-Zusammenfassung', modes: { summary: 'Zusammenfassung', points: 'Kernpunkte', explain: 'Erklären', translate: 'Übersetzen', followup: 'Fragen' }, copy: '📋 Kopieren', copied: '✓ Kopiert', source: 'Quelle', followupPlaceholder: 'Stellen Sie eine Folgefrage zu diesem Inhalt…', loading: 'Wird geladen…', error: 'Anfrage fehlgeschlagen, bitte erneut versuchen', notAvailable: 'Modell nicht verfügbar' },
  'es': { title: 'Resumen IA', modes: { summary: 'Resumen', points: 'Puntos', explain: 'Explicar', translate: 'Traducir', followup: 'Pregunta' }, copy: '📋 Copiar', copied: '✓ Copiado', source: 'Fuente', followupPlaceholder: 'Haz una pregunta de seguimiento sobre este contenido…', loading: 'Cargando…', error: 'Fallo de la solicitud, inténtalo de nuevo', notAvailable: 'Modelo no disponible' },
  'ru': { title: 'AI Резюме', modes: { summary: 'Кратко', points: 'Пункты', explain: 'Пояснение', translate: 'Перевод', followup: 'Вопрос' }, copy: '📋 Копировать', copied: '✓ Скопировано', source: 'Источник', followupPlaceholder: 'Задайте уточняющий вопрос по этому содержимому…', loading: 'Загрузка…', error: 'Запрос не выполнен, повторите попытку', notAvailable: 'Модель недоступна' }
};
function uiText() { return UI_I18N[config.outputLang] || UI_I18N.en; }
const SEND_LABELS = { 'zh-CN': '发送', 'en': 'Send', 'ja': '送信', 'ko': '전송', 'fr': 'Envoyer', 'de': 'Senden', 'es': 'Enviar', 'ru': 'Отправить' };
function sendLabel() { return SEND_LABELS[config.outputLang] || 'Send'; }

let config = { enabled: true, theme: 'auto', hoverDelay: 800, triggerMode: 'select', maxLength: 2000, outputLang: 'en', bubbleHideDelay: 800 };
let hoverTimer = null;
let prefetchTimer = null;
let pill = null; // 划词小药丸
let tooltip = null; // 主浮窗

// 当前气泡的状态：原文、各模式结果、追问历史、当前模式
let state = null;
// 当前触发气泡的目标元素（链接、段落等），用于离开时隐藏 tooltip
let activeTarget = null;
// 请求序列号：每次 openBubble 递增，旧请求回调通过此 ID 判断是否已被作废
let bubbleSeq = 0;

// ── 预取缓存 ──────────────────────────────────────────
// 悬停 150ms 即发请求，800ms 才弹气泡；气泡弹出时若结果已回来则直接渲染
// prefetch = { text, mode, seq, result, error, done }
let prefetch = null;
const PREFETCH_DELAY = 150; // 悬停 150ms 即预取
const PREFETCH_MODE = 'summary'; // 预取的模式
let hoverActive = false;   // 当前是否仍在悬停同一目标（用于“模型返回才弹”，不弹加载占位）
let pendingAnchor = null;  // 待弹气泡的锚点（鼠标位置）
let pendingText = '';      // 当前悬停目标文本（判重/调试用）
let hideTimer = null;      // 气泡淡出/延迟隐藏计时器

// ── 配置加载 ──────────────────────────────────────────────
function loadConfig() {
  try {
    chrome.runtime.sendMessage({ action: 'getConfig' }, (cfg) => {
      if (chrome.runtime.lastError || !cfg) return;
      applyConfig(cfg);
    });
  } catch (e) {}
}
function applyConfig(cfg) {
  config = Object.assign(config, cfg);
  // 统一语言：优先用弹窗写入的 lang，解析出有效 outputLang（供界面文案与摘要指令使用）。
  // summary-modes.js 作为 content script 先加载，已挂到 window.HS_MODES，这里可直接用其 resolveLang。
  const resolve = (window.HS_MODES && window.HS_MODES.resolveLang) || null;
  if (config.lang) {
    config.outputLang = resolve ? resolve(config.lang) : (config.outputLang || 'en');
  } else if (!config.outputLang) {
    config.outputLang = 'en';
  }
  if (pill) pill.style.display = config.enabled ? '' : 'none';
}

try {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.hoverSummaryConfig && changes.hoverSummaryConfig.newValue) {
      applyConfig(changes.hoverSummaryConfig.newValue);
    }
  });
} catch (e) {}

// 接收 background 的启用状态切换（快捷键）
try {
  chrome.runtime.onMessage.addListener((request) => {
    if (request && request.action === 'setEnabled') {
      config.enabled = !!request.enabled;
      if (!config.enabled) {
        hidePill();
        removeTooltip();
      }
    }
  });
} catch (e) {}

function resolveTheme() {
  if (config.theme === 'light') return 'light';
  if (config.theme === 'dark') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

loadConfig();

// ── 触发：划词（select 模式） ─────────────────────────────
if (config && true) {
  document.addEventListener('mouseup', onSelectionMaybe, true);
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hidePill();
  });
  window.addEventListener('scroll', hidePill, true);
}

function onSelectionMaybe(e) {
  if (config.triggerMode !== 'select' || !config.enabled) return;
  // 在我们的 UI 上选区不触发
  if (e.target && e.target.closest && e.target.closest('#hover-summary-tooltip, #hs-pill')) return;
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hidePill();
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 10 || text.length > 5000) {
      hidePill();
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    showPill(text, rect);
  }, 10);
}

function showPill(text, rect) {
  hidePill();
  pill = document.createElement('div');
  pill.id = 'hs-pill';
  pill.textContent = '💡 总结';
  pill.className = 'hs-pill hs-theme-' + resolveTheme();
  const x = Math.min(rect.left + rect.width / 2, window.innerWidth - 60);
  const y = Math.max(rect.top, 28);
  pill.style.left = x + 'px';
  pill.style.top = y + 'px';
  pill.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    const t = pill && pill._text;
    const r = pill && pill._rect;
    hidePill();
    if (t) openBubble(t, r ? { x: r.left + r.width / 2, y: r.bottom } : null, 'summary');
  });
  pill._text = text;
  pill._rect = rect;
  document.body.appendChild(pill);
}

function hidePill() {
  if (pill) {
    pill.remove();
    pill = null;
  }
}

// ── 触发：悬停（hover / shift+hover 模式） ────────────────
// 通过文本光标精确定位：只有真正落在“文字块”上才呼出，
// 落在留白 / 内边距 / 块间缝隙（被吸附到最近文字但不在其包围盒内）时返回 null，避免“空白处也呼出”。
function elementAtTextPoint(x, y) {
  if (!document.caretRangeFromPoint) return null;
  const range = document.caretRangeFromPoint(x, y);
  if (!range) return null;
  const node = range.startContainer;
  let element = null;
  // 如果是文本节点，使用其父元素；如果是非文本节点（如 <img>），尝试找到最近的 <a> 元素
  if (node.nodeType === 3 /* Node.TEXT_NODE */) {
    element = node.parentElement;
  } else if (node.closest) {
    const link = node.closest('a');
    if (link) element = link;
  }
  if (!element) return null;
  // 对文本节点进行更严格的包围盒检查，防止留白处误触发
  if (node.nodeType === 3) {
    let box = null;
    try {
      const r = document.createRange();
      r.selectNodeContents(node);
      box = r.getBoundingClientRect();
    } catch (err) {
      box = range.getBoundingClientRect ? range.getBoundingClientRect() : null;
    }
    if (box) {
      const T = 4; // 容差，兼容字形边缘
      const inside = x >= box.left - T && x <= box.right + T && y >= box.top - T && y <= box.bottom + T;
      if (!inside) return null;
    }
  }
  return element;
}

let lastHoverText = '';
// 存储当前 activeTarget 上的 mouseleave 监听器，用于清理
let leaveHandler = null;

document.addEventListener('mousemove', (e) => {
  if (config.triggerMode === 'select' || !config.enabled) return;
  if (config.triggerMode === 'shift+hover' && !e.shiftKey) return;
  // 忽略来自自身 UI 的事件
  if (e.target && e.target.closest && e.target.closest('#hover-summary-tooltip, #hs-pill')) return;

  const el = elementAtTextPoint(e.clientX, e.clientY);
  const target = el && getMeaningfulTarget(el);
  if (!target) return;
  const text = target.textContent ? target.textContent.trim() : '';
  if (!text) return;
  // 只在链接上悬停才触发；滑过普通文本/段落不弹
  const isLink = target.tagName && target.tagName.toLowerCase() === 'a';
  if (!isLink) return;

  // 文本没变，不重复触发
  if (text === lastHoverText) return;
  lastHoverText = text;

  // 清除旧的 timer 和 leave 监听
  if (leaveHandler && activeTarget) {
    activeTarget.removeEventListener('mouseleave', leaveHandler);
    leaveHandler = null;
  }
  clearTimeout(hoverTimer);
  clearTimeout(prefetchTimer);

  activeTarget = target;
  hoverActive = true;
  pendingText = text;
  pendingAnchor = { x: e.clientX, y: e.clientY };

  // 鼠标离开目标元素 → 取消 pending，且不再弹气泡
  leaveHandler = () => {
    clearTimeout(hoverTimer);
    clearTimeout(prefetchTimer);
    hoverActive = false;
    lastHoverText = '';
    if (activeTarget) activeTarget.removeEventListener('mouseleave', leaveHandler);
    leaveHandler = null;
  };
  activeTarget.addEventListener('mouseleave', leaveHandler);

  // 预取：150ms 即发请求（后台静默进行，气泡等模型返回再弹，不显示“加载中”）
  prefetchTimer = setTimeout(() => startPrefetch(text, isLink ? target.href : null), PREFETCH_DELAY);

  // hoverDelay 仅作“最低驻留”兜底：到点若模型已返回则弹；若还没返回不弹占位，
  // 继续等——模型一返回就由 finishPrefetch 回调弹气泡（绝不显示“加载中”占位）。
  hoverTimer = setTimeout(() => {
    if (prefetch && prefetch.done && !tooltip) {
      openBubble(text, { x: e.clientX, y: e.clientY }, 'summary');
    }
  }, config.hoverDelay || 800);
});

// 鼠标离开整个页面区域时清理
document.addEventListener('mouseleave', () => {
  clearTimeout(hoverTimer);
  clearTimeout(prefetchTimer);
  lastHoverText = '';
  fadeRemoveTooltip();
});

// 全局自动隐藏（所有模式通用）：指针离开「气泡 ∪ 触发目标」后，按可配置延时淡出。
// 只在“刚离开”的瞬间调度一次，之后鼠标继续移动也不再复位计时器 → 可靠地“不悬停约 N 秒后淡出”，不闪烁。
let overBubbleOrTarget = false;
document.addEventListener('mousemove', (e) => {
  if (!tooltip || !config.enabled) return;
  const onBubble = e.target && e.target.closest && e.target.closest('#hover-summary-tooltip');
  const onTarget = activeTarget && activeTarget.contains(e.target);
  if (onBubble || onTarget) {
    overBubbleOrTarget = true;
    clearTimeout(hideTimer);
    return;
  }
  if (overBubbleOrTarget) {
    overBubbleOrTarget = false;
    scheduleHide(); // 刚离开 → 调度一次淡出
  }
  // 已在外部移动：不重复 reset 计时器，避免一直复位导致永不淡出
});

// 划词模式：点击气泡/胶囊以外的任意位置即关闭（自然“读完即走”）；胶囊本身排除，避免误关
document.addEventListener('mousedown', (e) => {
  if (!tooltip || !config.enabled) return;
  if (config.triggerMode !== 'select') return;
  if (e.target && e.target.closest && e.target.closest('#hover-summary-tooltip, #hs-pill')) return;
  removeTooltip();
});

function getMeaningfulTarget(el) {
  if (!el) return null;
  if (el.id && el.id.startsWith('hover-summary-')) return null;
  if (el.closest && el.closest('#hover-summary-tooltip, #hs-pill')) return null;
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  if (['input', 'textarea', 'select', 'button', 'img', 'svg', 'canvas', 'video', 'audio', 'iframe', 'code', 'pre', 'script', 'style', 'noscript', 'template'].includes(tag)) return null;
  // 链接直接返回（长度过滤由 mousemove handler 负责）
  if (tag === 'a') {
    if (!el.textContent || !el.textContent.trim()) return null;
    return el;
  }
  // 排除包含 script/style 标签的容器（避免抓到 JS 代码）
  if (el.querySelector && el.querySelector('script, style, noscript')) {
    // 尝试找到不含这些标签的子元素
    const candidates = el.querySelectorAll('p, li, blockquote, span, a, td, dd, dt, figcaption');
    for (const c of candidates) {
      const t = c.textContent ? c.textContent.trim() : '';
      if (t.length >= 20 && t.length <= 5000 && !c.querySelector('script, style')) return c;
    }
    return null;
  }
  const selectors = [
    'p', 'li', 'blockquote', 'td', 'dd', 'dt', 'figcaption',
    '.article-body', '.post-content', '.entry-content', '.article-content',
    '.rich-text', '[data-article]', '.content',
    '.bili-article', '.article-content__holder', '.video-desc', '.reply-content',
    'article', 'section'
  ];
  for (const sel of selectors) {
    const node = el.matches ? (el.matches(sel) ? el : el.closest(sel)) : null;
    if (node) {
      // 再次检查容器不含 script/style
      if (node.querySelector && node.querySelector('script, style, noscript')) continue;
      const t = node.textContent ? node.textContent.trim() : '';
      if (t.length >= 20 && t.length <= 5000) return node;
    }
  }
  const own = el.textContent ? el.textContent.trim() : '';
  if (own.length >= 20 && own.length <= 5000) return el;
  return null;
}

// ── 预取：悬停初期就发请求，模型返回后再弹气泡（不在中途弹“加载中”） ────

// 抓取链接目标页面内容（经 background 绕开 CORS），供链接摘要使用
function fetchLinkContent(href, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    if (contextInvalid()) { reject(new Error('扩展上下文失效')); return; }
    let settled = false;
    // 超时兜底：目标页太慢就放弃抓取，退回用锚文本摘要，避免整条链路卡死
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('抓取超时')); }
    }, timeoutMs);
    chrome.runtime.sendMessage({ action: 'fetchPageContent', url: href }, (resp) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const err = chrome.runtime.lastError;
      if (err) { reject(new Error(err.message)); return; }
      if (resp && resp.success && resp.text) resolve(resp.text);
      else reject(new Error((resp && resp.error) || '抓取失败'));
    });
  });
}

function startPrefetch(text, href) {
  // 作废之前的预取
  prefetch = null;
  const truncated = text.slice(0, config.maxLength || 2000);
  // key = 锚文本（永不变），用于 openBubble 匹配继承；text 可能被替换成抓取的页面正文
  const pf = { key: truncated, text: truncated, mode: PREFETCH_MODE, seq: ++bubbleSeq, result: null, error: null, done: false, href };
  prefetch = pf;

  const runSummarize = () => {
    sendSummarize(
      { action: 'summarize', text: pf.text, mode: PREFETCH_MODE },
      (resp) => finishPrefetch(pf, resp, false),
      (fatalMsg) => finishPrefetch(pf, { success: false, error: fatalMsg }, true)
    );
  };

  // 链接：先尝试抓取目标页面内容，成功则用页面正文作摘要源；失败退化用锚文本
  if (href) {
    fetchLinkContent(href)
      .then((fetchedText) => {
        // 截断到 maxLength：本地小模型 prompt 越长处理越慢，整页全文会显著拖慢首响
        if (fetchedText && fetchedText.length > 100) pf.text = fetchedText.slice(0, config.maxLength || 2000);
        runSummarize();
      })
      .catch((err) => {
        // 动态站点（X/Twitter 等）需 JS 渲染，无法抓取正文：温和提示 + 退回用链接可见文字摘要，不报错
        if (err && /JS_REQUIRED/i.test(err.message)) {
          pf.jsNotice = '⚠️ 该页面需 JavaScript 渲染（X / Twitter 等），无法获取正文，已改用链接文本摘要。';
          runSummarize(); // 用锚文本(链接可见文字)做摘要
        } else {
          runSummarize(); // 其它抓取失败：退回用锚文本摘要
        }
      });
  } else {
    runSummarize();
  }
}

// 预取完成：渲染已打开的气泡，或在仍悬停时直接弹出（模型返回才弹，不显示加载占位）
function finishPrefetch(pf, resp, isFatal) {
  if (prefetch !== pf) return; // 已被新预取取代
  pf.done = true;
  if (resp && resp.success) {
    pf.result = resp.summary;
    pf.elapsed = resp.elapsed;
    pf.cached = resp.cached;
    pf.fallbackNote = resp.fallbackNote;
  } else {
    pf.error = (resp && resp.error) || (isFatal ? '请求失败' : '未知错误');
  }
  // 气泡已打开且仍在等此模式结果 → 直接渲染
  if (state && state.seq === pf.seq && state.mode === pf.mode && state.loading) {
    applyPrefetchResult(pf);
  } else if (!tooltip && hoverActive && prefetch === pf) {
    // 模型已返回但气泡还没弹 → 立即弹出（不显示“加载中”占位）
    // 传 key（锚文本）而非 pf.text（可能已被替换成抓取正文），保证 openBubble 能匹配继承
    openBubble(pf.key, pendingAnchor, 'summary');
  }
}

function applyPrefetchResult(pf) {
  setLoading(false);
  if (pf.result) {
    state.results[pf.mode] = pf.result;
    if (state.mode === pf.mode) renderSummary(pf.result, pf.elapsed, pf.cached, pf.fallbackNote);
    // 记录来源 URL（如果是链接摘要）
    if (pf.href) showSourceUrl(pf.href);
  } else {
    if (state.mode === pf.mode) renderError(pf.error || '未知错误');
  }
}

// 显示来源 URL
function showSourceUrl(url) {
  if (!url || !tooltip || !state) return;
  const body = tooltip.querySelector('.hs-body');
  if (!body) return;
  let sourceBar = tooltip.querySelector('.hs-source-url');
  if (!sourceBar) {
    sourceBar = document.createElement('div');
    sourceBar.className = 'hs-source-url';
    sourceBar.style.cssText = 'margin-top:8px;padding:4px 8px;font-size:11px;opacity:0.6;word-break:break-all;border-top:1px solid var(--hs-border);color:var(--hs-text-secondary);';
    body.appendChild(sourceBar);
  }
  const displayUrl = url.length > 80 ? url.substring(0, 77) + '...' : url;
  sourceBar.textContent = '📎 ' + uiText().source + '：' + displayUrl;
}

// ── 打开主浮窗 ────────────────────────────────────────────
function openBubble(text, anchor, initialMode) {
  const pf = prefetch; // 先在 removeTooltip 清空前捕获，避免继承不到预取结果
  removeTooltip();
  hidePill();
  const cut = text.slice(0, config.maxLength || 2000);
  // 匹配预取：锚文本 key 或摘要源文本任一相同即视为同一次悬停
  // （链接场景 pf.text 已被替换成抓取的页面正文，必须用 key 匹配，否则会二次请求）
  const pfMatch = !!(pf && (pf.key === cut || pf.text === cut));
  const reusedSeq = pfMatch ? pf.seq : ++bubbleSeq;
  state = {
    seq: reusedSeq,
    // 链接场景用抓取的页面正文作为上下文（追问时才有信息量），否则用悬停文本
    text: pfMatch ? pf.text : cut,
    fullText: text, // 保留完整文本用于换皮检测
    mode: initialMode || 'summary',
    results: {}, // mode -> summary
    history: [], // followup Q/A
    loading: false,
    duplicateResult: null, // 换皮检测结果
  };

  // 预取属于同一次悬停且已完成 → 直接继承（成功/失败都继承，杜绝二次请求）
  if (pfMatch && pf.done) {
    if (pf.result) {
      state.results[pf.mode] = pf.result;
    } else if (pf.error) {
      state.prefetchError = pf.error;
    }
    state.jsNotice = pf.jsNotice || null; // X/Twitter 等 JS 渲染站点的温和提示
  }
  tooltip = buildBubble();
  document.body.appendChild(tooltip);
  placeBubble(anchor);
  // 鼠标离开触发目标（且未进入气泡）→ 关闭气泡
  if (activeTarget) {
    const onLeaveClose = (ev) => {
      if (ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('#hover-summary-tooltip')) return;
      scheduleHide(); // 离开目标：按可配置延时淡出，切换链接更顺滑
    };
    activeTarget.addEventListener('mouseleave', onLeaveClose);
    tooltip._onLeaveClose = onLeaveClose;
  }
  setMode(initialMode || 'summary', true);
  overBubbleOrTarget = true; // 气泡打开时鼠标在触发目标/气泡上，避免立即触发淡出
  // 链接摘要继承成功时补显来源 URL
  if (pfMatch && pf.href && pf.result) showSourceUrl(pf.href);

  // 并行发起换皮检测（不阻塞摘要显示）
  if (config.duplicateCheck !== false) {
    triggerDuplicateCheck();
  }
}

function buildBubble() {
  const el = document.createElement('div');
  el.id = 'hover-summary-tooltip';
  el.className = 'hover-summary-tooltip hs-theme-' + resolveTheme();

  // 头部
  const header = document.createElement('div');
  header.className = 'hs-header';

  const icon = document.createElement('span');
  icon.className = 'hs-icon';
  icon.textContent = '🤖';

  const title = document.createElement('span');
  title.className = 'hs-title';
  title.textContent = uiText().title;

  const tabs = document.createElement('div');
  tabs.className = 'hs-tabs';
  for (const m of MODE_ORDER) {
    const meta = SUMMARY_MODES[m];
    if (!meta) continue;
    const b = document.createElement('button');
    b.className = 'hs-tab';
    b.dataset.mode = m;
    b.textContent = meta.icon + ' ' + ((uiText().modes && uiText().modes[m]) || meta.label);
    b.title = meta.desc;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setMode(m);
    });
    tabs.appendChild(b);
  }

  const drag = document.createElement('span');
  drag.className = 'hs-drag';
  drag.textContent = '⠿';
  drag.title = '拖动';
  drag.addEventListener('mousedown', startDrag);

  const close = document.createElement('span');
  close.className = 'hs-close';
  close.textContent = '✕';
  close.addEventListener('click', (ev) => {
    ev.stopPropagation();
    removeTooltip();
  });

  header.appendChild(icon);
  header.appendChild(title);
  header.appendChild(tabs);
  header.appendChild(drag);
  header.appendChild(close);

  // 正文
  const body = document.createElement('div');
  body.className = 'hs-body';

  const summary = document.createElement('div');
  summary.className = 'hs-summary';

  // 追问区
  const follow = document.createElement('div');
  follow.className = 'hs-followup';
  follow.style.display = 'none';
  const qa = document.createElement('div');
  qa.className = 'hs-qa';
  const inputRow = document.createElement('div');
  inputRow.className = 'hs-input-row';
  const input = document.createElement('input');
  input.className = 'hs-input';
  input.type = 'text';
  input.placeholder = uiText().followupPlaceholder;
  const send = document.createElement('button');
  send.className = 'hs-send';
  send.textContent = sendLabel();
  const doSend = () => {
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    sendFollowup(q);
  };
  send.addEventListener('click', (ev) => {
    ev.stopPropagation();
    doSend();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.stopPropagation();
      doSend();
    }
  });
  inputRow.appendChild(input);
  inputRow.appendChild(send);
  follow.appendChild(qa);
  follow.appendChild(inputRow);

  // 换皮检测警告条（初始隐藏，检测结果返回后填充）
  const dupBar = document.createElement('div');
  dupBar.className = 'hs-dup-bar';
  dupBar.style.display = 'none';

  // 元信息 + 操作
  const meta = document.createElement('div');
  meta.className = 'hs-meta';
  const copy = document.createElement('button');
  copy.className = 'hs-copy-btn';
  copy.textContent = uiText().copy;
  copy.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const text = currentSummaryText();
    if (!text) return;
    copyToClipboard(text)
      .then(() => {
        copy.textContent = uiText().copied;
        setTimeout(() => (copy.textContent = uiText().copy), 2000);
      })
      .catch(() => {
        copy.textContent = '⚠️ 复制失败';
        setTimeout(() => (copy.textContent = uiText().copy), 2000);
      });
  });

  body.appendChild(dupBar);
  body.appendChild(summary);
  // 温和提示条（X/Twitter 等 JS 渲染站点无法抓正文时显示）
  const notice = document.createElement('div');
  notice.className = 'hs-notice';
  notice.style.display = 'none';
  body.appendChild(notice);
  body.appendChild(follow);
  body.appendChild(meta);
  body.appendChild(copy);

  el.appendChild(header);
  el.appendChild(body);

  // 保持打开：鼠标在气泡内不自动消失
  el.addEventListener('mouseenter', () => {
    clearTimeout(hideTimer);
  });
  el.addEventListener('mouseleave', () => {
    if (state && state.loading) return; // 加载中不自动关
    scheduleHide(); // 按可配置延时淡出
  });

  return el;
}

function currentSummaryText() {
  if (!state) return '';
  if (state.mode === 'followup') {
    return state.history.map((h) => 'Q: ' + h.q + '\nA: ' + h.a).join('\n\n');
  }
  return state.results[state.mode] || '';
}

// 复制到剪贴板：优先用异步 Clipboard API（需安全上下文），
// 在 http 网页等非安全上下文里降级到 execCommand('copy')，否则会静默失败。
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('execCommand copy failed'));
    } catch (e) {
      reject(e);
    }
  });
}

function placeBubble(anchor) {
  if (!tooltip) return;
  const w = tooltip.offsetWidth || 360;
  const h = tooltip.offsetHeight || 200;
  let x = (anchor ? anchor.x : window.innerWidth / 2) + 14;
  let y = (anchor ? anchor.y : 80) + 14;
  // 边缘翻转
  if (x + w > window.innerWidth - 12) x = (anchor ? anchor.x : window.innerWidth) - w - 14;
  if (x < 12) x = 12;
  if (y + h > window.innerHeight - 12) y = (anchor ? anchor.y : window.innerHeight) - h - 14;
  if (y < 12) y = 12;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

// ── 模式切换 ──────────────────────────────────────────────
function setMode(mode, isInitial) {
  if (!state) return;
  state.mode = mode;
  const tabs = tooltip.querySelectorAll('.hs-tab');
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));

  const summaryEl = tooltip.querySelector('.hs-summary');
  const followEl = tooltip.querySelector('.hs-followup');
  const metaEl = tooltip.querySelector('.hs-meta');
  renderNotice(state.jsNotice); // 温和提示（如 X/Twitter）在任意模式下都常驻显示

  if (mode === 'followup') {
    summaryEl.style.display = 'none';
    followEl.style.display = 'block';
    renderQA();
    if (!state.history.length) summaryEl.dataset.hint = '1';
    const input = followEl.querySelector('.hs-input');
    if (input && isInitial) setTimeout(() => input.focus(), 50);
    return;
  }

  followEl.style.display = 'none';
  summaryEl.style.display = 'block';

  if (state.results[mode] != null) {
    renderSummary(state.results[mode]);
    return;
  }
  // 预取已出错（同一段文本）：直接显示错误，不再二次请求
  if (state.prefetchError != null && mode === PREFETCH_MODE) {
    renderError(state.prefetchError);
    return;
  }
  // 需要请求
  setLoading(true);
  const modeSeq = state.seq;
  sendSummarize(
    { action: 'summarize', text: state.text, mode },
    (resp) => {
      // 请求期间用户已切到新链接或新模式，丢弃旧结果
      if (!state || state.seq !== modeSeq) return;
      setLoading(false);
      if (resp && resp.success) {
        state.results[mode] = resp.summary;
        state.fallbackNote = resp.fallbackNote;
        if (state.mode === mode) renderSummary(resp.summary, resp.elapsed, resp.cached, resp.fallbackNote);
      } else {
        if (state.mode === mode) renderError((resp && resp.error) || '未知错误');
      }
    },
    (fatalMsg) => {
      if (!state || state.seq !== modeSeq) return;
      setLoading(false);
      if (state.mode === mode) renderFatal(fatalMsg);
    }
  );
}

function setLoading(on) {
  if (!tooltip) return;
  state.loading = on;
  tooltip.classList.toggle('hs-loading', on);
  const summaryEl = tooltip.querySelector('.hs-summary');
  if (on) {
    summaryEl.textContent = '⏳ AI 处理中…';
    summaryEl.classList.add('hs-loading-text');
  } else {
    summaryEl.classList.remove('hs-loading-text');
  }
}

function renderSummary(text, elapsed, cached, fallbackNote) {
  const summaryEl = tooltip.querySelector('.hs-summary');
  const metaEl = tooltip.querySelector('.hs-meta');
  summaryEl.textContent = text;
  summaryEl.classList.remove('hs-error-text');
  metaEl.textContent = '';
  const parts = [];
  if (elapsed != null && elapsed !== 0) parts.push('⏱ ' + elapsed + 's');
  if (cached) parts.push('⚡ 已缓存');
  if (fallbackNote) parts.push(fallbackNote);
  metaEl.textContent = parts.join('  ');
}

function renderError(msg) {
  const summaryEl = tooltip.querySelector('.hs-summary');
  const metaEl = tooltip.querySelector('.hs-meta');
  summaryEl.textContent = '❌ ' + msg;
  summaryEl.classList.add('hs-error-text');
  metaEl.textContent = '';
}

// 温和提示条（非致命）：X/Twitter 等 JS 渲染站点无法抓正文、改用链接文本摘要时显示
function renderNotice(msg) {
  const n = tooltip && tooltip.querySelector('.hs-notice');
  if (!n) return;
  if (msg) {
    n.textContent = msg;
    n.style.display = 'block';
  } else {
    n.style.display = 'none';
  }
}

// 传输层致命错误（扩展上下文失效 / SW 无响应）：给出可一键刷新的恢复入口
function renderFatal(msg) {
  const summaryEl = tooltip && tooltip.querySelector('.hs-summary');
  const metaEl = tooltip && tooltip.querySelector('.hs-meta');
  if (!summaryEl) return;
  summaryEl.innerHTML = '';
  summaryEl.classList.add('hs-error-text');
  const tip = document.createElement('div');
  tip.textContent = '❌ ' + msg;
  const btn = document.createElement('button');
  btn.className = 'hs-reload-btn';
  btn.type = 'button';
  btn.textContent = '🔄 刷新页面';
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    try {
      location.reload();
    } catch (e) {}
  });
  summaryEl.appendChild(tip);
  summaryEl.appendChild(btn);
  if (metaEl) metaEl.textContent = '';
}

// ── 追问 ──────────────────────────────────────────────────
function sendFollowup(question) {
  if (!state || state.loading) return;
  setLoading(true);
  const fuSeq = state.seq;
  sendSummarize(
    { action: 'summarize', text: state.text, mode: 'followup', question, history: state.history },
    (resp) => {
      if (!state || state.seq !== fuSeq) return;
      setLoading(false);
      if (resp && resp.success) {
        state.history.push({ q: question, a: resp.summary });
        renderQA();
      } else {
        pushQA(question, '❌ ' + ((resp && resp.error) || '未知错误'), true);
      }
    },
    (fatalMsg) => {
      if (!state || state.seq !== fuSeq) return;
      setLoading(false);
      pushQA(question, '❌ ' + fatalMsg, true);
    }
  );
}

function pushQA(q, a, isError) {
  state.history.push({ q, a, error: isError });
  renderQA();
}

function renderQA() {
  const qa = tooltip.querySelector('.hs-qa');
  qa.innerHTML = '';
  if (!state.history.length) {
    const hint = document.createElement('div');
    hint.className = 'hs-hint';
    hint.textContent = '对这段内容有什么想问的？例如「这段话的核心论点是什么？」';
    qa.appendChild(hint);
  }
  for (const turn of state.history) {
    const qEl = document.createElement('div');
    qEl.className = 'hs-q';
    qEl.textContent = 'Q：' + turn.q;
    const aEl = document.createElement('div');
    aEl.className = 'hs-a' + (turn.error ? ' hs-error-text' : '');
    aEl.textContent = 'A：' + turn.a;
    qa.appendChild(qEl);
    qa.appendChild(aEl);
  }
  qa.scrollTop = qa.scrollHeight;
}

// ── 拖动 ──────────────────────────────────────────────────
function startDrag(e) {
  if (!tooltip) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const origLeft = tooltip.offsetLeft;
  const origTop = tooltip.offsetTop;
  function move(ev) {
    let nx = origLeft + (ev.clientX - startX);
    let ny = origTop + (ev.clientY - startY);
    nx = Math.max(8, Math.min(nx, window.innerWidth - tooltip.offsetWidth - 8));
    ny = Math.max(8, Math.min(ny, window.innerHeight - tooltip.offsetHeight - 8));
    tooltip.style.left = nx + 'px';
    tooltip.style.top = ny + 'px';
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ── 通信：检测「扩展上下文失效」，给出可恢复的提示 ────────
// MV3 下扩展被重载（如开发期反复改文件）后，已打开标签页里注入的旧
// content script 仍存活，但其 chrome.runtime 指向的上下文已被销毁，
// 此时任何 sendMessage 都会抛出 "Extension context invalidated"。
// 这类错误无法靠重试恢复，必须刷新页面让新 content script 重新注入。
function contextInvalid() {
  try {
    return !chrome.runtime || !chrome.runtime.id;
  } catch (e) {
    return true;
  }
}

// onResult(resp): 正常往返（含业务错误，由调用方判断 resp.success）
// onFatal(msg):  传输层致命错误（上下文失效 / SW 无响应），应提示用户刷新页面
function sendSummarize(message, onResult, onFatal) {
  if (contextInvalid()) {
    onFatal('扩展已更新，请刷新此页面后重试');
    return;
  }
  let attempt = 0;
  const retries = 1;
  function trySend() {
    attempt++;
    const timer = setTimeout(() => {
      if (attempt <= retries) return trySend();
      onFatal('Service Worker 无响应，请刷新此页面后重试');
    }, 8000);
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          const m = (err.message || '').toLowerCase();
          if (contextInvalid() || m.indexOf('extension context invalidated') !== -1) {
            onFatal('扩展已更新，请刷新此页面后重试');
            return;
          }
          if (attempt <= retries) return setTimeout(trySend, 300);
          onFatal(err.message || '消息发送失败');
          return;
        }
        onResult(resp);
      });
    } catch (e) {
      clearTimeout(timer);
      if (contextInvalid()) {
        onFatal('扩展已更新，请刷新此页面后重试');
        return;
      }
      if (attempt <= retries) return setTimeout(trySend, 300);
      onFatal(e.message || '消息发送失败');
    }
  }
  trySend();
}

// ── 换皮检测 ──────────────────────────────────────────────
// 悬停时并行调用本地检测服务，不阻塞 AI 摘要显示。
// 检测结果返回后，在浮窗顶部显示警告条。
function triggerDuplicateCheck() {
  if (!state || !state.fullText) return;
  const mySeq = state.seq;

  // 从当前页面提取标题和作者作为辅助信息
  const pageTitle = document.title || '';
  const pageUrl = location.href || '';

  // 提取作者（尝试常见选择器）
  let pageAuthor = '';
  const authorSelectors = [
    'meta[property="article:author"]',
    'meta[name="author"]',
    '.author-name', '.author', '.username',
    '#js_name', // 微信公众号
    '.up-name', '.username', // B站
  ];
  for (const sel of authorSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      pageAuthor = el.getAttribute('content') || el.textContent || '';
      pageAuthor = pageAuthor.trim();
      if (pageAuthor) break;
    }
  }

  const payload = {
    action: 'detectDuplicate',
    text: state.fullText.slice(0, 5000),
    title: pageTitle.slice(0, 200),
    author: pageAuthor.slice(0, 100),
    url: pageUrl,
  };

  chrome.runtime.sendMessage(payload, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      // 静默失败：服务未启动等，不打扰用户
      return;
    }
    // 确保 tooltip 还在且仍是同一个气泡（用户可能已切换到新链接）
    if (!tooltip || !state || state.seq !== mySeq) return;

    state.duplicateResult = resp;
    renderDuplicateBar(resp);
  });
}

function renderDuplicateBar(resp) {
  if (!tooltip) return;
  const bar = tooltip.querySelector('.hs-dup-bar');
  if (!bar) return;

  const verdict = resp.verdict || 'original';
  const icon = resp.verdict_icon || '✅';
  const text = resp.verdict_text || '';

  bar.className = 'hs-dup-bar hs-dup-' + verdict;
  bar.style.display = 'block';
  bar.textContent = icon + ' ' + text;

  // 如果有匹配详情，添加展开按钮
  if (resp.matches && resp.matches.length > 0 && verdict !== 'original') {
    const detail = document.createElement('div');
    detail.className = 'hs-dup-detail';
    const top = resp.matches[0];
    detail.innerHTML = '' +
      '<span class="hs-dup-label">最相似:</span> ' +
      '<span class="hs-dup-title">' + escapeHtml(top.title || '(无标题)') + '</span>' +
      (top.author ? ' <span class="hs-dup-author">@' + escapeHtml(top.author) + '</span>' : '') +
      '<span class="hs-dup-score">综合 ' + (top.combined_score || 0) + '%</span>' +
      '<span class="hs-dup-breakdown">文本 ' + (top.simhash_similarity || 0) + '% · N-gram ' + (top.ngram_similarity || 0) + '% · 标题 ' + (top.title_similarity || 0) + '%</span>';
    bar.appendChild(detail);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// 淡出并移除气泡（用于延时隐藏，保证切换顺滑）
function fadeRemoveTooltip() {
  if (!tooltip) return;
  clearTimeout(hideTimer);
  hideTimer = null;
  tooltip.style.opacity = '0';
  setTimeout(() => { if (tooltip) removeTooltip(); }, 200);
}
// 安排延时隐藏：鼠标离开气泡/目标后，按可配置的 bubbleHideDelay 保留并淡出
function scheduleHide(delay) {
  clearTimeout(hideTimer);
  const d = delay != null ? delay : (config.bubbleHideDelay || 800);
  hideTimer = setTimeout(fadeRemoveTooltip, d);
}

function removeTooltip() {
  clearTimeout(hideTimer);
  hideTimer = null;
  if (tooltip && tooltip._onLeaveClose && activeTarget) {
    activeTarget.removeEventListener('mouseleave', tooltip._onLeaveClose);
  }
  if (tooltip) {
    tooltip.remove();
    tooltip = null;
  }
  if (leaveHandler && activeTarget) {
    activeTarget.removeEventListener('mouseleave', leaveHandler);
    leaveHandler = null;
  }
  state = null;
  prefetch = null; // 清除预取缓存
  lastHoverText = ''; // 允许重新触发同一文本
  hoverActive = false;
  activeTarget = null; // 清除当前触发元素引用
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    removeTooltip();
    hidePill();
  }
});
