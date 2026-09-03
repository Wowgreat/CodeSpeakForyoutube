interface ChromeStorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

declare const chrome: {
  storage: {
    local: ChromeStorageArea;
  };
};
