import { TagOperation } from "applesauce-core/factories";
import { isEvent, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  decodeAddressPointer,
  decodeEventPointer,
  EventPointer,
  getReplaceableAddressFromPointer,
  isAddressPointer,
  parseReplaceableAddress,
} from "applesauce-core/helpers/pointers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { isHexKey } from "applesauce-core/helpers/string";
import { normalizeURL } from "applesauce-core/helpers/url";
import { isNappletHandlerAddress } from "../helpers/napplet-handlers.js";
import { NAPPLET_KIND, NAPPLET_ROOT_KIND, NAPPLET_SNAPSHOT_KIND, parseNappletConvention } from "../helpers/napplet.js";

/** A napplet to reference: a coordinate, snapshot id, `naddr`, `nevent`, pointer, or manifest event */
export type NappletHandlerInput = string | AddressPointer | EventPointer | NostrEvent;

/** Returns the first safe relay hint, normalized */
function getRelayHint(relays?: string[]): string | undefined {
  const hint = relays?.find((url) => isSafeRelayURL(url));
  return hint ? normalizeURL(hint) : undefined;
}

/** Creates an `a` tag for a root or named napplet address */
function createAddressTag(pointer: AddressPointer): string[] {
  if (!isNappletHandlerAddress(pointer)) throw new Error("Expected a root or named napplet address");

  const coordinate = getReplaceableAddressFromPointer(pointer);
  const relay = getRelayHint(pointer.relays);

  return relay ? ["a", coordinate, relay] : ["a", coordinate];
}

/** Creates an `e` tag for a pinned snapshot */
function createSnapshotTag(pointer: EventPointer): string[] {
  // Replaceable manifest ids become unresolvable once the napplet updates, so only snapshots can be pinned
  if (pointer.kind !== undefined && pointer.kind !== NAPPLET_SNAPSHOT_KIND) {
    throw new Error("Napplet pins must reference a kind 5129 snapshot");
  }
  if (!isHexKey(pointer.id)) throw new Error("Invalid napplet snapshot id");

  const id = pointer.id.toLowerCase();
  const relay = getRelayHint(pointer.relays);

  // The relay hint is positional, so keep an empty slot when only the author is known
  if (pointer.author) return ["e", id, relay ?? "", pointer.author];
  return relay ? ["e", id, relay] : ["e", id];
}

/**
 * Creates the archetype-wide `a` or `e` tag for a napplet
 * @throws if the input is not a root or named napplet, or a kind 5129 snapshot
 */
export function createNappletHandlerTag(input: NappletHandlerInput): string[] {
  if (typeof input === "string") {
    if (isHexKey(input)) return createSnapshotTag({ id: input });

    const pointer = input.startsWith("naddr1") ? decodeAddressPointer(input) : parseReplaceableAddress(input);
    if (pointer) return createAddressTag(pointer);

    const snapshot = decodeEventPointer(input);
    if (snapshot) return createSnapshotTag(snapshot);

    throw new Error(`Invalid napplet reference: ${input}`);
  }

  if (isEvent(input)) {
    if (input.kind === NAPPLET_SNAPSHOT_KIND) {
      return createSnapshotTag({ id: input.id, kind: input.kind, author: input.pubkey });
    }

    if (input.kind !== NAPPLET_KIND && input.kind !== NAPPLET_ROOT_KIND) {
      throw new Error("Expected a napplet manifest event");
    }

    const identifier = input.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return createAddressTag({ kind: input.kind, pubkey: input.pubkey, identifier });
  }

  if (isAddressPointer(input)) return createAddressTag(input);
  return createSnapshotTag(input);
}

/**
 * Returns the coordinate or snapshot id used as an `i` tag reference
 * @throws if the input is not a root or named napplet, or a kind 5129 snapshot
 */
export function getNappletHandlerReference(input: NappletHandlerInput): string {
  return createNappletHandlerTag(input)[1];
}

/** Checks if a tag is an archetype-wide handler entry for a reference */
function isHandlerTag(tag: string[], reference: string): boolean {
  return (tag[0] === "a" || tag[0] === "e") && tag[1] === reference;
}

