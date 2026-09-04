export const ANALYTICS_MESSAGE_TYPE = "CSFY_ANALYTICS";
export const ANALYTICS_CLIENT_ID_KEY = "analyticsClientId";
export const ANALYTICS_LAST_ACTIVE_KEY = "analyticsLastActiveDate";

export type AnalyticsEventName =
  | "extension_installed"
  | "extension_active"
  | "translation_completed"
  | "word_saved";

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  params?: Record<string, string | number | boolean>;
}

export async function trackAnalytics(
  name: AnalyticsEventName,
  params?: Record<string, string | number | boolean>
): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: ANALYTICS_MESSAGE_TYPE, payload: { name, params } });
  } catch {
    // Analytics must never affect the extension's main features.
  }
}
