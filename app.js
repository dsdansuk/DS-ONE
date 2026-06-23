// DS Chatbot Frontend - 운영 분리 구조용 app.js
// GitHub Pages: https://dsdansuk.github.io/DS-chatbot/
// Edge Functions:
// - sso-login: 그룹웨어 SSO 진입 및 토큰 발급
// - ai-api: 사내 AI / SideTalk 호출
// - rpa-api: UiPath RPA 호출

const AI_API_URL =
  "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/ai-api";

const RPA_API_URL =
  "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/rpa-api";

const CHAT_HISTORY_TTL_MS = 60 * 60 * 1000; // 1시간
const AI_PROVIDER = "sidetalk"; // vertex | sidetalk | openai
const CHAT_HISTORY_STORAGE_PREFIX = "ds_chatbot_ai_history_v1_";
const AUTH_CACHE_STORAGE_PREFIX = "ds_chatbot_auth_cache_v1_";
const AUTH_CACHE_TTL_MS = 10 * 60 * 1000; // 10분

const RPA_STATUS_POLL_INTERVAL_MS = 30 * 1000; // 30초
const RPA_STATUS_POLL_MAX_MS = 10 * 60 * 1000; // 최대 10분

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
    console.warn("인증 캐시 저장 실패:", err);
  }
}

function clearCachedAuth() {
  const key = getAuthCacheKey();
  if (key) sessionStorage.removeItem(key);
}

function applyAuthenticatedProfile(profile) {
  currentEmpNo = String(profile.empNo || "");
  currentLoginId = String(profile.loginId || "");
  const displayUserName = getDisplayUserName(profile);

  userInfo.textContent = "로그인ID: " + currentLoginId;
  setHomeGreeting(displayUserName, true);
  restoreChatHistory();
  enableApp();
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

  if (!isAuthenticated) {
    homeGreetingText.textContent = "인증 후 이용 가능합니다";
    return;
  }

  homeGreetingText.textContent = name + "님, 필요한 업무를 선택해 주세요";
}

bootstrap();

async function bootstrap() {
  cleanupExpiredChatHistories();

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
  if (agentMessageInput) agentMessageInput.disabled = false;
  if (agentSendBtn) agentSendBtn.disabled = false;
  if (agentAttachBtn) agentAttachBtn.disabled = false;

  if (directQuestionBtn) directQuestionBtn.disabled = false;
  if (docWriteBtn) docWriteBtn.disabled = false;
  if (rpaEntryBtn) rpaEntryBtn.disabled = false;
  if (aiBtn) aiBtn.disabled = false;
  if (rpaBtn) rpaBtn.disabled = false;

  if (currentMode === "doc") focusInputWhenPanelReady(agentMessageInput);
}

function disableApp() {
  if (messageInput) messageInput.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (agentMessageInput) agentMessageInput.disabled = true;
  if (agentSendBtn) agentSendBtn.disabled = true;
  if (agentAttachBtn) agentAttachBtn.disabled = true;
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
    focusInputWhenPanelReady(agentMessageInput);
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

function addMessage(targetBody, type, text, debug = false, options = {}) {
  const div = document.createElement("div");
  div.className = debug ? "msg bot debug" : "msg " + type;
  div.textContent = text;

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
    targetBody.appendChild(row);
  } else {
    targetBody.appendChild(div);
  }

  targetBody.scrollTop = targetBody.scrollHeight;

  if (targetBody === aiBody && !debug && !options.skipSave) {
    saveChatHistory();
  }

  return div;
}

function clearBody(targetBody) {
  targetBody.innerHTML = "";

  if (targetBody === aiBody) {
    saveChatHistory();
  }
}

