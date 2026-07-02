// DS Chatbot Frontend - 운영 분리 구조용 app.js / PPTX 생성 제거, 슬라이드 구성안 전용
// GitHub Pages: https://dsdansuk.github.io/DS-chatbot/
// Edge Functions:
// - sso-login: 그룹웨어 SSO 진입 및 토큰 발급
// - ai-api: 사내 지식 문의 / SideTalk 지식베이스 호출
// - agent-api: 업무 AI Agent / SideTalk 일반 생성 호출
// - file-api: 첨부 파일 본문 추출 및 Vertex/Gemini 기반 파일 분석
// - rpa-api: UiPath RPA 호출

const DS_ONE_CONFIG = window.DS_ONE_CONFIG || {};
const DS_ENDPOINTS = DS_ONE_CONFIG.endpoints || {};
const DS_TASKS = DS_ONE_CONFIG.tasks || {};
const DS_STORAGE = DS_ONE_CONFIG.storage || {};
const DS_UI = DS_ONE_CONFIG.ui || {};
const DS_FILE_POLICY = DS_ONE_CONFIG.filePolicy || {};

const AI_API_URL = DS_ENDPOINTS.aiApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/ai-api";
const AGENT_API_URL = DS_ENDPOINTS.agentApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/agent-api";
const FILE_API_URL = DS_ENDPOINTS.fileApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/file-api";
const RPA_API_URL = DS_ENDPOINTS.rpaApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/rpa-api";

// agent-api 안에서 세션/메시지/파일 상태도 함께 관리합니다.
const AGENT_STATE_API_URL = AGENT_API_URL;

// PPT 요청은 PPTX/Skywork 생성 경로 없이 agent-api 일반 문서 작성 경로에서 슬라이드 구성안 텍스트로만 처리합니다.
const PPT_DRAFT_TASK = DS_TASKS.pptDraft || "ppt_draft";
const EXCEL_DRAFT_TASK = DS_TASKS.excelDraft || "excel_draft";
const WEB_SEARCH_TASK = DS_TASKS.webSearch || "web_search";

const CHAT_HISTORY_TTL_MS = Number(DS_STORAGE.chatHistoryTtlMs || 60 * 60 * 1000);
const CHAT_HISTORY_STORAGE_PREFIX = DS_STORAGE.chatHistoryPrefix || "ds_chatbot_ai_history_v1_";
const AUTH_CACHE_STORAGE_PREFIX = DS_STORAGE.authCachePrefix || "ds_chatbot_auth_cache_v1_";
const AUTH_CACHE_TTL_MS = Number(DS_STORAGE.authCacheTtlMs || 10 * 60 * 1000);
const DISPLAY_NAME_CACHE_KEY = DS_STORAGE.displayNameCacheKey || "ds_chatbot_last_display_name_v1";
const DISPLAY_NAME_CACHE_TTL_MS = Number(DS_STORAGE.displayNameCacheTtlMs || 7 * 24 * 60 * 60 * 1000);
const AGENT_HISTORY_CACHE_PREFIX = DS_STORAGE.agentHistoryCachePrefix || "ds_one_agent_history_v1_";
const AGENT_HISTORY_CACHE_TTL_MS = Number(DS_STORAGE.agentHistoryCacheTtlMs || 60 * 60 * 1000);
const AGENT_HISTORY_CACHE_MAX_MESSAGES = Number(DS_STORAGE.agentHistoryCacheMaxMessages || 20);
const DEFAULT_HOME_GREETING = DS_UI.defaultHomeGreeting || "필요한 업무를 선택해 주세요";

const RPA_STATUS_POLL_INTERVAL_MS = Number(DS_UI.rpaStatusPollIntervalMs || 30 * 1000);
const RPA_STATUS_POLL_MAX_MS = Number(DS_UI.rpaStatusPollMaxMs || 10 * 60 * 1000);
const AGENT_ALLOWED_FILE_EXTENSIONS = (DS_FILE_POLICY.allowedExtensions || ["txt", "md", "csv", "json", "docx", "xlsx", "pptx"])
  .map((item) => String(item || "").toLowerCase().replace(/^\./, ""))
  .filter(Boolean);
const AGENT_BLOCKED_FILE_EXTENSIONS = new Set((DS_FILE_POLICY.blockedExtensions || ["exe", "dll", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "mjs", "jar", "sh", "php", "asp", "aspx", "jsp", "html", "htm", "xml", "doc", "xls", "ppt", "docm", "xlsm", "pptm", "hwp", "hwpx", "zip", "7z", "rar", "tar", "gz", "png", "jpg", "jpeg", "webp"])
  .map((item) => String(item || "").toLowerCase().replace(/^\./, ""))
  .filter(Boolean));
const AGENT_MAX_FILE_SIZE_BYTES = Number(DS_FILE_POLICY.maxFileSizeBytes || 15 * 1024 * 1024);

let sessionToken = sessionStorage.getItem("sso_session_token") || "";
let currentMode = "home";
let thinkingTimer = null;
let rpaLoaded = false;
let selectedRpaItem = null;
let selectedRpaButton = null;
let runningRpaJobs = [];
let rpaStatusPollTimer = null;
let rpaStatusPollStartedAt = 0;
let currentLoginId = "";
let currentEmpNo = "";

const aiBtn = document.getElementById("aiBtn");
const rpaBtn = document.getElementById("rpaBtn");
const homePanel = document.getElementById("homePanel");
const aiPanel = document.getElementById("aiPanel");
const rpaPanel = document.getElementById("rpaPanel");
const docPanel = document.getElementById("docPanel");
const aiBody = document.getElementById("aiBody");
const agentBody = document.getElementById("agentBody");
const rpaBody = document.getElementById("rpaBody");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const agentForm = document.getElementById("agentForm");
const agentMessageInput = document.getElementById("agentMessageInput");
const agentSendBtn = document.getElementById("agentSendBtn");
const agentAttachBtn = document.getElementById("agentAttachBtn");
const agentFileInput = document.getElementById("agentFileInput");
const agentFileChips = document.getElementById("agentFileChips");
const agentNewChatBtn = document.getElementById("agentNewChatBtn");
const reloadRpaBtn = document.getElementById("reloadRpaBtn");
const userInfo = document.getElementById("userInfo");
const homeGreetingText = document.getElementById("homeGreetingText");
const directQuestionBtn = document.getElementById("directQuestionBtn");
const docWriteBtn = document.getElementById("docWriteBtn");
const rpaEntryBtn = document.getElementById("rpaEntryBtn");
const aiBackBtn = document.getElementById("aiBackBtn");
const rpaBackBtn = document.getElementById("rpaBackBtn");
const docBackBtn = document.getElementById("docBackBtn");

let agentSelectedFiles = [];
let agentSessionId = sessionStorage.getItem("ds_agent_session_id") || "";
let agentStateReady = false;
let agentStateLoading = false;
let lastAgentRoute = "";
let lastAgentFileUseAt = 0;
let agentSubmitInProgress = false;
let agentConversationRenderedFromCache = false;
let agentCacheSaveTimer = null;

function isDocModeActive() {
  return currentMode === "doc" || Boolean(docPanel?.classList.contains("active"));
}

function hasAgentVisibleConversation() {
  if (!agentBody) return false;
  return Boolean(agentBody.querySelector(".chat-row .msg.user, .chat-row .msg.bot, .msg.user, .msg.bot"));
}

function createAgentWelcomeCard() {
  const card = document.createElement("section");
  card.className = "chat-welcome-card agent-welcome-card";
  card.setAttribute("aria-label", "업무 AI 안내");
  card.innerHTML = `
    <div class="welcome-avatar" aria-hidden="true">
      <img src="./robot.png" alt="" />
    </div>
    <div class="welcome-copy">
      <strong>무엇이든 업무 형태로 정리해 드립니다.</strong>
      <p>메일, 보고, 회의록, 검토, 체크리스트를 바로 요청해 보세요.</p>
    </div>
    <div class="agent-suggestion-area" aria-label="업무 AI 추천 요청">
      <span class="agent-suggestion-title">추천 업무</span>
      <div class="agent-suggestion-grid">
        ${buildAgentSuggestionButtonsHtml()}
      </div>
    </div>
  `;
  return card;
}

function ensureAgentWelcomeCard() {
  if (!agentBody) return null;

  let card = agentBody.querySelector(".chat-welcome-card");
  if (!card) {
    card = createAgentWelcomeCard();
  }

  if (agentBody.firstElementChild !== card) {
    agentBody.prepend(card);
  }

  return card;
}

function resetAgentMessagesKeepingWelcome() {
  if (!agentBody) return;

  const card = ensureAgentWelcomeCard();
  Array.from(agentBody.children).forEach((child) => {
    if (child !== card) child.remove();
  });

  if (card && agentBody.firstElementChild !== card) {
    agentBody.prepend(card);
  }
}

function updateAgentNewChatButtonVisibility() {
  if (!agentNewChatBtn) return;

  const hasConversation = hasAgentVisibleConversation();
  agentNewChatBtn.hidden = !hasConversation;
  agentNewChatBtn.disabled = !hasConversation || agentStateLoading || agentSubmitInProgress;
}

function clearAgentConversationCache() {
  const key = getAgentHistoryCacheKey();
  if (!key) return;
  try {
    sessionStorage.removeItem(key);
  } catch {
  }
}

async function startNewAgentConversation() {
  if (!agentBody || agentStateLoading || agentSubmitInProgress) return;

  if (agentSelectedFiles.length) {
    const ok = window.confirm("첨부한 파일이 사라집니다. 새 대화를 시작할까요?");
    if (!ok) {
      focusInputWhenPanelReady(agentMessageInput);
      return;
    }
  }

  const previousLabel = agentNewChatBtn?.textContent || "새 대화";
  if (agentNewChatBtn) {
    agentNewChatBtn.disabled = true;
    agentNewChatBtn.textContent = "시작 중";
  }

  try {
    if (sessionToken) {
      const data = await agentStateRequest({ action: "clear_state", sessionId: agentSessionId });
      if (data?.session?.id) {
        agentSessionId = data.session.id;
        sessionStorage.setItem("ds_agent_session_id", agentSessionId);
      } else {
        agentSessionId = "";
        sessionStorage.removeItem("ds_agent_session_id");
      }
    } else {
      agentSessionId = "";
      sessionStorage.removeItem("ds_agent_session_id");
    }

    agentStateReady = true;
    agentStateLoading = false;
    agentConversationRenderedFromCache = false;
    clearAgentConversationCache();
    clearAgentFiles();
    clearAgentComposerInput();
    resetAgentMessagesKeepingWelcome();
    clearAgentConversationCache();
    if (agentBody) agentBody.scrollTop = 0;
    focusInputWhenPanelReady(agentMessageInput);
  } catch (err) {
    addMessage(agentBody, "bot", "새 대화를 시작하지 못했습니다.\n" + getErrorMessage(err), true);
  } finally {
    if (agentNewChatBtn) {
      agentNewChatBtn.textContent = previousLabel;
    }
    updateAgentNewChatButtonVisibility();
  }
}

function getAgentHistoryCacheKey() {
  const userKey = currentEmpNo || currentLoginId || agentSessionId || getSessionTokenCachePart();
  if (!userKey) return "";
  return AGENT_HISTORY_CACHE_PREFIX + String(userKey).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function getSessionTokenCachePart() {
  if (!sessionToken) return "";
  const parts = sessionToken.split(".");
  return String(parts[1] || parts[0] || sessionToken).slice(0, 24);
}

function getAgentConversationMessages(maxMessages = AGENT_HISTORY_CACHE_MAX_MESSAGES) {
  if (!agentBody) return [];

  return Array.from(agentBody.querySelectorAll(".chat-row .msg"))
    .filter((el) => !el.classList.contains("debug"))
    .map((el) => {
      const role = el.classList.contains("user") ? "user" : "assistant";
      const text = String(el.textContent || "").trim();
      return { role, text };
    })
    .filter((msg) => msg.text)
    .slice(-maxMessages);
}

function saveAgentConversationCacheNow() {
  const key = getAgentHistoryCacheKey();
  if (!key) return;

  const messages = getAgentConversationMessages();

  try {
    if (!messages.length) {
      sessionStorage.removeItem(key);
      return;
    }

    sessionStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        sessionId: agentSessionId || "",
        messages,
      })
    );
  } catch {
  }
}

function saveAgentConversationCacheDebounced() {
  window.clearTimeout(agentCacheSaveTimer);
  agentCacheSaveTimer = window.setTimeout(saveAgentConversationCacheNow, 120);
}

function restoreAgentConversationFromCache() {
  if (!agentBody || hasAgentVisibleConversation()) return false;

  const key = getAgentHistoryCacheKey();
  if (!key) return false;

  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return false;

    const payload = JSON.parse(raw);
    const savedAt = Number(payload.savedAt || 0);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    if (!savedAt || Date.now() - savedAt > AGENT_HISTORY_CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return false;
    }

    if (!messages.length) return false;

    resetAgentMessagesKeepingWelcome();

    messages.forEach((msg) => {
      const role = msg.role === "user" ? "user" : "bot";
      addMessage(agentBody, role, String(msg.text || ""), false, {
        skipAgentSave: true,
        skipAgentCache: true,
      });
    });

    agentConversationRenderedFromCache = true;
    agentBody.scrollTop = agentBody.scrollHeight;
    updateAgentNewChatButtonVisibility();
    return true;
  } catch {
    sessionStorage.removeItem(key);
    return false;
  }
}

