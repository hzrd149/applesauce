import { nip19, NostrEvent } from "nostr-tools";
import { ChannelMetadata } from "nostr-tools/nip28";
import { getOrComputeCachedValue } from "./cache.js";

export const ChannelMetadataSymbol = Symbol.for("channel-metadata");

export type ChannelMetadataContent = ChannelMetadata & {
  relays?: string[];
};

function parseChannelMetadataContent(channel: NostrEvent) {
  const metadata = JSON.parse(channel.content) as ChannelMetadataContent;
  if (metadata.name === undefined) throw new Error("Missing name");
  if (metadata.about === undefined) throw new Error("Missing about");
  if (metadata.picture === undefined) throw new Error("Missing picture");
  if (metadata.relays && !Array.isArray(metadata.relays)) throw new Error("Invalid relays");
  return metadata;
}

/** Gets the parsed metadata on a channel creation or channel metadata event */
export function getChannelMetadataContent(channel: NostrEvent) {
  return getOrComputeCachedValue(channel, ChannelMetadataSymbol, () => {
    return parseChannelMetadataContent(channel);
  });
}

/** gets the EventPointer for a channel message or metadata event */
export function getChannelPointer(event: NostrEvent): nip19.EventPointer | undefined {
  const tag = event.tags.find((t) => t[0] === "e" && t[1]);
  if (!tag) return undefined;
  return tag[2] ? { id: tag[1], relays: [tag[2]] } : { id: tag[1] };
}
