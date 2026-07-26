// test/e2e-hover.mjs
// 真实浏览器（headless）验证「悬停」触发的基础功能 + 菜单（5 模式 + 追问）：
//   A. 悬停真实文字段落 → 应呼出
//   B. 悬停链接文字 → 应呼出（修复：之前 <a> 被排除）
//   C. 悬停留白（块间缝隙）→ 不应呼出（修复：之前会抓整个容器/整页）
//   D. 呼出后逐一验证 5 个模式 tab + 追问
// 运行：先在 test/ 起 http server，再 `node test/e2e-hover.mjs`

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

async function waitFor(page, fn, timeout = 4000, ...args) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn, ...args)) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function centerOf(page, selector) {
  const box = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}
async function closeBubble(page) {
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const t = document.getElementById('hover-summary-tooltip');
    if (t) t.remove();
  });
  await sleep(300);
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
  await page.setViewport({ width: 1000, height: 2000 }); // 确保含链接的测试块在视口内
  page.on('pageerror', (e) => log('   [pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') log('   [page console error] ' + m.text()); });

  await page.evaluateOnNewDocument(() => {
    window.__hsCalls = [];
    const cfg = {
      enabled: true, theme: 'auto', hoverDelay: 800, triggerMode: 'hover', // 关键：悬停模式
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
      storage: { sync: { get: (k, cb) => cb({}), set: () => {}, onChanged: { addListener: () => {} } }, onChanged: { addListener: () => {} } },
      tabs: { query: (o, cb) => cb([]), sendMessage: () => {} }
    };
  });

  await page.goto('about:blank');
  await sleep(150);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(300);
  await page.addScriptTag({ content: summaryModes });
  await page.addScriptTag({ content: contentJs });
  await sleep(200);

  log('— 基础功能：悬停触发目标 —');

  // A. 悬停真实文字段落 → 应呼出
  const p1 = await centerOf(page, '.test-block:nth-of-type(1) p');
  await page.mouse.move(p1.x, p1.y, { steps: 4 });
  const aOk = await waitFor(page, () => !!document.getElementById('hover-summary-tooltip'));
  assert(aOk, 'A. 悬停段落文字 → 呼出浮窗');
  if (aOk) {
    const txt = await page.evaluate(() => document.querySelector('.hs-summary')?.textContent || '');
    assert(/【摘要】/.test(txt), 'A. 浮窗渲染出摘要内容');
  }
  await closeBubble(page);

  // B. 悬停链接文字 → 应呼出（修复点）
  const link = await centerOf(page, '.test-block a');
  await page.mouse.move(link.x, link.y, { steps: 4 });
  const bOk = await waitFor(page, () => !!document.getElementById('hover-summary-tooltip'));
  assert(bOk, 'B. 悬停链接文字 → 呼出浮窗（修复：<a> 不再被排除）');
  await closeBubble(page);

  // C. 悬停块间缝隙（无文字）→ 不应呼出（修复点）
  // 用 steps:1 单次跳转，避免插值路径穿过文字块而误触发
  await page.mouse.move(10, 10, { steps: 1 });
  const gap = await page.evaluate(() => {
    const bs = document.querySelectorAll('.test-block');
    const r1 = bs[0].getBoundingClientRect();
    const r2 = bs[1].getBoundingClientRect();
    return { x: r1.x + 20, y: (r1.bottom + r2.top) / 2 };
  });
  await page.mouse.move(gap.x, gap.y, { steps: 1 });
  await sleep(1600); // 超过 hoverDelay(800) + 余量
  const cNoBubble = !(await page.evaluate(() => !!document.getElementById('hover-summary-tooltip')));
  assert(cNoBubble, 'C. 悬停留白（块间缝隙）→ 不呼出（修复：不再抓整个容器）');
  await page.mouse.move(10, 10, { steps: 1 }); // 移开，避免误触发
  await sleep(200);

  log('— 菜单功能：5 模式 + 追问逐一验证 —');

  // 重新悬停段落呼出，然后逐项切模式
  await page.mouse.move(p1.x, p1.y, { steps: 4 });
  const openOk = await waitFor(page, () => !!document.getElementById('hover-summary-tooltip'));
  assert(openOk, 'D0. 重新呼出浮窗用于菜单测试');
  if (!openOk) throw new Error('无法呼出浮窗，终止菜单测试');
  await sleep(300);

  const tabInfo = await page.evaluate(() => {
    const t = document.getElementById('hover-summary-tooltip');
    const tabs = [...t.querySelectorAll('.hs-tab')];
    return { count: tabs.length, modes: tabs.map((b) => b.dataset.mode) };
  });
  assert(tabInfo.count === 5, `D1. 含 5 个模式 tab（实际 ${tabInfo.count}）`);
  assert(JSON.stringify(tabInfo.modes) === JSON.stringify(['summary', 'points', 'explain', 'translate', 'followup']), 'D2. 模式顺序正确');

  const modeTags = { points: '要点', explain: '解释', translate: '翻译' };
  for (const mode of ['points', 'explain', 'translate']) {
    const want = modeTags[mode];
    await page.evaluate((m) => {
      document.querySelector(`.hs-tab[data-mode="${m}"]`).click();
    }, mode);
    const ok = await waitFor(page, (w) => {
      const el = document.querySelector('.hs-summary');
      return el && new RegExp('【' + w + '】').test(el.textContent);
    }, 4000, want);
    assert(ok, `D3. 切换到「${want}」模式并渲染`);
  }

  // 追问
  await page.evaluate(() => document.querySelector('.hs-tab[data-mode="followup"]').click());
  const fOk = await waitFor(page, () => !!document.querySelector('.hs-input'));
  assert(fOk, 'D4. 进入追问模式出现输入框');
  await page.evaluate(() => {
    const t = document.getElementById('hover-summary-tooltip');
    t.querySelector('.hs-input').value = '这段话的核心论点是什么？';
    t.querySelector('.hs-send').click();
  });
  const qaOk = await waitFor(page, () => {
    const qa = document.querySelector('.hs-qa');
    return qa && /核心论点/.test(qa.textContent) && /【追问】/.test(qa.textContent);
  });
  assert(qaOk, 'D5. 追问渲染出「问题 + 回答」');

  log(failures === 0 ? '\n🎉 悬停基础功能 + 菜单功能全部通过' : `\n💥 有 ${failures} 项失败`);
} catch (e) {
  log('💥 测试异常: ' + e.message);
  failures++;
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
