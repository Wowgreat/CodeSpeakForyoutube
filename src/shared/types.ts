export const STORAGE_KEY = "savedWords";

export interface SavedWord {
  word: string;
  normalizedWord: string;
  translation: string;
  partOfSpeech: string;
  savedAt: number;
}

interface MockDefinition {
  translation: string;
  partOfSpeech: string;
}

const MOCK_DICTIONARY: Record<string, MockDefinition> = {
  across: { translation: "穿过；横跨", partOfSpeech: "介词 / 副词" },
  "across the globe": { translation: "遍布全球；横跨世界", partOfSpeech: "词组" },
  another: { translation: "另一个；又一个", partOfSpeech: "限定词 / 代词" },
  world: { translation: "世界；天地", partOfSpeech: "名词" },
  war: { translation: "战争；斗争", partOfSpeech: "名词" },
  zero: { translation: "零；零点", partOfSpeech: "数词 / 名词" },
  globe: { translation: "地球；全球", partOfSpeech: "名词" },
  language: { translation: "语言", partOfSpeech: "名词" },
  learn: { translation: "学习；学会", partOfSpeech: "动词" },
  video: { translation: "视频；录像", partOfSpeech: "名词" },
  people: { translation: "人们；人民", partOfSpeech: "名词" },
  think: { translation: "想；认为", partOfSpeech: "动词" },
  know: { translation: "知道；了解", partOfSpeech: "动词" },
  make: { translation: "制作；使得", partOfSpeech: "动词" },
  good: { translation: "好的；有益的", partOfSpeech: "形容词" },
  time: { translation: "时间；次数", partOfSpeech: "名词" }
};

export function normalizeWord(word: string): string {
  return word.toLocaleLowerCase("en-US").replace(/[’']/g, "'");
}

export function getMockDefinition(word: string): MockDefinition {
  const normalized = normalizeWord(word);
  const known = MOCK_DICTIONARY[normalized];
  if (known) return known;

  if (/\s/.test(normalized)) {
    return { translation: "词组模拟释义（待接入真实翻译）", partOfSpeech: "词组" };
  }

  if (normalized.endsWith("ly")) {
    return { translation: "模拟释义（待接入真实翻译）", partOfSpeech: "副词（推测）" };
  }
  if (normalized.endsWith("ing") || normalized.endsWith("ed")) {
    return { translation: "模拟释义（待接入真实翻译）", partOfSpeech: "动词（推测）" };
  }
  if (normalized.endsWith("ous") || normalized.endsWith("ful") || normalized.endsWith("ive")) {
    return { translation: "模拟释义（待接入真实翻译）", partOfSpeech: "形容词（推测）" };
  }

  return { translation: "模拟释义（待接入真实翻译）", partOfSpeech: "单词" };
}

export async function getSavedWords(): Promise<SavedWord[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return Array.isArray(value) ? (value as SavedWord[]) : [];
}

export async function setSavedWords(words: SavedWord[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: words });
}
