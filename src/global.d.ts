interface ChromeStorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface ChromeMessageSender {
  id?: string;
}

declare const chrome: {
  storage: {
    local: ChromeStorageArea;
  };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onInstalled: { addListener(callback: () => void): void };
    onStartup: { addListener(callback: () => void): void };
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: ChromeMessageSender,
          sendResponse: (response: unknown) => void
        ) => boolean | void
      ): void;
    };
  };
  permissions: {
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
};
