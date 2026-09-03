import {
  TRANSLATION_API_URL_KEY,
  TRANSLATION_CACHE_KEY,
  TRANSLATION_MESSAGE_TYPE,
  type TranslationRequest,
  type TranslationResponse
} from "../shared/translation";

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
  if (!isTranslationMessage(message)) return;

  void translate(message.payload.query)
    .then(sendResponse)
    .catch(() => {
      sendResponse({ ok: false, code: "NETWORK_ERROR", message: "扩展后台翻译失败" } satisfies TranslationResponse);
    });
  return true;
});

async function translate(rawQuery: string): Promise<TranslationResponse> {
  const query = rawQuery.replace(/\s+/g, " ").trim();
  if (!query || query.length > 200) {
    return { ok: false, code: "INVALID_REQUEST", message: "查询内容必须为 1–200 个字符" };
  }

  const cacheKey = query.toLocaleLowerCase("en-US");
  const cached = await readCachedTranslation(cacheKey);
  if (cached) {
    return {
      ok: true,
      translation: cached.translation,
      ...(cached.partOfSpeech ? { partOfSpeech: cached.partOfSpeech } : {}),
      ...(cached.phonetic ? { phonetic: cached.phonetic } : {}),
      provider: "baidu-bce",
      cached: true
    };
  }

  const settings = await chrome.storage.local.get(TRANSLATION_API_URL_KEY);
  const endpoint = settings[TRANSLATION_API_URL_KEY];
  if (typeof endpoint !== "string" || !isAllowedEndpoint(endpoint)) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "请在扩展弹窗中配置百度智能云翻译代理地址"
    };
  }

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
    return {
      ok: true,
      translation,
      ...(partOfSpeech ? { partOfSpeech } : {}),
      ...(phonetic ? { phonetic } : {}),
      provider: "baidu-bce",
      cached: false
    };
  } catch {
    return { ok: false, code: "NETWORK_ERROR", message: "百度智能云翻译代理连接超时或不可用" };
  }
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

function isAllowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
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
