import { ProfilePointer } from "nostr-tools/nip19";
import {
  combineLatest,
  combineLatestWith,
  isObservable,
  map,
  of,
  pipe,
  switchMap,
  type MonoTypeOperatorFunction,
  type Observable,
  type OperatorFunction,
} from "rxjs";
import { IEventSubscriptions } from "../event-store/interface.js";
import { getInboxes, getOutboxes } from "../helpers/mailboxes.js";
import { addRelayHintsToPointer } from "../helpers/pointers.js";

/** RxJS operator that fetches outboxes for profile pointers from the event store */
export function includeMailboxes(
  store: IEventSubscriptions,
  type: "inbox" | "outbox" = "outbox",
): OperatorFunction<ProfilePointer[], ProfilePointer[]> {
  // Get the outboxes for all contacts
  return switchMap((contacts) =>
    combineLatest(
      contacts.map((user) =>
        // Subscribe to the outboxes for the user
        store
          .replaceable({
            kind: 10002,
            pubkey: user.pubkey,
          })
          .pipe(
            // Add the relays to the user
            map((event) => {
              if (!event) return user;

              // Get the relays from the event
              const relays = type === "outbox" ? getOutboxes(event) : getInboxes(event);
              if (!relays) return user;

              // Add the relays to the user
              return addRelayHintsToPointer(user, relays);
            }),
          ),
      ),
    ),
  );
}

/** Removes blacklisted relays from the user's relays */
export function ignoreBlacklistedRelays(
  blacklist: string[] | Observable<string[]>,
): MonoTypeOperatorFunction<ProfilePointer[]> {
  return pipe(
    // Combine with the observable so it re-emits when the blacklist changes
    combineLatestWith(isObservable(blacklist) ? blacklist : of(blacklist)),
    // Filter the relays for the user
    map(([users, blacklist]) =>
      users.map((user) => {
        if (!user.relays) return user;
        return { ...user, relays: user.relays.filter((relay) => !blacklist.includes(relay)) };
      }),
    ),
  );
}
