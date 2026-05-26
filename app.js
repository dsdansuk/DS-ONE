// DS Chatbot Frontend - 운영 분리 구조용 app.js
// GitHub Pages: https://dsdansuk.github.io/DS-chatbot/
// Edge Functions:
// - sso-login: 그룹웨어 SSO 진입 및 토큰 발급
// - ai-api: 사내 AI / SideTalk 호출
// - rpa-api: UiPath RPA 호출

const AI_API_URL =
  "https://anucqzffvxyxwdnafacr.supabase.co/functions/v1/ai-api";

const RPA_API_URL =
  "https://anucqzffvxyxwdnafacr.supabase.co/functions/v1/rpa-api";

let sessionToken = sessionStorage.getItem("sso_session_token") || "";
let currentMode = "ai";
let thinkingTimer = null;
let rpaLoaded = false;

let selectedRpaItem = null;
let runningRpaName = "";
let rpaRunInProgress = false;

const aiBtn = document.getElementById("aiBtn");
const rpaBtn = document.getElementById("rpaBtn");
const aiPanel = document.getElementById("aiPanel");
const rpaPanel = document.getElementById("rpaPanel");
const aiBody = document.getElementById("aiBody");
const rpaBody = document.getElementById("rpaBody");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const reloadRpaBtn = document.getElementById("reloadRpaBtn");
const userInfo = document.getElementById("userInfo");

bootstrap();

async function bootstrap() {
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
    disableApp();
    return;
  }

  try {
    const me = await apiJson(AI_API_URL, { method: "GET" });
    if (!me.ok) throw new Error(me.message || "인증 확인 실패");
    userInfo.textContent = "사번: " + me.empNo + " / 로그인ID: " + me.loginId;
    enableApp();
  } catch (err) {
    sessionStorage.removeItem("sso_session_token");
    sessionToken = "";
    userInfo.textContent = "인증 실패: " + getErrorMessage(err);
    disableApp();
  }
}

function enableApp() {
  messageInput.disabled = false;
  sendBtn.disabled = false;
  reloadRpaBtn.disabled = false;
}

function disableApp() {
  messageInput.disabled = true;
  sendBtn.disabled = true;
  reloadRpaBtn.disabled = true;
}

function setMode(mode) {
  currentMode = mode;
  aiBtn.classList.toggle("active", mode === "ai");
  rpaBtn.classList.toggle("active", mode === "rpa");
  aiPanel.classList.toggle("active", mode === "ai");
  rpaPanel.classList.toggle("active", mode === "rpa");

  if (mode === "rpa" && !rpaLoaded) loadRpaList();
  if (mode === "ai") messageInput.focus();
}

function addMessage(targetBody, type, text, debug = false) {
  const div = document.createElement("div");
  div.className = debug ? "msg bot debug" : "msg " + type;
  div.textContent = text;
  targetBody.appendChild(div);
  targetBody.scrollTop = targetBody.scrollHeight;
  return div;
}

function clearBody(targetBody) {
  targetBody.innerHTML = "";
}

function createThinkingBox() {
  const steps = ["질문을 이해하는 중", "관련 내용을 확인하는 중", "답변을 정리하는 중", "곧 답변드릴게요"];
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
  aiBody.appendChild(wrap);
  aiBody.scrollTop = aiBody.scrollHeight;

  let current = 0;
  thinkingTimer = setInterval(() => {
    const items = Array.from(list.querySelectorAll("li"));
    items.forEach((li, idx) => {
      li.classList.toggle("done", idx < current);
      li.classList.toggle("active", idx === current);
    });
    current = Math.min(current + 1, steps.length - 1);
    aiBody.scrollTop = aiBody.scrollHeight;
  }, 900);

  return wrap;
}

