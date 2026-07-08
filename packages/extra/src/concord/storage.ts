// Pluggable persistence + media upload for ConcordClient.
//
// Key material uses an async key/value interface so apps can provide IndexedDB,
// localForage, SQLite, or another durable store. Decoded-rumor caching is still
// a separate localStorage-shaped interface while it awaits a database-backed
// design.

import type { MediaAttachment } from "./helpers/imeta.js";

/** Async key/value storage for Concord membership/key material. */
export interface ConcordKeyStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** An in-memory {@link ConcordKeyStorage}. Not durable — real clients should pass one. */
export function memoryKeyStorage(): ConcordKeyStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

/** The best default key storage: wrapped `localStorage` if present, else memory. */
export function defaultKeyStorage(): ConcordKeyStorage {
  const ls = (globalThis as { localStorage?: ConcordStorage }).localStorage;
  if (!ls) return memoryKeyStorage();
  return {
    getItem: async (k) => ls.getItem(k),
    setItem: async (k, v) => void ls.setItem(k, v),
    removeItem: async (k) => void ls.removeItem(k),
  };
}

/** The synchronous key/value surface used for the decoded-rumor cache. A browser's
 *  `localStorage` satisfies it directly; {@link memoryStorage} is the default. */
export interface ConcordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** An in-memory {@link ConcordStorage} (the default when none is provided and no
 *  `localStorage` global exists). Not durable — a real client should pass one. */
export function memoryStorage(): ConcordStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** The best default storage: the `localStorage` global if present, else memory. */
export function defaultStorage(): ConcordStorage {
  const ls = (globalThis as { localStorage?: ConcordStorage }).localStorage;
  return ls ?? memoryStorage();
}

/**
 * Encrypts and uploads chat/community media, returning the NIP-92 attachment
 * (url + per-file `encryption` + `originalSha256`) that rides in the message's
 * imeta tag / a community `BlobPointer`. Injected so the core client carries no
 * Blossom dependency; the app supplies a Blossom-backed implementation.
 */
export interface ConcordUploader {
  upload(file: Blob, communityId: string): Promise<MediaAttachment>;
}

// ---- decoded-rumor cache (survives reload independent of relay behaviour) ----

export type CachePlane = "control" | "guestbook" | "channel";

export interface CachedEntry {
  plane: CachePlane;
  channelId?: string;
  // The decoded rumor + verified author — never a raw kind-1059 wrap.
  decoded: import("./types.js").DecodedEvent;
}

/** Cap cached chat per channel; control/guestbook are small and kept whole. */
export const MAX_CHANNEL_CACHE = 300;
