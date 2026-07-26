// test/test-userscript.mjs — 测试 Tampermonkey 用户脚本
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AGNES_KEY = '';

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>测试</title>
<style>body{padding:40px;font-size:15px;line-height:1.8;max-width:700px;margin:0 auto}</style>
</head><body>
<h1>AI 悬停摘要测试</h1>
<p id="p1">人工智能（AI）是计算机科学的一个重要分支，致力于研究、开发用于模拟、延伸和扩展人类智能的理论、方法、技术及应用系统。人工智能的历史可以追溯到1950年代，当时图灵提出了著名的图灵测试。近年来，随着深度学习技术的突破，人工智能在自然语言处理、计算机视觉、语音识别等领域取得了显著进展。大语言模型如GPT、BERT等的出现，使得机器能够理解和生成人类语言，达到前所未有的水平。</p>
<p id="p2">区块链是一种分布式数据库技术，通过密码学方法将数据区块按照时间顺序连接成链条，确保数据不可篡改和伪造。它最早应用于比特币等加密货币系统，后来逐渐扩展到金融、供应链、医疗等多个领域。</p>
</body></html>`);
    });
    server.listen(9879, () => resolve(server));
  });
}

// 模拟 GM API
function injectGMShim(page, apiKey) {
  return page.evaluateOnNewDocument((key) => {
    const store = {
      hoverSummaryConfig: {
        model: 'agnes',
        agnes: { endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions', apiKey: key, model: 'agnes-2.0-flash' },
        nvidia: { endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', apiKey: '', model: 'google/gemma-2-2b-it' },
        local: { endpoint: 'http://127.0.0.1:8000/v1/chat/completions', apiKey: '', model: 'Qwen2.5-0.5B-Instruct-4bit' },
        hoverDelay: 500, triggerMode: 'hover'
      }
    };
    
    window.GM_getValue = (k, def) => store[k] ?? def;
    window.GM_setValue = (k, v) => { store[k] = v; };
    
    // GM_xmlhttpRequest — 用 fetch 实现（测试环境允许跨域）
    window.GM_xmlhttpRequest = function(opts) {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), opts.timeout || 15000);
      
      fetch(opts.url, {
        method: opts.method || 'GET',
        headers: opts.headers || {},
        body: opts.data || undefined,
        signal: controller.signal
      }).then(async resp => {
        const text = await resp.text();
        clearTimeout(tid);
        opts.onload({ responseText: text, status: resp.status });
      }).catch(err => {
        clearTimeout(tid);
        if (err.name === 'AbortError') opts.ontimeout();
        else opts.onerror({ error: err.message });
      });
    };
  }, apiKey);
}

async function main() {
  console.log('=== 用户脚本测试 ===\n');
  const server = await startServer();
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-first-run', '--user-data-dir=/tmp/hs-us-test']
  });

  const page = await browser.newPage();
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('Hover') || t.includes('summar') || t.includes('HS')) console.log('[page]', t);
  });

  // 注入 GM shim
  await injectGMShim(page, AGNES_KEY);

  // 注入用户脚本
  const script = fs.readFileSync(path.join(__dirname, '..', 'hover-summary.user.js'), 'utf-8');
  // 去掉 UserScript 头部
  const code = script.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');
  
  await page.goto('http://localhost:9879', { waitUntil: 'networkidle0' });
  await page.evaluate(code);
  console.log('✅ 脚本已注入\n');

  // 测试悬停
  console.log('模拟悬停 #p1...');
  const para = await page.$('#p1');
  const box = await para.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const result = await page.evaluate(() => {
      const tip = document.querySelector('.hover-summary-tooltip');
      if (!tip) return { exists: false };
      return {
        exists: true,
        class: tip.className,
        body: tip.querySelector('.hs-body')?.textContent?.substring(0, 120)
      };
    });
    if (!result.exists && i >= 2) {
      console.log(`[${i+1}s] 浮窗不存在`);
      break;
    } else if (result.exists && result.class.includes('hs-success')) {
      console.log(`[${i+1}s] ✅ 成功: ${result.body}`);
      break;
    } else if (result.exists && result.class.includes('hs-error')) {
      console.log(`[${i+1}s] ❌ 错误: ${result.body}`);
      break;
    } else if (result.exists) {
      console.log(`[${i+1}s] ${result.body}`);
    }
  }

  // 测试第二段
  console.log('\n模拟悬停 #p2...');
  await page.mouse.move(50, 50);  // 先移开
  await new Promise(r => setTimeout(r, 500));
  const para2 = await page.$('#p2');
  const box2 = await para2.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const result = await page.evaluate(() => {
      const tip = document.querySelector('.hover-summary-tooltip');
      if (!tip) return { exists: false };
      return {
        class: tip.className,
        body: tip.querySelector('.hs-body')?.textContent?.substring(0, 120)
      };
    });
    if (!result.exists && i >= 2) {
      console.log(`[${i+1}s] 浮窗不存在`);
      break;
    } else if (result.exists && result.class.includes('hs-success')) {
      console.log(`[${i+1}s] ✅ 成功: ${result.body}`);
      break;
    } else if (result.exists && result.class.includes('hs-error')) {
      console.log(`[${i+1}s] ❌ 错误: ${result.body}`);
      break;
    } else if (result.exists) {
      console.log(`[${i+1}s] ${result.body}`);
    }
  }

  await page.screenshot({ path: path.join(__dirname, 'userscript-result.png') });
  console.log('\n截图: test/userscript-result.png');
  
  await browser.close();
  server.close();
  console.log('\n=== 完成 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
