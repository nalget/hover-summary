# Chrome Web Store 上架文案

> 用于提交 Chrome Web Store 的商品详情页。中文 / 英文双语。

## 基本信息

- **名称（中文）**：Hover Summary — AI 悬停摘要
- **名称（英文）**：Hover Summary — AI Hover Summarizer
- **类别**：生产力 / 资料阅读
- **语言**：简体中文、English（界面与输出均支持 8 种语言）
- **版本**：1.4.0

## 一句话简介（English）

> Summarize, extract key points, explain, translate, or ask follow-up questions on any selected text or hovered link — without leaving the page.

## 详细描述（中文）

**Hover Summary** 让你在任意网页划词或悬停链接时，自动弹出 **AI 摘要浮窗**。

### 五种阅读模式
- 📝 摘要：一两句话概括核心
- • 要点：3–5 条关键要点
- 💡 解释：通俗讲解含义与重要性
- 🌐 翻译：中英互译（可指定输出语言）
- ❓ 追问：基于原文继续提问，带上下文

### 多模型后端，自由切换
- ☁️ Agnes（开箱即用，质量最佳）
- ☁️ NVIDIA NIM（速度最快）
- 🖥️ 本地模型 oMLX / LM Studio / Ollama（离线、隐私、自动探测）
- 🌐 公开大模型 DeepSeek / 通义 / 混元 / 文心
- 🤖 Chrome 内置 Gemini Nano（设备端、免 Key，自动回退）

### 丝滑与隐私
- 气泡消失时间可调，切换链接不闪烁
- 模型返回后才弹，无「加载中」占位
- 本地 / 设备端后端文本不出本机
- 悬停自动检测「换皮内容」

## 详细描述（English）

**Hover Summary** shows an AI summary popup the moment you select text or hover a link — no tab switching, no copy-paste.

### Five reading modes
- 📝 Summary · • Key Points · 💡 Explain · 🌐 Translate · ❓ Ask (follow-up with context)

### Pluggable backends
- ☁️ Agnes (best quality, built-in key)
- ☁️ NVIDIA NIM (fastest)
- 🖥️ Local oMLX / LM Studio / Ollama (offline, private, auto-detect)
- 🌐 Public LLMs (DeepSeek / Qwen / Hunyuan / ERNIE)
- 🤖 On-device Chrome Gemini Nano (free, offline, auto-fallback)

### Smooth & private
- Adjustable bubble fade-out time — no flicker between links
- Pops only after the model responds (no "loading" placeholder)
- Local / on-device backends keep text on your machine
- Auto detects "spun/rewritten" content on hover

## 隐私要点（商店隐私栏填法）

- 不收集个人身份信息
- 选中/悬停文本仅发往你所选的模型后端
- 本地与 Chrome 内置后端文本不出本机
- 权限：storage / activeTab / scripting / tabs + host（用于抓取链接正文）

## 截图建议（4 张）
1. 划词弹出「要点」浮窗
2. 悬停链接自动摘要（含来源 URL）
3. 设置弹窗：模型来源切换 + 输出语言 + 气泡消失时间
4. 追问模式对话（带原文上下文）
