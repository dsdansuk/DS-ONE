(() => {
  "use strict";

  // DS ONE Safe Function Layer
  // 목적: 기존 메인 HTML/CSS 화면은 건드리지 않고 기능만 연결합니다.
  // - 초기 화면에서 기존 DOM 배치/스타일을 변경하지 않습니다.
  // - iframe 안에서만 108x108 런처 버튼으로 body를 대체합니다.
  // - open=platform 파라미터는 새 탭 진입 신호로만 처리하고, 화면 모드는 바꾸지 않습니다.

  const CONFIG = window.DS_ONE_CONFIG || {};
  const ENDPOINTS = CONFIG.endpoints || {};
  const STORAGE = CONFIG.storage || {};
  const FILE_POLICY = CONFIG.filePolicy || {};

  const AGENT_API_URL = ENDPOINTS.agentApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/agent-api";
  const FILE_API_URL = ENDPOINTS.fileApi || "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/file-api";
  const SESSION_TOKEN_KEY = "sso_session_token";
  const DISPLAY_NAME_CACHE_KEY = STORAGE.displayNameCacheKey || "ds_chatbot_last_display_name_v1";
  const DISPLAY_NAME_CACHE_TTL_MS = Number(STORAGE.displayNameCacheTtlMs || 7 * 24 * 60 * 60 * 1000);

  const ALLOWED_EXTENSIONS = (FILE_POLICY.allowedExtensions || ["txt", "md", "csv", "json", "docx", "xlsx", "pptx", "pdf"])
    .map((value) => String(value || "").toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  const BLOCKED_EXTENSIONS = new Set((FILE_POLICY.blockedExtensions || ["exe", "dll", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "mjs", "jar", "sh", "php", "asp", "aspx", "jsp", "html", "htm", "xml", "doc", "xls", "ppt", "docm", "xlsm", "pptm", "hwp", "hwpx", "zip", "7z", "rar", "tar", "gz", "png", "jpg", "jpeg", "webp"])
    .map((value) => String(value || "").toLowerCase().replace(/^\./, ""))
    .filter(Boolean));
  const MAX_FILE_SIZE_BYTES = Number(FILE_POLICY.maxFileSizeBytes || 50 * 1024 * 1024);

  let sessionToken = "";
  let selectedFiles = [];
  let submitInProgress = false;
  let currentTask = "";

  function init() {
    sessionToken = readSsoSessionToken();
    const tokenProfile = decodeSessionTokenPayload(sessionToken);

    if (isEmbeddedInIframe()) {
      showIframeLauncher(tokenProfile);
      return;
    }

    restoreCachedDisplayName();
    if (tokenProfile) applyHeaderProfile(tokenProfile);
    bootstrapProfile();
    bindExistingUiOnly();
  }

  function readSsoSessionToken() {
    const url = new URL(window.location.href);
    const tokenFromUrl = String(url.searchParams.get("token") || "").trim();
    if (tokenFromUrl) sessionStorage.setItem(SESSION_TOKEN_KEY, tokenFromUrl);

    // token/open은 진입 후 주소창에서 제거합니다. 화면 모드 전환 용도로 사용하지 않습니다.
    if (tokenFromUrl || url.searchParams.has("open") || url.searchParams.has("launcher")) {
      url.searchParams.delete("token");
      url.searchParams.delete("open");
      url.searchParams.delete("launcher");
      window.history.replaceState({}, document.title, url.toString());
    }
    return tokenFromUrl || sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
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

    document.documentElement.style.cssText = "width:108px;height:108px;margin:0;overflow:hidden;background:transparent;";
    document.body.style.cssText = "width:108px;height:108px;min-width:0;margin:0;overflow:hidden;background:transparent;";
    document.body.innerHTML = `
      <button id="dsOneOpenButton" type="button" aria-label="DS ONE 업무 AI 새 탭 열기" title="DS ONE 업무 AI 새 탭 열기" style="position:relative;width:108px;height:108px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:10px 8px;border:0;border-radius:22px;color:#fff;background:linear-gradient(145deg,#8ea7ff 0%,#6f87f7 54%,#5f7ff1 100%);box-shadow:0 12px 24px rgba(40,76,190,.24),inset 0 1px 0 rgba(255,255,255,.28);cursor:pointer;overflow:hidden;font-family:Pretendard,'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;">
        <span aria-hidden="true" style="position:absolute;inset:-38px auto auto -42px;width:110px;height:110px;border-radius:999px;background:rgba(255,255,255,.14);"></span>
        <span aria-hidden="true" style="position:relative;z-index:1;width:34px;height:34px;display:grid;place-items:center;">
          <svg viewBox="0 0 48 48" focusable="false" style="width:34px;height:34px;display:block;">
            <path d="M24 5 40.5 14.5v19L24 43 7.5 33.5v-19L24 5Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"></path>
            <path d="M24 13.5 33.2 18.8v10.4L24 34.5l-9.2-5.3V18.8L24 13.5Z" fill="currentColor" opacity=".92"></path>
          </svg>
        </span>
        <span style="position:relative;z-index:1;display:grid;gap:0;text-align:center;line-height:1.04;text-shadow:0 2px 7px rgba(22,43,120,.18);">
          <strong style="font-size:16px;font-weight:900;letter-spacing:-.02em;">DS ONE</strong>
          <em style="font-style:normal;font-size:13px;font-weight:850;letter-spacing:-.03em;">업무 AI</em>
        </span>
        <span aria-hidden="true" style="position:absolute;right:8px;top:7px;z-index:1;font-size:13px;font-weight:900;opacity:.9;">↗</span>
      </button>
    `;

    document.getElementById("dsOneOpenButton")?.addEventListener("click", () => {
      const popup = window.open(targetUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        document.body.innerHTML = `<a href="${escapeAttribute(targetUrl)}" target="_blank" rel="noopener noreferrer" style="width:108px;height:108px;display:grid;place-items:center;padding:10px;text-align:center;color:#fff;background:#5f7ff1;border-radius:22px;text-decoration:none;font:800 13px/1.35 Pretendard,'Noto Sans KR','Malgun Gothic',sans-serif;">${escapeHtml(displayName)}님<br>새 탭으로 열기</a>`;
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

  function bindExistingUiOnly() {
    const promptTextarea = document.querySelector(".prompt-card textarea");
    const sendButton = document.querySelector(".prompt-card .send-btn");
    const attachButton = document.querySelector(".prompt-card .icon-btn");
    const fileInput = ensureHiddenFileInput();

    attachButton?.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      addFiles(fileInput.files || []);
      fileInput.value = "";
      updateAttachButtonTitle(attachButton);
    });

    sendButton?.addEventListener("click", () => submitPrompt(promptTextarea));
    promptTextarea?.addEventListener("keydown", (event) => {
      if (!isPlainEnterSubmitEvent(event)) return;
      event.preventDefault();
      submitPrompt(promptTextarea);
    });

    document.querySelectorAll(".action-card").forEach((card) => {
      card.addEventListener("click", () => {
        const meta = getCardTemplate(card);
        currentTask = meta.task;
        if (promptTextarea && meta.template) {
          promptTextarea.value = meta.template;
          promptTextarea.dispatchEvent(new Event("input", { bubbles: true }));
          promptTextarea.focus();
        }
        if (meta.attach) fileInput.click();
      });
    });

    document.querySelectorAll(".menu-item,.sidebar-guide-button,.header-button,.recent-item,.guide-button,.task-row,.text-button,.more-btn").forEach((el) => {
      el.addEventListener("click", (event) => {
        const text = String(el.textContent || "").trim();
        if (text.includes("새 대화")) {
          selectedFiles = [];
          currentTask = "";
          if (promptTextarea) promptTextarea.value = "";
          updateAttachButtonTitle(attachButton);
          showToast("새 대화를 시작했습니다.");
          return;
        }
        if (text.includes("채팅 검색") || text.includes("즐겨찾기") || text.includes("휴지통") || text.includes("사용 가이드") || text.includes("도움말")) {
          event.preventDefault();
          showToast("해당 기능은 추후 연동 예정입니다.");
        }
      });
    });
  }

  function ensureHiddenFileInput() {
    let input = document.getElementById("dsOneHiddenFileInput");
    if (input) return input;
    input = document.createElement("input");
    input.id = "dsOneHiddenFileInput";
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    input.accept = ".txt,.md,.csv,.json,.docx,.xlsx,.pptx,.pdf";
    document.body.appendChild(input);
    return input;
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
    if (rejected.length) showToast(rejected[0]);
    else if (selectedFiles.length) showToast(`${selectedFiles.length}개 파일이 첨부되었습니다.`);
  }

  function updateAttachButtonTitle(button) {
    if (!button) return;
    button.title = selectedFiles.length ? selectedFiles.map((file) => file.name).join("\n") : "파일 첨부";
    button.setAttribute("aria-label", selectedFiles.length ? `첨부 파일 ${selectedFiles.length}개` : "파일 첨부");
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

  async function submitPrompt(textarea) {
    if (submitInProgress) return;
    const message = String(textarea?.value || "").trim();
    if (!message && !selectedFiles.length) {
      textarea?.focus();
      return;
    }

    if (!sessionToken) {
      showResultOverlay("업무 AI Agent", "그룹웨어 SSO 인증 정보가 없습니다. 그룹웨어 버튼을 통해 다시 접속해 주세요.");
      return;
    }

    submitInProgress = true;
    const overlay = showResultOverlay("업무 AI Agent", "답변을 준비하고 있습니다...");
    try {
      const data = selectedFiles.length
        ? await requestFileAnalysis(message || "첨부한 파일을 분석해 주세요.")
        : await requestAgentAnswer(message);
      const answer = extractAnswerText(data) || "답변을 생성하지 못했습니다.";
      setOverlayContent(overlay, answer);
      if (textarea) textarea.value = "";
      selectedFiles = [];
      updateAttachButtonTitle(document.querySelector(".prompt-card .icon-btn"));
    } catch (error) {
      setOverlayContent(overlay, "업무 AI Agent 처리 중 오류가 발생했습니다.\n" + getErrorMessage(error));
    } finally {
      submitInProgress = false;
    }
  }

  async function requestAgentAnswer(message) {
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
        history: [],
      }),
    });
    return readApiResponse(res);
  }

  async function requestFileAnalysis(message) {
    const formData = new FormData();
    formData.append("message", message);
    formData.append("stream", "false");
    formData.append("history", JSON.stringify([]));
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
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
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
    return String(data.answer || data.message || data.result || data.text || data.output || "").trim();
  }

  function showResultOverlay(title, content) {
    let overlay = document.getElementById("dsOneResultOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "dsOneResultOverlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.style.cssText = "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:rgba(15,23,42,.28);backdrop-filter:blur(3px);";
      overlay.innerHTML = `
        <section style="width:min(960px,calc(100vw - 48px));height:min(760px,calc(100dvh - 48px));display:grid;grid-template-rows:auto minmax(0,1fr);background:rgba(255,255,255,.98);border:1px solid #dfe7f2;border-radius:22px;box-shadow:0 26px 70px rgba(15,23,42,.24);overflow:hidden;font-family:Pretendard,'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;">
          <header style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 22px;border-bottom:1px solid #e7edf7;background:#fff;">
            <strong id="dsOneResultTitle" style="font-size:18px;font-weight:900;color:#151a24;">업무 AI Agent</strong>
            <button id="dsOneResultClose" type="button" style="width:36px;height:36px;display:grid;place-items:center;border:1px solid #dfe7f2;border-radius:10px;background:#f8fbff;color:#344052;font-size:22px;line-height:1;cursor:pointer;">×</button>
          </header>
          <div id="dsOneResultBody" style="min-height:0;padding:22px;overflow:auto;color:#263146;font-size:14px;line-height:1.75;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;"></div>
        </section>`;
      document.body.appendChild(overlay);
      overlay.querySelector("#dsOneResultClose")?.addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) overlay.remove();
      });
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") document.getElementById("dsOneResultOverlay")?.remove();
      });
    }
    overlay.querySelector("#dsOneResultTitle").textContent = title || "업무 AI Agent";
    setOverlayContent(overlay, content || "");
    return overlay;
  }

  function setOverlayContent(overlay, content) {
    const body = overlay?.querySelector("#dsOneResultBody");
    if (body) body.textContent = String(content || "");
  }

  async function bootstrapProfile() {
    if (!sessionToken) return;
    try {
      const res = await fetch(AGENT_API_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) applyHeaderProfile(data);
    } catch {
      // 프로필 조회 실패 시 토큰 payload 또는 캐시 이름만 유지합니다.
    }
  }

  function decodeSessionTokenPayload(token) {
    const body = String(token || "").split(".")[0];
    if (!body) return null;
    try {
      let base64 = body.replaceAll("-", "+").replaceAll("_", "/");
      while (base64.length % 4) base64 += "=";
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (payload.exp && Number(payload.exp) * 1000 < Date.now()) {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        return null;
      }
      return payload;
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
    const profileName = document.querySelector(".profile-button strong");
    const profileAvatar = document.querySelector(".avatar");
    if (profileName) profileName.textContent = displayName;
    if (profileAvatar) profileAvatar.textContent = displayName.slice(0, 1);
    cacheDisplayName(displayName);
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

  function showToast(message) {
    const previous = document.getElementById("dsOneToast");
    previous?.remove();
    const toast = document.createElement("div");
    toast.id = "dsOneToast";
    toast.textContent = String(message || "");
    toast.style.cssText = "position:fixed;left:50%;bottom:24px;z-index:10000;max-width:min(440px,calc(100vw - 32px));padding:12px 16px;color:#fff;background:rgba(21,26,36,.94);border-radius:999px;box-shadow:0 14px 36px rgba(0,0,0,.18);font:800 14px/1.35 Pretendard,'Noto Sans KR','Malgun Gothic',system-ui,sans-serif;transform:translateX(-50%);";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1900);
  }

  function isPlainEnterSubmitEvent(event) {
    if (!event || event.key !== "Enter") return false;
    if (event.isComposing || event.keyCode === 229) return false;
    if (event.shiftKey) return false;
    return true;
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

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  init();
})();
