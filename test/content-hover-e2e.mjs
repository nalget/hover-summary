// 针对性验证 content.js 悬停/弹气泡逻辑（注入真实源码 + mock chrome 运行时）
import puppeteer from '/Users/vane/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'fs';
import path from 'path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.resolve(process.cwd());
const contentSrc = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockConfig() {
  return {
    enabled: true,
    theme: 'auto',
    hoverDelay: 200,
    triggerMode: 'hover', // 关键：hover 模式
    maxLength: 2000,
    duplicateCheck: false,
    local: { endpoint: 'http://127.0.0.1:8000/v1/chat/completions', apiKey: '', model: 'Qwen2.5-0.5B-Instruct-4bit' },
    model: 'local',
  };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } }

async function runScenario(label, html, setup) {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  page.on('pageerror', (e) => console.log('  [PAGEERROR]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [CONSOLE.ERR]', m.text()); });

  await page.setContent(html, { waitUntil: 'load' });

  // 用 addScriptTag 在主世界注入 mock（与 content.js 共享 window）；
  // page.setContent 不触发 evaluateOnNewDocument，故改在此处注入。
  const cfg = mockConfig();
  const cfgJson = JSON.stringify(cfg);
  const mockSrc = `
    (function(){
      var cfg = ${cfgJson};
      var store = { hoverSummaryConfig: cfg };
      window.__log = [];
      document.documentElement.setAttribute('data-mock','1');
      window.HS_MODES = { SUMMARY_MODES: { summary: { icon:'💡', label:'摘要', desc:'一句话概括' } }, MODE_ORDER:['summary'] };
      function mkResp(msg){
        if (msg.action==='getConfig') return cfg;
        if (msg.action==='summarize') return { success:true, summary:'【模型返回的摘要】'+((msg.text)||'').slice(0,12), elapsed:0.25 };
        if (msg.action==='fetchPageContent') return { success:true, text:'抓取到的目标页正文内容很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长用于摘要。' };
        return { ok:true };
      }
      var mockChrome = {
        runtime: {
          id:'test-ext', lastError:null,
          sendMessage: function(msg, cb){
            window.__log.push(msg.action + (msg.text ? ':' + msg.text.length : ''));
            try { document.documentElement.setAttribute('data-hslog', window.__log.join(',')); } catch(e){}
            if (msg.action==='summarize') { setTimeout(function(){ cb(mkResp(msg)); }, 250); return; }
            cb(mkResp(msg));
          },
          onMessage: { addListener: function(){} }
        },
        storage: { sync: { get: function(k,cb){ cb(store); }, set: function(){}, onChanged: { addListener: function(){} } } }
      };
      window.__mock = mockChrome;
    })();
  `;
  await page.addScriptTag({ content: mockSrc });
  // 注入真实 content.js（把 chrome. 换成 window.__mock.，避免无法覆盖只读的 window.chrome）
  const patched = contentSrc.replace(/\bchrome\./g, 'window.__mock.');
  await page.addScriptTag({ content: patched });
  // 探针：确认 mock 是否进入主世界
  const dbg = await page.evaluate(() => ({
    mock: document.documentElement.getAttribute('data-mock') || '',
    hslog: document.documentElement.getAttribute('data-hslog') || '',
    hasRuntime: !!(window.chrome && window.chrome.runtime),
  }));
  console.log('  [DBG]', JSON.stringify(dbg));
  if (setup) await setup(page);
  return page;
}

