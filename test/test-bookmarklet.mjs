// test/test-bookmarklet.mjs — 测试书签版本
import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function main() {
  console.log('=== 书签版本测试 ===\n');
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-first-run', '--user-data-dir=/tmp/hs-bm-test']
  });

  const page = await browser.newPage();
  
  // 测试 B站
  console.log('测试 B站视频页...');
  await page.goto('https://www.bilibili.com/video/BV1GJ411x7h7', { waitUntil: 'networkidle2', timeout: 30000 });
  
  page.on('console', msg => console.log('[page]', msg.text().substring(0, 100)));
  page.on('dialog', async dialog => {
    console.log('[dialog]', dialog.message());
    await dialog.accept();
  });

  // 注入书签代码
  const bookmarklet = (await import('fs')).readFileSync('/Users/vane/.qclaw/workspace/hover-summary/test/bookmarklet.js', 'utf-8');
  
  // 模拟 prompt 返回 API key
  await page.evaluateOnNewDocument(() => {
    window.prompt = () => '';
    window.alert = (msg) => console.log('[alert]', msg);
  });
  
  await page.evaluate(bookmarklet);
  await new Promise(r => setTimeout(r, 1000));
  
  // 模拟悬停到视频简介
  console.log('查找可悬停的文本元素...');
  const hasTooltip = await page.evaluate(() => {
    // 找一个有足够文字的元素
    const candidates = document.querySelectorAll('p, div, span, .video-desc, .reply-content');
    let found = null;
    for (const el of candidates) {
      const text = el.textContent?.trim();
      if (text && text.length >= 20 && text.length <= 2000) {
        found = { tag: el.tagName, text: text.substring(0, 50) };
        // 触发 mouseover
        const rect = el.getBoundingClientRect();
        const event = new MouseEvent('mouseover', {
          bubbles: true, cancelable: true, view: window,
          clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2
        });
        el.dispatchEvent(event);
        break;
      }
    }
    return found;
  });
  
  if (hasTooltip) {
    console.log('悬停目标:', hasTooltip.tag, hasTooltip.text);
  } else {
    console.log('❌ 没找到可悬停的文本元素');
  }

  // 等待结果
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const result = await page.evaluate(() => {
      const tip = document.querySelector('.hover-summary-tooltip');
      if (!tip) return { exists: false };
      return {
        exists: true,
        class: tip.className,
        body: tip.querySelector('.hs-body')?.textContent?.substring(0, 100)
      };
    });
    if (!result.exists && i > 2) {
      console.log(`[${i+1}s] 浮窗不存在`);
      break;
    } else if (result.exists && result.class.includes('hs-success')) {
      console.log(`[${i+1}s] ✅ 成功: ${result.body}`);
      break;
    } else if (result.exists && result.class.includes('hs-error')) {
      console.log(`[${i+1}s] ❌ 错误: ${result.body}`);
      break;
    } else if (result.exists) {
      console.log(`[${i+1}s] 加载中: ${result.body}`);
    }
  }

  await page.screenshot({ path: '/Users/vane/.qclaw/workspace/hover-summary/test/bili-result.png' });
  console.log('截图: test/bili-result.png');
  
  await browser.close();
  console.log('\n=== 测试完成 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
