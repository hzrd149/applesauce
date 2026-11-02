import type { StorageAdapter } from "nostr-double-ratchet";
import type { MessageStorage } from "../common/types.js";

/** A string key/value store that can also list its keys, such as localforage or an encrypted wrapper */
export interface NdrKeyValueStorage extends MessageStorage {
  /** Returns every stored key */
  keys(): string[] | Promise<string[]>;
}

/**
 * Creates an NDR StorageAdapter that saves JSON values in a string key/value store
 * @note a `setItem` that resolves `false` is treated as a failed write and throws
 */
export function createNdrStorage(storage: NdrKeyValueStorage): StorageAdapter {
  return {
    get: async (key) => {
      const value = await storage.getItem(key);
      return value === null ? undefined : JSON.parse(value);
    },
    put: async (key, value) => {
      const written = await storage.setItem(key, JSON.stringify(value));
      if (written === false) throw new Error(`Failed to write NDR storage key ${key}`);
    },
    del: async (key) => {
      await storage.removeItem(key);
    },
    list: async (prefix = "") => {
      const keys = await storage.keys();
      return keys.filter((key) => key.startsWith(prefix));
    },
  };
}
