// test/bookmarklet.js — 书签版本，不依赖 Chrome 扩展系统
// 使用方法：浏览器新建书签，URL 填入 javascript: 后面的内容
// 或者直接在页面地址栏输入 javascript: 然后粘贴代码

(function() {
  if (window.__hsBookmarklet) {
    alert('Hover Summary 已加载，现在悬停文字即可触发摘要');
    return;
  }
  window.__hsBookmarklet = true;

  const AGNES_ENDPOINT = 'https://apihub.agnes-ai.com/v1/chat/completions';
  const AGNES_KEY = prompt('请输入 Agnes API Key (留空则用本地 oMLX):', '');
  const AGNES_MODEL = 'agnes-2.0-flash';
  const LOCAL_ENDPOINT = 'http://127.0.0.1:8000/v1/chat/completions';
  const LOCAL_MODEL = 'Qwen2.5-0.5B-Instruct-4bit';
  const USE_LOCAL = !AGNES_KEY;

  let hoverTimer = null;
  let currentTooltip = null;
  const hoverDelay = 600;

  // 注入样式
  const style = document.createElement('style');
  style.textContent = `
    .hover-summary-tooltip {
      position: fixed; z-index: 2147483647; width: 360px;
      background: rgba(255,255,255,0.95); backdrop-filter: blur(20px);
      border: 1px solid rgba(0,0,0,0.08); border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px; color: #1a1a1a; overflow: hidden;
    }
    .hover-summary-tooltip .hs-header {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 12px; background: rgba(0,0,0,0.03);
      border-bottom: 1px solid rgba(0,0,0,0.06);
    }
    .hover-summary-tooltip .hs-title { font-weight: 600; font-size: 13px; }
    .hover-summary-tooltip .hs-close { margin-left: auto; cursor: pointer; opacity: 0.5; }
    .hover-summary-tooltip .hs-close:hover { opacity: 1; }
    .hover-summary-tooltip .hs-body { padding: 12px; }
    .hover-summary-tooltip .hs-summary { line-height: 1.6; }
    .hover-summary-tooltip .hs-meta { font-size: 11px; color: #888; margin-top: 8px; }
    .hover-summary-tooltip .hs-copy-btn {
      margin-top: 8px; padding: 4px 12px; font-size: 12px;
      border: 1px solid rgba(0,0,0,0.1); border-radius: 6px;
      background: rgba(0,0,0,0.03); cursor: pointer;
    }
    .hover-summary-tooltip .hs-copy-btn:hover { background: rgba(0,0,0,0.06); }
    .hover-summary-tooltip.hs-loading .hs-body { color: #666; }
    .hover-summary-tooltip.hs-error .hs-body { color: #c00; }
    @media (prefers-color-scheme: dark) {
      .hover-summary-tooltip { background: rgba(40,40,40,0.95); color: #f0f0f0; border-color: rgba(255,255,255,0.1); }
      .hover-summary-tooltip .hs-header { background: rgba(255,255,255,0.05); }
      .hover-summary-tooltip.hs-error .hs-body { color: #ff6b6b; }
    }
  `;
  document.head.appendChild(style);

  function getTarget(el) {
    if (!el || el.closest('.hover-summary-tooltip')) return null;
    const tag = el.tagName?.toLowerCase();
    if (['input','textarea','select','button','a','img','svg','canvas','video','audio','iframe'].includes(tag)) return null;
    const sels = ['p','li','blockquote','td','article','section','.content','.article-body','.post-content','div'];
    for (const s of sels) {
      const node = el.matches?.(s) ? el : el.closest?.(s);
      if (node) {
        const t = node.textContent?.trim() || '';
        if (t.length >= 20 && t.length <= 5000) return node;
      }
    }
    return null;
  }

  document.addEventListener('mouseover', (e) => {
    const target = getTarget(e.target);
    if (!target) return;
    const text = target.textContent.trim();
    if (text.length < 20) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => requestSummary(text, e.clientX, e.clientY), hoverDelay);
  });

  document.addEventListener('mouseout', () => clearTimeout(hoverTimer));

  document.addEventListener('mousemove', (e) => {
    if (currentTooltip && currentTooltip.classList.contains('hs-loading')) {
      const margin = 16;
      currentTooltip.style.left = Math.min(e.clientX + margin, window.innerWidth - 376) + 'px';
      currentTooltip.style.top = Math.min(e.clientY + margin, window.innerHeight - 200) + 'px';
    }
  });

  function requestSummary(text, x, y) {
    removeTooltip();
    currentTooltip = createTooltip('⏳ AI 摘要中...', x, y);
    document.body.appendChild(currentTooltip);

    const truncated = text.substring(0, 2000);
    const endpoint = USE_LOCAL ? LOCAL_ENDPOINT : AGNES_ENDPOINT;
    const key = USE_LOCAL ? '' : AGNES_KEY;
    const model = USE_LOCAL ? LOCAL_MODEL : AGNES_MODEL;

    const start = performance.now();
    const tid = setTimeout(() => updateTooltip('❌ 请求超时', 'error'), 15000);

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: `请用一两句话简洁地总结以下内容：\n\n${truncated}` }],
        max_tokens: 128, temperature: 0.5, stream: false
      })
    }).then(r => r.json()).then(data => {
      clearTimeout(tid);
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      const summary = data.choices?.[0]?.message?.content?.trim() || data.choices?.[0]?.text?.trim() || '(空响应)';
      if (summary === '(空响应)' || !summary) {
        updateTooltip('❌ API 返回为空: ' + JSON.stringify(data).substring(0, 100), 'error');
      } else {
        updateTooltip(summary, 'success', elapsed);
      }
    }).catch(e => {
      clearTimeout(tid);
      updateTooltip('❌ ' + e.message, 'error');
    });
  }

  function createTooltip(content, x, y) {
    const tip = document.createElement('div');
    tip.className = 'hover-summary-tooltip hs-loading';
    tip.innerHTML = `<div class="hs-header"><span>🤖</span><span class="hs-title">AI 摘要</span><span class="hs-close">✕</span></div><div class="hs-body">${content}</div>`;
    tip.querySelector('.hs-close').onclick = (e) => { e.stopPropagation(); tip.remove(); currentTooltip = null; };
    const margin = 16;
    tip.style.left = Math.min(x + margin, window.innerWidth - 376) + 'px';
    tip.style.top = Math.min(y + margin, window.innerHeight - 200) + 'px';
    return tip;
  }

  function updateTooltip(content, state, elapsed) {
    if (!currentTooltip) return;
    currentTooltip.className = `hover-summary-tooltip hs-${state}`;
    const body = currentTooltip.querySelector('.hs-body');
    if (state === 'success') {
      body.innerHTML = `<div class="hs-summary">${content}</div>` +
        (elapsed ? `<div class="hs-meta">⏱ ${elapsed}s</div>` : '') +
        `<button class="hs-copy-btn" onclick="navigator.clipboard.writeText('${content.replace(/'/g, "\\'")}');this.textContent='✅ 已复制'">📋 复制</button>`;
      let t = setTimeout(() => { currentTooltip?.remove(); currentTooltip = null; }, 8000);
      currentTooltip.onmouseenter = () => clearTimeout(t);
      currentTooltip.onmouseleave = () => { t = setTimeout(() => { currentTooltip?.remove(); currentTooltip = null; }, 2000); };
    } else {
      body.textContent = content;
    }
  }

  function removeTooltip() {
    if (currentTooltip) { currentTooltip.remove(); currentTooltip = null; }
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') removeTooltip(); });

  alert('✅ Hover Summary 已加载！\n\n现在悬停任意文字 0.6 秒即可触发 AI 摘要。\n模型: ' + (USE_LOCAL ? '本地 oMLX' : 'Agnes ' + AGNES_MODEL));
})();