function createThinkingBox(targetBody = aiBody) {
  const steps = [
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

function parseStreamText(text) {
  if (!text) return "";

  if (!text.includes("data:")) {
    return text;
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
      output +=
        data.chunk ||
        data.message?.content ||
        data.delta?.content ||
        data.choices?.[0]?.delta?.content ||
        data.choices?.[0]?.message?.content ||
        data.answer ||
        data.content ||
        data.text ||
        "";
    } catch {
      output += payload;
    }
  }

  return output;
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

function saveChatHistory() {
  if (!currentLoginId && !currentEmpNo) return;

  const messages = getAllAiMessages();
  const payload = {
    savedAt: Date.now(),
    messages,
  };

  try {
    localStorage.setItem(getChatHistoryKey(), JSON.stringify(payload));
  } catch (err) {
    console.warn("AI 채팅 내역 저장 실패:", err);
  }
}

function restoreChatHistory() {
  if (!currentLoginId && !currentEmpNo) return;

  const key = getChatHistoryKey();
  const raw = localStorage.getItem(key);

  if (!raw) return;

  try {
    const payload = JSON.parse(raw);
    const savedAt = Number(payload.savedAt || 0);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    if (!savedAt || Date.now() - savedAt > CHAT_HISTORY_TTL_MS) {
      localStorage.removeItem(key);
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
    console.warn("AI 채팅 내역 복원 실패:", err);
    localStorage.removeItem(key);
  }
}

function cleanupExpiredChatHistories() {
  const now = Date.now();

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);

    if (!key || !key.startsWith(CHAT_HISTORY_STORAGE_PREFIX)) continue;

    try {
      const payload = JSON.parse(localStorage.getItem(key) || "{}");
      const savedAt = Number(payload.savedAt || 0);

      if (!savedAt || now - savedAt > CHAT_HISTORY_TTL_MS) {
        localStorage.removeItem(key);
      }
    } catch {
      localStorage.removeItem(key);
    }
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

      console.log("RPA DEBUG:", data.debug || data);
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
    console.warn("RPA 상태 조회 실패:", err);
  }
}

function updateRunningRpaJobsFromApi(jobs) {
  if (!Array.isArray(jobs)) return;

  runningRpaJobs = jobs
    .map((job) => ({
      name: job.name || job.Name || "이름 없음",
      status: convertJobState(job.status || job.State || job.state),
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
      "RPA 실행 실패\n" + (data.raw || data.message || JSON.stringify(data, null, 2)),
      true
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

function renderAgentFileChips() {
  if (!agentFileChips) return;

  agentFileChips.innerHTML = "";
  agentFileChips.hidden = agentSelectedFiles.length === 0;

  agentSelectedFiles.forEach((file, index) => {
    const chip = document.createElement("span");
    chip.className = "file-chip";
    chip.title = file.name + " · " + formatFileSize(file.size);

    const name = document.createElement("span");
    name.className = "file-chip-name";
    name.textContent = file.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "file-chip-remove";
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", file.name + " 첨부 제거");
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
}

function syncAgentFileInput() {
  if (!agentFileInput || typeof DataTransfer === "undefined") return;

  const transfer = new DataTransfer();
  agentSelectedFiles.forEach((file) => transfer.items.add(file));
  agentFileInput.files = transfer.files;
}

function addAgentFiles(files) {
  const incomingFiles = Array.from(files || []);
  if (!incomingFiles.length) return;

  incomingFiles.forEach((file) => {
    const duplicate = agentSelectedFiles.some((savedFile) =>
      savedFile.name === file.name &&
      savedFile.size === file.size &&
      savedFile.lastModified === file.lastModified
    );

    if (!duplicate) agentSelectedFiles.push(file);
  });

  syncAgentFileInput();
  renderAgentFileChips();
  focusInputWhenPanelReady(agentMessageInput);
}

function clearAgentFiles() {
  agentSelectedFiles = [];
  if (agentFileInput) agentFileInput.value = "";
  renderAgentFileChips();
}

function buildAgentMessage(message) {
  if (!agentSelectedFiles.length) return message;

  const fileList = agentSelectedFiles
    .map((file) => "- " + file.name + " (" + formatFileSize(file.size) + ")")
    .join("\n");

  return "[첨부 파일]\n" + fileList + "\n\n[요청]\n" + message;
}

async function sendChatToTarget({
  targetBody,
  message,
  sendButton,
  input,
  task = "chat",
  attachments = [],
}) {
  const thinkingBox = createThinkingBox(targetBody);

  try {
    const body = {
      message,
      provider: AI_PROVIDER,
      stream: true,
    };

    if (task !== "chat") body.task = task;
    if (attachments.length) {
      body.attachments = attachments.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type || "",
        lastModified: file.lastModified || 0,
      }));
      body.systemNote = "첨부 파일의 실제 본문 추출 API가 아직 프론트엔드에 연결되지 않았으면 파일 내용을 분석했다고 말하지 마세요. 파일명과 사용자의 요청만 기준으로 답변하세요.";
    }

    const res = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + sessionToken,
      },
      body: JSON.stringify(body),
    });

    removeThinkingBox(thinkingBox);

    if (!res.ok) {
      const errorText = await res.text();
      addMessage(targetBody, "bot", "AI API 오류가 발생했습니다.\nHTTP " + res.status + "\n" + errorText, true);
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
      console.log("AI STREAM CHUNK:", chunk);

      buffer += chunk;

      if (buffer.includes("\n\n") || buffer.includes("data: [DONE]") || !buffer.includes("data:")) {
        const parsed = parseStreamText(buffer);

        if (parsed) {
          fullText += parsed;
          botDiv.textContent = fullText;
          targetBody.scrollTop = targetBody.scrollHeight;
          if (targetBody === aiBody) saveChatHistory();
        }

        buffer = "";
      }
    }

    const tail = decoder.decode();
    if (tail) buffer += tail;

    const finalParsed = parseStreamText(buffer);
    if (finalParsed) {
      fullText += finalParsed;
      botDiv.textContent = fullText;
      if (targetBody === aiBody) saveChatHistory();
    }

    if (!fullText.trim()) {
      botDiv.textContent = "답변 데이터는 수신했지만 화면에 표시할 텍스트를 찾지 못했습니다.";
      if (targetBody === aiBody) saveChatHistory();
    }
  } catch (err) {
    removeThinkingBox(thinkingBox);
    addMessage(targetBody, "bot", "호출 실패: " + getErrorMessage(err));
  } finally {
    if (sendButton) sendButton.disabled = false;
    focusInputWhenPanelReady(input);
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

async function sendAgentChat(message, files = []) {
  return sendChatToTarget({
    targetBody: agentBody,
    message,
    sendButton: agentSendBtn,
    input: agentMessageInput,
    task: "document",
    attachments: files,
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

if (messageInput && chatForm) {
  messageInput.addEventListener("keydown", (e) => {
    // Shift + Enter → 줄바꿈
    if (e.key === "Enter" && e.shiftKey) {
      return;
    }

    // Enter → 전송
    if (e.key === "Enter") {
      e.preventDefault();
      chatForm.requestSubmit();
    }
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

if (agentAttachBtn && agentFileInput) {
  agentAttachBtn.addEventListener("click", () => {
    agentFileInput.click();
  });
}

if (agentFileInput) {
  agentFileInput.addEventListener("change", () => {
    addAgentFiles(agentFileInput.files);
  });
}

if (agentMessageInput && agentForm) {
  agentMessageInput.addEventListener("keydown", (e) => {
    // Shift + Enter → 줄바꿈
    if (e.key === "Enter" && e.shiftKey) {
      return;
    }

    // Enter → 전송
    if (e.key === "Enter") {
      e.preventDefault();
      agentForm.requestSubmit();
    }
  });

  agentMessageInput.addEventListener("input", () => autoResizeTextarea(agentMessageInput));

  agentForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (currentMode !== "doc") return;

    const rawMessage = agentMessageInput.value.trim();
    if (!rawMessage && !agentSelectedFiles.length) return;

    const filesSnapshot = [...agentSelectedFiles];
    const message = rawMessage || "첨부한 파일을 확인해 주세요.";
    const requestMessage = filesSnapshot.length ? buildAgentMessage(message) : message;

    addMessage(agentBody, "user", requestMessage);

    agentMessageInput.value = "";
    autoResizeTextarea(agentMessageInput);
    agentSendBtn.disabled = true;
    clearAgentFiles();

    await sendAgentChat(requestMessage, filesSnapshot);
  });
}
