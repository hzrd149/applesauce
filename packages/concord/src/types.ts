// Concord protocol types.

import type { Rumor } from "applesauce-common/helpers";
import type { NostrEvent } from "applesauce-core/helpers/event";

// ---- Kinds (CORD-02 Appendix B, frozen) -----------------------------------
//
// Concord-specific protocol kinds live next to their domain helpers (e.g.
// GIFT_WRAP_KIND in helpers/gift-wrap.ts, CONTROL_KIND in helpers/control.ts),
// so each kind ships alongside the code that folds it. Standard Nostr content
// kinds that ride a channel (chat message 9, reaction 7, deletion 5, forum
// thread 11, NIP-22 comment 1111, …) are referenced from their canonical source
// (applesauce-core `kinds` / applesauce-common `COMMENT_KIND`).

// ---- Control-plane entity sub-kinds (vsk) ---------------------------------
export const VSK = {
  METADATA: 0,
  ROLE: 1,
  CHANNEL: 2,
  GRANT: 3,
  BANLIST: 4,
  INVITE_REGISTRY: 8,
  DISSOLVED: 10,
} as const;

// ---- Permission bits (CORD-04 §3, frozen) ---------------------------------
export const PERM = {
  MANAGE_ROLES: 1n << 0n,
  MANAGE_CHANNELS: 1n << 1n,
  MANAGE_METADATA: 1n << 2n,
  KICK: 1n << 3n,
  BAN: 1n << 4n,
  MANAGE_MESSAGES: 1n << 5n,
  CREATE_INVITE: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 8n,
  MENTION_EVERYONE: 1n << 9n,
} as const;

export type PermName = keyof typeof PERM;

/** The union of all management bits — a conventional "admin" role. */
export const ADMIN_PERMS =
  PERM.MANAGE_ROLES |
  PERM.MANAGE_CHANNELS |
  PERM.MANAGE_METADATA |
  PERM.KICK |
  PERM.BAN |
  PERM.MANAGE_MESSAGES |
  PERM.CREATE_INVITE |
  PERM.VIEW_AUDIT_LOG |
  PERM.MENTION_EVERYONE;

// ---- Rumor (the innermost, unsigned event) --------------------------------
// Re-exported from applesauce-core so concord shares the single canonical
// rumor type instead of defining its own.
export type { Rumor };

/** An unsigned rumor template — the functional event before it is sealed/wrapped. */
export interface RumorTemplate {
  kind: number;
  content: string;
  tags: string[][];
  created_at?: number;
}

/** A decoded plane event: the rumor plus its verified real author. */
export interface DecodedEvent {
  rumor: Rumor;
  author: string;
  wrapId: string;
  sealKind: number;
  /** millisecond-resolution ordering time (CORD-02 §4) */
  ms: number;
  /** The verified seal event — retained for CORD-06 compaction (re-wrapping a
   *  plaintext control seal into a new epoch). Absent on cache-rehydrated events. */
  seal?: NostrEvent;
}

// ---- Metadata (vsk 0 / CORD-02 §6) ----------------------------------------
export interface BlobPointer {
  url: string;
  key: string;
  nonce: string;
  hash: string;
}
export interface CommunityMetadata {
  name: string;
  description?: string;
  relays: string[];
  /** Blossom media servers the community prefers for its encrypted images. */
  blossom_servers?: string[];
  icon?: BlobPointer;
  banner?: BlobPointer;
  custom?: Record<string, unknown>;
}

// ---- Role (vsk 1) ---------------------------------------------------------
export interface RoleScope {
  kind: "server" | "channel";
  channel_id?: string;
}
export interface Role {
  role_id: string;
  name: string;
  position: number;
  permissions: string; // decimal string
  scope: RoleScope;
  color: number;
}

// ---- Channel metadata (vsk 2) ---------------------------------------------
export interface ChannelMetadata {
  channel_id: string;
  name: string;
  private: boolean;
  deleted?: boolean;
  /** CORD-07 §1: a voice/video Channel. Folds like any other channel property. */
  voice?: boolean;
  custom?: Record<string, unknown>;
  // client-tracked keying (from invite / derivation), not part of the edition:
  key?: string; // private channel key hex; undefined => public (community_root)
  epoch?: number;
}

// ---- Grant (vsk 3) --------------------------------------------------------
export interface Grant {
  member: string;
  role_ids: string[];
}

// ---- Community membership material (invite subset, CORD-05 §1) ------------
export interface ChannelKey {
  id: string;
  key: string; // hex
  epoch: number;
  name: string;
}
export interface JoinMaterial {
  community_id: string;
  owner: string;
  owner_salt: string;
  community_root: string;
  root_epoch: number;
  channels: ChannelKey[];
  relays: string[];
  name: string;
  /** Retained prior roots `[{epoch, key}]` after a Refounding (CORD-06; armada-compatible). */
  held_roots?: Array<{ epoch: number; key: string }>;
  /** The npub whose Refounding minted the current `root_epoch` (CORD-06). */
  refounder?: string;
}

// ---- Invite bundle (CORD-05 §1) -------------------------------------------
export interface InviteBundle extends JoinMaterial {
  icon?: BlobPointer;
  expires_at?: number;
  creator_npub?: string;
  label?: string;
}

// ---- Community List (kind 13302 / CORD-02 §8) -----------------------------
// A member's private, self-encrypted membership document. One replaceable event
// per user; nothing is ever deleted and liveness is derived (a re-join
// resurrects a tombstoned id). The wire document keys the array as `entries`,
// but the in-memory API exposes it as `communities`.
export interface CommunityListCommunity {
  community_id: string;
  /** Earliest epoch held — the backfill anchor (only ever moves backward on merge). */
  seed: JoinMaterial;
  /** Freshest snapshot — replaced on every Refounding or rename. */
  current: JoinMaterial;
  /** ms; tiebreaks against a tombstone's removed_at. */
  added_at: number;
  [k: string]: unknown;
}
export interface CommunityTombstone {
  community_id: string;
  /** ms. Permanent — pruning would let a long-offline device resurrect a leave. */
  removed_at: number;
  [k: string]: unknown;
}

// ---- Invite List (kind 13303 / CORD-05 §4) --------------------------------
// A creator's private, self-encrypted bookkeeping for the invite links they
// have minted. One replaceable event per user; the full merged document is
// (re)published on every change.
export interface InviteListInvite {
  /** The link's unlock secret and its merge key. */
  token: string;
  /** The `link_signer` secret key hex (CORD-05 §2). */
  signer_sk: string;
  community_id: string;
  /** The full shareable invite URL. */
  url: string;
  label?: string;
  /** Unix seconds the link was minted. */
  created_at: number;
  /** Optional unix-second expiry. */
  expires_at?: number;
  [k: string]: unknown;
}
export interface InviteListTombstone {
  token: string;
  community_id: string;
  [k: string]: unknown;
}

// ---- A folded, in-memory Community ----------------------------------------
export interface CommunityState {
  material: JoinMaterial;
  metadata?: CommunityMetadata;
  channels: ChannelMetadata[];
  roles: Role[];
  grants: Map<string, string[]>; // member -> role_ids
  banlist: Set<string>;
  /** Aggregate live invite-link coordinates (link_signer pubkeys) folded from
   *  every authorized creator's Registry; non-empty ⇒ the Community is Public
   *  (CORD-05 §5). */
  inviteLinks: Set<string>;
  members: Set<string>;
  dissolved: boolean;
  /** Winning head edition per entity (eid → decoded), for CORD-06 compaction. */
  heads?: Map<string, DecodedEvent>;
}

export type RawEvent = NostrEvent;
