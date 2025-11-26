import { TagOperation } from "../../event-factory/types.js";
import {
  createATagFromAddressPointer,
  createETagFromEventPointer,
  createPTagFromProfilePointer,
} from "../../helpers/factory.js";
import {
  AddressPointer,
  EventPointer,
  getCoordinateFromAddressPointer,
  parseCoordinate,
  ProfilePointer,
} from "../../helpers/pointers.js";
import { ensureNamedValueTag, ensureSingletonTag } from "../../helpers/tags.js";

/** Adds a single "p" tag for a ProfilePointer */
export function addProfilePointerTag(pubkey: string | ProfilePointer, replace = true): TagOperation {
  return async (tags, { getPubkeyRelayHint }) => {
    const pointer = typeof pubkey === "string" ? { pubkey: pubkey } : { ...pubkey };

    // add relay hint
    if (getPubkeyRelayHint && pointer.relays?.[0] === undefined) {
      const hint = await getPubkeyRelayHint(pointer.pubkey);
      if (hint) pointer.relays = [hint];
    }

    // remove matching "p" tags
    if (replace) tags = tags.filter((t) => !(t[0] === "p" && t[1] === pointer.pubkey));

    // add "p" tag
    return [...tags, createPTagFromProfilePointer(pointer)];
  };
}

/** Removes all "p" tags matching a pubkey */
export function removeProfilePointerTag(pubkey: string | ProfilePointer): TagOperation {
  pubkey = typeof pubkey !== "string" ? pubkey.pubkey : pubkey;
  return (tags) => tags.filter((t) => !(t[0] === "p" && t[1] === pubkey));
}

/** Adds a a single "e" tag for an EventPointer */
export function addEventPointerTag(id: string | EventPointer, replace = true): TagOperation {
  return async (tags, { getEventRelayHint }) => {
    const pointer = typeof id === "string" ? { id } : id;

    // add relay hint
    if (getEventRelayHint && pointer.relays?.[0] === undefined) {
      const hint = await getEventRelayHint(pointer.id);
      if (hint) pointer.relays = [hint];
    }

    // remove matching "e" tags
    if (replace) tags = tags.filter((t) => !(t[0] === "e" && t[1] === pointer.id));

    // add "e" tag
    return [...tags, createETagFromEventPointer(pointer)];
  };
}

/** Removes all "e" tags matching EventPointer or id */
export function removeEventPointerTag(id: string | EventPointer): TagOperation {
  id = typeof id === "string" ? id : id.id;
  return (tags) => tags.filter((t) => !(t[0] === "e" && t[1] === id));
}

/** Adds a single "a" tag based on an AddressPointer */
export function addAddressPointerTag(cord: string | AddressPointer, replace = true): TagOperation {
  return async (tags, { getPubkeyRelayHint }) => {
    // convert the string into an address pointer object
    const pointer = typeof cord === "string" ? parseCoordinate(cord, true, false) : cord;
    const coordinate = typeof cord === "string" ? cord : getCoordinateFromAddressPointer(pointer);

    // add relay hint if there isn't one
    if (getPubkeyRelayHint && pointer.relays?.[0] === undefined) {
      const hint = await getPubkeyRelayHint(pointer.pubkey);
      if (hint) pointer.relays = [hint];
    }

    // remove existing "a" tags matching coordinate
    if (replace) tags = tags.filter((t) => !(t[0] === "a" && t[1] === coordinate));

    // add "a" tag
    return [...tags, createATagFromAddressPointer(pointer)];
  };
}

/** Removes all "a" tags for address pointer */
export function removeAddressPointerTag(cord: string | AddressPointer): TagOperation {
  cord = typeof cord !== "string" ? getCoordinateFromAddressPointer(cord) : cord;

  return (tags) => tags.filter((t) => !(t[0] === "a" && t[1] === cord));
}

/** Adds a name / value tag */
export function addNameValueTag(
  tag: [string, string, ...string[]],
  replace = true,
  matcher?: (a: string, b: string) => boolean,
): TagOperation {
  return (tags) => {
    // replace or append tag
    if (replace) return ensureNamedValueTag(tags, tag, true, matcher);
    else return [...tags, tag];
  };
}
/** Removes all matching name / value tag */
export function removeNameValueTag(tag: string[]): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === tag[0] && t[1] === tag[1]));
}

/** Sets a singleton tag */
export function setSingletonTag(tag: [string, ...string[]], replace = true): TagOperation {
  return (tags) => ensureSingletonTag(tags, tag, replace);
}

/** Removes all instances of a singleton tag */
export function removeSingletonTag(tag: string): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === tag));
}
