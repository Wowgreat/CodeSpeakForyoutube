(() => {
  const LANGUAGE_ATTRIBUTE = "data-csfy-caption-language";
  const REQUEST_EVENT = "csfy:request-caption-language";

  interface CaptionTrack {
    languageCode?: string;
    vssId?: string;
    isSelected?: boolean;
  }

  interface YouTubePlayer extends HTMLElement {
    getOption?: (module: string, option: string) => unknown;
  }

  function languageFromTrack(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const track = value as CaptionTrack;
    if (typeof track.languageCode === "string" && track.languageCode) {
      return track.languageCode;
    }
    if (typeof track.vssId === "string") {
      const match = track.vssId.match(/(?:^|\.)([a-z]{2,3}(?:-[A-Z]{2})?)(?:\.|$)/);
      return match?.[1] ?? null;
    }
    return null;
  }

  function readLanguage(): string | null {
    const player = document.getElementById("movie_player") as YouTubePlayer | null;
    if (!player?.getOption) return null;

    for (const option of ["track", "currentTrack"]) {
      try {
        const language = languageFromTrack(player.getOption("captions", option));
        if (language) return language;
      } catch {
        // YouTube's private player API varies; the isolated script has a text fallback.
      }
    }

    try {
      const tracks = player.getOption("captions", "tracklist");
      if (Array.isArray(tracks)) {
        const selected = tracks.find((track: unknown) =>
          Boolean(track && typeof track === "object" && (track as CaptionTrack).isSelected)
        );
        return languageFromTrack(selected);
      }
    } catch {
      // Ignore unavailable private API fields.
    }

    return null;
  }

  function publishLanguage(): void {
    const language = readLanguage();
    if (language) {
      document.documentElement.setAttribute(LANGUAGE_ATTRIBUTE, language);
    } else {
      document.documentElement.removeAttribute(LANGUAGE_ATTRIBUTE);
    }
  }

  document.addEventListener(REQUEST_EVENT, publishLanguage);
  document.addEventListener("yt-navigate-finish", publishLanguage);
  window.addEventListener("popstate", publishLanguage);
  publishLanguage();
})();
