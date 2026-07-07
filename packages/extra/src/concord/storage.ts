// Pluggable persistence + media upload for ConcordClient.
//
// The app version hardwired `localStorage` (materials mirror + decoded-rumor
// cache) and Blossom image upload. The upstream client dependency-injects both
// so it runs anywhere (Node, tests, a non-Blossom host). The reference
// implementations of these interfaces live in the app: its localStorage cache
// and its Blossom uploader.

import type { MediaAttachment } from "./operations/imeta.js";

/** The synchronous key/value surface ConcordClient persists to. A browser's
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
 * (url + per-file `encryption` + `originalHash`) that rides in the message's
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
