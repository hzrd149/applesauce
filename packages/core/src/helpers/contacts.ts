import { getOrComputeCachedValue } from "./cache.js";
import { NostrEvent, notifyEventUpdate } from "./event.js";
import { HiddenContentSigner } from "./hidden-content.js";
import { getHiddenTags, isHiddenTagsUnlocked, unlockHiddenTags } from "./hidden-tags.js";
import { getProfilePointerFromPTag, ProfilePointer } from "./pointers.js";
import { isSafeRelayURL } from "./relays.js";
import { isPTag, processTags } from "./tags.js";

export const ContactsRelaysSymbol = Symbol.for("contacts-relays");
export const PublicContactsSymbol = Symbol.for("public-contacts");
export const HiddenContactsSymbol = Symbol.for("hidden-contacts");

/** Type for contact events with unlocked hidden tags */
export type UnlockedContacts = {
  [HiddenContactsSymbol]: ProfilePointer[];
};

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

/** Checks if the hidden contacts are unlocked */
export function isHiddenContactsUnlocked<T extends NostrEvent>(event: T): event is T & UnlockedContacts {
  return isHiddenTagsUnlocked(event) && Reflect.has(event, HiddenContactsSymbol);
}

/** Returns only the hidden contacts from a contacts list event */
export function getHiddenContacts(event: NostrEvent): ProfilePointer[] | undefined {
  if (isHiddenContactsUnlocked(event)) return event[HiddenContactsSymbol];

  // Get hidden tags
  const tags = getHiddenTags(event);
  if (!tags) return undefined;

  // Parse tags
  const contacts = processTags(tags, (t) => (isPTag(t) ? t : undefined), getProfilePointerFromPTag);

  // Set cache and notify event store
  Reflect.set(event, HiddenContactsSymbol, contacts);

  return contacts;
}

/** Unlocks the hidden contacts */
export async function unlockHiddenContacts(event: NostrEvent, signer: HiddenContentSigner): Promise<ProfilePointer[]> {
  if (isHiddenContactsUnlocked(event)) return event[HiddenContactsSymbol];

  // Unlock hidden tags
  await unlockHiddenTags(event, signer);

  // Get hidden contacts
  const contacts = getHiddenContacts(event);
  if (!contacts) throw new Error("Failed to unlock hidden contacts");

  // Set cache and notify event store
  notifyEventUpdate(event);

  return contacts;
}
