import type { EncryptedContentCache } from "applesauce-common/helpers";
import type { EventStore } from "applesauce-core";
import type { EventTemplate } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";

/** A napplet signing request passed to {@link KehtoContext.approve} */
export interface KehtoSignRequest {
  /** The napplet window asking to sign, when kehto knows it */
  windowId?: string;
  /** The unsigned event the napplet wants signed */
  template: EventTemplate;
}

/** The applesauce instances the kehto integrations are built from */
export interface KehtoContext {
  /** The relay pool used for all napplet relay traffic */
  pool: RelayPool;
  /** The shared event store, with its event loader configured by the host */
  eventStore: EventStore;
  /** The signer used for napplet signing, or an observable of it such as `AccountManager.active$` */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** Whether napplet reads decrypt encrypted content with the current signer (default true) */
  decrypt?: boolean;
  /** The host plaintext cache, keyed by account pubkey and event id */
  decryptionCache?: EncryptedContentCache;
  /** Relays used when no outbox or relay hints are available */
  fallbackRelays?: string[] | Observable<string[]>;
  /** Blossom servers used when the user has no server list */
  fallbackBlossomServers?: string[] | Observable<string[]>;
  /** Asks the user to approve a napplet signing request, signing is allowed when omitted */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
  /** How long to wait for missing data before answering a napplet, in milliseconds */
  timeout?: number;
}
