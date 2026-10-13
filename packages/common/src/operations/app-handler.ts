import { EventOperation } from "applesauce-core/factories";
import { ProfileContent } from "applesauce-core/helpers/profile";
import {
  AddressPointer,
  getReplaceableAddressFromPointer,
  parseReplaceableAddress,
} from "applesauce-core/helpers/pointers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { normalizeURL } from "applesauce-core/helpers/url";
import { setContent } from "applesauce-core/operations/content";
import { addNameValueTag, removeNameValueTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { HandlerLinkPlatform, HandlerLinkType } from "../helpers/app-handler.js";
import { isNsiteAddressPointer, NSITE_KIND } from "../helpers/nsite.js";

function sameLink(t: string[], platform: string, type?: string) {
  return t[0] === platform && (t[2] || undefined) === type;
}
function nsiteTag(name: string, site: AddressPointer | string | null): EventOperation {
  let tag: string[] | undefined;
  if (site !== null) {
    const pointer = typeof site === "string" ? parseReplaceableAddress(site) : site;
    if (!pointer || pointer.kind !== NSITE_KIND || !isNsiteAddressPointer(pointer))
      throw new Error("Expected a named nsite address");
    const relay = pointer.relays?.find(isSafeRelayURL);
    tag = [name, getReplaceableAddressFromPointer(pointer), ...(relay ? [normalizeURL(relay)] : [])];
  }
  return modifyPublicTags((tags) => [...tags.filter((t) => t[0] !== name), ...(tag ? [tag] : [])]);
}

/** Sets the handler's kind:0-style metadata, or clears it to fall back to the author's profile */
export function setHandlerMetadata(metadata: ProfileContent | null): EventOperation {
  return setContent(metadata ? JSON.stringify(metadata) : "");
}
/** Adds a supported event kind */
export function addHandlerKind(kind: number): EventOperation {
  return modifyPublicTags(addNameValueTag(["k", String(kind)]));
}
/** Removes a supported event kind */
export function removeHandlerKind(kind: number): EventOperation {
  return modifyPublicTags(removeNameValueTag(["k", String(kind)]));
}
/** Sets the URL template for a platform and NIP-19 entity type, or the generic template when type is omitted */
export function setHandlerLink(platform: HandlerLinkPlatform, url: string, type?: HandlerLinkType): EventOperation {
  return modifyPublicTags((tags) => [
    ...tags.filter((t) => !sameLink(t, platform, type)),
    type ? [platform, url, type] : [platform, url],
  ]);
}
/** Removes the URL template for a platform and NIP-19 entity type */
export function removeHandlerLink(platform: HandlerLinkPlatform, type?: HandlerLinkType): EventOperation {
  return modifyPublicTags((tags) => tags.filter((t) => !sameLink(t, platform, type)));
}
/**
 * Sets or removes the named nsite the handler currently serves
 * @throws if the address is not a named nsite (kind 35128)
 */
export function setHandlerLatest(site: AddressPointer | string | null): EventOperation {
  return nsiteTag("latest", site);
}
/**
 * Sets or removes the named nsite the handler is rolling out
 * @throws if the address is not a named nsite (kind 35128)
 */
export function setHandlerNext(site: AddressPointer | string | null): EventOperation {
  return nsiteTag("next", site);
}
