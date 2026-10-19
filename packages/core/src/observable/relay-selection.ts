import {
  combineLatestWith,
  isObservable,
  map,
  Observable,
  of,
  pipe,
  Subscription,
  type MonoTypeOperatorFunction,
  type OperatorFunction,
} from "rxjs";
import { IEventSubscriptions } from "../event-store/interface.js";
import { NostrEvent } from "../helpers/event.js";
import { getInboxes, getOutboxes } from "../helpers/mailboxes.js";
import { addRelayHintsToPointer, ProfilePointer } from "../helpers/pointers.js";
import { removeBlacklistedRelays, selectOptimalRelays, setFallbackRelays } from "../helpers/relay-selection.js";

/** A user's relay list subscription and the pointer built from it */
type MailboxList = {
  sub?: Subscription;
  event?: NostrEvent;
  /** Users without a relay list emit undefined and stay in the output without relays */
  ready: boolean;
  done: boolean;
  user?: ProfilePointer;
  pointer?: ProfilePointer;
};

/** RxJS operator that fetches outboxes for profile pointers from the event store */
export function includeMailboxes(
  store: IEventSubscriptions,
  type: "inbox" | "outbox" = "outbox",
): OperatorFunction<ProfilePointer[], ProfilePointer[]> {
  // Add the relays from a user's relay list to the user
  const withRelays = (user: ProfilePointer, event: NostrEvent | undefined) => {
    if (!event) return user;
    const relays = type === "outbox" ? getOutboxes(event) : getInboxes(event);
    return relays ? addRelayHintsToPointer(user, relays) : user;
  };

  return (source) =>
    new Observable<ProfilePointer[]>((observer) => {
      // Relay list subscriptions by pubkey, kept while the pubkey stays in the contacts so a change only subscribes to new users
      const lists = new Map<string, MailboxList>();
      let contacts: ProfilePointer[] | undefined;
      let updating = false;
      let sourceDone = false;

      // Like combineLatest, wait until every user's relay list has emitted
      const emit = () => {
        if (updating || !contacts) return;
        const users: ProfilePointer[] = [];
        for (const user of contacts) {
          const list = lists.get(user.pubkey)!;
          if (!list.ready) return;
          // Only rebuild the pointer when the relay list or the contact changed
          if (list.user !== user) {
            list.user = user;
            list.pointer = withRelays(user, list.event);
          }
          users.push(list.pointer!);
        }
        observer.next(users);
      };

      const complete = () => {
        if (sourceDone && Array.from(lists.values()).every((list) => list.done)) observer.complete();
      };

      const sub = source.subscribe({
        next: (next) => {
          contacts = next;
          // Hold emissions until every new subscription is open, so one contacts change emits once
          updating = true;

          const pubkeys = new Set(next.map((user) => user.pubkey));
          for (const [pubkey, list] of lists) {
            if (pubkeys.has(pubkey)) continue;
            list.sub?.unsubscribe();
            lists.delete(pubkey);
          }

          for (const pubkey of pubkeys) {
            if (lists.has(pubkey)) continue;
            const list: MailboxList = { ready: false, done: false };
            lists.set(pubkey, list);
            list.sub = store.replaceable({ kind: 10002, pubkey }).subscribe({
              next: (event) => {
                list.event = event;
                list.user = undefined;
                list.ready = true;
                emit();
              },
              error: (err) => observer.error(err),
              complete: () => {
                list.done = true;
                complete();
              },
            });
          }

          updating = false;
          emit();
        },
        error: (err) => observer.error(err),
        complete: () => {
          sourceDone = true;
          complete();
        },
      });

      return () => {
        sub.unsubscribe();
        for (const list of lists.values()) list.sub?.unsubscribe();
        lists.clear();
      };
    });
}

/** Removes blacklisted relays from the user's relays */
export function ignoreBlacklistedRelays(
  blacklist: string[] | Observable<string[]>,
): MonoTypeOperatorFunction<ProfilePointer[]> {
  return pipe(
    // Combine with the observable so it re-emits when the blacklist changes
    combineLatestWith(isObservable(blacklist) ? blacklist : of(blacklist)),
    // Filter the relays for the user
    map(([users, blacklist]) => removeBlacklistedRelays(users, blacklist)),
  );
}

/** Sets fallback relays for any user that has 0 relays */
export function includeFallbackRelays(
  fallbacks: string[] | Observable<string[]>,
): MonoTypeOperatorFunction<ProfilePointer[]> {
  return pipe(
    // Get the fallbacks from the observable
    combineLatestWith(isObservable(fallbacks) ? fallbacks : of(fallbacks)),
    // Set the fallback relays for the users
    map(([users, fallbacks]) => setFallbackRelays(users, fallbacks)),
  );
}

/** A operator calls {@link selectOptimalRelays} and filters the relays for the user */
export function filterOptimalRelays(
  maxConnections: number | Observable<number>,
  maxRelaysPerUser: number | Observable<number>,
): MonoTypeOperatorFunction<ProfilePointer[]> {
  return pipe(
    // Combine with the observable so it re-emits when the max connections and max relays per user change
    combineLatestWith(
      isObservable(maxConnections) ? maxConnections : of(maxConnections),
      isObservable(maxRelaysPerUser) ? maxRelaysPerUser : of(maxRelaysPerUser),
    ),
    // Filter the relays for the user
    map(([users, maxConnections, maxRelaysPerUser]) =>
      selectOptimalRelays(users, { maxConnections, maxRelaysPerUser }),
    ),
  );
}
