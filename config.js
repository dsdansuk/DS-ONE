// DS ONE frontend runtime configuration.
// 운영 환경 값은 이 파일에서만 관리하고 app.js는 기능 로직만 담당합니다.
window.DS_ONE_CONFIG = Object.freeze({
  endpoints: Object.freeze({
    aiApi: "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/ai-api",
    agentApi: "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/agent-api",
    fileApi: "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/file-api",
    rpaApi: "https://kqqfvskmozjalmairjxa.supabase.co/functions/v1/rpa-api",
  }),
  tasks: Object.freeze({
    pptDraft: "ppt_draft",
    excelDraft: "excel_draft",
    webSearch: "web_search",
  }),
  storage: Object.freeze({
    chatHistoryTtlMs: 60 * 60 * 1000,
    chatHistoryPrefix: "ds_chatbot_ai_history_v1_",
    authCachePrefix: "ds_chatbot_auth_cache_v1_",
    authCacheTtlMs: 10 * 60 * 1000,
    displayNameCacheKey: "ds_chatbot_last_display_name_v1",
    displayNameCacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    agentHistoryCachePrefix: "ds_one_agent_history_v1_",
    agentHistoryCacheTtlMs: 60 * 60 * 1000,
    agentHistoryCacheMaxMessages: 20,
  }),
  ui: Object.freeze({
    defaultHomeGreeting: "필요한 업무를 선택해 주세요",
    rpaStatusPollIntervalMs: 30 * 1000,
    rpaStatusPollMaxMs: 10 * 60 * 1000,
    agentRecentSessionsMax: 20,
    agentRecentRefreshDebounceMs: 350,
  }),
  filePolicy: Object.freeze({
    allowedExtensions: Object.freeze(["txt", "md", "csv", "json", "docx", "xlsx", "pptx"]),
    blockedExtensions: Object.freeze(["exe", "dll", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "mjs", "jar", "sh", "php", "asp", "aspx", "jsp", "html", "htm", "xml", "doc", "xls", "ppt", "docm", "xlsm", "pptm", "hwp", "hwpx", "zip", "7z", "rar", "tar", "gz", "png", "jpg", "jpeg", "webp"]),
    maxFileSizeBytes: 50 * 1024 * 1024,
  }),
});
