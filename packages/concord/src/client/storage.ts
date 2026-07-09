// Pluggable persistence + media upload for ConcordClient.

import type { RumorStore } from "applesauce-core";

import type { MediaAttachment } from "../helpers/imeta.js";

/** Creates the per-plane {@link RumorStore} for a community — the persistent cache
 *  seam. Return a store backed by an async event database to persist decrypted
 *  rumors across reloads; the default is a fresh in-memory {@link RumorStore}. */
export type ConcordStoreFactory = (communityId: string, planeKey: string) => RumorStore;

/** Async key/value storage for Concord membership/key material and sync cursors. */
export interface ConcordStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** An in-memory {@link ConcordStorage}. Not durable — real clients should pass one. */
export function memoryStorage(): ConcordStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The best default storage: wrapped `localStorage` if present, else memory. */
export function defaultStorage(): ConcordStorage {
  const ls = (globalThis as { localStorage?: SyncStorage }).localStorage;
  if (!ls) return memoryStorage();
  return {
    getItem: async (k) => ls.getItem(k),
    setItem: async (k, v) => void ls.setItem(k, v),
    removeItem: async (k) => void ls.removeItem(k),
  };
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
  decoded: import("../types.js").DecodedEvent;
}

/** Cap cached chat per channel; control/guestbook are small and kept whole. */
export const MAX_CHANNEL_CACHE = 300;
