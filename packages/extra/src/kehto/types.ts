import type { IEventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";

/** The applesauce instances the kehto integrations are built from */
export interface KehtoContext {
  /** The relay pool used for all napplet relay traffic */
  pool: RelayPool;
  /** The event store used as the shared cache for every napplet */
  eventStore: IEventStore;
  /** The signer used for napplet signing, or an observable of it such as `AccountManager.active$` */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** Relays used to look up profiles and relay lists, such as `lookupRelays$` from app settings */
  lookupRelays?: string[] | Observable<string[]>;
  /** Relays used when no outbox or relay hints are available */
  fallbackRelays?: string[] | Observable<string[]>;
}
