import {
  getMockDefinition,
  getSavedWords,
  normalizeWord,
  type SavedWord,
  setSavedWords
} from "../shared/types";
import { requestTranslation } from "../shared/translation";

const CAPTION_SELECTOR = ".ytp-caption-window-container .ytp-caption-segment";
const CAPTION_CONTAINER_SELECTOR = ".ytp-caption-window-container";
const PLAYER_SELECTOR = "#movie_player";
const LANGUAGE_ATTRIBUTE = "data-csfy-caption-language";
const REQUEST_LANGUAGE_EVENT = "csfy:request-caption-language";
const ACTIVE_CLASS = "csfy-captions-active";
const OVERLAY_ID = "csfy-overlay-root";

const COMMON_ENGLISH_WORDS = new Set([
  "a", "about", "all", "also", "an", "and", "another", "are", "as", "at", "be", "because",
  "but", "by", "can", "come", "could", "day", "do", "for", "from", "get", "go", "good", "have",
  "he", "her", "here", "him", "his", "how", "i", "if", "in", "into", "is", "it", "just", "know",
  "like", "look", "make", "me", "more", "my", "new", "no", "not", "now", "of", "on", "one", "only",
  "or", "other", "our", "out", "people", "say", "see", "she", "so", "some", "take", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "thing", "think", "this", "time", "to", "two",
  "up", "us", "very", "want", "was", "way", "we", "well", "were", "what", "when", "which", "who", "will",
  "with", "work", "world", "would", "year", "you", "your"
]);

interface Token {
  text: string;
  isWord: boolean;
}

interface CaptionSnapshot {
  element: HTMLElement;
  text: string;
  rect: DOMRect;
  style: CSSStyleDeclaration;
}

interface CardTranslationState {
  translation: string;
  partOfSpeech: string;
}

class SubtitleEnhancer {
  private pageObserver: MutationObserver | null = null;
  private captionObserver: MutationObserver | null = null;
  private observedPlayer: HTMLElement | null = null;
  private overlayRoot: HTMLDivElement | null = null;
  private captionLayer: HTMLDivElement | null = null;
  private card: HTMLDivElement | null = null;
  private renderFrame: number | null = null;
  private lastSignature = "";
  private destroyed = false;
  private selectionAnchor: HTMLElement | null = null;
  private selectionFocus: HTMLElement | null = null;
  private renderDeferredWhileSelecting = false;
  private ignoreNextWordClick = false;
  private pausedVideo: HTMLVideoElement | null = null;
  private shouldResumeVideoOnClose = false;

  start(): void {
    this.createOverlay();
    this.installPageObserver();
    this.bindPlayerObserver();

    document.addEventListener("yt-navigate-start", this.handleNavigationStart);
    document.addEventListener("yt-navigate-finish", this.handleNavigationFinish);
    document.addEventListener("fullscreenchange", this.handleViewportChange);
    document.addEventListener("mousedown", this.handleSelectionStart);
    document.addEventListener("mousemove", this.handleSelectionMove);
    document.addEventListener("mouseup", this.handleSelectionEnd);
    window.addEventListener("popstate", this.handleNavigationFinish);
    window.addEventListener("resize", this.handleViewportChange);
    window.addEventListener("scroll", this.handleViewportChange, true);

    this.requestLanguage();
    this.scheduleRender();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pageObserver?.disconnect();
    this.captionObserver?.disconnect();
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    document.removeEventListener("yt-navigate-start", this.handleNavigationStart);
    document.removeEventListener("yt-navigate-finish", this.handleNavigationFinish);
    document.removeEventListener("fullscreenchange", this.handleViewportChange);
    document.removeEventListener("mousedown", this.handleSelectionStart);
    document.removeEventListener("mousemove", this.handleSelectionMove);
    document.removeEventListener("mouseup", this.handleSelectionEnd);
    window.removeEventListener("popstate", this.handleNavigationFinish);
    window.removeEventListener("resize", this.handleViewportChange);
    window.removeEventListener("scroll", this.handleViewportChange, true);
    this.deactivate();
    this.overlayRoot?.remove();
  }

