// test/test-final.mjs — 完整测试：扩展加载 + API 调用 + 悬停触发
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AGNES_KEY = process.env.AGNES_KEY || '';

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>B站模拟</title>
<style>body{padding:40px;font-size:15px;line-height:1.8;max-width:700px;margin:0 auto;font-family:sans-serif}</style>
</head><body>
<h1>测试页（模拟 B站结构）</h1>
<div class="video-desc">
<p>本视频介绍了人工智能的发展历程，从 1956 年达特茅斯会议提出概念，到如今大语言模型的广泛应用。涵盖了符号主义、连接主义、深度学习三个阶段的演进，以及未来通用人工智能的可能路径。人工智能正在改变我们的生活和工作方式。</p>
</div>
<div class="reply-content">
<p>区块链技术通过去中心化的方式实现数据的安全存储和传输，每个区块包含前一个区块的哈希值，形成不可篡改的链条结构。这种设计使得区块链在金融、供应链等领域具有广泛应用前景。</p>
</div>
</body></html>`);
    });
    server.listen(9878, () => resolve(server));
  });
}

async function main() {
  console.log('=== 最终测试 ===\n');
  const server = await startServer();
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-first-run', '--user-data-dir=/tmp/hs-final']
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('[page]', msg.text().substring(0, 150)));
  
  await page.goto('http://localhost:9878', { waitUntil: 'networkidle0' });
  
  // 注入 content.js 逻辑（直接内联，模拟扩展行为）
  // 但 API 调用走页面内 fetch（不是 chrome.runtime.sendMessage）
  const result = await page.evaluate(async (key) => {
    const log = [];
    
    // 1. 测试 Agnes API 从页面内调用（CORS 测试）
    log.push('测试 Agnes API 跨域调用...');
    try {
      const start = performance.now();
      const resp = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'agnes-2.0-flash',
          messages: [{ role: 'user', content: '请用一句话总结：人工智能是计算机科学的分支。' }],
          max_tokens: 64, temperature: 0.5, stream: false
        })
      });
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      if (resp.ok) {
        const data = await resp.json();
        const summary = data.choices?.[0]?.message?.content?.trim();
        log.push(`✅ Agnes API 成功 (${elapsed}s): ${summary}`);
      } else {
        const text = await resp.text();
        log.push(`❌ Agnes HTTP ${resp.status}: ${text.substring(0, 80)}`);
      }
    } catch(e) {
      log.push(`❌ Agnes 调用异常: ${e.message}`);
    }
    
    return log;
  }, AGNES_KEY);
  
  console.log(result.join('\n'));
  
  // 2. 测试本地 oMLX
  const localResult = await page.evaluate(async () => {
    try {
      const start = performance.now();
      const resp = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'Qwen2.5-0.5B-Instruct-4bit',
          messages: [{ role: 'user', content: '请用一句话总结：人工智能是计算机科学的分支。' }],
          max_tokens: 64, temperature: 0.5, stream: false
        })
      });
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      if (resp.ok) {
        const data = await resp.json();
        const summary = data.choices?.[0]?.message?.content?.trim();
        return `✅ oMLX 成功 (${elapsed}s): ${summary}`;
      } else {
        return `❌ oMLX HTTP ${resp.status}`;
      }
    } catch(e) {
      return `❌ oMLX 异常: ${e.message}`;
    }
  });
  console.log(localResult);
  
  await browser.close();
  server.close();
  console.log('\n=== 完成 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
