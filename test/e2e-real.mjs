// test/e2e-real.mjs
// 在真实浏览器（headless）中验证「真实」的 src/summary-modes.js + src/content.js：
//   headless 无法加载未打包扩展，因此这里注入真实源码并用 mock 的 chrome API 代替，
//   从而端到端验证 划词→药丸→气泡→5模式→追问 的 UI 链路（无需真实模型/网络）。
//
// 运行：先在 test/ 起 http server，再 `node test/e2e-real.mjs`

import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.join(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = 'http://127.0.0.1:9876/test-page.html';

const log = (...a) => console.log(...a);
let failures = 0;
function assert(cond, name) {
  if (cond) log('  ✅ ' + name);
  else { log('  ❌ ' + name); failures++; }
}

async function waitFor(page, fn, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

const summaryModes = fs.readFileSync(path.join(EXT_PATH, 'src/summary-modes.js'), 'utf8');
const contentJs = fs.readFileSync(path.join(EXT_PATH, 'src/content.js'), 'utf8');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 60000,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => log('   [pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') log('   [page console error] ' + m.text()); });

  // 在页面脚本运行前注入 mock 的 chrome API
  await page.evaluateOnNewDocument(() => {
    window.__hsCalls = [];
    const cfg = {
      enabled: true, theme: 'auto', hoverDelay: 800, triggerMode: 'select',
      maxLength: 2000, model: 'agnes',
      agnes: { endpoint: '', apiKey: '', model: 'agnes-2.0-flash' },
      nvidia: { endpoint: '', apiKey: '', model: 'gemma' },
      local: { endpoint: '', apiKey: '', model: 'qwen' }
    };
    window.chrome = {
      runtime: {
        id: 'test-extension-id',
        lastError: null,
        sendMessage: (msg, cb) => {
          window.__hsCalls.push(msg);
          if (msg.action === 'getConfig') return cb(cfg);
          if (msg.action === 'summarize') {
            const LABEL = { summary: '摘要', points: '要点', explain: '解释', translate: '翻译', followup: '追问' };
            const tag = LABEL[msg.mode] || msg.mode;
            return cb({ success: true, summary: `【${tag}】这是关于「${(msg.text || '').slice(0, 12)}…」的模拟结果`, elapsed: 1.2 });
          }
          if (msg.action === 'ping') return cb({ ok: true });
          return cb(null);
        },
        onMessage: { addListener: () => {} },
        onConnect: { addListener: () => {} }
      },
      storage: {
        sync: { get: (k, cb) => cb({}), set: () => {}, onChanged: { addListener: () => {} } },
        onChanged: { addListener: () => {} }
      },
      tabs: { query: (o, cb) => cb([]), sendMessage: () => {} }
    };
  });

  await page.goto('about:blank');
  await new Promise((r) => setTimeout(r, 200));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 300));

  // 注入真实源码（顺序与 manifest 一致：先 summary-modes.js 再 content.js）
  await page.addScriptTag({ content: summaryModes });
  await page.addScriptTag({ content: contentJs });
  await new Promise((r) => setTimeout(r, 200));

  // 1) summary-modes 注入成功
  const injected = await waitFor(page, () => typeof window.HS_MODES !== 'undefined' && !!window.HS_MODES.SUMMARY_MODES);
  assert(injected, 'summary-modes.js 注入，window.HS_MODES 可用');

  // 2) 划词 → 药丸
  await page.evaluate(() => {
    const p = document.querySelector('.test-block p');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  const pill = await waitFor(page, () => !!document.getElementById('hs-pill'));
  assert(pill, '选中文字后出现「💡 总结」药丸');

  // 3) 点击药丸 → 浮窗 + 5 模式
  await page.evaluate(() => document.getElementById('hs-pill').click());
  const bubble = await waitFor(page, () => !!document.getElementById('hover-summary-tooltip'));
  assert(bubble, '点击药丸后浮窗出现');

  const info = await page.evaluate(() => {
    const t = document.getElementById('hover-summary-tooltip');
    const tabs = [...t.querySelectorAll('.hs-tab')];
    const active = t.querySelector('.hs-tab.active');
    return {
      tabCount: tabs.length,
      tabModes: tabs.map((b) => b.dataset.mode),
      activeMode: active ? active.dataset.mode : null,
      summaryText: t.querySelector('.hs-summary')?.textContent || ''
    };
  });
  assert(info.tabCount === 5, `浮窗含 5 个模式 tab（实际 ${info.tabCount}）`);
  assert(JSON.stringify(info.tabModes) === JSON.stringify(['summary', 'points', 'explain', 'translate', 'followup']), '模式顺序正确');
  assert(info.activeMode === 'summary', '默认激活「摘要」tab');
  assert(info.summaryText.includes('【摘要】'), '摘要模式渲染出模拟结果');

  // 4) 切换到「翻译」模式 → 重新请求并渲染
  await page.evaluate(() => {
    const t = document.getElementById('hover-summary-tooltip');
    t.querySelector('.hs-tab[data-mode="translate"]').click();
  });
  await waitFor(page, () => /【翻译】/.test(document.querySelector('.hs-summary')?.textContent || ''));
  const translateOk = await page.evaluate(() => /【翻译】/.test(document.querySelector('.hs-summary')?.textContent || ''));
  assert(translateOk, '切换「翻译」模式后重新请求并渲染');
  const sawTranslateCall = await page.evaluate(() => window.__hsCalls.some((c) => c.action === 'summarize' && c.mode === 'translate'));
  assert(sawTranslateCall, '翻译模式向 background 发送了 mode=translate 请求');

  // 5) 追问：输入问题并发送 → 渲染 Q/A
  await page.evaluate(() => {
    const t = document.getElementById('hover-summary-tooltip');
    t.querySelector('.hs-tab[data-mode="followup"]').click();
  });
  await waitFor(page, () => !!document.querySelector('.hs-input'));
  await page.evaluate(() => {
    const t = document.getElementById('hover-summary-tooltip');
    const input = t.querySelector('.hs-input');
    input.value = '这段话的核心论点是什么？';
    t.querySelector('.hs-send').click();
  });
  const qaOk = await waitFor(page, () => {
    const qa = document.querySelector('.hs-qa');
    return qa && /核心论点/.test(qa.textContent) && /【追问】/.test(qa.textContent);
  });
  assert(qaOk, '追问模式渲染出「问题 + 回答」');
  const sawFollowup = await page.evaluate(() => window.__hsCalls.some((c) => c.action === 'summarize' && c.mode === 'followup' && c.question));
  assert(sawFollowup, '追问向 background 发送了 mode=followup + question + history');

  log(failures === 0 ? '\n🎉 真实源码浏览器端到端测试全部通过' : `\n💥 有 ${failures} 项失败`);
} catch (e) {
  log('💥 测试异常: ' + e.message);
  failures++;
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
