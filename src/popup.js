// popup.js — 配置页面逻辑

const DEFAULT_CONFIG = {
  enabled: true,
  model: 'chrome', // 默认用 Chrome 内置 Gemini Nano（设备端·免Key·离线）；不可用时自动回退
  theme: 'auto',
  maxLength: 2000,
  maxOutput: 800, // 单次摘要最大输出 token：防小模型重复，0.5B 可设 256
  maxLocalInput: 1500, // 本地小模型输入上限（字符）
  hoverDelay: 800,
  triggerMode: 'select',
  lang: 'auto', // 统一展示/摘要语言：auto=跟随系统；或 zh-CN/en/ja/ko/fr/de/es/ru（即时生效）
  bubbleHideDelay: 3000, // 鼠标离开气泡后的保留(淡出)时间 ms（默认约 3 秒）
  duplicateCheck: true,
  duplicateEndpoint: 'http://127.0.0.1:8765',
  agnes: { endpoint: 'https://apihub.agnes-ai.cn/v1/chat/completions', apiKey: '', model: 'agnes-2.0-flash' },
  nvidia: { endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', apiKey: '', model: 'openai/gpt-oss-120b' },
  local: { endpoint: 'http://127.0.0.1:8000/v1/chat/completions', apiKey: '', model: '' },
  chrome: {}, // Chrome 内置 AI（Gemini Nano）：无需 endpoint / Key / 模型选择
  public: { preset: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions', apiKey: '', model: 'deepseek-chat' }
};

// 公开大模型预设（与 background.js 的 PUBLIC_PRESETS 对应，仅用于弹窗自动填充）
const PUBLIC_PRESETS_UI = {
  deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', keyHint: 'DeepSeek API Key（官网注册即送免费额度）' },
  qwen: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', keyHint: '阿里云 DashScope API Key（开通模型即送免费额度）' },
  hunyuan: { endpoint: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions', model: 'hunyuan-lite', keyHint: '腾讯云混元 API Key（控制台开通送免费额度）' },
  baidu: { endpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant', model: 'eb-instant', keyHint: '百度智能云：填 client_id:client_secret（两个密钥用冒号连接）' },
  pollinations: { endpoint: 'https://text.pollinations.ai/openai', model: 'openai', keyHint: '免密钥，留空即可（偶发服务端抖动，建议优先用上方国内大模型）' }
};

const $ = (id) => document.getElementById(id);
const modelSelect = $('model');
const delaySlider = $('hover-delay');
const delayValue = $('delay-value');
const maxLenSlider = $('max-length');
const maxLenValue = $('maxlen-value');
const maxOutSlider = $('max-output');
const maxOutValue = $('maxout-value');
const maxLocalSlider = $('max-local-input');
const maxLocalValue = $('maxlocal-value');
const uiLang = $('ui-lang');
const hideSlider = $('bubble-hide-delay');
const hideValue = $('hide-value');
const triggerMode = $('trigger-mode');
const theme = $('theme');
const enabled = $('enabled');
const saveBtn = $('save');
const statusEl = $('status');

// ── 弹窗本地化（popup 上下文无法访问 self.HS_MODES，故本地定义）──
const POPUP_LANGS = { 'zh-CN': 1, en: 1, ja: 1, ko: 1, fr: 1, de: 1, es: 1, ru: 1 };
function resolveLang(lang) {
  if (lang && lang !== 'auto' && POPUP_LANGS[lang]) return lang;
  let sys = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  const primary = sys.split('-')[0].toLowerCase();
  const MAP = { zh: 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es', ru: 'ru' };
  return MAP[primary] || 'en';
}
const POPUP_I18N = {
  'zh-CN': {
    sub: '网页/文档划词悬浮 AI 总结', language: '语言', theme: '主题', 'theme.auto': '跟随系统', 'theme.light': '亮色', 'theme.dark': '暗色',
    enabled: '启用扩展', modelSource: '模型来源',
    'p.agnes': '云端 API — Agnes', 'p.nvidia': '云端 API — NVIDIA NIM', 'p.local': '本地模型 — oMLX / LM Studio / Ollama（离线）', 'p.chrome': '本地 Chrome 内置 AI — Gemini Nano（离线免费）', 'p.public': '云端 API — 公开大模型（DeepSeek/通义/混元/文心）',
    modelHint: '具体模型在下方对应面板中选择', triggerMode: '触发方式', 't.select': '划词（选中文字后点 💡 总结）', 't.hover': '悬停即触发', 't.shift': 'Shift + 悬停',
    maxLength: '送入模型的最大字数', hoverDelay: '悬停触发延迟', bubbleHide: '气泡消失时间', bubbleHideHint: '鼠标离开气泡后的保留（淡出）时长；调大切换链接更顺滑。',
    dup: '🔍 换皮检测', dupSub: '悬停时自动检测是否为换皮内容', dupEndpoint: '检测服务地址',
    'm.agnesKey': 'Agnes API Key', 'm.agnesModel': 'Agnes 模型名', 'm.nvidiaKey': 'NVIDIA NIM API Key', 'm.nvidiaModel': 'NVIDIA 模型',
    'm.localModel': '本地模型（自动探测服务并列出）', refreshModels: '🔄 重新探测 / 刷新列表', 'm.endpoint': '服务地址（自动探测填充，无需手填）', 'm.endpointHint': '自动探测 oMLX(8000) / LM Studio(1234) / Ollama(11434) / llama.cpp(8080)；本地无需 Key。', loadModel: '✅ 确认并加载此模型', 'm.loadHint': '点此即把设置写入并只把选中的模型载入 oMLX 内存（oMLX 会自动淘汰其它模型，不占多余内存）。之后总结都只用它。',
    'm.publicPreset': '服务商', 'm.publicEndpoint': '端点（OpenAI 兼容，可改）', 'm.publicModel': '模型名', 'm.publicKey': 'API Key',
    testConn: '测试连接', speedTest: '⚡ 测速并选用最快模型',
    chromeHint: '调用 Chrome 浏览器内置的 Gemini Nano（设备端运行）：无需 Key、无需服务器、离线、隐私不出本机。仅当浏览器已自带该模型时可用；本扩展不引导下载约 1.5GB 设备端模型，未自带请改用其它模型来源。摘要/要点走专用 Summarizer，解释/翻译/追问走 Prompt API。',
    chromeCheck: '🔍 检查 Chrome 内置模型', chromeUnavail: '若显示「不可用 / 需下载」：本扩展不引导下载 1.5GB 设备端模型——该模型需 Chrome 浏览器自带（Chrome 138+ 桌面端，且已开启相关优化项）。未自带时此路不可用，建议改用其它模型（本地 oMLX / 云端 API / 公开大模型）。',
    save: '保存设置', saved: '✅ 已保存', 'lang.auto': '跟随系统'
  },
  'en': {
    sub: 'AI summary on select / hover for any webpage', language: 'Language', theme: 'Theme', 'theme.auto': 'Follow system', 'theme.light': 'Light', 'theme.dark': 'Dark',
    enabled: 'Enable extension', modelSource: 'Model source',
    'p.agnes': 'Cloud API — Agnes', 'p.nvidia': 'Cloud API — NVIDIA NIM', 'p.local': 'Local model — oMLX / LM Studio / Ollama (offline)', 'p.chrome': 'Local Chrome built-in AI — Gemini Nano (offline, free)', 'p.public': 'Cloud API — Public LLMs (DeepSeek/Qwen/Hunyuan/ERNIE)',
    modelHint: 'Choose the specific model in the panel below', triggerMode: 'Trigger mode', 't.select': 'Select text (click 💡 to summarize)', 't.hover': 'Hover to trigger', 't.shift': 'Shift + Hover',
    maxLength: 'Max characters sent to model', hoverDelay: 'Hover trigger delay', bubbleHide: 'Bubble hide delay', bubbleHideHint: 'Time the bubble stays (fade-out) after mouse leaves; larger = smoother when switching links.',
    dup: '🔍 Spin detection', dupSub: 'Auto-detect spun/rewritten content on hover', dupEndpoint: 'Detection service address',
    'm.agnesKey': 'Agnes API Key', 'm.agnesModel': 'Agnes model name', 'm.nvidiaKey': 'NVIDIA NIM API Key', 'm.nvidiaModel': 'NVIDIA model',
    'm.localModel': 'Local model (auto-detected & listed)', refreshModels: '🔄 Re-detect / refresh list', 'm.endpoint': 'Service address (auto-filled, no need to type)', 'm.endpointHint': 'Auto-detect oMLX(8000) / LM Studio(1234) / Ollama(11434) / llama.cpp(8080); no Key needed locally.', loadModel: '✅ Confirm & load this model', 'm.loadHint': 'Saves settings and loads only the selected model into oMLX memory (oMLX evicts others automatically). Summaries then use only this model.',
    'm.publicPreset': 'Provider', 'm.publicEndpoint': 'Endpoint (OpenAI-compatible, editable)', 'm.publicModel': 'Model name', 'm.publicKey': 'API Key',
    testConn: 'Test connection', speedTest: '⚡ Speed test & pick fastest model',
    chromeHint: 'Uses Chrome’s on-device Gemini Nano: no Key, no server, offline, private. Only usable if your Chrome already ships the model — this extension does NOT trigger the ~1.5GB download; if it’s not built-in, pick another model source. Summary/Key-points use the Summarizer API; Explain/Translate/Ask use the Prompt API.',
    chromeCheck: '🔍 Check Chrome built-in model', chromeUnavail: 'If it shows "unavailable / needs download": this extension does NOT trigger the ~1.5GB on-device download — that model must ship with your Chrome (Chrome 138+ desktop with the relevant flags). When not built-in, this path is unusable; pick another model (local oMLX / cloud API / public LLM) instead.',
    save: 'Save settings', saved: '✅ Saved', 'lang.auto': 'Follow system'
  },
  'ja': {
    sub: 'Webページでテキスト選択／ホバー時にAI要約', language: '言語', theme: 'テーマ', 'theme.auto': 'システムに従う', 'theme.light': 'ライト', 'theme.dark': 'ダーク',
    enabled: '拡張機能を有効化', modelSource: 'モデルソース',
    'p.agnes': 'クラウド API — Agnes', 'p.nvidia': 'クラウド API — NVIDIA NIM', 'p.local': 'ローカルモデル — oMLX / LM Studio / Ollama（オフライン）', 'p.chrome': 'ローカル Chrome 内蔵 AI — Gemini Nano（オフライン・無料）', 'p.public': 'クラウド API — 公開LLM（DeepSeek/通義/混元/文心）',
    modelHint: '具体的なモデルは下のパネルで選択', triggerMode: 'トリガー方式', 't.select': 'テキスト選択（💡で要約）', 't.hover': 'ホバーで実行', 't.shift': 'Shift + ホバー',
    maxLength: 'モデルに送る最大文字数', hoverDelay: 'ホバー実行遅延', bubbleHide: 'バブル消滅時間', bubbleHideHint: 'マウスが離れた後のバブル保持（フェードアウト）時間。大きいほどリンク切り替えが滑らか。',
    dup: '🔍 スピン検出', dupSub: 'ホバー時に書き換えコンテンツを自動検出', dupEndpoint: '検出サービスアドレス',
    'm.agnesKey': 'Agnes APIキー', 'm.agnesModel': 'Agnes モデル名', 'm.nvidiaKey': 'NVIDIA NIM APIキー', 'm.nvidiaModel': 'NVIDIA モデル',
    'm.localModel': 'ローカルモデル（自動検出・一覧表示）', refreshModels: '🔄 再検出／更新', 'm.endpoint': 'サービスアドレス（自動入力・手入力不要）', 'm.endpointHint': 'oMLX(8000)/LM Studio(1234)/Ollama(11434)/llama.cpp(8080)を自動検出。ローカルはキー不要。', loadModel: '✅ このモデルを確定・読み込み', 'm.loadHint': '設定を保存し選択モデルのみをoMLXメモリに読み込み（他は自動破棄）。以降はこのモデルのみ使用。',
    'm.publicPreset': 'プロバイダ', 'm.publicEndpoint': 'エンドポイント（OpenAI互換・編集可）', 'm.publicModel': 'モデル名', 'm.publicKey': 'APIキー',
    testConn: '接続テスト', speedTest: '⚡ 速度測定・最速モデル選択',
    chromeHint: 'Chrome内蔵Gemini Nanoを使用（デバイス側・キー不要・オフライン・プライベート）。要約/要点はSummarizer API、説明/翻訳/質問はPrompt API。',
    chromeCheck: '🔍 Chrome内蔵モデルを確認', chromeUnavail: '"利用不可／ダウンロード必要"の場合：本拡張は約1.5GBのオンデバイスモデルのダウンロードを促しません。そのモデルはChrome自体に組み込まれている必要があります（Chrome 138+ デスクトップ、関連フラグ有効）。組み込みがない場合はこの経路は利用不可です。他のモデル（ローカルoMLX／クラウドAPI／公開LLM）を選択してください。',
    save: '設定を保存', saved: '✅ 保存しました', 'lang.auto': 'システムに従う'
  },
  'ko': {
    sub: '웹페이지에서 텍스트 선택/호버 시 AI 요약', language: '언어', theme: '테마', 'theme.auto': '시스템 따르기', 'theme.light': '라이트', 'theme.dark': '다크',
    enabled: '확장 프로그램 사용', modelSource: '모델 소스',
    'p.agnes': '클라우드 API — Agnes', 'p.nvidia': '클라우드 API — NVIDIA NIM', 'p.local': '로컬 모델 — oMLX / LM Studio / Ollama(오프라인)', 'p.chrome': '로컬 Chrome 내장 AI — Gemini Nano(오프라인·무료)', 'p.public': '클라우드 API — 공개 LLM(DeepSeek/통의/혼원/문심)',
    modelHint: '구체적 모델은 아래 패널에서 선택', triggerMode: '트리거 방식', 't.select': '텍스트 선택(💡로 요약)', 't.hover': '호버로 실행', 't.shift': 'Shift + 호버',
    maxLength: '모델에 보낼 최대 문자 수', hoverDelay: '호버 실행 지연', bubbleHide: '버블 사라짐 시간', bubbleHideHint: '마우스 이탈 후 버블 유지(페이드아웃) 시간. 클수록 링크 전환이 부드러움.',
    dup: '🔍 스핀 감지', dupSub: '호버 시 재작성 콘텐츠 자동 감지', dupEndpoint: '감지 서비스 주소',
    'm.agnesKey': 'Agnes API 키', 'm.agnesModel': 'Agnes 모델명', 'm.nvidiaKey': 'NVIDIA NIM API 키', 'm.nvidiaModel': 'NVIDIA 모델',
    'm.localModel': '로컬 모델(자동 감지·목록)', refreshModels: '🔄 재감지/새로고침', 'm.endpoint': '서비스 주소(자동 입력·직접 입력 불필요)', 'm.endpointHint': 'oMLX(8000)/LM Studio(1234)/Ollama(11434)/llama.cpp(8080) 자동 감지. 로컬은 키 불필요.', loadModel: '✅ 이 모델 확인·로드', 'm.loadHint': '설정을 저장하고 선택 모델만 oMLX 메모리에 로드(나머지 자동 제거). 이후 이 모델만 사용.',
    'm.publicPreset': '공급자', 'm.publicEndpoint': '엔드포인트(OpenAI 호환·수정 가능)', 'm.publicModel': '모델명', 'm.publicKey': 'API 키',
    testConn: '연결 테스트', speedTest: '⚡ 속도 측정·최快 모델 선택',
    chromeHint: 'Chrome 내장 Gemini Nano 사용(기기 측·키 불필요·오프라인·프라이빗). 요약/요점은 Summarizer API, 설명/번역/질문은 Prompt API.',
    chromeCheck: '🔍 Chrome 내장 모델 확인', chromeUnavail: '"사용 불가 / 다운로드 필요"인 경우: 이 확장은 약 1.5GB 온디바이스 모델 다운로드를 유도하지 않습니다. 해당 모델은 Chrome 자체에 내장되어 있어야 합니다(Chrome 138+ 데스크톱, 관련 플래그 활성화). 내장되지 않은 경우 이 경로는 사용 불가이며, 다른 모델(로컬 oMLX / 클라우드 API / 공개 LLM)을 선택하세요.',
    save: '설정 저장', saved: '✅ 저장됨', 'lang.auto': '시스템 따르기'
  },
  'fr': {
    sub: 'Résumé IA au survol / sélection de texte sur toute page', language: 'Langue', theme: 'Thème', 'theme.auto': 'Suivre le système', 'theme.light': 'Clair', 'theme.dark': 'Sombre',
    enabled: 'Activer l’extension', modelSource: 'Source du modèle',
    'p.agnes': 'API cloud — Agnes', 'p.nvidia': 'API cloud — NVIDIA NIM', 'p.local': 'Modèle local — oMLX / LM Studio / Ollama (hors ligne)', 'p.chrome': 'IA locale Chrome — Gemini Nano (hors ligne, gratuit)', 'p.public': 'API cloud — LLM publics (DeepSeek/Qwen/Hunyuan/ERNIE)',
    modelHint: 'Choisissez le modèle dans le panneau ci-dessous', triggerMode: 'Mode de déclenchement', 't.select': 'Sélection de texte (cliquer 💡 pour résumer)', 't.hover': 'Survol pour déclencher', 't.shift': 'Maj + Survol',
    maxLength: 'Nombre max de caractères envoyés', hoverDelay: 'Délai de déclenchement au survol', bubbleHide: 'Disparition de la bulle', bubbleHideHint: 'Temps de maintien (fondu) après le départ de la souris ; plus élevé = plus fluide entre les liens.',
    dup: '🔍 Détection de reformulation', dupSub: 'Détecte automatiquement le contenu reformulé au survol', dupEndpoint: 'Adresse du service de détection',
    'm.agnesKey': 'Clé API Agnes', 'm.agnesModel': 'Nom du modèle Agnes', 'm.nvidiaKey': 'Clé API NVIDIA NIM', 'm.nvidiaModel': 'Modèle NVIDIA',
    'm.localModel': 'Modèle local (détecté et listé automatiquement)', refreshModels: '🔄 Redétecter / actualiser', 'm.endpoint': 'Adresse du service (remplie auto)', 'm.endpointHint': 'Détecte auto oMLX(8000)/LM Studio(1234)/Ollama(11434)/llama.cpp(8080) ; pas de clé en local.', loadModel: '✅ Confirmer et charger ce modèle', 'm.loadHint': 'Enregistre et charge seul le modèle sélectionné en mémoire oMLX (les autres sont évincés). Les résumés n’utilisent que ce modèle.',
    'm.publicPreset': 'Fournisseur', 'm.publicEndpoint': 'Endpoint (compatible OpenAI, modifiable)', 'm.publicModel': 'Nom du modèle', 'm.publicKey': 'Clé API',
    testConn: 'Tester la connexion', speedTest: '⚡ Test de vitesse & modèle le plus rapide',
    chromeHint: 'Utilise le Gemini Nano intégré à Chrome : sans clé, sans serveur, hors ligne, privé. Résumé/Points via l’API Summarizer ; Expliquer/Traduire/Question via l’API Prompt.',
    chromeCheck: '🔍 Vérifier le modèle Chrome intégré', chromeUnavail: 'Si « indisponible / téléchargement requis » : cette extension ne déclenche PAS le téléchargement (~1,5Go) du modèle on-device — celui-ci doit être intégré à Chrome (Chrome 138+ bureau, flags requis). S’il n’est pas intégré, ce chemin est inutilisable ; choisissez un autre modèle (oMLX local / API cloud / LLM public).',
    save: 'Enregistrer', saved: '✅ Enregistré', 'lang.auto': 'Suivre le système'
  },
  'de': {
    sub: 'KI-Zusammenfassung bei Auswahl / Hover auf jeder Seite', language: 'Sprache', theme: 'Thema', 'theme.auto': 'System folgen', 'theme.light': 'Hell', 'theme.dark': 'Dunkel',
    enabled: 'Erweiterung aktivieren', modelSource: 'Modellquelle',
    'p.agnes': 'Cloud API — Agnes', 'p.nvidia': 'Cloud API — NVIDIA NIM', 'p.local': 'Lokales Modell — oMLX / LM Studio / Ollama (offline)', 'p.chrome': 'Lokale Chrome-KI — Gemini Nano (offline, kostenlos)', 'p.public': 'Cloud API — öffentliche LLMs (DeepSeek/Qwen/Hunyuan/ERNIE)',
    modelHint: 'Wähle das Modell im Panel unten', triggerMode: 'Auslösemodus', 't.select': 'Text auswählen (💡 zum Zusammenfassen)', 't.hover': 'Hover zum Auslösen', 't.shift': 'Umschalt + Hover',
    maxLength: 'Max. Zeichen an Modell', hoverDelay: 'Hover-Auslöseverzögerung', bubbleHide: 'Blasen-Ausblendzeit', bubbleHideHint: 'Zeit, die die Blase nach Verlassen der Maus bleibt (Ausblenden); höher = flüssigerer Wechsel zwischen Links.',
    dup: '🔍 Spin-Erkennung', dupSub: 'Erkennt umgeschriebenen Inhalt automatisch beim Hover', dupEndpoint: 'Adresse des Erkennungsdiensts',
    'm.agnesKey': 'Agnes API-Schlüssel', 'm.agnesModel': 'Agnes Modellname', 'm.nvidiaKey': 'NVIDIA NIM API-Schlüssel', 'm.nvidiaModel': 'NVIDIA Modell',
    'm.localModel': 'Lokales Modell (automatisch erkannt & aufgelistet)', refreshModels: '🔄 Neu erkennen / aktualisieren', 'm.endpoint': 'Service-Adresse (auto-ausgefüllt)', 'm.endpointHint': 'Erkennt oMLX(8000)/LM Studio(1234)/Ollama(11434)/llama.cpp(8080) automatisch; lokal keine Key nötig.', loadModel: '✅ Dieses Modell bestätigen & laden', 'm.loadHint': 'Speichert und lädt nur das ausgewählte Modell in den oMLX-Speicher (andere werden verdrängt). Zusammenfassungen nutzen nur dieses Modell.',
    'm.publicPreset': 'Anbieter', 'm.publicEndpoint': 'Endpoint (OpenAI-kompatibel, änderbar)', 'm.publicModel': 'Modellname', 'm.publicKey': 'API-Schlüssel',
    testConn: 'Verbindung testen', speedTest: '⚡ Geschwindigkeitstest & schnellstes Modell',
    chromeHint: 'Nutzt Chromes Geräte-KI Gemini Nano: kein Key, kein Server, offline, privat. Zusammenfassung/Punkte via Summarizer API; Erklären/Übersetzen/Fragen via Prompt API.',
    chromeCheck: '🔍 Chrome-Built-in-Modell prüfen', chromeUnavail: 'Bei „nicht verfügbar / Download nötig“: diese Erweiterung löst den ~1,5GB on-device Download NICHT aus — das Modell muss in Chrome integriert sein (Chrome 138+ Desktop, entsprechende Flags). Ist es nicht integriert, ist dieser Pfad unbrauchbar; wählen Sie ein anderes Modell (lokales oMLX / Cloud-API / öffentlicher LLM).',
    save: 'Speichern', saved: '✅ Gespeichert', 'lang.auto': 'System folgen'
  },
  'es': {
    sub: 'Resumen IA al seleccionar / pasar el cursor en cualquier página', language: 'Idioma', theme: 'Tema', 'theme.auto': 'Seguir sistema', 'theme.light': 'Claro', 'theme.dark': 'Oscuro',
    enabled: 'Activar extensión', modelSource: 'Fuente del modelo',
    'p.agnes': 'API en la nube — Agnes', 'p.nvidia': 'API en la nube — NVIDIA NIM', 'p.local': 'Modelo local — oMLX / LM Studio / Ollama (offline)', 'p.chrome': 'IA local de Chrome — Gemini Nano (offline, gratis)', 'p.public': 'API en la nube — LLM públicos (DeepSeek/Qwen/Hunyuan/ERNIE)',
    modelHint: 'Elige el modelo en el panel de abajo', triggerMode: 'Modo de activación', 't.select': 'Seleccionar texto (clic en 💡 para resumir)', 't.hover': 'Pasar el cursor para activar', 't.shift': 'Shift + Cursor',
    maxLength: 'Máx. caracteres enviados al modelo', hoverDelay: 'Retardo al pasar el cursor', bubbleHide: 'Tiempo de desvanecimiento', bubbleHideHint: 'Tiempo que la burbuja permanece (desvanecimiento) tras salir el ratón; mayor = más fluido al cambiar de enlace.',
    dup: '🔍 Detección de spin', dupSub: 'Detecta automáticamente contenido reescrito al pasar el cursor', dupEndpoint: 'Dirección del servicio de detección',
    'm.agnesKey': 'Clave API Agnes', 'm.agnesModel': 'Nombre del modelo Agnes', 'm.nvidiaKey': 'Clave API NVIDIA NIM', 'm.nvidiaModel': 'Modelo NVIDIA',
    'm.localModel': 'Modelo local (detectado y listado automáticamente)', refreshModels: '🔄 Redetectar / actualizar', 'm.endpoint': 'Dirección del servicio (autorrellenado)', 'm.endpointHint': 'Detecta auto oMLX(8000)/LM Studio(1234)/Ollama(11434)/llama.cpp(8080); sin clave en local.', loadModel: '✅ Confirmar y cargar este modelo', 'm.loadHint': 'Guarda y carga solo el modelo seleccionado en memoria oMLX (expulsa otros). Los resúmenes usan solo este modelo.',
    'm.publicPreset': 'Proveedor', 'm.publicEndpoint': 'Endpoint (compatible OpenAI, editable)', 'm.publicModel': 'Nombre del modelo', 'm.publicKey': 'Clave API',
    testConn: 'Probar conexión', speedTest: '⚡ Prueba de velocidad y modelo más rápido',
    chromeHint: 'Usa el Gemini Nano integrado en Chrome: sin clave, sin servidor, offline, privado. Resumen/Puntos vía API Summarizer; Explicar/Traducir/Preguntar vía API Prompt.',
    chromeCheck: '🔍 Comprobar modelo integrado de Chrome', chromeUnavail: 'Si muestra «no disponible / requiere descarga»: esta extensión NO dispara la descarga (~1,5GB) del modelo on-device — ese modelo debe venir integrado en Chrome (Chrome 138+ escritorio, flags activados). Si no está integrado, esta vía es inutilizable; elija otro modelo (oMLX local / API en la nube / LLM público).',
    save: 'Guardar', saved: '✅ Guardado', 'lang.auto': 'Seguir sistema'
  },
  'ru': {
    sub: 'ИИ-резюме при выделении / наведении на любой странице', language: 'Язык', theme: 'Тема', 'theme.auto': 'Как в системе', 'theme.light': 'Светлая', 'theme.dark': 'Тёмная',
    enabled: 'Включить расширение', modelSource: 'Источник модели',
    'p.agnes': 'Облачный API — Agnes', 'p.nvidia': 'Облачный API — NVIDIA NIM', 'p.local': 'Локальная модель — oMLX / LM Studio / Ollama (офлайн)', 'p.chrome': 'Локальный ИИ Chrome — Gemini Nano (офлайн, бесплатно)', 'p.public': 'Облачный API — публичные LLM (DeepSeek/Qwen/Hunyuan/ERNIE)',
    modelHint: 'Выберите модель в панели ниже', triggerMode: 'Режим запуска', 't.select': 'Выделить текст (нажмите 💡 для резюме)', 't.hover': 'Наведение для запуска', 't.shift': 'Shift + Наведение',
    maxLength: 'Макс. символов для модели', hoverDelay: 'Задержка запуска при наведении', bubbleHide: 'Время скрытия пузыря', bubbleHideHint: 'Время удержания пузыря (затухание) после ухода мыши; больше = плавнее при смене ссылок.',
    dup: '🔍 Детект спина', dupSub: 'Автоматически обнаруживает переписанный контент при наведении', dupEndpoint: 'Адрес сервиса детекции',
    'm.agnesKey': 'API-ключ Agnes', 'm.agnesModel': 'Имя модели Agnes', 'm.nvidiaKey': 'API-ключ NVIDIA NIM', 'm.nvidiaModel': 'Модель NVIDIA',
    'm.localModel': 'Локальная модель (автообнаружение и список)', refreshModels: '🔄 Переобнаружить / обновить', 'm.endpoint': 'Адрес сервиса (заполняется авто)', 'm.endpointHint': 'Автообнаружение oMLX(8000)/LM Studio(1234)/Ollama(11434)/llama.cpp(8080); локально ключ не нужен.', loadModel: '✅ Подтвердить и загрузить эту модель', 'm.loadHint': 'Сохраняет и загружает только выбранную модель в память oMLX (остальные вытесняются). Резюме используют только эту модель.',
    'm.publicPreset': 'Провайдер', 'm.publicEndpoint': 'Endpoint (OpenAI-совместимый, изменяемый)', 'm.publicModel': 'Имя модели', 'm.publicKey': 'API-ключ',
    testConn: 'Проверить соединение', speedTest: '⚡ Тест скорости и самая быстрая модель',
    chromeHint: 'Использует встроенный Gemini Nano в Chrome: без ключа, без сервера, офлайн, приватно. Резюме/Пункты через API Summarizer; Объяснить/Перевести/Спросить через API Prompt.',
    chromeCheck: '🔍 Проверить встроенную модель Chrome', chromeUnavail: 'Если «недоступно / нужна загрузка»: это расширение НЕ запускает загрузку (~1,5GB) on-device модели — модель должна быть встроена в Chrome (Chrome 138+ настольный, нужные флаги). Если не встроена, этот путь неработоспособен; выберите другую модель (локальный oMLX / облачный API / публичный LLM).',
    save: 'Сохранить', saved: '✅ Сохранено', 'lang.auto': 'Как в системе'
  }
};
function applyPopupI18n(lang) {
  const dict = POPUP_I18N[lang] || POPUP_I18N.en;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const t = dict[el.getAttribute('data-i18n')];
    if (t != null) el.textContent = t;
  });
}

const configPanels = { agnes: $('cfg-agnes'), nvidia: $('cfg-nvidia'), local: $('cfg-local'), chrome: $('cfg-chrome'), public: $('cfg-public') };

function switchModelPanel(model) {
  Object.values(configPanels).forEach((p) => p.classList.remove('active'));
  if (configPanels[model]) configPanels[model].classList.add('active');
  stopChromeAIPoll(); // 离开 Chrome 面板时停止状态轮询
  // 懒加载：切到“本地模型”面板时才探测服务并拉取模型列表（其余时候不打扰本地服务）
  if (model === 'local') detectAndRefreshLocal();
  // 切到“Chrome 内置 AI”面板时检查可用性（并可在面板内手动触发下载）
  if (model === 'chrome') checkChromeAIStatus();
}

// 记录已保存的本地模型名，供探测完成后回填选中
let savedLocalModel = '';
let localDetecting = false;

// 自动探测本地服务地址（oMLX/LM Studio/Ollama/llama.cpp）→ 填充地址 → 列出模型
function detectAndRefreshLocal() {
  if (localDetecting) return;
  localDetecting = true;
  const sel = $('local-model');
  const box = $('detect-local');
  box.className = 'test-status';
  box.style.display = 'block';
  box.style.background = '#eef'; box.style.color = '#555';
  box.textContent = '⏳ 正在自动探测本地模型服务…';
  // 占位：探测期间下拉不可误选
  sel.innerHTML = '<option value="">— 正在探测… —</option>';

  const savedEp = ($('local-endpoint').value || '').trim();
  chrome.runtime.sendMessage({ action: 'detectLocalEndpoint', endpoint: savedEp }, (resp) => {
    localDetecting = false;
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      const msg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || (resp && resp.error) || '探测失败';
      box.className = 'test-status err';
      box.textContent = '❌ ' + msg;
      sel.innerHTML = '';
      // 保留已存模型（服务未启动时不丢配置）
      const o = document.createElement('option');
      if (savedLocalModel) {
        o.value = savedLocalModel; o.textContent = savedLocalModel + '（服务未连接）';
      } else {
        o.value = ''; o.textContent = '— 未发现本地服务 —';
      }
      sel.appendChild(o);
      return;
    }
    // 自动匹配到地址：直接填充，无需手填
    $('local-endpoint').value = resp.endpoint;
    const models = resp.models || [];
    sel.innerHTML = '<option value="">— 请选择模型 —</option>';
    models.forEach((m) => {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      sel.appendChild(o);
    });
    // 已保存的模型仍在列表中则选中；不在则补选项保留
    if (savedLocalModel && !models.includes(savedLocalModel)) {
      const o = document.createElement('option');
      o.value = savedLocalModel; o.textContent = savedLocalModel + '（已保存/未列出）';
      sel.appendChild(o);
    }
    sel.value = savedLocalModel || '';
    box.className = 'test-status ok';
    box.textContent = `✅ 已连接 ${resp.base.replace('http://', '')}，发现 ${models.length} 个模型` +
      (savedLocalModel ? '' : '，请在下方选择并确认加载');
  });
}

// ── 查询/下载 Chrome 内置 AI：优先走“主世界桥接”（最贴近真实使用），
//    当前标签页没有桥接时回退到弹窗自身 window 上下文，再不行明确告知根因。
//    注意：Chrome 内置 AI 属于“内置 AI API”，无法在 Service Worker 运行，
//    因此绝不直接查后台 SW（那永远 unavailable）。
function sendTab(tabId, action) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action }, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

async function queryActiveTabChromeAI(action) {
  // 选一个“主世界桥接已注入”的标签页：优先当前活动页，其次任意 http(s) 网页。
  // （chrome:// 页面与扩展页不会注入桥接脚本，故需跳过。）
  let tabs = [];
  try { tabs = await new Promise((res) => chrome.tabs.query({}, res)); } catch (e) { tabs = []; }
  const isWeb = (t) => /^https?:/.test((t && t.url) || '');
  const active = tabs.find((t) => t.active && isWeb(t));
  const web = tabs.find(isWeb);
  const candidates = [active, web].filter(Boolean);
  for (const tab of candidates) {
    try {
      const r = await sendTab(tab.id, action);
      if (r && !r.__noBridge) return r;
    } catch (e) { /* 该标签页无桥接：尝试下一个 */ }
  }

  // 兜底：弹窗自身 window（部分 Chrome 在扩展页也暴露内置 AI）
  const Sum = window.Summarizer, LM = window.LanguageModel;
  if (Sum || LM) {
    const out = { summarizer: 'n/a', languageModel: 'n/a' };
    if (Sum) { try { out.summarizer = await Sum.availability({ type: 'tldr', format: 'markdown', length: 'short' }).catch(() => 'unavailable'); } catch (e) { out.summarizer = 'unavailable'; } }
    if (LM) { try { out.languageModel = await LM.availability().catch(() => 'unavailable'); } catch (e) { out.languageModel = 'unavailable'; } }
    return out;
  }

  // 都无法访问：明确根因
  const e = new Error('此环境无法访问 Chrome 内置 AI：需在普通网页上打开本扩展（chrome:// 页面无法调用）。要求 Chrome 138+ 桌面端；Summarizer 是否可用取决于浏览器是否已自带设备端模型（本扩展不引导下载）。');
  e.code = 'NO_CHROME_AI';
  throw e;
}

function renderChromeAIStatus(box, a) {
  const ok = (v) => v === 'ready' || v === 'available';
  const s = a.summarizer, l = a.languageModel;
  const sReady = ok(s), lReady = ok(l);
  const usable = sReady || lReady;
  box.className = 'test-status ' + (usable ? 'ok' : '');
  box.style.background = usable ? '#e6f4ea' : '#fdecea';
  box.style.color = usable ? '#1e7e34' : '#c62828';
  const fmt = (v) => ok(v) ? '✅ 就绪' : (v === 'downloadable' ? '⬇️ 需下载(本扩展不引导)' : (v === 'downloading' ? '⬇️ 浏览器下载中' : (v === 'unavailable' ? '❌ 不可用' : (v === 'n/a' ? '—' : v))));
  if (usable) {
    let note = '（摘要/要点可设备端运行）';
    if (sReady && lReady) note = '（摘要/解释/翻译/追问均可设备端运行）';
    else if (lReady) note = '（Prompt 可用；摘要将走 Prompt API）';
    else note = '（摘要/要点可设备端运行；解释/翻译/追问将自动回退云端）';
    box.textContent = `Summarizer: ${fmt(s)} ｜ LanguageModel: ${fmt(l)} ${note}`;
    return;
  }
  // 不可用：明确不引导下载，提示切换模型来源
  box.textContent = `Summarizer: ${fmt(s)} ｜ LanguageModel: ${fmt(l)} —— 此路不可用（需 Chrome 浏览器自带设备端模型；本扩展不引导下载，请在上方切换其它模型来源）`;
}

let chromeAiPollTimer = null;
function stopChromeAIPoll() { if (chromeAiPollTimer) { clearInterval(chromeAiPollTimer); chromeAiPollTimer = null; } }

// 仅查询可用性（不下载、不轮询等待下载）
async function refreshChromeAIStatus() {
  const box = $('check-chrome');
  try {
    const a = await queryActiveTabChromeAI('chromeAiAvailability');
    renderChromeAIStatus(box, a);
    return a;
  } catch (e) {
    box.className = 'test-status err';
    box.textContent = '❌ ' + e.message;
    return null;
  }
}

// 检查 Chrome 内置 AI 可用性（切到面板时自动调用；点击按钮仅重新查询）
function checkChromeAIStatus() {
  const box = $('check-chrome');
  box.style.display = 'block';
  box.className = 'test-status'; box.style.background = '#eef'; box.style.color = '#555';
  box.textContent = '⏳ 正在检查 Chrome 内置 AI…';
  refreshChromeAIStatus();
}

// 「检查 Chrome 内置模型」按钮：仅查询可用性，绝不触发 1.5GB 下载
$('chrome-check').addEventListener('click', () => {
  checkChromeAIStatus();
});

modelSelect.addEventListener('change', () => switchModelPanel(modelSelect.value));
delaySlider.addEventListener('input', () => (delayValue.textContent = delaySlider.value));
maxLenSlider.addEventListener('input', () => (maxLenValue.textContent = maxLenSlider.value));
maxOutSlider.addEventListener('input', () => (maxOutValue.textContent = maxOutSlider.value));
maxLocalSlider.addEventListener('input', () => (maxLocalValue.textContent = maxLocalSlider.value));
hideSlider.addEventListener('input', () => (hideValue.textContent = hideSlider.value));
// 语言（顶部一排）：切换即时落盘 + 界面本地化即时生效
uiLang.addEventListener('change', () => {
  chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => flashStatus('✅ 语言已切换'));
  applyPopupI18n(resolveLang(uiLang.value));
});
// 主题（顶部一排）：切换即时落盘
theme.addEventListener('change', () => {
  chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => flashStatus('✅ 主题已切换'));
});

