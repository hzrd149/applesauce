import { EventOperation } from "applesauce-core/factories";
import {
  AddressPointer,
  getReplaceableAddressFromPointer,
  parseReplaceableAddress,
} from "applesauce-core/helpers/pointers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { normalizeURL } from "applesauce-core/helpers/url";
import { setContent } from "applesauce-core/operations/content";
import {
  addNameValueTag,
  removeNameValueTag,
  removeSingletonTag,
  setSingletonTag,
} from "applesauce-core/operations/tag/common";
import { includeSingletonTag, modifyPublicTags } from "applesauce-core/operations/tags";
import { isSha256 } from "../helpers/blossom.js";
import { isNappletIconType, NappletIconType } from "../helpers/napplet.js";

/** Builds a lineage tag (`a` or `A`) for a napplet address */
function createLineageTag(name: "a" | "A", input: AddressPointer | string): [string, string, ...string[]] {
  const pointer = typeof input === "string" ? parseReplaceableAddress(input) : input;
  if (!pointer) throw new Error(`Invalid napplet address: ${input}`);
  const hint = pointer.relays?.find((url) => isSafeRelayURL(url));
  const address = getReplaceableAddressFromPointer(pointer);
  return hint ? [name, address, normalizeURL(hint)] : [name, address];
}

/** Sets the `d` tag identifier of a named napplet */
export function setNappletIdentifier(identifier: string): EventOperation {
  return includeSingletonTag(["d", identifier], true);
}

/**
 * Sets the sha256 of the napplet `index.html` artifact (`x` tag)
 * @throws if the hash is not a 64 character lowercase hex string
 */
export function setNappletArtifactHash(sha256: string): EventOperation {
  if (!isSha256(sha256)) throw new Error("Napplet artifact hash must be a lowercase hex sha256");
  // Remove all "x" tags first since a manifest must carry exactly one
  return modifyPublicTags(removeSingletonTag("x"), setSingletonTag(["x", sha256], true));
}

/** Sets the plain-text description of the napplet */
export function setNappletDescription(description: string): EventOperation {
  return setContent(description);
}

/** Sets or removes the short display label (`title` tag) */
export function setNappletTitle(title: string | null): EventOperation {
  return modifyPublicTags(title === null ? removeSingletonTag("title") : setSingletonTag(["title", title], true));
}

/** Sets or removes the source URL (`source` tag) */
export function setNappletSource(url: string | null): EventOperation {
  return modifyPublicTags(url === null ? removeSingletonTag("source") : setSingletonTag(["source", url], true));
}

/** Adds an archetype (`z` tag) */
export function addNappletArchetype(archetype: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["z", archetype]));
}

/** Removes an archetype (`z` tag) */
export function removeNappletArchetype(archetype: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["z", archetype]));
}

/** Adds or replaces an accepted intent and its parameter names (`i` tag) */
export function addNappletIntent(intent: string, params: string[] = []): EventOperation {
  return modifyPublicTags(addNameValueTag(["i", intent, ...params]));
}

/** Removes an accepted intent (`i` tag) */
export function removeNappletIntent(intent: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["i", intent]));
}

/** Adds a NAP domain required for full functionality (`R` tag) */
export function addNappletRequiredDomain(domain: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["R", domain]));
}

/** Removes a required NAP domain (`R` tag) */
export function removeNappletRequiredDomain(domain: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["R", domain]));
}

/** Adds an optional NAP domain (`O` tag) */
export function addNappletOptionalDomain(domain: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["O", domain]));
}

/** Removes an optional NAP domain (`O` tag) */
export function removeNappletOptionalDomain(domain: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["O", domain]));
}

/** Adds a Blossom server hint (`server` tag) */
export function addNappletServer(url: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["server", url]));
}

/** Removes a Blossom server hint (`server` tag) */
export function removeNappletServer(url: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["server", url]));
}

/**
 * Sets or removes the content-addressed icon (`icon` tag)
 * @throws if the hash is not a lowercase hex sha256 or the MIME type is not png, jpeg or webp
 */
export function setNappletIcon(sha256: string | null, type?: NappletIconType): EventOperation {
  if (sha256 === null) return modifyPublicTags(removeSingletonTag("icon"));
  if (!isSha256(sha256)) throw new Error("Napplet icon hash must be a lowercase hex sha256");
  if (!type || !isNappletIconType(type)) throw new Error(`Unsupported napplet icon type: ${type}`);
  return modifyPublicTags(setSingletonTag(["icon", sha256, type], true));
}

/**
 * Sets or removes the address of the napplet a snapshot derives from (`a` tag)
 * @throws if the address cannot be parsed
 */
export function setNappletParent(parent: AddressPointer | string | null): EventOperation {
  if (parent === null) return modifyPublicTags(removeSingletonTag("a"));
  return modifyPublicTags(setSingletonTag(createLineageTag("a", parent), true));
}

/**
 * Sets or removes the address of the root napplet a snapshot's lineage originates from (`A` tag)
 * @throws if the address cannot be parsed
 */
export function setNappletRoot(root: AddressPointer | string | null): EventOperation {
  if (root === null) return modifyPublicTags(removeSingletonTag("A"));
  return modifyPublicTags(setSingletonTag(createLineageTag("A", root), true));
}
