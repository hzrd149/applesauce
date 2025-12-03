import { NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  DecodeResult,
  EventPointer,
  isAddressPointer,
  isEventPointer,
  naddrEncode,
  neventEncode,
  noteEncode,
  nprofileEncode,
  npubEncode,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";
import { getDisplayName, getProfileContent, getProfilePicture, isValidProfile } from "applesauce-core/helpers/profile";
import { processTags } from "applesauce-core/helpers/tags";

export type HandlerLinkPlatform = "web" | "ios" | "android";
export type HandlerLinkType = DecodeResult["type"];

/** Returns an array of supported kinds for a given handler */
export function getHandlerSupportedKinds(handler: NostrEvent): number[] {
  return processTags(handler.tags, (t) => (t[0] === "k" && t[1] ? parseInt(t[1]) : undefined));
}

/** Returns the name of the handler */
export function getHandlerName(handler: NostrEvent): string {
  return getDisplayName(handler);
}

/** Returns the picture of the handler */
export function getHandlerPicture(handler: NostrEvent, fallback?: string): string | undefined {
  if (!isValidProfile(handler)) return fallback;
  return getProfilePicture(handler, fallback);
}

/** Returns the description of the handler */
export function getHandlerDescription(handler: NostrEvent): string | undefined {
  if (!isValidProfile(handler)) return;
  return getProfileContent(handler).about;
}

/** Returns the web link template for a handler and type */
export function getHandlerLinkTemplate(
  handler: NostrEvent,
  platform: HandlerLinkPlatform = "web",
  type?: HandlerLinkType,
) {
  // Get all tags for this platform
  const tags = handler.tags.filter((t) => t[0] === platform);

  // Find the tag for this type, otherwise use default
  if (type) return tags.find((t) => t[2] === type)?.[1];
  else return tags.find((t) => t[2] === undefined || t[2] === "")?.[1];
}

/** Returns a link for a Profile Pointer */
export function createHandlerProfileLink(
  handler: NostrEvent,
  pointer: ProfilePointer,
  platform: HandlerLinkPlatform = "web",
): string | undefined {
  // First attempt to use a nprofile link, then fallback to npub
  return (
    getHandlerLinkTemplate(handler, platform, "nprofile")?.replace("<bech32>", nprofileEncode(pointer)) ||
    getHandlerLinkTemplate(handler, platform, "npub")?.replace("<bech32>", npubEncode(pointer.pubkey)) ||
    getHandlerLinkTemplate(handler, platform)?.replace("<bech32>", nprofileEncode(pointer))
  );
}

/** Returns a link for an Event Pointer */
export function createHandlerEventLink(
  handler: NostrEvent,
  pointer: EventPointer,
  platform: HandlerLinkPlatform = "web",
): string | undefined {
  // First attempt to use a nevent link, then fallback to note
  return (
    getHandlerLinkTemplate(handler, platform, "nevent")?.replace("<bech32>", neventEncode(pointer)) ||
    getHandlerLinkTemplate(handler, platform, "note")?.replace("<bech32>", noteEncode(pointer.id)) ||
    getHandlerLinkTemplate(handler, platform)?.replace("<bech32>", neventEncode(pointer))
  );
}

/** Returns a link for an Address Pointer */
export function createHandlerAddressLink(
  handler: NostrEvent,
  pointer: AddressPointer,
  platform: HandlerLinkPlatform = "web",
): string | undefined {
  // First attempt to use a nevent link, then fallback to note
  return (
    getHandlerLinkTemplate(handler, platform, "naddr")?.replace("<bech32>", naddrEncode(pointer)) ||
    getHandlerLinkTemplate(handler, platform)?.replace("<bech32>", naddrEncode(pointer))
  );
}

/** Creates a handler link for a pointer and optionally fallsback to a web link */
export function createHandlerLink(
  handler: NostrEvent,
  pointer: AddressPointer | EventPointer | ProfilePointer,
  platform?: HandlerLinkPlatform,
  webFallback = true,
): string | undefined {
  let link: string | undefined = undefined;
  if (isEventPointer(pointer)) link = createHandlerEventLink(handler, pointer, platform);
  else if (isAddressPointer(pointer)) link = createHandlerAddressLink(handler, pointer, platform);
  else link = createHandlerProfileLink(handler, pointer, platform);

  // Fallback to a web link if one cant be found for the platform
  if (!link && platform && platform !== "web" && webFallback) link = createHandlerLink(handler, pointer, "web");

  return link;
}
