import { NostrEvent } from "applesauce-core/helpers";
import { switchMap } from "rxjs";
import {
  getMonitorChecks,
  getMonitorFrequency,
  getMonitorGeohash,
  getMonitorTimeouts,
  isValidRelayMonitorAnnouncement,
  RELAY_DISCOVERY_KIND,
  RelayMonitorAnnouncementEvent,
} from "../helpers/relay-discovery.js";
import { castEventStream } from "../observable/cast-stream.js";
import { chainable } from "../observable/chainable.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { RelayDiscovery } from "./relay-discovery.js";

/** Cast a kind 10166 event to a RelayMonitor */
export class RelayMonitor extends EventCast<RelayMonitorAnnouncementEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidRelayMonitorAnnouncement(event)) throw new Error("Invalid relay monitor announcement");
    super(event, store);
  }

  /** Gets the frequency at which this monitor publishes events (in seconds) */
  get frequency() {
    return getMonitorFrequency(this.event);
  }

  /** Gets all timeout values from this monitor announcement */
  get timeouts() {
    return getMonitorTimeouts(this.event);
  }

  /** Gets all checks conducted by this monitor */
  get checks() {
    return getMonitorChecks(this.event);
  }

  /** Gets the geohash from this monitor announcement (NIP-52 geohash) */
  get geohash() {
    return getMonitorGeohash(this.event);
  }

  /** Get the status of a relay from this monitor */
  relayStatus(relay: string) {
    return chainable(
      this.author.outboxes$.pipe(
        switchMap((outboxes) =>
          this.store
            .replaceable({
              kind: RELAY_DISCOVERY_KIND,
              pubkey: this.author.pubkey,
              identifier: relay,
              relays: outboxes,
            })
            .pipe(castEventStream(RelayDiscovery, this.store)),
        ),
      ),
    );
  }
}
