interface Env {
  BAIDU_API_KEY: string;
  BAIDU_SECRET_KEY: string;
  ALLOWED_ORIGIN?: string;
  RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

interface TranslatePayload {
  query?: unknown;
}

interface BaiduTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface DictionarySymbol {
  ph_am?: string;
  ph_en?: string;
  parts?: Array<{ part?: string; means?: string[] }>;
}

interface DictionaryPayload {
  word_result?: {
    simple_means?: {
      word_means?: string[];
      symbols?: DictionarySymbol[];
    };
    edict?: {
      item?: Array<{ pos?: string }>;
    };
  };
}

interface BaiduTranslationItem {
  src?: string;
  dst?: string;
  dict?: string | DictionaryPayload;
}

interface BaiduTranslationResponse {
  result?: {
    trans_result?: BaiduTranslationItem[];
  };
  error_code?: string | number;
  error_msg?: string;
}

interface ParsedTranslation {
  translation: string;
  partOfSpeech?: string;
  phonetic?: string;
}

const BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
const BAIDU_DICTIONARY_URL = "https://aip.baidubce.com/rpc/2.0/mt/texttrans-with-dict/v1";
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

let accessTokenCache: { token: string; expiresAt: number } | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestUrl = new URL(request.url);
    const cors = createCorsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (requestUrl.pathname !== "/api/translate") {
      return json({ ok: false, message: "Not found" }, 404, cors);
    }
    if (request.method !== "POST") {
      return json({ ok: false, message: "Method not allowed" }, 405, cors);
    }
    if (!isOriginAllowed(request, env)) {
      return json({ ok: false, message: "Origin not allowed" }, 403, cors);
    }

    const clientAddress = request.headers.get("CF-Connecting-IP") ?? "unknown-client";
    const rateLimit = await env.RATE_LIMITER?.limit({ key: clientAddress });
    if (rateLimit && !rateLimit.success) {
      return json({ ok: false, message: "翻译请求过于频繁，请稍后再试" }, 429, cors);
    }

    if (!env.BAIDU_API_KEY || !env.BAIDU_SECRET_KEY) {
      return json({ ok: false, message: "百度智能云 API Key/Secret Key 尚未配置" }, 503, cors);
    }

    let payload: TranslatePayload;
    try {
      payload = await request.json() as TranslatePayload;
    } catch {
      return json({ ok: false, message: "请求 JSON 无效" }, 400, cors);
    }

    const query = typeof payload.query === "string" ? payload.query.replace(/\s+/g, " ").trim() : "";
    if (!query || query.length > 200) {
      return json({ ok: false, message: "查询内容必须为 1–200 个字符" }, 400, cors);
    }

    try {
      const result = await requestBaiduTranslation(query, env);
      return json({ ok: true, ...result, provider: "baidu-bce" }, 200, cors);
    } catch (error) {
      const message = error instanceof Error ? error.message : "百度智能云翻译不可用";
      return json({ ok: false, message }, 502, cors);
    }
  }
};

async function requestBaiduTranslation(query: string, env: Env): Promise<ParsedTranslation> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getAccessToken(env);
    const url = new URL(BAIDU_DICTIONARY_URL);
    url.searchParams.set("access_token", token);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify({ q: query, from: "en", to: "zh" }),
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await response.json() as BaiduTranslationResponse;

    if (payload.error_code === 110 || payload.error_code === 111 ||
        payload.error_code === "110" || payload.error_code === "111") {
      accessTokenCache = null;
      continue;
    }
    if (!response.ok || payload.error_code) {
      const code = payload.error_code ? `（${payload.error_code}）` : "";
      throw new Error(`百度智能云翻译请求失败${code}${payload.error_msg ? `：${payload.error_msg}` : ""}`);
    }

    const parsed = parseTranslation(payload);
    if (!parsed) throw new Error("百度智能云翻译没有返回有效译文");
    return parsed;
  }

  throw new Error("百度智能云 Access Token 已失效");
}