// PPTX/Skywork 생성 잠금·폴링 기능은 제거했습니다.
// 아래 상수는 기존 조건문 호환용이며 항상 false입니다.
const isAgentPptGenerating = false;
const AGENT_DEFAULT_PLACEHOLDER = agentMessageInput?.getAttribute("placeholder") || "메일 초안, 보고용 요약, 회의록 정리 등 필요한 업무를 입력해 주세요";
const AGENT_SUGGESTIONS = [
  {
    id: "email_draft",
    label: "메일 다듬기",
    hint: "정중한 업무 메일",
    template: "아래 내용을 정중하고 자연스러운 업무 메일로 다듬어 주세요.\n\n[내용]\n",
  },
  {
    id: "report_summary",
    label: "보고용 요약",
    hint: "핵심·리스크·다음 조치",
    template: "아래 내용을 팀장/임원 보고용으로 정리해 주세요.\n형식은 핵심 요약, 주요 내용, 리스크/이슈, 확인 필요, 다음 조치로 작성해 주세요.\n\n[내용]\n",
  },
  {
    id: "meeting_minutes",
    label: "회의록 정리",
    hint: "결정사항·할 일 추출",
    template: "아래 회의 내용을 회의록으로 정리해 주세요.\n회의 요약, 결정사항, 담당자별 할 일, 미확정 사항, 후속 일정으로 구분해 주세요.\n\n[회의 내용]\n",
  },
  {
    id: "document_review",
    label: "문서 검토",
    hint: "문제점·보완점 확인",
    template: "아래 내용을 검토해서 문제될 수 있는 부분, 누락된 부분, 보완 제안을 정리해 주세요.\n\n[내용]\n",
  },
  {
    id: "checklist",
    label: "체크리스트",
    hint: "실행 전 점검표",
    template: "아래 업무를 진행하기 위한 체크리스트를 만들어 주세요.\n목적, 점검 항목, 주의사항, 완료 기준으로 정리해 주세요.\n\n[업무 내용]\n",
  },
  {
    id: "rewrite",
    label: "문장 교정",
    hint: "더 자연스럽게",
    template: "아래 문장을 더 자연스럽고 업무에 적합한 표현으로 다듬어 주세요.\n\n[문장]\n",
  },
];


function buildAgentSuggestionButtonsHtml() {
  return AGENT_SUGGESTIONS.map((item) => `
    <button class="agent-suggestion-btn" type="button" data-template="${escapeHtml(item.template)}" data-task="${escapeHtml(item.id)}">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(item.hint)}</span>
    </button>
  `).join("");
}

function applyAgentSuggestionTemplate(template = "") {
  if (!agentMessageInput) return;
  const current = agentMessageInput.value.trim();
  const next = String(template || "").trimEnd();
  agentMessageInput.value = current ? `${current}\n\n${next}` : next;
  autoResizeTextarea(agentMessageInput);
  focusInputWhenPanelReady(agentMessageInput);
  const marker = "[내용]";
  const markerIndex = agentMessageInput.value.indexOf(marker);
  if (markerIndex >= 0 && typeof agentMessageInput.setSelectionRange === "function") {
    const start = markerIndex;
    const end = markerIndex + marker.length;
    window.setTimeout(() => agentMessageInput.setSelectionRange(start, end), 0);
  }
}

function syncAgentPptGeneratingControls() {
  if (agentMessageInput) {
    agentMessageInput.disabled = false;
    agentMessageInput.placeholder = AGENT_DEFAULT_PLACEHOLDER;
  }
  if (agentSendBtn) agentSendBtn.disabled = false;
  if (agentAttachBtn) agentAttachBtn.disabled = false;
  if (agentFileInput) agentFileInput.disabled = false;
}

function getAuthCacheKey() {
  if (!sessionToken) return "";
  const parts = sessionToken.split(".");
  const signaturePart = parts[1] || sessionToken;
  return AUTH_CACHE_STORAGE_PREFIX + signaturePart.slice(0, 24);
}

function getCachedAuth() {
  const key = getAuthCacheKey();
  if (!key) return null;

  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const cached = JSON.parse(raw);
    const savedAt = Number(cached.savedAt || 0);

    if (!savedAt || Date.now() - savedAt > AUTH_CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }

    return cached;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

function setCachedAuth(profile) {
  const key = getAuthCacheKey();
  if (!key || !profile) return;

  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        empNo: profile.empNo || "",
        loginId: profile.loginId || "",
        userName: getDisplayUserName(profile),
        defaultProvider: profile.defaultProvider || "",
      })
    );
  } catch (err) {
  }
}

function clearCachedAuth() {
  const key = getAuthCacheKey();
  if (key) sessionStorage.removeItem(key);
}

function getCachedDisplayName() {
  try {
    const raw = localStorage.getItem(DISPLAY_NAME_CACHE_KEY);
    if (!raw) return "";

    const cached = JSON.parse(raw);
    const savedAt = Number(cached.savedAt || 0);
    const name = String(cached.name || "").trim();

    if (!name || !savedAt || Date.now() - savedAt > DISPLAY_NAME_CACHE_TTL_MS) {
      localStorage.removeItem(DISPLAY_NAME_CACHE_KEY);
      return "";
    }

    return name;
  } catch {
    localStorage.removeItem(DISPLAY_NAME_CACHE_KEY);
    return "";
  }
}

function setCachedDisplayName(name) {
  const safeName = String(name || "").trim();
  if (!safeName || safeName === "사용자") return;

  try {
    localStorage.setItem(
      DISPLAY_NAME_CACHE_KEY,
      JSON.stringify({
        name: safeName,
        savedAt: Date.now(),
      })
    );
  } catch (err) {
  }
}

function applyAuthenticatedProfile(profile) {
  currentEmpNo = String(profile.empNo || "");
  currentLoginId = String(profile.loginId || "");
  const displayUserName = getDisplayUserName(profile);

  userInfo.textContent = "로그인ID: " + currentLoginId;
  setCachedDisplayName(displayUserName);
  setHomeGreeting(displayUserName, true);
  restoreChatHistory();
  enableApp();

  // 홈 화면 초기 로딩 속도를 위해 업무 AI Agent 세션 복원은 화면 진입 후 비동기로 수행합니다.
  if (isDocModeActive()) {
    scheduleAgentSessionRestore();
  }
}

function getDisplayUserName(profile) {
  const candidates = [
    profile?.userName,
    profile?.user_name,
    profile?.name,
    profile?.displayName,
    profile?.display_name,
    profile?.empName,
    profile?.empNm,
    profile?.employeeName,
    profile?.korName,
    profile?.koreanName,
  ];

  const found = candidates
    .map((value) => String(value || "").trim())
    .find((value) => value && value !== "undefined" && value !== "null");

  return found || "사용자";
}

function setHomeGreeting(name, isAuthenticated = true) {
  if (!homeGreetingText) return;

  homeGreetingText.classList.remove("is-waiting-auth", "is-auth-ready", "is-auth-pending");

  if (!isAuthenticated) {
    homeGreetingText.textContent = "인증 후 이용 가능합니다";
    homeGreetingText.classList.add("is-auth-ready");
    return;
  }

  const safeName = String(name || "").trim();
  homeGreetingText.textContent = safeName
    ? safeName + "님, 필요한 업무를 선택해 주세요"
    : DEFAULT_HOME_GREETING;
  homeGreetingText.classList.add("is-auth-ready");
}

function showInitialHomeGreeting() {
  const cachedName = getCachedDisplayName();
  setHomeGreeting(cachedName, true);

  if (homeGreetingText && !cachedName) {
    homeGreetingText.classList.add("is-auth-pending");
  }
}

bootstrap();

async function bootstrap() {
  cleanupExpiredChatHistories();
  showInitialHomeGreeting();

  // RPA 목록 새로고침 버튼은 최종 사용자용 UI에서는 숨깁니다.
  if (reloadRpaBtn) {
    reloadRpaBtn.style.display = "none";
    reloadRpaBtn.disabled = true;
  }

  const url = new URL(location.href);
  const tokenFromUrl = url.searchParams.get("token");

  if (tokenFromUrl) {
    sessionToken = tokenFromUrl;
    sessionStorage.setItem("sso_session_token", sessionToken);
    url.searchParams.delete("token");
    history.replaceState({}, "", url.toString());
  }

  if (!sessionToken) {
    userInfo.textContent = "인증 정보가 없습니다. 그룹웨어에서 다시 접속하세요.";
    setHomeGreeting("", false);
    disableApp();
    return;
  }

  const cachedAuth = getCachedAuth();
  if (cachedAuth) {
    applyAuthenticatedProfile(cachedAuth);
    return;
  }

  try {
    const me = await apiJson(AI_API_URL, { method: "GET" });

    if (!me.ok) {
      throw new Error(me.message || "인증 확인 실패");
    }

    setCachedAuth(me);
    applyAuthenticatedProfile(me);
  } catch (err) {
    clearCachedAuth();
    sessionStorage.removeItem("sso_session_token");
    sessionToken = "";
    userInfo.textContent = "인증 실패: " + getErrorMessage(err);
    setHomeGreeting("", false);
    disableApp();
  }
}

function enableApp() {
  if (messageInput) messageInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  syncAgentPptGeneratingControls();

  if (directQuestionBtn) directQuestionBtn.disabled = false;
  if (docWriteBtn) docWriteBtn.disabled = false;
  if (rpaEntryBtn) rpaEntryBtn.disabled = false;
  if (aiBtn) aiBtn.disabled = false;
  if (rpaBtn) rpaBtn.disabled = false;

  if (currentMode === "doc" && !isAgentPptGenerating) focusInputWhenPanelReady(agentMessageInput);
}

function disableApp() {
  if (messageInput) messageInput.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (agentMessageInput) agentMessageInput.disabled = true;
  if (agentSendBtn) agentSendBtn.disabled = true;
  if (agentAttachBtn) agentAttachBtn.disabled = true;
  if (agentFileInput) agentFileInput.disabled = true;
  if (reloadRpaBtn) reloadRpaBtn.disabled = true;

  if (directQuestionBtn) directQuestionBtn.disabled = true;
  if (docWriteBtn) docWriteBtn.disabled = true;
  if (rpaEntryBtn) rpaEntryBtn.disabled = true;
  if (aiBtn) aiBtn.disabled = true;
  if (rpaBtn) rpaBtn.disabled = true;
}

function focusInputWhenPanelReady(input) {
  if (!input || input.disabled) return;

  const focus = () => {
    if (!input.disabled) input.focus();
  };

  requestAnimationFrame(focus);
  setTimeout(focus, 80);
  setTimeout(focus, 180);
}

function setMode(mode) {
  currentMode = mode;

  if (aiBtn) aiBtn.classList.toggle("active", mode === "ai");
  if (rpaBtn) rpaBtn.classList.toggle("active", mode === "rpa");
  if (homePanel) homePanel.classList.toggle("active", mode === "home");
  if (aiPanel) aiPanel.classList.toggle("active", mode === "ai");
  if (docPanel) docPanel.classList.toggle("active", mode === "doc");
  if (rpaPanel) rpaPanel.classList.toggle("active", mode === "rpa");

  if (mode === "rpa" && !rpaLoaded) {
    // RPA 화면 진입 시 1회만 목록 + 상태를 조회합니다.
    loadRpaList();
  }

  if (mode === "ai") {
    focusInputWhenPanelReady(messageInput);
  }

  if (mode === "doc") {
    if (docWriteBtn) docWriteBtn.blur();
    ensureAgentWelcomeCard();
    restoreAgentConversationFromCache();
    syncAgentPptGeneratingControls();
    updateAgentNewChatButtonVisibility();
    if (!isAgentPptGenerating) focusInputWhenPanelReady(agentMessageInput);
    scheduleAgentSessionRestore();
  }
}

function showComingSoonNotice() {
  // 두 번째 버튼은 아직 기능 연동 전이므로 화면 전환 없이 안내만 표시합니다.
  const originalTitle = docWriteBtn?.querySelector("strong")?.textContent || "AI 문서 작성";
  const originalDesc = docWriteBtn?.querySelector("em")?.textContent || "이메일, 결재문, 보고서 작성";
  const title = docWriteBtn?.querySelector("strong");
  const desc = docWriteBtn?.querySelector("em");

  if (!title || !desc) return;

  title.textContent = "AI 문서 작성";
  desc.textContent = "준비 중입니다";

  window.clearTimeout(showComingSoonNotice.timer);
  showComingSoonNotice.timer = window.setTimeout(() => {
    title.textContent = originalTitle;
    desc.textContent = originalDesc;
  }, 1400);
}

function renderMessageContent(div, text) {
  div.textContent = "";
  const lines = String(text || "").split(/\n/);

  lines.forEach((line) => {
    const trimmed = String(line || "").trim();

    if (!trimmed) {
      const spacer = document.createElement("div");
      spacer.className = "msg-block-spacer";
      div.appendChild(spacer);
      return;
    }

    const lineDiv = document.createElement("div");
    const isHeading = /^\*\*[^*]+\*\*$/.test(trimmed);
    const isBullet = /^[-•]\s+/.test(trimmed);
    lineDiv.className = "msg-line" + (isHeading ? " msg-heading" : "") + (isBullet ? " msg-bullet" : "");
    appendInlineMarkdown(lineDiv, trimmed);
    div.appendChild(lineDiv);
  });
}

function appendInlineMarkdown(parent, line) {
  const pattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
    }

    const strong = document.createElement("strong");
    strong.textContent = match[1];
    parent.appendChild(strong);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < line.length) {
    parent.appendChild(document.createTextNode(line.slice(lastIndex)));
  }
}