  private createOverlay(): void {
    document.getElementById(OVERLAY_ID)?.remove();
    this.overlayRoot = document.createElement("div");
    this.overlayRoot.id = OVERLAY_ID;
    this.overlayRoot.setAttribute("aria-live", "off");

    this.captionLayer = document.createElement("div");
    this.captionLayer.className = "csfy-caption-layer";
    this.overlayRoot.append(this.captionLayer);
    this.mountOverlay();
  }

  private mountOverlay(): void {
    if (!this.overlayRoot) return;
    const host = document.fullscreenElement ?? document.body;
    if (host && this.overlayRoot.parentElement !== host) host.append(this.overlayRoot);
  }

  private installPageObserver(): void {
    if (this.pageObserver) return;
    this.pageObserver = new MutationObserver((mutations) => {
      if (this.observedPlayer?.isConnected) return;
      if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
        this.bindPlayerObserver();
      }
    });
    this.pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  private bindPlayerObserver(): void {
    const player = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
    if (player === this.observedPlayer) return;

    this.captionObserver?.disconnect();
    this.captionObserver = null;
    this.observedPlayer = player;

    if (!player) {
      this.deactivate();
      return;
    }

    this.captionObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => this.isCaptionMutation(mutation))) {
        this.scheduleRender();
      }
    });
    this.captionObserver.observe(player, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-pressed"]
    });
  }

  private isCaptionMutation(mutation: MutationRecord): boolean {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    if (target?.closest(`${CAPTION_CONTAINER_SELECTOR}, .ytp-subtitles-button`)) return true;

    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
      if (!(node instanceof Element)) return false;
      return node.matches(CAPTION_CONTAINER_SELECTOR) || Boolean(node.querySelector(CAPTION_CONTAINER_SELECTOR));
    });
  }

  private readonly handleNavigationStart = (): void => {
    this.lastSignature = "";
    this.deactivate();
    this.closeCard(false, false);
  };

  private readonly handleNavigationFinish = (): void => {
    this.lastSignature = "";
    this.bindPlayerObserver();
    this.requestLanguage();
    this.scheduleRender();
  };

  private readonly handleViewportChange = (): void => {
    this.mountOverlay();
    this.lastSignature = "";
    this.scheduleRender();
  };

  private readonly handleSelectionStart = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.captionLayer) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".csfy-word") : null;
    if (!target || !this.captionLayer.contains(target)) return;

    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    this.clearRangeHighlight();
    this.selectionAnchor = target;
    this.selectionFocus = target;
    target.classList.add("is-range-selected");
  };

  private readonly handleSelectionMove = (event: MouseEvent): void => {
    if (!this.selectionAnchor || !this.captionLayer) return;
    event.preventDefault();

    const pointedElement = document.elementFromPoint(event.clientX, event.clientY);
    const pointedWord = pointedElement?.closest<HTMLElement>(".csfy-word") ?? null;
    if (!pointedWord || !this.captionLayer.contains(pointedWord) || pointedWord === this.selectionFocus) return;

    this.selectionFocus = pointedWord;
    this.updateRangeHighlight();
  };

  private readonly handleSelectionEnd = (event: MouseEvent): void => {
    const anchor = this.selectionAnchor;
    const focus = this.selectionFocus;
    this.selectionAnchor = null;
    this.selectionFocus = null;
    if (!anchor || !focus || !this.captionLayer) return;

    const selectedWords = this.getWordRange(anchor, focus);
    if (selectedWords.length < 2) {
      this.clearRangeHighlight();
      this.flushDeferredRender();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.ignoreNextWordClick = true;
    window.setTimeout(() => {
      this.ignoreNextWordClick = false;
    }, 0);
    const phrase = selectedWords.map((word) => word.textContent ?? "").join(" ").trim();
    const anchorRect = getBoundingRect(selectedWords);
    this.flushDeferredRender();
    void this.openCard(phrase, anchorRect);
  };

  private getWordRange(anchor: HTMLElement, focus: HTMLElement): HTMLElement[] {
    if (!this.captionLayer) return [];
    const words = Array.from(this.captionLayer.querySelectorAll<HTMLElement>(".csfy-word"));
    const anchorIndex = words.indexOf(anchor);
    const focusIndex = words.indexOf(focus);
    if (anchorIndex < 0 || focusIndex < 0) return [];
    const start = Math.min(anchorIndex, focusIndex);
    const end = Math.max(anchorIndex, focusIndex);
    return words.slice(start, end + 1);
  }

  private updateRangeHighlight(): void {
    if (!this.selectionAnchor || !this.selectionFocus) return;
    this.clearRangeHighlight();
    for (const word of this.getWordRange(this.selectionAnchor, this.selectionFocus)) {
      word.classList.add("is-range-selected");
    }
  }

  private clearRangeHighlight(): void {
    this.captionLayer?.querySelectorAll(".csfy-word.is-range-selected").forEach((word) => {
      word.classList.remove("is-range-selected");
    });
  }

  private flushDeferredRender(): void {
    if (!this.renderDeferredWhileSelecting) return;
    this.renderDeferredWhileSelecting = false;
    this.lastSignature = "";
    this.scheduleRender();
  }

  private requestLanguage(): void {
    document.dispatchEvent(new CustomEvent(REQUEST_LANGUAGE_EVENT));
  }

  private scheduleRender(): void {
    if (this.renderFrame !== null || this.destroyed) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  private render(): void {
    if (this.selectionAnchor) {
      this.renderDeferredWhileSelecting = true;
      return;
    }

    this.bindPlayerObserver();
    this.mountOverlay();

    if (!this.isSupportedPage()) {
      this.deactivate();
      return;
    }

    const snapshots = this.collectCaptionSnapshots();
    const fullText = snapshots.map((snapshot) => snapshot.text).join(" ").trim();
    if (!fullText) {
      this.deactivate();
      return;
    }

    this.requestLanguage();
    const language = document.documentElement.getAttribute(LANGUAGE_ATTRIBUTE);
    if (!this.isEnglishCaption(language, fullText)) {
      this.deactivate();
      return;
    }

    const signature = snapshots
      .map(({ text, rect, style }) =>
        [text, Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), style.fontSize].join(":"))
      .join("|");
    if (signature === this.lastSignature) return;

    this.lastSignature = signature;
    this.captionLayer?.replaceChildren();
    for (const snapshot of snapshots) this.renderSegment(snapshot);
    document.documentElement.classList.add(ACTIVE_CLASS);
  }

  private isSupportedPage(): boolean {
    return location.hostname === "www.youtube.com" && location.pathname === "/watch";
  }

  private collectCaptionSnapshots(): CaptionSnapshot[] {
    return Array.from(document.querySelectorAll<HTMLElement>(CAPTION_SELECTOR))
      .map((element) => ({
        element,
        text: element.textContent ?? "",
        rect: element.getBoundingClientRect(),
        style: getComputedStyle(element)
      }))
      .filter(({ text, rect }) => text.trim().length > 0 && rect.width > 0 && rect.height > 0);
  }

  private isEnglishCaption(language: string | null, text: string): boolean {
    if (language) return /^en(?:-|$)/i.test(language);

    const words = text.toLocaleLowerCase("en-US").match(/[a-z]+(?:['’][a-z]+)*/g) ?? [];
    if (words.length === 0 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(text)) {
      return false;
    }
    const letters = text.match(/\p{L}/gu) ?? [];
    const latinLetters = text.match(/\p{Script=Latin}/gu) ?? [];
    const latinRatio = letters.length === 0 ? 0 : latinLetters.length / letters.length;
    const commonMatches = words.filter((word) => COMMON_ENGLISH_WORDS.has(word)).length;
    return latinRatio > 0.9 && (commonMatches > 0 || words.length >= 4);
  }

  private renderSegment(snapshot: CaptionSnapshot): void {
    if (!this.captionLayer) return;
    const segment = document.createElement("span");
    segment.className = "csfy-caption-segment";
    segment.style.left = `${snapshot.rect.left}px`;
    segment.style.top = `${snapshot.rect.top}px`;
    segment.style.minWidth = `${snapshot.rect.width}px`;
    segment.style.minHeight = `${snapshot.rect.height}px`;
    segment.style.fontFamily = snapshot.style.fontFamily;
    segment.style.fontSize = snapshot.style.fontSize;
    segment.style.fontWeight = snapshot.style.fontWeight;
    segment.style.lineHeight = snapshot.style.lineHeight;
    segment.style.letterSpacing = snapshot.style.letterSpacing;
    segment.style.color = snapshot.style.color;
    segment.style.backgroundColor = snapshot.style.backgroundColor;
    segment.style.textShadow = snapshot.style.textShadow;
    segment.style.direction = snapshot.style.direction;
    segment.style.textAlign = snapshot.style.textAlign;
    segment.style.padding = snapshot.style.padding;

    for (const token of tokenize(snapshot.text)) {
      if (!token.isWord) {
        segment.append(document.createTextNode(token.text));
        continue;
      }

      const wordElement = document.createElement("span");
      wordElement.className = "csfy-word";
      wordElement.textContent = token.text;
      wordElement.tabIndex = 0;
      wordElement.setAttribute("role", "button");
      wordElement.setAttribute("aria-label", `查看 ${token.text} 的释义`);
      wordElement.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.ignoreNextWordClick) return;
        window.getSelection()?.removeAllRanges();
        void this.openCard(token.text, wordElement.getBoundingClientRect());
      });
      wordElement.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        this.clearRangeHighlight();
        void this.openCard(token.text, wordElement.getBoundingClientRect());
      });
      segment.append(wordElement);
    }

    this.captionLayer.append(segment);
  }

  private async openCard(word: string, anchorRect: DOMRect): Promise<void> {
    this.pauseVideoForCard();
    this.closeCard(true, false);
    const definition = getMockDefinition(word);
    const translationState: CardTranslationState = {
      translation: definition.translation,
      partOfSpeech: definition.partOfSpeech
    };
    const normalized = normalizeWord(word);
    const savedWords = await getSavedWords();
    let isSaved = savedWords.some((item) => item.normalizedWord === normalized);

    const card = document.createElement("div");
    card.className = "csfy-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `${word} 的单词卡片`);

    const header = document.createElement("div");
    header.className = "csfy-card-header";
    const wordElement = document.createElement("strong");
    wordElement.className = "csfy-card-word";
    wordElement.textContent = word;
    const closeButton = this.makeCardButton("×", "关闭单词卡片", "csfy-close");
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.closeCard();
    });
    header.append(wordElement, closeButton);

    const translation = document.createElement("div");
    translation.className = "csfy-card-translation is-loading";
    translation.textContent = "正在翻译…";
    const partOfSpeech = document.createElement("div");
    partOfSpeech.className = "csfy-card-pos";
    partOfSpeech.textContent = definition.partOfSpeech;
    const phonetic = document.createElement("div");
    phonetic.className = "csfy-card-phonetic";
    phonetic.hidden = true;
    const source = document.createElement("div");
    source.className = "csfy-card-source";
    source.textContent = "正在连接百度智能云词典";

    const actions = document.createElement("div");
    actions.className = "csfy-card-actions";
    const speakButton = this.makeCardButton("🔊 发音", `朗读 ${word}`);
    speakButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.speak(word);
    });
    const saveButton = this.makeCardButton(isSaved ? "★ 已收藏" : "☆ 收藏", `${isSaved ? "取消收藏" : "收藏"} ${word}`);
    saveButton.classList.toggle("is-saved", isSaved);
    saveButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      isSaved = await this.toggleSavedWord(word, translationState.translation, translationState.partOfSpeech);
      saveButton.textContent = isSaved ? "★ 已收藏" : "☆ 收藏";
      saveButton.setAttribute("aria-label", `${isSaved ? "取消收藏" : "收藏"} ${word}`);
      saveButton.classList.toggle("is-saved", isSaved);
    });
    actions.append(speakButton, saveButton);
    card.append(header, translation, phonetic, partOfSpeech, source, actions);

    card.addEventListener("click", (event) => event.stopPropagation());
    this.overlayRoot?.append(card);
    this.card = card;
    this.positionCard(card, anchorRect);
    void this.loadTranslation(word, card, translation, phonetic, partOfSpeech, source, translationState, anchorRect);
  }

  private async loadTranslation(
    query: string,
    card: HTMLElement,
    translationElement: HTMLElement,
    phoneticElement: HTMLElement,
    partOfSpeechElement: HTMLElement,
    sourceElement: HTMLElement,
    state: CardTranslationState,
    anchorRect: DOMRect
  ): Promise<void> {
    const fallback = getMockDefinition(query).translation;
    const result = await requestTranslation(query);
    if (this.card !== card || !card.isConnected) return;

    translationElement.classList.remove("is-loading");
    if (result.ok) {
      state.translation = result.translation;
      state.partOfSpeech = result.partOfSpeech ?? state.partOfSpeech;
      translationElement.textContent = result.translation;
      partOfSpeechElement.textContent = state.partOfSpeech;
      if (result.phonetic) {
        phoneticElement.textContent = `/${result.phonetic}/`;
        phoneticElement.hidden = false;
      }
      sourceElement.textContent = result.cached ? "百度智能云词典 · 本地缓存" : "百度智能云词典";
      sourceElement.classList.remove("is-warning");
    } else {
      state.translation = fallback;
      translationElement.textContent = fallback;
      sourceElement.textContent = result.code === "NOT_CONFIGURED"
        ? "Mock 释义 · 请在扩展弹窗配置翻译服务"
        : "Mock 释义 · 百度智能云翻译暂不可用";
      sourceElement.classList.add("is-warning");
      sourceElement.title = result.message;
    }

    this.positionCard(card, anchorRect);
  }

  private makeCardButton(text: string, label: string, className = ""): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `csfy-card-button ${className}`.trim();
    button.textContent = text;
    button.setAttribute("aria-label", label);
    return button;
  }

  private positionCard(card: HTMLElement, anchorRect: DOMRect): void {
    const margin = 10;
    const cardRect = card.getBoundingClientRect();
    let left = anchorRect.left + anchorRect.width / 2 - cardRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - cardRect.width - margin));
    let top = anchorRect.top - cardRect.height - 12;
    if (top < margin) top = anchorRect.bottom + 12;
    top = Math.max(margin, Math.min(top, window.innerHeight - cardRect.height - margin));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  private speak(word: string): void {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  }

  private pauseVideoForCard(): void {
    if (this.shouldResumeVideoOnClose) return;
    const video = document.querySelector<HTMLVideoElement>("#movie_player video.html5-main-video, video.html5-main-video");
    if (!video || video.paused || video.ended) return;

    video.pause();
    this.pausedVideo = video;
    this.shouldResumeVideoOnClose = true;
  }

  private resumeVideoAfterCard(): void {
    const video = this.pausedVideo;
    const shouldResume = this.shouldResumeVideoOnClose;
    this.pausedVideo = null;
    this.shouldResumeVideoOnClose = false;

    if (!shouldResume || !video?.isConnected || !video.paused || video.ended) return;
    void video.play().catch(() => {
      // Chrome may reject playback if the page loses user activation; the user can resume manually.
    });
  }

  private async toggleSavedWord(word: string, translation: string, partOfSpeech: string): Promise<boolean> {
    const normalizedWord = normalizeWord(word);
    const words = await getSavedWords();
    const existingIndex = words.findIndex((item) => item.normalizedWord === normalizedWord);

    if (existingIndex >= 0) {
      words.splice(existingIndex, 1);
      await setSavedWords(words);
      return false;
    }

    const savedWord: SavedWord = { word, normalizedWord, translation, partOfSpeech, savedAt: Date.now() };
    await setSavedWords([savedWord, ...words]);
    return true;
  }

  private closeCard(preserveRangeHighlight = false, resumePlayback = true): void {
    this.card?.remove();
    this.card = null;
    if (!preserveRangeHighlight) this.clearRangeHighlight();
    if (resumePlayback) {
      this.resumeVideoAfterCard();
    } else if (!preserveRangeHighlight) {
      this.pausedVideo = null;
      this.shouldResumeVideoOnClose = false;
    }
  }

  private deactivate(): void {
    document.documentElement.classList.remove(ACTIVE_CLASS);
    this.captionLayer?.replaceChildren();
    this.lastSignature = "";
  }
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const matcher = /([\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*)|(\s+)|([^\s])/gu;
  for (const match of text.matchAll(matcher)) {
    const value = match[0];
    tokens.push({ text: value, isWord: /\p{L}/u.test(value) });
  }
  return tokens;
}

function getBoundingRect(elements: HTMLElement[]): DOMRect {
  const rectangles = elements.map((element) => element.getBoundingClientRect());
  const left = Math.min(...rectangles.map((rect) => rect.left));
  const top = Math.min(...rectangles.map((rect) => rect.top));
  const right = Math.max(...rectangles.map((rect) => rect.right));
  const bottom = Math.max(...rectangles.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

const enhancer = new SubtitleEnhancer();
enhancer.start();

window.addEventListener("pagehide", () => enhancer.destroy(), { once: true });