// 加载已保存配置（深合并）
chrome.storage.sync.get('hoverSummaryConfig', (data) => {
  const cfg = Object.assign({}, DEFAULT_CONFIG, data.hoverSummaryConfig || {});
  cfg.agnes = Object.assign({}, DEFAULT_CONFIG.agnes, cfg.agnes || {});
  cfg.nvidia = Object.assign({}, DEFAULT_CONFIG.nvidia, cfg.nvidia || {});
  cfg.local = Object.assign({}, DEFAULT_CONFIG.local, cfg.local || {});
  cfg.public = Object.assign({}, DEFAULT_CONFIG.public, cfg.public || {});

  enabled.checked = cfg.enabled !== false;
  modelSelect.value = cfg.model || 'chrome';
  theme.value = cfg.theme || 'auto';
  triggerMode.value = cfg.triggerMode || 'select';
  delaySlider.value = cfg.hoverDelay || 800;
  delayValue.textContent = delaySlider.value;
  maxLenSlider.value = cfg.maxLength || 2000;
  maxLenValue.textContent = maxLenSlider.value;
  maxOutSlider.value = cfg.maxOutput || 800;
  maxOutValue.textContent = maxOutSlider.value;
  maxLocalSlider.value = cfg.maxLocalInput || 1500;
  maxLocalValue.textContent = maxLocalSlider.value;
  // 语言：优先 lang，旧存储仅有 outputLang 时沿用（向后兼容）；加载即应用界面本地化
  const stored = data.hoverSummaryConfig || {};
  const savedLang = stored.lang || stored.outputLang || cfg.lang || DEFAULT_CONFIG.lang || 'auto';
  uiLang.value = savedLang;
  applyPopupI18n(resolveLang(savedLang));
  hideSlider.value = cfg.bubbleHideDelay || 3000;
  hideValue.textContent = hideSlider.value;

  $('agnes-key').value = cfg.agnes.apiKey || '';
  $('agnes-model').value = cfg.agnes.model || 'agnes-2.0-flash';
  $('nvidia-key').value = cfg.nvidia.apiKey || '';
  $('nvidia-model').value = cfg.nvidia.model || 'openai/gpt-oss-120b';
  $('local-endpoint').value = cfg.local.endpoint || '';
  savedLocalModel = cfg.local.model || '';
  // 不在此处拉取模型列表：仅当用户选择/已选择“本地模型”时才探测（见 switchModelPanel）
  $('public-endpoint').value = cfg.public.endpoint || DEFAULT_CONFIG.public.endpoint;
  $('public-model').value = cfg.public.model || DEFAULT_CONFIG.public.model;
  $('public-key').value = cfg.public.apiKey || '';
  const preset = cfg.public.preset || 'deepseek';
  $('public-preset').value = preset;
  $('public-key-hint').textContent = (PUBLIC_PRESETS_UI[preset] && PUBLIC_PRESETS_UI[preset].keyHint) || '';

  $('dup-check').checked = cfg.duplicateCheck !== false;
  $('dup-endpoint').value = cfg.duplicateEndpoint || 'http://127.0.0.1:8765';

  switchModelPanel(cfg.model || 'chrome');
});

