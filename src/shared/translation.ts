export const DEFAULT_TRANSLATION_API_URL =
  "https://codespeakforyoutube.1242196553.workers.dev/api/translate";
export const DEVELOPMENT_TRANSLATION_API_URL_KEY = "developmentTranslationApiUrl";
export const TRANSLATION_CACHE_KEY = "translationCache";
export const TRANSLATION_MESSAGE_TYPE = "CSFY_TRANSLATE";

export interface TranslationRequest {
  query: string;
}

export interface TranslationSuccess {
  ok: true;
  translation: string;
  partOfSpeech?: string;
  phonetic?: string;
  provider: "baidu-bce";
  cached: boolean;
}

export interface TranslationFailure {
  ok: false;
  code: "INVALID_REQUEST" | "NETWORK_ERROR" | "PROVIDER_ERROR";
  message: string;
}

export type TranslationResponse = TranslationSuccess | TranslationFailure;

export async function requestTranslation(query: string): Promise<TranslationResponse> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: TRANSLATION_MESSAGE_TYPE,
      payload: { query }
    });
    return isTranslationResponse(response)
      ? response
      : { ok: false, code: "NETWORK_ERROR", message: "翻译服务返回了无法识别的数据" };
  } catch {
    return { ok: false, code: "NETWORK_ERROR", message: "无法连接扩展后台翻译服务" };
  }
}

function isTranslationResponse(value: unknown): value is TranslationResponse {
  if (!value || typeof value !== "object" || !("ok" in value)) return false;
  const candidate = value as Partial<TranslationResponse>;
  if (candidate.ok === true) {
    return "translation" in candidate && typeof candidate.translation === "string";
  }
  return candidate.ok === false && "message" in candidate && typeof candidate.message === "string";
}
