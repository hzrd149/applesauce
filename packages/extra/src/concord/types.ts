// Concord protocol types.

import type { NostrEvent } from "nostr-tools";

// ---- Kinds (CORD-02 Appendix B, frozen) -----------------------------------
export const KIND = {
  WRAP: 1059,
  WRAP_EPHEMERAL: 21059,
  SEAL_ENCRYPTED: 20013,
  SEAL_PLAINTEXT: 20014,
  MESSAGE: 9,
  REACTION: 7,
  DELETE: 5,
  EDIT: 3302,
  REKEY: 3303,
  JOIN_LEAVE: 3306,
  CONTROL: 3308,
  KICK: 3309,
  WEBXDC: 3310,
  SNAPSHOT: 3312,
  TYPING: 23311,
  VOICE_PRESENCE: 23313,
  HTTP_AUTH: 27235,
  INVITE_BUNDLE: 33301,
  COMMUNITY_LIST: 13302,
  INVITE_LIST: 13303,
} as const;

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
export interface Rumor {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
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

// ---- A folded, in-memory Community ----------------------------------------
export interface CommunityState {
  material: JoinMaterial;
  metadata?: CommunityMetadata;
  channels: ChannelMetadata[];
  roles: Role[];
  grants: Map<string, string[]>; // member -> role_ids
  banlist: Set<string>;
  members: Set<string>;
  dissolved: boolean;
  /** Winning head edition per entity (eid → decoded), for CORD-06 compaction. */
  heads?: Map<string, DecodedEvent>;
}

export type RawEvent = NostrEvent;
