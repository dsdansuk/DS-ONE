// DS ONE 업무 AI Agent Platform frontend
// DS-chatbot-prod v29의 SSO 세션 처리, agent-api/file-api 호출 흐름을
// DS-ONE 플랫폼 홈 UI에 맞게 경량화하여 적용한 버전입니다.

const DS_ONE_CONFIG = window.DS_ONE_CONFIG || {};
const DS_ENDPOINTS = DS_ONE_CONFIG.endpoints || {};
const DS_TASKS = DS_ONE_CONFIG.tasks || {};
const DS_STORAGE = DS_ONE_CONFIG.storage || {};
const DS_FILE_POLICY = DS_ONE_CONFIG.filePolicy || {};

const AGENT_API_URL = DS_ENDPOINTS.agentApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/agent-api";
const FILE_API_URL = DS_ENDPOINTS.fileApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/file-api";
const WEB_SEARCH_TASK = DS_TASKS.webSearch || "web_search";
const EXCEL_DRAFT_TASK = DS_TASKS.excelDraft || "excel_draft";

const SESSION_TOKEN_KEY = "sso_session_token";
const DISPLAY_NAME_CACHE_KEY = DS_STORAGE.displayNameCacheKey || "ds_chatbot_last_display_name_v1";
const DISPLAY_NAME_CACHE_TTL_MS = Number(DS_STORAGE.displayNameCacheTtlMs || 7 * 24 * 60 * 60 * 1000);
const LOCAL_HISTORY_PREFIX = "ds_one_platform_recent_messages_v1_";
const MAX_HISTORY = 10;

const ALLOWED_EXTENSIONS = (DS_FILE_POLICY.allowedExtensions || ["txt", "md", "csv", "json", "docx", "xlsx", "pptx", "pdf"])
  .map((value) => String(value || "").toLowerCase().replace(/^\./, ""))
  .filter(Boolean);
const BLOCKED_EXTENSIONS = new Set((DS_FILE_POLICY.blockedExtensions || ["exe", "dll", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "mjs", "jar", "sh", "php", "asp", "aspx", "jsp", "html", "htm", "xml", "doc", "xls", "ppt", "docm", "xlsm", "pptm", "hwp", "hwpx", "zip", "7z", "rar", "tar", "gz"])
  .map((value) => String(value || "").toLowerCase().replace(/^\./, ""))
  .filter(Boolean));
const MAX_FILE_SIZE_BYTES = Number(DS_FILE_POLICY.maxFileSizeBytes || 50 * 1024 * 1024);

let sessionToken = "";
let currentMode = "home";
let selectedFiles = [];
let submitInProgress = false;
let currentTask = "";
let activeMenuLabel = "홈";
let currentLoginId = "";
let currentEmpNo = "";

