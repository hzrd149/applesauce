// Pluggable persistence + media upload for ConcordClient.

import type { AsyncRumorStore, RumorStore } from "applesauce-core";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";

import type { MediaAttachment } from "../helpers/imeta.js";
import type { PendingRefoundingRecord } from "./refounding.js";

/** Progress for a batch of attachments sent with a chat message. */
export interface ConcordUploadProgress {
  /** Files in this send operation. */
  total: number;
  /** Files fully uploaded so far, so the file being worked on is `done + 1`. */
  done: number;
  /** Which half of the current file's trip is in progress. */
  phase: "encrypting" | "uploading";
}

/** Per-file progress emitted by a {@link ConcordUploader}. */
export interface ConcordUploadOptions {
  onProgress?: (phase: ConcordUploadProgress["phase"]) => void;
}

/** A per-plane rumor store — either the in-memory {@link RumorStore} or an
 *  {@link AsyncRumorStore} backed by an async event database. */
export type ConcordRumorStore = RumorStore | AsyncRumorStore;

/** Creates the per-plane {@link ConcordRumorStore} for a community — the persistent
 *  cache seam. Return an {@link AsyncRumorStore} backed by an async event database to
 *  persist decrypted rumors across reloads; the default is a fresh in-memory
 *  {@link RumorStore}. */
export type ConcordStoreFactory = (communityId: string, planeKey: string) => ConcordRumorStore;

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

const BYTE_MARKER = "$concordBytes";

function encodePending(record: PendingRefoundingRecord): string {
  return JSON.stringify(record, (_key, value) =>
    value instanceof Uint8Array ? { [BYTE_MARKER]: bytesToHex(value) } : value,
  );
}

function decodePending(value: string): unknown {
  return JSON.parse(value, (_key, item) => {
    if (
      item &&
      typeof item === "object" &&
      Object.keys(item).length === 1 &&
      typeof item[BYTE_MARKER] === "string" &&
      /^[0-9a-f]*$/i.test(item[BYTE_MARKER]) &&
      item[BYTE_MARKER].length % 2 === 0
    ) {
      return Uint8Array.from(item[BYTE_MARKER].match(/.{2}/g)?.map((byte: string) => Number.parseInt(byte, 16)) ?? []);
    }
    return item;
  });
}

function isPendingRecord(value: unknown, communityId: string): value is PendingRefoundingRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PendingRefoundingRecord>;
  return (
    record.version === 1 &&
    record.communityId === communityId &&
    Number.isSafeInteger(record.priorEpoch) &&
    typeof record.rotationId === "string" &&
    ["prepared", "mandatory-confirmed", "adopted", "snapshot-attempted"].includes(record.stage ?? "") &&
    !!record.plan &&
    record.plan.newEpoch === record.priorEpoch! + 1 &&
    record.plan.next?.material?.community_id === communityId &&
    record.plan.next?.material?.root_epoch === record.plan.newEpoch &&
    record.plan.rekeyWraps?.[0]?.id === record.rotationId &&
    Array.isArray(record.mandatoryEvidence) &&
    Array.isArray(record.commonRelays) &&
    Array.isArray(record.warnings)
  );
}

/** Authenticated, self-encrypted durable storage for one pending Refounding. */
export class PendingRefoundingStore {
  readonly key: string;

  constructor(
    private readonly storage: ConcordStorage,
    private readonly signer: ISigner,
    private readonly pubkey: string,
    private readonly communityId: string,
    key?: string,
  ) {
    this.key = key ?? `concord:pending-refounding:v1:${bytesToHex(sha256(utf8ToBytes(`${pubkey}:${communityId}`)))}`;
  }

  async load(): Promise<PendingRefoundingRecord | null> {
    const ciphertext = await this.storage.getItem(this.key);
    if (ciphertext === null) return null;
    if (!this.signer.nip44) throw new Error("pending refounding protection requires NIP-44");
    const plaintext = await this.signer.nip44.decrypt(this.pubkey, ciphertext);
    const record = decodePending(plaintext);
    if (!isPendingRecord(record, this.communityId)) throw new Error("invalid pending refounding record for community");
    return record;
  }

  async save(record: PendingRefoundingRecord): Promise<void> {
    if (!isPendingRecord(record, this.communityId)) throw new Error("invalid pending refounding record for community");
    if (!this.signer.nip44) throw new Error("pending refounding protection requires NIP-44");
    const ciphertext = await this.signer.nip44.encrypt(this.pubkey, encodePending(record));
    await this.storage.setItem(this.key, ciphertext);
  }

  remove(): Promise<void> {
    return this.storage.removeItem(this.key);
  }
}

/**
 * Encrypts and uploads chat/community media, returning the NIP-92 attachment
 * (url + per-file `encryption` + `originalSha256`) that rides in the message's
 * imeta tag / a community `BlobPointer`. Injected so the core client carries no
 * Blossom dependency; the app supplies a Blossom-backed implementation.
 */
export interface ConcordUploader {
  upload(file: Blob, communityId: string, options?: ConcordUploadOptions): Promise<MediaAttachment>;
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
