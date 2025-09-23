import { NostrEvent } from "nostr-tools";
import { ProfilePointer } from "nostr-tools/nip19";

import { getOrComputeCachedValue } from "./cache.js";
import { isSafeRelayURL } from "./relays.js";
import { isPTag, processTags } from "./tags.js";
import { getProfilePointerFromPTag } from "./pointers.js";
import { getHiddenTags, isHiddenTagsUnlocked } from "./hidden-tags.js";

export const ContactsRelaysSymbol = Symbol.for("contacts-relays");
export const PublicContactsSymbol = Symbol.for("public-contacts");
export const HiddenContactsSymbol = Symbol.for("hidden-contacts");

type RelayJson = Record<string, { read: boolean; write: boolean }>;
export function getRelaysFromContactsEvent(event: NostrEvent) {
  return getOrComputeCachedValue(event, ContactsRelaysSymbol, () => {
    try {
      const relayJson = JSON.parse(event.content) as RelayJson;

      const relays = new Map<string, "inbox" | "outbox" | "all">();
      for (const [url, opts] of Object.entries(relayJson)) {
        if (!isSafeRelayURL(url)) continue;

        if (opts.write && opts.read) relays.set(url, "all");
        else if (opts.read) relays.set(url, "inbox");
        else if (opts.write) relays.set(url, "outbox");
      }

      return relays;
    } catch (error) {
      return null;
    }
  });
}

/** Merges any number of contact lists into a single list */
export function mergeContacts(
  ...pointers: (ProfilePointer | undefined | (ProfilePointer | undefined)[])[]
): ProfilePointer[] {
  const merged = new Map<string, ProfilePointer>();
  for (const arr of pointers) {
    if (Array.isArray(arr)) {
      for (const pointer of arr) if (pointer) merged.set(pointer.pubkey, pointer);
    } else if (arr) {
      merged.set(arr.pubkey, arr);
    }
  }
  return Array.from(merged.values());
}

/** Returns all public and hidden contacts from a contacts list event */
export function getContacts(event: NostrEvent): ProfilePointer[] {
  return mergeContacts(getPublicContacts(event), getHiddenContacts(event));
}

/** Returns only the public contacts from a contacts list event */
export function getPublicContacts(event: NostrEvent): ProfilePointer[] {
  return getOrComputeCachedValue(event, PublicContactsSymbol, () =>
    processTags(event.tags, (t) => (isPTag(t) ? t : undefined), getProfilePointerFromPTag),
  );
}

/** Returns only the hidden contacts from a contacts list event */
export function getHiddenContacts(event: NostrEvent): ProfilePointer[] | undefined {
  if (isHiddenTagsUnlocked(event)) return undefined;

  return getOrComputeCachedValue(event, HiddenContactsSymbol, () =>
    processTags(getHiddenTags(event)!, (t) => (isPTag(t) ? t : undefined), getProfilePointerFromPTag),
  );
}
