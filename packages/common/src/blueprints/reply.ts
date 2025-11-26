import { kinds, NostrEvent } from "nostr-tools";

import { blueprint } from "../../../factory/src/event-factory.js";
import { setShortTextContent, TextContentOptions } from "../../../factory/src/operations/content.js";
import { includeNofityTags, setThreadParent } from "applesauce-common/operations/note.js";

/** Short text note reply (kind 1) blueprint */
export function NoteReplyBlueprint(parent: NostrEvent, content: string, options?: TextContentOptions) {
  if (parent.kind !== kinds.ShortTextNote)
    throw new Error("Kind 1 replies should only be used to reply to kind 1 notes");

  return blueprint(
    kinds.ShortTextNote,
    // add NIP-10 tags
    setThreadParent(parent),
    // copy "p" tags from parent
    includeNofityTags(parent),
    // set default text content
    setShortTextContent(content, options),
  );
}
