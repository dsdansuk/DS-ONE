(() => {
  "use strict";

  // DS ONE 업무 AI Agent 기능 레이어
  // - 메인 index.html 요소와 style.css 디자인은 건드리지 않고 기능만 런타임으로 연결합니다.
  // - 그룹웨어 iframe에서는 108x108 런처 버튼만 표시합니다.

  const CONFIG = window.DS_ONE_CONFIG || {};
  const ENDPOINTS = CONFIG.endpoints || {};
  const STORAGE = CONFIG.storage || {};
  const FILE_POLICY = CONFIG.filePolicy || {};

  const AI_API_URL = ENDPOINTS.aiApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/ai-api";
  const AGENT_API_URL = ENDPOINTS.agentApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/agent-api";
  const FILE_API_URL = ENDPOINTS.fileApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/file-api";
  const PDF_API_URL = ENDPOINTS.pdfApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/pdf-api";
  const RPA_API_URL = ENDPOINTS.rpaApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/rpa-api";
  const SESSION_TOKEN_KEY = "sso_session_token";
  const PERSISTED_SESSION_TOKEN_KEY = STORAGE.persistedSessionTokenKey || "ds_one_sso_token_cache_v1";
  const LAST_IDENTITY_KEY = STORAGE.lastIdentityKey || "ds_one_last_identity_v1";
  const SESSION_TOKEN_CACHE_TTL_MS = Number(STORAGE.sessionTokenCacheTtlMs || 12 * 60 * 60 * 1000);
  const LAST_IDENTITY_CACHE_TTL_MS = Number(STORAGE.lastIdentityCacheTtlMs || 30 * 24 * 60 * 60 * 1000);
  const SESSION_REFRESH_LEEWAY_MS = Number(STORAGE.sessionRefreshLeewayMs || 10 * 60 * 1000);
  const FEATURE_MODE_KEY = STORAGE.featureModeKey || "ds_one_active_feature_mode_v1";
  const DISPLAY_NAME_CACHE_KEY = STORAGE.displayNameCacheKey || "ds_chatbot_last_display_name_v1";
  const DISPLAY_NAME_CACHE_TTL_MS = Number(STORAGE.displayNameCacheTtlMs || 7 * 24 * 60 * 60 * 1000);
  const LOCAL_HISTORY_PREFIX = "ds_one_platform_recent_messages_v2_";
  const RECENT_WORK_PREFIX = STORAGE.recentWorkPrefix || "ds_one_platform_recent_work_v1_";
  const MAX_HISTORY = Number(STORAGE.agentHistoryCacheMaxMessages || 20);
  const MAX_RECENT_WORK = Number(STORAGE.recentWorkMaxItems || 50);
  const MAX_STORED_CONVERSATION_MESSAGES = Number(STORAGE.recentWorkMaxMessages || 24);
  const REMOTE_SESSION_REFRESH_DEBOUNCE_MS = 700;
  const REMOTE_SESSION_LIST_LIMIT = Math.max(MAX_RECENT_WORK, 20);

  const ALLOWED_EXTENSIONS = (FILE_POLICY.allowedExtensions || ["txt", "md", "csv", "json", "docx", "xlsx", "pptx", "pdf"])
    .map((value) => String(value || "").toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  const BLOCKED_EXTENSIONS = new Set((FILE_POLICY.blockedExtensions || ["exe", "dll", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "mjs", "jar", "sh", "php", "asp", "aspx", "jsp", "html", "htm", "xml", "doc", "xls", "ppt", "docm", "xlsm", "pptm", "hwp", "hwpx", "zip", "7z", "rar", "tar", "gz"])
    .map((value) => String(value || "").toLowerCase().replace(/^\./, ""))
    .filter(Boolean));
  const MAX_FILE_SIZE_BYTES = Number(FILE_POLICY.maxFileSizeBytes || 50 * 1024 * 1024);

  let sessionToken = "";
  let selectedFiles = [];
  let submitInProgress = false;
  let currentTask = "";
  let currentLoginId = "";
  let currentEmpNo = "";
  let currentMode = "home";
  let currentFeature = "agent";
  let activeConversationId = "";
  let recentContextMenu = null;
  let recentRemoteRefreshTimer = 0;
  let recentRemoteRefreshInProgress = false;
  let recentRemoteEverLoaded = false;
  let remoteSessionCreatePromise = null;
  let remoteSessionCreateConversationId = "";
  let chatSearchDialog = null;
  let chatSearchDebounceTimer = 0;
  let chatSearchRequestSeq = 0;
  let activeConversationHighlightQuery = "";
  let authBootstrapPromise = null;
  let sessionRefreshPromise = null;
  const CHAT_SEARCH_DEBOUNCE_MS = 420;

  const state = {
    homePanel: null,
    homeContent: null,
    docPanel: null,
    homePromptInput: null,
    homeSendBtn: null,
    homeAttachBtn: null,
    homeFileChips: null,
    fileInput: null,
    agentBody: null,
    agentForm: null,
    agentMessageInput: null,
    agentSendBtn: null,
    agentAttachBtn: null,
    agentFileChips: null,
    agentNewChatBtn: null,
    docBackBtn: null,
    profileName: null,
    profileAvatar: null,
    recentList: null,
    lowerRecentList: null,
    searchMenuButton: null,
    productSwitch: null,
    productModeButton: null,
    productModeIcon: null,
    productModeLabel: null,
    productModeMenu: null,
    heroTitle: null,
    heroSubtitle: null,
    promptCard: null,
    actionCards: [],
    agentDisclaimer: null,
  };

  const FEATURE_PROFILES = {
    agent: {
      label: "업무 AI Agent",
      shortLabel: "업무 AI",
      switchIcon: "i-star",
      title: "무엇을 도와드릴까요?",
      subtitle: "업무에 필요한 다양한 작업을 AI가 빠르고 정확하게 도와드립니다.",
      placeholder: "메시지를 입력하세요.   (예: 회의록 요약해줘)",
      disclaimer: "AI 답변은 참고용입니다. 중요한 업무에는 근거와 원문을 확인해 주세요.",
      attachEnabled: true,
      cards: [
        { iconClass: "doc", iconText: "▤", title: "문서 작성", desc: "기획서, 보고서, 메일<br>초안 작성 등", task: "document_draft", attach: false, template: "아래 내용을 바탕으로 업무용 문서 초안을 작성해 주세요.\n\n[작성할 내용]\n" },
        { iconClass: "summary", iconText: "≡", title: "문서 요약", desc: "긴 문서나 회의 내용을<br>핵심만 요약", task: "document_summary", attach: false, template: "아래 내용을 핵심만 간결하게 요약해 주세요.\n\n[요약할 내용]\n" },
        { iconClass: "translate", iconText: "A", title: "문서 번역", desc: "다국어 문서를<br>자연스럽게 번역", task: "translation", attach: false, template: "아래 문서를 자연스러운 업무 문체로 번역해 주세요.\n\n[번역할 내용]\n" },
        { iconClass: "excel", iconText: "X", title: "엑셀 분석", desc: "데이터 분석 및<br>시각화, 인사이트 도출", task: "excel_analysis", attach: true, template: "첨부한 엑셀 파일의 전체 구조를 요약하고 핵심 이슈를 분석해 주세요." },
        { iconClass: "file", iconText: "▰", title: "PDF 분석", desc: "근거 페이지 기반<br>정밀 분석 및 질문", task: "pdf_analysis", attach: true, template: "첨부한 PDF를 원문 근거와 페이지를 표시하여 정확하게 분석해 주세요.\n\n[질문]\n" },
        { iconClass: "report", iconText: "▥", title: "PPT 생성", desc: "보고서 구조화 및<br>핵심 내용 정리", task: "report_summary", attach: false, disabled: true, disabledLabel: "준비 중", disabledReason: "PPT 생성 기능은 현재 준비 중입니다.", template: "아래 내용을 보고용으로 정리해 주세요. 형식은 결론, 핵심 내용, 이슈/리스크, 다음 조치로 작성해 주세요.\n\n[정리할 내용]\n" },
      ],
    },
    knowledge: {
      label: "사내 지식 문의",
      shortLabel: "사내 지식",
      switchIcon: "i-book",
      title: "사내 업무, 무엇이 궁금하신가요?",
      subtitle: "사내 규정, 업무 절차 및 담당 부서를 빠르게 찾아드립니다.",
      placeholder: "사내 규정, 업무 절차, 담당 부서를 질문하세요.   (예: 출장비 정산 기준 알려줘)",
      disclaimer: "사내 지식 답변은 SideTalk 지식베이스 기준입니다. 중요한 업무에는 담당 부서와 원문을 확인해 주세요.",
      attachEnabled: false,
      cards: [
        { iconClass: "knowledge", iconText: "규", title: "규정·기준", desc: "제도, 기준, 예외<br>적용 여부 확인", task: "knowledge_policy", attach: false, template: "아래 사내 규정 또는 기준을 지식베이스 기준으로 확인해 주세요.\n\n[질문]\n" },
        { iconClass: "knowledge", iconText: "신", title: "신청·결재", desc: "신청서, 결재선,<br>처리 절차 확인", task: "knowledge_request", attach: false, disabled: true, disabledLabel: "준비 중", disabledReason: "신청·결재 기능은 현재 준비 중입니다.", template: "아래 신청 또는 결재 절차를 사내 기준으로 확인해 주세요.\n\n[질문]\n" },
        { iconClass: "knowledge", iconText: "담", title: "담당 부서", desc: "문의처, 담당 기준,<br>연락 부서 확인", task: "knowledge_owner", attach: false, template: "아래 업무의 담당 부서 또는 문의처를 사내 기준으로 확인해 주세요.\n\n[질문]\n" },
        { iconClass: "knowledge", iconText: "시", title: "시스템·권한", desc: "그룹웨어, ERP, ECM<br>계정·권한 확인", task: "knowledge_system_access", attach: false, template: "아래 시스템, 계정 또는 권한 관련 문의를 사내 기준으로 확인해 주세요.\n\n[질문]\n" },
        { iconClass: "knowledge", iconText: "보", title: "보안·개인정보", desc: "파일 공유, 개인정보,<br>보안 기준 확인", task: "knowledge_security", attach: false, template: "아래 보안, 개인정보 또는 파일 처리 기준을 사내 기준으로 확인해 주세요.\n\n[질문]\n" },
        { iconClass: "knowledge", iconText: "휴", title: "근태·복리후생", desc: "휴가, 근태, 복지<br>운영 기준 확인", task: "knowledge_welfare", attach: false, template: "아래 근태, 휴가 또는 복리후생 기준을 사내 기준으로 확인해 주세요.\n\n[질문]\n" },
      ],
    },
  };

  function init() {
    sessionToken = readSsoSessionToken();
    const tokenProfile = decodeSessionTokenPayload(sessionToken);
    if (tokenProfile) {
      applyIdentityFromPayload(tokenProfile);
      applyHeaderProfile(tokenProfile);
      persistLastIdentity(tokenProfile);
    } else {
      restoreCachedIdentity();
    }

    if (isEmbeddedInIframe()) {
      showIframeLauncher(tokenProfile || getCachedIdentity());
      return;
    }

    restoreCachedDisplayName();
    injectRuntimeStyles();
    injectSearchAndDialogStyles();
    attachToExistingHome();
    createRuntimeAgentWorkspace();
    initializeFeatureSwitcher();
    bindUiEvents();
    migrateLegacyRecentWorkByFeature();
    migrateAnonymousRecentWorkToCurrentUser();
    renderRecentWorkList();
    authBootstrapPromise = bootstrapProfile();
    authBootstrapPromise.finally(() => scheduleRemoteRecentRefresh(120));
    normalizeHomeComposerLayout();
    resizeTextarea(state.agentMessageInput);
  }

  function readSsoSessionToken() {
    const url = new URL(window.location.href);
    const tokenFromUrl = String(url.searchParams.get("token") || "").trim();
    if (tokenFromUrl) {
      storeSessionToken(tokenFromUrl, { persistent: true });
      url.searchParams.delete("token");
      url.searchParams.delete("open");
      window.history.replaceState({}, document.title, url.toString());
      return tokenFromUrl;
    }

    const fromSession = String(sessionStorage.getItem(SESSION_TOKEN_KEY) || "").trim();
    if (fromSession) return fromSession;

    const fromLocal = readPersistedSessionToken();
    if (fromLocal) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, fromLocal);
      return fromLocal;
    }
    return "";
  }

  function storeSessionToken(token, options = {}) {
    const value = String(token || "").trim();
    if (!value) return;
    sessionToken = value;
    try { sessionStorage.setItem(SESSION_TOKEN_KEY, value); } catch {}
    const payload = decodeSessionTokenPayload(value);
    if (payload) {
      applyIdentityFromPayload(payload);
      persistLastIdentity(payload);
    }
    if (options.persistent !== false) {
      try {
        localStorage.setItem(PERSISTED_SESSION_TOKEN_KEY, JSON.stringify({ token: value, savedAt: Date.now(), exp: Number(payload?.exp || 0) }));
      } catch {}
    }
  }

  function readPersistedSessionToken() {
    try {
      const raw = localStorage.getItem(PERSISTED_SESSION_TOKEN_KEY);
      if (!raw) return "";
      const data = JSON.parse(raw);
      const token = String(data.token || "").trim();
      if (!token) return "";
      if (Date.now() - Number(data.savedAt || 0) > SESSION_TOKEN_CACHE_TTL_MS) return "";
      return token;
    } catch { return ""; }
  }

  function isEmbeddedInIframe() {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }

  function showIframeLauncher(profile) {
    const displayName = getDisplayName(profile) || getCachedDisplayName() || "DS ONE";
    const targetUrl = buildPlatformOpenUrl();
    document.documentElement.style.width = "108px";
    document.documentElement.style.height = "108px";
    document.body.style.width = "108px";
    document.body.style.height = "108px";
    document.body.style.minWidth = "0";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    document.body.style.background = "transparent";
    document.body.innerHTML = `
      <button id="dsOneOpenButton" type="button" aria-label="DS ONE 업무 AI 새 탭 열기" title="DS ONE 업무 AI 새 탭 열기">
        <span class="ds-one-btn-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" focusable="false">
            <path d="M24 5 40.5 14.5v19L24 43 7.5 33.5v-19L24 5Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>
            <path d="M24 13.5 33.2 18.8v10.4L24 34.5l-9.2-5.3V18.8L24 13.5Z" fill="currentColor" opacity=".92"/>
          </svg>
        </span>
        <span class="ds-one-btn-text"><strong>DS ONE</strong><em>업무 AI</em></span>
        <span class="ds-one-btn-open" aria-hidden="true">↗</span>
      </button>
      <style>
        #dsOneOpenButton{position:relative;width:108px;height:108px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:10px 8px;border:0;border-radius:22px;color:#fff;background:linear-gradient(145deg,#8ea7ff 0%,#6f87f7 54%,#5f7ff1 100%);box-shadow:0 12px 24px rgba(40,76,190,.24),inset 0 1px 0 rgba(255,255,255,.28);cursor:pointer;overflow:hidden;font-family:Pretendard,'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;transition:transform .16s ease,filter .16s ease,box-shadow .16s ease}#dsOneOpenButton:before{content:"";position:absolute;inset:-38px auto auto -42px;width:110px;height:110px;border-radius:999px;background:rgba(255,255,255,.14)}#dsOneOpenButton:hover{transform:translateY(-1px);filter:saturate(1.05);box-shadow:0 14px 28px rgba(40,76,190,.3),inset 0 1px 0 rgba(255,255,255,.32)}#dsOneOpenButton:active{transform:translateY(0)}.ds-one-btn-icon{position:relative;z-index:1;width:34px;height:34px;display:grid;place-items:center}.ds-one-btn-icon svg{width:34px;height:34px;display:block}.ds-one-btn-text{position:relative;z-index:1;display:grid;gap:0;text-align:center;line-height:1.04;text-shadow:0 2px 7px rgba(22,43,120,.18)}.ds-one-btn-text strong{font-size:16px;font-weight:900;letter-spacing:-.02em}.ds-one-btn-text em{font-style:normal;font-size:13px;font-weight:850;letter-spacing:-.03em}.ds-one-btn-open{position:absolute;right:8px;top:7px;z-index:1;font-size:13px;font-weight:900;opacity:.9}.ds-one-fallback{position:absolute;inset:0;display:grid;place-items:center;padding:10px;text-align:center;color:#fff;font-size:12px;font-weight:800;text-decoration:none;background:linear-gradient(145deg,#2f6fed,#7da8ff);border-radius:22px}
      </style>
    `;

    document.getElementById("dsOneOpenButton")?.addEventListener("click", () => {
      const popup = window.open(targetUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        const link = document.createElement("a");
        link.href = targetUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "ds-one-fallback";
        link.textContent = `${displayName}님, 여기를 눌러 새 탭으로 열기`;
        document.body.appendChild(link);
      }
    });
  }

  function buildPlatformOpenUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("launcher");
    url.searchParams.set("open", "platform");
    if (sessionToken) url.searchParams.set("token", sessionToken);
    return url.toString();
  }

  function injectRuntimeStyles() {
    if (document.getElementById("ds-one-agent-runtime-style")) return;
    const style = document.createElement("style");
    style.id = "ds-one-agent-runtime-style";
    style.textContent = `
      .prompt-card.ds-home-empty textarea {
        height: 46px !important;
        min-height: 46px !important;
        overflow-y: hidden !important;
      }
      .prompt-card.ds-home-empty {
        min-height: clamp(132px, 14.8dvh, 158px);
        grid-template-rows: auto auto;
      }
      .home-stage.ds-agent-mode {
        justify-content: stretch;
        align-items: stretch;
        padding: 0;
        background:
          radial-gradient(circle at 82% 8%, rgba(99, 142, 255, 0.08), transparent 30%),
          linear-gradient(180deg, #fbfdff 0%, #ffffff 48%, #ffffff 100%);
      }
      .home-stage.ds-agent-mode::before,
      .home-stage.ds-agent-mode::after { display: none !important; }
      .home-stage.ds-agent-mode .home-fit[hidden],
      .ds-agent-workspace[hidden] { display: none !important; }
      .ds-agent-workspace {
        position: relative;
        z-index: 2;
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        min-height: 0;
        height: 100%;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        padding: 0 clamp(18px, 4vw, 72px) clamp(12px, 2dvh, 22px);
        overflow: hidden;
      }
      .ds-agent-body {
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 22px;
        overflow-y: auto;
        padding: clamp(28px, 7dvh, 78px) 0 28px;
        scrollbar-width: thin;
      }
      .ds-chat-row,
      .ds-thinking-row {
        width: min(900px, 100%);
        display: flex;
        gap: 12px;
        margin: 0 auto;
      }
      .ds-user-row { justify-content: flex-end; }
      .ds-bot-row { justify-content: flex-start; align-items: flex-start; }
      .ds-chat-avatar {
        width: 30px;
        height: 30px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        margin-top: 2px;
        color: #fff;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: -0.02em;
        border-radius: 10px;
        background: linear-gradient(145deg, #2f6fed, #80a7ff);
        box-shadow: 0 10px 24px rgba(47, 111, 237, 0.18);
      }
      .ds-msg {
        max-width: min(720px, calc(100% - 48px));
        font-size: 15px;
        line-height: 1.76;
        word-break: keep-all;
        overflow-wrap: anywhere;
      }
      .ds-msg.user {
        padding: 12px 16px;
        color: #111827;
        background: #f3f4f6;
        border: 1px solid rgba(226, 232, 240, 0.85);
        border-radius: 20px 20px 6px 20px;
        box-shadow: 0 8px 22px rgba(17, 24, 39, 0.04);
        white-space: pre-wrap;
      }
      .ds-msg.bot {
        max-width: min(820px, 100%);
        padding: 0;
        color: #202124;
        background: transparent;
      }
      .ds-thinking-row .ds-msg {
        padding: 0;
        color: #8b95a8;
        background: transparent;
        border: 0;
      }
      .ds-thinking-dots {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding-top: 4px;
      }
      .ds-thinking-dots i {
        width: 6px;
        height: 6px;
        display: block;
        border-radius: 999px;
        background: #9aa8bd;
        animation: dsThinkingPulse 1.25s ease-in-out infinite;
      }
      .ds-thinking-dots i:nth-child(2) { animation-delay: .15s; }
      .ds-thinking-dots i:nth-child(3) { animation-delay: .3s; }
      @keyframes dsThinkingPulse { 0%, 80%, 100% { opacity: .35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
      .ds-msg-heading {
        margin: 24px 0 10px;
        font-size: 17px;
        line-height: 1.45;
        font-weight: 900;
        letter-spacing: -0.035em;
        color: #121827;
      }
      .ds-msg-heading:first-child { margin-top: 0; }
      .ds-msg-heading::before {
        content: "";
        display: inline-block;
        width: 5px;
        height: 5px;
        margin: 0 8px 3px 0;
        border-radius: 999px;
        background: #2f6fed;
      }
      .ds-msg-paragraph,
      .ds-msg-line {
        margin: 0 0 12px;
        color: #202937;
      }
      .ds-msg-paragraph:last-child,
      .ds-msg-line:last-child { margin-bottom: 0; }
      .ds-msg-spacer { height: 6px; }
      .ds-msg-bullet,
      .ds-msg-numbered {
        position: relative;
        margin: 5px 0;
        padding-left: 18px;
        color: #253146;
      }
      .ds-msg-bullet::before {
        content: "";
        position: absolute;
        left: 4px;
        top: .82em;
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: #6b8ff7;
      }
      .ds-msg-numbered .ds-num {
        position: absolute;
        left: 0;
        color: #2f6fed;
        font-weight: 900;
      }
      .ds-msg-quote {
        margin: 10px 0 14px;
        padding: 10px 14px;
        color: #3e4c63;
        background: #f8fbff;
        border-left: 3px solid #8fb3ff;
        border-radius: 0 12px 12px 0;
      }
      .ds-pdf-evidence {
        margin: 16px 0 2px;
        border-top: 1px solid #e7edf7;
      }
      .ds-pdf-evidence > summary {
        position: relative;
        display: flex;
        align-items: center;
        min-height: 42px;
        padding: 10px 30px 10px 2px;
        color: #53627a;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        list-style: none;
        user-select: none;
      }
      .ds-pdf-evidence > summary::-webkit-details-marker { display: none; }
      .ds-pdf-evidence > summary::after {
        content: "";
        position: absolute;
        right: 6px;
        width: 7px;
        height: 7px;
        border-right: 1.8px solid #7d8aa1;
        border-bottom: 1.8px solid #7d8aa1;
        transform: rotate(45deg) translateY(-2px);
        transition: transform .18s ease;
      }
      .ds-pdf-evidence[open] > summary::after {
        transform: rotate(225deg) translate(-1px, -1px);
      }
      .ds-pdf-evidence-body {
        margin: 0 0 8px;
        padding: 12px 14px;
        color: #475569;
        background: #f8fafc;
        border: 1px solid #e6ecf5;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.68;
      }
      .ds-pdf-evidence-body .ds-msg-bullet { margin: 4px 0; }
      .ds-pdf-evidence-body .ds-msg-quote {
        margin: 6px 0 12px;
        padding: 8px 12px;
        font-size: 12px;
      }
      .ds-msg-codeblock {
        margin: 12px 0 16px;
        padding: 14px 16px;
        overflow: auto;
        color: #e5e7eb;
        background: #111827;
        border-radius: 14px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 13px;
        line-height: 1.65;
        white-space: pre;
      }
      .ds-msg code {
        padding: 2px 5px;
        color: #1e4eb3;
        background: #eef5ff;
        border-radius: 6px;
        font-size: .92em;
      }
      .ds-msg-image {
        width: min(520px, 100%);
        margin: 12px 0 16px;
      }
      .ds-msg-image-link {
        display: block;
        color: inherit;
        text-decoration: none;
      }
      .ds-msg-image img {
        display: block;
        width: 100%;
        max-height: 360px;
        object-fit: contain;
        background: #fff;
        border: 1px solid #e0e7f3;
        border-radius: 8px;
        box-shadow: 0 12px 28px rgba(37, 48, 77, 0.08);
      }
      .ds-msg-image-caption {
        margin-top: 6px;
        color: #66758c;
        font-size: 12px;
        line-height: 1.45;
      }
      .ds-msg-image-fallback {
        display: none;
        margin-top: 6px;
        color: #2f5fb6;
        font-size: 12px;
        font-weight: 800;
        text-decoration: none;
      }
      .ds-msg-image.is-error .ds-msg-image-fallback { display: inline-flex; }
      .ds-msg-table-wrap { margin: 14px 0 20px; }
      .ds-msg-table-toolbar {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        min-height: 30px;
        margin-bottom: 8px;
      }
      .ds-msg-table-toolbar button,
      .ds-bot-copy-btn {
        min-width: max-content;
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 11px;
        color: #2f5fb6;
        font-size: 12px;
        font-weight: 850;
        line-height: 1;
        white-space: nowrap;
        background: rgba(238, 245, 255, 0.92);
        border: 1px solid #d8e6ff;
        border-radius: 999px;
        box-shadow: 0 6px 16px rgba(47, 111, 237, 0.08);
      }
      .ds-msg-table-toolbar button svg,
      .ds-bot-copy-btn svg {
        width: 14px;
        height: 14px;
        display: block;
        flex: 0 0 auto;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .ds-msg-table-toolbar button:hover,
      .ds-bot-copy-btn:hover {
        color: #1d4ed8;
        background: #e8f1ff;
        border-color: #bcd3ff;
      }
      .ds-msg-table-scroll {
        max-width: 100%;
        overflow: auto;
        border: 1px solid #e0e7f3;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 10px 26px rgba(37, 48, 77, 0.05);
      }
      .ds-msg-table {
        width: max-content;
        min-width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .ds-msg-table th,
      .ds-msg-table td {
        padding: 9px 11px;
        border-bottom: 1px solid #edf1f7;
        text-align: left;
        vertical-align: top;
        white-space: nowrap;
      }
      .ds-msg-table th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: #f5f8fd;
        font-weight: 900;
        color: #263146;
      }
      .ds-bot-message-stack {
        max-width: min(760px, calc(100% - 48px));
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
      }
      .ds-bot-message-stack > .ds-msg {
        max-width: 100%;
      }
      .ds-bot-actions {
        min-height: 34px;
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding-left: 2px;
        opacity: 0;
        transform: translateY(-2px);
        transition: opacity .16s ease, transform .16s ease;
      }
      .ds-bot-row:hover .ds-bot-actions,
      .ds-bot-actions:focus-within,
      .ds-bot-row.is-search-hit .ds-bot-actions {
        opacity: .96;
        transform: translateY(0);
      }
      .ds-bot-copy-btn {
        color: #63718a;
        background: transparent;
        border-color: transparent;
        box-shadow: none;
      }
      .ds-bot-copy-btn:hover,
      .ds-bot-copy-btn:focus-visible {
        color: #2f5fb6;
        background: #eef5ff;
        border-color: #d8e6ff;
        outline: none;
      }
      .ds-agent-composer {
        width: min(860px, 100%);
        margin: 0 auto;
        display: grid;
        gap: 8px;
      }
      .ds-file-chip-row,
      .ds-home-file-chip-row { display: flex; flex-wrap: wrap; gap: 7px; }
      .ds-file-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        max-width: 260px;
        min-height: 30px;
        padding: 5px 8px;
        color: #29456f;
        background: #eef5ff;
        border: 1px solid #d8e6ff;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 750;
      }
      .ds-file-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ds-file-chip em { font-style: normal; color: #6a7690; font-weight: 700; }
      .ds-file-chip button {
        width: 20px;
        height: 20px;
        display: grid;
        place-items: center;
        color: #6a7690;
        background: #fff;
        border: 1px solid #d8e6ff;
        border-radius: 999px;
      }
      .ds-agent-input-row {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 10px;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid #dfe7f2;
        border-radius: 20px;
        box-shadow: 0 18px 40px rgba(37, 48, 77, 0.10);
        backdrop-filter: blur(14px);
      }
      .ds-attach-btn,
      .ds-agent-send-btn {
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        color: #2f5fb6;
        background: #f2f7ff;
        border: 1px solid #d8e6ff;
        border-radius: 13px;
      }
      .ds-agent-send-btn {
        color: #fff;
        background: linear-gradient(145deg, var(--blue, #2f6fed), #7da8ff);
        border-color: transparent;
        box-shadow: 0 10px 20px rgba(47, 111, 237, 0.22);
      }
      .ds-agent-input-row textarea {
        min-height: 40px;
        max-height: 160px;
        flex: 1;
        resize: none;
        border: 0;
        outline: 0;
        background: transparent;
        color: #1b2332;
        font: inherit;
        line-height: 1.5;
        padding: 8px 4px;
      }
      .ds-agent-disclaimer { margin: 0; color: #8a93a5; font-size: 12px; text-align: center; }
      .ds-recent-empty {
        width: calc(100% - 8px);
        min-height: 92px;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        margin: 4px 0 0 0;
        padding: 14px;
        color: #8a93a5;
        font-size: 13px;
        line-height: 1.55;
        text-align: center;
        white-space: pre-line;
        border: 1px dashed #d9e3f3;
        border-radius: 16px;
        background: rgba(248, 251, 255, 0.74);
      }
      .recent-item.is-active {
        background: #eef5ff;
        border-color: #c9dcff;
      }

      .recent-item-wrap {
        position: relative;
        min-width: 0;
        display: flex;
        align-items: stretch;
      }
      .recent-item-wrap .recent-item {
        flex: 1 1 auto;
        min-width: 0;
        padding-right: 42px;
      }
      .recent-item-wrap.is-favorite .recent-item-title::before {
        content: "★ ";
        color: #f6a400;
        font-size: 12px;
      }
      .recent-more-btn {
        position: absolute;
        right: 8px;
        top: 50%;
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.82);
        color: #667083;
        font-size: 18px;
        font-weight: 900;
        line-height: 1;
        opacity: 0;
        transform: translateY(-50%);
        cursor: pointer;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
        transition: opacity 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;
      }
      .recent-item-wrap:hover .recent-more-btn,
      .recent-item-wrap:focus-within .recent-more-btn {
        opacity: 1;
      }
      .recent-more-btn:hover {
        color: #2f6fed;
        background: #ffffff;
        transform: translateY(-50%) scale(1.03);
      }
      .recent-context-menu {
        position: fixed;
        z-index: 9998;
        width: 132px;
        padding: 6px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
        backdrop-filter: blur(12px);
      }
      .recent-context-menu button {
        width: 100%;
        min-height: 32px;
        padding: 0 10px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: #334155;
        font-size: 13px;
        font-weight: 750;
        text-align: left;
        cursor: pointer;
      }
      .recent-context-menu button:hover {
        background: #f1f6ff;
        color: #2f6fed;
      }
      .recent-context-menu button.danger:hover {
        background: #fff1f2;
        color: #e11d48;
      }

      .ds-toast {
        position: fixed;
        left: 50%;
        bottom: 24px;
        z-index: 9999;
        min-width: 220px;
        max-width: min(420px, calc(100vw - 32px));
        padding: 12px 14px;
        color: #fff;
        font-size: 14px;
        font-weight: 800;
        text-align: center;
        background: rgba(20, 28, 44, .92);
        border-radius: 999px;
        box-shadow: 0 14px 36px rgba(0, 0, 0, .18);
        transform: translate(-50%, 12px);
        opacity: 0;
        transition: opacity .18s ease, transform .18s ease;
      }
      .ds-toast.show { opacity: 1; transform: translate(-50%, 0); }
      @media (max-width: 900px) {
        .ds-agent-workspace { padding: 0 14px 12px; }
        .ds-chat-avatar { display: none; }
        .ds-msg { max-width: min(720px, calc(100% - 24px)); }
        .ds-agent-body { padding-top: 28px; }
        .ds-bot-message-stack { max-width: calc(100% - 24px); }
      }
    `;
    document.head.appendChild(style);
  }


  function injectSearchAndDialogStyles() {
    if (document.getElementById("ds-one-search-dialog-style")) return;
    const style = document.createElement("style");
    style.id = "ds-one-search-dialog-style";
    style.textContent = `
      .ds-dialog-backdrop,
      .ds-search-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10020;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(15, 23, 42, .18);
        backdrop-filter: blur(8px);
      }
      .ds-dialog-card,
      .ds-search-card {
        width: min(560px, calc(100vw - 36px));
        color: #101827;
        border: 1px solid rgba(206, 219, 238, .92);
        border-radius: 24px;
        background:
          radial-gradient(circle at 96% 0%, rgba(82, 128, 255, .12), transparent 34%),
          linear-gradient(180deg, rgba(255,255,255,.98), rgba(249,251,255,.98));
        box-shadow: 0 26px 70px rgba(15, 23, 42, .22), inset 0 1px 0 rgba(255,255,255,.86);
        overflow: hidden;
      }
      .ds-dialog-card { padding: 22px; }
      .ds-dialog-head,
      .ds-search-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .ds-dialog-title,
      .ds-search-title {
        margin: 0;
        font-size: 20px;
        line-height: 1.25;
        letter-spacing: -.04em;
        font-weight: 900;
      }
      .ds-dialog-desc,
      .ds-search-desc {
        margin: 7px 0 0;
        color: #64748b;
        font-size: 14px;
        line-height: 1.55;
        font-weight: 650;
      }
      .ds-dialog-close,
      .ds-search-close {
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 34px;
        padding: 0;
        border: 1px solid #dce7f7;
        border-radius: 12px;
        background: rgba(255,255,255,.84);
        color: #64748b;
        font-size: 20px;
        line-height: 1;
        font-weight: 800;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
      }
      .ds-dialog-close > *,
      .ds-search-close > * { pointer-events: none; }
      .ds-dialog-close:hover,
      .ds-search-close:hover { color: #1d4ed8; background: #f1f6ff; }
      .ds-dialog-close,
      .ds-search-close {
        font-size: 0;
        line-height: 0;
      }
      .ds-dialog-close svg,
      .ds-search-close svg {
        width: 15px;
        height: 15px;
        display: block;
        flex: 0 0 auto;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.4;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .ds-dialog-field { margin-top: 20px; }
      .ds-dialog-field label {
        display: block;
        margin-bottom: 8px;
        color: #475569;
        font-size: 13px;
        font-weight: 850;
      }
      .ds-dialog-input,
      .ds-search-input {
        width: 100%;
        height: 50px;
        padding: 0 15px;
        border: 1px solid #dbe7fb;
        border-radius: 16px;
        background: #fff;
        color: #0f172a;
        font-size: 15px;
        font-weight: 700;
        outline: none;
        box-shadow: 0 8px 24px rgba(30, 64, 175, .06);
      }
      .ds-dialog-input:focus,
      .ds-search-input:focus {
        border-color: #8bb6ff;
        box-shadow: 0 0 0 4px rgba(47, 111, 237, .12), 0 10px 26px rgba(30, 64, 175, .08);
      }
      .ds-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 9px;
        margin-top: 22px;
      }
      .ds-dialog-btn {
        min-width: 88px;
        height: 42px;
        padding: 0 16px;
        border-radius: 14px;
        border: 1px solid #dce7f7;
        background: #fff;
        color: #334155;
        font-size: 14px;
        font-weight: 850;
        cursor: pointer;
      }
      .ds-dialog-btn:hover { background: #f8fbff; }
      .ds-dialog-btn.primary {
        border-color: transparent;
        color: #fff;
        background: linear-gradient(135deg, #2f6fed, #7da8ff);
        box-shadow: 0 10px 20px rgba(47, 111, 237, .2);
      }
      .ds-dialog-btn.danger {
        border-color: transparent;
        color: #fff;
        background: linear-gradient(135deg, #ef4444, #fb7185);
        box-shadow: 0 10px 20px rgba(239, 68, 68, .18);
      }
      .ds-search-card {
        width: min(720px, calc(100vw - 36px));
        height: min(680px, calc(100dvh - 48px));
        min-height: min(560px, calc(100dvh - 48px));
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .ds-search-head {
        flex: 0 0 auto;
        padding: 22px 22px 14px;
      }
      .ds-search-input-wrap {
        flex: 0 0 auto;
        padding: 0 22px 16px;
      }
      .ds-search-results {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 8px 12px 14px;
        scrollbar-width: thin;
      }
      .ds-search-results::-webkit-scrollbar { width: 8px; }
      .ds-search-results::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, .45); border-radius: 999px; }
      .ds-search-results::-webkit-scrollbar-track { background: transparent; }
      .ds-search-result {
        width: 100%;
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        padding: 12px 10px;
        border: 0;
        border-radius: 16px;
        background: transparent;
        color: #182235;
        text-align: left;
        cursor: pointer;
      }
      .ds-search-result:hover,
      .ds-search-result:focus-visible { background: #f1f6ff; outline: none; }
      .ds-search-result-icon {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 12px;
        color: #2f6fed;
        background: #eaf2ff;
        font-size: 13px;
        font-weight: 950;
      }
      .ds-search-result-title {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        font-size: 14px;
        font-weight: 900;
        letter-spacing: -.02em;
      }
      .ds-search-result-snippet {
        margin-top: 3px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: #64748b;
        font-size: 12px;
        font-weight: 650;
      }
      .ds-search-result-time { color: #7c8aa5; font-size: 12px; font-weight: 800; }
      .ds-search-empty {
        min-height: 220px;
        padding: 28px 18px 34px;
        color: #7c8aa5;
        text-align: center;
        font-size: 14px;
        font-weight: 750;
        line-height: 1.6;
        display: grid;
        place-items: center;
      }
      .ds-search-loading,
      .ds-search-loading-inline {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #64748b;
        font-size: 13px;
        font-weight: 800;
      }
      .ds-search-loading {
        min-height: 220px;
        padding: 26px 18px;
      }
      .ds-search-loading-inline {
        min-height: 42px;
        margin: 6px 10px 2px;
        border-radius: 14px;
        background: rgba(241, 246, 255, .72);
      }
      .ds-search-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: currentColor;
        opacity: .38;
        animation: ds-search-dot-bounce 1s ease-in-out infinite;
      }
      .ds-search-dot:nth-child(2) { animation-delay: .14s; }
      .ds-search-dot:nth-child(3) { animation-delay: .28s; }
      @keyframes ds-search-dot-bounce {
        0%, 80%, 100% { transform: translateY(0); opacity: .32; }
        40% { transform: translateY(-4px); opacity: .85; }
      }
      .ds-search-highlight,
      .ds-chat-highlight {
        border-radius: 5px;
        background: #fff3bf;
        color: inherit;
        font-weight: 950;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      }
      .ds-chat-row.is-search-hit .ds-msg {
        animation: ds-chat-hit-pulse 1.2s ease;
      }
      @keyframes ds-chat-hit-pulse {
        0% { filter: drop-shadow(0 0 0 rgba(47,111,237,0)); }
        25% { filter: drop-shadow(0 0 10px rgba(47,111,237,.18)); }
        100% { filter: drop-shadow(0 0 0 rgba(47,111,237,0)); }
      }
      @media (max-width: 720px) {
        .ds-dialog-backdrop, .ds-search-backdrop { padding: 14px; }
        .ds-search-card {
          width: min(720px, calc(100vw - 28px));
          height: min(620px, calc(100dvh - 28px));
          min-height: min(500px, calc(100dvh - 28px));
        }
        .ds-search-result { grid-template-columns: 30px minmax(0, 1fr); }
        .ds-search-result-time { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function attachToExistingHome() {
    state.homePanel = document.querySelector(".home-stage");
    state.homeContent = document.querySelector(".home-fit");
    state.homePromptInput = document.querySelector(".prompt-card textarea");
    state.homeSendBtn = document.querySelector(".prompt-card .send-btn");
    state.homeAttachBtn = document.querySelector(".prompt-card .icon-btn");
    state.profileName = document.querySelector(".profile-button strong");
    state.profileAvatar = document.querySelector(".avatar");
    state.recentList = document.querySelector(".recent-list");
    state.lowerRecentList = document.querySelector(".task-list");
    state.productSwitch = document.getElementById("productSwitch");
    state.productModeButton = document.getElementById("productModeButton");
    state.productModeIcon = document.getElementById("productModeIcon");
    state.productModeLabel = document.getElementById("productModeLabel");
    state.productModeMenu = document.getElementById("productModeMenu");
    state.heroTitle = document.querySelector("#home-title, .hero-title, .hero h1");
    state.heroSubtitle = document.querySelector(".hero-copy p, .hero-subtitle, .hero p");
    state.promptCard = document.querySelector(".prompt-card");
    state.actionCards = Array.from(document.querySelectorAll(".action-card"));

    const promptCard = state.promptCard || document.querySelector(".prompt-card");
    if (promptCard && !document.getElementById("dsHomeFileChips")) {
      const chips = document.createElement("div");
      chips.id = "dsHomeFileChips";
      chips.className = "ds-home-file-chip-row";
      chips.hidden = true;
      chips.setAttribute("aria-label", "첨부 파일 목록");
      promptCard.appendChild(chips);
      state.homeFileChips = chips;
    } else {
      state.homeFileChips = document.getElementById("dsHomeFileChips");
    }

    if (!state.fileInput) {
      const input = document.createElement("input");
      input.id = "dsPlatformFileInput";
      input.type = "file";
      input.multiple = true;
      input.hidden = true;
      input.accept = ".txt,.md,.csv,.json,.docx,.xlsx,.pptx,.pdf";
      document.body.appendChild(input);
      state.fileInput = input;
    }
  }

  function createRuntimeAgentWorkspace() {
    if (document.getElementById("dsAgentWorkspace")) return;
    const panel = document.createElement("section");
    panel.id = "dsAgentWorkspace";
    panel.className = "ds-agent-workspace";
    panel.hidden = true;
    panel.setAttribute("aria-label", "업무 AI Agent 대화");
    panel.innerHTML = `
      <div id="dsAgentBody" class="ds-agent-body" aria-live="polite"></div>
      <form id="dsAgentForm" class="ds-agent-composer" autocomplete="off">
        <div id="dsAgentFileChips" class="ds-file-chip-row" hidden aria-label="첨부 파일 목록"></div>
        <div class="ds-agent-input-row">
          <button id="dsAgentAttachBtn" class="ds-attach-btn" type="button" aria-label="파일 첨부" title="파일 첨부">
            <svg class="icon" aria-hidden="true"><use href="#i-clip"></use></svg>
          </button>
          <textarea id="dsAgentMessageInput" rows="1" placeholder="메시지를 입력하세요. Shift+Enter로 줄바꿈"></textarea>
          <button id="dsAgentSendBtn" class="ds-agent-send-btn" type="submit" aria-label="전송">
            <svg class="icon" aria-hidden="true"><use href="#i-send"></use></svg>
          </button>
        </div>
        <p class="ds-agent-disclaimer">AI 답변은 참고용입니다. 중요한 업무에는 근거와 원문을 확인해 주세요.</p>
      </form>
    `;
    const host = state.homePanel || document.querySelector(".home-stage") || document.querySelector(".main-shell") || document.body;
    host.appendChild(panel);
    state.docPanel = panel;
    state.agentBody = document.getElementById("dsAgentBody");
    state.agentForm = document.getElementById("dsAgentForm");
    state.agentMessageInput = document.getElementById("dsAgentMessageInput");
    state.agentSendBtn = document.getElementById("dsAgentSendBtn");
    state.agentAttachBtn = document.getElementById("dsAgentAttachBtn");
    state.agentFileChips = document.getElementById("dsAgentFileChips");
    state.agentNewChatBtn = null;
    state.docBackBtn = null;
    state.agentDisclaimer = panel.querySelector(".ds-agent-disclaimer");
  }

  function normalizeFeatureMode(mode) {
    return mode === "knowledge" ? "knowledge" : "agent";
  }

  function getCurrentFeatureProfile() {
    return FEATURE_PROFILES[normalizeFeatureMode(currentFeature)] || FEATURE_PROFILES.agent;
  }

  function initializeFeatureSwitcher() {
    currentFeature = normalizeFeatureMode(localStorage.getItem(FEATURE_MODE_KEY) || "agent");
    applyFeatureMode(currentFeature, { persist: false, silent: true });
  }

  function bindFeatureSwitcherEvents() {
    const button = state.productModeButton || document.getElementById("productModeButton");
    const menu = state.productModeMenu || document.getElementById("productModeMenu");
    if (!state.productModeButton && button) state.productModeButton = button;
    if (!state.productModeMenu && menu) state.productModeMenu = menu;
    if (!state.productSwitch) state.productSwitch = document.getElementById("productSwitch");
    if (!state.productModeIcon) state.productModeIcon = document.getElementById("productModeIcon");
    if (!state.productModeLabel) state.productModeLabel = document.getElementById("productModeLabel");
    if (!button || !menu || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.querySelectorAll("button[data-feature-mode]").forEach((item) => {
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyFeatureMode(item.getAttribute("data-feature-mode") || "agent", { persist: true });
        menu.hidden = true;
        button.setAttribute("aria-expanded", "false");
      });
    });
  }

  function closeFeatureMenu() {
    if (!state.productModeMenu || !state.productModeButton) return;
    state.productModeMenu.hidden = true;
    state.productModeButton.setAttribute("aria-expanded", "false");
  }

  function applyFeatureMode(mode, options = {}) {
    const nextMode = normalizeFeatureMode(mode);
    const prevMode = currentFeature;
    currentFeature = nextMode;
    const featureChanged = prevMode !== nextMode;
    if (featureChanged) {
      currentTask = "";
      setFileInputAcceptForTask("");
    }
    if (options.persist !== false) {
      try { localStorage.setItem(FEATURE_MODE_KEY, nextMode); } catch {}
    }
    const profile = getCurrentFeatureProfile();
    syncProductModeIcon(nextMode, profile);
    if (state.productModeLabel) state.productModeLabel.textContent = profile.label;
    if (state.productModeButton) state.productModeButton.setAttribute("aria-label", `${profile.label} 선택됨. 기능 변경`);
    state.productModeMenu?.querySelectorAll("button[data-feature-mode]").forEach((item) => {
      item.setAttribute("aria-checked", item.getAttribute("data-feature-mode") === nextMode ? "true" : "false");
    });
    document.body.classList.toggle("is-knowledge-feature", nextMode === "knowledge");
    updateHomeFeatureCopy();
    updateActionCardsForFeature();
    updateAttachmentAvailability();
    if (nextMode === "knowledge" && selectedFiles.length) {
      selectedFiles = [];
      renderFileChips();
      if (!options.silent) showToast("사내 지식 문의는 첨부 파일 없이 지식베이스 기준으로 답변합니다.");
    }
    if (featureChanged && options.resetConversation !== false) {
      resetConversationForFeatureSwitch();
    } else if (featureChanged) {
      renderRecentWorkList();
    }
    if (!options.silent && featureChanged) {
      showToast(`${profile.label} 모드로 전환했습니다.`);
    }
  }

  function syncProductModeIcon(mode, profile = FEATURE_PROFILES.agent) {
    const icon = state.productModeIcon || document.getElementById("productModeIcon");
    if (!icon) return;
    state.productModeIcon = icon;
    const nextMode = normalizeFeatureMode(mode);
    icon.classList.remove("product-mode-icon-agent", "product-mode-icon-knowledge");
    icon.classList.add(`product-mode-icon-${nextMode}`);
    icon.dataset.featureModeIcon = nextMode;
    const use = icon.querySelector("use");
    if (use) use.setAttribute("href", `#${profile.switchIcon || "i-star"}`);
  }

  function resetConversationForFeatureSwitch() {
    closeRecentContextMenu();
    activeConversationId = "";
    activeConversationHighlightQuery = "";
    remoteSessionCreatePromise = null;
    remoteSessionCreateConversationId = "";
    selectedFiles = [];
    renderFileChips();
    clearMessages();
    if (state.agentMessageInput) {
      state.agentMessageInput.value = "";
      resetTextareaVisualState(state.agentMessageInput);
    }
    if (state.homePromptInput) {
      state.homePromptInput.value = "";
      resetTextareaVisualState(state.homePromptInput);
      syncHomePromptEmptyClass();
    }
    setMode("home");
    renderRecentWorkList();
    window.requestAnimationFrame(() => normalizeHomeComposerLayout());
  }

  function updateHomeFeatureCopy() {
    const profile = getCurrentFeatureProfile();
    if (state.heroTitle) {
      const sparkle = state.heroTitle.querySelector(".sparkle")?.outerHTML || '<span class="sparkle">✦</span>';
      state.heroTitle.innerHTML = `${escapeHtml(profile.title)}${sparkle}`;
    }
    if (state.heroSubtitle) state.heroSubtitle.textContent = profile.subtitle;
    if (state.homePromptInput) state.homePromptInput.placeholder = profile.placeholder;
    if (state.agentMessageInput) state.agentMessageInput.placeholder = currentFeature === "knowledge"
      ? "사내 규정, 절차, 기준을 질문하세요. Shift+Enter로 줄바꿈"
      : "메시지를 입력하세요. Shift+Enter로 줄바꿈";
    if (state.agentDisclaimer) state.agentDisclaimer.textContent = profile.disclaimer;
    state.promptCard?.classList.toggle("is-knowledge-mode", currentFeature === "knowledge");
    state.agentForm?.classList.toggle("is-knowledge-mode", currentFeature === "knowledge");
  }

  function updateActionCardsForFeature() {
    const cards = state.actionCards && state.actionCards.length ? state.actionCards : Array.from(document.querySelectorAll(".action-card"));
    state.actionCards = cards;
    const profile = getCurrentFeatureProfile();
    cards.forEach((card, index) => {
      const item = profile.cards[index];
      if (!item) {
        card.hidden = true;
        card.disabled = true;
        card.dataset.featureDisabled = "true";
        return;
      }
      const isDisabled = item.disabled === true;
      card.hidden = false;
      card.disabled = isDisabled;
      card.dataset.featureDisabled = isDisabled ? "true" : "false";
      card.dataset.featureTask = item.task || "";
      card.dataset.featureTemplate = item.template || "";
      card.dataset.featureAttach = item.attach ? "true" : "false";
      card.dataset.featureMode = currentFeature;
      card.classList.toggle("is-disabled", isDisabled);
      card.setAttribute("aria-disabled", isDisabled ? "true" : "false");
      card.title = isDisabled ? (item.disabledReason || `${item.title || "해당"} 기능은 현재 준비 중입니다.`) : "";
      const title = card.querySelector(".card-title");
      const desc = card.querySelector(".card-desc");
      let status = card.querySelector(".card-status");
      if (!status) {
        status = document.createElement("span");
        status.className = "card-status";
        status.setAttribute("aria-hidden", "true");
        card.appendChild(status);
      }
      status.textContent = item.disabledLabel || "준비 중";
      status.hidden = !isDisabled;
      syncActionCardIconVisibility(card, currentFeature);
      if (title) title.textContent = item.title || "업무 요청";
      if (desc) desc.innerHTML = item.desc || "";
    });
  }

  function syncActionCardIconVisibility(card, mode) {
    const icons = Array.from(card.querySelectorAll(".card-mode-icon[data-card-icon-mode]"));
    if (!icons.length) return;
    const nextMode = normalizeFeatureMode(mode);
    icons.forEach((icon) => {
      icon.hidden = icon.dataset.cardIconMode !== nextMode;
    });
  }

  function updateAttachmentAvailability() {
    const disabled = currentFeature === "knowledge";
    [state.homeAttachBtn, state.agentAttachBtn].filter(Boolean).forEach((button) => {
      button.hidden = disabled;
      button.disabled = disabled || submitInProgress;
      button.setAttribute("aria-hidden", disabled ? "true" : "false");
      button.setAttribute("aria-disabled", disabled ? "true" : "false");
      button.tabIndex = disabled ? -1 : 0;
      button.title = disabled ? "" : "파일 첨부";
    });
  }

  function getCurrentConversationTask() {
    if (currentFeature === "knowledge") return "knowledge_inquiry";
    return normalizeTask(currentTask) || currentTask || "general";
  }

  function getCurrentApiRoute() {
    if (currentFeature === "knowledge") return "ai-api";
    if (!selectedFiles.length) return "agent-api";
    return isPdfOnlySelection() ? "pdf-api" : "file-api";
  }

  function isPdfOnlySelection(files = selectedFiles) {
    return files.length > 0 && files.every((file) => getFileExtension(file.name) === "pdf");
  }

  function hasMixedPdfSelection(files = selectedFiles) {
    const hasPdf = files.some((file) => getFileExtension(file.name) === "pdf");
    const hasNonPdf = files.some((file) => getFileExtension(file.name) !== "pdf");
    return hasPdf && hasNonPdf;
  }

  function validateSelectedFileCombination(files = selectedFiles) {
    if (hasMixedPdfSelection(files)) return "PDF와 Excel·문서 파일은 분석 엔진이 다르므로 한 요청에 함께 첨부할 수 없습니다.";
    if (currentTask === "pdf_analysis" && files.some((file) => getFileExtension(file.name) !== "pdf")) {
      return "PDF 분석 메뉴에는 PDF 파일만 첨부할 수 있습니다.";
    }
    if (currentTask === "excel_analysis" && files.some((file) => !["xlsx", "csv"].includes(getFileExtension(file.name)))) {
      return "엑셀 분석 메뉴에는 XLSX 또는 CSV 파일만 첨부할 수 있습니다.";
    }
    return "";
  }

  function setFileInputAcceptForTask(task) {
    if (!state.fileInput) return;
    if (task === "pdf_analysis") {
      state.fileInput.accept = ".pdf,application/pdf";
      return;
    }
    if (task === "excel_analysis") {
      state.fileInput.accept = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
      return;
    }
    state.fileInput.accept = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",");
  }

  function isKnowledgeTask(task) {
    const value = String(task || "").toLowerCase();
    return value.includes("knowledge") || value.includes("policy") || value.includes("procedure") || value.includes("kb") || value.includes("ai-api") || value.includes("sidetalk") || value.includes("사내");
  }

  function bindUiEvents() {
    bindFeatureSwitcherEvents();
    document.querySelectorAll(".menu-item").forEach((button) => {
      const label = button.textContent.trim();
      if (label.includes("새 대화")) {
        button.addEventListener("click", () => {
          startNewConversation({ showToast: true });
          setMode("home");
        });
      } else if (label.includes("채팅 검색")) {
        state.searchMenuButton = button;
        button.addEventListener("click", () => openChatSearchDialog());
      } else if (label.includes("템플릿") || label.includes("AI 도구") || label.includes("즐겨찾기") || label.includes("휴지통")) {
        button.addEventListener("click", () => showToast("해당 기능은 추후 연동 예정입니다."));
      }
    });

    document.querySelectorAll(".action-card").forEach((card) => {
      card.addEventListener("click", () => {
        if (card.disabled || card.dataset.featureDisabled === "true") return;
        const meta = getCardTemplate(card);
        currentTask = meta.task;
        setFileInputAcceptForTask(currentTask);
        const incompatibleSelection = validateSelectedFileCombination();
        if (incompatibleSelection && selectedFiles.length) {
          selectedFiles = [];
          renderFileChips();
          showToast("선택한 분석 기능에 맞지 않는 기존 첨부 파일을 제거했습니다.");
        }
        if (meta.template) setHomeInput(meta.template);
        if (meta.attach) state.fileInput?.click();
      });
    });

    state.homeAttachBtn?.addEventListener("click", () => state.fileInput?.click());
    state.agentAttachBtn?.addEventListener("click", () => state.fileInput?.click());
    state.fileInput?.addEventListener("change", () => {
      addFiles(state.fileInput.files || []);
      state.fileInput.value = "";
    });

    state.homeSendBtn?.addEventListener("click", submitFromHome);
    state.homePromptInput?.addEventListener("input", () => {
      syncHomePromptEmptyClass();
      resizeTextarea(state.homePromptInput);
    });
    state.homePromptInput?.addEventListener("keydown", (event) => {
      if (!isPlainEnterSubmitEvent(event)) return;
      event.preventDefault();
      submitFromHome();
    });

    state.docBackBtn?.addEventListener("click", () => setMode("home"));
    state.agentNewChatBtn?.addEventListener("click", startNewConversation);
    state.agentBody?.addEventListener("click", (event) => {
      const button = event.target.closest(".ds-agent-suggestion-btn");
      if (!button) return;
      setAgentInput(button.getAttribute("data-template") || "");
    });
    state.agentMessageInput?.addEventListener("input", () => resizeTextarea(state.agentMessageInput));
    state.agentMessageInput?.addEventListener("keydown", (event) => {
      if (!isPlainEnterSubmitEvent(event)) return;
      event.preventDefault();
      handleAgentSubmit();
    });
    state.agentForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAgentSubmit();
    });

    document.querySelectorAll(".sidebar-guide-button,.header-button,.task-row").forEach((button) => {
      button.addEventListener("click", () => showToast("해당 기능은 추후 연동 예정입니다."));
    });
    document.addEventListener("click", (event) => {
      if (recentContextMenu && !event.target.closest(".recent-context-menu") && !event.target.closest(".recent-more-btn")) closeRecentContextMenu();
      if (state.productModeMenu && !event.target.closest("#productSwitch")) closeFeatureMenu();
    });
    window.addEventListener("resize", () => {
      closeRecentContextMenu();
      resizeTextarea(state.homePromptInput);
      resizeTextarea(state.agentMessageInput);
    });
  }

  function getCardTemplate(card) {
    if (card?.dataset?.featureTask || card?.dataset?.featureTemplate) {
      return {
        task: card.dataset.featureTask || "",
        attach: card.dataset.featureAttach === "true",
        template: card.dataset.featureTemplate || "",
      };
    }
    const title = card.querySelector(".card-title")?.textContent.trim() || card.textContent.trim();
    if (title.includes("문서 작성")) return { task: "document_draft", attach: false, template: "아래 내용을 바탕으로 업무용 문서 초안을 작성해 주세요.\n\n[작성할 내용]\n" };
    if (title.includes("문서 요약")) return { task: "document_summary", attach: false, template: "아래 내용을 핵심만 간결하게 요약해 주세요.\n\n[요약할 내용]\n" };
    if (title.includes("문서 번역")) return { task: "translation", attach: false, template: "아래 문서를 자연스러운 업무 문체로 번역해 주세요.\n\n[번역할 내용]\n" };
    if (title.includes("엑셀 분석")) return { task: "excel_analysis", attach: true, template: "첨부한 엑셀 파일의 전체 구조를 요약하고 핵심 이슈를 분석해 주세요." };
    if (title.includes("PDF 분석")) return { task: "pdf_analysis", attach: true, template: "첨부한 PDF를 원문 근거와 페이지를 표시하여 정확하게 분석해 주세요.\n\n[질문]\n" };
    if (title.includes("PPT 생성")) return { task: "report_summary", attach: false, template: "아래 내용을 보고용으로 정리해 주세요. 형식은 결론, 핵심 내용, 이슈/리스크, 다음 조치로 작성해 주세요.\n\n[정리할 내용]\n" };
    return { task: "", attach: false, template: "" };
  }

  function setMode(mode) {
    currentMode = mode;
    const isDocMode = mode === "doc";

    // ChatGPT처럼 같은 메인 화면 영역 안에서 홈 → 대화 화면으로 전환합니다.
    // .home-stage 자체를 숨기면 grid 레이아웃 밖에 대화 패널이 붙어 화면이 깨지므로,
    // 홈 콘텐츠(.home-fit)만 숨기고 대화 워크스페이스를 같은 영역에 표시합니다.
    if (state.homePanel) {
      state.homePanel.hidden = false;
      state.homePanel.classList.toggle("ds-agent-mode", isDocMode);
    }
    if (state.homeContent) state.homeContent.hidden = isDocMode;
    if (state.docPanel) state.docPanel.hidden = !isDocMode;

    if (isDocMode) {
      window.setTimeout(() => state.agentMessageInput?.focus(), 60);
    } else {
      // 대화 화면에서 홈으로 돌아올 때 숨겨진 textarea를 측정해 생긴 inline height를 제거합니다.
      // 빈 홈 input은 첫 접속 화면과 동일한 CSS 기본 높이를 항상 유지합니다.
      normalizeHomeComposerLayout();
      window.requestAnimationFrame(() => {
        normalizeHomeComposerLayout();
        state.homePromptInput?.focus();
      });
      window.setTimeout(() => normalizeHomeComposerLayout(), 80);
    }
  }

  function submitFromHome() {
    const message = String(state.homePromptInput?.value || "").trim();
    if (!message && !selectedFiles.length) {
      state.homePromptInput?.focus();
      return;
    }
    setMode("doc");
    if (message) setAgentInput(message);
    if (state.homePromptInput) {
      state.homePromptInput.value = "";
      resetTextareaVisualState(state.homePromptInput);
      syncHomePromptEmptyClass();
    }
    handleAgentSubmit();
  }

  function setAgentInput(value) {
    if (!state.agentMessageInput) return;
    state.agentMessageInput.value = String(value || "");
    resizeTextarea(state.agentMessageInput);
    window.setTimeout(() => state.agentMessageInput?.focus(), 30);
  }

  function setHomeInput(value) {
    if (!state.homePromptInput) return;
    state.homePromptInput.value = String(value || "");
    syncHomePromptEmptyClass();
    resizeTextarea(state.homePromptInput);
    window.setTimeout(() => state.homePromptInput?.focus(), 30);
  }

  function startNewConversation(options = {}) {
    const { showToast: shouldShowToast = false } = options || {};
    closeRecentContextMenu();
    activeConversationId = "";
    activeConversationHighlightQuery = "";
    remoteSessionCreatePromise = null;
    remoteSessionCreateConversationId = "";
    currentTask = "";
    setFileInputAcceptForTask("");
    selectedFiles = [];
    renderFileChips();
    clearMessages();
    if (state.agentMessageInput) {
      state.agentMessageInput.value = "";
      resetTextareaVisualState(state.agentMessageInput);
    }
    if (state.homePromptInput) {
      state.homePromptInput.value = "";
      resetTextareaVisualState(state.homePromptInput);
      syncHomePromptEmptyClass();
    }
    sessionStorage.removeItem(getLocalHistoryKey());
    renderRecentWorkList();
    normalizeHomeComposerLayout();
    window.requestAnimationFrame(() => normalizeHomeComposerLayout());
    window.setTimeout(() => normalizeHomeComposerLayout(), 80);
    if (shouldShowToast) showToast("새 대화를 시작했습니다.");
  }

  function clearMessages() {
    if (!state.agentBody) return;
    state.agentBody.querySelectorAll(".ds-chat-row,.ds-thinking-row").forEach((node) => node.remove());
    const emptyCard = state.agentBody.querySelector(".ds-agent-empty-card");
    if (emptyCard) emptyCard.hidden = false;
  }

  function addFiles(fileList) {
    if (currentFeature === "knowledge") {
      showToast("사내 지식 문의는 첨부 파일 없이 지식베이스 기준으로 답변합니다.");
      return;
    }
    const files = Array.from(fileList || []);
    const rejected = [];
    files.forEach((file) => {
      const reason = validateFile(file);
      if (reason) {
        rejected.push(reason);
        return;
      }
      const duplicated = selectedFiles.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
      if (duplicated) return;
      const nextFiles = [...selectedFiles, file];
      const combinationError = validateSelectedFileCombination(nextFiles);
      if (combinationError) {
        rejected.push(combinationError);
        return;
      }
      selectedFiles.push(file);
    });
    renderFileChips();
    if (rejected.length) showToast(rejected[0]);
  }

  function validateFile(file) {
    const name = String(file?.name || "");
    const ext = getFileExtension(name);
    if (!ext) return `${name || "파일"}의 확장자를 확인할 수 없습니다.`;
    if (BLOCKED_EXTENSIONS.has(ext)) return `${name} 파일 형식은 보안 정책상 첨부할 수 없습니다.`;
    if (ALLOWED_EXTENSIONS.length && !ALLOWED_EXTENSIONS.includes(ext)) return `${name} 파일 형식은 지원하지 않습니다.`;
    if (currentTask === "pdf_analysis" && ext !== "pdf") return "PDF 분석 메뉴에는 PDF 파일만 첨부할 수 있습니다.";
    if (currentTask === "excel_analysis" && !["xlsx", "csv"].includes(ext)) return "엑셀 분석 메뉴에는 XLSX 또는 CSV 파일만 첨부할 수 있습니다.";
    if (file.size > MAX_FILE_SIZE_BYTES) return `${name} 파일은 ${formatFileSize(MAX_FILE_SIZE_BYTES)} 이하만 첨부할 수 있습니다.`;
    return "";
  }

  function getFileExtension(name) {
    const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function renderFileChips() {
    [state.agentFileChips, state.homeFileChips].filter(Boolean).forEach((container) => {
      container.innerHTML = "";
      container.hidden = selectedFiles.length === 0;
      selectedFiles.forEach((file, index) => {
        const chip = document.createElement("span");
        chip.className = "ds-file-chip";
        chip.innerHTML = `<span>${escapeHtml(file.name)}</span><em>${formatFileSize(file.size)}</em><button type="button" aria-label="첨부 파일 제거">×</button>`;
        chip.querySelector("button")?.addEventListener("click", () => {
          selectedFiles.splice(index, 1);
          renderFileChips();
        });
        container.appendChild(chip);
      });
    });
  }

  async function handleAgentSubmit() {
    if (submitInProgress) return;
    const message = String(state.agentMessageInput?.value || "").trim();
    if (!message && !selectedFiles.length) {
      state.agentMessageInput?.focus();
      return;
    }
    const activeToken = await ensureValidSession({ silent: false });
    if (!activeToken) {
      addMessage("bot", "세션 갱신이 필요합니다. 기존 채팅 기록은 유지됩니다. 그룹웨어의 DS ONE 버튼으로 다시 접속한 뒤 이어서 사용해 주세요.");
      return;
    }
    const fileCombinationError = validateSelectedFileCombination();
    if (fileCombinationError) {
      showToast(fileCombinationError);
      addMessage("bot", fileCombinationError);
      return;
    }

    submitInProgress = true;
    setComposerDisabled(true);
    if (currentFeature === "knowledge" && selectedFiles.length) {
      selectedFiles = [];
      renderFileChips();
      showToast("사내 지식 문의는 첨부 파일 없이 지식베이스 기준으로 답변합니다.");
    }
    const userText = message || "첨부한 파일을 분석해 주세요.";
    const route = getCurrentApiRoute();
    const task = getCurrentConversationTask();
    activeConversationHighlightQuery = "";
    const history = getRecentHistory();
    const displayUserMessage = buildDisplayUserMessage(userText);
    ensureActiveConversation(userText, displayUserMessage);
    appendConversationMessage("user", displayUserMessage);
    void saveRemoteConversationMessage("user", displayUserMessage, { route, task, feature: currentFeature });
    addMessage("user", displayUserMessage);
    if (state.agentMessageInput) state.agentMessageInput.value = "";
    resizeTextarea(state.agentMessageInput);
    const thinking = addThinkingMessage(currentFeature === "knowledge" ? "사내 지식 확인 중" : "생각 중");

    try {
      const data = currentFeature === "knowledge"
        ? await requestKnowledgeAnswer(userText, history)
        : selectedFiles.length
          ? await requestFileAnalysis(userText, history)
          : isGroupwareApprovalDraftRequest(userText, task)
            ? await requestGroupwareApprovalDraft(userText, history)
          : await requestAgentAnswer(userText, history);
      thinking.remove();
      const answer = extractAnswerText(data) || "답변을 생성하지 못했습니다.";
      addMessage("bot", answer);
      appendConversationMessage("assistant", answer);
      void saveRemoteConversationMessage("assistant", answer, { route, task, feature: currentFeature });
      saveLocalHistory(userText, answer);
      renderRecentWorkList();
    } catch (error) {
      thinking.remove();
      const errorText = `${getCurrentFeatureProfile().label} 처리 중 오류가 발생했습니다\n${getErrorMessage(error)}`;
      addMessage("bot", errorText);
      appendConversationMessage("assistant", errorText);
      renderRecentWorkList();
    } finally {
      submitInProgress = false;
      setComposerDisabled(false);
      state.agentMessageInput?.focus();
    }
  }

  function buildDisplayUserMessage(message) {
    if (!selectedFiles.length) return message;
    const lines = selectedFiles.map((file, index) => `${index + 1}. ${file.name} (${formatFileSize(file.size)})`);
    return `${message}\n\n[첨부 파일]\n${lines.join("\n")}`;
  }

  async function ensureValidSession(options = {}) {
    if (!sessionToken) sessionToken = readSsoSessionToken();
    const payload = decodeSessionTokenPayload(sessionToken);
    if (payload) {
      applyIdentityFromPayload(payload);
      persistLastIdentity(payload);
    }
    if (!sessionToken) return "";

    const expMs = Number(payload?.exp || 0) * 1000;
    const now = Date.now();
    const shouldRefresh = !expMs || expMs - now <= SESSION_REFRESH_LEEWAY_MS;
    if (!shouldRefresh) return sessionToken;

    const refreshed = await refreshSessionToken(options);
    if (refreshed) return refreshed;
    if (expMs && expMs > now) return sessionToken;
    return "";
  }

  async function refreshSessionToken(options = {}) {
    if (!sessionToken) return "";
    if (sessionRefreshPromise) return await sessionRefreshPromise;
    const tokenForRefresh = sessionToken;
    sessionRefreshPromise = (async () => {
      try {
        const res = await fetch(AGENT_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenForRefresh}` },
          body: JSON.stringify({ action: "refresh_session" }),
        });
        const data = await readApiResponse(res);
        const nextToken = String(data.token || data.sessionToken || "").trim();
        if (!nextToken) return "";
        storeSessionToken(nextToken, { persistent: true });
        const profile = decodeSessionTokenPayload(nextToken) || data;
        applyHeaderProfile(profile);
        migrateAnonymousRecentWorkToCurrentUser();
        renderRecentWorkList();
        scheduleRemoteRecentRefresh(80);
        return nextToken;
      } catch (error) {
        // 기록은 그대로 유지하고 새 요청이 필요할 때만 재인증을 안내합니다.
        void error;
        return "";
      } finally {
        sessionRefreshPromise = null;
      }
    })();
    return await sessionRefreshPromise;
  }

  async function requestKnowledgeAnswer(message, history) {
    const activeToken = await ensureValidSession({ silent: false });
    if (!activeToken) throw new Error("세션 갱신이 필요합니다. 그룹웨어 DS ONE 버튼으로 다시 접속해 주세요.");
    const res = await fetch(AI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
      body: JSON.stringify({ message, stream: false, task: "knowledge_inquiry", history }),
    });
    return readApiResponse(res);
  }

  async function requestAgentAnswer(message, history) {
    const activeToken = await ensureValidSession({ silent: false });
    if (!activeToken) throw new Error("세션 갱신이 필요합니다. 그룹웨어 DS ONE 버튼으로 다시 접속해 주세요.");
    const res = await fetch(AGENT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
      body: JSON.stringify({ message, stream: false, task: normalizeTask(currentTask), history }),
    });
    return readApiResponse(res);
  }

  function isGroupwareApprovalDraftRequest(message, task) {
    if (currentFeature !== "agent" || selectedFiles.length) return false;
    const text = String(message || "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    const normalizedTask = normalizeTask(task);
    const documentIntent = /(기안\s*품의서|기안품의서|품의서|기안서|전자결재|결재\s*문서|결재문서)/.test(text);
    const writeIntent = /(작성|써줘|써\s*줘|생성|만들|초안|보관|저장|상신\s*준비|상신준비)/.test(text);
    return documentIntent && (writeIntent || normalizedTask === "document_draft");
  }

  function buildGroupwareDraftPrompt(message) {
    return [
      message,
      "",
      "위 요청을 그룹웨어 기안품의서 본문으로 바로 상신 가능한 수준으로 작성해 주세요.",
      "작성 품질 기준: 실제 유료 업무 솔루션 또는 전문 비서가 작성한 것처럼 문장이 자연스럽고, 검토 항목이 충분하며, 별도 수정 없이 내부 결재 문서로 사용할 수 있어야 합니다.",
      "반드시 다음 흐름을 따르세요: 1. 기안 목적, 2. 내용, 3. 마지막 문단.",
      "2. 내용에는 추진 배경, 세부 내용, 검토 내용, 예산 및 일정, 후속 조치가 자연스럽게 포함되어야 합니다.",
      "노트북/비품/서비스/소프트웨어 구매 요청이면 품목, 수량, 사용 목적, 필요 사유, 예산, 납기, 첨부 예정 자료를 구분하세요.",
      "클라우드 서버, 인프라, AWS/NCP/Azure 같은 사업자 비교 요청이면 사업자별 비교표, 평가 기준, 종합 검토 의견, 리스크 및 관리 방안, PoC/견적 검토 후속 조치를 포함하세요.",
      "요청에 없는 금액, 수량, 업체명, 결재라인, 일정은 임의로 만들지 말고 '확인 필요'로 표시하세요.",
      "표로 정리하면 더 명확한 내용은 표 형태로 구성하세요.",
      "문단 사이에는 한 줄 공백이 들어가도록 작성하세요.",
      "마지막은 반드시 '3. 마지막 문단'으로 끝내고, 마지막 문장 뒤에는 '-끝-' 표시와 첨부 예시 안내를 유지하세요.",
      "사용자에게 설명하는 안내 문장, 마크다운 코드블록, 답변 제목은 제외하고 문서 본문만 작성하세요.",
    ].join("\n");
  }

  function deriveGroupwareApprovalTitle(message) {
    if (isCloudServerApprovalRequest(message)) return "클라우드 서버 도입 비교 검토 품의";

    const cleaned = String(message || "")
      .replace(/\[[\s\S]*?\]/g, " ")
      .replace(/(기안\s*품의서|기안품의서|품의서|기안서|전자결재|결재\s*문서|결재문서)/g, " ")
      .replace(/(작성해줘|작성해\s*줘|작성해\s*주세요|써줘|써\s*줘|생성해줘|만들어줘|보관해줘|저장해줘|해줘|해주세요)/g, " ")
      .replace(/(에\s*대한|관련|대해서|으로|로)$/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const base = cleaned || "업무 요청";
    if (/노트북|laptop|랩톱/i.test(base) && /구매|구입|도입/.test(base)) return "노트북 구매 품의";
    const title = /기안|품의/.test(base) ? base : `${base} 품의`;
    return title.slice(0, 80);
  }

  const GROUPWARE_APPROVAL_P_STYLE = "color:rgb(0, 0, 0);line-height:1.5;font-family:맑은 고딕;font-size:10pt;margin-top:0px;margin-bottom:0px;";
  const GROUPWARE_APPROVAL_SPAN_STYLE = "line-height:1.5;font-family:맑은 고딕;";
  const GROUPWARE_TABLE_STYLE = "border-collapse:collapse;width:650px;margin:0 0 0 0;font-family:맑은 고딕;font-size:10pt;line-height:1.5;";
  const GROUPWARE_TH_STYLE = "border:1px solid #666;background:#f2f5f8;padding:5px 7px;text-align:center;font-weight:bold;";
  const GROUPWARE_TD_LABEL_STYLE = "border:1px solid #666;background:#fafafa;padding:5px 7px;text-align:center;width:120px;";
  const GROUPWARE_TD_VALUE_STYLE = "border:1px solid #666;padding:5px 7px;text-align:left;";

  function preserveGroupwareSpaces(value) {
    return escapeHtml(value).replace(/\t/g, "    ").replace(/ {2,}/g, (spaces) => "&nbsp;".repeat(spaces.length));
  }

  function groupwareParagraph(text = "", options = {}) {
    const indent = "&nbsp;".repeat(Number(options.indent || 0));
    const bold = options.bold ? "font-weight:bold;" : "";
    const body = text ? `${indent}${preserveGroupwareSpaces(text)}` : "&nbsp;";
    return `<p style="${GROUPWARE_APPROVAL_P_STYLE}"><span style="${GROUPWARE_APPROVAL_SPAN_STYLE}${bold}">${body}</span></p>`;
  }

  function groupwareBlank(count = 1) {
    return Array.from({ length: Math.max(1, Number(count) || 1) }, () => groupwareParagraph("")).join("");
  }

  function groupwarePushParagraph(blocks, text, options = {}) {
    blocks.push(groupwareParagraph(text, options));
    if (options.blankAfter !== false) blocks.push(groupwareBlank(1));
  }

  function groupwareInfoTable(rows) {
    const bodyRows = rows.map(([label, value]) => [
      "<tr>",
      `<td style="${GROUPWARE_TD_LABEL_STYLE}">${preserveGroupwareSpaces(label)}</td>`,
      `<td style="${GROUPWARE_TD_VALUE_STYLE}">${preserveGroupwareSpaces(value)}</td>`,
      "</tr>",
    ].join(""));
    return `<table style="${GROUPWARE_TABLE_STYLE}" cellspacing="0" cellpadding="0"><tbody>${bodyRows.join("")}</tbody></table>`;
  }

  function groupwareMatrixTable(headers, rows) {
    const head = `<tr>${headers.map((header) => `<th style="${GROUPWARE_TH_STYLE}">${preserveGroupwareSpaces(header)}</th>`).join("")}</tr>`;
    const body = rows.map((row) => `<tr>${row.map((value) => `<td style="${GROUPWARE_TD_VALUE_STYLE}">${preserveGroupwareSpaces(value)}</td>`).join("")}</tr>`);
    return `<table style="${GROUPWARE_TABLE_STYLE}" cellspacing="0" cellpadding="0"><thead>${head}</thead><tbody>${body.join("")}</tbody></table>`;
  }

  function textToGroupwareBodyHtml(text) {
    const lines = String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return groupwareParagraph("내용 확인 필요");
    return lines.map((line) => groupwareParagraph(line)).join(groupwareBlank(1));
  }

  function buildGroupwareApprovalBodyHtml(message, draftText) {
    const request = String(message || "").trim();
    const context = inferApprovalContext(request);
    if (context.category === "cloud_server") return buildCloudServerApprovalBodyHtml(context, draftText);

    const reviewLines = extractUsefulDraftLines(draftText, context);
    const blocks = [];

    groupwarePushParagraph(blocks, "1. 기안 목적", { bold: true });
    groupwarePushParagraph(blocks, `- ${buildApprovalPurpose(context)}`, { indent: 4 });

    groupwarePushParagraph(blocks, "2. 내용", { bold: true });
    groupwarePushParagraph(blocks, "2.1 추진 배경 및 필요성", { indent: 4, bold: true });
    for (const line of buildApprovalBackgroundLines(context)) {
      groupwarePushParagraph(blocks, `- ${line}`, { indent: 8 });
    }

    groupwarePushParagraph(blocks, "2.2 세부 내용", { indent: 4, bold: true });
    blocks.push(groupwareInfoTable(buildApprovalDetailRows(context)));
    blocks.push(groupwareBlank(1));

    groupwarePushParagraph(blocks, "2.3 검토 내용", { indent: 4, bold: true });
    for (const line of reviewLines) {
      groupwarePushParagraph(blocks, `- ${line}`, { indent: 8 });
    }

    groupwarePushParagraph(blocks, "2.4 예산 및 일정", { indent: 4, bold: true });
    for (const line of buildBudgetScheduleLines(context)) {
      groupwarePushParagraph(blocks, `- ${line}`, { indent: 8 });
    }

    groupwarePushParagraph(blocks, "2.5 진행 조건 및 후속 조치", { indent: 4, bold: true });
    for (const line of buildFollowUpLines(context)) {
      groupwarePushParagraph(blocks, `- ${line}`, { indent: 8 });
    }

    appendApprovalClosing(blocks, context);

    return `<div data-ds-one-groupware-body="approval-v78">${blocks.join("")}</div>`;
  }

  function buildCloudServerApprovalBodyHtml(context, draftText) {
    const providers = context.providers.length ? context.providers : ["AWS", "NCP", "MS Azure"];
    const blocks = [];

    groupwarePushParagraph(blocks, "1. 기안 목적", { bold: true });
    groupwarePushParagraph(blocks, "- 사내 주요 업무 시스템의 안정적 운영과 향후 사용량 증가에 대응하기 위해 클라우드 서버 도입 필요성을 검토하고자 합니다.", { indent: 4 });
    groupwarePushParagraph(blocks, `- 본 품의는 ${providers.join(", ")}를 동일 기준으로 비교하여 안정성, 보안성, 운영 편의성, 비용 효율성 및 확장성을 종합 검토한 뒤 최적의 도입 방향을 선정하기 위한 사전 승인 요청입니다.`, { indent: 4 });

    groupwarePushParagraph(blocks, "2. 내용", { bold: true });
    groupwarePushParagraph(blocks, "2.1 추진 배경", { indent: 4, bold: true });
    for (const line of [
      "업무 시스템의 사용량 증가, 장애 대응 요구, 데이터 백업/복구 중요성이 높아지면서 인프라 운영 방식에 대한 재검토가 필요합니다.",
      "클라우드 서버는 사용량에 따른 탄력적 확장, 신속한 자원 증설, 모니터링 및 백업 자동화, 보안 정책 표준화 측면에서 기존 방식 대비 운영 유연성을 확보할 수 있습니다.",
      "다만 사업자별 비용 구조, 보안 기능, 국내 지원 체계, 운영 난이도와 연계 서비스 범위가 달라 동일 기준의 비교 검토 후 도입 여부를 결정해야 합니다.",
    ]) {
      groupwarePushParagraph(blocks, `- ${line}`, { indent: 8 });
    }

    groupwarePushParagraph(blocks, "2.2 검토 대상 및 기준", { indent: 4, bold: true });
    blocks.push(groupwareInfoTable([
      ["검토 대상", providers.join(", ")],
      ["검토 목적", "사내 업무 시스템 운영에 적합한 클라우드 서버 사업자 및 도입 방향 선정"],
      ["주요 기준", "안정성, 보안/컴플라이언스, 국내 리전/지원, 비용 구조, 운영 편의성, 확장성"],
      ["검토 범위", "서버 인스턴스, 네트워크, 스토리지, 백업, 모니터링, 접근 제어, 장애 대응 체계"],
      ["확정 방식", "비교 검토 후 PoC 또는 상세 견적 검토를 거쳐 최종 사업자 선정"],
    ]));
    blocks.push(groupwareBlank(1));

    groupwarePushParagraph(blocks, "2.3 평가 기준", { indent: 4, bold: true });
    blocks.push(groupwareMatrixTable(
      ["평가 항목", "검토 기준", "확인 필요 사항"],
      [
        ["안정성", "서비스 가용성, 장애 대응 체계, 백업/복구 기능", "SLA, 백업 주기, 복구 목표 시간"],
        ["보안성", "계정 권한, 네트워크 통제, 로그 관리, 보안 인증", "MFA, 접근 제어, 감사 로그, 데이터 보호 정책"],
        ["비용 효율성", "동일 사양 기준 월 사용료, 트래픽/스토리지 과금, 약정 할인", "월 예상 비용, 초기 구축비, 운영 관리비"],
        ["운영 편의성", "관리 콘솔, 모니터링, 기술 지원, 국내 대응 체계", "운영 담당자 숙련도, 지원 채널, 장애 접수 방식"],
        ["확장성", "서버 증설, 관리형 서비스 연계, 향후 시스템 확장 가능성", "추가 서비스 연동 계획, 이관 가능성"],
      ],
    ));
    blocks.push(groupwareBlank(1));

    groupwarePushParagraph(blocks, "2.4 사업자별 비교 검토", { indent: 4, bold: true });
    blocks.push(groupwareMatrixTable(
      ["구분", ...providers],
      buildCloudProviderComparisonRows(providers),
    ));
    blocks.push(groupwareBlank(1));

    groupwarePushParagraph(blocks, "2.5 종합 검토 의견", { indent: 4, bold: true });
    for (const line of buildCloudReviewLines(providers)) {
      groupwarePushParagraph(blocks, `- ${line}`, { indent: 8 });
    }

    groupwarePushParagraph(blocks, "2.6 예산 및 일정", { indent: 4, bold: true });
    for (const line of [
      "예상 비용: 확인 필요. 최종 비용은 서버 사양, 스토리지 용량, 네트워크 사용량, 백업 보관 기간 및 운영 지원 범위 확정 후 산정 예정입니다.",
      "비용 검토 방식: 동일 사양 기준 월 예상 비용, 초기 구축 비용, 운영/관리 비용, 약정 할인 여부를 비교하여 산출하겠습니다.",
      "진행 일정: 1차 요구사항 정리 → 사업자별 견적 및 기술 검토 → 보안/운영 검토 → PoC 또는 최종 제안 비교 → 선정안 상신 순으로 진행 예정입니다.",
      "예산 과목 및 집행 부서: 확인 필요.",
    ]) {
      groupwarePushParagraph(blocks, `- ${line}`, { indent: 8 });
    }

    groupwarePushParagraph(blocks, "2.7 리스크 및 관리 방안", { indent: 4, bold: true });
    blocks.push(groupwareMatrixTable(
      ["리스크 항목", "검토 내용", "관리 방안"],
      [
        ["비용 증가", "트래픽, 스토리지, 백업 정책에 따라 월 비용이 변동될 수 있음", "예산 상한, 알림 기준, 리소스 사용량 모니터링 체계 설정"],
        ["보안 및 접근 제어", "계정 권한, 외부 접속, 데이터 보호 정책 미흡 시 보안 리스크 발생", "MFA, 최소 권한, 접속 로그, 네트워크 보안 그룹 기준 수립"],
        ["운영 종속성", "특정 사업자 서비스에 의존할 경우 이전/확장 시 제약 발생 가능", "표준 아키텍처, 백업/이관 계획, 계약 조건 사전 검토"],
        ["장애 대응", "서비스 장애 또는 구성 오류 시 업무 시스템 영향 가능", "백업, 스냅샷, 모니터링, 장애 대응 연락 체계 마련"],
      ],
    ));
    blocks.push(groupwareBlank(1));

    groupwarePushParagraph(blocks, "2.8 요청 사항", { indent: 4, bold: true });
    for (const line of [
      "상기 비교 검토 기준에 따라 클라우드 서버 도입 검토를 진행할 수 있도록 승인 요청드립니다.",
      "승인 후 각 사업자별 동일 기준 견적, 보안 검토 자료, 운영 구성안을 확보하여 최종 선정안을 별도 보고하겠습니다.",
    ]) {
      groupwarePushParagraph(blocks, `- ${line}`, { indent: 8 });
    }

    appendApprovalClosing(blocks, { ...context, subject: "클라우드 서버 도입 비교 검토" });
    return `<div data-ds-one-groupware-body="approval-v80" data-ds-one-template="cloud-server-comparison">${blocks.join("")}</div>`;
  }

  function appendApprovalClosing(blocks, context) {
    const closing = inferApprovalClosing(context);
    groupwarePushParagraph(blocks, `3. ${closing.heading}`, { bold: true });
    closing.lines.forEach((line, index) => {
      blocks.push(groupwareParagraph(`- ${line}`, { indent: 4 }));
      if (index < closing.lines.length - 1) blocks.push(groupwareBlank(1));
    });
    blocks.push(groupwareBlank(3));
    blocks.push(groupwareParagraph("첨  부. OOO 1부.  -끝-  (첨부물이 1가지인 경우)", { indent: 11 }));
    blocks.push(groupwareParagraph("첨  부. 1. OOO 1부", { indent: 11 }));
    blocks.push(groupwareParagraph("2. XXX 1부.  -끝-  (첨부물이 2가지 이상인 경우)(본 예시는 삭제 후 작성 바랍니다)", { indent: 22 }));
  }

  function inferApprovalClosing(context) {
    if (context.category === "cloud_server") {
      return {
        heading: "향후 계획",
        lines: [
          "승인 후 내부 시스템 요구사항, 예상 사용량, 보안 기준 및 운영 담당 범위를 정리하여 사업자별 동일 조건 견적을 요청하겠습니다.",
          "견적 및 기술 검토 결과를 기준으로 PoC 필요 여부를 판단하고, 최종 사업자 선정안과 세부 도입 계획은 별도 보고 후 진행하겠습니다.  -끝-  (첨부물이 있는 '-끝-' 표시는 아래 예시 참고바랍니다)",
        ],
      };
    }
    if (context.category === "it_asset" || context.category === "software" || context.isPurchase) {
      return {
        heading: "향후 계획",
        lines: [
          "승인 후 세부 사양, 견적, 납기 및 비용 처리 기준을 최종 확인하여 구매/진행 절차를 추진하겠습니다.",
          `진행 과정에서 변경 사항이 발생할 경우 관련 부서와 협의 후 보고하고, 필요한 증빙 자료는 보완하겠습니다.  -끝-  (첨부물이 있는 '-끝-' 표시는 아래 예시 참고바랍니다)`,
        ],
      };
    }
    if (context.category === "business") {
      return {
        heading: "향후 계획",
        lines: [
          "승인 후 세부 일정과 담당 역할을 확정하고, 관련 부서와 협의하여 계획된 업무를 차질 없이 진행하겠습니다.",
          "진행 결과 및 후속 조치가 필요한 사항은 별도 정리하여 보고하겠습니다.  -끝-  (첨부물이 있는 '-끝-' 표시는 아래 예시 참고바랍니다)",
        ],
      };
    }
    return {
      heading: "기타사항",
      lines: [
        `상기와 같이 ${context.subject} 건을 검토 요청드리며, 세부 내용은 승인 후 관련 기준에 따라 보완 및 진행하겠습니다.  -끝-  (첨부물이 있는 '-끝-' 표시는 아래 예시 참고바랍니다)`,
      ],
    };
  }

  function inferApprovalContext(message) {
    const cleanRequest = cleanApprovalRequest(message);
    const item = inferApprovalItemName(message);
    const quantity = extractApprovalQuantity(message);
    const amount = extractApprovalAmount(message);
    const schedule = extractApprovalSchedule(message);
    const category = inferApprovalCategory(message, item);
    const providers = extractCloudProviders(message);
    const subject = cleanRequest || `${item} 진행`;
    return {
      original: message,
      cleanRequest,
      item,
      quantity,
      amount,
      schedule,
      category,
      providers,
      subject,
      isPurchase: category === "purchase" || category === "it_asset" || category === "software" || category === "cloud_server",
    };
  }

  function cleanApprovalRequest(message) {
    return String(message || "")
      .replace(/\[[\s\S]*?\]/g, " ")
      .replace(/(기안\s*품의서|기안품의서|품의서|기안서|전자결재|결재\s*문서|결재문서)/g, " ")
      .replace(/(작성해줘|작성해\s*줘|작성해\s*주세요|써줘|써\s*줘|생성해줘|만들어줘|보관해줘|저장해줘|해줘|해주세요)/g, " ")
      .replace(/(에\s*대한|관련|대해서|으로|로)$/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function inferApprovalCategory(message, item) {
    const text = `${message || ""} ${item || ""}`;
    if (isCloudServerApprovalRequest(text)) return "cloud_server";
    if (/노트북|laptop|랩톱|PC|컴퓨터|데스크탑|데스크톱|모니터|장비/i.test(text)) return "it_asset";
    if (/소프트웨어|라이선스|라이센스|구독|SaaS/i.test(text)) return "software";
    if (/구매|구입|도입|발주|계약|견적/.test(text)) return "purchase";
    if (/출장|교육|회의|행사|프로젝트|용역|서비스/.test(text)) return "business";
    return "general";
  }

  function isCloudServerApprovalRequest(message) {
    const text = String(message || "");
    return /(클라우드|cloud|서버|인프라|IaaS|iaas|AWS|NCP|Azure|애저)/i.test(text)
      && /(도입|이전|구축|검토|비교|선정|서버)/.test(text);
  }

  function extractCloudProviders(message) {
    const text = String(message || "");
    const candidates = [
      [/AWS|Amazon\s*Web\s*Services/i, "AWS"],
      [/NCP|Naver\s*Cloud|네이버\s*클라우드|네이버클라우드/i, "NCP"],
      [/MS\s*Azure|Microsoft\s*Azure|Azure|애저/i, "MS Azure"],
      [/GCP|Google\s*Cloud|구글\s*클라우드|구글클라우드/i, "GCP"],
      [/Oracle\s*Cloud|OCI/i, "Oracle Cloud"],
    ];
    const providers = [];
    for (const [pattern, label] of candidates) {
      if (pattern.test(text) && !providers.includes(label)) providers.push(label);
    }
    return providers;
  }

  function buildCloudProviderComparisonRows(providers) {
    const profile = {
      AWS: {
        fit: "글로벌 서비스 범위와 레퍼런스가 넓어 확장성 높은 시스템에 유리",
        operation: "서비스 선택지가 많아 아키텍처 설계 역량과 운영 표준 수립 필요",
        security: "보안 기능과 인증 체계가 풍부하나 계정/권한/네트워크 정책 설계 필요",
        cost: "사용량 기반 비용 최적화 여지가 크지만 리소스 관리 미흡 시 비용 증가 가능",
        note: "글로벌 확장, 다양한 관리형 서비스 활용 시 우선 검토",
      },
      NCP: {
        fit: "국내 리전, 국내 고객 지원, 한국어 운영 환경 측면에서 내부 운영 대응이 용이",
        operation: "국내 업무 시스템 운영과 지원 커뮤니케이션에 강점",
        security: "국내 보안/공공/기업 환경 대응 자료 확보가 비교적 용이",
        cost: "국내 트래픽과 지원 조건 기준으로 견적 비교 필요",
        note: "국내 중심 업무 시스템과 운영 대응 속도 중시 시 우선 검토",
      },
      "MS Azure": {
        fit: "Microsoft 365, Entra ID, Windows Server 등 MS 생태계 연계에 강점",
        operation: "기존 MS 계정/보안 정책과 연동 시 관리 효율 기대",
        security: "ID 기반 접근 제어와 보안 관리 체계 연계가 용이",
        cost: "라이선스 포함 여부와 약정 조건에 따라 총비용 차이 발생 가능",
        note: "MS 기반 업무 환경, AD/계정 연동 요건이 큰 경우 우선 검토",
      },
      GCP: {
        fit: "데이터 분석, AI/ML, 컨테이너 기반 워크로드에 강점",
        operation: "클라우드 네이티브 운영 역량 확보 시 효과적",
        security: "IAM 및 데이터 보안 기능 검토 필요",
        cost: "데이터 처리/네트워크 사용량 기준 비용 검토 필요",
        note: "분석/AI 연계 워크로드가 핵심일 때 검토",
      },
      "Oracle Cloud": {
        fit: "Oracle DB 및 관련 업무 시스템 연계 시 비용/성능 검토 가치 있음",
        operation: "DB 중심 워크로드 운영 조건 확인 필요",
        security: "기업 보안 요건과 네트워크 구성 검토 필요",
        cost: "DB 라이선스 및 약정 조건에 따른 비용 비교 필요",
        note: "Oracle 기반 시스템 이전 또는 확장 시 검토",
      },
    };
    const value = (provider, key) => profile[provider]?.[key] || "요구사항 기준 상세 검토 필요";
    return [
      ["적합성", ...providers.map((provider) => value(provider, "fit"))],
      ["운영 편의성", ...providers.map((provider) => value(provider, "operation"))],
      ["보안/권한 관리", ...providers.map((provider) => value(provider, "security"))],
      ["비용 검토", ...providers.map((provider) => value(provider, "cost"))],
      ["검토 의견", ...providers.map((provider) => value(provider, "note"))],
    ];
  }

  function buildCloudReviewLines(providers, draftText) {
    const generated = extractUsefulDraftLines(draftText, {
      item: "클라우드 서버",
      subject: "클라우드 서버 도입 비교 검토",
      category: "cloud_server",
      isPurchase: true,
    }).filter((line) => !/확인 필요/.test(line)).slice(0, 2);
    return [
      ...generated,
      `${providers.join(", ")}는 모두 클라우드 서버 운영이 가능하나, 내부 시스템의 위치, 보안 기준, 계정 연동 방식, 운영 인력 숙련도에 따라 적합도가 달라집니다.`,
      "국내 업무 시스템 중심이면 국내 리전과 지원 체계가 강한 사업자를 우선 검토하고, 글로벌 확장 또는 다양한 관리형 서비스 활용이 중요하면 글로벌 사업자를 함께 비교하는 방식이 적절합니다.",
      "최종 사업자 선정 전 동일 사양 기준 견적, 장애 대응 조건, 백업/복구 정책, 보안 설정 기준을 확보하여 총소유비용과 운영 리스크를 함께 비교해야 합니다.",
    ].slice(0, 5);
  }

  function extractApprovalQuantity(message) {
    const match = String(message || "").match(/(\d+(?:,\d+)?)\s*(대|개|식|건|명|부|EA|ea)/);
    return match ? `${match[1]}${match[2]}` : "확인 필요";
  }

  function extractApprovalAmount(message) {
    const match = String(message || "").match(/((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(억원|천만원|백만원|만원|천원|원)/);
    return match ? `${match[1]}${match[2]}` : "확인 필요";
  }

  function extractApprovalSchedule(message) {
    const match = String(message || "").match(/(\d{4}[.-]\d{1,2}[.-]\d{1,2}|\d{1,2}월\s*\d{1,2}일|\d{1,2}월\s*중|상반기|하반기|금주|내주|이번\s*달|다음\s*달|즉시|긴급)/);
    return match ? match[1].replace(/\s+/g, " ") : "확인 필요";
  }

  function buildApprovalPurpose(context) {
    if (context.category === "it_asset") {
      return `${context.item} 확보를 통해 담당 업무 수행에 필요한 전산 환경을 안정적으로 마련하고, 업무 처리 지연 및 장비 사용 불편을 최소화하고자 품의합니다.`;
    }
    if (context.category === "software") {
      return `${context.item} 도입을 통해 업무 수행에 필요한 사용 권한과 기능을 확보하고, 관련 업무의 처리 효율과 관리 체계를 개선하고자 품의합니다.`;
    }
    if (context.isPurchase) {
      return `${context.subject}에 필요한 품목 및 조건을 검토한 결과, 원활한 업무 수행을 위해 구매/진행 승인이 필요하여 품의합니다.`;
    }
    return `${context.subject} 건의 필요성과 진행 내용을 검토한 결과, 원활한 업무 수행을 위해 내부 승인 절차를 진행하고자 품의합니다.`;
  }

  function buildApprovalBackgroundLines(context) {
    if (context.category === "it_asset") {
      return [
        `${context.item}은 사용자의 일상 업무 처리, 문서 작성, 사내 시스템 접속 및 협업 업무 수행에 필요한 기본 업무 장비입니다.`,
        "업무 연속성과 처리 효율을 확보하기 위해 사용 목적, 지급 대상, 예산 및 납기 조건을 사전에 정리한 후 구매 절차를 진행할 필요가 있습니다.",
      ];
    }
    if (context.category === "software") {
      return [
        `${context.item}은 업무 수행에 필요한 기능 제공, 사용 권한 관리, 자료 처리 효율 향상을 위해 검토가 필요한 항목입니다.`,
        "도입 전 사용 범위, 라이선스 조건, 예산 적정성, 보안 및 계약 조건을 함께 확인할 필요가 있습니다.",
      ];
    }
    if (context.isPurchase) {
      return [
        `${context.subject} 진행을 위해 품목, 수량, 예산, 납기 및 첨부 자료를 기준으로 구매 필요성을 검토했습니다.`,
        "구매 진행 전 세부 조건을 확인하여 비용 집행의 적정성과 업무 필요성을 함께 확보하고자 합니다.",
      ];
    }
    return [
      `${context.subject}의 원활한 진행을 위해 추진 배경, 필요성, 예상 일정 및 후속 조치를 사전에 정리했습니다.`,
      "관련 부서와 이해관계자가 동일한 기준으로 검토할 수 있도록 핵심 내용을 문서화하고자 합니다.",
    ];
  }

  function buildApprovalDetailRows(context) {
    const rows = [
      ["구분", context.isPurchase ? "구매/진행 요청" : "업무 진행 요청"],
      ["품목/내용", context.item],
      ["수량/범위", context.quantity],
      ["사용 목적", buildUsagePurpose(context)],
      ["예상 금액", context.amount],
      ["필요 시점", context.schedule],
      ["첨부 예정", inferApprovalAttachmentSummary(context)],
    ];
    return rows;
  }

  function buildUsagePurpose(context) {
    if (context.category === "it_asset") return "업무용 문서 작성, 사내 시스템 접속, 협업 및 일상 업무 수행";
    if (context.category === "software") return "업무 처리 효율 향상, 기능 사용 권한 확보 및 관련 산출물 관리";
    if (context.isPurchase) return "업무 수행에 필요한 품목 확보 및 관련 업무 진행";
    return "업무 진행에 필요한 내부 승인 및 실행 기준 확보";
  }

  function extractUsefulDraftLines(draftText, context) {
    const lines = String(draftText || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[-*ㆍ•]\s*/, "").replace(/^\d+(\.\d+)*\s*/, "").trim())
      .filter((line) => line.length >= 8)
      .filter((line) => !/^(결론|분석 결과|상세 설명|기준 및 근거|파일|표 복사|확인 필요)$/i.test(line))
      .filter((line) => !/```|^\|/.test(line))
      .slice(0, 4);

    const fallback = [
      `${context.item}의 업무 필요성, 사용 범위, 예산 적정성 및 납기 조건을 기준으로 진행 여부를 검토할 필요가 있습니다.`,
      "구매 또는 진행 전 견적서, 비교 자료, 세부 사양 등 증빙 자료를 확인하여 집행 근거를 보완합니다.",
      "승인 후에는 자산 등록, 지급 이력 관리, 비용 처리 등 후속 절차가 누락되지 않도록 관리합니다.",
    ];
    return [...lines, ...fallback].slice(0, 5);
  }

  function buildBudgetScheduleLines(context) {
    return [
      `예상 금액: ${context.amount}`,
      `필요 시점/납기: ${context.schedule}`,
      "예산 과목 및 비용 처리 부서: 확인 필요",
      "최종 집행 금액은 견적서 및 내부 구매 절차 확인 후 확정 예정입니다.",
    ];
  }

  function buildFollowUpLines(context) {
    if (context.category === "it_asset") {
      return [
        "승인 후 구매 절차를 진행하고, 입고 완료 시 자산 등록 및 지급 이력을 관리하겠습니다.",
        "세부 사양, 견적서, 비교견적서 등 증빙 자료는 확인 후 첨부 또는 보완하겠습니다.",
      ];
    }
    if (context.category === "software") {
      return [
        "승인 후 라이선스 조건, 사용 기간, 계정 발급 및 보안 검토 사항을 확인하겠습니다.",
        "계약 또는 결제 진행 전 견적서와 사용 범위를 재확인하여 비용 집행 근거를 보완하겠습니다.",
      ];
    }
    return [
      "승인 후 관련 부서와 세부 일정 및 실행 조건을 확정하여 진행하겠습니다.",
      "필요 증빙 및 참고 자료는 확인 후 첨부 또는 보완하겠습니다.",
    ];
  }

  function inferApprovalAttachmentSummary(context) {
    if (context.category === "cloud_server") return "사업자별 견적서, 비교 검토표, 구성도, 보안 검토 자료";
    if (context.category === "it_asset") return "견적서, 비교견적서, 제품 사양서 또는 구성 내역";
    if (context.category === "software") return "견적서, 라이선스 조건, 서비스/계약 조건 자료";
    if (context.isPurchase) return "견적서, 비교견적서, 세부 산출 내역";
    return "관련 계획서, 참고 자료, 필요 증빙";
  }

  function inferApprovalItemName(message) {
    const text = String(message || "");
    if (isCloudServerApprovalRequest(text)) return "클라우드 서버";
    if (/노트북|laptop|랩톱/i.test(text)) return "노트북";
    if (/PC|컴퓨터|데스크탑|데스크톱/i.test(text)) return "PC/전산장비";
    if (/모니터/i.test(text)) return "모니터";
    if (/소프트웨어|라이선스|라이센스/i.test(text)) return "소프트웨어/라이선스";
    return "확인 필요";
  }

  function inferApprovalAttachmentLines(message, item) {
    const base = [
      "- 견적서: 첨부 예정",
      "- 비교견적서: 필요 시 첨부",
    ];
    if (/노트북|PC|컴퓨터|모니터|장비|소프트웨어|라이선스|라이센스/i.test(`${message} ${item}`)) {
      base.push("- 제품 사양서 또는 구성 내역: 첨부 예정");
    }
    base.push("- 기타 참고자료: 필요 시 첨부");
    return base;
  }

  async function requestGroupwareApprovalDraft(message, history) {
    const activeToken = await ensureValidSession({ silent: false });
    if (!activeToken) throw new Error("세션 갱신이 필요합니다. 그룹웨어 DS ONE 버튼으로 다시 접속해 주세요.");

    const draftData = await requestAgentAnswer(buildGroupwareDraftPrompt(message), history);
    const draftText = extractAnswerText(draftData) || message;
    const title = deriveGroupwareApprovalTitle(message);
    const bodyHtml = buildGroupwareApprovalBodyHtml(message, draftText);

    const extensionResult = await requestGroupwareApprovalViaExtension({
      requestText: message,
      title,
      bodyHtml,
      formId: "1176",
      autoSave: true,
    }).catch(() => null);
    if (extensionResult?.ok || extensionResult?.status === "failed" || extensionResult?.status === "blocked") {
      return { ...extensionResult, answer: formatGroupwareApprovalExtensionAnswer(extensionResult, title) };
    }

    const res = await fetch(RPA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
      body: JSON.stringify({
        action: "groupware_approval_draft",
        requestText: message,
        title,
        bodyHtml,
        formId: "1176",
        saveMode: "draft",
      }),
    });
    const data = await readApiResponse(res);
    const completed = await pollGroupwareApprovalDraftStatus(data.jobId, activeToken).catch(() => null);
    return { ...data, answer: formatGroupwareApprovalDraftAnswer(completed || data, title) };
  }

  function requestGroupwareApprovalViaExtension(payload) {
    return new Promise((resolve) => {
      const requestId = `dsone-gw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let latest = null;
      let extensionSeen = false;
      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        clearTimeout(initialTimer);
        clearTimeout(finalTimer);
      };
      const finish = (result) => {
        cleanup();
        resolve(result || latest);
      };
      const initialTimer = setTimeout(() => {
        if (!extensionSeen) finish(null);
      }, 1500);
      const finalTimer = setTimeout(() => {
        finish(latest);
      }, 90000);
      const onMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== "DS_ONE_GROUPWARE_EXTENSION") return;
        if (data.type === "DS_ONE_GROUPWARE_EXTENSION_READY") {
          extensionSeen = true;
          return;
        }
        if (data.requestId !== requestId) return;
        extensionSeen = true;
        latest = data;
        if (data.type === "DS_ONE_GROUPWARE_DRAFT_ACK" && data.ok === false) finish(data);
        if (data.type === "DS_ONE_GROUPWARE_DRAFT_RESULT") finish(data);
      };
      window.addEventListener("message", onMessage);
      window.postMessage({
        source: "DS_ONE_WEB",
        type: "DS_ONE_GROUPWARE_DRAFT_REQUEST",
        requestId,
        payload,
      }, window.location.origin);
    });
  }

  function formatGroupwareApprovalExtensionAnswer(data, title) {
    const status = String(data?.status || "").trim();
    if (data?.ok && status === "succeeded") {
      return [
        "기안품의서가 현재 브라우저의 그룹웨어 탭에서 보관되었습니다.",
        "",
        `제목: ${title}`,
        data.jobId ? `작업 ID: ${data.jobId}` : "",
        "다음 단계: 그룹웨어 보관함에서 문서 내용을 확인한 뒤 상신하세요.",
      ].filter(Boolean).join("\n");
    }
    if (data?.ok && (status === "opened" || status === "filled")) {
      return [
        status === "filled" ? "그룹웨어 탭에 기안품의서 제목과 본문을 입력했습니다." : "그룹웨어 탭을 열고 자동 입력/보관을 요청했습니다.",
        "",
        `제목: ${title}`,
        data.jobId ? `작업 ID: ${data.jobId}` : "",
        "그룹웨어 로그인 상태가 유지되어 있으면 자동으로 보관됩니다.",
      ].filter(Boolean).join("\n");
    }
    return [
      "Chrome Extension을 통한 그룹웨어 자동 보관에 실패했습니다.",
      "",
      `제목: ${title}`,
      data?.message || "그룹웨어 로그인 상태, 확장 프로그램 권한, 양식 로딩 상태를 확인해 주세요.",
      data?.jobId ? `작업 ID: ${data.jobId}` : "",
    ].filter(Boolean).join("\n");
  }

  async function pollGroupwareApprovalDraftStatus(jobId, activeToken) {
    if (!jobId) return null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const res = await fetch(RPA_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
        body: JSON.stringify({ action: "groupware_approval_status", jobId }),
      });
      const data = await readApiResponse(res);
      if (["succeeded", "failed", "blocked"].includes(String(data.status || ""))) return data;
    }
    return null;
  }

  function formatGroupwareApprovalDraftAnswer(data, title) {
    const status = String(data?.status || "").trim();
    if (data?.ok && status === "succeeded") {
      return [
        "기안품의서가 그룹웨어에 보관되었습니다.",
        "",
        `제목: ${title}`,
        data.jobId ? `작업 ID: ${data.jobId}` : "",
        "다음 단계: 그룹웨어 보관함에서 문서 내용을 확인한 뒤 상신하세요.",
      ].filter(Boolean).join("\n");
    }
    if (status === "failed" || status === "blocked" || data?.ok === false) {
      return [
        "기안품의서 자동 보관에 실패했습니다.",
        "",
        `제목: ${title}`,
        data?.message || data?.error || "RPA 워커 실행 결과를 확인해 주세요.",
        data?.jobId ? `작업 ID: ${data.jobId}` : "",
      ].filter(Boolean).join("\n");
    }
    return [
      "기안품의서 보관 작업을 접수했습니다.",
      "",
      `제목: ${title}`,
      data?.jobId ? `작업 ID: ${data.jobId}` : "",
      "현재 자동 보관 중입니다. 완료 여부는 RPA 작업 상태에서 확인하세요.",
    ].filter(Boolean).join("\n");
  }

  async function requestFileAnalysis(message, history) {
    const activeToken = await ensureValidSession({ silent: false });
    if (!activeToken) throw new Error("세션 갱신이 필요합니다. 그룹웨어 DS ONE 버튼으로 다시 접속해 주세요.");
    const formData = new FormData();
    formData.append("message", message);
    formData.append("stream", "false");
    formData.append("history", JSON.stringify(history));
    const normalizedTask = normalizeTask(currentTask);
    if (normalizedTask) formData.append("task", normalizedTask);
    selectedFiles.forEach((file) => formData.append("files", file, file.name));
    const endpoint = isPdfOnlySelection() ? PDF_API_URL : FILE_API_URL;
    const res = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${activeToken}` }, body: formData });
    return readApiResponse(res);
  }

  async function readApiResponse(res) {
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, message: text }; }
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    return data;
  }

  function normalizeTask(task) {
    const value = String(task || "").trim();
    if (!value || value === "document_draft") return "";
    if (value === "file_question") return "pdf_analysis";
    if (value === "pdf_analysis") return "pdf_analysis";
    if (value === "excel_analysis") return "excel_analysis";
    if (value === "document_summary") return "document_summary";
    if (value === "translation") return "translation";
    if (value === "report_summary") return "report_summary";
    return value;
  }

  function extractAnswerText(data) {
    if (!data) return "";
    const answer = String(data.answer || data.text || data.message || data.raw || "").trim();
    if (currentFeature === "knowledge") return stripKnowledgeEvidenceNotice(answer);
    const sources = Array.isArray(data.sources) ? data.sources : [];
    if (!sources.length || /근거 문서/.test(answer)) return answer;
    const lines = sources.slice(0, 5).map((source, index) => {
      const title = String(source.title || source.name || source.id || source.url || `근거 ${index + 1}`).trim();
      const snippet = String(source.snippet || "").trim();
      return `${index + 1}. ${title}${snippet ? ` - ${snippet}` : ""}`;
    });
    return `${answer}\n\n근거 문서\n${lines.join("\n")}`;
  }

  function stripKnowledgeEvidenceNotice(text) {
    return String(text || "")
      .replace(/\n?\s*근거 안내\s*\n\s*SideTalk 응답에 별도 근거 문서 정보가 포함되지 않았습니다\.[\s\S]*$/i, "")
      .replace(/\n?\s*근거 문서\s*\n(?:\s*\d+\.\s*[^\n]+\n?)+\s*$/i, "")
      .trim();
  }

  function addMessage(role, text) {
    if (!state.agentBody) return null;
    const emptyCard = state.agentBody.querySelector(".ds-agent-empty-card");
    if (emptyCard) emptyCard.hidden = true;
    const row = document.createElement("div");
    row.className = role === "user" ? "ds-chat-row ds-user-row" : "ds-chat-row ds-bot-row";
    if (role === "bot") {
      const avatar = document.createElement("span");
      avatar.className = "ds-chat-avatar";
      avatar.textContent = "AI";
      row.appendChild(avatar);
    }
    const msg = document.createElement("div");
    msg.className = `ds-msg ${role === "user" ? "user" : "bot"}`;
    if (role === "bot") renderMessageContent(msg, text, activeConversationHighlightQuery);
    else appendTextWithHighlight(msg, text, activeConversationHighlightQuery, "ds-chat-highlight");
    if (activeConversationHighlightQuery && String(text || "").toLowerCase().includes(activeConversationHighlightQuery.toLowerCase())) {
      row.classList.add("is-search-hit");
    }
    if (role === "bot") {
      const stack = document.createElement("div");
      stack.className = "ds-bot-message-stack";
      stack.appendChild(msg);
      addCopyButton(stack, msg);
      row.appendChild(stack);
    } else {
      row.appendChild(msg);
    }
    state.agentBody.appendChild(row);
    state.agentBody.scrollTop = state.agentBody.scrollHeight;
    return row;
  }

  function addThinkingMessage(text) {
    const row = document.createElement("div");
    row.className = "ds-thinking-row ds-bot-row";
    row.innerHTML = `
      <span class="ds-chat-avatar">AI</span>
      <div class="ds-msg bot" aria-label="${escapeHtml(text)}">
        <span class="ds-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>`;
    state.agentBody.appendChild(row);
    state.agentBody.scrollTop = state.agentBody.scrollHeight;
    return row;
  }

  function renderMessageContent(container, text, highlightQuery = "") {
    container.innerHTML = "";
    const rawLines = normalizeAnswerText(text).split(/\r?\n/);
    let inCode = false;
    let codeLines = [];

    for (let i = 0; i < rawLines.length; i += 1) {
      const line = rawLines[i];
      const trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        if (inCode) {
          appendCodeBlock(container, codeLines.join("\n"));
          codeLines = [];
          inCode = false;
        } else {
          inCode = true;
          codeLines = [];
        }
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      if (trimmed === "[[DS_PDF_EVIDENCE_START]]") {
        const evidenceLines = [];
        i += 1;
        while (i < rawLines.length && rawLines[i].trim() !== "[[DS_PDF_EVIDENCE_END]]") {
          evidenceLines.push(rawLines[i]);
          i += 1;
        }
        appendPdfEvidenceDetails(container, evidenceLines, highlightQuery);
        continue;
      }
      if (trimmed === "[[DS_PDF_EVIDENCE_END]]") continue;
      const imageBlock = parseMarkdownImageBlock(rawLines, i);
      if (imageBlock) {
        imageBlock.images.forEach((image) => appendMessageImage(container, image.url, image.alt));
        i = imageBlock.nextIndex;
        continue;
      }
      const standaloneImageUrl = parseStandaloneImageUrl(trimmed);
      if (standaloneImageUrl) {
        appendMessageImage(container, standaloneImageUrl, "지식베이스 이미지");
        continue;
      }
      if (!trimmed) {
        appendSpacer(container);
        continue;
      }
      if (trimmed === "표 복사") continue;
      if (isMarkdownTableStart(rawLines, i)) {
        const tableLines = [];
        while (i < rawLines.length && isMarkdownTableLine(rawLines[i])) {
          tableLines.push(rawLines[i]);
          i += 1;
        }
        i -= 1;
        appendMarkdownTable(container, tableLines, highlightQuery);
        continue;
      }
      if (/^---+$/.test(trimmed)) {
        appendSpacer(container, true);
        continue;
      }

      const headingText = getHeadingText(trimmed);
      if (headingText) {
        const div = document.createElement("div");
        div.className = "ds-msg-heading";
        div.textContent = headingText;
        container.appendChild(div);
        continue;
      }

      if (/^>\s+/.test(trimmed)) {
        const div = document.createElement("div");
        div.className = "ds-msg-quote";
        appendInlineMarkdown(div, trimmed.replace(/^>\s+/, ""), highlightQuery);
        container.appendChild(div);
        continue;
      }

      const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
      if (numbered) {
        const div = document.createElement("div");
        div.className = "ds-msg-numbered";
        const num = document.createElement("span");
        num.className = "ds-num";
        num.textContent = `${numbered[1]}.`;
        div.appendChild(num);
        appendInlineMarkdown(div, numbered[2], highlightQuery);
        container.appendChild(div);
        continue;
      }

      if (/^[-•]\s+/.test(trimmed)) {
        const div = document.createElement("div");
        div.className = "ds-msg-bullet";
        appendInlineMarkdown(div, trimmed.replace(/^[-•]\s+/, ""), highlightQuery);
        container.appendChild(div);
        continue;
      }

      const div = document.createElement("div");
      div.className = "ds-msg-paragraph";
      appendInlineMarkdown(div, line, highlightQuery);
      container.appendChild(div);
    }

    if (inCode && codeLines.length) appendCodeBlock(container, codeLines.join("\n"));
  }

  function appendPdfEvidenceDetails(container, lines, highlightQuery = "") {
    const cleanLines = Array.isArray(lines) ? [...lines] : [];
    while (cleanLines.length && !String(cleanLines[0] || "").trim()) cleanLines.shift();
    let summaryText = "근거 확인";
    if (cleanLines.length) {
      const first = String(cleanLines[0] || "").trim();
      if (first && !/^[-•>|#]/.test(first) && !/^\d+[.)]\s+/.test(first)) {
        summaryText = first;
        cleanLines.shift();
      }
    }

    const details = document.createElement("details");
    details.className = "ds-pdf-evidence";
    const summary = document.createElement("summary");
    summary.textContent = summaryText;
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "ds-pdf-evidence-body";
    renderMessageContent(body, cleanLines.join("\n"), highlightQuery);
    details.appendChild(body);
    container.appendChild(details);
  }

  function getHeadingText(line) {
    const markdown = line.match(/^#{1,4}\s+(.+)$/);
    if (markdown) return markdown[1].replace(/[:：]\s*$/, "").trim();
    const section = line.match(/^\s*(결론|요약|판정 요약|분석 결과|점검 결과|파일 구조 요약|핵심 이슈|우선 조치|기준 및 근거|확인 필요|확인되지 않은 항목|다음 조치|상세 내용|참고 사항)\s*[:：]?\s*$/);
    return section ? section[1] : "";
  }

  function appendSpacer(container, strong = false) {
    if (!container.lastElementChild) return;
    const spacer = document.createElement("div");
    spacer.className = "ds-msg-spacer";
    if (strong) spacer.style.height = "12px";
    container.appendChild(spacer);
  }

  function appendCodeBlock(container, code) {
    const pre = document.createElement("pre");
    pre.className = "ds-msg-codeblock";
    pre.textContent = String(code || "");
    container.appendChild(pre);
  }

  function parseMarkdownImageBlock(lines, index) {
    let combined = String(lines[index] || "").trim();
    if (!/^!\[[^\]]{0,120}\]/.test(combined)) return null;
    let nextIndex = index;
    while (!extractMarkdownImagesFromText(combined).length && nextIndex + 1 < lines.length && nextIndex - index < 4) {
      const next = String(lines[nextIndex + 1] || "").trim();
      if (!next || /^```/.test(next) || isMarkdownTableLine(next)) break;
      combined += next;
      nextIndex += 1;
    }
    const images = extractMarkdownImagesFromText(combined);
    if (!images.length) return null;
    return {
      images,
      nextIndex,
    };
  }

  function extractMarkdownImagesFromText(text) {
    const source = String(text || "");
    const images = [];
    const marker = /!\[([^\]]{0,120})\]\s*\(/g;
    let match;
    while ((match = marker.exec(source))) {
      const urlStart = marker.lastIndex;
      const urlEnd = source.indexOf(")", urlStart);
      if (urlEnd < 0) break;
      const rawUrl = source.slice(urlStart, urlEnd);
      const url = normalizeSafeImageUrl(rawUrl);
      if (url) {
        images.push({
          url,
          alt: normalizeText(match[1] || "지식베이스 이미지") || "지식베이스 이미지",
        });
      }
      marker.lastIndex = urlEnd + 1;
    }
    return images;
  }

  function parseStandaloneImageUrl(line) {
    const url = normalizeSafeImageUrl(line);
    if (!url) return "";
    return isLikelyDisplayImageUrl(url) ? url : "";
  }

  function normalizeSafeImageUrl(raw) {
    const cleaned = String(raw || "")
      .trim()
      .replace(/^<|>$/g, "")
      .replace(/^\(|\)$/g, "")
      .replace(/^['"]|['"]$/g, "")
      .replace(/\s+/g, "");
    if (!cleaned) return "";
    try {
      const url = new URL(cleaned, window.location.href);
      const isLocalHttp = url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/i.test(url.hostname);
      if (url.protocol !== "https:" && !isLocalHttp) return "";
      if (!isLikelyDisplayImageUrl(url.href)) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function isLikelyDisplayImageUrl(url) {
    try {
      const parsed = new URL(String(url || ""), window.location.href);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      return /\.(png|jpe?g|gif|webp|bmp)$/i.test(path)
        || host === "chatimg.sidetalk.ai"
        || host.endsWith(".sidetalk.ai");
    } catch {
      return false;
    }
  }

  function shouldProxyKnowledgeImage(url) {
    try {
      const parsed = new URL(String(url || ""), window.location.href);
      const host = parsed.hostname.toLowerCase();
      return parsed.protocol === "https:" && (host === "chatimg.sidetalk.ai" || host.endsWith(".sidetalk.ai"));
    } catch {
      return false;
    }
  }

  function buildKnowledgeImageProxyUrl(url) {
    if (!shouldProxyKnowledgeImage(url)) return url;
    return `${AI_API_URL}?imageProxy=1&url=${encodeURIComponent(url)}`;
  }

  function appendMessageImage(container, url, alt = "지식베이스 이미지") {
    const figure = document.createElement("figure");
    figure.className = "ds-msg-image";
    const displayUrl = buildKnowledgeImageProxyUrl(url);

    const link = document.createElement("a");
    link.className = "ds-msg-image-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const img = document.createElement("img");
    img.src = displayUrl;
    img.alt = alt || "지식베이스 이미지";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      figure.classList.add("is-error");
      img.hidden = true;
    }, { once: true });
    link.appendChild(img);
    figure.appendChild(link);

    const caption = normalizeText(alt || "");
    if (caption && !/^image$/i.test(caption) && caption !== "이미지" && caption !== "지식베이스 이미지") {
      const figcaption = document.createElement("figcaption");
      figcaption.className = "ds-msg-image-caption";
      figcaption.textContent = caption;
      figure.appendChild(figcaption);
    }

    const fallback = document.createElement("a");
    fallback.className = "ds-msg-image-fallback";
    fallback.href = url;
    fallback.target = "_blank";
    fallback.rel = "noopener noreferrer";
    fallback.textContent = "이미지를 새 창에서 열기";
    figure.appendChild(fallback);

    container.appendChild(figure);
  }

  function normalizeAnswerText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/기준\s*\/\s*근거/g, "기준 및 근거")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }


  function isMarkdownTableLine(line) { return /^\s*\|.+\|\s*$/.test(String(line || "")); }
  function isMarkdownTableSeparator(line) { return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || "")); }
  function isMarkdownTableStart(lines, index) { return isMarkdownTableLine(lines[index]) && isMarkdownTableSeparator(lines[index + 1] || ""); }
  function parseTableRow(line) { return String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()); }

  function appendMarkdownTable(container, tableLines, highlightQuery = "") {
    const wrap = document.createElement("div");
    wrap.className = "ds-msg-table-wrap";
    const toolbar = document.createElement("div");
    toolbar.className = "ds-msg-table-toolbar";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ds-table-copy-btn";
    setCopyButtonState(copyBtn, "표 복사");
    copyBtn.addEventListener("click", async () => {
      const tsv = tableLines.filter((line) => !isMarkdownTableSeparator(line)).map((line) => parseTableRow(line).join("\t")).join("\n");
      const ok = await copyToClipboard(tsv);
      setCopyButtonState(copyBtn, ok ? "복사 완료" : "복사 실패");
      setTimeout(() => { setCopyButtonState(copyBtn, "표 복사"); }, 1200);
    });
    toolbar.appendChild(copyBtn);
    wrap.appendChild(toolbar);
    const scroll = document.createElement("div");
    scroll.className = "ds-msg-table-scroll";
    const table = document.createElement("table");
    table.className = "ds-msg-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    parseTableRow(tableLines[0]).forEach((cell) => { const th = document.createElement("th"); appendInlineMarkdown(th, cell, highlightQuery); hr.appendChild(th); });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    tableLines.slice(2).forEach((line) => {
      if (!isMarkdownTableLine(line) || isMarkdownTableSeparator(line)) return;
      const tr = document.createElement("tr");
      parseTableRow(line).forEach((cell) => { const td = document.createElement("td"); appendInlineMarkdown(td, cell, highlightQuery); tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    container.appendChild(wrap);
  }

  function appendInlineMarkdown(parent, text, highlightQuery = "") {
    const value = String(text || "");
    const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
    let last = 0;
    let match;
    while ((match = regex.exec(value))) {
      if (match.index > last) appendTextWithHighlight(parent, value.slice(last, match.index), highlightQuery, "ds-chat-highlight");
      if (match[2]) {
        const strong = document.createElement("strong");
        appendTextWithHighlight(strong, match[2], highlightQuery, "ds-chat-highlight");
        parent.appendChild(strong);
      } else if (match[3]) {
        const code = document.createElement("code");
        code.textContent = match[3];
        parent.appendChild(code);
      }
      last = regex.lastIndex;
    }
    if (last < value.length) appendTextWithHighlight(parent, value.slice(last), highlightQuery, "ds-chat-highlight");
  }

  function appendTextWithHighlight(parent, text, query, className = "ds-chat-highlight") {
    const value = String(text || "");
    const normalizedQuery = normalizeSearchQuery(query || "");
    if (!normalizedQuery) {
      parent.appendChild(document.createTextNode(value));
      return;
    }
    const lowerValue = value.toLowerCase();
    const lowerQuery = normalizedQuery.toLowerCase();
    let index = 0;
    let found;
    while ((found = lowerValue.indexOf(lowerQuery, index)) !== -1) {
      if (found > index) parent.appendChild(document.createTextNode(value.slice(index, found)));
      const mark = document.createElement("mark");
      mark.className = className;
      mark.textContent = value.slice(found, found + normalizedQuery.length);
      parent.appendChild(mark);
      index = found + normalizedQuery.length;
    }
    if (index < value.length) parent.appendChild(document.createTextNode(value.slice(index)));
  }

  function copyIconSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9.5h8.2a1.8 1.8 0 0 1 1.8 1.8v7.9a1.8 1.8 0 0 1-1.8 1.8H9.3a1.8 1.8 0 0 1-1.8-1.8V11.3A1.8 1.8 0 0 1 9.3 9.5Z"/><path d="M5 14.5H4.8A1.8 1.8 0 0 1 3 12.7V4.8A1.8 1.8 0 0 1 4.8 3h7.9a1.8 1.8 0 0 1 1.8 1.8V5"/></svg>`;
  }

  function setCopyButtonState(button, label) {
    button.innerHTML = `${copyIconSvg()}<span>${escapeHtml(label)}</span>`;
    button.setAttribute("aria-label", label);
  }

  function addCopyButton(stack, msg) {
    const actions = document.createElement("div");
    actions.className = "ds-bot-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ds-bot-copy-btn";
    setCopyButtonState(button, "복사");
    button.addEventListener("click", async () => {
      const ok = await copyToClipboard(msg.innerText || msg.textContent || "");
      setCopyButtonState(button, ok ? "복사 완료" : "복사 실패");
      setTimeout(() => { setCopyButtonState(button, "복사"); }, 1200);
    });
    actions.appendChild(button);
    stack.appendChild(actions);
  }

  async function copyToClipboard(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch {}
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch { return false; }
  }

  function getStorageUserKey() {
    if (!currentEmpNo && !currentLoginId) restoreCachedIdentity();
    return String(currentEmpNo || currentLoginId || "anonymous").replace(/[^a-zA-Z0-9_.:-]/g, "_");
  }

  function getFeatureStorageSuffix(mode = currentFeature) {
    return normalizeFeatureMode(mode);
  }

  function getLocalHistoryKey(mode = currentFeature) {
    return `${LOCAL_HISTORY_PREFIX}${getStorageUserKey()}_${getFeatureStorageSuffix(mode)}`;
  }

  function getRecentWorkKey(mode = currentFeature) {
    return `${RECENT_WORK_PREFIX}${getStorageUserKey()}_${getFeatureStorageSuffix(mode)}`;
  }

  function getLegacyRecentWorkKey(userKey = getStorageUserKey()) {
    return RECENT_WORK_PREFIX + userKey;
  }

  function getLegacyLocalHistoryKey(userKey = getStorageUserKey()) {
    return LOCAL_HISTORY_PREFIX + userKey;
  }

  function getRecentHistory() {
    const active = getActiveConversation();
    if (active?.messages?.length) {
      return active.messages
        .slice(-MAX_HISTORY)
        .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", text: message.text || "" }));
    }
    try {
      const raw = sessionStorage.getItem(getLocalHistoryKey());
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data.slice(-MAX_HISTORY) : [];
    } catch { return []; }
  }

  function saveLocalHistory(userText, assistantText) {
    try {
      const history = getRecentHistory().filter((message) => message.text);
      history.push({ role: "user", text: userText });
      if (assistantText) history.push({ role: "assistant", text: assistantText });
      sessionStorage.setItem(getLocalHistoryKey(), JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch {}
  }

  function readRecentWorkItemsFromKey(key) {
    try {
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data.filter((item) => item?.id) : [];
    } catch { return []; }
  }

  function loadRecentWorkItems(mode = currentFeature, options = {}) {
    const targetMode = normalizeFeatureMode(mode);
    const key = getRecentWorkKey(targetMode);
    const userKey = getStorageUserKey();
    const sourceKeys = new Set([key]);

    // v56 이전 또는 캐시 꼬임 상황에서는 feature suffix가 없는 키에 기록이 남아 있을 수 있습니다.
    // agent 모드는 기존 업무 대화의 기본값이므로 legacy/무분류 세션을 함께 복구합니다.
    const legacyKey = getLegacyRecentWorkKey(userKey);
    if (legacyKey !== key) sourceKeys.add(legacyKey);
    if (userKey !== "anonymous") {
      sourceKeys.add(`${RECENT_WORK_PREFIX}anonymous`);
      sourceKeys.add(`${RECENT_WORK_PREFIX}anonymous_${targetMode}`);
    }
    // v57 이전/이후 전환 과정에서 userKey가 loginId, empNo, anonymous 등으로 바뀐 캐시도 복구합니다.
    // 현재 브라우저 안의 캐시만 대상으로 하며, feature 판정 후 현재 모드에 맞는 항목만 표시합니다.
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const storageKey = localStorage.key(i) || "";
        if (storageKey.startsWith(RECENT_WORK_PREFIX)) sourceKeys.add(storageKey);
      }
    } catch {}

    const kept = [];
    const moved = [];
    let changed = false;
    sourceKeys.forEach((sourceKey) => {
      readRecentWorkItemsFromKey(sourceKey).forEach((item) => {
        const feature = getConversationFeature(item);
        const normalized = { ...item, feature };
        if (feature !== item.feature || sourceKey !== key) changed = true;
        if (feature === targetMode) kept.push(normalized);
        else moved.push(normalized);
      });
    });

    const deduped = sortRecentWorkItems(dedupeRecentItems(kept)).slice(0, MAX_RECENT_WORK);
    if (options.repair !== false && changed) {
      try { localStorage.setItem(key, JSON.stringify(deduped)); } catch {}
      moved.forEach((item) => mergeRecentWorkItemIntoMode(item, item.feature));
    }
    return deduped;
  }

  function saveRecentWorkItems(items, mode = currentFeature) {
    try {
      localStorage.setItem(getRecentWorkKey(mode), JSON.stringify((items || []).slice(0, MAX_RECENT_WORK)));
    } catch {}
  }

  function getExplicitFeatureMode(value) {
    const text = normalizeText(String(value || "")).toLowerCase();
    if (!text) return "";
    if (text.includes("knowledge") || text.includes("sidetalk") || text.includes("kb") || text.includes("사내 지식") || text.includes("사내지식")) return "knowledge";
    if (text.includes("agent") || text.includes("업무 ai") || text.includes("file") || text.includes("excel") || text.includes("agent-api") || text.includes("file-api")) return "agent";
    return "";
  }

  function getConversationTextForFeature(item) {
    const parts = [item?.title, item?.preview, item?.task, item?.route, item?.metadata?.task, item?.metadata?.feature];
    if (Array.isArray(item?.messages)) {
      item.messages.slice(0, 4).forEach((message) => parts.push(message?.text || message?.content || ""));
    }
    return normalizeText(parts.filter(Boolean).join(" ")).toLowerCase();
  }

  function looksLikeAgentFileOrExcelConversation(item) {
    const text = getConversationTextForFeature(item);
    if (!text) return false;
    return /\.(xlsx|xls|csv|pptx|docx|pdf)\b/i.test(text)
      || text.includes("첨부 파일")
      || text.includes("파일 분석")
      || text.includes("엑셀")
      || text.includes("시트에서")
      || text.includes("원장")
      || text.includes("승인한도")
      || text.includes("발주번호")
      || text.includes("검수")
      || text.includes("비용정산")
      || text.includes("매출채권")
      || text.includes("법인카드")
      || text.includes("설비점검")
      || text.includes("품질 lot")
      || text.includes("불량률")
      || text.includes("온도 기준")
      || text.includes("진동 기준");
  }

  function looksLikeKnowledgeConversation(item) {
    if (isKnowledgeTask(item?.task || item?.route || item?.metadata?.task || item?.metadata?.feature || "")) return true;
    const text = getConversationTextForFeature(item);
    if (!text) return false;
    return text.includes("사내 지식")
      || text.includes("사내지식")
      || text.includes("사내 규정")
      || text.includes("규정 확인")
      || text.includes("업무 절차")
      || text.includes("담당 부서")
      || text.includes("신청 방법")
      || text.includes("보안 기준")
      || text.includes("복리후생")
      || text.includes("출장비 정산 기준")
      || text.includes("휴가 기준")
      || text.includes("근태 규정")
      || text.includes("결재 절차");
  }

  function getConversationFeature(item) {
    // 명시적 feature_mode/metadata가 있으면 이를 최우선으로 신뢰합니다.
    // 키워드 휴리스틱은 feature_mode가 없던 구버전 기록 복구용으로만 사용합니다.
    const explicit = getExplicitFeatureMode(item?.feature || item?.featureMode || item?.feature_mode || item?.mode || item?.metadata?.feature || item?.metadata?.feature_mode || "");
    if (explicit) return explicit;
    if (looksLikeAgentFileOrExcelConversation(item)) return "agent";
    return looksLikeKnowledgeConversation(item) ? "knowledge" : "agent";
  }

  function mergeRecentWorkItemIntoMode(item, mode) {
    if (!item?.id) return;
    const targetMode = normalizeFeatureMode(mode);
    try {
      const key = getRecentWorkKey(targetMode);
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : [];
      const items = Array.isArray(data) ? data : [];
      const next = sortRecentWorkItems([{ ...item, feature: targetMode }, ...items.filter((entry) => entry?.id !== item.id && (!item.remoteId || getRemoteSessionId(entry) !== item.remoteId))]);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }

  function migrateLegacyRecentWorkByFeature() {
    const userKey = getStorageUserKey();
    const legacyKey = getLegacyRecentWorkKey(userKey);
    const agentKey = getRecentWorkKey("agent");
    const knowledgeKey = getRecentWorkKey("knowledge");
    if (legacyKey === agentKey || legacyKey === knowledgeKey) return;
    try {
      const raw = localStorage.getItem(legacyKey);
      if (!raw) return;
      const legacyItems = JSON.parse(raw);
      if (!Array.isArray(legacyItems) || !legacyItems.length) return;
      const existingAgent = JSON.parse(localStorage.getItem(agentKey) || "[]");
      const existingKnowledge = JSON.parse(localStorage.getItem(knowledgeKey) || "[]");
      const agentItems = Array.isArray(existingAgent) ? existingAgent : [];
      const knowledgeItems = Array.isArray(existingKnowledge) ? existingKnowledge : [];
      legacyItems.forEach((item) => {
        if (!item?.id) return;
        const feature = getConversationFeature(item);
        const normalized = { ...item, feature };
        if (feature === "knowledge") knowledgeItems.push(normalized);
        else agentItems.push(normalized);
      });
      localStorage.setItem(agentKey, JSON.stringify(sortRecentWorkItems(dedupeRecentItems(agentItems))));
      localStorage.setItem(knowledgeKey, JSON.stringify(sortRecentWorkItems(dedupeRecentItems(knowledgeItems))));
      localStorage.removeItem(legacyKey);
    } catch {}
  }

  function dedupeRecentItems(items) {
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item?.id) return;
      const key = getRemoteSessionId(item) || item.id;
      map.set(key, { ...(map.get(key) || {}), ...item });
    });
    return Array.from(map.values());
  }


  function showRenameDialog(currentTitle) {
    return new Promise((resolve) => {
      const backdrop = createDialogShell({
        title: "대화 이름 바꾸기",
        desc: "최근 작업에 표시될 이름입니다. 업무 내용을 알아보기 쉽게 작성해 주세요.",
      });
      const field = document.createElement("div");
      field.className = "ds-dialog-field";
      field.innerHTML = `<label for="dsRenameInput">대화 이름</label><input id="dsRenameInput" class="ds-dialog-input" type="text" maxlength="80" autocomplete="off">`;
      const input = field.querySelector("input");
      input.value = String(currentTitle || "새 업무 요청");
      backdrop.card.appendChild(field);

      const actions = createDialogActions([
        { label: "취소", value: null },
        { label: "저장", value: "save", primary: true },
      ]);
      backdrop.card.appendChild(actions.wrap);

      const close = (value) => {
        backdrop.root.remove();
        document.removeEventListener("keydown", onKeydown);
        resolve(value);
      };
      const onKeydown = (event) => {
        if (event.key === "Escape") close(null);
        if (event.key === "Enter") {
          event.preventDefault();
          const title = String(input.value || "").trim();
          if (title) close(title);
        }
      };
      backdrop.closeButton.addEventListener("click", () => close(null));
      actions.buttons[0].addEventListener("click", () => close(null));
      actions.buttons[1].addEventListener("click", () => {
        const title = String(input.value || "").trim();
        if (!title) { input.focus(); return; }
        close(title);
      });
      backdrop.root.addEventListener("mousedown", (event) => { if (event.target === backdrop.root) close(null); });
      document.addEventListener("keydown", onKeydown);
      document.body.appendChild(backdrop.root);
      window.setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }

  function showDeleteDialog(item) {
    return new Promise((resolve) => {
      const backdrop = createDialogShell({
        title: "대화를 삭제할까요?",
        desc: `삭제하면 최근 작업에서 사라집니다. ${String(item?.title || "이 대화")} 대화를 삭제하시겠습니까?`,
      });
      const actions = createDialogActions([
        { label: "취소", value: false },
        { label: "삭제", value: true, danger: true },
      ]);
      backdrop.card.appendChild(actions.wrap);
      const close = (value) => {
        backdrop.root.remove();
        document.removeEventListener("keydown", onKeydown);
        resolve(Boolean(value));
      };
      const onKeydown = (event) => {
        if (event.key === "Escape") close(false);
        if (event.key === "Enter") close(true);
      };
      backdrop.closeButton.addEventListener("click", () => close(false));
      actions.buttons[0].addEventListener("click", () => close(false));
      actions.buttons[1].addEventListener("click", () => close(true));
      backdrop.root.addEventListener("mousedown", (event) => { if (event.target === backdrop.root) close(false); });
      document.addEventListener("keydown", onKeydown);
      document.body.appendChild(backdrop.root);
      window.setTimeout(() => actions.buttons[0]?.focus(), 30);
    });
  }

  function createDialogShell({ title, desc }) {
    const root = document.createElement("div");
    root.className = "ds-dialog-backdrop";
    root.setAttribute("role", "presentation");
    const card = document.createElement("section");
    card.className = "ds-dialog-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const head = document.createElement("div");
    head.className = "ds-dialog-head";
    const copy = document.createElement("div");
    copy.innerHTML = `<h2 class="ds-dialog-title">${escapeHtml(title)}</h2><p class="ds-dialog-desc">${escapeHtml(desc)}</p>`;
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "ds-dialog-close";
    closeButton.setAttribute("aria-label", "닫기");
    closeButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10" /><path d="M17 7 7 17" /></svg>`;
    head.appendChild(copy);
    head.appendChild(closeButton);
    card.appendChild(head);
    root.appendChild(card);
    return { root, card, closeButton };
  }

  function createDialogActions(actions) {
    const wrap = document.createElement("div");
    wrap.className = "ds-dialog-actions";
    const buttons = actions.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ds-dialog-btn${action.primary ? " primary" : ""}${action.danger ? " danger" : ""}`;
      button.textContent = action.label;
      wrap.appendChild(button);
      return button;
    });
    return { wrap, buttons };
  }

  function openChatSearchDialog() {
    if (chatSearchDialog) {
      chatSearchDialog.input?.focus();
      return;
    }
    const root = document.createElement("div");
    root.className = "ds-search-backdrop";
    root.innerHTML = `
      <section class="ds-search-card" role="dialog" aria-modal="true" aria-label="채팅 검색">
        <div class="ds-search-head">
          <div>
            <h2 class="ds-search-title">채팅 검색</h2>
            <p class="ds-search-desc">제목과 대화 내용을 검색해 이전 업무 대화를 다시 열 수 있습니다.</p>
          </div>
          <button class="ds-search-close" type="button" aria-label="닫기">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M7 7l10 10" />
              <path d="M17 7 7 17" />
            </svg>
          </button>
        </div>
        <div class="ds-search-input-wrap">
          <input class="ds-search-input" type="search" placeholder="채팅 제목 또는 내용을 검색하세요" autocomplete="off">
        </div>
        <div class="ds-search-results" role="listbox" aria-label="채팅 검색 결과"></div>
      </section>`;
    const input = root.querySelector(".ds-search-input");
    const results = root.querySelector(".ds-search-results");
    const closeButton = root.querySelector(".ds-search-close");
    chatSearchDialog = { root, input, results };

    const close = () => closeChatSearchDialog();
    const searchNow = () => renderChatSearchResults(input.value || "");
    input.addEventListener("input", () => {
      window.clearTimeout(chatSearchDebounceTimer);
      chatSearchRequestSeq += 1;
      const nextQuery = input.value || "";
      const normalized = normalizeSearchQuery(nextQuery);
      if (!normalized) {
        renderChatSearchResults("");
        return;
      }
      setChatSearchPending("검색 중입니다");
      chatSearchDebounceTimer = window.setTimeout(searchNow, CHAT_SEARCH_DEBOUNCE_MS);
    });
    closeButton.addEventListener("click", close);
    root.addEventListener("mousedown", (event) => { if (event.target === root) close(); });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
      if (event.key === "Enter") {
        const first = results.querySelector(".ds-search-result");
        if (first) { event.preventDefault(); first.click(); }
      }
    });
    document.body.appendChild(root);
    renderChatSearchResults("");
    window.setTimeout(() => input.focus(), 40);
  }

  function closeChatSearchDialog() {
    if (!chatSearchDialog) return;
    chatSearchDialog.root.remove();
    chatSearchDialog = null;
    window.clearTimeout(chatSearchDebounceTimer);
  }

  async function renderChatSearchResults(query, options = {}) {
    if (!chatSearchDialog?.results) return;
    const q = normalizeSearchQuery(query);
    const requestSeq = ++chatSearchRequestSeq;
    const localResults = searchLocalConversations(q);

    if (q && sessionToken && !options.localOnly) {
      setChatSearchPending("검색 중입니다");
    } else {
      setChatSearchResultNodes(localResults, q);
    }

    if (!sessionToken || options.localOnly) return;

    try {
      const data = await agentStateRequest({ action: "search_sessions", query: q, limit: REMOTE_SESSION_LIST_LIMIT, featureMode: currentFeature });
      if (requestSeq !== chatSearchRequestSeq) return;
      const remoteResults = Array.isArray(data.sessions) ? data.sessions.map(remoteSessionToRecentItem) : [];
      const merged = mergeConversationResults(localResults, remoteResults);
      setChatSearchResultNodes(merged, q);
    } catch {
      if (requestSeq !== chatSearchRequestSeq) return;
      setChatSearchResultNodes(localResults, q);
    }
  }

  function searchLocalConversations(query) {
    const items = loadRecentWorkItems();
    if (!query) return items.slice(0, MAX_RECENT_WORK);
    const q = query.toLowerCase();
    return items.filter((item) => {
      const haystack = [item.title, item.preview, ...(Array.isArray(item.messages) ? item.messages.map((m) => m.text || "") : [])]
        .join("\n")
        .toLowerCase();
      return haystack.includes(q);
    }).slice(0, MAX_RECENT_WORK);
  }

  function remoteSessionToRecentItem(session) {
    const remoteId = String(session.id || session.sessionId || "").trim();
    const title = String(session.title || "새 업무 요청").trim() || "새 업무 요청";
    const preview = String(session.snippet || session.preview || "저장된 업무 대화").trim() || "저장된 업무 대화";
    const feature = getConversationFeature({
      id: remoteId,
      title,
      preview,
      feature: session.feature_mode || session.featureMode || "",
      task: session.task || session.route || "",
      metadata: session.metadata || {},
    });
    const updatedAt = Date.parse(session.display_time_at || session.last_activity_at || session.lastActivityAt || session.last_message_at || session.lastMessageAt || session.created_at || session.createdAt || session.updated_at || session.updatedAt || "") || Date.now();
    return {
      id: remoteId,
      remoteId,
      title,
      preview,
      updatedAt,
      isFavorite: Boolean(session.is_favorite ?? session.isFavorite),
      feature,
      task: feature === "knowledge" ? "knowledge_inquiry" : "general",
      messages: [],
    };
  }

  function mergeConversationResults(localResults, remoteResults) {
    const map = new Map();
    [...remoteResults, ...localResults].forEach((item) => {
      if (!item?.id) return;
      const feature = getConversationFeature(item);
      if (feature !== currentFeature) return;
      const key = getRemoteSessionId(item) || item.id;
      map.set(key, { ...(map.get(key) || {}), ...item, feature });
    });
    return sortRecentWorkItems(Array.from(map.values()));
  }

  function setChatSearchPending(label = "검색 중입니다") {
    const results = chatSearchDialog?.results;
    if (!results) return;
    results.innerHTML = `
      <div class="ds-search-loading">
        <span>${escapeHtml(label)}</span>
        <span class="ds-search-dot"></span>
        <span class="ds-search-dot"></span>
        <span class="ds-search-dot"></span>
      </div>`;
  }

  function setChatSearchResultNodes(items, query, options = {}) {
    const results = chatSearchDialog?.results;
    if (!results) return;
    results.innerHTML = "";
    const isLoading = Boolean(options.loading);
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = isLoading ? "ds-search-loading" : "ds-search-empty";
      if (isLoading) {
        empty.innerHTML = `<span>서버 채팅 기록을 검색하는 중입니다</span><span class="ds-search-dot"></span><span class="ds-search-dot"></span><span class="ds-search-dot"></span>`;
      } else {
        empty.textContent = query ? "검색 결과가 없습니다." : "아직 표시할 채팅 기록이 없습니다.";
      }
      results.appendChild(empty);
      return;
    }
    items.slice(0, MAX_RECENT_WORK).forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ds-search-result";
      button.innerHTML = `
        <span class="ds-search-result-icon">${escapeHtml(getTaskIconText(item.task))}</span>
        <span>
          <span class="ds-search-result-title">${highlightSearchText(item.title || "새 업무 요청", query)}</span>
          <span class="ds-search-result-snippet">${highlightSearchText(item.preview || "저장된 업무 대화", query)}</span>
        </span>
        <span class="ds-search-result-time">${escapeHtml(formatRelativeTime(item.updatedAt))}</span>`;
      button.addEventListener("click", () => {
        upsertRecentWorkItem(item);
        closeChatSearchDialog();
        openRecentConversation(item.id, query);
      });
      results.appendChild(button);
    });
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeSearchQuery(value) {
    return normalizeText(value).slice(0, 80);
  }

  function highlightSearchText(text, query) {
    const value = escapeHtml(String(text || ""));
    if (!query) return value;
    const safeQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try { return value.replace(new RegExp(safeQuery, "ig"), (m) => `<mark class="ds-search-highlight">${m}</mark>`); }
    catch { return value; }
  }

  function ensureActiveConversation(userText, displayUserMessage) {
    if (activeConversationId) return activeConversationId;
    activeConversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const title = createConversationTitle(userText);
    const item = {
      id: activeConversationId,
      title,
      preview: createConversationPreview(displayUserMessage || userText),
      task: getCurrentConversationTask(),
      feature: currentFeature,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    const items = loadRecentWorkItems().filter((entry) => entry.id !== activeConversationId);
    saveRecentWorkItems([item, ...items]);
    renderRecentWorkList();
    return activeConversationId;
  }

  function appendConversationMessage(role, text) {
    if (!activeConversationId) return;
    const now = Date.now();
    const items = loadRecentWorkItems();
    const index = items.findIndex((item) => item.id === activeConversationId);
    if (index < 0) return;
    const item = { ...items[index] };
    const messages = Array.isArray(item.messages) ? item.messages.slice(-MAX_STORED_CONVERSATION_MESSAGES) : [];
    messages.push({ role, text: String(text || ""), at: now });
    item.messages = messages.slice(-MAX_STORED_CONVERSATION_MESSAGES);
    item.updatedAt = now;
    if (role === "user") item.preview = createConversationPreview(text);
    if (!item.title || item.title === "새 업무 요청") item.title = createConversationTitle(text);
    items.splice(index, 1);
    saveRecentWorkItems([item, ...items]);
    renderRecentWorkList();
  }

  function getActiveConversation() {
    if (!activeConversationId) return null;
    return loadRecentWorkItems().find((item) => item.id === activeConversationId) || null;
  }

  function renderRecentWorkList() {
    let items = [];
    try {
      items = loadRecentWorkItems();
    } catch {
      items = [];
    }
    renderSidebarRecentList(items);
    renderLowerRecentList(items);
    ensureRecentEmptyState(items);
  }

  function ensureRecentEmptyState(items = []) {
    if (!state.recentList) return;
    const hasRenderable = state.recentList.querySelector(".recent-item-wrap, .ds-recent-empty");
    if (hasRenderable) return;
    const empty = document.createElement("div");
    empty.className = "ds-recent-empty";
    empty.textContent = getRecentEmptyMessage(items);
    state.recentList.appendChild(empty);
  }

  function getRecentEmptyMessage(items = []) {
    if (Array.isArray(items) && items.length) return "";
    if (currentFeature === "knowledge") return "아직 사내 지식 문의 기록이 없습니다.\n질문을 입력하면 자동으로 쌓입니다.";
    if (recentRemoteRefreshInProgress && !recentRemoteEverLoaded) return "저장된 업무 대화를 불러오는 중입니다.\n잠시만 기다려 주세요.";
    return "아직 최근 작업이 없습니다.\n업무를 요청하면 자동으로 쌓입니다.";
  }

  function renderSidebarRecentList(items) {
    if (!state.recentList) return;
    state.recentList.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "ds-recent-empty";
      empty.textContent = getRecentEmptyMessage(items);
      state.recentList.appendChild(empty);
      return;
    }
    items.slice(0, MAX_RECENT_WORK).forEach((item) => {
      const wrap = document.createElement("div");
      wrap.className = `recent-item-wrap${item.id === activeConversationId ? " is-active" : ""}${item.isFavorite ? " is-favorite" : ""}`;
      wrap.dataset.conversationId = item.id;

      const button = document.createElement("button");
      button.className = `recent-item${item.id === activeConversationId ? " is-active" : ""}`;
      button.type = "button";
      button.dataset.conversationId = item.id;
      button.innerHTML = `<span class="recent-item-title">${escapeHtml(item.title || "새 업무 요청")}</span><span class="recent-item-meta">${escapeHtml(formatRelativeTime(item.updatedAt))}</span>`;
      button.addEventListener("click", () => openRecentConversation(item.id));

      const more = document.createElement("button");
      more.className = "recent-more-btn";
      more.type = "button";
      more.setAttribute("aria-label", `${item.title || "최근 작업"} 메뉴 열기`);
      more.textContent = "⋯";
      more.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleRecentContextMenu(wrap, item);
      });

      wrap.appendChild(button);
      wrap.appendChild(more);
      state.recentList.appendChild(wrap);
    });
  }

  function closeRecentContextMenu() {
    if (recentContextMenu) {
      recentContextMenu.remove();
      recentContextMenu = null;
    }
  }

  function toggleRecentContextMenu(container, item) {
    if (!container || !item) return;
    if (recentContextMenu?.dataset?.conversationId === String(item.id)) {
      closeRecentContextMenu();
      return;
    }
    closeRecentContextMenu();
    const menu = document.createElement("div");
    menu.className = "recent-context-menu";
    menu.dataset.conversationId = String(item.id);
    menu.innerHTML = `
      <button type="button" data-action="rename">이름 바꾸기</button>
      <button type="button" data-action="favorite">${item.isFavorite ? "즐겨찾기 해제" : "즐겨찾기"}</button>
      <button type="button" data-action="delete" class="danger">삭제</button>
    `;
    menu.addEventListener("click", async (event) => {
      const actionButton = event.target.closest("button[data-action]");
      if (!actionButton) return;
      event.preventDefault();
      event.stopPropagation();
      const action = actionButton.dataset.action;
      closeRecentContextMenu();
      if (action === "rename") return renameRecentConversation(item.id);
      if (action === "favorite") return toggleFavoriteRecentConversation(item.id);
      if (action === "delete") return deleteRecentConversation(item.id);
    });
    document.body.appendChild(menu);
    const trigger = container.querySelector(".recent-more-btn") || container;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 132;
    const menuHeight = Math.max(112, menu.offsetHeight || 112);
    const gap = 6;
    const left = Math.min(window.innerWidth - menuWidth - 8, Math.max(8, rect.right - menuWidth));
    let top = rect.bottom + gap;
    if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - gap);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    recentContextMenu = menu;
  }

  function renderLowerRecentList(items) {
    if (!state.lowerRecentList) return;
    state.lowerRecentList.innerHTML = "";
    items.slice(0, 5).forEach((item) => {
      const row = document.createElement("div");
      row.className = "task-row";
      row.innerHTML = `
        <span class="app-icon ${getTaskIconClass(item.task)}">${escapeHtml(getTaskIconText(item.task))}</span>
        <div class="task-copy">
          <p class="task-title">${escapeHtml(item.title || "새 업무 요청")}</p>
          <p class="task-desc">${escapeHtml(item.preview || "최근 업무 요청")}</p>
        </div>
        <span class="time">${escapeHtml(formatRelativeTime(item.updatedAt))}</span>
        <button class="more-btn" type="button" aria-label="대화 열기"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></button>`;
      row.addEventListener("click", () => openRecentConversation(item.id));
      state.lowerRecentList.appendChild(row);
    });
  }

  async function openRecentConversation(conversationId, highlightQuery = "") {
    const item = loadRecentWorkItems().find((entry) => entry.id === conversationId);
    if (!item) return;
    activeConversationId = item.id;
    activeConversationHighlightQuery = normalizeSearchQuery(highlightQuery);
    currentTask = item.task || "";
    setFileInputAcceptForTask(currentTask);
    const targetFeature = getConversationFeature(item);
    applyFeatureMode(targetFeature, { persist: true, silent: true, resetConversation: false });
    selectedFiles = [];
    renderFileChips();
    clearMessages();
    setMode("doc");

    const remoteId = getRemoteSessionId(item);
    if (remoteId && sessionToken) {
      try {
        const data = await agentStateRequest({ action: "load_session", sessionId: remoteId });
        const messages = Array.isArray(data.messages) ? data.messages : [];
        if (messages.some((message) => isKnowledgeTask(message?.metadata?.task || message?.metadata?.feature || message?.route || ""))) {
          applyFeatureMode("knowledge", { persist: true, silent: true });
        }
        messages.forEach((message) => addMessage(message.role === "assistant" ? "bot" : "user", message.content || message.text || ""));
        if (messages.length) {
          item.feature = getConversationFeature(item);
          item.messages = messages.map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", text: message.content || message.text || "", at: Date.now() })).slice(-MAX_STORED_CONVERSATION_MESSAGES);
          upsertRecentWorkItem(item);
        }
      } catch {
        renderLocalConversationMessages(item);
      }
    } else {
      renderLocalConversationMessages(item);
    }

    const active = getActiveConversation();
    try {
      const apiHistory = (active?.messages || []).map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", text: message.text || "" })).slice(-MAX_HISTORY);
      sessionStorage.setItem(getLocalHistoryKey(), JSON.stringify(apiHistory));
    } catch {}
    if (activeConversationHighlightQuery) scrollToFirstChatHighlight();
    renderRecentWorkList();
  }

  function scrollToFirstChatHighlight() {
    const first = state.agentBody?.querySelector(".ds-chat-highlight");
    if (!first) return;
    window.setTimeout(() => {
      try { first.scrollIntoView({ block: "center", behavior: "smooth" }); }
      catch { first.scrollIntoView(); }
    }, 80);
  }

  function renderLocalConversationMessages(item) {
    const messages = Array.isArray(item?.messages) ? item.messages : [];
    messages.forEach((message) => addMessage(message.role === "assistant" ? "bot" : "user", message.text || ""));
  }

  async function renameRecentConversation(conversationId) {
    const item = loadRecentWorkItems().find((entry) => entry.id === conversationId);
    if (!item) return;
    const title = await showRenameDialog(item.title || "새 업무 요청");
    if (!title) return;
    // 이름 변경은 대화 활동 시간이 아니므로 최근 작업 시간을 갱신하지 않습니다.
    updateRecentWorkItem(conversationId, { title });
    const remoteId = getRemoteSessionId(item);
    if (remoteId) void agentStateRequest({ action: "rename_session", sessionId: remoteId, title }).then(() => scheduleRemoteRecentRefresh()).catch(() => showToast("서버 대화 이름 변경에 실패했습니다."));
  }

  function toggleFavoriteRecentConversation(conversationId) {
    const item = loadRecentWorkItems().find((entry) => entry.id === conversationId);
    if (!item) return;
    const nextFavorite = !item.isFavorite;
    updateRecentWorkItem(conversationId, { isFavorite: nextFavorite });
    const remoteId = getRemoteSessionId(item);
    if (remoteId) void agentStateRequest({ action: "toggle_favorite", sessionId: remoteId, favorite: nextFavorite }).then(() => scheduleRemoteRecentRefresh()).catch(() => showToast("즐겨찾기 변경에 실패했습니다."));
  }

  async function deleteRecentConversation(conversationId) {
    const item = loadRecentWorkItems().find((entry) => entry.id === conversationId);
    if (!item) return;
    const ok = await showDeleteDialog(item);
    if (!ok) return;
    const items = loadRecentWorkItems().filter((entry) => entry.id !== conversationId);
    saveRecentWorkItems(items);
    if (activeConversationId === conversationId) {
      startNewConversation();
      setMode("home");
    }
    renderRecentWorkList();
    const remoteId = getRemoteSessionId(item);
    if (remoteId) void agentStateRequest({ action: "delete_session", sessionId: remoteId }).then(() => scheduleRemoteRecentRefresh()).catch(() => showToast("서버 대화 삭제에 실패했습니다."));
  }

  function updateRecentWorkItem(conversationId, patch) {
    const items = loadRecentWorkItems();
    const index = items.findIndex((entry) => entry.id === conversationId);
    if (index < 0) return null;
    const next = { ...items[index], ...patch };
    items[index] = next;
    saveRecentWorkItems(sortRecentWorkItems(items));
    renderRecentWorkList();
    return next;
  }

  function upsertRecentWorkItem(item) {
    if (!item?.id) return;
    const items = loadRecentWorkItems().filter((entry) => entry.id !== item.id && (!item.remoteId || getRemoteSessionId(entry) !== item.remoteId));
    saveRecentWorkItems(sortRecentWorkItems([item, ...items]));
    renderRecentWorkList();
  }

  function sortRecentWorkItems(items) {
    return (Array.isArray(items) ? items : [])
      .filter((item) => item && item.id)
      .sort((a, b) => Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite)) || Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, MAX_RECENT_WORK);
  }

  function getRemoteSessionId(item) {
    const explicit = String(item?.remoteId || item?.remote_id || "").trim();
    if (explicit) return explicit;
    const id = String(item?.id || "").trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
  }

  function scheduleRemoteRecentRefresh(delay = REMOTE_SESSION_REFRESH_DEBOUNCE_MS) {
    if (!sessionToken && !readPersistedSessionToken()) return;
    window.clearTimeout(recentRemoteRefreshTimer);
    recentRemoteRefreshTimer = window.setTimeout(() => refreshRecentWorkFromServer(), delay);
  }

  async function refreshRecentWorkFromServer() {
    if (recentRemoteRefreshInProgress) return;
    const activeToken = await ensureValidSession({ silent: true });
    if (!activeToken) return;
    recentRemoteRefreshInProgress = true;
    renderRecentWorkList();
    try {
      let data = await agentStateRequest({ action: "list_sessions", limit: REMOTE_SESSION_LIST_LIMIT, featureMode: currentFeature, includeLegacy: currentFeature === "agent" });
      let remote = Array.isArray(data.sessions) ? data.sessions : [];
      if (!remote.length && currentFeature === "agent") {
        // 일부 배포 환경에서 feature_mode 마이그레이션 전 세션이 필터에서 제외되는 경우를 보정합니다.
        try {
          data = await agentStateRequest({ action: "list_sessions", limit: REMOTE_SESSION_LIST_LIMIT, featureMode: "all", includeLegacy: true });
          remote = (Array.isArray(data.sessions) ? data.sessions : []).filter((session) => getConversationFeature({
            id: session.id || session.sessionId || "",
            title: session.title || "",
            preview: session.snippet || session.preview || "",
            feature: session.feature_mode || session.featureMode || "",
            task: session.task || session.route || "",
            metadata: session.metadata || {},
          }) === "agent");
        } catch {}
      }
      recentRemoteEverLoaded = true;
      const local = loadRecentWorkItems();
      if (!remote.length) {
        saveRecentWorkItems(sortRecentWorkItems(local));
        renderRecentWorkList();
        return;
      }
      const next = [...local];
      remote.forEach((session) => {
        const remoteId = String(session.id || session.sessionId || "").trim();
        if (!remoteId) return;
        const title = String(session.title || "새 업무 요청").trim() || "새 업무 요청";
        const remoteFeature = getConversationFeature({
          id: remoteId,
          title,
          preview: session.snippet || session.preview || "",
          feature: session.feature_mode || session.featureMode || "",
          task: session.task || session.route || "",
          metadata: session.metadata || {},
        });
        // 서버가 feature_mode 없는 구버전 세션을 함께 반환하더라도 현재 모드 최근 작업에 섞지 않습니다.
        if (remoteFeature !== currentFeature) return;
        const updatedAt = Date.parse(session.display_time_at || session.last_activity_at || session.lastActivityAt || session.last_message_at || session.lastMessageAt || session.created_at || session.createdAt || session.updated_at || session.updatedAt || "") || Date.now();
        const foundIndex = next.findIndex((item) => getRemoteSessionId(item) === remoteId || item.id === remoteId);
        const patch = {
          remoteId,
          title,
          updatedAt,
          isFavorite: Boolean(session.is_favorite ?? session.isFavorite),
          feature: remoteFeature,
          task: remoteFeature === "knowledge" ? "knowledge_inquiry" : "general",
          preview: remoteFeature === "knowledge" ? "저장된 사내 지식 문의" : "저장된 업무 대화",
        };
        if (foundIndex >= 0) next[foundIndex] = { ...next[foundIndex], ...patch };
        else next.push({ id: remoteId, ...patch, messages: [] });
      });
      saveRecentWorkItems(sortRecentWorkItems(next));
      renderRecentWorkList();
    } catch {
      // 서버 세션 저장이 아직 배포되지 않은 환경에서는 로컬 최근 작업만 사용합니다.
      renderRecentWorkList();
    } finally {
      recentRemoteRefreshInProgress = false;
      ensureRecentEmptyState(loadRecentWorkItems());
    }
  }

  async function ensureRemoteSessionForActiveConversation(titleText = "") {
    if (!sessionToken || !activeConversationId) return "";
    const conversationId = activeConversationId;
    const item = getActiveConversation();
    const existing = getRemoteSessionId(item);
    if (existing) return existing;
    if (remoteSessionCreatePromise && remoteSessionCreateConversationId === conversationId) {
      return await remoteSessionCreatePromise;
    }
    remoteSessionCreateConversationId = conversationId;
    remoteSessionCreatePromise = (async () => {
      try {
        const title = createConversationTitle(titleText || item?.title || "새 업무 요청");
        const data = await agentStateRequest({ action: "create_session", title, featureMode: currentFeature });
        const remoteId = String(data?.session?.id || "").trim();
        if (remoteId && activeConversationId === conversationId) {
          updateRecentWorkItem(conversationId, { remoteId, title: data.session.title || title, feature: currentFeature, task: getCurrentConversationTask() });
        }
        return remoteId;
      } catch {
        return "";
      } finally {
        if (remoteSessionCreateConversationId === conversationId) {
          remoteSessionCreatePromise = null;
          remoteSessionCreateConversationId = "";
        }
      }
    })();
    return await remoteSessionCreatePromise;
  }

  async function saveRemoteConversationMessage(role, text, metadata = {}) {
    const content = String(text || "").trim();
    if (!content || !sessionToken || !activeConversationId) return null;
    const sessionId = await ensureRemoteSessionForActiveConversation(content);
    if (!sessionId) return null;
    try {
      const data = await agentStateRequest({ action: "save_message", sessionId, role, content, route: metadata.route || "", featureMode: metadata.feature || currentFeature, metadata: { ...metadata, feature: metadata.feature || currentFeature } });
      if (data?.session?.id) updateRecentWorkItem(activeConversationId, { remoteId: data.session.id, title: data.session.title || getActiveConversation()?.title || createConversationTitle(content), updatedAt: Date.now(), feature: currentFeature, task: getCurrentConversationTask() });
      scheduleRemoteRecentRefresh();
      return data;
    } catch {
      return null;
    }
  }

  async function agentStateRequest(payload) {
    const action = String(payload?.action || "");
    const activeToken = action === "refresh_session" ? sessionToken : await ensureValidSession({ silent: true });
    if (!activeToken) throw new Error("세션 갱신이 필요합니다.");
    const res = await fetch(AGENT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
      body: JSON.stringify(payload || {}),
    });
    return readApiResponse(res);
  }

  function createConversationTitle(text) {
    const cleaned = stripAttachmentBlock(text)
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return "새 업무 요청";
    return cleaned.length > 34 ? `${cleaned.slice(0, 34)}…` : cleaned;
  }

  function createConversationPreview(text) {
    const cleaned = stripAttachmentBlock(text)
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length > 72 ? `${cleaned.slice(0, 72)}…` : cleaned;
  }

  function stripAttachmentBlock(text) {
    return String(text || "").replace(/\n\n?\[첨부 파일\][\s\S]*$/m, "").trim();
  }

  function formatRelativeTime(timestamp) {
    const diff = Date.now() - Number(timestamp || 0);
    if (!Number.isFinite(diff) || diff < 0) return "방금 전";
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return "방금 전";
    if (diff < hour) return `${Math.floor(diff / minute)}분 전`;
    if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
    if (diff < day * 7) return `${Math.floor(diff / day)}일 전`;
    return new Date(Number(timestamp)).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
  }

  function getTaskIconClass(task) {
    const value = String(task || "");
    if (isKnowledgeTask(value)) return "knowledge";
    if (value.includes("excel")) return "excel";
    if (value.includes("translation")) return "translate";
    if (value.includes("summary")) return "summary";
    if (value.includes("report")) return "report";
    if (value.includes("file")) return "file";
    return "doc";
  }

  function getTaskIconText(task) {
    const value = String(task || "");
    if (isKnowledgeTask(value)) return "규";
    if (value.includes("excel")) return "X";
    if (value.includes("translation")) return "A";
    if (value.includes("summary")) return "≡";
    if (value.includes("report")) return "▥";
    if (value.includes("file")) return "▰";
    return "▤";
  }

  function restoreLocalHistory() {
    renderRecentWorkList();
  }

  function restoreAgentConversationFromCache() {
    return getRecentHistory();
  }

  function saveAgentConversationCache(key, messages) {
    try {
      sessionStorage.setItem(key, JSON.stringify(Array.isArray(messages) ? messages.slice(-MAX_HISTORY) : []));
    } catch {}
  }

  function setComposerDisabled(disabled) {
    const attachHidden = currentFeature === "knowledge";
    const attachDisabled = disabled || attachHidden;
    if (state.agentMessageInput) state.agentMessageInput.disabled = disabled;
    if (state.agentSendBtn) state.agentSendBtn.disabled = disabled;
    if (state.agentAttachBtn) {
      state.agentAttachBtn.hidden = attachHidden;
      state.agentAttachBtn.disabled = attachDisabled;
      state.agentAttachBtn.tabIndex = attachHidden ? -1 : 0;
    }
    if (state.homeAttachBtn) {
      state.homeAttachBtn.hidden = attachHidden;
      state.homeAttachBtn.disabled = attachDisabled;
      state.homeAttachBtn.tabIndex = attachHidden ? -1 : 0;
    }
    if (state.homeSendBtn) state.homeSendBtn.disabled = disabled;
  }

  function isPlainEnterSubmitEvent(event) {
    if (!event || event.key !== "Enter") return false;
    if (event.isComposing || event.keyCode === 229) return false;
    if (event.shiftKey) return false;
    return true;
  }

  function resizeTextarea(textarea) {
    if (!textarea) return;
    const value = String(textarea.value || "");
    const visible = isElementMeasurable(textarea);

    // 빈 입력창은 CSS 기본 높이를 사용합니다.
    // 숨겨진 홈 화면 textarea를 측정하면 브라우저마다 scrollHeight가 달라져,
    // 새 대화 버튼을 반복 클릭할 때 input 카드 높이가 들쭉날쭉해질 수 있습니다.
    if (!value.trim() || !visible) {
      resetTextareaVisualState(textarea);
      return;
    }

    textarea.style.height = "auto";
    const maxHeight = Math.min(window.innerHeight * 0.28, 180);
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    textarea.closest(".prompt-card")?.classList.toggle("is-scrollable", textarea.scrollHeight > maxHeight);
  }

  function resetTextareaVisualState(textarea) {
    if (!textarea) return;
    textarea.style.height = "";
    textarea.style.overflowY = "hidden";
    textarea.closest(".prompt-card")?.classList.remove("is-scrollable");
  }

  function syncHomePromptEmptyClass() {
    const card = state.homePromptInput?.closest(".prompt-card");
    if (!card || !state.homePromptInput) return;
    const empty = !String(state.homePromptInput.value || "").trim();
    card.classList.toggle("ds-home-empty", empty);
    if (empty) card.classList.remove("is-scrollable");
  }

  function normalizeHomeComposerLayout() {
    if (!state.homePromptInput) return;
    if (!String(state.homePromptInput.value || "").trim()) {
      resetTextareaVisualState(state.homePromptInput);
    }
    syncHomePromptEmptyClass();
  }

  function resetHomePromptVisualState() {
    normalizeHomeComposerLayout();
  }

  function isElementMeasurable(element) {
    if (!element) return false;
    return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function showToast(message) {
    document.querySelector(".ds-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "ds-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 200); }, 1800);
  }

  function decodeSessionTokenPayload(token) {
    if (!token) return null;
    try {
      const part = String(token).split(".")[0] || "";
      const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      const json = decodeURIComponent(Array.from(atob(padded)).map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
      return JSON.parse(json);
    } catch { return null; }
  }

  function getDisplayName(profile) {
    if (!profile) return "";
    const candidates = [profile.userName, profile.user_name, profile.name, profile.displayName, profile.display_name, profile.empName, profile.empNm, profile.loginId, profile.login_id, profile.empNo, profile.emp_no];
    return candidates.map((value) => String(value || "").trim()).find((value) => value && value !== "undefined" && value !== "null") || "";
  }

  function applyHeaderProfile(profile) {
    const displayName = getDisplayName(profile);
    if (!displayName) return;
    if (!state.profileName) state.profileName = document.querySelector(".profile-button strong");
    if (!state.profileAvatar) state.profileAvatar = document.querySelector(".avatar");
    if (state.profileName) state.profileName.textContent = displayName;
    if (state.profileAvatar) state.profileAvatar.textContent = displayName.slice(0, 1);
    cacheDisplayName(displayName);
  }

  async function bootstrapProfile() {
    const activeToken = await ensureValidSession({ silent: true });
    if (!activeToken) {
      restoreCachedIdentity();
      migrateAnonymousRecentWorkToCurrentUser();
      renderRecentWorkList();
      return;
    }
    try {
      const res = await fetch(AGENT_API_URL, { method: "GET", headers: { Authorization: `Bearer ${activeToken}` } });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        currentLoginId = data.loginId || data.login_id || currentLoginId;
        currentEmpNo = data.empNo || data.emp_no || data.rpaAuthEmpNo || currentEmpNo;
        persistLastIdentity(data);
        migrateAnonymousRecentWorkToCurrentUser();
        applyHeaderProfile(data);
        renderRecentWorkList();
        scheduleRemoteRecentRefresh(50);
      }
    } catch {}
  }

  function applyIdentityFromPayload(profile) {
    if (!profile) return;
    currentLoginId = String(profile.loginId || profile.login_id || currentLoginId || "").trim();
    currentEmpNo = String(profile.empNo || profile.emp_no || profile.rpaAuthEmpNo || currentEmpNo || "").trim();
  }

  function persistLastIdentity(profile) {
    if (!profile) return;
    const identity = {
      empNo: String(profile.empNo || profile.emp_no || profile.rpaAuthEmpNo || currentEmpNo || "").trim(),
      loginId: String(profile.loginId || profile.login_id || currentLoginId || "").trim(),
      displayName: getDisplayName(profile),
      savedAt: Date.now(),
    };
    if (!identity.empNo && !identity.loginId) return;
    try { localStorage.setItem(LAST_IDENTITY_KEY, JSON.stringify(identity)); } catch {}
  }

  function getCachedIdentity() {
    try {
      const raw = localStorage.getItem(LAST_IDENTITY_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - Number(data.savedAt || 0) > LAST_IDENTITY_CACHE_TTL_MS) return null;
      return data;
    } catch { return null; }
  }

  function restoreCachedIdentity() {
    const cached = getCachedIdentity();
    if (!cached) return;
    currentEmpNo = String(cached.empNo || currentEmpNo || "").trim();
    currentLoginId = String(cached.loginId || currentLoginId || "").trim();
    if (cached.displayName) applyHeaderProfile({ displayName: cached.displayName });
  }

  function migrateAnonymousRecentWorkToCurrentUser() {
    const userKey = getStorageUserKey();
    if (!userKey || userKey === "anonymous") return;
    ["agent", "knowledge"].forEach((feature) => {
      const anonymousKey = `${RECENT_WORK_PREFIX}anonymous_${feature}`;
      const currentKey = getRecentWorkKey(feature);
      if (anonymousKey === currentKey) return;
      try {
        const raw = localStorage.getItem(anonymousKey);
        if (!raw) return;
        const anonymousItems = JSON.parse(raw);
        if (!Array.isArray(anonymousItems) || !anonymousItems.length) return;
        const existingRaw = localStorage.getItem(currentKey);
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        const merged = sortRecentWorkItems(dedupeRecentItems([...(Array.isArray(existing) ? existing : []), ...anonymousItems.map((item) => ({ ...item, feature }))]));
        localStorage.setItem(currentKey, JSON.stringify(merged));
        localStorage.removeItem(anonymousKey);
      } catch {}
    });

    // v55 이전에는 feature suffix가 없는 anonymous key를 사용했습니다. 남아 있으면 mode별로 분리 이관합니다.
    try {
      const legacyKey = RECENT_WORK_PREFIX + "anonymous";
      const raw = localStorage.getItem(legacyKey);
      if (!raw) return;
      const anonymousItems = JSON.parse(raw);
      if (!Array.isArray(anonymousItems) || !anonymousItems.length) return;
      anonymousItems.forEach((item) => {
        const feature = getConversationFeature(item);
        const targetKey = getRecentWorkKey(feature);
        const existing = JSON.parse(localStorage.getItem(targetKey) || "[]");
        localStorage.setItem(targetKey, JSON.stringify(sortRecentWorkItems(dedupeRecentItems([...(Array.isArray(existing) ? existing : []), { ...item, feature }]))));
      });
      localStorage.removeItem(legacyKey);
    } catch {}
  }

  function cacheDisplayName(displayName) {
    try { localStorage.setItem(DISPLAY_NAME_CACHE_KEY, JSON.stringify({ displayName, savedAt: Date.now() })); } catch {}
  }
  function getCachedDisplayName() {
    try {
      const raw = localStorage.getItem(DISPLAY_NAME_CACHE_KEY);
      if (!raw) return "";
      const data = JSON.parse(raw);
      if (Date.now() - Number(data.savedAt || 0) > DISPLAY_NAME_CACHE_TTL_MS) return "";
      return String(data.displayName || "").trim();
    } catch { return ""; }
  }
  function restoreCachedDisplayName() {
    const cached = getCachedDisplayName();
    if (cached) applyHeaderProfile({ displayName: cached });
  }

  function formatFileSize(size) {
    const value = Number(size || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
    if (value >= 1024) return `${Math.round(value / 1024)}KB`;
    return `${value}B`;
  }
  function getErrorMessage(error) { return error instanceof Error ? error.message : String(error || "알 수 없는 오류"); }
  function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
