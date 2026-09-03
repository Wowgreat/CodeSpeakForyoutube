import { getSavedWords, setSavedWords, type SavedWord } from "../shared/types";
import { TRANSLATION_API_URL_KEY } from "../shared/translation";

const list = document.querySelector<HTMLUListElement>("#word-list");
const emptyState = document.querySelector<HTMLElement>("#empty-state");
const count = document.querySelector<HTMLElement>("#word-count");
const settingsForm = document.querySelector<HTMLFormElement>("#translation-settings-form");
const apiUrlInput = document.querySelector<HTMLInputElement>("#translation-api-url");
const settingsStatus = document.querySelector<HTMLElement>("#translation-settings-status");

async function render(): Promise<void> {
  if (!list || !emptyState || !count) return;
  const words = (await getSavedWords()).sort((a, b) => b.savedAt - a.savedAt);
  list.replaceChildren();
  count.textContent = String(words.length);
  emptyState.hidden = words.length > 0;

  for (const savedWord of words) list.append(createWordItem(savedWord));
}

function createWordItem(savedWord: SavedWord): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "word-item";

  const content = document.createElement("div");
  content.className = "word-content";
  const titleRow = document.createElement("div");
  titleRow.className = "word-title-row";
  const word = document.createElement("strong");
  word.textContent = savedWord.word;
  const partOfSpeech = document.createElement("span");
  partOfSpeech.textContent = savedWord.partOfSpeech;
  titleRow.append(word, partOfSpeech);
  const translation = document.createElement("p");
  translation.textContent = savedWord.translation;
  content.append(titleRow, translation);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-button";
  remove.textContent = "删除";
  remove.setAttribute("aria-label", `删除 ${savedWord.word}`);
  remove.addEventListener("click", async () => {
    const words = await getSavedWords();
    await setSavedWords(words.filter((item) => item.normalizedWord !== savedWord.normalizedWord));
    await render();
  });

  item.append(content, remove);
  return item;
}

void render();
void loadTranslationSettings();

settingsForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveTranslationSettings();
});

async function loadTranslationSettings(): Promise<void> {
  if (!apiUrlInput || !settingsStatus) return;
  const result = await chrome.storage.local.get(TRANSLATION_API_URL_KEY);
  const endpoint = result[TRANSLATION_API_URL_KEY];
  if (typeof endpoint !== "string" || !endpoint) return;

  apiUrlInput.value = endpoint;
  setSettingsStatus("百度智能云翻译代理已配置。", "success");
}

async function saveTranslationSettings(): Promise<void> {
  if (!apiUrlInput) return;
  const endpoint = parseEndpoint(apiUrlInput.value);
  if (!endpoint) {
    setSettingsStatus("请输入 HTTPS 地址；本地开发可使用 localhost。", "error");
    return;
  }

  const granted = await chrome.permissions.request({ origins: [getPermissionPattern(endpoint)] });
  if (!granted) {
    setSettingsStatus("未获得该代理域名的访问权限。", "error");
    return;
  }

  await chrome.storage.local.set({ [TRANSLATION_API_URL_KEY]: endpoint.toString() });
  apiUrlInput.value = endpoint.toString();
  setSettingsStatus("已保存，字幕卡片将使用百度智能云词典。", "success");
}

function parseEndpoint(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "https:" || (url.protocol === "http:" && isLocal) ? url : null;
  } catch {
    return null;
  }
}

function getPermissionPattern(url: URL): string {
  return `${url.protocol}//${url.hostname}/*`;
}

function setSettingsStatus(message: string, state: "success" | "error"): void {
  if (!settingsStatus) return;
  settingsStatus.textContent = message;
  settingsStatus.classList.toggle("is-success", state === "success");
  settingsStatus.classList.toggle("is-error", state === "error");
}