async function getAccessToken(env: Env): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return accessTokenCache.token;
  }

  const url = new URL(BAIDU_TOKEN_URL);
  url.searchParams.set("grant_type", "client_credentials");
  url.searchParams.set("client_id", env.BAIDU_API_KEY);
  url.searchParams.set("client_secret", env.BAIDU_SECRET_KEY);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await response.json() as BaiduTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(`百度智能云鉴权失败${payload.error_description ? `：${payload.error_description}` : ""}`);
  }

  const expiresInSeconds = typeof payload.expires_in === "number" ? payload.expires_in : 30 * 24 * 60 * 60;
  accessTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000
  };
  return payload.access_token;
}

function parseTranslation(payload: BaiduTranslationResponse): ParsedTranslation | null {
  const items = payload.result?.trans_result ?? [];
  const dictionary = parseDictionary(items[0]?.dict);
  const dictionaryMeanings = dictionary?.word_result?.simple_means?.word_means
    ?.map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4) ?? [];
  const translatedText = items.map((item) => item.dst?.trim()).filter((value): value is string => Boolean(value));
  const translation = (dictionaryMeanings.length > 0 ? dictionaryMeanings : translatedText).join("；");
  if (!translation) return null;

  const symbols = dictionary?.word_result?.simple_means?.symbols ?? [];
  const rawParts = symbols.flatMap((symbol) => symbol.parts?.map((part) => part.part ?? "") ?? []);
  const edictParts = dictionary?.word_result?.edict?.item?.map((item) => item.pos ?? "") ?? [];
  const partOfSpeech = translatePartsOfSpeech([...rawParts, ...edictParts]);
  const firstSymbol = symbols[0];
  const phonetic = firstSymbol?.ph_am?.trim() || firstSymbol?.ph_en?.trim();

  return {
    translation,
    ...(partOfSpeech ? { partOfSpeech } : {}),
    ...(phonetic ? { phonetic } : {})
  };
}

function parseDictionary(value: BaiduTranslationItem["dict"]): DictionaryPayload | null {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as DictionaryPayload : null;
  } catch {
    return null;
  }
}

function translatePartsOfSpeech(values: string[]): string {
  const map: Record<string, string> = {
    "n": "名词", "noun": "名词",
    "v": "动词", "verb": "动词", "vt": "及物动词", "vi": "不及物动词",
    "adj": "形容词", "adjective": "形容词",
    "adv": "副词", "adverb": "副词",
    "prep": "介词", "preposition": "介词",
    "pron": "代词", "pronoun": "代词",
    "conj": "连词", "conjunction": "连词",
    "int": "感叹词", "interjection": "感叹词",
    "num": "数词", "numeral": "数词",
    "art": "冠词", "article": "冠词",
    "aux": "助动词", "modal": "情态动词"
  };
  const translated = values
    .flatMap((value) => value.toLocaleLowerCase("en-US").split(/[\s/,;，]+/))
    .map((value) => value.replace(/\.$/, ""))
    .filter(Boolean)
    .map((value) => map[value] ?? value)
    .filter((value, index, array) => array.indexOf(value) === index);
  return translated.join(" / ");
}

function isOriginAllowed(request: Request, env: Env): boolean {
  const configured = env.ALLOWED_ORIGIN?.trim();
  if (!configured || configured === "*") return true;
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return configured.split(",").map((item) => item.trim()).includes(origin);
}

function createCorsHeaders(request: Request, env: Env): Headers {
  const requestOrigin = request.headers.get("Origin");
  const configured = env.ALLOWED_ORIGIN?.trim();
  const allowOrigin = !configured || configured === "*" ? "*" : requestOrigin ?? configured.split(",")[0]?.trim() ?? "";
  return new Headers({
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });
}

function json(body: unknown, status: number, headers: Headers): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