function removeThinkingBox(box) {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
  if (box) box.remove();
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
  if (!text.includes("data:")) return text;

  let output = "";
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const data = JSON.parse(payload);
      output += data.chunk || data.message?.content || data.delta?.content || data.choices?.[0]?.delta?.content || data.choices?.[0]?.message?.content || data.answer || data.content || data.text || "";
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
    data = { ok: false, message: text || "JSON 파싱 실패" };
  }

  if (!res.ok) throw new Error(data.message || data.raw || "HTTP " + res.status);
  return data;
}

async function loadRpaList() {
  selectedRpaItem = null;
  rpaLoaded = false;
  clearBody(rpaBody);
  addMessage(rpaBody, "bot", "RPA 목록을 불러오는 중입니다.");

  try {
    const data = await apiJson(RPA_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "list" }),
    });

    if (!data.ok) {
      addMessage(rpaBody, "bot", "RPA 목록 조회 실패\n" + (data.raw || data.message || JSON.stringify(data, null, 2)), true);
      return;
    }

    if (!data.releases || data.releases.length === 0) {
      clearBody(rpaBody);
      addMessage(rpaBody, "bot", "RPA 목록이 비어 있습니다. 아래 디버그 정보를 확인하세요.");
      addMessage(rpaBody, "bot", JSON.stringify(data.debug || data, null, 2), true);
      return;
    }

    renderRpaList(data.releases || []);
    rpaLoaded = true;
  } catch (err) {
    addMessage(rpaBody, "bot", "RPA 목록 조회 중 오류 발생: " + getErrorMessage(err));
  }
}

function renderRpaList(releases) {
  clearBody(rpaBody);
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

    btn.innerHTML = '<div class="rpa-name">' + escapeHtml(name) + "</div>";
    btn.addEventListener("click", () => selectRpaJob({ name, releaseKey, folderId, source }));
    wrap.appendChild(btn);
  });

  rpaBody.appendChild(wrap);
  renderRpaActionPanel();
  rpaBody.scrollTop = rpaBody.scrollHeight;
}

function selectRpaJob(item) {
  selectedRpaItem = item;

  const buttons = Array.from(rpaBody.querySelectorAll(".rpa-item"));
  buttons.forEach((btn) => {
    const title = btn.querySelector(".rpa-name")?.textContent || "";
    btn.classList.toggle("selected", title === item.name);
  });

  renderRpaActionPanel();
}

function cancelSelectedRpaJob() {
  selectedRpaItem = null;
  clearRpaSelectionStyle();
  renderRpaActionPanel();
}

function renderRpaActionPanel() {
  const oldPanel = document.getElementById("rpaActionPanel");
  if (oldPanel) oldPanel.remove();

  const panel = document.createElement("div");
  panel.id = "rpaActionPanel";
  panel.className = "rpa-action-panel";

  let html = "";

  if (runningRpaName) {
    html +=
      '<div class="rpa-status running">' +
      '<div class="rpa-status-label">실행 중인 작업:</div>' +
      '<div class="rpa-status-value">' + escapeHtml(runningRpaName) + "</div>" +
      "</div>";
  }

  html +=
    '<div class="rpa-status selected-job">' +
    '<div class="rpa-status-label">선택된 작업:</div>' +
    '<div class="rpa-status-value">' + (selectedRpaItem ? escapeHtml(selectedRpaItem.name) : "없음") + "</div>" +
    "</div>" +
    '<div class="rpa-action-buttons">' +
    '<button id="runSelectedRpaBtn" class="rpa-run-btn" type="button">' + (rpaRunInProgress ? "실행 요청 중..." : "실행") + "</button>" +
    '<button id="cancelSelectedRpaBtn" class="rpa-cancel-btn" type="button">취소</button>' +
    "</div>";

  panel.innerHTML = html;
  rpaBody.appendChild(panel);

  const runBtn = document.getElementById("runSelectedRpaBtn");
  const cancelBtn = document.getElementById("cancelSelectedRpaBtn");

  if (runBtn) {
    runBtn.disabled = !selectedRpaItem || rpaRunInProgress;
    runBtn.addEventListener("click", () => {
      if (selectedRpaItem) runRpaJob(selectedRpaItem);
    });
  }

  if (cancelBtn) {
    cancelBtn.disabled = !selectedRpaItem || rpaRunInProgress;
    cancelBtn.addEventListener("click", cancelSelectedRpaJob);
  }
}

