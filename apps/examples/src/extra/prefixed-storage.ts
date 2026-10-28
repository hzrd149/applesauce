import type SecureStorage from "./encrypted-storage";

/** Creates a prefixed key-value interface backed by the same encrypted storage */
export function createPrefixedStorage(storage: SecureStorage, prefix: string) {
  return {
    getItem: (key: string) => storage.getItem(prefix + key),
    setItem: async (key: string, value: string): Promise<void> => {
      if (!(await storage.setItem(prefix + key, value))) throw new Error("Failed to save encrypted storage data");
    },
    removeItem: (key: string) => storage.removeItem(prefix + key),
  };
}
