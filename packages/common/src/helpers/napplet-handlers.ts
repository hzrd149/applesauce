import { getOrComputeCachedValue, setCachedValue } from "applesauce-core/helpers/cache";
import { getReplaceableIdentifier, KnownEvent, NostrEvent, notifyEventUpdate } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import {
  getHiddenTags,
  isHiddenTagsUnlocked,
  setHiddenTagsEncryptionMethod,
  unlockHiddenTags,
} from "applesauce-core/helpers/hidden-tags";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerFromATag,
  getEventPointerFromETag,
  getReplaceableAddressFromPointer,
  parseReplaceableAddress,
} from "applesauce-core/helpers/pointers";
import { isHexKey } from "applesauce-core/helpers/string";
import { NAPPLET_KIND, NAPPLET_ROOT_KIND, NAPPLET_SNAPSHOT_KIND, parseNappletConvention } from "./napplet.js";

/**
 * The event kind for napplet handler preferences (addressable events)
 * @see https://github.com/napplet/naps/blob/master/naps/NAP-INTENT.md
 */
export const NAPPLET_HANDLERS_KIND = 31129;

/** A validated napplet handler preferences event */
export type NappletHandlersEvent = KnownEvent<typeof NAPPLET_HANDLERS_KIND>;

// Private entries are NIP-44 encrypted to the author, as in NIP-51
setHiddenTagsEncryptionMethod(NAPPLET_HANDLERS_KIND, "nip44");

/** A reference to a napplet that follows its latest manifest, or to a pinned snapshot */
export type NappletHandlerRef =
  { type: "address"; pointer: AddressPointer } | { type: "snapshot"; pointer: EventPointer };

/** The handler entries of one tag set (public or private), in preference order */
export type NappletHandlerEntries = {
  /** Archetype-wide handlers from the `a` and `e` tags */
  handlers: NappletHandlerRef[];
  /** Intent-specific handlers from the `i` tags, keyed by convention identity */
  intents: Map<string, NappletHandlerRef[]>;
};

/** A handler considered when resolving an intent */
export type NappletHandlerCandidate = {
  /** The referenced napplet */
  ref: NappletHandlerRef;
  /** Whether the entry came from the private tags */
  hidden: boolean;
  /** Whether the entry is intent-specific (`i` tag) rather than archetype-wide */
  intent: boolean;
};

/** Type for events with unlocked private handler entries */
export type UnlockedNappletHandlers = {
  [NappletHandlersHiddenSymbol]: NappletHandlerEntries;
};

export const NappletHandlersPublicSymbol = Symbol.for("napplet-handlers-public");
export const NappletHandlersHiddenSymbol = Symbol.for("napplet-handlers-hidden");

/** Checks if an event is a valid napplet handler preferences event (kind 31129) */
export function isValidNappletHandlers(event?: NostrEvent): event is NappletHandlersEvent {
  return !!event && event.kind === NAPPLET_HANDLERS_KIND && getReplaceableIdentifier(event) !== "";
}

/** Returns the archetype from the `d` tag */
export function getNappletHandlersArchetype(event: NostrEvent): string {
  return getReplaceableIdentifier(event);
}

/** Returns a relay filter for handler preferences of an archetype, optionally from a set of authors */
export function getNappletHandlersFilter(archetype: string, authors?: string[]): Filter {
  return { kinds: [NAPPLET_HANDLERS_KIND], "#d": [archetype], ...(authors ? { authors } : {}) };
}

/** Checks if an address points to a named (with an identifier) or root (without one) napplet manifest */
export function isNappletHandlerAddress(pointer: AddressPointer): boolean {
  if (pointer.kind === NAPPLET_KIND) return pointer.identifier !== "";
  if (pointer.kind === NAPPLET_ROOT_KIND) return pointer.identifier === "";
  return false;
}

/** Returns the coordinate or snapshot id that identifies a handler reference, ignoring relay hints */
export function getNappletHandlerRefKey(ref: NappletHandlerRef): string {
  return ref.type === "address" ? getReplaceableAddressFromPointer(ref.pointer) : ref.pointer.id;
}

/** Checks if two handler references name the same napplet or the same pinned snapshot */
export function isSameNappletHandlerRef(a: NappletHandlerRef, b: NappletHandlerRef): boolean {
  return getNappletHandlerRefKey(a) === getNappletHandlerRefKey(b);
}

/** Parses an `i` tag `<ref>`: a napplet coordinate or a snapshot id */
export function parseNappletHandlerRef(value: string): NappletHandlerRef | undefined {
  if (isHexKey(value)) return { type: "snapshot", pointer: { id: value.toLowerCase(), kind: NAPPLET_SNAPSHOT_KIND } };

  const pointer = parseReplaceableAddress(value);
  if (!pointer || !isNappletHandlerAddress(pointer)) return undefined;

  return { type: "address", pointer };
}

/** Parses an archetype-wide `a` or `e` handler tag */
function parseHandlerTag(tag: string[]): NappletHandlerRef | undefined {
  if (tag[0] === "a") {
    const pointer = getAddressPointerFromATag(tag);
    if (!pointer || !isNappletHandlerAddress(pointer)) return undefined;
    return { type: "address", pointer };
  }

  if (tag[0] === "e") {
    const pointer = getEventPointerFromETag(tag);
    if (!pointer) return undefined;

    // The author is in the fourth position, after the optional relay hint
    const snapshot: EventPointer = { ...pointer, kind: NAPPLET_SNAPSHOT_KIND };
    if (isHexKey(tag[3])) snapshot.author = tag[3];

    return { type: "snapshot", pointer: snapshot };
  }

  return undefined;
}

