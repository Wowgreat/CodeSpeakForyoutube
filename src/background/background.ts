import {
  DEFAULT_TRANSLATION_API_URL,
  DEVELOPMENT_TRANSLATION_API_URL_KEY,
  TRANSLATION_CACHE_KEY,
  TRANSLATION_MESSAGE_TYPE,
  type TranslationRequest,
  type TranslationResponse
} from "../shared/translation";
import {
  ANALYTICS_CLIENT_ID_KEY,
  ANALYTICS_LAST_ACTIVE_KEY,
  ANALYTICS_MESSAGE_TYPE,
  type AnalyticsEvent,
  type AnalyticsEventName
} from "../shared/analytics";

interface TranslationMessage {
  type: typeof TRANSLATION_MESSAGE_TYPE;
  payload: TranslationRequest;
}

interface CachedTranslation {
  translation: string;
  partOfSpeech?: string;
  phonetic?: string;
  savedAt: number;
}

interface BackendSuccess {
  ok: true;
  translation: string;
  partOfSpeech?: string;
  phonetic?: string;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isAnalyticsMessage(message)) {
    void sendAnalytics(message.payload);
    sendResponse({ ok: true });
    return false;
  }
  if (!isTranslationMessage(message)) return;

  void translate(message.payload.query)
    .then(sendResponse)
    .catch(() => {
      sendResponse({ ok: false, code: "NETWORK_ERROR", message: "扩展后台翻译失败" } satisfies TranslationResponse);
    });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void sendAnalytics({ name: "extension_installed" });
  void markActiveAndTrack();
});

chrome.runtime.onStartup.addListener(() => {
  void markActiveAndTrack();
});

async function translate(rawQuery: string): Promise<TranslationResponse> {
  const query = rawQuery.replace(/\s+/g, " ").trim();
  if (!query || query.length > 200) {
    return { ok: false, code: "INVALID_REQUEST", message: "查询内容必须为 1–200 个字符" };
  }

  const cacheKey = query.toLocaleLowerCase("en-US");
  const cached = await readCachedTranslation(cacheKey);
  if (cached) {
    const result: TranslationResponse = {
      ok: true,
      translation: cached.translation,
      ...(cached.partOfSpeech ? { partOfSpeech: cached.partOfSpeech } : {}),
      ...(cached.phonetic ? { phonetic: cached.phonetic } : {}),
      provider: "baidu-bce",
      cached: true
    };
    void sendAnalytics({ name: "translation_completed", params: { success: true, cached: true } });
    return result;
  }

  const endpoint = await getTranslationEndpoint();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8_000)
    });
    const payload: unknown = await response.json();

    if (!response.ok || !isBackendSuccess(payload)) {
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: getBackendError(payload) ?? `翻译服务请求失败（HTTP ${response.status}）`
      };
    }

    const translation = payload.translation.trim();
    const partOfSpeech = payload.partOfSpeech?.trim();
    const phonetic = payload.phonetic?.trim();
    await cacheTranslation(cacheKey, {
      translation,
      ...(partOfSpeech ? { partOfSpeech } : {}),
      ...(phonetic ? { phonetic } : {})
    });
    const result: TranslationResponse = {
      ok: true,
      translation,
      ...(partOfSpeech ? { partOfSpeech } : {}),
      ...(phonetic ? { phonetic } : {}),
      provider: "baidu-bce",
      cached: false
    };
    void sendAnalytics({ name: "translation_completed", params: { success: true, cached: false } });
    return result;
  } catch {
    void sendAnalytics({ name: "translation_completed", params: { success: false, cached: false } });
    return { ok: false, code: "NETWORK_ERROR", message: "百度智能云翻译代理连接超时或不可用" };
  }
}

interface AnalyticsMessage {
  type: typeof ANALYTICS_MESSAGE_TYPE;
  payload: AnalyticsEvent;
}

