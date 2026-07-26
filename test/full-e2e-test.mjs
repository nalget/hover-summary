// test/full-e2e-test.mjs — 完整端到端测试
// 不依赖 Chrome 扩展加载，直接注入 content.js 逻辑 + 模拟 background.js API 调用
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const AGNES_KEY = '';
const AGNES_ENDPOINT = 'https://apihub.agnes-ai.com/v1/chat/completions';
const AGNES_MODEL = 'agnes-2.0-flash';

function startTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>测试页</title>
<style>body{padding:40px;font-size:16px;line-height:1.8;max-width:800px;margin:0 auto;}</style>
</head><body>
<h1>AI 悬停摘要测试页</h1>
<p id="test-para">人工智能（Artificial Intelligence，简称 AI）是计算机科学的一个重要分支，致力于研究、开发用于模拟、延伸和扩展人类智能的理论、方法、技术及应用系统。人工智能的历史可以追溯到 1950 年代，当时图灵提出了著名的图灵测试。近年来，随着深度学习技术的突破，人工智能在自然语言处理、计算机视觉、语音识别等领域取得了显著进展。大语言模型如 GPT、BERT 等的出现，使得机器能够理解和生成人类语言，达到前所未有的水平。</p>
<p id="test-para2">区块链是一种分布式数据库技术，通过密码学方法将数据区块按照时间顺序连接成链条，确保数据不可篡改和伪造。它最早应用于比特币等加密货币系统，后来逐渐扩展到金融、供应链、医疗等多个领域。区块链的核心优势在于去中心化和透明性。</p>
</body></html>`);
    });
    server.listen(9877, () => resolve(server));
  });
}

async function main() {
  console.log('=== Hover Summary 完整端到端测试 ===\n');

  const server = await startTestServer();
  console.log('✅ 测试服务: http://localhost:9877');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check', '--user-data-dir=/tmp/hs-e2e-profile']
  });

  const page = await browser.newPage();
  
  // 收集 console
  page.on('console', msg => console.log('[page]', msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  await page.goto('http://localhost:9877', { waitUntil: 'networkidle0' });
  console.log('✅ 测试页已加载\n');

  // 读取 content.js 和 styles.css 源码
  const contentJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf-8');
  const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf-8');

  // 注入 CSS
  await page.addStyleTag({ content: stylesCss });

  // 注入一个模拟的 chrome.runtime API
  // 因为 content.js 依赖 chrome.runtime.sendMessage / chrome.storage
  await page.evaluate((agnesKey, agnesEndpoint, agnesModel) => {
    // 模拟 chrome API
    window.__hsConfig = {
      model: 'agnes',
      agnes: { endpoint: agnesEndpoint, apiKey: agnesKey, model: agnesModel },
      hoverDelay: 500,
      triggerMode: 'hover'
    };

    // 模拟 chrome.runtime.sendMessage
    window.chrome = window.chrome || {};
    window.chrome.runtime = {
      sendMessage: (msg, callback) => {
        if (msg.action === 'getConfig') {
          callback(window.__hsConfig);
          return;
        }
        if (msg.action === 'summarize') {
          // 直接调用 Agnes API
          const cfg = window.__hsConfig.agnes;
          const start = performance.now();
          fetch(cfg.endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: cfg.model,
              messages: [{ role: 'user', content: `请用一两句话简洁地总结以下内容：\n\n${msg.text}` }],
              max_tokens: 128,
              temperature: 0.5,
              stream: false
            })
          }).then(r => r.json()).then(data => {
            const elapsed = ((performance.now() - start) / 1000).toFixed(2);
            const summary = data.choices?.[0]?.message?.content?.trim() || '(空)';
            callback({ success: true, summary, elapsed: parseFloat(elapsed) });
          }).catch(e => {
            callback({ success: false, error: e.message });
          });
          return true;
        }
      },
      lastError: null
    };
    window.chrome.storage = {
      sync: { get: (k, cb) => cb({}) },
      onChanged: { addListener: () => {} }
    };
  }, AGNES_KEY, AGNES_ENDPOINT, AGNES_MODEL);

  // 注入 content.js（去掉 IIFE 如果有）
  await page.evaluate(contentJs);

  console.log('✅ content.js 已注入\n');

  // 测试 1: 模拟悬停到段落
  console.log('--- 测试 1: 悬停段落 #test-para ---');
  const para = await page.$('#test-para');
  const box = await para.boundingBox();
  
  // 移动鼠标到段落
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  console.log(`鼠标移动到 (${box.x + box.width/2}, ${box.y + box.height/2})`);

  // 等待悬停延迟 + API 调用
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const result = await page.evaluate(() => {
      const tip = document.getElementById('hover-summary-tooltip');
      if (!tip) return { exists: false };
      return {
        exists: true,
        class: tip.className,
        body: tip.querySelector('.hs-body')?.textContent?.substring(0, 120)
      };
    });
    if (!result.exists) {
      console.log(`[${i+1}s] 浮窗不存在`);
      if (i >= 2) break;
    } else if (result.class.includes('hs-success')) {
      console.log(`[${i+1}s] ✅ 成功! 摘要: ${result.body}`);
      break;
    } else if (result.class.includes('hs-error')) {
      console.log(`[${i+1}s] ❌ 错误: ${result.body}`);
      break;
    } else {
      console.log(`[${i+1}s] 加载中... ${result.body}`);
    }
  }

  // 截图
  await page.screenshot({ path: path.join(__dirname, 'e2e-result.png') });
  console.log('\n截图: test/e2e-result.png');

  // 测试 2: 直接调用 API 确认链路
  console.log('\n--- 测试 2: 直接 API 调用 ---');
  const apiResult = await page.evaluate(async (endpoint, key, model) => {
    const start = performance.now();
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '请用一句话总结：人工智能是计算机科学的分支。' }],
          max_tokens: 64,
          temperature: 0.5,
          stream: false
        })
      });
      const elapsed = ((performance.now() - start) / 1000).toFixed(2);
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, elapsed, summary: data.choices?.[0]?.message?.content, error: data.error };
    } catch(e) {
      return { ok: false, error: e.message, elapsed: ((performance.now() - start) / 1000).toFixed(2) };
    }
  }, AGNES_ENDPOINT, AGNES_KEY, AGNES_MODEL);
  console.log('API 结果:', JSON.stringify(apiResult, null, 2));

  await browser.close();
  server.close();
  console.log('\n=== 测试完成 ===');
}

main().catch(e => {
  console.error('测试出错:', e);
  process.exit(1);
});
