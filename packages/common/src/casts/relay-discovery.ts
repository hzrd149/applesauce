import { NostrEvent } from "applesauce-core/helpers";
import {
  getRelayDiscoveryAcceptedKinds,
  getRelayDiscoveryAttributes,
  getRelayDiscoveryGeohash,
  getRelayDiscoveryNetworkType,
  getRelayDiscoveryRequirements,
  getRelayDiscoveryRTT,
  getRelayDiscoverySupportedNIPs,
  getRelayDiscoveryTopics,
  getRelayDiscoveryURL,
  isValidRelayDiscovery,
  RelayDiscoveryEvent,
} from "../helpers/relay-discovery.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast a kind 30166 event to a RelayDiscovery */
export class RelayDiscovery extends EventCast<RelayDiscoveryEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidRelayDiscovery(event)) throw new Error("Invalid relay discovery event");
    super(event, store);
  }

  /** Gets the relay URL from this discovery event (from the `d` tag) */
  get url() {
    return getRelayDiscoveryURL(this.event);
  }

  /** Gets the round-trip time (RTT) for opening the relay connection (in milliseconds) */
  get rttOpen() {
    return getRelayDiscoveryRTT(this.event, "open");
  }

  /** Gets the round-trip time (RTT) for reading from the relay (in milliseconds) */
  get rttRead() {
    return getRelayDiscoveryRTT(this.event, "read");
  }

  /** Gets the round-trip time (RTT) for writing to the relay (in milliseconds) */
  get rttWrite() {
    return getRelayDiscoveryRTT(this.event, "write");
  }

  /** Gets the network type from this discovery event (clearnet, tor, i2p, loki) */
  get networkType() {
    return getRelayDiscoveryNetworkType(this.event);
  }

  /** Gets all relay attributes from this discovery event (from `W` tags) */
  get attributes() {
    return getRelayDiscoveryAttributes(this.event);
  }

  /** Gets all supported NIPs from this discovery event (from `N` tags) */
  get supportedNIPs() {
    return getRelayDiscoverySupportedNIPs(this.event);
  }

  /** Gets all requirements from this discovery event (from `R` tags) */
  get requirements() {
    return getRelayDiscoveryRequirements(this.event);
  }

  /** Gets all topics from this discovery event (from `t` tags) */
  get topics() {
    return getRelayDiscoveryTopics(this.event);
  }

  /** Gets all accepted and unaccepted kinds from this discovery event (from `k` tags) */
  get acceptedKinds() {
    return getRelayDiscoveryAcceptedKinds(this.event);
  }

  /** Gets the geohash from this discovery event (NIP-52 geohash) */
  get geohash() {
    return getRelayDiscoveryGeohash(this.event);
  }
}