function appendBotCopyAction(row, messageDiv, text, options = {}) {
  if (!row || !messageDiv || options.hideCopy) return;

  const actions = document.createElement("div");
  actions.className = "bot-message-actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "bot-copy-btn";
  copyBtn.title = "답변 복사";
  copyBtn.setAttribute("aria-label", "답변 복사");
  copyBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 8.5A2.5 2.5 0 0 1 10.5 6H18a2.5 2.5 0 0 1 2.5 2.5V16A2.5 2.5 0 0 1 18 18.5h-7.5A2.5 2.5 0 0 1 8 16V8.5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 15.5H5A2.5 2.5 0 0 1 2.5 13V5.5A2.5 2.5 0 0 1 5 3h7.5A2.5 2.5 0 0 1 15 5.5V6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  copyBtn.addEventListener("click", async () => {
    const value = String(messageDiv.textContent || text || "").trim();
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      copyBtn.classList.add("copied");
      copyBtn.setAttribute("aria-label", "복사 완료");
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.setAttribute("aria-label", "답변 복사");
      }, 1200);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  });

  actions.appendChild(copyBtn);
  row.appendChild(actions);
}

function isKnowledgeRedirectText(text) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return false;

  return (
    value.includes("사내 지식 문의") &&
    (
      value.includes("사내 규정") ||
      value.includes("업무 절차") ||
      value.includes("정확한 답변") ||
      value.includes("확인해") ||
      value.includes("확인해 주세요")
    )
  );
}

function removeBotCopyAction(row) {
  if (!row) return;
  row.querySelectorAll(".bot-message-actions").forEach((el) => el.remove());
}

function appendKnowledgeRedirectButton(row, originalMessage = "") {
  if (!row || row.querySelector(".knowledge-redirect-actions")) return;

  removeBotCopyAction(row);

  const actions = document.createElement("div");
  actions.className = "knowledge-redirect-actions";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "knowledge-redirect-btn";
  btn.textContent = "사내 지식 문의로 이동";
  btn.addEventListener("click", () => {
    setMode("ai");
    if (messageInput) {
      messageInput.value = originalMessage || "";
      autoResizeTextarea(messageInput);
      focusInputWhenPanelReady(messageInput);
    }
  });

  actions.appendChild(btn);
  row.appendChild(actions);
}

function applyKnowledgeRedirectAction(messageDiv, originalMessage = "") {
  const row = messageDiv?.closest ? messageDiv.closest(".chat-row") : null;
  if (!row) return;
  appendKnowledgeRedirectButton(row, originalMessage);
}

function setMessageContent(div, text) {
  if (!div) return;
  renderMessageContent(div, text);

  if (agentBody && div.closest && div.closest("#agentBody")) {
    saveAgentConversationCacheDebounced();
  }
}

function addMessage(targetBody, type, text, debug = false, options = {}) {
  const div = document.createElement("div");
  div.className = debug ? "msg bot debug" : "msg " + type;

  if (!debug && type === "bot") {
    renderMessageContent(div, text);
  } else {
    div.textContent = text;
  }

  if ((targetBody === aiBody || targetBody === agentBody) && !debug) {
    const row = document.createElement("div");
    row.className = type === "user" ? "chat-row user-row" : "chat-row bot-row";

    if (type !== "user") {
      const avatar = document.createElement("span");
      avatar.className = "chat-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.innerHTML = '<img src="./robot.png" alt="" />';
      row.appendChild(avatar);
    }

    row.appendChild(div);
    if (type === "bot") appendBotCopyAction(row, div, text, options);
    targetBody.appendChild(row);
  } else {
    targetBody.appendChild(div);
  }

  targetBody.scrollTop = targetBody.scrollHeight;

  if (targetBody === aiBody && !debug && !options.skipSave) {
    saveChatHistory();
  }

  if (targetBody === agentBody && !debug && !options.skipAgentCache) {
    agentConversationRenderedFromCache = false;
    saveAgentConversationCacheDebounced();
    updateAgentNewChatButtonVisibility();
  }

  return div;
}


function appendExcelDownloadButton(targetBody, excel) {
  appendArtifactDownloadButton(targetBody, excel, { label: "엑셀 다운로드", className: "excel-download-row" });
}

function isArtifactLinkExpired(artifact, messageCreatedAt) {
  if (!artifact || artifact.ok !== true || !artifact.downloadUrl) return true;

  const expiresInMs = Number(artifact.expiresIn || 0) * 1000;
  if (!expiresInMs) return false;

  const createdAtMs = Date.parse(artifact.createdAt || artifact.created_at || messageCreatedAt || "");
  if (!createdAtMs) return false;

  // 새로고침 직후 링크가 사라지지 않도록 10초의 안전 여유를 둡니다.
  return Date.now() - createdAtMs > Math.max(0, expiresInMs - 10 * 1000);
}

function appendSavedArtifactDownloads(targetBody, metadata = {}, messageCreatedAt = "") {
  if (!targetBody || !metadata) return;

  const excel = metadata.excel || null;

  if (excel?.ok && excel.downloadUrl && !isArtifactLinkExpired(excel, messageCreatedAt)) {
    appendExcelDownloadButton(targetBody, excel);
  }
}

function isArtifactMessageMetadata(metadata = {}) {
  return Boolean(metadata?.artifact || metadata?.excel?.ok);
}