/** Checks if a tag is an intent-specific handler entry, optionally for a single reference */
function isIntentTag(tag: string[], identity: string, reference?: string): boolean {
  return tag[0] === "i" && tag[1] === identity && (reference === undefined || tag[2] === reference);
}

/** Inserts a tag before the first matching tag, or appends it when none match */
function insertBefore(tags: string[][], tag: string[], matches: (tag: string[]) => boolean): string[][] {
  const index = tags.findIndex(matches);
  if (index === -1) return [...tags, tag];

  return [...tags.slice(0, index), tag, ...tags.slice(index)];
}

/** Throws if a convention identity is malformed or has a query or fragment */
function assertConvention(identity: string) {
  if (!parseNappletConvention(identity)) throw new Error(`Invalid napplet convention identity: ${identity}`);
}

/**
 * Adds an archetype-wide handler as the last fallback, or updates its relay hint in place
 * @throws if the input is not a root or named napplet, or a kind 5129 snapshot
 */
export function addNappletHandlerTag(input: NappletHandlerInput): TagOperation {
  const tag = createNappletHandlerTag(input);

  return (tags) => {
    const index = tags.findIndex((t) => isHandlerTag(t, tag[1]));
    if (index === -1) return [...tags, tag];

    return tags.map((t, i) => (i === index ? tag : t));
  };
}

/**
 * Moves or inserts an archetype-wide handler to the front so it becomes preferred
 * @throws if the input is not a root or named napplet, or a kind 5129 snapshot
 */
export function preferNappletHandlerTag(input: NappletHandlerInput): TagOperation {
  const tag = createNappletHandlerTag(input);

  return (tags) => {
    const remaining = tags.filter((t) => !isHandlerTag(t, tag[1]));
    return insertBefore(remaining, tag, (t) => t[0] === "a" || t[0] === "e");
  };
}

/**
 * Removes an archetype-wide handler
 * @throws if the input is not a root or named napplet, or a kind 5129 snapshot
 */
export function removeNappletHandlerTag(input: NappletHandlerInput): TagOperation {
  const reference = getNappletHandlerReference(input);
  return (tags) => tags.filter((t) => !isHandlerTag(t, reference));
}

/**
 * Adds an intent-specific handler as the last fallback for a convention identity
 * @throws if the identity is invalid, or the input is not a napplet or kind 5129 snapshot
 */
export function addNappletIntentHandlerTag(identity: string, input: NappletHandlerInput): TagOperation {
  assertConvention(identity);
  const reference = getNappletHandlerReference(input);

  return (tags) => {
    if (tags.some((t) => isIntentTag(t, identity, reference))) return tags;
    return [...tags, ["i", identity, reference]];
  };
}

/**
 * Moves or inserts an intent-specific handler to the front so it becomes preferred for a convention identity
 * @throws if the identity is invalid, or the input is not a napplet or kind 5129 snapshot
 */
export function preferNappletIntentHandlerTag(identity: string, input: NappletHandlerInput): TagOperation {
  assertConvention(identity);
  const reference = getNappletHandlerReference(input);

  return (tags) => {
    const remaining = tags.filter((t) => !isIntentTag(t, identity, reference));
    return insertBefore(remaining, ["i", identity, reference], (t) => isIntentTag(t, identity));
  };
}

/**
 * Removes one intent-specific handler, or every handler for the convention identity when no input is given
 * @throws if the input is not a napplet or kind 5129 snapshot
 */
export function removeNappletIntentHandlerTag(identity: string, input?: NappletHandlerInput): TagOperation {
  const reference = input === undefined ? undefined : getNappletHandlerReference(input);
  return (tags) => tags.filter((t) => !isIntentTag(t, identity, reference));
}

/** Removes every `a`, `e`, and `i` handler entry while keeping the `d` tag and unknown tags */
export function clearNappletHandlerTags(): TagOperation {
  return (tags) => tags.filter((t) => t[0] !== "a" && t[0] !== "e" && t[0] !== "i");
}
