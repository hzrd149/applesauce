// Shared option types for the Concord client engine.

import type { EventStore, RumorStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";

import type { ConcordRelayAuth } from "./relay-auth.js";
import type { ConcordStorage, ConcordUploader } from "./storage.js";
import type { JoinMaterial } from "../types.js";

/** Creates the per-plane {@link RumorStore} for a community — the persistent cache
 *  seam. Return a store backed by an async event database to persist decrypted
 *  rumors across reloads; the default is a fresh in-memory {@link RumorStore}. */
export type ConcordStoreFactory = (communityId: string, planeKey: string) => RumorStore;

/** Options for constructing a single-community {@link ConcordCommunity} engine. */
export interface ConcordCommunityOptions {
  /** The membership/key material for this community (from an invite or the list). */
  material: JoinMaterial;
  /** The logged-in user's signer (NIP-44 required to follow Refoundings). */
  signer: ISigner;
  /** The logged-in user's hex pubkey. */
  pubkey: string;
  /** The applesauce RelayPool used for all subscriptions/publishes. */
  pool: RelayPool;
  /** NIP-42 stream-key authenticator (shared across communities by the manager). */
  relayAuth: ConcordRelayAuth;
  /** Wrap-level store for kind-1059 dedup + the NIP-77 negentropy local store.
   *  Defaults to a fresh {@link EventStore}. */
  eventStore?: EventStore;
  /** Media uploader (encrypt + upload). Required to send files or set images. */
  uploader?: ConcordUploader;
  /** Fallback relays when the community defines none. */
  relays?: string[];
  /** Per-plane store factory (persistent cache). Defaults to in-memory stores. */
  storeFactory?: ConcordStoreFactory;
  /** Called whenever `material` changes (a fresh private-channel key, a Refounding)
   *  so the manager can persist it and refresh the Community List. */
  onMaterialChange?: (material: JoinMaterial) => void;
  /** Called when a Refounding excludes us (CORD-06): the manager tombstones the
   *  membership and drops the community. */
  onRemoved?: (communityId: string) => void;
}

/** Options for constructing the multi-community {@link ConcordClient} manager. */
export interface ConcordClientOptions {
  /** The logged-in user's signer. */
  signer: ISigner;
  /** The logged-in user's hex pubkey. */
  pubkey: string;
  /** The applesauce RelayPool used for all subscriptions/publishes. */
  pool: RelayPool;
  /** Shared wrap-level store. Defaults to a fresh {@link EventStore}. */
  eventStore?: EventStore;
  /** Persistence for the membership/key material mirror + sync cursors. */
  storage?: ConcordStorage;
  /** Media uploader, passed through to every community. */
  uploader?: ConcordUploader;
  /** Fallback relays when a community defines none. */
  relays?: string[];
  /** Per-plane store factory (persistent cache), passed through to every community. */
  storeFactory?: ConcordStoreFactory;
}
