// test/simulate-extension.mjs
// 用 Puppeter 模拟扩展行为：注入简化版 content script + 直接调用 Agnes API
// 验证悬停 → 摘要生成 → UI 显示的完整链路

import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '..');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 读取 styles.css
const stylesCss = fs.readFileSync(path.join(EXTENSION_PATH, 'src/styles.css'), 'utf8');

// API 配置
const AGNES_ENDPOINT = 'https://apihub.agnes-ai.com/v1/chat/completions';
const AGNES_KEY = '';
const AGNES_MODEL = 'agnes-2.0-flash';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 简化版 content script（直接内联，不依赖 chrome API）
const injectedScript = `
(function() {
  let hoverTimer = null;
  let currentTooltip = null;
  const hoverDelay = 800;

  // 鼠标悬停检测
  document.addEventListener('mouseover', (e) => {
    const target = getMeaningfulTarget(e.target);
    if (!target) return;
    const text = target.textContent?.trim();
    if (!text || text.length < 20) return;

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      requestSummary(text, e.clientX, e.clientY);
    }, hoverDelay);
  });

  document.addEventListener('mouseout', () => {
    clearTimeout(hoverTimer);
  });

  document.addEventListener('mousemove', (e) => {
    if (currentTooltip && currentTooltip.classList.contains('hs-loading')) {
      positionTooltip(e.clientX, e.clientY);
    }
  });

  function getMeaningfulTarget(el) {
    if (el.id?.startsWith('hover-summary-') || el.closest('#hover-summary-tooltip')) return null;
    const selectors = ['article', 'section', '.test-block', '.content', '.post-content', '.entry-content', 'p', 'div'];
    for (const sel of selectors) {
      if (el.matches?.(sel)) return el;
      const parent = el.closest?.(sel);
      if (parent && parent.textContent.trim().length >= 20) return parent;
    }
    if (el.textContent && el.textContent.trim().length >= 20 && el.textContent.trim().length <= 5000) return el;
    return null;
  }

  function requestSummary(text, x, y) {
    removeTooltip();
    currentTooltip = createTooltip('loading', '⏳ AI 摘要中...', x, y);
    document.body.appendChild(currentTooltip);

    const truncated = text.substring(0, 2000);
    window.__hsCallAPI(truncated).then(response => {
      if (response.ok) {
        updateTooltip('success', response.summary, response.elapsed);
      } else {
        updateTooltip('error', '❌ ' + (response.error || '未知错误'));
      }
    });
  }

  function createTooltip(state, content, x, y) {
    const tooltip = document.createElement('div');
    tooltip.id = 'hover-summary-tooltip';
    tooltip.className = 'hover-summary-tooltip hs-' + state;

    const header = document.createElement('div');
    header.className = 'hs-header';
    header.innerHTML = '<span class="hs-icon">🤖</span><span class="hs-title">AI 摘要</span>';

    const closeBtn = document.createElement('span');
    closeBtn.className = 'hs-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = (e) => { e.stopPropagation(); removeTooltip(); };
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'hs-body';
    body.textContent = content;

    tooltip.appendChild(header);
    tooltip.appendChild(body);
    positionTooltipAt(tooltip, x, y);
    return tooltip;
  }

  function positionTooltip(x, y) {
    if (currentTooltip) positionTooltipAt(currentTooltip, x, y);
  }

  function positionTooltipAt(el, x, y) {
    const margin = 16;
    const maxX = window.innerWidth - 380 - margin;
    const maxY = window.innerHeight - 200 - margin;
    el.style.left = Math.min(x + margin, maxX) + 'px';
    el.style.top = Math.min(y + margin, maxY) + 'px';
  }

  function updateTooltip(state, content, elapsed) {
    if (!currentTooltip) return;
    currentTooltip.className = 'hover-summary-tooltip hs-' + state;
    const body = currentTooltip.querySelector('.hs-body');

    if (state === 'success') {
      body.innerHTML = '';
      const summaryEl = document.createElement('div');
      summaryEl.className = 'hs-summary';
      summaryEl.textContent = content;
      body.appendChild(summaryEl);

      if (elapsed) {
        const meta = document.createElement('div');
        meta.className = 'hs-meta';
        meta.textContent = '⏱ ' + elapsed + 's';
        body.appendChild(meta);
      }

      const copyBtn = document.createElement('button');
      copyBtn.className = 'hs-copy-btn';
      copyBtn.textContent = '📋 复制';
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(content);
        copyBtn.textContent = '✅ 已复制';
        setTimeout(() => { copyBtn.textContent = '📋 复制'; }, 2000);
      };
      body.appendChild(copyBtn);
    } else {
      body.textContent = content;
    }

    if (state === 'success' || state === 'error') {
      let autoHideTimer = setTimeout(() => removeTooltip(), 8000);
      currentTooltip.addEventListener('mouseenter', () => clearTimeout(autoHideTimer));
      currentTooltip.addEventListener('mouseleave', () => {
        autoHideTimer = setTimeout(() => removeTooltip(), 2000);
      });
    }
  }

  function removeTooltip() {
    if (currentTooltip) {
      currentTooltip.remove();
      currentTooltip = null;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') removeTooltip();
  });

  console.log('Hover Summary content script loaded');
})();
`;

