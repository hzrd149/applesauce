import hash_sum from "hash-sum";
import { ProfilePointer } from "nostr-tools/nip19";
import { identity, map } from "rxjs";
import { Model } from "../event-store/interface.js";
import { selectOptimalRelays, SelectOptimalRelaysOptions } from "../helpers/relay-selection.js";
import { ignoreBlacklistedRelays, includeMailboxes } from "../observable/relay-selection.js";

export type OutboxModelOptions = SelectOptimalRelaysOptions & {
  type?: "inbox" | "outbox";
  blacklist?: Parameters<typeof ignoreBlacklistedRelays>[0];
};

/** A model that returns the users contacts with the relays to connect to */
export function OutboxModel(user: string | ProfilePointer, opts: OutboxModelOptions): Model<ProfilePointer[]> {
  return (store) =>
    store.contacts(user).pipe(
      /** Ignore blacklisted relays */
      opts?.blacklist ? ignoreBlacklistedRelays(opts.blacklist) : identity,
      /** Include mailboxes */
      includeMailboxes(store, opts.type),
      /** Select the optimal relays */
      map((users) => selectOptimalRelays(users, opts)),
    );
}

OutboxModel.getKey = (user: string | ProfilePointer, opts: OutboxModelOptions) => {
  const p = typeof user === "string" ? user : user.pubkey;
  return hash_sum([p, opts.type, opts.maxConnections, opts.maxRelaysPerUser]);
};
