// chrome-ai-bridge.js — 主世界（MAIN world）桥接脚本
// Chrome 内置 AI（Prompt API / Summarizer）属于“内置 AI API”，
// 按官方文档无法在 Web Worker / 扩展 Service Worker 中使用，
// 只能在顶级窗口或页面主世界访问。本脚本以 world:'MAIN' 注入，
// 因此能访问 window.LanguageModel / window.Summarizer。
// 后台 Service Worker 通过 chrome.tabs.sendMessage({action:'chromeAiCall'}) 调用本脚本。

(function () {
  if (!chrome.runtime || !chrome.runtime.onMessage) return;

  async function callChromeAI(payload) {
    const { mode, text, messages, question, history } = payload || {};
    const start = performance.now();
    const LM = window.LanguageModel;
    const Sum = window.Summarizer;

    // 摘要 / 要点 → 专用 Summarizer API（质量与速度优于通用 Prompt）
    if ((mode === 'summary' || mode === 'points') && Sum) {
      const type = mode === 'summary' ? 'tldr' : 'key-points';
      const opts = { type, format: 'markdown', length: 'medium' };
      let availability;
      try {
        availability = await Sum.availability(opts).catch(() => 'unavailable');
      } catch (e) {
        availability = 'unavailable';
      }
      // 仅当浏览器已自带模型（ready/available）时才使用；本扩展绝不引导下载 1.5GB 模型
      if (availability !== 'ready' && availability !== 'available') {
        const e = new Error('Summarizer 不可用（浏览器未自带该模型；本扩展不引导下载，请在设置切换其它模型来源）');
        e.code = 'NO_CHROME_AI';
        throw e;
      }
      let summarizer;
      try {
        summarizer = await Sum.create({
          ...opts,
          monitor(m) { m.addEventListener('downloadprogress', () => {}); }
        });
      } catch (e) {
        const err = new Error('创建 Summarizer 失败：' + e.message);
        err.code = 'NO_CHROME_AI';
        throw err;
      }
      const out = await summarizer.summarize(text).catch((e) => {
        throw new Error('Summarizer 推理失败：' + e.message);
      });
      if (summarizer.destroy) summarizer.destroy();
      const elapsed = parseFloat(((performance.now() - start) / 1000).toFixed(2));
      return { summary: (out || '').trim(), elapsed };
    }

    // 解释 / 翻译 / 追问 → 通用 Prompt API（LanguageModel）
    if (!LM) {
      const e = new Error('此页面主世界未暴露 LanguageModel（Chrome <138 或未开 flag）');
      e.code = 'NO_CHROME_AI';
      throw e;
    }
    let availability;
    try {
      availability = await LM.availability().catch(() => 'unavailable');
    } catch (e) {
      availability = 'unavailable';
    }
    // 仅当浏览器已自带模型（ready/available）时才使用；本扩展绝不引导下载
    if (availability !== 'ready' && availability !== 'available') {
      const e = new Error('LanguageModel 不可用（浏览器未自带该模型；本扩展不引导下载，请在设置切换其它模型来源）');
      e.code = 'NO_CHROME_AI';
      throw e;
    }
    let session;
    try {
      session = await LM.create({
        systemPrompt: (messages && messages[0] && messages[0].content) || '你是一个简洁的阅读助手。',
        monitor(m) { m.addEventListener('downloadprogress', () => {}); }
      });
    } catch (e) {
      const err = new Error('创建 LanguageModel 失败：' + e.message);
      err.code = 'NO_CHROME_AI';
      throw err;
    }
    // 把多轮（追问含原文/历史）拼成单次 prompt 发给会话
    const promptText = (messages || []).slice(1).map((m) => m.content).join('\n');
    const out = await session.prompt(promptText || question || '').catch((e) => {
      throw new Error('Prompt 推理失败：' + e.message);
    });
    if (session.destroy) session.destroy();
    const elapsed = parseFloat(((performance.now() - start) / 1000).toFixed(2));
    return { summary: (out || '').trim(), elapsed };
  }

  // 仅查询可用性（不下载）：供弹窗“检查”按钮使用
  async function getChromeAIAvailability() {
    const Sum = window.Summarizer, LM = window.LanguageModel;
    const out = { summarizer: 'n/a', languageModel: 'n/a' };
    if (Sum) {
      try {
        out.summarizer = await Sum.availability({ type: 'tldr', format: 'markdown', length: 'short' }).catch(() => 'unavailable');
      } catch (e) { out.summarizer = 'unavailable'; }
    }
    if (LM) {
      try {
        out.languageModel = await LM.availability().catch(() => 'unavailable');
      } catch (e) { out.languageModel = 'unavailable'; }
    }
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'chromeAiCall') {
      callChromeAI(msg.payload)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ error: e.message, code: e.code || 'NO_CHROME_AI' }));
      return true; // 异步响应
    }
    if (msg && msg.action === 'chromeAiAvailability') {
      getChromeAIAvailability()
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ error: e.message, code: e.code || 'NO_CHROME_AI' }));
      return true;
    }
    // 注意：本扩展已移除“下载”入口——Chrome 内置模型需浏览器自带（ready）才可用，
    // 不引导用户下载约 1.5GB 设备端模型。‘chromeAiDownload’ 动作不再处理。
  });
})();
