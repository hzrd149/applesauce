import { EventOperation } from "applesauce-core/factories";
import { createImetaTagForAttachment } from "../helpers/file-metadata.js";
import { FileMetadata } from "../helpers/file-metadata.js";

/** Adds "imeta" tags on to any event */
export function addMediaAttachments(attachments: FileMetadata[]): EventOperation {
  return (draft) => {
    const tags = Array.from(draft.tags);

    for (const attachment of attachments) {
      // TODO: look for duplicates and merge them
      tags.push(createImetaTagForAttachment(attachment));
    }

    return { ...draft, tags };
  };
}
