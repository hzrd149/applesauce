import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import { isATag } from "applesauce-core/helpers/tags";

/** Returns the pointer to the stream chat message stream */
export function getStreamChatMessageStream(message: NostrEvent): AddressPointer | undefined {
  const tag = message.tags.find(isATag);
  if (!tag) return undefined;
  return getAddressPointerFromATag(tag) ?? undefined;
}
