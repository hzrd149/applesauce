import { EventOperation } from "applesauce-core/factories";
import {
  AddressPointer,
  getReplaceableAddressFromPointer,
  parseReplaceableAddress,
} from "applesauce-core/helpers/pointers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { normalizeURL } from "applesauce-core/helpers/url";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { APP_HANDLER_KIND, HandlerLinkPlatform } from "../helpers/app-handler.js";

function handlerPointer(handler: AddressPointer | string): AddressPointer {
  const pointer = typeof handler === "string" ? parseReplaceableAddress(handler) : handler;
  if (!pointer || pointer.kind !== APP_HANDLER_KIND) throw new Error("Expected a NIP-89 handler address");
  return pointer;
}

/**
 * Adds or replaces a recommended handler for a platform
 * @throws if the address is not a handler information event (kind 31990)
 */
export function addRecommendedHandler(
  handler: AddressPointer | string,
  platform?: HandlerLinkPlatform,
): EventOperation {
  const pointer = handlerPointer(handler);
  const address = getReplaceableAddressFromPointer(pointer);
  const relay = pointer.relays?.find(isSafeRelayURL);
  // The relay hint is positional, so keep an empty slot when only the platform is known
  const tag = [
    "a",
    address,
    ...(relay || platform ? [relay ? normalizeURL(relay) : ""] : []),
    ...(platform ? [platform] : []),
  ];
  return modifyPublicTags((tags) => [
    ...tags.filter((t) => !(t[0] === "a" && t[1] === address && t[3] === platform)),
    tag,
  ]);
}
/**
 * Removes a recommended handler for every platform, one platform, or only the entry without a platform when `null`
 * @throws if the address is not a handler information event (kind 31990)
 */
export function removeRecommendedHandler(
  handler: AddressPointer | string,
  platform?: HandlerLinkPlatform | null,
): EventOperation {
  const address = getReplaceableAddressFromPointer(handlerPointer(handler));
  const matches = (t: string[]) => (platform === undefined ? true : platform === null ? !t[3] : t[3] === platform);
  return modifyPublicTags((tags) => tags.filter((t) => !(t[0] === "a" && t[1] === address && matches(t))));
}