// 公开大模型预设切换：自动填充端点 / 模型名 / Key 提示
$('public-preset').addEventListener('change', () => {
  const p = $('public-preset').value;
  const ui = PUBLIC_PRESETS_UI[p];
  if (!ui) return;
  $('public-endpoint').value = ui.endpoint;
  $('public-model').value = ui.model;
  $('public-key-hint').textContent = ui.keyHint || '';
});

// 本地模型：重新探测 / 刷新列表（端点手改后也重新探测）
$('local-refresh').addEventListener('click', () => detectAndRefreshLocal());
$('local-endpoint').addEventListener('change', () => detectAndRefreshLocal());
// 用户在下拉框选中模型后，记住这次选择（探测刷新时保持选中）
$('local-model').addEventListener('change', () => { savedLocalModel = $('local-model').value; });

// 本地 oMLX：确认并加载选中的单个模型（写入设置 + 预热载入 oMLX 内存，避免无关模型占用内存）
$('local-load').addEventListener('click', () => {
  const box = $('load-local');
  const model = $('local-model').value.trim();
  const endpoint = $('local-endpoint').value.trim() || DEFAULT_CONFIG.local.endpoint;
  if (!model) {
    box.className = 'test-status err';
    box.textContent = '❌ 请先在下拉框选择一个模型';
    return;
  }
  // 1) 先把选中的模型写入配置（与“保存设置”等效）
  chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => flashStatus('✅ 已保存：' + model));
  // 2) 触发 oMLX 只加载该模型
  box.className = 'test-status';
  box.textContent = '⏳ 正在加载「' + model + '」…';
  box.classList.add('ok');
  box.style.background = '#eef'; box.style.color = '#555';
  chrome.runtime.sendMessage({ action: 'loadLocalModel', endpoint, model }, (resp) => {
    if (chrome.runtime.lastError) {
      box.className = 'test-status err';
      box.textContent = '❌ ' + chrome.runtime.lastError.message;
      return;
    }
    if (resp && resp.ok) {
      box.className = 'test-status ok';
      box.textContent = `✅ 已加载并确认：「${model}」（加载耗时 ${resp.latency}s）。之后总结只用此模型。`;
    } else {
      box.className = 'test-status err';
      box.textContent = '❌ 加载失败：' + ((resp && resp.error) || '未知错误') + '（设置已保存，可重试）';
    }
  });
});

