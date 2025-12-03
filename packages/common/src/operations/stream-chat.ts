import { NostrEvent } from "applesauce-core/helpers/event";
import { ensureAddressPointerTag } from "applesauce-core/helpers/factory";
import { eventPipe, skip } from "applesauce-core/helpers/pipeline";
import { AddressPointer, getAddressPointerForEvent, isAddressPointer } from "applesauce-core/helpers/pointers";
import {
  includeEmojis,
  includeQuoteTags,
  repairNostrLinks,
  setContent,
  setContentWarning,
  tagPubkeyMentions,
  TextContentOptions,
} from "applesauce-core/operations/content";
import { modifyPublicTags } from "applesauce-core/operations/tags";

/** Sets the message content for a stream chat event */
export function setMessage(content: string, options?: TextContentOptions) {
  return eventPipe(
    // set text content
    setContent(content),
    // fix @ mentions
    repairNostrLinks(),
    // include "p" tags for pubkeys mentioned
    tagPubkeyMentions(),
    // include event "q" tags
    includeQuoteTags(),
    // include "emoji" tags
    options?.emojis ? includeEmojis(options.emojis) : skip(),
    // set "content-warning" tag
    options?.contentWarning !== undefined ? setContentWarning(options.contentWarning) : skip(),
  );
}

/** Sets the stream for a stream chat event */
export function setStream(stream: AddressPointer | NostrEvent) {
  if (!isAddressPointer(stream)) stream = getAddressPointerForEvent(stream);

  return modifyPublicTags((tags) => ensureAddressPointerTag(tags, stream));
}
