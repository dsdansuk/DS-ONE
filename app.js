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
  const MAX_HISTORY = Number(STORAGE.agentHistoryCacheMaxMessages || 20);

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
    restoreLocalHistory();
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
      .home-stage.ds-agent-mode{justify-content:stretch;align-items:stretch;padding:0;background:#fff}.home-stage.ds-agent-mode::before,.home-stage.ds-agent-mode::after{display:none!important}.home-stage.ds-agent-mode .home-fit[hidden]{display:none!important}.ds-agent-workspace[hidden]{display:none!important}.ds-agent-workspace{position:relative;z-index:2;flex:1 1 auto;width:100%;min-width:0;min-height:0;height:100%;display:grid;grid-template-rows:minmax(0,1fr) auto;padding:0 clamp(18px,3vw,48px) clamp(12px,2dvh,22px);overflow:hidden;background:#fff}.ds-agent-body{min-height:0;display:flex;flex-direction:column;gap:18px;overflow-y:auto;padding:clamp(24px,7dvh,76px) 0 24px;scrollbar-width:thin}.ds-chat-row,.ds-thinking-row{width:min(960px,100%);display:flex;gap:12px;margin:0 auto}.ds-user-row{justify-content:flex-end}.ds-bot-row{justify-content:flex-start;align-items:flex-start}.ds-chat-avatar{display:none}.ds-msg{max-width:min(720px,calc(100% - 48px));padding:12px 16px;font-size:15px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere;border:0;box-shadow:none}.ds-msg.user{color:#111827;background:#f3f4f6;border-radius:20px}.ds-msg.bot{max-width:min(780px,100%);padding:0;color:#202124;background:transparent;border-radius:0}.ds-thinking-row .ds-msg{padding:0;color:#9ca3af;background:transparent;border:0;font-size:15px}.ds-msg-heading{margin:18px 0 8px;font-weight:900;font-size:16px;color:#121827}.ds-msg-heading:first-child{margin-top:0}.ds-msg-bullet{padding-left:2px}.ds-msg-table-wrap{margin:10px 0 14px}.ds-msg-table-toolbar{display:flex;justify-content:flex-end;margin-bottom:6px}.ds-msg-table-toolbar button,.ds-bot-copy-btn{height:28px;padding:0 10px;color:#2f5fb6;font-size:12px;font-weight:800;background:#eef5ff;border:1px solid #d8e6ff;border-radius:999px}.ds-msg-table-scroll{max-width:100%;overflow:auto;border:1px solid #e0e7f3;border-radius:12px;background:#fff}.ds-msg-table{width:max-content;min-width:100%;border-collapse:collapse;font-size:13px}.ds-msg-table th,.ds-msg-table td{padding:8px 10px;border-bottom:1px solid #edf1f7;text-align:left;vertical-align:top;white-space:nowrap}.ds-msg-table th{background:#f5f8fd;font-weight:900;color:#263146}.ds-bot-copy-btn{align-self:flex-start;margin-left:calc((100% - min(960px,100%))/2);opacity:.86}.ds-agent-composer{width:min(860px,100%);margin:0 auto;display:grid;gap:8px}.ds-file-chip-row,.ds-home-file-chip-row{display:flex;flex-wrap:wrap;gap:7px}.ds-file-chip{display:inline-flex;align-items:center;gap:7px;max-width:260px;min-height:30px;padding:5px 8px;color:#29456f;background:#eef5ff;border:1px solid #d8e6ff;border-radius:999px;font-size:12px;font-weight:750}.ds-file-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ds-file-chip em{font-style:normal;color:#6a7690;font-weight:700}.ds-file-chip button{width:20px;height:20px;display:grid;place-items:center;color:#6a7690;background:#fff;border:1px solid #d8e6ff;border-radius:999px}.ds-agent-input-row{display:flex;align-items:flex-end;gap:8px;padding:10px;background:#fff;border:1px solid #dfe7f2;border-radius:18px;box-shadow:0 14px 30px rgba(37,48,77,.08)}.ds-attach-btn,.ds-agent-send-btn{width:40px;height:40px;display:grid;place-items:center;flex:0 0 auto;color:#2f5fb6;background:#f2f7ff;border:1px solid #d8e6ff;border-radius:12px}.ds-agent-send-btn{color:#fff;background:linear-gradient(145deg,var(--blue,#2f6fed),#7da8ff);border-color:transparent}.ds-agent-input-row textarea{min-height:40px;max-height:160px;flex:1;resize:none;border:0;outline:0;background:transparent;color:#1b2332;font:inherit;line-height:1.5;padding:8px 4px}.ds-agent-disclaimer{margin:0;color:#8a93a5;font-size:12px;text-align:center}.ds-toast{position:fixed;left:50%;bottom:24px;z-index:9999;min-width:220px;max-width:min(420px,calc(100vw - 32px));padding:12px 14px;color:#fff;font-size:14px;font-weight:800;text-align:center;background:rgba(20,28,44,.92);border-radius:999px;box-shadow:0 14px 36px rgba(0,0,0,.18);transform:translate(-50%,12px);opacity:0;transition:opacity .18s ease,transform .18s ease}.ds-toast.show{opacity:1;transform:translate(-50%,0)}@media(max-width:900px){.ds-agent-workspace{padding:0 14px 12px}.ds-msg{max-width:min(720px,calc(100% - 24px))}.ds-agent-body{padding-top:28px}}
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
          startNewConversation();
          setMode("doc");
        });
      } else if (label.includes("검색") || label.includes("즐겨찾기") || label.includes("휴지통")) {
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

    document.querySelectorAll(".sidebar-guide-button,.header-button,.recent-item,.task-row").forEach((button) => {
      button.addEventListener("click", () => showToast("해당 기능은 추후 연동 예정입니다."));
    });
    window.addEventListener("resize", () => {
      resizeTextarea(state.homePromptInput);
      resizeTextarea(state.agentMessageInput);
    });
  }

  function getCardTemplate(card) {
    const title = card.querySelector(".card-title")?.textContent.trim() || card.textContent.trim();
    if (title.includes("문서")) return { task: "document_draft", attach: false, template: "아래 내용을 바탕으로 업무용 문서 초안을 작성해 주세요.\n\n[작성할 내용]\n" };
    if (title.includes("요약")) return { task: "document_summary", attach: false, template: "아래 내용을 핵심만 간결하게 요약해 주세요.\n\n[요약할 내용]\n" };
    if (title.includes("번역")) return { task: "translation", attach: false, template: "아래 문서를 자연스러운 업무 문체로 번역해 주세요.\n\n[번역할 내용]\n" };
    if (title.includes("엑셀")) return { task: "excel_analysis", attach: true, template: "첨부한 엑셀 파일의 전체 구조를 요약하고 핵심 이슈를 분석해 주세요." };
    if (title.includes("파일")) return { task: "file_question", attach: true, template: "첨부한 파일을 기준으로 질문에 답변해 주세요.\n\n[질문]\n" };
    if (title.includes("보고서")) return { task: "report_summary", attach: false, template: "아래 내용을 보고용으로 정리해 주세요. 형식은 결론, 핵심 내용, 이슈/리스크, 다음 조치로 작성해 주세요.\n\n[정리할 내용]\n" };
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

  function startNewConversation() {
    selectedFiles = [];
    renderFileChips();
    clearMessages();
    if (state.agentMessageInput) state.agentMessageInput.value = "";
    resizeTextarea(state.agentMessageInput);
    sessionStorage.removeItem(getLocalHistoryKey());
    showToast("새 대화를 시작했습니다.");
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
    addMessage("user", buildDisplayUserMessage(userText));
    if (state.agentMessageInput) state.agentMessageInput.value = "";
    resizeTextarea(state.agentMessageInput);
    const thinking = addThinkingMessage("생각 중...");

    try {
      const history = getRecentHistory();
      const data = selectedFiles.length ? await requestFileAnalysis(userText, history) : await requestAgentAnswer(userText, history);
      thinking.remove();
      const answer = extractAnswerText(data) || "답변을 생성하지 못했습니다.";
      addMessage("bot", answer);
      saveLocalHistory(userText, answer);
    } catch (error) {
      thinking.remove();
      addMessage("bot", `업무 AI Agent 처리 중 오류가 발생했습니다.\n${getErrorMessage(error)}`);
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
    row.innerHTML = `<span class="ds-chat-avatar">AI</span><div class="ds-msg bot">${escapeHtml(text)}</div>`;
    state.agentBody.appendChild(row);
    state.agentBody.scrollTop = state.agentBody.scrollHeight;
    return row;
  }

  function renderMessageContent(container, text) {
    container.innerHTML = "";
    const lines = normalizeAnswerText(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) { container.appendChild(document.createElement("br")); continue; }
      if (isMarkdownTableStart(lines, i)) {
        const tableLines = [];
        while (i < lines.length && isMarkdownTableLine(lines[i])) { tableLines.push(lines[i]); i += 1; }
        i -= 1;
        appendMarkdownTable(container, tableLines);
        continue;
      }
      const div = document.createElement("div");
      const heading = line.match(/^\s*(결론|요약|분석 결과|파일 구조 요약|핵심 이슈|우선 조치|기준 및 근거|확인 필요|다음 조치)\s*:?\s*$/);
      if (heading) { div.className = "ds-msg-heading"; div.textContent = heading[1]; }
      else if (/^\s*[-•]\s+/.test(line)) { div.className = "ds-msg-bullet"; div.textContent = line.replace(/^\s*[-•]\s+/, "• "); }
      else { div.className = "ds-msg-line"; appendInlineMarkdown(div, line); }
      container.appendChild(div);
    }
  }

  function normalizeAnswerText(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/기준\s*\/\s*근거/g, "기준 및 근거").replace(/\n{3,}/g, "\n\n").trim();
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

  function getLocalHistoryKey() {
    const userKey = currentEmpNo || currentLoginId || "anonymous";
    return LOCAL_HISTORY_PREFIX + String(userKey).replace(/[^a-zA-Z0-9_.:-]/g, "_");
  }
  function getRecentHistory() {
    try { const raw = sessionStorage.getItem(getLocalHistoryKey()); const data = raw ? JSON.parse(raw) : []; return Array.isArray(data) ? data.slice(-MAX_HISTORY) : []; } catch { return []; }
  }
  function saveLocalHistory(userText, assistantText) {
    try {
      const history = getRecentHistory();
      history.push({ role: "user", text: userText });
      if (assistantText) history.push({ role: "assistant", text: assistantText });
      sessionStorage.setItem(getLocalHistoryKey(), JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch {}
  }
  function restoreLocalHistory() {
    const history = getRecentHistory();
    if (!history.length) return;
    setMode("doc");
    history.forEach((message) => addMessage(message.role === "user" ? "user" : "bot", message.text || ""));
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
