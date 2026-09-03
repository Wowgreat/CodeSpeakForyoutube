import { getSavedWords, setSavedWords, type SavedWord } from "../shared/types";

const list = document.querySelector<HTMLUListElement>("#word-list");
const emptyState = document.querySelector<HTMLElement>("#empty-state");
const count = document.querySelector<HTMLElement>("#word-count");

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
