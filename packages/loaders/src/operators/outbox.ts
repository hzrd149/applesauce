import { logger } from "applesauce-core";
import { addRelayHintsToPointer, getOutboxes, getRelaysFromContactsEvent } from "applesauce-core/helpers";
import type { ProfilePointer } from "nostr-tools/nip19";
import type { Observable, OperatorFunction } from "rxjs";
import { combineLatest, combineLatestWith, defaultIfEmpty, EMPTY, map, of, pipe, switchMap, timeout } from "rxjs";
import { AddressPointerLoader } from "../loaders/address-loader.js";

const log = logger.extend("outbox-model");

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

export type SelectOutboxesOptions = {
  // Relays to never connect to
  blacklist?: Observable<string[]>;
  // A custom sorting function for a users relays
  sortRelays?: (pubkey: string, relays: string[]) => string[];
  // Max number of relays per pubkey
  maxPerPubkey?: number;
  /** Ignore relays with less than this number of users */
  minPerRelay?: number;
  // A function to get the default relays for a pubkey if no outboxes are found
  getDefault?: (pubkey: string) => string[];
};

/** RxJS operator that processes contacts with outboxes and applies filtering/sorting */
export function selectOutboxes(
  options: SelectOutboxesOptions = {},
): OperatorFunction<ProfilePointer[], ProfilePointer[]> {
  const { maxPerPubkey = 2, sortRelays, getDefault, minPerRelay } = options;

  return pipe(
    // Subscribe to the blacklist if provided
    combineLatestWith(options.blacklist ?? of([])),
    map(([contacts, blacklist]) => {
      log(`🔍 Processing ${contacts.length} contacts with outboxes`);

      // First pass: count relay usage across all pubkeys
      const relayUsageCount = new Map<string, number>();

      contacts.forEach(({ relays }) => {
        if (!relays) return;

        relays.forEach((relay) => {
          // Skip blacklisted relays in counting
          if (blacklist && blacklist.length > 0 && blacklist.includes(relay)) return;

          relayUsageCount.set(relay, (relayUsageCount.get(relay) || 0) + 1);
        });
      });

      log(`📊 Relay usage counts:`, Object.fromEntries(relayUsageCount));

      // Second pass: process each contact with relay popularity sorting
      return contacts.map(({ pubkey, relays }) => {
        let outboxes = relays ? Array.from(relays) : [];

        // TODO: this doesn't work well, it probably needs to do a second pass to remove relays with a single user
        // Apply minPerRelay filtering if provided
        if (minPerRelay) outboxes = outboxes.filter((relay) => relayUsageCount.get(relay)! >= minPerRelay);

        // Use default relays if no outboxes found and getDefault is provided
        if (outboxes.length === 0 && getDefault) {
          outboxes = getDefault(pubkey);
          log(`🔧 Using default relays for ${pubkey.slice(0, 8)}...`, outboxes);
        }

        // Apply blacklist filtering if provided
        if (blacklist && blacklist.length > 0) {
          const blacklistSet = new Set(blacklist);
          outboxes = outboxes.filter((relay) => !blacklistSet.has(relay));
        }

        // Apply custom sorting if provided (this will override the popularity sorting)
        if (sortRelays) outboxes = sortRelays(pubkey, outboxes);
        // Sort by relay popularity (usage count) first
        else {
          outboxes.sort((a, b) => {
            const countA = relayUsageCount.get(a) || 0;
            const countB = relayUsageCount.get(b) || 0;

            // Sort by usage count descending (most popular first)
            return countB - countA;
          });
        }

        // Apply limit
        outboxes = outboxes.slice(0, maxPerPubkey);

        return { pubkey, relays: outboxes };
      });
    }),
  );
}

/** RxJS operator that aggregates contacts with outboxes into a relay -> pubkeys map */
export function groupPubkeysByRelay(): OperatorFunction<ProfilePointer[], OutboxMap> {
  return pipe(
    map((pointers) => {
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
    }),
  );
}
