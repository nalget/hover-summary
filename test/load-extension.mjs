// test/load-extension.mjs — 用真实 Chrome 加载扩展并测试
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '..');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 启动测试页 HTTP 服务
function startTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>测试页</title></head>
<body style="padding:40px;font-size:16px;line-height:1.8;">
<h1>AI 悬停摘要测试页</h1>
<p id="test-para">人工智能（Artificial Intelligence，简称 AI）是计算机科学的一个重要分支，致力于研究、开发用于模拟、延伸和扩展人类智能的理论、方法、技术及应用系统。人工智能的历史可以追溯到 1950 年代，当时图灵提出了著名的图灵测试。近年来，随着深度学习技术的突破，人工智能在自然语言处理、计算机视觉、语音识别等领域取得了显著进展。大语言模型如 GPT、BERT 等的出现，使得机器能够理解和生成人类语言，达到前所未有的水平。</p>
<p>另一个段落：区块链是一种分布式数据库技术，通过密码学方法将数据区块按照时间顺序连接成链条，确保数据不可篡改和伪造。它最早应用于比特币等加密货币系统，后来逐渐扩展到金融、供应链、医疗等多个领域。</p>
</body></html>`);
    });
    server.listen(9876, () => resolve(server));
  });
}

async function main() {
  console.log('=== Hover Summary 扩展自动化测试 ===\n');

  // 1. 启动测试服务
  const server = await startTestServer();
  console.log('✅ 测试页服务: http://localhost:9876');

  // 2. 启动 Chrome，加载扩展
  console.log('启动 Chrome 并加载扩展...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,  // 有头模式，可以看到
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=/tmp/hs-test-profile'
    ],
    defaultViewport: null
  });

  // 等待扩展加载
  await new Promise(r => setTimeout(r, 3000));

  // 3. 获取扩展 Service Worker
  const targets = browser.targets();
  const swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension'));
  if (!swTarget) {
    console.log('可用 targets:', targets.map(t => `${t.type()}: ${t.url()}`));
    // 尝试等待
    await new Promise(r => setTimeout(r, 5000));
  }
  
  let swWorker = null;
  if (swTarget) {
    swWorker = await swTarget.worker();
    console.log('✅ Service Worker 已连接:', swTarget.url().substring(0, 60));
  } else {
    console.log('⚠️ 未找到 Service Worker，继续测试...');
  }

  // 4. 打开测试页
  const page = await browser.newPage();
  await page.goto('http://localhost:9876', { waitUntil: 'networkidle0' });
  console.log('✅ 测试页已打开');

  // 5. 注入配置（直接写 storage）
  // 先通过 SW 设置配置
  if (swWorker) {
    await swWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        hoverSummaryConfig: {
          model: 'agnes',
          agnes: {
            endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions',
            apiKey: '',
            model: 'agnes-2.0-flash'
          },
          hoverDelay: 500,
          triggerMode: 'hover'
        }
      });
      console.log('配置已写入 storage');
    });
    console.log('✅ API 配置已注入');
  }

  // 6. 监听 console 消息
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('hover') || text.includes('summar') || text.includes('error') || text.includes('HS')) {
      console.log('[页面 console]', text);
    }
  });

  // 7. 模拟悬停
  console.log('\n模拟悬停到测试段落...');
  const paragraph = await page.$('#test-para');
  if (!paragraph) {
    console.log('❌ 找不到测试段落');
    await browser.close();
    server.close();
    return;
  }

  const box = await paragraph.boundingBox();
  console.log('段落位置:', box);

  // 移动鼠标到段落中心
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  console.log('鼠标已移动到段落，等待悬停触发（800ms）...');

  // 等待浮窗出现
  await new Promise(r => setTimeout(r, 2000));

  // 检查浮窗
  const tooltip = await page.$('#hover-summary-tooltip');
  if (!tooltip) {
    console.log('❌ 浮窗未出现');
    
    // 调试：检查 content script 是否注入
    const hsLoaded = await page.evaluate(() => window.__hoverSummaryLoaded);
    console.log('content script 已加载:', hsLoaded);
    
    // 手动触发 mouseover
    console.log('尝试手动触发 mouseover 事件...');
    await page.evaluate(() => {
      const p = document.getElementById('test-para');
      const event = new MouseEvent('mouseover', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: 100,
        clientY: 100
      });
      p.dispatchEvent(event);
    });
    await new Promise(r => setTimeout(r, 3000));
    
    const tooltip2 = await page.$('#hover-summary-tooltip');
    console.log('手动触发后浮窗:', tooltip2 ? '已出现' : '未出现');
  } else {
    const state = await tooltip.evaluate(el => el.className);
    const text = await tooltip.evaluate(el => el.querySelector('.hs-body')?.textContent);
    console.log('✅ 浮窗已出现!');
    console.log('状态:', state);
    console.log('内容:', text);
  }

  // 等待 API 响应
  console.log('\n等待 API 响应（最多 15s）...');
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const tip = await page.$('#hover-summary-tooltip');
    if (!tip) { console.log(`[${i+1}s] 浮窗消失`); break; }
    const cls = await tip.evaluate(el => el.className);
    if (cls.includes('hs-success') || cls.includes('hs-error')) {
      const body = await tip.evaluate(el => el.querySelector('.hs-body')?.textContent);
      console.log(`[${i+1}s] ✅ 结果:`, cls, body?.substring(0, 100));
      break;
    }
    console.log(`[${i+1}s] 仍在加载... (${cls})`);
  }

  // 截图
  await page.screenshot({ path: path.join(__dirname, 'test-result.png') });
  console.log('\n截图已保存: test/test-result.png');

  await browser.close();
  server.close();
  console.log('\n=== 测试完成 ===');
}

main().catch(e => {
  console.error('测试出错:', e);
  process.exit(1);
});
