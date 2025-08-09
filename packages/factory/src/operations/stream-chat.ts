import { getAddressPointerForEvent, isAddressPointer } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";
import { AddressPointer } from "nostr-tools/nip19";

import { ensureAddressPointerTag } from "../helpers/common-tags.js";
import { eventPipe, skip } from "../helpers/pipeline.js";
import {
  includeEmojis,
  includeQuoteTags,
  repairNostrLinks,
  setContent,
  setContentWarning,
  tagPubkeyMentions,
  TextContentOptions,
} from "./content.js";
import { modifyPublicTags } from "./tags.js";

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
