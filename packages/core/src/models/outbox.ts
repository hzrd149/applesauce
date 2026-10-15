import hash_sum from "hash-sum";
import { identity, map } from "rxjs";
import { Model } from "../event-store/interface.js";
import { ProfilePointer } from "../helpers/pointers.js";
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
      /** Include mailboxes */
      includeMailboxes(store, opts.type),
      /** Ignore blacklisted relays, after mailboxes so relay lists can't add them back */
      opts?.blacklist ? ignoreBlacklistedRelays(opts.blacklist) : identity,
      /** Select the optimal relays */
      map((users) => selectOptimalRelays(users, opts)),
    );
}

// Observables and functions can't be compared by value, so each instance gets a stable id for the cache key
const optionIds = new WeakMap<object, number>();
let nextOptionId = 0;
function optionKey(value: unknown) {
  if (typeof value !== "function" && (typeof value !== "object" || value === null || Array.isArray(value)))
    return value;

  let id = optionIds.get(value);
  if (id === undefined) optionIds.set(value, (id = nextOptionId++));
  return `ref:${id}`;
}

OutboxModel.getKey = (user: string | ProfilePointer, opts: OutboxModelOptions) => {
  const p = typeof user === "string" ? user : user.pubkey;
  return hash_sum([
    p,
    opts.type,
    opts.maxConnections,
    opts.maxRelaysPerUser,
    optionKey(opts.blacklist),
    optionKey(opts.score),
  ]);
};