/** Parses the archetype-wide `a` and `e` handlers from a set of tags, keeping the first of any repeats */
function parseHandlerTags(tags: string[][]): NappletHandlerRef[] {
  const handlers: NappletHandlerRef[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const ref = parseHandlerTag(tag);
    if (!ref) continue;

    const key = getNappletHandlerRefKey(ref);
    if (seen.has(key)) continue;

    seen.add(key);
    handlers.push(ref);
  }

  return handlers;
}

/**
 * Parses the handler entries from a set of tags, skipping malformed entries and unknown tags
 * @param tags The public or private tags of the event
 * @param archetype The archetype from the event's `d` tag
 * @param hintTags Extra tags whose `a` and `e` entries provide relay hints and authors for `i` references
 */
export function parseNappletHandlerTags(
  tags: string[][],
  archetype: string,
  hintTags: string[][] = [],
): NappletHandlerEntries {
  const handlers = parseHandlerTags(tags);

  // An `i` tag has no relay hint, so borrow one from an `a` or `e` tag with the same reference
  const hints = new Map<string, NappletHandlerRef>();
  for (const ref of [...handlers, ...parseHandlerTags(hintTags)]) {
    const key = getNappletHandlerRefKey(ref);
    if (!hints.has(key)) hints.set(key, ref);
  }

  const intents = new Map<string, NappletHandlerRef[]>();
  for (const tag of tags) {
    if (tag[0] !== "i" || !tag[1] || !tag[2]) continue;

    // Ignore identities with a query or fragment, or for another archetype
    const convention = parseNappletConvention(tag[1]);
    if (convention?.archetype !== archetype) continue;

    const parsed = parseNappletHandlerRef(tag[2]);
    if (!parsed) continue;

    const ref = hints.get(getNappletHandlerRefKey(parsed)) ?? parsed;
    const refs = intents.get(tag[1]) ?? [];
    if (refs.some((existing) => isSameNappletHandlerRef(existing, ref))) continue;

    refs.push(ref);
    intents.set(tag[1], refs);
  }

  return { handlers, intents };
}

/** Returns the public handler entries, which other users read as recommendations */
export function getPublicNappletHandlers(event: NostrEvent): NappletHandlerEntries {
  return getOrComputeCachedValue(event, NappletHandlersPublicSymbol, () =>
    parseNappletHandlerTags(event.tags, getNappletHandlersArchetype(event)),
  );
}

/** Returns the private handler entries if the event is unlocked */
export function getHiddenNappletHandlers<T extends NostrEvent & UnlockedNappletHandlers>(
  event: T,
): NappletHandlerEntries;
export function getHiddenNappletHandlers<T extends NostrEvent>(event: T): NappletHandlerEntries | undefined;
export function getHiddenNappletHandlers<T extends NostrEvent>(event: T): NappletHandlerEntries | undefined {
  if (NappletHandlersHiddenSymbol in event) return event[NappletHandlersHiddenSymbol] as NappletHandlerEntries;

  const tags = getHiddenTags(event);
  if (!tags) return undefined;

  // Private `i` entries may reference a publicly listed napplet, so public tags also provide hints
  const entries = parseNappletHandlerTags(tags, getNappletHandlersArchetype(event), event.tags);

  // Derived from the event's own hidden tags, so it is memoized on the event non-enumerably
  setCachedValue(event, NappletHandlersHiddenSymbol, entries);

  return entries;
}

/** Checks if the private handler entries are unlocked */
export function isHiddenNappletHandlersUnlocked<T extends NostrEvent>(event: T): event is T & UnlockedNappletHandlers {
  return (
    isHiddenTagsUnlocked(event) &&
    (NappletHandlersHiddenSymbol in event || getHiddenNappletHandlers(event) !== undefined)
  );
}

/**
 * Decrypts the private handler entries
 * @throws if the content cannot be decrypted into a list of tags
 */
export async function unlockHiddenNappletHandlers(
  event: NostrEvent,
  signer: HiddenContentSigner,
): Promise<NappletHandlerEntries> {
  if (NappletHandlersHiddenSymbol in event) return event[NappletHandlersHiddenSymbol] as NappletHandlerEntries;

  await unlockHiddenTags(event, signer);

  const entries = getHiddenNappletHandlers(event);
  if (!entries) throw new Error("Failed to unlock hidden napplet handlers");

  notifyEventUpdate(event);

  return entries;
}

/**
 * Returns the handlers to try for a convention identity, in resolution order
 * @note Private entries are only included once unlocked, and a shell must still check each candidate is usable
 */
export function getNappletHandlerCandidates(event: NostrEvent, identity: string): NappletHandlerCandidate[] {
  const publicEntries = getPublicNappletHandlers(event);
  const hiddenEntries = getHiddenNappletHandlers(event);

  // Private intent entries, then public intent entries, then private and public archetype-wide entries
  const groups: [NappletHandlerRef[] | undefined, boolean, boolean][] = [
    [hiddenEntries?.intents.get(identity), true, true],
    [publicEntries.intents.get(identity), false, true],
    [hiddenEntries?.handlers, true, false],
    [publicEntries.handlers, false, false],
  ];

  const candidates: NappletHandlerCandidate[] = [];
  const seen = new Set<string>();

  for (const [refs, hidden, intent] of groups) {
    if (!refs) continue;

    for (const ref of refs) {
      const key = getNappletHandlerRefKey(ref);
      if (seen.has(key)) continue;

      seen.add(key);
      candidates.push({ ref, hidden, intent });
    }
  }

  return candidates;
}