async function runRpaJob(item) {
  if (!item) return;

  if (!item.releaseKey || !item.folderId) {
    addMessage(rpaBody, "bot", "RPA 실행에 필요한 ReleaseKey 또는 Folder ID가 없습니다.", true);
    return;
  }

  rpaRunInProgress = true;
  runningRpaName = item.name;
  renderRpaActionPanel();

  addMessage(rpaBody, "user", item.name + " 실행 요청");
  addMessage(rpaBody, "bot", item.name + " 실행 요청 중입니다.");

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
      addMessage(rpaBody, "bot", item.name + " 실행 요청이 완료되었습니다.");
      selectedRpaItem = null;
      clearRpaSelectionStyle();

      setTimeout(() => {
        if (runningRpaName === item.name) {
          runningRpaName = "";
          renderRpaActionPanel();
        }
      }, 30000);
    } else {
      addMessage(rpaBody, "bot", "RPA 실행 실패\n" + (data.raw || data.message || JSON.stringify(data, null, 2)), true);
      runningRpaName = "";
    }
  } catch (err) {
    addMessage(rpaBody, "bot", "RPA 실행 중 오류 발생: " + getErrorMessage(err));
    runningRpaName = "";
  } finally {
    rpaRunInProgress = false;
    renderRpaActionPanel();
    rpaBody.scrollTop = rpaBody.scrollHeight;
  }
}

function clearRpaSelectionStyle() {
  const buttons = Array.from(rpaBody.querySelectorAll(".rpa-item"));
  buttons.forEach((btn) => btn.classList.remove("selected"));
}

async function sendChat(message) {
  const thinkingBox = createThinkingBox();

  try {
    const res = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + sessionToken,
      },
      body: JSON.stringify({ message, stream: true }),
    });

    removeThinkingBox(thinkingBox);

    if (!res.ok) {
      const errorText = await res.text();
      addMessage(aiBody, "bot", "AI API 오류가 발생했습니다.\nHTTP " + res.status + "\n" + errorText, true);
      return;
    }

    if (!res.body) {
      addMessage(aiBody, "bot", "스트림 응답 본문이 없습니다.");
      return;
    }

    const botDiv = addMessage(aiBody, "bot", "");
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      console.log("SIDETALK STREAM CHUNK:", chunk);
      buffer += chunk;

      if (buffer.includes("\n\n") || buffer.includes("data: [DONE]") || !buffer.includes("data:")) {
        const parsed = parseStreamText(buffer);
        if (parsed) {
          fullText += parsed;
          botDiv.textContent = fullText;
          aiBody.scrollTop = aiBody.scrollHeight;
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
    }

    if (!fullText.trim()) {
      botDiv.textContent = "답변 데이터는 수신했지만 화면에 표시할 텍스트를 찾지 못했습니다.";
    }
  } catch (err) {
    removeThinkingBox(thinkingBox);
    addMessage(aiBody, "bot", "호출 실패: " + getErrorMessage(err));
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

aiBtn.addEventListener("click", () => setMode("ai"));
rpaBtn.addEventListener("click", () => setMode("rpa"));
reloadRpaBtn.addEventListener("click", () => {
  selectedRpaItem = null;
  rpaLoaded = false;
  loadRpaList();
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (currentMode !== "ai") return;

  const message = messageInput.value.trim();
  if (!message) return;

  addMessage(aiBody, "user", message);
  messageInput.value = "";
  sendBtn.disabled = true;
  await sendChat(message);
});
