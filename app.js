(() => {
  "use strict";

  // DS ONE 업무 AI Agent 기능 레이어
  // - 메인 index.html 요소와 style.css 디자인은 건드리지 않고 기능만 런타임으로 연결합니다.
  // - 그룹웨어 iframe에서는 108x108 런처 버튼만 표시합니다.

  const CONFIG = window.DS_ONE_CONFIG || {};
  const ENDPOINTS = CONFIG.endpoints || {};
  const STORAGE = CONFIG.storage || {};
  const FILE_POLICY = CONFIG.filePolicy || {};

  const AGENT_API_URL = ENDPOINTS.agentApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/agent-api";
  const FILE_API_URL = ENDPOINTS.fileApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/file-api";
  const SESSION_TOKEN_KEY = "sso_session_token";
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
  let activeConversationId = "";
  let recentContextMenu = null;
  let recentRemoteRefreshTimer = 0;
  let recentRemoteRefreshInProgress = false;

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
  };

  function init() {
    sessionToken = readSsoSessionToken();
    const tokenProfile = decodeSessionTokenPayload(sessionToken);
    if (tokenProfile) {
      currentLoginId = tokenProfile.loginId || tokenProfile.login_id || "";
      currentEmpNo = tokenProfile.empNo || tokenProfile.emp_no || "";
      applyHeaderProfile(tokenProfile);
    }

    if (isEmbeddedInIframe()) {
      showIframeLauncher(tokenProfile);
      return;
    }

    restoreCachedDisplayName();
    injectRuntimeStyles();
    attachToExistingHome();
    createRuntimeAgentWorkspace();
    bootstrapProfile();
    bindUiEvents();
    renderRecentWorkList();
    scheduleRemoteRecentRefresh(120);
    resizeTextarea(state.homePromptInput);
    resizeTextarea(state.agentMessageInput);
  }

  function readSsoSessionToken() {
    const url = new URL(window.location.href);
    const tokenFromUrl = String(url.searchParams.get("token") || "").trim();
    if (tokenFromUrl) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, tokenFromUrl);
      url.searchParams.delete("token");
      url.searchParams.delete("open");
      window.history.replaceState({}, document.title, url.toString());
      return tokenFromUrl;
    }
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
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
      .ds-msg-table-wrap { margin: 12px 0 18px; }
      .ds-msg-table-toolbar { display: flex; justify-content: flex-end; margin-bottom: 7px; }
      .ds-msg-table-toolbar button,
      .ds-bot-copy-btn {
        height: 28px;
        padding: 0 10px;
        color: #2f5fb6;
        font-size: 12px;
        font-weight: 850;
        background: #eef5ff;
        border: 1px solid #d8e6ff;
        border-radius: 999px;
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
      .ds-bot-copy-btn {
        align-self: flex-start;
        margin-left: 42px;
        opacity: 0;
        transform: translateY(-2px);
        transition: opacity .16s ease, transform .16s ease;
      }
      .ds-bot-row:hover .ds-bot-copy-btn,
      .ds-bot-copy-btn:focus-visible { opacity: .92; transform: translateY(0); }
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
        min-height: 92px;
        display: grid;
        place-items: center;
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
        .ds-bot-copy-btn { margin-left: 0; }
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

    const promptCard = document.querySelector(".prompt-card");
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
  }

  function bindUiEvents() {
    document.querySelectorAll(".menu-item").forEach((button) => {
      const label = button.textContent.trim();
      if (label.includes("새 대화")) {
        button.addEventListener("click", () => {
          startNewConversation({ showToast: true });
          setMode("home");
        });
      } else if (label.includes("검색") || label.includes("템플릿") || label.includes("AI 도구") || label.includes("즐겨찾기") || label.includes("휴지통")) {
        button.addEventListener("click", () => showToast("해당 기능은 추후 연동 예정입니다."));
      }
    });

    document.querySelectorAll(".action-card").forEach((card) => {
      card.addEventListener("click", () => {
        const meta = getCardTemplate(card);
        currentTask = meta.task;
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
    state.homePromptInput?.addEventListener("input", () => resizeTextarea(state.homePromptInput));
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
    });
    window.addEventListener("resize", () => {
      closeRecentContextMenu();
      resizeTextarea(state.homePromptInput);
      resizeTextarea(state.agentMessageInput);
    });
  }

  function getCardTemplate(card) {
    const title = card.querySelector(".card-title")?.textContent.trim() || card.textContent.trim();
    if (title.includes("문서 작성")) return { task: "document_draft", attach: false, template: "아래 내용을 바탕으로 업무용 문서 초안을 작성해 주세요.\n\n[작성할 내용]\n" };
    if (title.includes("문서 요약")) return { task: "document_summary", attach: false, template: "아래 내용을 핵심만 간결하게 요약해 주세요.\n\n[요약할 내용]\n" };
    if (title.includes("문서 번역")) return { task: "translation", attach: false, template: "아래 문서를 자연스러운 업무 문체로 번역해 주세요.\n\n[번역할 내용]\n" };
    if (title.includes("엑셀 분석")) return { task: "excel_analysis", attach: true, template: "첨부한 엑셀 파일의 전체 구조를 요약하고 핵심 이슈를 분석해 주세요." };
    if (title.includes("PDF 분석")) return { task: "file_question", attach: true, template: "첨부한 파일을 기준으로 질문에 답변해 주세요.\n\n[질문]\n" };
    if (title.includes("PPT생성")) return { task: "report_summary", attach: false, template: "아래 내용을 보고용으로 정리해 주세요. 형식은 결론, 핵심 내용, 이슈/리스크, 다음 조치로 작성해 주세요.\n\n[정리할 내용]\n" };
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
      window.setTimeout(() => state.homePromptInput?.focus(), 60);
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
    if (state.homePromptInput) state.homePromptInput.value = "";
    resizeTextarea(state.homePromptInput);
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
    resizeTextarea(state.homePromptInput);
    window.setTimeout(() => state.homePromptInput?.focus(), 30);
  }

  function startNewConversation(options = {}) {
    const { showToast: shouldShowToast = false } = options || {};
    closeRecentContextMenu();
    activeConversationId = "";
    currentTask = "";
    selectedFiles = [];
    renderFileChips();
    clearMessages();
    if (state.agentMessageInput) state.agentMessageInput.value = "";
    if (state.homePromptInput) state.homePromptInput.value = "";
    resizeTextarea(state.agentMessageInput);
    resizeTextarea(state.homePromptInput);
    sessionStorage.removeItem(getLocalHistoryKey());
    renderRecentWorkList();
    if (shouldShowToast) showToast("새 대화를 시작했습니다.");
  }

  function clearMessages() {
    if (!state.agentBody) return;
    state.agentBody.querySelectorAll(".ds-chat-row,.ds-thinking-row").forEach((node) => node.remove());
    const emptyCard = state.agentBody.querySelector(".ds-agent-empty-card");
    if (emptyCard) emptyCard.hidden = false;
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    const rejected = [];
    files.forEach((file) => {
      const reason = validateFile(file);
      if (reason) {
        rejected.push(reason);
        return;
      }
      const duplicated = selectedFiles.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
      if (!duplicated) selectedFiles.push(file);
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
    if (!sessionToken) {
      addMessage("bot", "그룹웨어 SSO 인증 정보가 없습니다. 그룹웨어 버튼을 통해 다시 접속해 주세요.");
      return;
    }

    submitInProgress = true;
    setComposerDisabled(true);
    const userText = message || "첨부한 파일을 분석해 주세요.";
    const history = getRecentHistory();
    const displayUserMessage = buildDisplayUserMessage(userText);
    ensureActiveConversation(userText, displayUserMessage);
    appendConversationMessage("user", displayUserMessage);
    void saveRemoteConversationMessage("user", displayUserMessage, { route: selectedFiles.length ? "file-api" : "agent-api", task: normalizeTask(currentTask) || currentTask || "general" });
    addMessage("user", displayUserMessage);
    if (state.agentMessageInput) state.agentMessageInput.value = "";
    resizeTextarea(state.agentMessageInput);
    const thinking = addThinkingMessage("생각 중");

    try {
      const data = selectedFiles.length ? await requestFileAnalysis(userText, history) : await requestAgentAnswer(userText, history);
      thinking.remove();
      const answer = extractAnswerText(data) || "답변을 생성하지 못했습니다.";
      addMessage("bot", answer);
      appendConversationMessage("assistant", answer);
      void saveRemoteConversationMessage("assistant", answer, { route: selectedFiles.length ? "file-api" : "agent-api", task: normalizeTask(currentTask) || currentTask || "general" });
      saveLocalHistory(userText, answer);
      renderRecentWorkList();
    } catch (error) {
      thinking.remove();
      const errorText = `업무 AI Agent 처리 중 오류가 발생했습니다.\n${getErrorMessage(error)}`;
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

  async function requestAgentAnswer(message, history) {
    const res = await fetch(AGENT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ message, stream: false, task: normalizeTask(currentTask), history }),
    });
    return readApiResponse(res);
  }

  async function requestFileAnalysis(message, history) {
    const formData = new FormData();
    formData.append("message", message);
    formData.append("stream", "false");
    formData.append("history", JSON.stringify(history));
    const normalizedTask = normalizeTask(currentTask);
    if (normalizedTask) formData.append("task", normalizedTask);
    selectedFiles.forEach((file) => formData.append("files", file, file.name));
    const res = await fetch(FILE_API_URL, { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` }, body: formData });
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
    if (!value || value === "excel_analysis" || value === "file_question" || value === "document_draft") return "";
    if (value === "document_summary") return "document_summary";
    if (value === "translation") return "translation";
    if (value === "report_summary") return "report_summary";
    return value;
  }

  function extractAnswerText(data) {
    if (!data) return "";
    return String(data.answer || data.text || data.message || data.raw || "").trim();
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
    if (role === "bot") renderMessageContent(msg, text); else msg.textContent = text;
    row.appendChild(msg);
    if (role === "bot") addCopyButton(row, msg);
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

  function renderMessageContent(container, text) {
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
        appendMarkdownTable(container, tableLines);
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
        appendInlineMarkdown(div, trimmed.replace(/^>\s+/, ""));
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
        appendInlineMarkdown(div, numbered[2]);
        container.appendChild(div);
        continue;
      }

      if (/^[-•]\s+/.test(trimmed)) {
        const div = document.createElement("div");
        div.className = "ds-msg-bullet";
        appendInlineMarkdown(div, trimmed.replace(/^[-•]\s+/, ""));
        container.appendChild(div);
        continue;
      }

      const div = document.createElement("div");
      div.className = "ds-msg-paragraph";
      appendInlineMarkdown(div, line);
      container.appendChild(div);
    }

    if (inCode && codeLines.length) appendCodeBlock(container, codeLines.join("\n"));
  }

  function getHeadingText(line) {
    const markdown = line.match(/^#{1,4}\s+(.+)$/);
    if (markdown) return markdown[1].replace(/[:：]\s*$/, "").trim();
    const section = line.match(/^\s*(결론|요약|분석 결과|파일 구조 요약|핵심 이슈|우선 조치|기준 및 근거|확인 필요|확인되지 않은 항목|다음 조치|상세 내용|참고 사항)\s*[:：]?\s*$/);
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

  function appendMarkdownTable(container, tableLines) {
    const wrap = document.createElement("div");
    wrap.className = "ds-msg-table-wrap";
    const toolbar = document.createElement("div");
    toolbar.className = "ds-msg-table-toolbar";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "표 복사";
    copyBtn.addEventListener("click", async () => {
      const tsv = tableLines.filter((line) => !isMarkdownTableSeparator(line)).map((line) => parseTableRow(line).join("\t")).join("\n");
      const ok = await copyToClipboard(tsv);
      copyBtn.textContent = ok ? "복사 완료" : "복사 실패";
      setTimeout(() => { copyBtn.textContent = "표 복사"; }, 1200);
    });
    toolbar.appendChild(copyBtn);
    wrap.appendChild(toolbar);
    const scroll = document.createElement("div");
    scroll.className = "ds-msg-table-scroll";
    const table = document.createElement("table");
    table.className = "ds-msg-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    parseTableRow(tableLines[0]).forEach((cell) => { const th = document.createElement("th"); appendInlineMarkdown(th, cell); hr.appendChild(th); });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    tableLines.slice(2).forEach((line) => {
      if (!isMarkdownTableLine(line) || isMarkdownTableSeparator(line)) return;
      const tr = document.createElement("tr");
      parseTableRow(line).forEach((cell) => { const td = document.createElement("td"); appendInlineMarkdown(td, cell); tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    container.appendChild(wrap);
  }

  function appendInlineMarkdown(parent, text) {
    const value = String(text || "");
    const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
    let last = 0;
    let match;
    while ((match = regex.exec(value))) {
      if (match.index > last) parent.appendChild(document.createTextNode(value.slice(last, match.index)));
      if (match[2]) { const strong = document.createElement("strong"); strong.textContent = match[2]; parent.appendChild(strong); }
      else if (match[3]) { const code = document.createElement("code"); code.textContent = match[3]; parent.appendChild(code); }
      last = regex.lastIndex;
    }
    if (last < value.length) parent.appendChild(document.createTextNode(value.slice(last)));
  }

  function addCopyButton(row, msg) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ds-bot-copy-btn";
    button.textContent = "복사";
    button.addEventListener("click", async () => {
      const ok = await copyToClipboard(msg.textContent || "");
      button.textContent = ok ? "복사 완료" : "복사 실패";
      setTimeout(() => { button.textContent = "복사"; }, 1200);
    });
    row.appendChild(button);
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
    return String(currentEmpNo || currentLoginId || "anonymous").replace(/[^a-zA-Z0-9_.:-]/g, "_");
  }

  function getLocalHistoryKey() {
    return LOCAL_HISTORY_PREFIX + getStorageUserKey();
  }

  function getRecentWorkKey() {
    return RECENT_WORK_PREFIX + getStorageUserKey();
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

  function loadRecentWorkItems() {
    try {
      const raw = localStorage.getItem(getRecentWorkKey());
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data.filter((item) => item && item.id).slice(0, MAX_RECENT_WORK) : [];
    } catch { return []; }
  }

  function saveRecentWorkItems(items) {
    try {
      localStorage.setItem(getRecentWorkKey(), JSON.stringify((items || []).slice(0, MAX_RECENT_WORK)));
    } catch {}
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
      task: normalizeTask(currentTask) || currentTask || "general",
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
    const items = loadRecentWorkItems();
    renderSidebarRecentList(items);
    renderLowerRecentList(items);
  }

  function renderSidebarRecentList(items) {
    if (!state.recentList) return;
    state.recentList.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "ds-recent-empty";
      empty.textContent = "아직 최근 작업이 없습니다.\n업무를 요청하면 자동으로 쌓입니다.";
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

  async function openRecentConversation(conversationId) {
    const item = loadRecentWorkItems().find((entry) => entry.id === conversationId);
    if (!item) return;
    activeConversationId = item.id;
    currentTask = item.task || "";
    selectedFiles = [];
    renderFileChips();
    clearMessages();
    setMode("doc");

    const remoteId = getRemoteSessionId(item);
    if (remoteId && sessionToken) {
      try {
        const data = await agentStateRequest({ action: "load_session", sessionId: remoteId });
        const messages = Array.isArray(data.messages) ? data.messages : [];
        messages.forEach((message) => addMessage(message.role === "assistant" ? "bot" : "user", message.content || message.text || ""));
        if (messages.length) {
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
    renderRecentWorkList();
  }

  function renderLocalConversationMessages(item) {
    const messages = Array.isArray(item?.messages) ? item.messages : [];
    messages.forEach((message) => addMessage(message.role === "assistant" ? "bot" : "user", message.text || ""));
  }

  function renameRecentConversation(conversationId) {
    const item = loadRecentWorkItems().find((entry) => entry.id === conversationId);
    if (!item) return;
    const next = window.prompt("대화 이름을 입력하세요.", item.title || "새 업무 요청");
    if (next === null) return;
    const title = String(next || "").trim();
    if (!title) return;
    updateRecentWorkItem(conversationId, { title, updatedAt: Date.now() });
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

  function deleteRecentConversation(conversationId) {
    const item = loadRecentWorkItems().find((entry) => entry.id === conversationId);
    if (!item) return;
    const ok = window.confirm(`'${item.title || "최근 작업"}' 대화를 삭제할까요?`);
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
    if (!sessionToken) return;
    window.clearTimeout(recentRemoteRefreshTimer);
    recentRemoteRefreshTimer = window.setTimeout(() => refreshRecentWorkFromServer(), delay);
  }

  async function refreshRecentWorkFromServer() {
    if (!sessionToken || recentRemoteRefreshInProgress) return;
    recentRemoteRefreshInProgress = true;
    try {
      const data = await agentStateRequest({ action: "list_sessions", limit: REMOTE_SESSION_LIST_LIMIT });
      const remote = Array.isArray(data.sessions) ? data.sessions : [];
      if (!remote.length) return;
      const local = loadRecentWorkItems();
      const next = [...local];
      remote.forEach((session) => {
        const remoteId = String(session.id || session.sessionId || "").trim();
        if (!remoteId) return;
        const updatedAt = Date.parse(session.display_time_at || session.last_activity_at || session.lastActivityAt || session.last_message_at || session.lastMessageAt || session.created_at || session.createdAt || session.updated_at || session.updatedAt || "") || Date.now();
        const foundIndex = next.findIndex((item) => getRemoteSessionId(item) === remoteId || item.id === remoteId);
        const patch = {
          remoteId,
          title: String(session.title || "새 업무 요청").trim() || "새 업무 요청",
          updatedAt,
          isFavorite: Boolean(session.is_favorite ?? session.isFavorite),
          task: "general",
          preview: "저장된 업무 대화",
        };
        if (foundIndex >= 0) next[foundIndex] = { ...next[foundIndex], ...patch };
        else next.push({ id: remoteId, ...patch, messages: [] });
      });
      saveRecentWorkItems(sortRecentWorkItems(next));
      renderRecentWorkList();
    } catch {
      // 서버 세션 저장이 아직 배포되지 않은 환경에서는 로컬 최근 작업만 사용합니다.
    } finally {
      recentRemoteRefreshInProgress = false;
    }
  }

  async function ensureRemoteSessionForActiveConversation(titleText = "") {
    if (!sessionToken || !activeConversationId) return "";
    const item = getActiveConversation();
    const existing = getRemoteSessionId(item);
    if (existing) return existing;
    try {
      const title = createConversationTitle(titleText || item?.title || "새 업무 요청");
      const data = await agentStateRequest({ action: "create_session", title });
      const remoteId = String(data?.session?.id || "").trim();
      if (remoteId) updateRecentWorkItem(activeConversationId, { remoteId, title: data.session.title || title });
      return remoteId;
    } catch {
      return "";
    }
  }

  async function saveRemoteConversationMessage(role, text, metadata = {}) {
    const content = String(text || "").trim();
    if (!content || !sessionToken || !activeConversationId) return null;
    const sessionId = await ensureRemoteSessionForActiveConversation(content);
    if (!sessionId) return null;
    try {
      const data = await agentStateRequest({ action: "save_message", sessionId, role, content, route: metadata.route || "", metadata });
      if (data?.session?.id) updateRecentWorkItem(activeConversationId, { remoteId: data.session.id, title: data.session.title || getActiveConversation()?.title || createConversationTitle(content), updatedAt: Date.now() });
      scheduleRemoteRecentRefresh();
      return data;
    } catch {
      return null;
    }
  }

  async function agentStateRequest(payload) {
    const res = await fetch(AGENT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
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
    if (value.includes("excel")) return "excel";
    if (value.includes("translation")) return "translate";
    if (value.includes("summary")) return "summary";
    if (value.includes("report")) return "report";
    if (value.includes("file")) return "file";
    return "doc";
  }

  function getTaskIconText(task) {
    const value = String(task || "");
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
    if (state.agentMessageInput) state.agentMessageInput.disabled = disabled;
    if (state.agentSendBtn) state.agentSendBtn.disabled = disabled;
    if (state.agentAttachBtn) state.agentAttachBtn.disabled = disabled;
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
    textarea.style.height = "auto";
    const maxHeight = Math.min(window.innerHeight * 0.28, 180);
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
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
    if (!sessionToken) return;
    try {
      const res = await fetch(AGENT_API_URL, { method: "GET", headers: { Authorization: `Bearer ${sessionToken}` } });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        currentLoginId = data.loginId || data.login_id || currentLoginId;
        currentEmpNo = data.empNo || data.emp_no || data.rpaAuthEmpNo || currentEmpNo;
        applyHeaderProfile(data);
        renderRecentWorkList();
        scheduleRemoteRecentRefresh(50);
      }
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
