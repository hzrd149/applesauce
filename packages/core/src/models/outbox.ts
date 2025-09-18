import { ProfilePointer } from "nostr-tools/nip19";
import { Model } from "../event-store/interface.js";
import { ignoreBlacklistedRelays, includeLegacyAppRelays, includeMailboxes } from "../observable/relay-selection.js";
import { selectOptimalRelays, SelectOptimalRelaysOptions, sortRelaysByPopularity } from "../helpers/relay-selection.js";
import { identity, map } from "rxjs";
import hash_sum from "hash-sum";

export type OutboxModelOptions = SelectOptimalRelaysOptions & {
  type?: "inbox" | "outbox";
  blacklist: Parameters<typeof ignoreBlacklistedRelays>[0];
};

/** A model that returns the users contacts with the relays to connect to */
export function OutboxModel(user: string | ProfilePointer, opts: OutboxModelOptions): Model<ProfilePointer[]> {
  return (store) =>
    store.contacts(user).pipe(
      /** Ignore blacklisted relays */
      opts?.blacklist ? ignoreBlacklistedRelays(opts.blacklist) : identity,
      /** Include mailboxes */
      includeMailboxes(store, opts.type),
      /** Include legacy app relays */
      includeLegacyAppRelays(store, opts.type),
      /** Sort the relays by popularity */
      map(sortRelaysByPopularity),
      /** Select the optimal relays */
      map((users) => selectOptimalRelays(users, opts)),
    );
}

OutboxModel.getKey = (user: string | ProfilePointer, opts: OutboxModelOptions) => {
  const p = typeof user === "string" ? user : user.pubkey;
  return hash_sum([
    p,
    opts.type,
    opts.maxConnections,
    opts.maxRelayCoverage,
    opts.maxRelaysPerUser,
    opts.minRelaysPerUser,
  ]);
};
