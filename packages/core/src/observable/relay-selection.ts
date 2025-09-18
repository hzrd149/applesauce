import { ProfilePointer } from "nostr-tools/nip19";
import {
  combineLatest,
  combineLatestWith,
  defaultIfEmpty,
  EMPTY,
  map,
  of,
  pipe,
  switchMap,
  timeout,
  type MonoTypeOperatorFunction,
  type Observable,
  type OperatorFunction,
} from "rxjs";
import { IEventSubscriptions } from "../event-store/interface.js";
import { getRelaysFromContactsEvent } from "../helpers/contacts.js";
import { getInboxes, getOutboxes } from "../helpers/mailboxes.js";
import { addRelayHintsToPointer } from "../helpers/pointers.js";
import { defined } from "./defined.js";
import { logger } from "../logger.js";

const log = logger.extend("relay-selection");

/** RxJS operator that fetches outboxes for profile pointers from the event store */
export function includeMailboxes(
  store: IEventSubscriptions,
  type: "inbox" | "outbox" = "outbox",
): OperatorFunction<ProfilePointer[], ProfilePointer[]> {
  // Get the outboxes for all contacts
  return switchMap((contacts) =>
    combineLatest(
      contacts.map((contact) =>
        // Get the outboxes for the contact
        store
          .replaceable({
            kind: 10002,
            pubkey: contact.pubkey,
            relays: contact.relays,
          })
          .pipe(
            // Wait for the event to be defined
            defined(),
            // Merge the outboxes into the pointer
            map((event) => {
              const relays = type === "outbox" ? getOutboxes(event) : getInboxes(event);
              if (!relays) return contact;

              return addRelayHintsToPointer(contact, relays);
            }),
            // Timeout the request if it takes too long
            timeout({ first: 5_000, with: () => EMPTY }),
            // If no event is found, return the contact
            defaultIfEmpty(contact),
          ),
      ),
    ),
  );
}

/** An operator that reads and adds the legacy relays from the kind 3 event */
export function includeLegacyAppRelays(
  store: IEventSubscriptions,
  type: "inbox" | "outbox" = "outbox",
): OperatorFunction<ProfilePointer[], ProfilePointer[]> {
  return switchMap((users) => {
    // Get the relays for all contacts
    return combineLatest(
      users.map((contact) => {
        // If the contact already has relays don't add any
        if (contact.relays && contact.relays.length > 0) return of(contact);

        // Get the relays for the contact
        return store
          .replaceable({
            kind: 1003,
            pubkey: contact.pubkey,
            relays: contact.relays,
          })
          .pipe(
            defined(),
            // Merge the relays into the pointer
            map((event) => {
              let relays = getRelaysFromContactsEvent(event);
              if (!relays) return contact;

              // Get the write relays
              const urls = Array.from(relays.entries())
                .filter(([_, t]) => t === type || t === "all")
                .map(([relay]) => relay);

              log(`Found ${urls.length} legacy ${type} relays for ${contact.pubkey}`);

              return addRelayHintsToPointer(contact, urls);
            }),
            // Timeout the request if it takes too long
            timeout({ first: 5_000, with: () => EMPTY }),
            // If no event is found, return the contact
            defaultIfEmpty(contact),
          );
      }),
    );
  });
}

/** Removes blacklisted relays from the user's relays */
export function ignoreBlacklistedRelays(
  blacklist: string[] | Observable<string[]>,
): MonoTypeOperatorFunction<ProfilePointer[]> {
  return pipe(
    // Combine with the observable so it re-emits when the blacklist changes
    combineLatestWith(Array.isArray(blacklist) ? of(blacklist) : blacklist),
    // Filter the relays for the user
    map(([users, blacklist]) =>
      users.map((user) => {
        if (!user.relays) return user;
        return { ...user, relays: user.relays.filter((relay) => !blacklist.includes(relay)) };
      }),
    ),
  );
}