// 从当前 UI 收集完整配置（保存 / 开关即时生效共用）
function collectConfig() {
  return {
    enabled: enabled.checked,
    model: modelSelect.value,
    theme: theme.value,
    maxLength: parseInt(maxLenSlider.value, 10),
    maxOutput: parseInt(maxOutSlider.value, 10),
    maxLocalInput: parseInt(maxLocalSlider.value, 10),
    hoverDelay: parseInt(delaySlider.value, 10),
    lang: uiLang.value,
    outputLang: resolveLang(uiLang.value), // 解析后的有效输出语言，随存储下发，供 content.js 直接取用
    bubbleHideDelay: parseInt(hideSlider.value, 10),
    triggerMode: triggerMode.value,
    duplicateCheck: $('dup-check').checked,
    duplicateEndpoint: $('dup-endpoint').value.trim() || 'http://127.0.0.1:8765',
    agnes: {
      endpoint: DEFAULT_CONFIG.agnes.endpoint,
      apiKey: $('agnes-key').value.trim(),
      model: $('agnes-model').value.trim() || DEFAULT_CONFIG.agnes.model
    },
    nvidia: {
      endpoint: DEFAULT_CONFIG.nvidia.endpoint,
      apiKey: $('nvidia-key').value.trim(),
      model: $('nvidia-model').value
    },
    local: {
      endpoint: $('local-endpoint').value.trim() || DEFAULT_CONFIG.local.endpoint,
      apiKey: '',
      model: $('local-model').value.trim() // 不预设：为空则总结时提示先选择模型
    },
    chrome: {}, // 无需任何字段
    public: {
      preset: $('public-preset').value,
      endpoint: $('public-endpoint').value.trim() || DEFAULT_CONFIG.public.endpoint,
      apiKey: $('public-key').value.trim(),
      model: $('public-model').value.trim() || DEFAULT_CONFIG.public.model
    }
  };
}

