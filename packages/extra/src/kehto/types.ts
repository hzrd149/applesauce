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
  /** The event store used as the shared cache for every napplet */
  eventStore: EventStore;
  /** The signer used for napplet signing, or an observable of it such as `AccountManager.active$` */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** Relays used to look up profiles and relay lists, such as `lookupRelays$` from app settings */
  lookupRelays?: string[] | Observable<string[]>;
  /** Relays used when no outbox or relay hints are available */
  fallbackRelays?: string[] | Observable<string[]>;
  /** Asks the user to approve a napplet signing request, signing is allowed when omitted */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
  /** How long to wait for missing data before answering a napplet, in milliseconds */
  timeout?: number;
}