function appendArtifactDownloadButton(targetBody, artifact, options = {}) {
  if (!artifact || artifact.ok !== true || !artifact.downloadUrl) return;

  const row = document.createElement("div");
  row.className = "chat-row bot-row ppt-download-row " + (options.className || "");

  const spacer = document.createElement("span");
  spacer.className = "ppt-download-spacer";
  spacer.setAttribute("aria-hidden", "true");

  const wrap = document.createElement("div");
  wrap.className = "ppt-download-wrap";

  const link = document.createElement("a");
  link.className = "ppt-download-btn";
  link.href = artifact.downloadUrl;
  if (String(artifact.downloadUrl || "").startsWith("blob:")) {
    link.download = artifact.fileName || artifact.filename || "download.xlsx";
  } else {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  link.textContent = options.label || "다운로드";

  const meta = document.createElement("span");
  meta.className = "ppt-download-meta";
  meta.textContent = formatPptExpiresText(artifact.expiresIn);

  wrap.appendChild(link);
  wrap.appendChild(meta);
  row.appendChild(spacer);
  row.appendChild(wrap);
  targetBody.appendChild(row);
  targetBody.scrollTop = targetBody.scrollHeight;
}

function appendEvidenceBox(targetBody, data) {
  if (!targetBody || !data) return;

  const parts = [];
  if (Array.isArray(data.files) && data.files.length) {
    const names = data.files.map((file) => file.original_name || file.name).filter(Boolean).slice(0, 3);
    parts.push("근거: 업로드 파일 " + data.files.length + "개" + (names.length ? " · " + names.join(", ") : ""));
  }
  if (data.task === WEB_SEARCH_TASK || data.grounding) {
    parts.push("근거: 웹 검색/최신 정보 라우팅");
  }
  if (!parts.length) return;

  const row = document.createElement("div");
  row.className = "chat-row bot-row evidence-row";
  const spacer = document.createElement("span");
  spacer.className = "ppt-download-spacer";
  spacer.setAttribute("aria-hidden", "true");
  const box = document.createElement("div");
  box.className = "evidence-box";
  box.textContent = parts.join(" / ");
  row.appendChild(spacer);
  row.appendChild(box);
  targetBody.appendChild(row);
  targetBody.scrollTop = targetBody.scrollHeight;
}

function formatPptExpiresText(expiresIn) {
  const seconds = Number(expiresIn || 0);
  if (!seconds) return "임시 링크";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours}시간 유효`;
  }
  return `${minutes}분 유효`;
}

function clearBody(targetBody) {
  targetBody.innerHTML = "";

  if (targetBody === aiBody) {
    saveChatHistory();
  }
}

function createThinkingBox(targetBody = aiBody, customSteps = null) {
  const steps = Array.isArray(customSteps) && customSteps.length
    ? customSteps
    : [
      "질문을 이해하는 중",
      "관련 내용을 확인하는 중",
      "답변을 정리하는 중",
      "곧 답변드릴게요",
    ];

  const wrap = document.createElement("div");
  wrap.className = "thinking";

  const title = document.createElement("div");
  title.className = "thinking-title";
  title.textContent = "처리 중";

  const list = document.createElement("ul");
  list.className = "thinking-list";

  steps.forEach((step, index) => {
    const li = document.createElement("li");
    li.dataset.index = String(index);
    if (index === 0) li.className = "active";
    li.innerHTML = '<span class="dot"></span><span>' + escapeHtml(step) + "</span>";
    list.appendChild(li);
  });

  wrap.appendChild(title);
  wrap.appendChild(list);
  targetBody.appendChild(wrap);
  targetBody.scrollTop = targetBody.scrollHeight;

  let current = 0;
  thinkingTimer = setInterval(() => {
    const items = Array.from(list.querySelectorAll("li"));
    items.forEach((li, idx) => {
      li.classList.toggle("done", idx < current);
      li.classList.toggle("active", idx === current);
    });

    current = Math.min(current + 1, steps.length - 1);
    targetBody.scrollTop = targetBody.scrollHeight;
  }, 900);

  return wrap;
}

function removeThinkingBox(box) {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }

  if (box) {
    box.remove();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getErrorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err || "알 수 없는 오류");
}

function parseMaybeJsonText(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback || "";

  const looksJson =
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"));

  if (!looksJson) return text;

  try {
    const parsed = JSON.parse(text);
    return getApiAnswerText(parsed, fallback || text);
  } catch {
    return text;
  }
}

function parseStreamPayloadText(data) {
  if (typeof data === "string") return parseMaybeJsonText(data, data);
  if (!data || typeof data !== "object") return "";

  const candidates = [
    data.chunk,
    data.answer,
    data.message?.content,
    data.delta?.content,
    data.choices?.[0]?.delta?.content,
    data.choices?.[0]?.message?.content,
    data.content,
    data.text,
    data.message,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const text = parseMaybeJsonText(candidate, "");
    if (text) return text;
  }

  return "";
}

function parseStreamText(text) {
  if (!text) return "";

  if (!text.includes("data:")) {
    return parseMaybeJsonText(text, text);
  }

  let output = "";
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const data = JSON.parse(payload);
      output += parseStreamPayloadText(data);
    } catch {
      output += parseMaybeJsonText(payload, payload);
    }
  }

  return output;
}

async function readResponseData(res) {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (contentType.includes("application/json")) {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, message: text || "JSON 응답 파싱 실패" };
    }
  }

  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // plain text response
  }

  return { ok: res.ok, answer: text || "" };
}

function getApiAnswerText(data, fallback = "") {
  if (typeof data === "string") {
    return parseMaybeJsonText(data, fallback) || fallback || "";
  }

  if (!data || typeof data !== "object") return fallback || "";

  const candidates = [
    data.answer,
    data.message?.content,
    data.choices?.[0]?.message?.content,
    data.choices?.[0]?.delta?.content,
    data.content,
    data.text,
    data.message,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const text = parseMaybeJsonText(candidate, "");
    if (text) return text;
  }

  return fallback || "답변을 생성하지 못했습니다.";
}


function buildUserFriendlyFileErrorMessage(rawMessage = "") {
  const text = String(rawMessage || "").trim();
  const normalized = text.replace(/\s+/g, " ");

  if (/운영 보안 정책상 업로드할 수 없습니다|운영 보안 정책에 따라 파일 분석을 중단|차단 사유|차단|보안 정책/.test(normalized)) {
    return [
      "파일 보안 정책에 따라 해당 파일은 분석할 수 없습니다.",
      "주민등록번호·외국인등록번호·계좌·카드·급여·인사평가·대외비·기밀정보 또는 실행성 파일이 포함되어 있지 않은지 확인한 뒤 다시 업로드해 주세요.",
    ].join("\n");
  }

  if (/PDF|pdf/.test(normalized) && (/FILE_INLINE_AI_ENABLED|Vertex|본문을 추출|안전하게 본문|현재 설정/.test(normalized))) {
    return [
      "현재 이 PDF 파일은 바로 분석할 수 없습니다.",
      "PDF 본문을 안정적으로 읽을 수 없는 상태라 분석을 중단했습니다.",
      "",
      "가능한 방법",
      "- PDF 내용을 복사해 입력창에 붙여넣어 주세요.",
      "- PDF를 Word(.docx), Excel(.xlsx), 텍스트(.txt) 파일로 변환해 업로드해 주세요.",
      "- PDF 파일 분석이 꼭 필요하면 IT팀에 기능 설정을 요청해 주세요.",
    ].join("\n");
  }

  if (/(?:이미지 파일|image\/|png 파일|jpg 파일|jpeg 파일|webp 파일|\.png|\.jpg|\.jpeg|\.webp)/i.test(normalized) && /업로드|분석|정책|설정|지원/.test(normalized)) {
    return [
      "현재 이미지 파일은 바로 분석할 수 없습니다.",
      "이미지 안의 내용을 텍스트로 입력하거나, 문서 파일로 변환해 업로드해 주세요.",
    ].join("\n");
  }

  if (/허용 목록|파일 형식/.test(normalized)) {
    return [
      "현재 지원하지 않는 파일 형식입니다.",
      "Word(.docx), Excel(.xlsx), PowerPoint(.pptx), 텍스트(.txt), CSV(.csv) 형식으로 변환해 업로드해 주세요.",
    ].join("\n");
  }

  if (/분석할 파일을 첨부/.test(normalized)) {
    return "분석할 파일을 첨부해 주세요.";
  }

  if (/FILE_INLINE|Vertex|Gemini|GOOGLE_|SIDETALK_|OPENAI_|HTTP\s*5\d{2}|환경변수|토큰|service_role/i.test(normalized)) {
    return [
      "일시적으로 파일 분석을 처리하지 못했습니다.",
      "잠시 후 다시 시도해 주세요. 같은 문제가 반복되면 IT팀에 문의해 주세요.",
    ].join("\n");
  }

  return text || "파일 분석을 진행하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function getFileIdsFromResponses(files = []) {
  return (Array.isArray(files) ? files : [])
    .map((file) => String(file?.id || file?.fileId || ""))
    .filter(Boolean);
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + sessionToken,
      ...(options.headers || {}),
    },
  });

  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      ok: false,
      message: text || "JSON 파싱 실패",
    };
  }

  if (!res.ok) {
    throw new Error(data.message || data.raw || "HTTP " + res.status);
  }

  return data;
}

function getChatHistoryKey() {
  const userKey = currentLoginId || currentEmpNo || "unknown";
  return CHAT_HISTORY_STORAGE_PREFIX + userKey;
}

function getAllAiMessages() {
  return Array.from(aiBody.querySelectorAll(".msg"))
    .filter((el) => !el.classList.contains("debug"))
    .map((el) => {
      const role = el.classList.contains("user") ? "user" : "bot";
      return {
        role,
        text: el.textContent || "",
      };
    })
    .filter((msg) => msg.text.trim());
}

function getRecentChatMessages(targetBody, maxMessages = 10, maxChars = 6000) {
  if (!targetBody) return [];

  const messages = Array.from(targetBody.querySelectorAll(".msg"))
    .filter((el) => !el.classList.contains("debug"))
    .map((el) => {
      const role = el.classList.contains("user") ? "user" : "assistant";
      const text = String(el.textContent || "").trim();
      return { role, text };
    })
    .filter((msg) => msg.text);

  const recent = messages.slice(-maxMessages);
  let total = 0;
  const selected = [];

  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const item = recent[i];
    const remaining = maxChars - total;
    if (remaining <= 0) break;

    const text = item.text.slice(0, remaining);
    selected.unshift({ role: item.role, text });
    total += text.length;
  }

  return selected;
}

function saveChatHistory() {
  if (!currentLoginId && !currentEmpNo) return;

  const messages = getAllAiMessages();
  const key = getChatHistoryKey();

  try {
    if (!messages.length) {
      sessionStorage.removeItem(key);
      return;
    }

    sessionStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        messages,
      })
    );
  } catch (err) {
  }
}

function restoreChatHistory() {
  if (!currentLoginId && !currentEmpNo) return;

  const key = getChatHistoryKey();
  const raw = sessionStorage.getItem(key);

  if (!raw) return;

  try {
    const payload = JSON.parse(raw);
    const savedAt = Number(payload.savedAt || 0);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    if (!savedAt || Date.now() - savedAt > CHAT_HISTORY_TTL_MS) {
      sessionStorage.removeItem(key);
      return;
    }

    if (!messages.length) return;

    aiBody.innerHTML = "";

    messages.forEach((msg) => {
      const role = msg.role === "user" ? "user" : "bot";
      addMessage(aiBody, role, String(msg.text || ""), false, { skipSave: true });
    });

    aiBody.scrollTop = aiBody.scrollHeight;
  } catch (err) {
    sessionStorage.removeItem(key);
  }
}

function cleanupExpiredChatHistories() {
  const now = Date.now();
  cleanupChatHistoryStorage(sessionStorage, now, false);
  // 이전 버전은 사내 지식 문의 대화를 localStorage에 저장했습니다.
  // 운영 보안 기준에 맞춰 남아 있는 과거 캐시를 복원하지 않고 정리합니다.
  cleanupChatHistoryStorage(localStorage, now, true);
}

function cleanupChatHistoryStorage(storage, now, removeAll = false) {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);

      if (!key || !key.startsWith(CHAT_HISTORY_STORAGE_PREFIX)) continue;

      if (removeAll) {
        storage.removeItem(key);
        continue;
      }

      try {
        const payload = JSON.parse(storage.getItem(key) || "{}");
        const savedAt = Number(payload.savedAt || 0);

        if (!savedAt || now - savedAt > CHAT_HISTORY_TTL_MS) {
          storage.removeItem(key);
        }
      } catch {
        storage.removeItem(key);
      }
    }
  } catch {
  }
}

async function loadRpaList() {
  clearBody(rpaBody);
  selectedRpaItem = null;
  selectedRpaButton = null;

  addMessage(rpaBody, "bot", "RPA 목록을 불러오는 중입니다.");

  try {
    const data = await apiJson(RPA_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "list" }),
    });

    if (!data.ok) {
      addMessage(
        rpaBody,
        "bot",
        "RPA 목록 조회 실패\n" + (data.raw || data.message || JSON.stringify(data, null, 2)),
        true
      );
      return;
    }

    updateRunningRpaJobsFromApi(data.jobs);

    if (!data.releases || data.releases.length === 0) {
      clearBody(rpaBody);
      renderRunningRpaNotice();
      addMessage(
        rpaBody,
        "bot",
        "사용 가능한 RPA 업무가 없습니다.\n관리자에게 권한을 요청하세요."
      );
      syncRpaPollingByCurrentJobs();
      return;
    }

    renderRpaList(data.releases || []);
    rpaLoaded = true;
    syncRpaPollingByCurrentJobs();
  } catch (err) {
    addMessage(rpaBody, "bot", "RPA 목록 조회 중 오류 발생: " + getErrorMessage(err));
  }
}

async function refreshRpaStatus() {
  if (!sessionToken) return;

  try {
    const data = await apiJson(RPA_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "status" }),
    });

    if (!data.ok) return;

    updateRunningRpaJobsFromApi(data.jobs);
    renderRunningRpaNotice();
    syncRpaPollingByCurrentJobs();
  } catch (err) {
  }
}

function updateRunningRpaJobsFromApi(jobs) {
  if (!Array.isArray(jobs)) return;

  runningRpaJobs = jobs
    .map((job) => ({
      name: job.name || job.Name || "이름 없음",
      status: convertJobState(job.status || job.State || job.state),
      robotName: job.robotName || job.RobotName || job.robot_name || "",
      startedAt: job.startedAt || job.StartTime || job.createdAt || job.CreationTime || "",
    }))
    .filter((job) => {
      return job.status === "대기 중" || job.status === "실행 중" || job.status === "실행 요청 중";
    });
}

function syncRpaPollingByCurrentJobs() {
  if (runningRpaJobs.length > 0) {
    startRpaStatusPolling();
  } else {
    stopRpaStatusPolling();
  }
}

function startRpaStatusPolling() {
  if (rpaStatusPollTimer) return;

  rpaStatusPollStartedAt = Date.now();

  rpaStatusPollTimer = setInterval(() => {
    if (Date.now() - rpaStatusPollStartedAt > RPA_STATUS_POLL_MAX_MS) {
      stopRpaStatusPolling();
      return;
    }

    if (!runningRpaJobs.length) {
      stopRpaStatusPolling();
      return;
    }

    refreshRpaStatus();
  }, RPA_STATUS_POLL_INTERVAL_MS);
}

function stopRpaStatusPolling() {
  if (rpaStatusPollTimer) {
    clearInterval(rpaStatusPollTimer);
    rpaStatusPollTimer = null;
  }

  rpaStatusPollStartedAt = 0;
}

function renderRpaList(releases) {
  clearBody(rpaBody);

  if (runningRpaJobs.length) {
    renderRunningRpaNotice();
  }

  addMessage(rpaBody, "bot", "실행할 RPA 업무를 선택하세요.");

  const wrap = document.createElement("div");
  wrap.className = "rpa-list";

  releases.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rpa-item";

    const name = item.Name || "이름 없음";
    const source = item.source || "";
    const folderId = item.folderId || "";
    const releaseKey = item.Key || "";

    const rpaItem = {
      name,
      releaseKey,
      folderId,
      source,
    };

    btn.innerHTML =
      '<div class="rpa-name">' +
      escapeHtml(name) +
      "</div>";

    btn.addEventListener("click", () => {
      selectRpaJob(rpaItem, btn);
    });

    wrap.appendChild(btn);
  });

  rpaBody.appendChild(wrap);
  rpaBody.scrollTop = rpaBody.scrollHeight;
}

function renderRunningRpaNotice() {
  const oldBox = rpaBody.querySelector(".rpa-running-box");

  if (oldBox) {
    oldBox.remove();
  }

  if (!runningRpaJobs.length) return;

  const div = document.createElement("div");
  div.className = "rpa-running-box";

  let html = '<div class="rpa-state-label">진행 중인 작업</div>';

  runningRpaJobs.forEach((job) => {
    html +=
      '<div class="rpa-running-item">' +
      '<span class="rpa-running-name">' +
      escapeHtml(job.name) +
      "</span>" +
      '<span class="rpa-running-status">' +
      escapeHtml(job.status) +
      (job.robotName ? " · " + escapeHtml(job.robotName) : "") +
      "</span>" +
      "</div>";
  });

  div.innerHTML = html;

  const firstChild = rpaBody.firstElementChild;
  if (firstChild) {
    rpaBody.insertBefore(div, firstChild);
  } else {
    rpaBody.appendChild(div);
  }
}

function selectRpaJob(item, button) {
  clearSelectedRpaInline();

  selectedRpaItem = item;
  selectedRpaButton = button;

  button.classList.add("selected");

  const actionBox = document.createElement("div");
  actionBox.className = "rpa-inline-action";
  actionBox.dataset.role = "rpa-inline-action";
  actionBox.innerHTML =
    '<div class="rpa-inline-title">' + escapeHtml(item.name) + "</div>" +
    '<div class="rpa-inline-buttons">' +
    '<button type="button" class="rpa-execute-btn">실행</button>' +
    '<button type="button" class="rpa-cancel-btn">취소</button>' +
    "</div>";

  const executeBtn = actionBox.querySelector(".rpa-execute-btn");
  const cancelBtn = actionBox.querySelector(".rpa-cancel-btn");

  executeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    runRpaJob(item, executeBtn, cancelBtn);
  });

  cancelBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    clearSelectedRpaInline();
  });

  button.insertAdjacentElement("afterend", actionBox);
  actionBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearSelectedRpaInline() {
  const currentActionBox = rpaBody.querySelector('[data-role="rpa-inline-action"]');
  if (currentActionBox) {
    currentActionBox.remove();
  }

  if (selectedRpaButton) {
    selectedRpaButton.classList.remove("selected");
  }

  selectedRpaItem = null;
  selectedRpaButton = null;
}

function addTemporaryRpaMessage(text, timeoutMs = 8000) {
  const msg = addMessage(rpaBody, "bot", text);

  setTimeout(() => {
    if (msg && msg.parentNode) {
      msg.remove();
    }

    // 안내 메시지가 사라진 뒤 상단 상태창이 보이도록 이동
    rpaBody.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }, timeoutMs);

  return msg;
}

function getRunStateFromResponse(data) {
  const rawText = String(data?.raw || "");

  if (
    rawText.includes('"State":"Pending"') ||
    rawText.includes('"State": "Pending"') ||
    rawText.includes("Pending") ||
    rawText.includes("Queued")
  ) {
    return "queued";
  }

  if (
    rawText.includes('"State":"Running"') ||
    rawText.includes('"State": "Running"') ||
    rawText.includes("Running")
  ) {
    return "running";
  }

  return "running";
}

function setRunningJob(name, status) {
  runningRpaJobs = [
    {
      name,
      status,
    },
  ];

  refreshRunningRpaNotice();
  syncRpaPollingByCurrentJobs();
}

function addOrUpdateRunningJob(name, status) {
  const exists = runningRpaJobs.find((job) => job.name === name);

  if (exists) {
    exists.status = status;
  } else {
    runningRpaJobs.push({ name, status });
  }

  refreshRunningRpaNotice();
  syncRpaPollingByCurrentJobs();
}

async function runRpaJob(item, executeBtn, cancelBtn) {
  if (!item) return;

  const confirmed = window.confirm(item.name + " RPA를 실행하시겠습니까?\n\n실행 후 실제 자동화 작업이 시작됩니다.");
  if (!confirmed) return;

  if (executeBtn) {
    executeBtn.disabled = true;
    executeBtn.textContent = "실행 요청 중";
  }

  if (cancelBtn) {
    cancelBtn.disabled = true;
  }

  setRunningJob(item.name, "실행 요청 중");

  try {
    const data = await apiJson(RPA_API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "run",
        releaseKey: item.releaseKey,
        folderId: item.folderId,
      }),
    });

    if (data.ok) {
      if (Array.isArray(data.jobs)) {
        updateRunningRpaJobsFromApi(data.jobs);
        refreshRunningRpaNotice();
      }

      const currentJob = Array.isArray(data.jobs)
        ? data.jobs.find((job) => {
            const name = job.name || job.Name || "";
            return name === item.name;
          })
        : null;

      if (currentJob) {
        const currentStatus = convertJobState(
          currentJob.status || currentJob.State || currentJob.state
        );

        if (currentStatus === "대기 중") {
          addOrUpdateRunningJob(item.name, "대기 중");
          addTemporaryRpaMessage(
            "다른 작업이 실행 중입니다.\n작업이 대기열에 등록되었습니다.",
            8000
          );
        } else {
          addOrUpdateRunningJob(item.name, "실행 중");
          addTemporaryRpaMessage(item.name + " 실행 요청이 완료되었습니다.", 8000);
        }
      } else {
        runningRpaJobs = [];
        refreshRunningRpaNotice();
        addTemporaryRpaMessage(item.name + " 실행 요청이 완료되었습니다.", 8000);
      }

      clearSelectedRpaInline();
      syncRpaPollingByCurrentJobs();
      return;
    }

    addMessage(
      rpaBody,
      "bot",
      "RPA 실행 실패\n" + (data.message || "실행 요청 처리 중 오류가 발생했습니다.")
    );


    restoreInlineButtons(executeBtn, cancelBtn);
  } catch (err) {
    addMessage(rpaBody, "bot", "RPA 실행 중 오류 발생: " + getErrorMessage(err));
    restoreInlineButtons(executeBtn, cancelBtn);
  }
}

function restoreInlineButtons(executeBtn, cancelBtn) {
  if (executeBtn) {
    executeBtn.disabled = false;
    executeBtn.textContent = "실행";
  }

  if (cancelBtn) {
    cancelBtn.disabled = false;
  }
}

function refreshRunningRpaNotice() {
  renderRunningRpaNotice();
}

function convertJobState(state) {
  const value = String(state || "").toLowerCase();

  if (value === "pending") return "대기 중";
  if (value === "running") return "실행 중";
  if (value === "successful") return "완료";
  if (value === "faulted") return "오류";
  if (value === "stopped") return "중지됨";

  return state || "상태 확인 중";
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "0B";
  if (size < 1024) return size + "B";
  if (size < 1024 * 1024) return Math.round(size / 1024) + "KB";
  return (size / 1024 / 1024).toFixed(1).replace(/\.0$/, "") + "MB";
}

function getAttachmentName(item) {
  return item?.name || item?.file?.name || "uploaded-file";
}

function getAttachmentSize(item) {
  return Number(item?.size ?? item?.file?.size ?? item?.sizeBytes ?? 0);
}

function getAttachmentType(item) {
  return item?.type || item?.mimeType || item?.file?.type || "";
}

function getAttachmentFile(item) {
  return item instanceof File ? item : item?.file || null;
}

function getAttachmentId(item) {
  return String(item?.id || item?.fileId || "");
}

function hasUnuploadedAgentFiles(files = agentSelectedFiles) {
  return files.some((item) => Boolean(getAttachmentFile(item) && !getAttachmentId(item)));
}

function getAgentFileIds(files = agentSelectedFiles) {
  return files.map(getAttachmentId).filter(Boolean);
}

function renderAgentFileChips() {
  if (!agentFileChips) return;

  agentFileChips.innerHTML = "";
  agentFileChips.hidden = agentSelectedFiles.length === 0;

  agentSelectedFiles.forEach((item, index) => {
    const chip = document.createElement("span");
    chip.className = "file-chip" + (getAttachmentId(item) ? " persisted" : "");
    chip.title = getAttachmentName(item) + " · " + formatFileSize(getAttachmentSize(item));

    const name = document.createElement("span");
    name.className = "file-chip-name";
    name.textContent = getAttachmentName(item);

    const removeBtn = document.createElement("button");
    removeBtn.className = "file-chip-remove";
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", getAttachmentName(item) + " 첨부 제거");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      agentSelectedFiles.splice(index, 1);
      syncAgentFileInput();
      renderAgentFileChips();
      focusInputWhenPanelReady(agentMessageInput);
    });

    chip.appendChild(name);
    chip.appendChild(removeBtn);
    agentFileChips.appendChild(chip);
  });

  updateAgentNewChatButtonVisibility();
}

function syncAgentFileInput() {
  if (!agentFileInput || typeof DataTransfer === "undefined") return;

  const transfer = new DataTransfer();
  agentSelectedFiles.forEach((item) => {
    const file = getAttachmentFile(item);
    if (file) transfer.items.add(file);
  });
  agentFileInput.files = transfer.files;
}

function validateAgentFileForUpload(file) {
  const name = String(file?.name || "uploaded-file");
  const ext = getFileExtension(name);
  if (!ext) return name + " 파일은 확장자가 없어 업로드할 수 없습니다.";
  if (ext === "pdf" && !AGENT_ALLOWED_FILE_EXTENSIONS.includes(ext)) {
    return name + " PDF 파일은 현재 바로 분석할 수 없습니다. PDF 내용을 복사해 입력창에 붙여넣거나, Word(.docx) 또는 텍스트(.txt) 파일로 변환해 업로드해 주세요.";
  }
  if (["png", "jpg", "jpeg", "webp"].includes(ext) && !AGENT_ALLOWED_FILE_EXTENSIONS.includes(ext)) {
    return name + " 이미지 파일은 현재 바로 분석할 수 없습니다. 이미지 내용을 텍스트로 입력하거나 문서 파일로 변환해 업로드해 주세요.";
  }
  if (AGENT_BLOCKED_FILE_EXTENSIONS.has(ext)) return name + " 파일은 현재 업로드할 수 없는 형식입니다. 문서 파일로 변환한 뒤 다시 업로드해 주세요.";
  if (!AGENT_ALLOWED_FILE_EXTENSIONS.includes(ext)) return name + " 파일 형식(." + ext + ")은 현재 지원하지 않습니다. Word(.docx), Excel(.xlsx), PowerPoint(.pptx), 텍스트(.txt), CSV(.csv) 형식으로 변환해 업로드해 주세요.";
  if (file.size > AGENT_MAX_FILE_SIZE_BYTES) return name + " 파일은 최대 " + formatFileSize(AGENT_MAX_FILE_SIZE_BYTES) + "까지 업로드할 수 있습니다.";
  return "";
}

function getFileExtension(name) {
  const text = String(name || "").toLowerCase();
  const index = text.lastIndexOf(".");
  return index >= 0 ? text.slice(index + 1) : "";
}

function formatFileSize(size) {
  const value = Number(size || 0);
  if (value < 1024) return value + "B";
  if (value < 1024 * 1024) return Math.round(value / 1024) + "KB";
  return (value / 1024 / 1024).toFixed(1) + "MB";
}

function addAgentFiles(files) {
  const incomingFiles = Array.from(files || []);
  if (!incomingFiles.length) return;

  const rejected = [];

  incomingFiles.forEach((file) => {
    const validationMessage = validateAgentFileForUpload(file);
    if (validationMessage) {
      rejected.push(validationMessage);
      return;
    }

    const duplicate = agentSelectedFiles.some((saved) =>
      getAttachmentName(saved) === file.name &&
      getAttachmentSize(saved) === file.size &&
      Number(saved?.lastModified || saved?.file?.lastModified || 0) === file.lastModified
    );

    if (!duplicate) {
      agentSelectedFiles.push({
        id: "",
        file,
        name: file.name,
        size: file.size,
        type: file.type || "",
        lastModified: file.lastModified || 0,
        persisted: false,
      });
    }
  });

  if (rejected.length) {
    addMessage(agentBody, "bot", "첨부할 수 없는 파일이 제외되었습니다.\n" + rejected.slice(0, 5).map((item) => "- " + item).join("\n"));
  }

  syncAgentFileInput();
  renderAgentFileChips();
  focusInputWhenPanelReady(agentMessageInput);
}

function clearAgentComposerFiles() {
  agentSelectedFiles = [];
  if (agentFileInput) agentFileInput.value = "";
  renderAgentFileChips();
}

function clearAgentFiles() {
  clearAgentComposerFiles();
  lastAgentRoute = "";
  lastAgentFileUseAt = 0;
}

function clearAgentComposerInput() {
  if (!agentMessageInput) return;
  agentMessageInput.value = "";
  autoResizeTextarea(agentMessageInput);
}

function mergePersistedAgentFiles(files = []) {
  if (!Array.isArray(files) || !files.length) return;

  files.forEach((file) => {
    const id = String(file.id || file.fileId || "");
    const name = file.original_name || file.originalName || file.name || "uploaded-file";
    const size = Number(file.size_bytes || file.sizeBytes || file.size || 0);
    if (!id && !name) return;

    const existingIndex = agentSelectedFiles.findIndex((item) => {
      const sameId = id && getAttachmentId(item) === id;
      const sameNameSize = getAttachmentName(item) === name && getAttachmentSize(item) === size;
      return sameId || sameNameSize;
    });

    const next = {
      id,
      file: existingIndex >= 0 ? getAttachmentFile(agentSelectedFiles[existingIndex]) : null,
      name,
      size,
      type: file.mime_type || file.mimeType || file.type || "",
      extractionStatus: file.extraction_status || file.extractionStatus || "",
      persisted: Boolean(id),
      createdAt: file.created_at || file.createdAt || "",
    };

    if (existingIndex >= 0) {
      agentSelectedFiles[existingIndex] = { ...agentSelectedFiles[existingIndex], ...next };
    } else {
      agentSelectedFiles.push(next);
    }
  });

  syncAgentFileInput();
  renderAgentFileChips();
}

async function agentStateRequest(payload) {
  const res = await fetch(AGENT_STATE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + sessionToken,
    },
    body: JSON.stringify(payload || {}),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, message: text };
  }

  if (!res.ok) throw new Error(data.message || "HTTP " + res.status);
  return data;
}

function scheduleAgentSessionRestore() {
  if (!sessionToken || agentStateReady || agentStateLoading) return;

  const run = () => {
    // 화면 표시와 입력 가능 상태가 먼저 잡힌 뒤, 이전 대화/파일 상태만 조용히 복원합니다.
    initAgentSessionState();
  };

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 1200 });
    return;
  }

  setTimeout(run, 0);
}

async function initAgentSessionState() {
  if (!sessionToken || agentStateReady || agentStateLoading) return;

  agentStateLoading = true;

  try {
    const data = await agentStateRequest({ action: "get_state", sessionId: agentSessionId });
    if (!data.ok) return;

    agentSessionId = data.session?.id || data.sessionId || agentSessionId || "";
    if (agentSessionId) sessionStorage.setItem("ds_agent_session_id", agentSessionId);

    if (Array.isArray(data.messages) && data.messages.length) {
      // 사용자가 이미 화면에서 메시지를 입력/전송한 경우, 늦게 도착한 세션 복원 응답이
      // 현재 대화를 지워버리지 않도록 복원 렌더링을 생략합니다.
      if ((hasAgentVisibleConversation() && !agentConversationRenderedFromCache) || agentSubmitInProgress) {
        agentStateReady = true;
        return;
      }

      resetAgentMessagesKeepingWelcome();
      agentConversationRenderedFromCache = false;
      let lastRestoredUserMessage = "";
      const completedPptJobIds = new Set();

      data.messages.forEach((msg) => {
        const metadata = msg.metadata || {};
        const jobId = metadata?.pptJob?.id;
        if (jobId && (metadata?.ppt?.ok || metadata.route === "skywork-pull-completed")) {
          completedPptJobIds.add(jobId);
        }
      });

      data.messages.forEach((msg) => {
        const role = msg.role === "user" ? "user" : "bot";
        const metadata = msg.metadata || {};
        const content = String(msg.content || msg.text || "");
        const isArtifact = role === "bot" && isArtifactMessageMetadata(metadata);
        const isKnowledgeRedirect = role === "bot" && (metadata.route === "knowledge-redirect" || isKnowledgeRedirectText(content));

        const messageDiv = addMessage(agentBody, role, content, false, {
          skipAgentSave: true,
          hideCopy: isArtifact || isKnowledgeRedirect,
        });

        if (role === "user") {
          lastRestoredUserMessage = content;
        }

        // 새로고침 후에도 1시간 유효한 엑셀 다운로드 버튼을 다시 표시합니다.
        // 엑셀 다운로드 버튼은 메시지 본문 복사보다 파일 다운로드가 핵심 액션이므로 복사 버튼은 숨깁니다.
        if (isArtifact) {
          appendSavedArtifactDownloads(agentBody, metadata, metadata.artifactSavedAt || msg.created_at || msg.createdAt || "");
        }

        // 사내 규정/업무 절차 안내 메시지는 복사 버튼을 숨기고 이동 버튼만 복원합니다.
        if (isKnowledgeRedirect) {
          applyKnowledgeRedirectAction(messageDiv, metadata.originalMessage || lastRestoredUserMessage);
        }
      });
      agentBody.scrollTop = agentBody.scrollHeight;
      saveAgentConversationCacheNow();
      updateAgentNewChatButtonVisibility();
    } else if (agentConversationRenderedFromCache) {
      resetAgentMessagesKeepingWelcome();
      agentConversationRenderedFromCache = false;
      saveAgentConversationCacheNow();
    }

    if (Array.isArray(data.files) && data.files.length) {
      // 파일 분석 후속 질문에서 "이 파일", "리스크", "부서별" 같은 표현이
      // 일반 지식베이스로 빠지지 않도록 현재 분석 파일 칩을 복원합니다.
      // 사용자가 X를 누르거나 새 대화를 시작하기 전까지 같은 파일을 기준으로 file-api를 사용합니다.
      mergePersistedAgentFiles(data.files);
    }

    agentStateReady = true;
  } catch (err) {
    agentStateReady = true;
  } finally {
    agentStateLoading = false;
    updateAgentNewChatButtonVisibility();
  }
}

function saveAgentMessage(role, content, metadata = {}) {
  const text = String(content || "").trim();
  if (!text || !sessionToken) return Promise.resolve(null);

  return agentStateRequest({
    action: "save_message",
    sessionId: agentSessionId,
    role,
    content: text,
    route: metadata.route || lastAgentRoute || "",
    metadata,
  }).then((data) => {
    if (data.session?.id) {
      agentSessionId = data.session.id;
      sessionStorage.setItem("ds_agent_session_id", agentSessionId);
    }
    saveAgentConversationCacheDebounced();
    return data;
  }).catch((err) => {
    return null;
  });
}

function normalizeAgentText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isShortText(text, maxLength = 45) {
  return text.replace(/\s+/g, "").length <= maxLength;
}

function hasRecentFileConversation(history = []) {
  const recent = Array.isArray(history) ? history.slice(-6) : [];

  return recent.some((item) => {
    const text = normalizeAgentText(item?.text || "");

    return (
      text.includes("[첨부 파일]") ||
      text.includes("업로드한 파일") ||
      text.includes("첨부한 파일") ||
      text.includes("파일 기준") ||
      text.includes("파일 내용") ||
      text.includes("업로드된 파일") ||
      text.includes("위 내용은 업로드된 파일") ||
      text.includes("업로드하신")
    );
  });
}


function buildAgentMessage(message, files = []) {
  const text = String(message || "").trim() || "첨부한 파일을 분석해 주세요.";
  const list = Array.isArray(files) ? files : [];

  if (!list.length) return text;

  const fileLines = list.map((item, index) => {
    const name = getAttachmentName(item);
    const size = formatFileSize(getAttachmentSize(item));
    return `${index + 1}. ${name} (${size})`;
  });

  return [text, "", "[첨부 파일]", ...fileLines].join("\n");
}

function shouldRedirectToKnowledge(message, hasFiles = false) {
  if (hasFiles) return false;

  const text = normalizeAgentText(message);
  if (!text) return false;

  // 문서 작성·요약·번역·메일 초안 등 업무 AI Agent가 처리해야 하는 산출물 요청은
  // 사내 지식 문의로 돌리지 않습니다.
  const workOutputPatterns = [
    /메일|이메일|공문|공지|안내문|보고서|기안|품의서|회의록|요약|정리|번역|검토|초안|문장|표현|다듬|작성|써\s*줘|써줘|만들어\s*줘|만들어줘|수정|엑셀|pptx?|피피티|파워포인트|슬라이드|제안서/i,
  ];
  if (hasPattern(text, workOutputPatterns)) return false;

  const explicitKnowledgePatterns = [
    /사내\s*지식\s*문의|지식\s*베이스|사내\s*자료\s*기준/i,
    /사내\s*(규정|규칙|내규|규정집|기준|정책)/i,
    /업무\s*(절차|프로세스|매뉴얼|가이드|기준)/i,
    /(담당\s*부서|담당자|소관\s*부서|문의\s*부서)/i,
    /(신청|승인|결재|품의|구매|계약|정산|경비|출장|휴가|연차|근태|복리후생|보안|개인정보).{0,12}(절차|규정|기준|방법|어디|누구|담당|문의)/i,
    /(절차|규정|기준|방법|담당).{0,12}(알려|확인|문의|어디|누구|뭐야|무엇)/i,
  ];

  return hasPattern(text, explicitKnowledgePatterns);
}

function addKnowledgeRedirectMessage(originalMessage = "") {
  const answer = [
    "사내 규정이나 업무 절차에 대한 질문은 정확한 답변을 위해 사내 지식 문의에서 확인해 주세요.",
    "아래 버튼을 누르면 질문 내용을 그대로 가져갈 수 있습니다.",
  ].join("\n");

  const messageDiv = addMessage(agentBody, "bot", answer, false, { hideCopy: true });
  applyKnowledgeRedirectAction(messageDiv, originalMessage);

  saveAgentMessage("assistant", answer, {
    route: "knowledge-redirect",
    originalMessage,
  });
}

function shouldUseFileApi(message, hasFiles, history = []) {
  if (!hasFiles) return false;

  const text = normalizeAgentText(message);

  // 파일만 첨부하고 입력 없이 전송한 경우
  if (!text) return true;

  /**
   * 1순위: 강한 파일 참조
   * 아래 표현은 사용자가 업로드/첨부 파일을 직접 가리키는 경우입니다.
   * 이 경우에는 이메일 초안/보고서 작성 요청이어도 file-api로 보내는 게 맞습니다.
   *
   * 예:
   * - 이 파일 내용으로 메일 초안 써줘
   * - 첨부한 자료 기준으로 보고서 작성해줘
   * - 해당 문서에서 주요 성과 알려줘
   */
  const strongFileReferencePatterns = [
    /(?:해당|이|위|앞)\s*(?:파일|자료|문서|내용|브로슈어)/i,
    /(?:첨부한|첨부된|업로드한|업로드된)\s*(?:파일|자료|문서|내용|브로슈어)?/i,
    /(?:파일|자료|문서|브로슈어)\s*(?:내용|기준|안에서|에서|상에서|내에서)/i,
    /(?:pdf|pptx?|파워포인트|xlsx?|엑셀|docx?|워드|txt|csv)\s*(?:내용|기준|안에서|에서|상에서|내에서)/i,
    /(?:파일|자료|문서|브로슈어)\s*(?:에\s*있는|에\s*나온|에\s*포함된|속의)/i,
    /(?:이|해당)\s*(?:pdf|pptx?|파워포인트|xlsx?|엑셀|docx?|워드|txt|csv)/i,
  ];

  if (hasPattern(text, strongFileReferencePatterns)) {
    return true;
  }

  /**
   * 2순위: 명백한 일반 업무 요청
   * 파일 칩이 남아 있어도 아래 요청은 agent-api로 보내야 합니다.
   *
   * 예:
   * - 외부 업체에 github 파일 이관 가능한지 묻는 이메일 초안 써줘
   * - 엑셀 함수 알려줘
   * - 보고서 제목 추천해줘
   * - 네이버 클라우드 이관 문의 메일 작성해줘
   */
  const generalWorkPatterns = [
    /메일|이메일|공문|안내문|문구|인사말|초안|작성/i,
    /제목\s*추천|아이디어|방법|설명|개념|코드|함수|쿼리|오류|에러|번역/i,
    /github|깃허브|네이버\s*클라우드|ncp|aws|azure/i,
    /외부\s*업체|업체|거래처|담당자|문의|가능한지|이관|마이그레이션/i,
  ];

  if (hasPattern(text, generalWorkPatterns)) {
    return false;
  }

  /**
   * 3순위: 현재 파일 칩이 남아 있고 분석/집계/리스크 성격의 요청이면 file-api를 유지합니다.
   * 파일 칩은 사용자가 직접 X를 누르기 전까지 "현재 분석 파일"을 뜻합니다.
   * 예: 부서별 합계, 평균, 상위 5건, 리스크, 누락값, 중복값, 프로젝트/재고 현황
   */
  const fileTaskPatterns = [
    /요약|분석|정리|추출|검토|비교/i,
    /표로|표\s*형태|목록화/i,
    /핵심|주요\s*성과|성과|리스크|시사점|결론|근거/i,
    /찾아|찾아서|뽑아|알려줘|확인해줘/i,
    /합계|평균|중앙값|최대|최소|상위|하위|높은|낮은|최고|최저|순위|랭킹/i,
    /부서별|담당자별|거래처별|제품별|지역별|상태별|월별|일자별/i,
    /순매출|매출|수량|단가|재고|안전재고|예산|집행액|프로젝트|거래번호|누락|중복|이상치/i,
  ];

  if (hasPattern(text, fileTaskPatterns)) {
    return true;
  }

  /**
   * 4순위: 약한 파일 참조 + 파일 작업 동사
   * 단독으로는 위험하지만, "요약/분석/정리"와 함께 나오면 file-api로 보냅니다.
   *
   * 예:
   * - 브로슈어 요약해줘
   * - pdf 정리해줘
   * - 엑셀 표로 정리해줘
   */
  const weakFileReferencePatterns = [
    /첨부|업로드/i,
    /브로슈어/i,
    /pdf|pptx?|파워포인트|xlsx?|엑셀|docx?|워드|txt|csv/i,
    /파일|자료|문서/i,
  ];

  const hasWeakFileReference = hasPattern(text, weakFileReferencePatterns);
  const hasFileTask = hasPattern(text, fileTaskPatterns);

  if (hasWeakFileReference && hasFileTask) {
    return true;
  }

  /**
   * 4순위: 애매한 후속 질문
   * 직전에 파일 분석을 했고, 현재 질문이 짧은 분석성 질문이면 file-api로 보냅니다.
   *
   * 예:
   * - 주요 성과는?
   * - 핵심은?
   * - 표로 정리해줘
   * - 리스크는?
   */
  const recentFileContext = hasRecentFileConversation(history);

  if (recentFileContext && hasFileTask && isShortText(text, 45)) {
    return true;
  }

  /**
   * 5순위: 파일 업로드 직후 짧은 요청
   * 파일을 첨부하고 바로 "요약해줘", "분석해줘"처럼 짧게 요청하는 경우
   */
  if (hasFileTask && isShortText(text, 25)) {
    return true;
  }

  return false;
}


function getInstructionPart(message) {
  const raw = String(message || "").trim();
  if (!raw) return "";

  /**
   * Export routing must read the user's instruction, not the data payload.
   * Example:
   *   "아래 내용을 엑셀 파일로 만들어줘.\n\n컬럼:\n...\n데이터:\nPPT 템플릿 검토 / ..."
   * The word "PPT" above is only a cell value, so it must not trigger PPT generation.
   */
  const blockMarkerPattern = /(^|\n)\s*(?:컬럼|열|데이터|자료|내용|목록|표\s*데이터|원본|입력|행)\s*:/i;
  const markerMatch = raw.match(blockMarkerPattern);

  if (markerMatch && typeof markerMatch.index === "number" && markerMatch.index > 0) {
    return raw.slice(0, markerMatch.index).trim();
  }

  const lines = raw.split(/\r?\n/);
  const firstBlankIndex = lines.findIndex((line, index) => index > 0 && !line.trim());
  if (firstBlankIndex > 0) {
    const head = lines.slice(0, firstBlankIndex).join("\n").trim();
    if (head && looksLikeExportInstruction(head)) return head;
  }

  return raw;
}

function looksLikeExportInstruction(text) {
  const normalized = normalizeAgentText(text);
  if (!normalized) return false;

  return /엑셀|xlsx?|excel|스프레드시트|pptx?|파워포인트|프레젠테이션|슬라이드|발표자료|보고자료/i.test(normalized) &&
    /만들|생성|작성|제작|구성|정리|변환|다운로드|내려받|출력|파일로|로\s*줘/i.test(normalized);
}

function hasExplicitExcelExportRequest(text) {
  const normalized = normalizeAgentText(text);
  if (!normalized) return false;

  const excelPatterns = [
    /(?:엑셀|xlsx|excel|스프레드시트)\s*(?:파일)?\s*(?:로|으로)\s*(?:만들|생성|작성|정리|변환|다운로드|내려받|출력)/i,
    /(?:엑셀|xlsx|excel|스프레드시트)\s*파일\s*(?:을|를)?\s*(?:만들|생성|작성|정리|다운로드|내려받|출력)/i,
    /(?:표|목록|데이터|내용|자료|결과|위\s*내용|아래\s*내용).{0,30}(?:엑셀|xlsx|excel|스프레드시트)\s*(?:파일)?\s*(?:로|으로)/i,
    /(?:엑셀|xlsx|excel)\s*(?:다운로드|내려받기|다운받기)\s*(?:버튼|링크|파일|가능|하게|할\s*수|만들|생성)/i,
    /(?:다운로드|내려받|다운받).{0,20}(?:엑셀|xlsx|excel)\s*(?:파일)?/i,
  ];

  return hasPattern(normalized, excelPatterns);
}

function hasExplicitPptExportRequest(text) {
  const normalized = normalizeAgentText(text);
  if (!normalized) return false;

  const pptPatterns = [
    /(?:pptx?|피피티|파워포인트|프레젠테이션|슬라이드|발표자료|보고자료|보고용\s*(?:pptx?|피피티|파워포인트|프레젠테이션|자료))\s*(?:파일|자료|초안|덱)?\s*(?:로|으로)\s*(?:만들|생성|작성|제작|구성|정리|변환|다운로드|내려받|출력)/i,
    /(?:pptx?|피피티|파워포인트|프레젠테이션|슬라이드|발표자료|보고자료|보고용\s*(?:pptx?|피피티|파워포인트|프레젠테이션|자료))\s*(?:파일|자료|초안|덱)?\s*(?:을|를)?\s*(?:만들|생성|작성|제작|구성|정리|변환)(?:어|아|해)?\s*(?:줘|주세요|주십시오|달라|바랍니다|해줘|해주세요)/i,
    /(?:발표자료|보고자료|보고용\s*자료|제안서)\s*(?:를|을)?\s*(?:만들|생성|작성|제작|구성)/i,
    /(?:pptx?|피피티|파워포인트|프레젠테이션)\s*초안/i,
    /(?:\d+|[0-9]+)\s*(?:장|페이지|슬라이드).{0,30}(?:pptx?|피피티|파워포인트|프레젠테이션|슬라이드)/i,
    /(?:pptx?|피피티|파워포인트|프레젠테이션|슬라이드).{0,30}(?:\d+|[0-9]+)\s*(?:장|페이지|슬라이드)/i,
  ];

  return hasPattern(normalized, pptPatterns);
}

function hasBothExportFormatsRequest(text) {
  const normalized = normalizeAgentText(text);
  if (!normalized) return false;

  const bothFormatPatterns = [
    /(?:엑셀|xlsx|excel|스프레드시트).{0,12}(?:과|와|및|랑|하고|,|\/|둘\s*다|모두).{0,12}(?:pptx?|파워포인트|프레젠테이션|슬라이드|발표자료)/i,
    /(?:pptx?|파워포인트|프레젠테이션|슬라이드|발표자료).{0,12}(?:과|와|및|랑|하고|,|\/|둘\s*다|모두).{0,12}(?:엑셀|xlsx|excel|스프레드시트)/i,
  ];

  const exportActionPatterns = [
    /만들|생성|작성|제작|정리|변환|다운로드|내려받|출력|파일로|파일\s*생성/i,
  ];

  return hasPattern(normalized, bothFormatPatterns) && hasPattern(normalized, exportActionPatterns);
}

function decideExportTask(message) {
  const instructionText = getInstructionPart(message);
  const normalizedInstruction = normalizeAgentText(instructionText);
  const normalizedFullText = normalizeAgentText(message);

  if (hasBothExportFormatsRequest(normalizedInstruction)) return "ambiguous_export";

  const wantsExcelFromInstruction = hasExplicitExcelExportRequest(normalizedInstruction);
  const wantsPptFromInstruction = hasExplicitPptExportRequest(normalizedInstruction);

  if (wantsExcelFromInstruction && wantsPptFromInstruction) return "ambiguous_export";
  if (wantsExcelFromInstruction) return EXCEL_DRAFT_TASK;
  if (wantsPptFromInstruction) return PPT_DRAFT_TASK;

  /**
   * Fallback is intentionally strict. This catches short requests without
   * block markers while avoiding values such as "PPT 템플릿 검토" in data rows.
   */
  if (hasBothExportFormatsRequest(normalizedFullText)) return "ambiguous_export";

  const wantsExcelFromFullText = hasExplicitExcelExportRequest(normalizedFullText);
  const wantsPptFromFullText = hasExplicitPptExportRequest(normalizedFullText);

  if (wantsExcelFromFullText && wantsPptFromFullText) return "ambiguous_export";
  if (wantsExcelFromFullText) return EXCEL_DRAFT_TASK;
  if (wantsPptFromFullText) return PPT_DRAFT_TASK;

  return "";
}

function buildAmbiguousExportAnswer() {
  return [
    "엑셀과 PPT 요청이 모두 감지되어 자동 생성 형식을 확정하지 않았습니다.",
    "원하는 결과물을 한 가지로 지정해 주세요.",
    "",
    "예시",
    "- 이 내용을 엑셀 파일로 만들어줘",
    "- 이 내용을 PPT 파일로 만들어줘",
  ].join("\n");
}

function shouldUsePptDraft(message, hasFiles = false) {
  return decideExportTask(message) === PPT_DRAFT_TASK;
}


function shouldUseWebSearch(message) {
  const text = normalizeAgentText(message);
  if (!text) return false;

  /**
   * 웹 검색은 명시적 요청 또는 최신성이 핵심인 질문에만 사용합니다.
   * 일반 메일/문서 작성 요청이 외부 업체, AWS, 견적서 같은 단어를 포함하더라도
   * 최신 정보 조회 의도가 없으면 agent-api 일반 작성 경로로 보냅니다.
   */
  const explicitSearchPatterns = [
    /웹\s*검색|인터넷\s*검색|온라인\s*검색|검색해서|찾아보고|조사해서|최신\s*자료|최신\s*정보/i,
    /근거\s*자료\s*(?:찾아|검색|조사)|출처\s*(?:포함|찾아|검색)|링크\s*(?:포함|찾아|검색)/i,
  ];

  const freshnessPatterns = [
    /(?:오늘|현재|지금|최근|최신|요즘|이번\s*주|이번\s*달|올해|\d{4}년).{0,20}(?:현황|동향|뉴스|이슈|사례|가격|요금|정책|법령|규정|버전|업데이트|일정|환율|주가|날씨)/i,
    /(?:뉴스|공시|주가|환율|날씨|일정|가격|요금|채용|공고|법령|정책|보안\s*취약점|릴리스\s*노트|업데이트\s*내역).{0,20}(?:알려|정리|요약|확인|찾아|검색)/i,
  ];

  return hasPattern(text, explicitSearchPatterns) || hasPattern(text, freshnessPatterns);
}


function hasSensitivePptRequestText(message) {
  // PPTX 생성이 제거되어 프론트에서는 별도 PPT 보안 차단을 수행하지 않습니다.
  // 실제 개인정보/기밀 차단은 agent-api 서버 정책에서 처리합니다.
  return false;
}

function buildPptUploadBlockedAnswer() {
  return [
    "PPTX 파일 자동 생성은 지원하지 않습니다.",
    "대신 슬라이드별 구성안과 본문 초안을 작성해 드리겠습니다.",
  ].join("\n");
}

function buildPptSensitiveBlockedAnswer() {
  return [
    "요청 내용에 민감정보가 포함되어 있을 수 있습니다.",
    "개인정보와 기밀 수치를 제거하거나 익명화한 뒤 슬라이드 구성안 작성을 요청해 주세요.",
  ].join("\n");
}



async function sendChatToTarget({
  targetBody,
  message,
  sendButton,
  input,
  task = "chat",
  attachments = [],
  apiUrl = AI_API_URL,
  history = [],
  stream = true,
  thinkingSteps = null,
}) {
  const thinkingBox = createThinkingBox(targetBody, thinkingSteps);

  try {
    const body = {
      message,
      stream,
    };

    if (task !== "chat") body.task = task;
    if (history.length) body.history = history;
    if (attachments.length) {
      body.attachments = attachments.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type || "",
        lastModified: file.lastModified || 0,
      }));
      body.systemNote = "첨부 파일의 실제 본문 추출 API가 아직 프론트엔드에 연결되지 않았으면 파일 내용을 분석했다고 말하지 마세요. 파일명과 사용자의 요청만 기준으로 답변하세요.";
    }

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + sessionToken,
      },
      body: JSON.stringify(body),
    });

    removeThinkingBox(thinkingBox);

    if (!res.ok) {
      const data = await readResponseData(res);
      const answerText = getApiAnswerText(data, "HTTP " + res.status);
      addMessage(targetBody, "bot", "AI API 오류가 발생했습니다.\n" + answerText, true);
      return;
    }

    const responseContentType = res.headers.get("content-type") || "";

    // stream=true로 요청했더라도 서버가 보안 차단/정책 응답을 JSON으로 반환할 수 있습니다.
    // 이 경우 JSON 전체를 화면에 노출하지 않고 answer/message만 표시합니다.
    if (stream && responseContentType.includes("application/json")) {
      const data = await readResponseData(res);
      const answerText = getApiAnswerText(data, "답변을 생성하지 못했습니다.");
      const isArtifact = Boolean(data.excel?.ok || task === EXCEL_DRAFT_TASK);
      const isKnowledgeRedirect = targetBody === agentBody && isKnowledgeRedirectText(answerText);
      const messageDiv = addMessage(targetBody, "bot", answerText, false, { hideCopy: isArtifact || isKnowledgeRedirect });
      appendExcelDownloadButton(targetBody, data.excel);
      appendEvidenceBox(targetBody, data);
      if (isKnowledgeRedirect) applyKnowledgeRedirectAction(messageDiv, message);
      if (targetBody === agentBody) {
        await saveAgentMessage("assistant", answerText, {
          route: isKnowledgeRedirect ? "knowledge-redirect" : task || "agent-api",
          artifact: isArtifact,
          artifactSavedAt: isArtifact ? new Date().toISOString() : undefined,
          excel: data.excel || null,
          originalMessage: isKnowledgeRedirect ? message : undefined,
        });
      }
      return;
    }

    if (!stream) {
      const data = await readResponseData(res);

      const answerText = getApiAnswerText(data, "답변을 생성하지 못했습니다.");
      const isArtifact = Boolean(data.excel?.ok || task === EXCEL_DRAFT_TASK);
      const isKnowledgeRedirect = targetBody === agentBody && isKnowledgeRedirectText(answerText);
      const messageDiv = addMessage(targetBody, "bot", answerText, false, { hideCopy: isArtifact || isKnowledgeRedirect });
      appendExcelDownloadButton(targetBody, data.excel);
      appendEvidenceBox(targetBody, data);
      if (isKnowledgeRedirect) applyKnowledgeRedirectAction(messageDiv, message);
      if (targetBody === agentBody) {
        await saveAgentMessage("assistant", answerText, {
          route: isKnowledgeRedirect ? "knowledge-redirect" : task || "agent-api",
          artifact: isArtifact,
          artifactSavedAt: new Date().toISOString(),
          excel: data.excel || null,
          originalMessage: isKnowledgeRedirect ? message : undefined,
        });
      }
      return;
    }

    if (!res.body) {
      addMessage(targetBody, "bot", "스트림 응답 본문이 없습니다.");
      return;
    }

    const botDiv = addMessage(targetBody, "bot", "");
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      buffer += chunk;

      if (buffer.includes("\n\n") || buffer.includes("data: [DONE]") || !buffer.includes("data:")) {
        const parsed = parseStreamText(buffer);

        if (parsed) {
          fullText += parsed;
          setMessageContent(botDiv, fullText);
          targetBody.scrollTop = targetBody.scrollHeight;
          if (targetBody === aiBody) saveChatHistory();
          if (targetBody === agentBody) saveAgentConversationCacheDebounced();
        }

        buffer = "";
      }
    }

    const tail = decoder.decode();
    if (tail) buffer += tail;

    const finalParsed = parseStreamText(buffer);
    if (finalParsed) {
      fullText += finalParsed;
      setMessageContent(botDiv, fullText);
      if (targetBody === aiBody) saveChatHistory();
      if (targetBody === agentBody) saveAgentConversationCacheDebounced();
    }

    if (!fullText.trim()) {
      setMessageContent(botDiv, "답변 데이터는 수신했지만 화면에 표시할 텍스트를 찾지 못했습니다.");
      if (targetBody === aiBody) saveChatHistory();
      if (targetBody === agentBody) saveAgentConversationCacheDebounced();
    }

    if (targetBody === agentBody && fullText.trim()) {
      const isKnowledgeRedirect = isKnowledgeRedirectText(fullText);
      if (isKnowledgeRedirect) applyKnowledgeRedirectAction(botDiv, message);
      saveAgentMessage("assistant", fullText, {
        route: isKnowledgeRedirect ? "knowledge-redirect" : task || "agent-api",
        originalMessage: isKnowledgeRedirect ? message : undefined,
      });
    }
  } catch (err) {
    removeThinkingBox(thinkingBox);
    addMessage(targetBody, "bot", "호출 실패: " + getErrorMessage(err));
  } finally {
    if (sendButton) {
      if (sendButton === agentSendBtn && isAgentPptGenerating) {
        syncAgentPptGeneratingControls();
      } else {
        sendButton.disabled = false;
      }
    }

    if (!(input === agentMessageInput && isAgentPptGenerating)) {
      focusInputWhenPanelReady(input);
    }
  }
}

async function sendChat(message) {
  return sendChatToTarget({
    targetBody: aiBody,
    message,
    sendButton: sendBtn,
    input: messageInput,
  });
}

async function sendAgentFileAnalysis(message, files = [], history = [], options = {}) {
  const useStream = options.stream !== false;
  const task = options.task || "";
  const thinkingBox = createThinkingBox(agentBody, options.thinkingSteps || null);

  try {
    const formData = new FormData();
    formData.append("message", message);
    formData.append("stream", String(useStream));
    if (agentSessionId) formData.append("sessionId", agentSessionId);
    if (task) formData.append("task", task);
    if (history.length) formData.append("history", JSON.stringify(history));

    const fileIds = getAgentFileIds(files);
    if (fileIds.length) formData.append("fileIds", JSON.stringify(fileIds));

    files.forEach((item) => {
      const file = getAttachmentFile(item);
      if (file && !getAttachmentId(item)) {
        formData.append("files", file, file.name);
      }
    });

    const res = await fetch(FILE_API_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + sessionToken,
      },
      body: formData,
    });

    removeThinkingBox(thinkingBox);

    if (!res.ok) {
      const data = await readResponseData(res);
      const answerText = getApiAnswerText(data, "HTTP " + res.status);
      const safeMessage = buildUserFriendlyFileErrorMessage(answerText);
      addMessage(agentBody, "bot", safeMessage, false, { hideCopy: true });
      await saveAgentMessage("assistant", safeMessage, {
        route: "file-api-error",
        fileIds: getAgentFileIds(files),
      });
      return;
    }

    const responseContentType = res.headers.get("content-type") || "";

    if (useStream && responseContentType.includes("application/json")) {
      const data = await readResponseData(res);
      const responseFileIds = getFileIdsFromResponses(data.files || []);
      if (options.keepFilesInComposer === true) mergePersistedAgentFiles(data.files || []);
      const answerText = getApiAnswerText(data, "파일 분석 답변을 생성하지 못했습니다.");
      const isArtifact = Boolean(data.excel?.ok || task === EXCEL_DRAFT_TASK);
      const isKnowledgeRedirect = isKnowledgeRedirectText(answerText);
      const messageDiv = addMessage(agentBody, "bot", answerText, false, { hideCopy: isArtifact || isKnowledgeRedirect });
      appendExcelDownloadButton(agentBody, data.excel);
      appendEvidenceBox(agentBody, data);
      if (isKnowledgeRedirect) applyKnowledgeRedirectAction(messageDiv, message);
      await saveAgentMessage("assistant", answerText, {
        route: isKnowledgeRedirect ? "knowledge-redirect" : task || "file-api",
        artifact: isArtifact,
        artifactSavedAt: isArtifact ? new Date().toISOString() : undefined,
        excel: data.excel || null,
        fileIds: responseFileIds,
        originalMessage: isKnowledgeRedirect ? message : undefined,
      });
      return;
    }

    if (!useStream) {
      const data = await readResponseData(res);

      const responseFileIds = getFileIdsFromResponses(data.files || []);
      if (options.keepFilesInComposer === true) mergePersistedAgentFiles(data.files || []);
      const answerText = getApiAnswerText(data, "파일 분석 답변을 생성하지 못했습니다.");
      const isArtifact = Boolean(data.excel?.ok || task === EXCEL_DRAFT_TASK);
      const isKnowledgeRedirect = isKnowledgeRedirectText(answerText);
      const messageDiv = addMessage(agentBody, "bot", answerText, false, { hideCopy: isArtifact || isKnowledgeRedirect });
      appendExcelDownloadButton(agentBody, data.excel);
      appendEvidenceBox(agentBody, data);
      if (isKnowledgeRedirect) applyKnowledgeRedirectAction(messageDiv, message);
      await saveAgentMessage("assistant", answerText, {
        route: isKnowledgeRedirect ? "knowledge-redirect" : task || "file-api",
        artifact: isArtifact,
        artifactSavedAt: new Date().toISOString(),
        excel: data.excel || null,
        fileIds: responseFileIds,
        originalMessage: isKnowledgeRedirect ? message : undefined,
      });
      return;
    }

    if (!res.body) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        addMessage(agentBody, "bot", getApiAnswerText(data, "파일 분석 응답 본문이 없습니다."), true);
      } else {
        addMessage(agentBody, "bot", "파일 분석 응답 본문이 없습니다.");
      }
      return;
    }

    const botDiv = addMessage(agentBody, "bot", "");
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (buffer.includes("\n\n") || buffer.includes("data: [DONE]") || !buffer.includes("data:")) {
        const parsed = parseStreamText(buffer);

        if (parsed) {
          fullText += parsed;
          setMessageContent(botDiv, fullText);
          agentBody.scrollTop = agentBody.scrollHeight;
          saveAgentConversationCacheDebounced();
        }

        buffer = "";
      }
    }

    const tail = decoder.decode();
    if (tail) buffer += tail;

    const finalParsed = parseStreamText(buffer);
    if (finalParsed) {
      fullText += finalParsed;
      setMessageContent(botDiv, fullText);
      saveAgentConversationCacheDebounced();
    }

    if (!fullText.trim()) {
      setMessageContent(botDiv, "파일 분석 응답은 수신했지만 화면에 표시할 텍스트를 찾지 못했습니다.");
    } else {
      const isKnowledgeRedirect = isKnowledgeRedirectText(fullText);
      if (isKnowledgeRedirect) applyKnowledgeRedirectAction(botDiv, message);
      saveAgentMessage("assistant", fullText, {
        route: isKnowledgeRedirect ? "knowledge-redirect" : task || "file-api",
        originalMessage: isKnowledgeRedirect ? message : undefined,
        fileIds: getAgentFileIds(),
      });
    }
  } catch (err) {
    removeThinkingBox(thinkingBox);
    const safeMessage = buildUserFriendlyFileErrorMessage(getErrorMessage(err));
    addMessage(agentBody, "bot", safeMessage, false, { hideCopy: true });
  } finally {
    if (isAgentPptGenerating) {
      syncAgentPptGeneratingControls();
    } else {
      if (agentSendBtn) agentSendBtn.disabled = false;
      focusInputWhenPanelReady(agentMessageInput);
    }
  }
}


async function sendAgentChat(message, files = [], history = [], options = {}) {
  const task = options.task || "";
  const isPptDraft = task === PPT_DRAFT_TASK;
  const isExcelDraft = task === EXCEL_DRAFT_TASK;
  const isWebSearch = task === WEB_SEARCH_TASK;
  const useFileApi = Boolean(options.useFileApi && files.length);
  const thinkingSteps = isPptDraft
    ? [
      "요청 의도와 발표 목적을 정리하는 중",
      "슬라이드 흐름과 핵심 메시지를 구성하는 중",
      "장표별 본문 초안을 작성하는 중",
      "확인 필요 자료와 검토 항목을 정리하는 중",
    ]
    : null;

  if (useFileApi) {
    lastAgentRoute = "file-api";
    lastAgentFileUseAt = Date.now();
    return sendAgentFileAnalysis(message, files, history, {
      task,
      stream: false,
      thinkingSteps,
      keepFilesInComposer: true,
    });
  }

  lastAgentRoute = "agent-api";

  // PPT 요청도 agent-api 일반 문서 작성 경로로 전달합니다. 서버에서 PPTX 생성을 차단하고 슬라이드 구성안만 반환합니다.
  return sendChatToTarget({
    targetBody: agentBody,
    message,
    sendButton: agentSendBtn,
    input: agentMessageInput,
    apiUrl: AGENT_API_URL,
    history,
    task,
    stream: !(isPptDraft || isExcelDraft || isWebSearch),
    thinkingSteps,
    // 파일 칩이 남아 있더라도 일반 업무 요청으로 판단된 경우에는
    // agent-api/SideTalk에 첨부 메타데이터를 넘기지 않습니다.
    // 파일 기반 후속 질문은 위 file-api 경로에서만 처리합니다.
    attachments: [],
  });
}

if (aiBtn) aiBtn.addEventListener("click", () => setMode("ai"));

if (rpaBtn) rpaBtn.addEventListener("click", () => setMode("rpa"));

if (directQuestionBtn) {
  directQuestionBtn.addEventListener("click", () => setMode("ai"));
}

if (docWriteBtn) {
  // 버튼 클릭만으로는 API를 호출하지 않고, 문서 작성 화면만 엽니다.
  docWriteBtn.addEventListener("click", () => setMode("doc"));
}

if (rpaEntryBtn) {
  rpaEntryBtn.addEventListener("click", () => setMode("rpa"));
}

if (aiBackBtn) {
  aiBackBtn.addEventListener("click", () => setMode("home"));
}

if (rpaBackBtn) {
  rpaBackBtn.addEventListener("click", () => setMode("home"));
}

if (docBackBtn) {
  docBackBtn.addEventListener("click", () => setMode("home"));
}

if (agentNewChatBtn) {
  agentNewChatBtn.addEventListener("click", () => {
    startNewAgentConversation();
  });
}

if (reloadRpaBtn) {
  reloadRpaBtn.addEventListener("click", () => {
    // 최종 사용자 화면에서는 버튼이 숨겨져 있지만, 테스트용으로 남겨둡니다.
    rpaLoaded = false;
    loadRpaList();
  });
}


function autoResizeTextarea(input) {
  if (!input) return;
  input.style.height = "42px";
  input.style.height = Math.min(input.scrollHeight, 80) + "px";
}

function isPlainEnterSubmitEvent(e) {
  if (!e || e.key !== "Enter") return false;

  // 한글/중문/일문 IME 조합 중 Enter는 글자 확정 용도이므로 전송하지 않습니다.
  // keyCode 229는 일부 브라우저/그룹웨어 WebView에서 조합 중 입력으로 전달됩니다.
  if (e.isComposing || e.keyCode === 229) return false;

  // Shift + Enter는 줄바꿈으로 유지합니다.
  if (e.shiftKey) return false;

  return true;
}

function submitChatForm(form) {
  if (!form) return;

  // 그룹웨어 iframe/WebView 환경에서는 requestSubmit()이 무시되거나
  // submit 버튼 클릭 흐름이 안정적으로 전달되지 않는 경우가 있어
  // 우리 코드가 등록한 submit 핸들러를 직접 실행하는 방식으로 통일합니다.
  const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(submitEvent);
}

if (messageInput && chatForm) {
  messageInput.addEventListener("keydown", (e) => {
    if (!isPlainEnterSubmitEvent(e)) return;

    e.preventDefault();
    submitChatForm(chatForm);
  });

  messageInput.addEventListener("input", () => autoResizeTextarea(messageInput));

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (currentMode !== "ai") return;

    const message = messageInput.value.trim();
    if (!message) return;

    addMessage(aiBody, "user", message);

    messageInput.value = "";
    autoResizeTextarea(messageInput);
    sendBtn.disabled = true;

    await sendChat(message);
  });
}

if (agentBody) {
  agentBody.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".agent-suggestion-btn");
    if (!btn) return;
    e.preventDefault();
    applyAgentSuggestionTemplate(btn.getAttribute("data-template") || "");
  });
}

if (agentAttachBtn && agentFileInput) {
  agentAttachBtn.addEventListener("click", () => {
    if (isAgentPptGenerating) {
      syncAgentPptGeneratingControls();
      return;
    }

    agentFileInput.click();
  });
}

if (agentFileInput) {
  agentFileInput.addEventListener("change", () => {
    if (isAgentPptGenerating) {
      agentFileInput.value = "";
      syncAgentPptGeneratingControls();
      return;
    }

    addAgentFiles(agentFileInput.files);
  });
}

async function handleAgentFormSubmit() {
  if (!agentMessageInput || !agentForm) return;

  if (!isDocModeActive()) {
    return;
  }

  if (agentSubmitInProgress) {
    return;
  }

  if (isAgentPptGenerating) {
    syncAgentPptGeneratingControls();
    return;
  }

  const rawMessage = agentMessageInput.value.trim();
  if (!rawMessage && !agentSelectedFiles.length) {
    focusInputWhenPanelReady(agentMessageInput);
    return;
  }

  agentSubmitInProgress = true;
  if (agentSendBtn) agentSendBtn.disabled = true;

  const filesSnapshot = [...agentSelectedFiles];
  const historySnapshot = getRecentChatMessages(agentBody);
  const message = rawMessage || "첨부한 파일을 분석해 주세요.";
  const hasFiles = filesSnapshot.length > 0;
  const exportTask = decideExportTask(message);

  try {
    // 사용자 입력은 네트워크 세션 복원보다 먼저 화면에 표시합니다.
    // 그래야 agent-api 세션 복원/저장 요청이 느리거나 실패해도 사용자가 전송 여부를 즉시 알 수 있습니다.
    if (exportTask === "ambiguous_export") {
      addMessage(agentBody, "user", message);
      clearAgentComposerInput();
      // 파일 칩은 사용자가 직접 X를 누르기 전까지 유지합니다.
      saveAgentMessage("user", message, { route: "agent-api", fileIds: getAgentFileIds(filesSnapshot) });

      const answer = buildAmbiguousExportAnswer();
      addMessage(agentBody, "bot", answer, false, { hideCopy: true });
      saveAgentMessage("assistant", answer, { route: "export-clarification" });
      return;
    }

    const task = exportTask || (shouldUseWebSearch(message) && !hasFiles ? WEB_SEARCH_TASK : "");
    const usePptDraft = task === PPT_DRAFT_TASK;
    const useExcelDraft = task === EXCEL_DRAFT_TASK;

    // PPT 요청은 더 이상 차단하거나 외부 PPT 생성 Worker로 보내지 않습니다.
    // agent-api에 일반 문서 작성 요청으로 전달하여 슬라이드 구성안 텍스트만 제공합니다.
    const useFileApi = usePptDraft
      ? false
      : (useExcelDraft && hasFiles ? true : shouldUseFileApi(message, hasFiles, historySnapshot));

    const displayMessage = (useFileApi || (usePptDraft && hasFiles))
      ? buildAgentMessage(message, filesSnapshot)
      : message;

    addMessage(agentBody, "user", displayMessage);
    clearAgentComposerInput();
    // 파일 칩은 사용자가 직접 X를 누르거나 새 대화를 시작하기 전까지 유지합니다.
    // 후속 질문에서도 같은 fileId를 file-api로 넘겨 지식베이스가 끼어드는 것을 막습니다.

    // 세션/메시지 저장 실패가 실제 AI 호출을 막지 않도록 분리합니다.
    saveAgentMessage("user", displayMessage, {
      route: useFileApi ? "file-api" : task || "agent-api",
      fileIds: getAgentFileIds(filesSnapshot),
    });

    if (!task && !useFileApi && shouldRedirectToKnowledge(message, hasFiles)) {
      addKnowledgeRedirectMessage(message);
      return;
    }

    await sendAgentChat(message, filesSnapshot, historySnapshot, {
      useFileApi,
      task,
    });
  } catch (err) {
    addMessage(agentBody, "bot", "업무 AI Agent 처리 중 오류가 발생했습니다.\n" + getErrorMessage(err), true);
  } finally {
    agentSubmitInProgress = false;
    if (agentSendBtn && !isAgentPptGenerating) agentSendBtn.disabled = false;
    updateAgentNewChatButtonVisibility();
    focusInputWhenPanelReady(agentMessageInput);
  }
}

if (agentMessageInput && agentForm) {
  agentMessageInput.addEventListener("keydown", (e) => {
    if (!isPlainEnterSubmitEvent(e)) return;

    e.preventDefault();
    handleAgentFormSubmit();
  });

  agentMessageInput.addEventListener("input", () => autoResizeTextarea(agentMessageInput));

  if (agentSendBtn) {
    agentSendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleAgentFormSubmit();
    });
  }

  agentForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleAgentFormSubmit();
  });
}

