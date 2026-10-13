import { EventOperation } from "applesauce-core/factories";
import {
  AddressPointer,
  getReplaceableAddressFromPointer,
  parseReplaceableAddress,
} from "applesauce-core/helpers/pointers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { normalizeURL } from "applesauce-core/helpers/url";
import { addNameValueTag, removeNameValueTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { isSha256 } from "../helpers/blossom.js";
import {
  computeNsiteAggregateHash,
  isNsiteAddressPointer,
  isValidNsiteIdentifier,
  isValidNsitePath,
  NSITE_KIND,
} from "../helpers/nsite.js";

function singleton(name: string, value: string[] | null): EventOperation {
  return modifyPublicTags((tags) => [...tags.filter((t) => t[0] !== name), ...(value ? [[name, ...value]] : [])]);
}
function pointerTag(name: string, input: AddressPointer | string): [string, string, ...string[]] {
  const pointer = typeof input === "string" ? parseReplaceableAddress(input) : input;
  if (
    !pointer ||
    !isSha256(pointer.pubkey) ||
    (name === "app" ? pointer.kind < 30000 || pointer.kind >= 40000 : !isNsiteAddressPointer(pointer))
  )
    throw new Error(`Invalid ${name === "app" ? "app descriptor" : "nsite"} address`);
  const relay = pointer.relays?.find(isSafeRelayURL);
  return [name, getReplaceableAddressFromPointer(pointer), ...(relay ? [normalizeURL(relay)] : [])];
}
/**
 * Sets the identifier of a named site
 * @throws if the identifier is invalid or the draft is not a named site
 */
export function setNsiteIdentifier(identifier: string): EventOperation {
  if (!isValidNsiteIdentifier(identifier)) throw new Error("Invalid nsite identifier");
  return (draft) => {
    if (draft.kind !== NSITE_KIND) throw new Error("Only named nsites have identifiers");
    return singleton("d", [identifier])(draft);
  };
}
/** Sets or removes the site's title */
export function setNsiteTitle(title: string | null): EventOperation {
  return singleton("title", title === null ? null : [title]);
}
/** Sets or removes the site's description tag */
export function setNsiteDescription(description: string | null): EventOperation {
  return singleton("description", description === null ? null : [description]);
}
/** Sets or removes the site's source repository or archive URL */
export function setNsiteSource(source: string | null): EventOperation {
  return singleton("source", source === null ? null : [source]);
}
/** Adds a Blossom server hint */
export function addNsiteServer(server: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["server", server]));
}
/** Removes a Blossom server hint */
export function removeNsiteServer(server: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["server", server]));
}
/**
 * Adds or replaces an upstream app descriptor reference
 * @throws if the address is not addressable
 */
export function addNsiteApp(app: AddressPointer | string): EventOperation {
  return modifyPublicTags(addNameValueTag(pointerTag("app", app)));
}
/**
 * Removes an upstream app descriptor reference
 * @throws if the address is not addressable
 */
export function removeNsiteApp(app: AddressPointer | string): EventOperation {
  return modifyPublicTags(removeNameValueTag(pointerTag("app", app).slice(0, 2)));
}
/**
 * Sets or removes the immediate parent site address
 * @throws if the address does not reference a root or named site
 */
export function setNsiteParent(parent: AddressPointer | string | null): EventOperation {
  return singleton("a", parent === null ? null : pointerTag("a", parent).slice(1));
}
/**
 * Sets or removes the origin site address of the copy lineage
 * @throws if the address does not reference a root or named site
 */
export function setNsiteRoot(root: AddressPointer | string | null): EventOperation {
  return singleton("A", root === null ? null : pointerTag("A", root).slice(1));
}
/**
 * Sets or removes the advertised aggregate hash
 * @throws if the hash is not lowercase hexadecimal SHA-256
 */
export function setNsiteAggregateHash(hash: string | null): EventOperation {
  if (hash !== null && !isSha256(hash)) throw new Error("Invalid nsite aggregate hash");
  return singleton("x", hash === null ? null : [hash, "aggregate"]);
}
/** Updates the aggregate hash from all current path tags */
export function updateNsiteAggregateHash(): EventOperation {
  return (draft) => setNsiteAggregateHash(computeNsiteAggregateHash(draft))(draft);
}
/**
 * Adds or replaces a file mapping and updates the aggregate hash
 * @throws if the path or hash is invalid
 */
export function setNsiteFile(path: string, hash: string): EventOperation {
  if (!isValidNsitePath(path) || !isSha256(hash)) throw new Error("Invalid nsite file path or hash");
  return modifyPublicTags((tags) => {
    const next = [...tags.filter((t) => !(t[0] === "path" && t[1] === path) && t[0] !== "x"), ["path", path, hash]];
    return [...next, ["x", computeNsiteAggregateHash({ tags: next }), "aggregate"]];
  });
}
/** Removes a file mapping and updates the aggregate hash */
export function removeNsiteFile(path: string): EventOperation {
  return modifyPublicTags((tags) => {
    const next = tags.filter((t) => !(t[0] === "path" && t[1] === path) && t[0] !== "x");
    return [...next, ["x", computeNsiteAggregateHash({ tags: next }), "aggregate"]];
  });
}