async function run() {
  console.log('🚀 启动 Chrome...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    userDataDir: '/tmp/hs-simulate-profile',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      '--disable-background-networking',
      '--disable-sync',
    ],
  });

  const page = await browser.newPage();

  // 注入 API 调用函数
  await page.exposeFunction('__hsCallAPI', async (text) => {
    console.log(`📝 调用 Agnes API 总结: ${text.substring(0, 30)}...`);
    const start = Date.now();
    try {
      const resp = await fetch(AGNES_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AGNES_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: AGNES_MODEL,
          messages: [{ role: 'user', content: `请用一两句话简洁地总结以下内容：\n\n${text}` }],
          max_tokens: 128,
          temperature: 0.5,
          stream: false
        })
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}`, elapsed };
      const data = await resp.json();
      const summary = data.choices[0].message.content.trim();
      console.log(`✅ Agnes 返回 (${elapsed}s): ${summary.substring(0, 60)}...`);
      return { ok: true, summary, elapsed: parseFloat(elapsed) };
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      return { ok: false, error: e.message, elapsed: parseFloat(elapsed) };
    }
  });

  console.log('📄 打开测试页...');
  await page.goto('http://127.0.0.1:9876/test-page.html', { waitUntil: 'networkidle2' });
  await sleep(5000);

  // 注入 CSS
  await page.addStyleTag({ content: stylesCss });

  // 注入简化版 content script
  await page.evaluate(injectedScript);
  console.log('✅ Content script 已注入');

  // 悬停在第一个测试段落上
  console.log('🖱️ 悬停在测试段落 1 上...');
  const paragraph = await page.$('.test-block p');
  if (!paragraph) {
    console.error('❌ 找不到测试段落');
    await browser.close();
    return;
  }

  const box = await paragraph.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  console.log('⏳ 等待 AI 摘要浮窗（最多 60s）...');
  try {
    await page.waitForSelector('#hover-summary-tooltip .hs-summary', { timeout: 60000 });
    await sleep(1000);
    
    const result = await page.evaluate(() => {
      const tooltip = document.querySelector('#hover-summary-tooltip');
      if (!tooltip) return null;
      return {
        summary: tooltip.querySelector('.hs-summary')?.textContent?.trim() || '',
        meta: tooltip.querySelector('.hs-meta')?.textContent?.trim() || '',
        className: tooltip.className,
      };
    });
    
    if (result) {
      console.log(`✅ 摘要生成成功！`);
      console.log(`   类名: ${result.className}`);
      console.log(`   摘要: ${result.summary}`);
      console.log(`   元信息: ${result.meta}`);
    } else {
      console.log('❌ 浮窗未显示');
    }
  } catch (e) {
    console.error(`❌ 等待浮窗超时: ${e.message}`);
    const errorInfo = await page.evaluate(() => {
      const t = document.querySelector('#hover-summary-tooltip');
      if (!t) return 'no tooltip';
      return {
        html: t.innerHTML.substring(0, 300),
        class: t.className,
      };
    });
    console.error('   浮窗状态:', JSON.stringify(errorInfo));
  }

  // 截图
  await page.screenshot({ path: path.join(__dirname, 'screenshot.png'), fullPage: false });
  console.log('📸 截图已保存: test/screenshot.png');

  await sleep(5000);
  await browser.close();
  console.log('🏁 测试完成');
}

run().catch(e => {
  console.error('💥 测试失败:', e);
  process.exit(1);
});