const body = document.body;
const homePanel = document.getElementById("homePanel");
const docPanel = document.getElementById("docPanel");
const stage = document.querySelector(".home-stage");
const fitTarget = document.querySelector("[data-fit-home]");
const homePromptInput = document.getElementById("homePromptInput");
const homeSendBtn = document.getElementById("homeSendBtn");
const homeAttachBtn = document.getElementById("homeAttachBtn");
const homeFileChips = document.getElementById("homeFileChips");
const fileInput = document.getElementById("platformFileInput");
const agentBody = document.getElementById("agentBody");
const agentForm = document.getElementById("agentForm");
const agentMessageInput = document.getElementById("agentMessageInput");
const agentSendBtn = document.getElementById("agentSendBtn");
const agentAttachBtn = document.getElementById("agentAttachBtn");
const agentFileChips = document.getElementById("agentFileChips");
const agentNewChatBtn = document.getElementById("agentNewChatBtn");
const docBackBtn = document.getElementById("docBackBtn");
const profileName = document.querySelector(".profile-button strong");
const profileAvatar = document.querySelector(".avatar");

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
  bootstrapProfile();
  bindUiEvents();
  restoreLocalHistory();
  resizePromptTextarea(homePromptInput);
  resizePromptTextarea(agentMessageInput);
  fitHomeToViewport();
  window.addEventListener("resize", () => {
    resizePromptTextarea(homePromptInput);
    resizePromptTextarea(agentMessageInput);
    fitHomeToViewport();
  });
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
  body.classList.add("is-iframe-launcher");
  const displayName = getDisplayName(profile) || getCachedDisplayName() || "DS ONE";
  const safeDisplayName = escapeHtml(displayName);
  const launcher = document.createElement("main");
  launcher.className = "iframe-launcher";
  launcher.innerHTML = `
    <button
      class="iframe-launch-button"
      type="button"
      title="DS ONE 업무 AI 플랫폼 새 탭 열기"
      aria-label="${safeDisplayName}님의 DS ONE 업무 AI 플랫폼을 새 탭에서 열기"
    >
      <span class="iframe-launch-newtab" aria-hidden="true">↗</span>
      <span class="iframe-launch-visual" aria-hidden="true">
        <span class="iframe-launch-orbit"></span>
        <span class="iframe-launch-people">
          <span></span><span></span><span></span>
        </span>
        <span class="iframe-launch-hand"></span>
      </span>
      <span class="iframe-launch-title">DS ONE</span>
      <span class="iframe-launch-subtitle">업무 AI</span>
    </button>
  `;
  document.body.appendChild(launcher);

  const openButton = launcher.querySelector(".iframe-launch-button");
  openButton?.addEventListener("click", () => {
    const targetUrl = buildPlatformOpenUrl();
    const popup = window.open(targetUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      const link = document.createElement("a");
      link.href = targetUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "iframe-launch-fallback";
      link.textContent = "DS ONE 업무 AI 열기 ↗";
      launcher.appendChild(link);
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

function decodeSessionTokenPayload(token) {
  if (!token) return null;
  try {
    const part = String(token).split(".")[0] || "";
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const json = decodeURIComponent(Array.from(atob(padded)).map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getDisplayName(profile) {
  if (!profile) return "";
  const candidates = [
    profile.userName,
    profile.user_name,
    profile.name,
    profile.displayName,
    profile.display_name,
    profile.empName,
    profile.empNm,
    profile.loginId,
    profile.login_id,
    profile.empNo,
    profile.emp_no,
  ];
  return candidates.map((value) => String(value || "").trim()).find((value) => value && value !== "undefined" && value !== "null") || "";
}

function applyHeaderProfile(profile) {
  const displayName = getDisplayName(profile);
  if (!displayName) return;
  if (profileName) profileName.textContent = displayName;
  if (profileAvatar) profileAvatar.textContent = displayName.slice(0, 1);
  cacheDisplayName(displayName);
}

async function bootstrapProfile() {
  if (!sessionToken) {
    showToast("그룹웨어 SSO 인증 후 이용해 주세요.");
    return;
  }
  try {
    const res = await fetch(AGENT_API_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      currentLoginId = data.loginId || data.login_id || currentLoginId;
      currentEmpNo = data.empNo || data.emp_no || data.rpaAuthEmpNo || currentEmpNo;
      applyHeaderProfile(data);
    }
  } catch {
    // 네트워크 또는 로컬 미리보기에서는 토큰 payload 표시만 유지합니다.
  }
}

function cacheDisplayName(displayName) {
  try {
    localStorage.setItem(DISPLAY_NAME_CACHE_KEY, JSON.stringify({ displayName, savedAt: Date.now() }));
  } catch {
  }
}

function getCachedDisplayName() {
  try {
    const raw = localStorage.getItem(DISPLAY_NAME_CACHE_KEY);
    if (!raw) return "";
    const data = JSON.parse(raw);
    if (Date.now() - Number(data.savedAt || 0) > DISPLAY_NAME_CACHE_TTL_MS) return "";
    return String(data.displayName || "").trim();
  } catch {
    return "";
  }
}

function restoreCachedDisplayName() {
  const cached = getCachedDisplayName();
  if (cached) applyHeaderProfile({ displayName: cached });
}

function bindUiEvents() {
  document.querySelectorAll(".menu-item").forEach((button) => {
    const label = button.textContent.trim();
    if (label.includes("새 대화")) {
      button.addEventListener("click", () => {
        activeMenuLabel = "새 대화";
        startNewConversation();
        setMode("doc");
      });
    } else if (label.includes("문서")) {
      button.addEventListener("click", () => {
        activeMenuLabel = "문서 파일";
        setMode("doc");
        fileInput?.click();
      });
    } else if (label.includes("에이전트")) {
      button.addEventListener("click", () => {
        activeMenuLabel = "에이전트";
        setMode("doc");
      });
    } else if (label.includes("홈")) {
      button.addEventListener("click", () => {
        activeMenuLabel = "홈";
        setMode("home");
      });
    } else {
      button.addEventListener("click", () => showToast("해당 기능은 추후 연동 예정입니다."));
    }
  });

  document.querySelectorAll(".action-card").forEach((card) => {
    card.addEventListener("click", () => {
      activeMenuLabel = "에이전트";
      const template = card.getAttribute("data-template") || "";
      currentTask = card.getAttribute("data-task") || "";
      setMode("doc");
      if (template) setAgentInput(template);
      if (currentTask === "excel_analysis" || currentTask === "file_question") {
        fileInput?.click();
      }
    });
  });

  homeAttachBtn?.addEventListener("click", () => fileInput?.click());
  agentAttachBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    addFiles(fileInput.files || []);
    fileInput.value = "";
  });

  homeSendBtn?.addEventListener("click", () => submitFromHome());
  homePromptInput?.addEventListener("input", () => {
    resizePromptTextarea(homePromptInput);
    fitHomeToViewport();
  });
  homePromptInput?.addEventListener("keydown", (event) => {
    if (!isPlainEnterSubmitEvent(event)) return;
    event.preventDefault();
    submitFromHome();
  });

  docBackBtn?.addEventListener("click", () => setMode("home"));
  agentNewChatBtn?.addEventListener("click", startNewConversation);

  agentBody?.addEventListener("click", (event) => {
    const button = event.target.closest(".agent-suggestion-btn");
    if (!button) return;
    setAgentInput(button.getAttribute("data-template") || "");
  });

  agentMessageInput?.addEventListener("input", () => resizePromptTextarea(agentMessageInput));
  agentMessageInput?.addEventListener("keydown", (event) => {
    if (!isPlainEnterSubmitEvent(event)) return;
    event.preventDefault();
    handleAgentSubmit();
  });

  agentForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleAgentSubmit();
  });

  document.querySelectorAll(".guide-button, .sidebar-guide-button, .header-button").forEach((button) => {
    button.addEventListener("click", () => showToast("사용 가이드는 추후 연동 예정입니다."));
  });

  document.querySelectorAll(".recent-item, .task-row").forEach((item) => {
    item.addEventListener("click", () => showToast("최근 작업 복원은 추후 연동 예정입니다."));
  });
}

function setMode(mode) {
  currentMode = mode;
  homePanel?.classList.toggle("active", mode === "home");
  docPanel?.classList.toggle("active", mode === "doc");
  if (homePanel) homePanel.hidden = mode !== "home";
  if (docPanel) docPanel.hidden = mode !== "doc";
  document.querySelectorAll(".menu-item").forEach((button) => {
    const text = button.textContent.trim();
    button.classList.toggle("is-active", text.includes(activeMenuLabel));
  });
  if (mode === "doc") {
    window.setTimeout(() => agentMessageInput?.focus(), 60);
  } else {
    window.setTimeout(fitHomeToViewport, 60);
  }
}

function submitFromHome() {
  activeMenuLabel = "에이전트";
  const message = String(homePromptInput?.value || "").trim();
  if (!message && !selectedFiles.length) {
    homePromptInput?.focus();
    return;
  }
  setMode("doc");
  if (message) setAgentInput(message);
  homePromptInput.value = "";
  resizePromptTextarea(homePromptInput);
  handleAgentSubmit();
}

function setAgentInput(value) {
  if (!agentMessageInput) return;
  agentMessageInput.value = String(value || "");
  resizePromptTextarea(agentMessageInput);
  window.setTimeout(() => agentMessageInput.focus(), 30);
}

function startNewConversation() {
  selectedFiles = [];
  renderFileChips();
  clearMessages();
  agentMessageInput.value = "";
  resizePromptTextarea(agentMessageInput);
  sessionStorage.removeItem(getLocalHistoryKey());
  showToast("새 대화를 시작했습니다.");
}

function clearMessages() {
  if (!agentBody) return;
  agentBody.querySelectorAll(".chat-row, .thinking-row").forEach((node) => node.remove());
  const emptyCard = agentBody.querySelector(".agent-empty-card");
  if (emptyCard) emptyCard.hidden = false;
}

function hasMessages() {
  return Boolean(agentBody?.querySelector(".chat-row"));
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
  const containers = [agentFileChips, homeFileChips].filter(Boolean);
  containers.forEach((container) => {
    container.innerHTML = "";
    container.hidden = selectedFiles.length === 0;
    selectedFiles.forEach((file, index) => {
      const chip = document.createElement("span");
      chip.className = "file-chip";
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
  const message = String(agentMessageInput?.value || "").trim();
  if (!message && !selectedFiles.length) {
    agentMessageInput?.focus();
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
  agentMessageInput.value = "";
  resizePromptTextarea(agentMessageInput);

  const thinking = addThinkingMessage(selectedFiles.length ? "파일을 분석하고 있습니다..." : "답변을 작성하고 있습니다...");

  try {
    const history = getRecentHistory();
    const data = selectedFiles.length
      ? await requestFileAnalysis(userText, history)
      : await requestAgentAnswer(userText, history);

    thinking.remove();
    const answer = extractAnswerText(data);
    addMessage("bot", answer || "답변을 생성하지 못했습니다.");
    saveLocalHistory(userText, answer || "");
  } catch (error) {
    thinking.remove();
    addMessage("bot", "업무 AI Agent 처리 중 오류가 발생했습니다.\n" + getErrorMessage(error));
  } finally {
    submitInProgress = false;
    setComposerDisabled(false);
    agentMessageInput?.focus();
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      message,
      stream: false,
      task: normalizeTask(currentTask),
      history,
    }),
  });
  return readApiResponse(res);
}

async function requestFileAnalysis(message, history) {
  const formData = new FormData();
  formData.append("message", message);
  formData.append("stream", "false");
  formData.append("history", JSON.stringify(history));
  if (normalizeTask(currentTask)) formData.append("task", normalizeTask(currentTask));
  selectedFiles.forEach((file) => formData.append("files", file, file.name));

  const res = await fetch(FILE_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionToken}` },
    body: formData,
  });
  return readApiResponse(res);
}

async function readApiResponse(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, message: text };
  }
  if (!res.ok) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data;
}

function normalizeTask(task) {
  const value = String(task || "").trim();
  if (!value) return "";
  if (value === "excel_analysis" || value === "file_question" || value === "document_draft") return "";
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
  if (!agentBody) return null;
  const emptyCard = agentBody.querySelector(".agent-empty-card");
  if (emptyCard) emptyCard.hidden = true;

  const row = document.createElement("div");
  row.className = role === "user" ? "chat-row user-row" : "chat-row bot-row";

  if (role === "bot") {
    const avatar = document.createElement("span");
    avatar.className = "chat-avatar";
    avatar.textContent = "AI";
    row.appendChild(avatar);
  }

  const msg = document.createElement("div");
  msg.className = `msg ${role === "user" ? "user" : "bot"}`;
  if (role === "bot") {
    renderMessageContent(msg, text);
  } else {
    msg.textContent = text;
  }
  row.appendChild(msg);

  if (role === "bot") addCopyButton(row, msg);
  agentBody.appendChild(row);
  agentBody.scrollTop = agentBody.scrollHeight;
  return row;
}

function addThinkingMessage(text) {
  const row = document.createElement("div");
  row.className = "thinking-row bot-row";
  row.innerHTML = `<span class="chat-avatar">AI</span><div class="msg bot thinking"><span></span><span></span><span></span>${escapeHtml(text)}</div>`;
  agentBody.appendChild(row);
  agentBody.scrollTop = agentBody.scrollHeight;
  return row;
}

function renderMessageContent(container, text) {
  container.innerHTML = "";
  const normalized = normalizeAnswerText(text);
  const lines = normalized.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      container.appendChild(document.createElement("br"));
      continue;
    }
    if (isMarkdownTableStart(lines, i)) {
      const tableLines = [];
      while (i < lines.length && isMarkdownTableLine(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      i -= 1;
      appendMarkdownTable(container, tableLines);
      continue;
    }
    const div = document.createElement("div");
    const heading = line.match(/^\s*(결론|요약|분석 결과|파일 구조 요약|핵심 이슈|우선 조치|기준 및 근거|확인 필요|다음 조치)\s*:?\s*$/);
    if (heading) {
      div.className = "msg-heading";
      div.textContent = heading[1];
    } else if (/^\s*[-•]\s+/.test(line)) {
      div.className = "msg-bullet";
      div.textContent = line.replace(/^\s*[-•]\s+/, "• ");
    } else {
      div.className = "msg-line";
      appendInlineMarkdown(div, line);
    }
    container.appendChild(div);
  }
}

function normalizeAnswerText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/기준\s*\/\s*근거/g, "기준 및 근거")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isMarkdownTableLine(line) {
  return /^\s*\|.+\|\s*$/.test(String(line || ""));
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ""));
}

function isMarkdownTableStart(lines, index) {
  return isMarkdownTableLine(lines[index]) && isMarkdownTableSeparator(lines[index + 1] || "");
}

function parseTableRow(line) {
  return String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function appendMarkdownTable(container, tableLines) {
  const wrap = document.createElement("div");
  wrap.className = "msg-table-wrap";
  const toolbar = document.createElement("div");
  toolbar.className = "msg-table-toolbar";
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
  scroll.className = "msg-table-scroll";
  const table = document.createElement("table");
  table.className = "msg-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  parseTableRow(tableLines[0]).forEach((cell) => {
    const th = document.createElement("th");
    appendInlineMarkdown(th, cell);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  tableLines.slice(2).forEach((line) => {
    if (!isMarkdownTableLine(line) || isMarkdownTableSeparator(line)) return;
    const tr = document.createElement("tr");
    parseTableRow(line).forEach((cell) => {
      const td = document.createElement("td");
      appendInlineMarkdown(td, cell);
      tr.appendChild(td);
    });
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
    if (match[2]) {
      const strong = document.createElement("strong");
      strong.textContent = match[2];
      parent.appendChild(strong);
    } else if (match[3]) {
      const code = document.createElement("code");
      code.textContent = match[3];
      parent.appendChild(code);
    }
    last = regex.lastIndex;
  }
  if (last < value.length) parent.appendChild(document.createTextNode(value.slice(last)));
}

function addCopyButton(row, msg) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bot-copy-btn";
  button.textContent = "복사";
  button.addEventListener("click", async () => {
    const ok = await copyToClipboard(msg.textContent || "");
    button.textContent = ok ? "복사 완료" : "복사 실패";
    setTimeout(() => { button.textContent = "복사"; }, 1200);
  });
  row.appendChild(button);
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
  }
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
  } catch {
    return false;
  }
}

function getLocalHistoryKey() {
  const userKey = currentEmpNo || currentLoginId || "anonymous";
  return LOCAL_HISTORY_PREFIX + String(userKey).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function getRecentHistory() {
  try {
    const raw = sessionStorage.getItem(getLocalHistoryKey());
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.slice(-MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(userText, assistantText) {
  try {
    const history = getRecentHistory();
    history.push({ role: "user", text: userText });
    if (assistantText) history.push({ role: "assistant", text: assistantText });
    sessionStorage.setItem(getLocalHistoryKey(), JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
  }
}

function restoreLocalHistory() {
  const history = getRecentHistory();
  if (!history.length) return;
  history.forEach((message) => addMessage(message.role === "user" ? "user" : "bot", message.text || ""));
}

function setComposerDisabled(disabled) {
  if (agentMessageInput) agentMessageInput.disabled = disabled;
  if (agentSendBtn) agentSendBtn.disabled = disabled;
  if (agentAttachBtn) agentAttachBtn.disabled = disabled;
  if (homeSendBtn) homeSendBtn.disabled = disabled;
}

function isPlainEnterSubmitEvent(event) {
  if (!event || event.key !== "Enter") return false;
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.shiftKey) return false;
  return true;
}

function resizePromptTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const maxHeight = Math.min(window.innerHeight * 0.28, 180);
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function fitHomeToViewport() {
  if (!stage || !fitTarget || currentMode !== "home") return;
  fitTarget.style.setProperty("--home-scale", "1");
  const stageStyle = getComputedStyle(stage);
  const availableHeight = stage.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom);
  const availableWidth = stage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
  const scale = Math.max(0.48, Math.min(1, availableHeight / fitTarget.scrollHeight, availableWidth / fitTarget.scrollWidth));
  fitTarget.style.setProperty("--home-scale", Number.isFinite(scale) ? scale.toFixed(3) : "1");
}

function showToast(message) {
  const existing = document.querySelector(".toast");
  existing?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  }, 1800);
}

function formatFileSize(size) {
  const value = Number(size || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "알 수 없는 오류");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

init();
