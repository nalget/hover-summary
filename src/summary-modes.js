/*
 * summary-modes.js — 悬停总结的核心「模式」定义与提示词构建
 *
 * 同一份逻辑被三处复用：
 *   - background.js（Service Worker，通过 importScripts 加载，挂到 self.HS_MODES）
 *   - content.js（内容脚本，作为单独的 content script 先加载，挂到 window.HS_MODES）
 *   - Node 单测（require，导出 module.exports）
 *
 * 不要在这里写任何 chrome.* 调用，保持纯函数，便于测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.HS_MODES = api;
  if (typeof window !== 'undefined') window.HS_MODES = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 五种模式。maxTokens / temperature 会直接用于 chat/completions 请求。
  const SUMMARY_MODES = {
    summary: {
      id: 'summary',
      label: '摘要',
      icon: '📝',
      maxTokens: 400,
      temperature: 0.3,
      desc: '一句话概括核心意思'
    },
    points: {
      id: 'points',
      label: '要点',
      icon: '🔑',
      maxTokens: 500,
      temperature: 0.2,
      desc: '提取 3-5 个关键要点'
    },
    explain: {
      id: 'explain',
      label: '解释',
      icon: '💡',
      maxTokens: 600,
      temperature: 0.4,
      desc: '通俗解释在说什么、为何重要'
    },
    translate: {
      id: 'translate',
      label: '翻译',
      icon: '🌐',
      maxTokens: 800,
      temperature: 0.2,
      desc: '翻译为简体中文（原文为中文则译英）'
    },
    followup: {
      id: 'followup',
      label: '追问',
      icon: '❓',
      maxTokens: 600,
      temperature: 0.5,
      desc: '基于原文继续提问'
    }
  };

  // 气泡里 tab 的展示顺序
  const MODE_ORDER = ['summary', 'points', 'explain', 'translate', 'followup'];

  // 多语言输出指令表：按 outputLang 选用，缺省回退英文（en）。
  // 每种语言提供 summary/points/explain/translate 四种指令 + followupSys(追问系统提示) + sys(通用系统提示)。
  const I18N = {
    'zh-CN': {
      summary: '请用一两句话（中文）概括下面这段内容的核心意思，不要复述细节，也不要使用列表：\n\n',
      points: '请提取下面这段内容的 3–5 个关键要点，用中文、分点列出，每条以「- 」开头，单条不超过 80 字：\n\n',
      explain: '请用通俗易懂的中文解释下面这段内容在说什么、为什么重要，避免 jargon：\n\n',
      translate: '请将下面这段内容翻译为简体中文，保留原有段落结构，专有名词可保留英文并附中文：\n\n',
      followupSys: '你是用户的随身阅读助手。用户会基于一段「原文」向你追问，请结合原文作答，简洁、准确、易懂，用中文回答；若原文已有答案请直接引用。',
      sys: '你是一个严谨、简洁的阅读助手，只回答与所给内容相关的问题。不要输出任何分析过程、思考步骤或自我说明，只输出最终结果。'
    },
    'en': {
      summary: 'Summarize the core meaning of the following text in one or two sentences, in English:\n\n',
      points: 'Extract 3–5 key bullet points from the text below, in English, each starting with "- ":\n\n',
      explain: 'Explain in plain language what the following means and why it matters, in English:\n\n',
      translate: 'Translate the following text into English, preserving paragraph structure; proper nouns may stay in their original language:\n\n',
      followupSys: "You are the user's reading assistant. The user will ask follow-up questions based on a \"source text\". Answer using the source, concisely and accurately, in English. If the source already contains the answer, quote it directly.",
      sys: 'You are a precise, concise reading assistant. Only answer questions related to the given content. Do not output any reasoning steps or self-explanation—only the final result.'
    },
    'ja': {
      summary: '以下のテキストの核心を1〜2文で日本語に要約してください：\n\n',
      points: '以下のテキストから3〜5個の重要ポイントを日本語で箇条書きにしてください。各項目は「- 」で始めてください：\n\n',
      explain: '以下の内容が何を意味し、なぜ重要かを、平易な日本語で説明してください：\n\n',
      translate: '以下のテキストを日本語に翻訳してください。段落構造は保持し、固有名詞は原語のままでも構いません：\n\n',
      followupSys: 'あなたはユーザーの読書アシスタントです。ユーザーは「原文」に基づいて質問します。原文を参照して簡潔かつ正確に日本語で答え、原文に答えがある場合は引用してください。',
      sys: 'あなたは正確で簡潔な読書アシスタントです。与えられた内容に関連する質問にのみ答えてください。思考プロセスや自己説明は出力せず、最終結果のみを出力してください。'
    },
    'ko': {
      summary: '다음 텍스트의 핵심을 1~2문장으로 한국어로 요약하세요:\n\n',
      points: '다음 텍스트에서 3~5개의 핵심 요점을 한국어로 글머리 기호로 정리하세요. 각 항목은 "- "로 시작하세요:\n\n',
      explain: '다음 내용이 무엇을 의미하고 왜 중요한지 평이한 한국어로 설명하세요:\n\n',
      translate: '다음 텍스트를 한국어로 번역하세요. 문단 구조는 유지하고 고유명사는 원어를 그대로 써도 됩니다:\n\n',
      followupSys: '당신은 사용자의 읽기 비서입니다. 사용자가 "원문"을 바탕으로 질문하면 원문을 참고해 간결하고 정확하게 한국어로 답하세요. 원문에 답이 있으면 인용하세요.',
      sys: '당신은 정확하고 간결한 읽기 비서입니다. 주어진 내용과 관련된 질문에만 답하세요. 추론 과정이나 자기 설명은 출력하지 말고 최종 결과만 출력하세요.'
    },
    'fr': {
      summary: "Résumez l'idée centrale du texte suivant en une ou deux phrases, en français :\n\n",
      points: 'Extrayez 3 à 5 points clés du texte ci-dessous, en français, chacun commençant par "- " :\n\n',
      explain: "Expliquez clairement, en français, ce que signifie le texte suivant et pourquoi c'est important :\n\n",
      translate: "Traduisez le texte suivant en français en conservant la structure des paragraphes ; les noms propres peuvent rester dans leur langue d'origine :\n\n",
      followupSys: "Vous êtes l'assistant de lecture de l'utilisateur. L'utilisateur pose des questions complémentaires à partir d'un « texte source ». Répondez en vous appuyant sur le texte, de façon concise et précise, en français. Si le texte contient déjà la réponse, citez-la.",
      sys: "Vous êtes un assistant de lecture précis et concis. Répondez uniquement aux questions liées au contenu fourni. Ne produisez aucune étape de raisonnement ni d'auto-explication—uniquement le résultat final."
    },
    'de': {
      summary: 'Fasse die Kernaussage des folgenden Textes in ein bis zwei Sätzen auf Deutsch zusammen:\n\n',
      points: 'Extrahiere 3–5 Kernpunkte aus dem unten stehenden Text, auf Deutsch, jeder beginnend mit „- „:\n\n',
      explain: 'Erkläre in einfachen Worten auf Deutsch, was der folgende Text bedeutet und warum er wichtig ist:\n\n',
      translate: 'Übersetze den folgenden Text ins Deutsche und behalte die Absatzstruktur bei; Eigennamen dürfen in der Originalsprache bleiben:\n\n',
      followupSys: 'Du bist der Leseassistent des Nutzers. Der Nutzer stellt Folgefragen zu einem „Quelltext“. Antworte basierend auf dem Quelltext, knapp und präzise, auf Deutsch. Wenn die Antwort im Text steht, zitiere sie.',
      sys: 'Du bist ein präziser, knapper Leseassistent. Antworte nur auf Fragen, die mit dem gegebenen Inhalt zusammenhängen. Gib keine Gedankenschritte oder Selbsterklärungen aus—nur das Endergebnis.'
    },
    'es': {
      summary: 'Resume la idea central del siguiente texto en una o dos frases, en español:\n\n',
      points: 'Extrae 3–5 puntos clave del texto siguiente, en español, cada uno empezando por "- ":\n\n',
      explain: 'Explica con palabras sencillas, en español, qué significa el siguiente texto y por qué importa:\n\n',
      translate: 'Traduce el siguiente texto al español conservando la estructura de párrafos; los nombres propios pueden quedar en su idioma original:\n\n',
      followupSys: 'Eres el asistente de lectura del usuario. El usuario hará preguntas de seguimiento basadas en un «texto fuente». Responde usando el texto, de forma concisa y precisa, en español. Si el texto ya contiene la respuesta, cita la fuente.',
      sys: 'Eres un asistente de lectura preciso y conciso. Responde solo a preguntas relacionadas con el contenido dado. No muestres ningún proceso de razonamiento ni autoexplicación—solo el resultado final.'
    },
    'ru': {
      summary: 'Кратко изложите основной смысл следующего текста в одном-двух предложениях на русском языке:\n\n',
      points: 'Выделите 3–5 ключевых пунктов из текста ниже на русском языке, каждый начинайте с «- »:\n\n',
      explain: 'Простыми словами объясните на русском, что означает следующий текст и почему это важно:\n\n',
      translate: 'Переведите следующий текст на русский язык, сохраняя структуру абзацев; имена собственные можно оставить на языке оригинала:\n\n',
      followupSys: 'Вы — читательский помощник пользователя. Пользователь задаёт уточняющие вопросы по «исходному тексту». Отвечайте, опираясь на исходный текст, кратко и точно, на русском. Если ответ уже есть в тексте, цитируйте его.',
      sys: 'Вы — точный и лаконичный читательский помощник. Отвечайте только на вопросы, связанные с данным содержимым. Не выводите ход рассуждений или пояснения — только итоговый результат.'
    }
  };

  // 可选项列表（popup 下拉用）
  const LANGUAGES = [
    { code: 'zh-CN', label: '中文（简体）' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'es', label: 'Español' },
    { code: 'ru', label: 'Русский' }
  ];

  // 简单语言检测：含足量 CJK 即视为中文，否则按英文处理。
  function detectLang(text) {
    const cjk = (text.match(/[一-鿿]/g) || []).length;
    return cjk > text.trim().length * 0.15 ? 'zh' : 'en';
  }

  // 根据模式 + 文本构建请求所需的 system / messages / 参数。
  // opts: { question, history:[{q,a}] }
  function buildMessages(mode, text, opts) {
    opts = opts || {};
    // 归一化：未知模式一律回退到 summary，避免生成无意义的「请处理」指令
    const m = SUMMARY_MODES[mode] ? mode : 'summary';
    const meta = SUMMARY_MODES[m];
    // 目标输出语言：显式指定优先；否则按文本自动检测（兼容旧调用）
    const lang = I18N[opts.lang] ? opts.lang : (detectLang(text) === 'zh' ? 'zh-CN' : 'en');
    const T = I18N[lang] || I18N.en;

    if (m === 'followup') {
      const history = opts.history || [];
      const messages = [
        {
          role: 'system',
          content: T.followupSys
        },
        {
          role: 'user',
          content: '【原文开始】\n' + text + '\n【原文结束】\n请记住上面的原文，接下来我会基于它提问。'
        }
      ];
      for (const turn of history) {
        if (turn && turn.q) messages.push({ role: 'user', content: turn.q });
        if (turn && turn.a) messages.push({ role: 'assistant', content: turn.a });
      }
      messages.push({ role: 'user', content: opts.question || '' });
      return { system: messages[0].content, messages, maxTokens: meta.maxTokens, temperature: meta.temperature };
    }

    const instruction = T[m] || T.summary;
    const messages = [
      {
        role: 'system',
        content: T.sys
      },
      { role: 'user', content: instruction + text }
    ];

    return { system: messages[0].content, messages, maxTokens: meta.maxTokens, temperature: meta.temperature };
  }

  // 解析有效输出语言：
  // - 显式指定（auto 以外）且受支持 → 原样返回
  // - 'auto' 或未知 → 跟随系统语言（navigator.language），映射到受支持语言，缺省回退英文
  function resolveLang(lang) {
    if (lang && lang !== 'auto' && I18N[lang]) return lang;
    let sys = 'en';
    if (typeof navigator !== 'undefined' && navigator.language) sys = navigator.language;
    else if (typeof self !== 'undefined' && self.navigator && self.navigator.language) sys = self.navigator.language;
    const primary = (sys || 'en').split('-')[0].toLowerCase();
    const MAP = { zh: 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es', ru: 'ru' };
    return MAP[primary] || 'en';
  }

  return { SUMMARY_MODES, MODE_ORDER, detectLang, buildMessages, I18N, LANGUAGES, resolveLang };
});
