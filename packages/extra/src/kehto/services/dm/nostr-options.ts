import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { KehtoAccount } from "../../foundation/account.js";
import type { KehtoSignRequest } from "../../types.js";

/** Shared Nostr dependencies for wrapped or legacy message protocol adapters */
export interface NostrMessageProtocolOptions {
  /** The shared host event store with its loaders configured */
  eventStore: EventStore;
  /** The relay pool used for encrypted message traffic */
  pool: RelayPool;
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The shared resolved account stream, overriding signer resolution */
  account$?: Observable<KehtoAccount | undefined>;
  /** The wait for relay discovery and responses in milliseconds (default 4000) */
  timeout?: number;
  /** The maximum wait for decrypting one message in milliseconds (default 60000) */
  decryptionTimeout?: number;
  /** The maximum wait for approval and send preparation in milliseconds (default 120000) */
  actionTimeout?: number;
  /** The fallback read relays and legacy delivery relays, never used for NIP-17 publication */
  fallbackRelays?: string[] | Observable<string[]>;
  /** The host approval callback receiving the plaintext message template before encryption or signing */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
}
