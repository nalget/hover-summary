# Hover Summary — AI 悬停摘要

在任意网页划词或悬停链接，自动弹出 **AI 摘要浮窗**。支持 **摘要 / 要点 / 解释 / 翻译 / 追问** 五种模式，可切换多家模型，并对划词内容自动做「换皮检测」。

> 划词即懂，悬停即读 —— 不离开当前页面，信息密度拉满。

---

## ✨ 功能特性

- **五种阅读模式**
  - 📝 **摘要**（Summary）：一两句话概括核心
  - • **要点**（Key Points）：3–5 条关键要点
  - 💡 **解释**（Explain）：通俗讲解含义与重要性
  - 🌐 **翻译**（Translate）：中英互译（可指定输出语言）
  - ❓ **追问**（Ask）：基于原文继续提问，带上下文
- **多模型后端，自由切换**
  - ☁️ **Agnes**（`agnes-2.0-flash`，质量最佳，内置 Key 开箱即用）
  - ☁️ **NVIDIA NIM**（`gpt-oss-120b`，速度最快，内置 Key）
  - 🖥️ **本地 oMLX / LM Studio / Ollama / llama.cpp**（离线、隐私、免 Key，自动探测地址并列出模型）
  - 🌐 **公开大模型**（DeepSeek / 通义 / 混元 / 文心，免费 API Key）
  - 🤖 **Chrome 内置 Gemini Nano**（设备端、离线、免 Key；不可用时自动回退其他后端）
- **多语言输出**：中文 / English（默认）/ 日本語 / 한국어 / Français / Deutsch / Español / Русский
- **丝滑体验**
  - 悬停触发延迟可调（300–2000ms）
  - **气泡消失时间可调**（200–3000ms），离开链接/气泡后淡出，切换链接不闪烁
  - 模型返回后才弹气泡，不显示「加载中」占位
  - 划词（Select）、悬停（Hover）、Shift+悬停 三种触发模式
- **换皮检测**：悬停时并行检测是否「换皮改写」内容，提醒你小心信息失真
- **隐私友好**
  - 本地 oMLX / Chrome 内置模型：**文本不出本机**
  - 链接正文抓取走扩展后台，不注入第三方脚本

---

## 🚀 安装

### 开发者模式加载（本地）
1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择本项目根目录
4. 固定到工具栏，点开弹窗完成模型配置

### 从商店安装
（上架中）见 Chrome Web Store 搜索 **Hover Summary**。

---

## ⚙️ 配置说明

打开扩展弹窗：

1. **模型来源**：选 Agnes / NVIDIA / 本地 / 公开 / Chrome 内置
2. **本地模型**：切到该面板即自动探测本地服务（oMLX:8000 等），下拉选模型 → 点「✅ 确认并加载」只加载此模型，不预占内存
3. **Chrome 内置 AI**：切到该面板点「🔍 检查/下载」预载 Gemini Nano（需 Chrome 138+ 且开启实验 flag）
4. **输出语言**：默认 English，可切到中文等 8 种
5. **气泡消失时间**：建议 800ms，调大切换链接更顺滑
6. **悬停触发延迟 / 触发模式 / 换皮检测**：按需调整

---

## 🔧 本地模型（oMLX）示例

```bash
# 安装并启动 oMLX（任一支持 OpenAI 兼容协议的服务均可）
omlx serve --model-dir ~/.omlx/models --port 8000
```

扩展会自动探测 `http://127.0.0.1:8000` 并列出所有可用模型，无需手填地址。

---

## 📁 项目结构

```
hover-summary/
├── manifest.json          # MV3 清单
├── src/
│   ├── background.js      # Service Worker：模型路由 / 抓取 / Chrome 内置 AI 回退
│   ├── content.js         # 注入页面：触发检测 + 浮窗 UI
│   ├── popup.js/.html     # 设置弹窗
│   └── summary-modes.js   # 五种模式与多语言指令表
├── icons/                 # 16/48/128 图标
├── test/                  # puppeteer 端到端测试
├── README.md
├── CHANGELOG.md          # 版本历史（v1.4.0 → v1.4.9）
├── ROADMAP.md            # 拓展 / 完善路线图
├── PRIVACY.md             # 隐私政策（商店必填）
└── LICENSE
```

---

## 🧪 测试

```bash
node test/content-hover-e2e.mjs      # 悬停触发 / 链接抓取 / 切换不闪烁
node test/local-models-e2e.mjs       # 本地模型列表与预热
```

---

## 📜 许可证

MIT —— 见 [LICENSE](./LICENSE)