function flashStatus(msg) {
  statusEl.textContent = msg || '✅ 已保存';
  statusEl.classList.add('show');
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(() => statusEl.classList.remove('show'), 2000);
}

// 保存
saveBtn.addEventListener('click', () => {
  const cfg = collectConfig();
  chrome.storage.sync.set({ hoverSummaryConfig: cfg }, () => {
    if (cfg.model === 'local' && !cfg.local.model) {
      flashStatus('⚠️ 已保存，但尚未选择本地模型');
    } else {
      flashStatus('✅ 已保存');
    }
  });
});

// 开关即时生效：点击即落盘（content.js 通过 storage.onChanged 实时更新启用/换皮状态）
enabled.addEventListener('change', () => {
  chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => flashStatus('✅ 已生效'));
});
$('dup-check').addEventListener('change', () => {
  chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => flashStatus('✅ 已生效'));
});

// 测试连接
document.querySelectorAll('.test-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const provider = btn.dataset.provider;
    const box = $('test-' + provider);
    box.className = 'test-status';
    box.textContent = '⏳ 测试中…';
    box.classList.add('ok'); // 仅用于显示（颜色稍后覆盖）
    box.style.background = '#eef'; box.style.color = '#555';
    chrome.runtime.sendMessage({ action: 'testConnection', provider }, (resp) => {
      if (chrome.runtime.lastError) {
        box.className = 'test-status err';
        box.textContent = '❌ ' + chrome.runtime.lastError.message;
        return;
      }
      if (resp && resp.ok) {
        box.className = 'test-status ok';
        box.textContent = `✅ 连接成功（${resp.model || ''}，${resp.latency}s）`;
      } else {
        box.className = 'test-status err';
        box.textContent = '❌ ' + ((resp && resp.error) || '未知错误');
      }
    });
  });
});

