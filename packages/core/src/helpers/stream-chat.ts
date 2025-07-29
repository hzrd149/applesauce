import { AddressPointer } from "nostr-tools/nip19";
import { NostrEvent } from "nostr-tools";

import { getAddressPointerFromATag } from "./pointers.js";
import { isATag } from "./tags.js";

/** Returns the pointer to the stream chat message stream */
export function getStreamChatMessageStream(message: NostrEvent): AddressPointer | undefined {
  const tag = message.tags.find(isATag);
  if (!tag) return undefined;
  return getAddressPointerFromATag(tag);
}