async function getTranslationEndpoint(): Promise<string> {
  const settings = await chrome.storage.local.get(DEVELOPMENT_TRANSLATION_API_URL_KEY);
  const override = settings[DEVELOPMENT_TRANSLATION_API_URL_KEY];
  return typeof override === "string" && isLocalDevelopmentEndpoint(override)
    ? override
    : DEFAULT_TRANSLATION_API_URL;
}

async function markActiveAndTrack(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await chrome.storage.local.get(ANALYTICS_LAST_ACTIVE_KEY);
  if (result[ANALYTICS_LAST_ACTIVE_KEY] === today) return;
  await chrome.storage.local.set({ [ANALYTICS_LAST_ACTIVE_KEY]: today });
  await sendAnalytics({ name: "extension_active" });
}

async function sendAnalytics(event: AnalyticsEvent): Promise<void> {
  const clientId = await getAnalyticsClientId();
  await fetch(DEFAULT_TRANSLATION_API_URL.replace("/api/translate", "/api/analytics"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, event }),
    signal: AbortSignal.timeout(5_000)
  }).catch(() => undefined);
}

async function getAnalyticsClientId(): Promise<string> {
  const result = await chrome.storage.local.get(ANALYTICS_CLIENT_ID_KEY);
  if (typeof result[ANALYTICS_CLIENT_ID_KEY] === "string" && result[ANALYTICS_CLIENT_ID_KEY]) {
    return result[ANALYTICS_CLIENT_ID_KEY] as string;
  }
  const clientId = crypto.randomUUID();
  await chrome.storage.local.set({ [ANALYTICS_CLIENT_ID_KEY]: clientId });
  return clientId;
}

async function readCachedTranslation(key: string): Promise<CachedTranslation | null> {
  const result = await chrome.storage.local.get(TRANSLATION_CACHE_KEY);
  const cache = toCache(result[TRANSLATION_CACHE_KEY]);
  const entry = cache[key];
  if (!entry || Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
  return entry;
}

async function cacheTranslation(
  key: string,
  translationResult: { translation: string; partOfSpeech?: string; phonetic?: string }
): Promise<void> {
  const storageResult = await chrome.storage.local.get(TRANSLATION_CACHE_KEY);
  const cache = toCache(storageResult[TRANSLATION_CACHE_KEY]);
  cache[key] = {
    translation: translationResult.translation,
    ...(translationResult.partOfSpeech ? { partOfSpeech: translationResult.partOfSpeech } : {}),
    ...(translationResult.phonetic ? { phonetic: translationResult.phonetic } : {}),
    savedAt: Date.now()
  };

  const limitedCache = Object.fromEntries(
    Object.entries(cache)
      .sort(([, left], [, right]) => right.savedAt - left.savedAt)
      .slice(0, MAX_CACHE_ENTRIES)
  );
  await chrome.storage.local.set({ [TRANSLATION_CACHE_KEY]: limitedCache });
}

function toCache(value: unknown): Record<string, CachedTranslation> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, CachedTranslation>;
}

function isTranslationMessage(value: unknown): value is TranslationMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TranslationMessage>;
  return candidate.type === TRANSLATION_MESSAGE_TYPE && typeof candidate.payload?.query === "string";
}

function isLocalDevelopmentEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function isAnalyticsMessage(value: unknown): value is AnalyticsMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AnalyticsMessage>;
  return candidate.type === ANALYTICS_MESSAGE_TYPE &&
    Boolean(candidate.payload && isAnalyticsEventName(candidate.payload.name));
}

function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return value === "extension_installed" || value === "extension_active" ||
    value === "translation_completed" || value === "word_saved";
}

function isBackendSuccess(value: unknown): value is BackendSuccess {
  return Boolean(
    value && typeof value === "object" && (value as { ok?: unknown }).ok === true &&
    typeof (value as { translation?: unknown }).translation === "string"
  );
}

function getBackendError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}
