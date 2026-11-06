import type SecureStorage from "./encrypted-storage";

/** Creates a prefixed key-value interface backed by the same encrypted storage */
export function createPrefixedStorage(storage: SecureStorage, prefix: string) {
  return {
    getItem: (key: string) => storage.getItem(prefix + key),
    setItem: (key: string, value: string) => storage.setItem(prefix + key, value),
    removeItem: (key: string) => storage.removeItem(prefix + key),
  };
}
