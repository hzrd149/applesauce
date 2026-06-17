import type { MeltProofsResponse, MeltQuoteBolt11Response, MintQuoteBolt11Response } from "@cashu/cashu-ts";
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
  /**
   * Whether to load, subscribe to and publish NIP-09 delete events for the wallet's events (default false).
   * When false the wallet completely ignores kind-5 delete events: the loader never fetches or subscribes to
   * them (so the event store never applies a delete to a wallet, token or history event), and
   * spend/rollover/consolidate operations rely on each new token event's `del` field to reconcile the balance
   * instead of publishing a delete. {@link NutWallet.cleanupDeletedTokens} still publishes a delete event when
   * called explicitly. The publishing half can be toggled at runtime with {@link NutWallet.setUseDeleteEvents};
   * the loading half is fixed when the wallet starts and only changes on the next {@link NutWallet.resync}.
   */
  useDeleteEvents?: boolean;
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

/** Options for depositing into a mint over bolt11 (a lightning invoice) */
export interface Bolt11DepositOptions {
  /** The payment method (defaults to `"bolt11"`) */
  method?: "bolt11";
  /** The mint url to deposit into */
  mint: string;
  /** The amount to deposit in sats */
  amount: number;
  /** An optional description for the generated lightning invoice */
  description?: string;
  /** Called with the mint quote so the caller can display the lightning invoice to pay */
  onQuote?: (quote: MintQuoteBolt11Response) => void;
  /** Aborts waiting for the quote to be paid */
  signal?: AbortSignal;
  /** Rejects if the quote is not paid within this many milliseconds */
  timeoutMs?: number;
}

/**
 * Options for {@link NutWallet.deposit}. A discriminated union keyed by `method`; new payment methods
 * are added as additional members without changing existing call sites.
 */
export type DepositOptions = Bolt11DepositOptions;

/** Options for withdrawing from a mint over bolt11 (paying a lightning invoice) */
export interface Bolt11WithdrawOptions {
  /** The payment method (defaults to `"bolt11"`) */
  method?: "bolt11";
  /** The mint url to withdraw from */
  mint: string;
  /** The bolt11 lightning invoice to pay */
  invoice: string;
}

/**
 * Options for {@link NutWallet.withdraw}. A discriminated union keyed by `method`; new payment methods
 * are added as additional members without changing existing call sites.
 */
export type WithdrawOptions = Bolt11WithdrawOptions;

/** The response from a {@link NutWallet.withdraw} over bolt11 */
export type Bolt11WithdrawResponse = MeltProofsResponse<MeltQuoteBolt11Response>;

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
  | "mintQuote"
  | "mint"
  | "melt"
  | "consolidate"
  | "rollover"
  | "cleanup"
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
