/*
 * unit.cjs — 对核心逻辑（summary-modes.js）做纯函数单测，无需浏览器。
 * 运行：node test/unit.cjs
 */
const assert = require('assert');
const { SUMMARY_MODES, MODE_ORDER, detectLang, buildMessages } = require('../src/summary-modes.js');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (e) {
    console.error('  ❌ ' + name + '\n     ' + e.message);
    process.exitCode = 1;
  }
}

console.log('summary-modes 单测');

check('五种模式齐全且顺序正确', () => {
  assert.deepStrictEqual(MODE_ORDER, ['summary', 'points', 'explain', 'translate', 'followup']);
  for (const m of MODE_ORDER) assert.ok(SUMMARY_MODES[m], '缺少模式 ' + m);
});

check('detectLang 能区分中英文', () => {
  assert.strictEqual(detectLang('这是一段中文内容用于测试'), 'zh');
  assert.strictEqual(detectLang('This is an English paragraph for testing purposes only.'), 'en');
});

check('summary 模式（中文）生成简洁指令且不带列表', () => {
  const { messages, maxTokens, temperature } = buildMessages('summary', '这是一段关于AI的中文内容');
  assert.strictEqual(messages.length, 2);
  assert.ok(messages[1].content.includes('概括'));
  assert.ok(!messages[1].content.includes('- '));
  assert.ok(maxTokens > 0 && temperature >= 0);
});

check('points 模式要求分点列出', () => {
  const { messages } = buildMessages('points', '一段需要提取要点的内容');
  assert.ok(messages[1].content.includes('- '), '要点模式应要求以「- 」分点');
});

check('translate 模式：中文原文→译英，英文原文→译中', () => {
  const zh = buildMessages('translate', '这是中文需要翻译成英文');
  assert.ok(zh.messages[1].content.includes('英文'), '中文应译为英文');
  const en = buildMessages('translate', 'This English text should be translated to Chinese');
  assert.ok(en.messages[1].content.includes('简体中文'), '英文应译为中文');
});

check('followup 模式携带原文与历史', () => {
  const history = [{ q: '第一问', a: '第一答' }];
  const { messages } = buildMessages('followup', '原始长文本', { question: '第二问？', history });
  // system + 原文 + 1 历史轮(2条) + 当前问题 = 5
  assert.strictEqual(messages.length, 5);
  assert.ok(messages[1].content.includes('原始长文本'), '应注入原文');
  assert.ok(messages.some((m) => m.content === '第一问'));
  assert.ok(messages.some((m) => m.content === '第一答'));
  assert.strictEqual(messages[messages.length - 1].content, '第二问？');
});

check('未知模式回退到 summary', () => {
  const { messages } = buildMessages('bogus', '内容');
  assert.ok(messages[1].content.includes('概括'));
});

check('英文文本不产生中文指令（同语言响应）', () => {
  const { messages } = buildMessages('summary', 'A short English text to summarize.');
  assert.ok(messages[1].content.toLowerCase().includes('summarize'), '英文应使用英文指令');
});

console.log('\n通过 ' + passed + ' 项');
