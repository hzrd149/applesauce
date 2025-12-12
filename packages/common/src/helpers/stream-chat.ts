import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import { isATag } from "applesauce-core/helpers/tags";

export type StreamChatMessageEvent = KnownEvent<kinds.LiveChatMessage>;

export function isValidStreamChatMessage(event: NostrEvent): event is StreamChatMessageEvent {
  return event.kind === kinds.LiveChatMessage && getStreamChatMessageStream(event) !== undefined;
}

/** Returns the pointer to the stream chat message stream */
export function getStreamChatMessageStream(message: StreamChatMessageEvent): AddressPointer;
export function getStreamChatMessageStream(message: NostrEvent): AddressPointer | undefined;
export function getStreamChatMessageStream(message: NostrEvent): AddressPointer | undefined {
  const tag = message.tags.find(isATag);
  if (!tag) return undefined;
  return getAddressPointerFromATag(tag) ?? undefined;
}