// ── 场景 1：悬停链接 → 应弹气泡，且内容是模型返回（非“加载中”） ──
console.log('\n场景1: 悬停链接应弹气泡（模型返回才弹）');
{
  const html = `<a href="https://example.com" id="lk">这是一篇关于人工智能的报道文章，讲述最新进展。</a>
  <p id="txt">这是一段很长的正文内容，用于测试悬停是否会在普通文本上弹出气泡，按设计不应该弹。</p>`;
  const page = await runScenario('link', html);
  const box = await page.$eval('#lk', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  await page.mouse.move(cx, cy);
  // 探针：caretRangeFromPoint 解析到的元素
  const probe = await page.evaluate((x, y) => {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return 'caret=null';
    const n = r.startContainer;
    const el = n.nodeType === 3 ? n.parentElement : (n.closest ? n.closest('a') : null);
    return 'node=' + n.nodeName + ' resolvedTag=' + (el ? el.tagName : 'null');
  }, cx, cy);
  console.log('  探针:', probe, 'at', Math.round(cx), Math.round(cy));
  await sleep(900);
  const r1 = await page.evaluate(() => {
    const t = document.querySelector('#hover-summary-tooltip');
    return {
      log: document.documentElement.getAttribute('data-hslog') || '',
      exists: !!t,
      text: t ? (t.querySelector('.hs-summary') || {}).textContent : null,
    };
  });
  console.log('  sendMessage 调用:', r1.log);
  check('链接悬停后气泡出现', r1.exists);
  check('气泡内容来自模型返回（非“加载中”）', r1.exists && r1.text.includes('模型返回的摘要') && !r1.text.includes('AI 处理中'));
  await page.close();
}

// ── 场景 2：悬停普通文本 → 不应弹气泡 ──
console.log('\n场景2: 悬停普通文本不应弹气泡');
{
  const html = `<p id="txt">这是一段很长的正文内容，用于测试悬停是否会在普通文本上弹出气泡，按设计不应该弹。</p>
  <a href="https://example.com" id="lk">另一篇报道。</a>`;
  const page = await runScenario('text', html);
  await page.hover('#txt');
  await sleep(900);
  const r2 = await page.evaluate(() => !!document.querySelector('#hover-summary-tooltip'));
  check('普通文本悬停后无气泡', !r2);
  await page.close();
}

// ── 场景 3：滑过链接停在空白 → 不应弹气泡 ──
console.log('\n场景3: 滑过链接后停在空白处不应弹');
{
  const html = `<a href="https://example.com" id="lk">报道链接</a><div id="empty" style="height:300px;"></div>`;
  const page = await runScenario('slide', html);
  // 移到链接再快速移到下方空白处（鼠标离开链接）
  await page.hover('#lk');
  await sleep(120);
  await page.mouse.move(450, 600); // 空白区
  await sleep(900);
  const r3 = await page.evaluate(() => !!document.querySelector('#hover-summary-tooltip'));
  check('滑过链接停在空白后无气泡', !r3);
  await page.close();
}

// ── 场景 4：链接目标页正文超长（>2000 字）→ 仍应继承预取结果、单次请求 ──
// 回归用例：真实页面正文普遍 >2000 字，曾因 pf.text 被整页正文替换导致
// openBubble 匹配失败 → 二次请求 → 气泡卡“⏳ AI 处理中”一整轮模型耗时。
console.log('\n场景4: 抓取正文超长时不二次请求、直接显示模型结果');
{
  const html = `<a href="https://example.com/long" id="lk">这是一篇长文报道的链接锚文本。</a>`;
  const page = await runScenario('longfetch', html, async (p) => {
    // 覆写 mock：fetchPageContent 返回 5000 字长文
    await p.evaluate(() => {
      const orig = window.__mock.runtime.sendMessage;
      window.__mock.runtime.sendMessage = function (msg, cb) {
        if (msg.action === 'fetchPageContent') {
          window.__log.push(msg.action);
          document.documentElement.setAttribute('data-hslog', window.__log.join(','));
          cb({ success: true, text: '长'.repeat(5000) });
          return;
        }
        orig.call(this, msg, cb);
      };
    });
  });
  const box = await page.$eval('#lk', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
  await sleep(1100);
  const r4 = await page.evaluate(() => {
    const t = document.querySelector('#hover-summary-tooltip');
    return {
      log: document.documentElement.getAttribute('data-hslog') || '',
      exists: !!t,
      text: t ? (t.querySelector('.hs-summary') || {}).textContent : null,
    };
  });
  console.log('  sendMessage 调用:', r4.log);
  const summarizeCalls = (r4.log.match(/summarize/g) || []).length;
  check('气泡出现且内容来自模型（无“AI 处理中”卡顿）', r4.exists && r4.text && r4.text.includes('模型返回的摘要') && !r4.text.includes('AI 处理中'));
  check('仅发送一次 summarize（无二次请求）', summarizeCalls === 1);
  // 摘要源应为截断后的正文（2000 字）而非整页 5000 字
  check('摘要源已截断到 maxLength', /summarize:2000/.test(r4.log));
  await page.close();
}

await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