// ⚡ 公开大模型「测速并选用最快」：实测候选模型延迟，自动选最快且可用的写入配置
$('speed-test').addEventListener('click', () => {
  const box = $('speed-public');
  box.className = 'test-status';
  box.textContent = '⏳ 正在测速（对每个候选模型发一次请求）…';
  box.classList.add('ok');
  box.style.background = '#eef'; box.style.color = '#555';
  const endpoint = $('public-endpoint').value.trim() || DEFAULT_CONFIG.public.endpoint;
  const apiKey = $('public-key').value.trim();
  const preset = $('public-preset').value;
  chrome.runtime.sendMessage({ action: 'speedTestPublic', opts: { preset, endpoint, apiKey } }, (resp) => {
    if (chrome.runtime.lastError) {
      box.className = 'test-status err';
      box.textContent = '❌ ' + chrome.runtime.lastError.message;
      return;
    }
    if (!resp || !resp.ok) {
      box.className = 'test-status err';
      box.textContent = '❌ ' + ((resp && resp.error) || '测速失败');
      return;
    }
    const rows = (resp.results || []).map((r) => `${r.model}: ${r.ok ? r.latency + 's' : '✗'}`);
    if (resp.fastest) {
      const fast = resp.results.find((r) => r.model === resp.fastest);
      $('public-model').value = resp.fastest;
      if (modelSelect.value !== 'public') {
        modelSelect.value = 'public';
        switchModelPanel('public');
      }
      // 立即落盘，下次总结直接用最快模型
      chrome.storage.sync.set({ hoverSummaryConfig: collectConfig() }, () => {
        box.className = 'test-status ok';
        box.textContent = `⚡ 最快可用：${resp.fastest}（${fast.latency}s）。已写入并选中「公开大模型」。  明细：${rows.join('  ·  ')}`;
        flashStatus('⚡ 已选用 ' + resp.fastest);
      });
    } else {
      box.className = 'test-status err';
      box.textContent = '⚠️ 所有候选模型均不可用，请检查端点。  明细：' + rows.join('  ·  ');
    }
  });
});
