import { addRelayHintsToPointer, getOutboxes, getRelaysFromContactsEvent } from "applesauce-core/helpers";
import type { ProfilePointer } from "nostr-tools/nip19";
import type { MonoTypeOperatorFunction, Observable, OperatorFunction } from "rxjs";
import { combineLatest, combineLatestWith, defaultIfEmpty, EMPTY, map, of, pipe, switchMap, timeout } from "rxjs";
import { AddressPointerLoader } from "../loaders/address-loader.js";

export type OutboxMap = Record<string, string[]>;

/** RxJS operator that fetches outboxes for profile pointers from the event store */
export function includeOutboxes(loader: AddressPointerLoader): OperatorFunction<ProfilePointer[], ProfilePointer[]> {
  return switchMap((contacts) => {
    // Get the outboxes for all contacts
    return combineLatest(
      contacts.map((contact) =>
        // Get the outboxes for the contact
        loader({
          kind: 10002,
          pubkey: contact.pubkey,
          relays: contact.relays,
        }).pipe(
          // Merge the outboxes into the pointer
          map((event) => {
            const relays = getOutboxes(event);
            if (!relays) return contact;

            return addRelayHintsToPointer(contact, relays);
          }),
          // Timeout the request if it takes too long
          timeout({ first: 10_000, with: () => EMPTY }),
          // If no event is found, return the contact
          defaultIfEmpty(contact),
        ),
      ),
    );
  });
}

/** An operator that reads and adds the legacy relays from the kind 3 event */
export function includeLegacyWriteRelays(
  loader: AddressPointerLoader,
  alwaysAdd = false,
): OperatorFunction<ProfilePointer[], ProfilePointer[]> {
  return switchMap((contacts) => {
    // Get the relays for all contacts
    return combineLatest(
      contacts.map((contact) => {
        // If the contact already has relays don't add any
        if (!alwaysAdd && contact.relays && contact.relays.length > 0) return of(contact);

        // Get the relays for the contact
        return loader({
          kind: 1003,
          pubkey: contact.pubkey,
          relays: contact.relays,
        }).pipe(
          // Merge the relays into the pointer
          map((event) => {
            let relays = getRelaysFromContactsEvent(event);
            if (!relays) return contact;

            // Get the write relays
            const urls = Array.from(relays.entries())
              .filter(([_, type]) => type !== "inbox")
              .map(([relay]) => relay);

            return addRelayHintsToPointer(contact, urls);
          }),
          // Timeout the request if it takes too long
          timeout({ first: 10_000, with: () => EMPTY }),
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
    combineLatestWith(Array.isArray(blacklist) ? of(blacklist) : blacklist),
    map(([users, blacklist]) =>
      users.map((user) => {
        if (!user.relays) return user;
        return { ...user, relays: user.relays.filter((relay) => !blacklist.includes(relay)) };
      }),
    ),
  );
}

/** Sorts each users relays by popularity */
export function sortRelaysByPopularity(): MonoTypeOperatorFunction<ProfilePointer[]> {
  return map((users: ProfilePointer[]) => {
    const relayUsageCount = new Map<string, number>();

    // Count the times the relays are used
    for (const element of users) {
      if (!element.relays) continue;
      element.relays.forEach((relay) => {
        relayUsageCount.set(relay, (relayUsageCount.get(relay) || 0) + 1);
      });
    }

    return users.map((user) => {
      if (!user.relays) return user;

      // Sort the user's relays by popularity
      return {
        ...user,
        relays: user.relays?.sort((a, b) => {
          const countA = relayUsageCount.get(a) || 0;
          const countB = relayUsageCount.get(b) || 0;
          return countB - countA;
        }),
      };
    });
  });
}

/** RxJS operator that aggregates contacts with outboxes into a relay -> pubkeys map */
export function groupPubkeysByRelay(pointers: ProfilePointer[]): OutboxMap {
  const outbox: OutboxMap = {};

  for (const pointer of pointers) {
    if (!pointer.relays) continue;

    for (const relay of pointer.relays) {
      if (!outbox[relay]) outbox[relay] = [];

      if (!outbox[relay]!.includes(pointer.pubkey)) {
        outbox[relay]!.push(pointer.pubkey);
      }
    }
  }

  return outbox;
}
