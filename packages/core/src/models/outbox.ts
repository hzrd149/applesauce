import hash_sum from "hash-sum";
import { identity, map, type Observable } from "rxjs";
import { Model } from "../event-store/interface.js";
import { ProfilePointer } from "../helpers/pointers.js";
import { type RelayLivenessFilterOptions } from "../helpers/relay-liveness-filter.js";
import { selectOptimalRelays, SelectOptimalRelaysOptions } from "../helpers/relay-selection.js";
import { ignoreBlacklistedRelays, ignoreDeadRelays, includeMailboxes } from "../observable/relay-selection.js";

export type OutboxModelOptions = SelectOptimalRelaysOptions & {
  type?: "inbox" | "outbox";
  blacklist?: Parameters<typeof ignoreBlacklistedRelays>[0];
  /** Known-alive relay URLs from NIP-66 monitors. Empty/absent = no liveness filtering. */
  aliveRelays?: ReadonlySet<string> | Observable<ReadonlySet<string>>;
  /** Safety options for the liveness filter */
  livenessFilter?: RelayLivenessFilterOptions;
  /** Cache key discriminator for liveness data (like scoreId for Thompson) */
  livenessId?: string;
};

/** A model that returns the users contacts with the relays to connect to */
export function OutboxModel(user: string | ProfilePointer, opts: OutboxModelOptions): Model<ProfilePointer[]> {
  return (store) =>
    store.contacts(user).pipe(
      /** Ignore blacklisted relays */
      opts?.blacklist ? ignoreBlacklistedRelays(opts.blacklist) : identity,
      /** Include mailboxes */
      includeMailboxes(store, opts.type),
      /** Remove dead relays using NIP-66 monitor data */
      opts?.aliveRelays ? ignoreDeadRelays(opts.aliveRelays, opts.livenessFilter) : identity,
      /** Select the optimal relays */
      map((users) => selectOptimalRelays(users, opts)),
    );
}

OutboxModel.getKey = (user: string | ProfilePointer, opts: OutboxModelOptions) => {
  const p = typeof user === "string" ? user : user.pubkey;
  return hash_sum([p, opts.type, opts.maxConnections, opts.maxRelaysPerUser, opts.livenessId]);
};
