import type { EventStore } from "applesauce-core";
import type { ISigner } from "applesauce-signers";
import type { RelayPool } from "applesauce-relay";
import type { Debugger } from "debug";
import type { Observable } from "rxjs";

import type { WalletToken } from "../casts/wallet-token.js";
import type { Couch } from "../helpers/couch.js";

/** Options for constructing a {@link NutWallet} */
export interface NutWalletOptions {
  /** The pubkey of the wallet owner */
  pubkey: string;
  /** A signer used to sign events and decrypt the wallet (must support NIP-44 to unlock) */
  signer: ISigner;
  /** The relay pool used for loading, syncing and publishing wallet events */
  pool: RelayPool;
  /** The event store that holds all wallet, token and history events */
  eventStore: EventStore;
  /** A couch used to keep tokens safe during multi-step operations */
  couch: Couch;
  /**
   * Override the relay set used for loading and publishing.
   * When omitted, the relays are derived from the wallet's own relay list plus the user's outbox relays.
   */
  relays?: string[] | Observable<string[]>;
  /** Automatically unlock the wallet, tokens and history as they load */
  autoUnlock?: boolean;
  /** A custom debug logger (defaults to the "applesauce:nut-wallet" namespace) */
  logger?: Debugger;
}

/** Options for creating a new NIP-60 wallet */
export interface CreateWalletOptions {
  /** The mints the wallet will use */
  mints: string[];
  /** An optional P2PK private key, required for receiving nutzaps */
  privateKey?: Uint8Array;
  /** The relays the wallet should publish its events to */
  relays?: string[];
}

/** The high-level lifecycle status of a {@link NutWallet} */
export enum WalletStatus {
  /** {@link NutWallet.start} has not been called */
  Idle = "idle",
  /** Started and waiting for the initial load to complete */
  Loading = "loading",
  /** Loaded and a wallet event exists */
  Ready = "ready",
  /** Loaded but no wallet event was found for the pubkey */
  Missing = "missing",
}

/** The named async operations a {@link NutWallet} can be performing */
export type NutWalletOperation =
  | "create"
  | "unlock"
  | "lock"
  | "send"
  | "receive"
  | "consolidate"
  | "recover"
  | "sync"
  | "setMints"
  | "setRelays";

/** The relay coverage of a single token event */
export interface TokenCoverage {
  /** The token cast */
  token: WalletToken;
  /** The relays this token event has been seen on (normalized) */
  seen: string[];
  /** The target relays that are storing this token event */
  stored: string[];
  /** The target relays that are missing this token event */
  missing: string[];
}

/** A snapshot of how the wallet's token events are spread across its relays */
export interface TokenRelayCoverage {
  /** The relays tokens should be stored on (the wallet's relays, or the union of seen relays as a fallback) */
  relays: string[];
  /** The total number of token events */
  total: number;
  /** The number of token events each relay is storing, keyed by relay url */
  perRelay: Record<string, number>;
  /** Per-token coverage details */
  tokens: TokenCoverage[];
}

/** A snapshot of the connection state of a single wallet relay */
export interface RelayStatusInfo {
  url: string;
  /** Whether the websocket is connected */
  connected: boolean;
  /** Whether the relay is ready for use */
  ready: boolean;
  /** Whether the relay is authenticated */
  authenticated: boolean;
  /** Whether the relay supports NIP-77 negentropy sync (undefined until probed) */
  negentropy?: boolean;
}
