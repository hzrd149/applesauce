import { type FileMetadataFields, getMediaAttachments } from "applesauce-common/helpers/file-metadata";
import { type NostrEvent } from "applesauce-core/helpers/event";
import { type Transformer } from "unified";

import { Root } from "../nast/types.js";
import { textNoteTransformers } from "./content.js";

declare module "../nast/types.js" {
  interface Link {
    /** File metadata from a matching NIP-92 `imeta` tag on the event */
    metadata?: FileMetadataFields;
  }
}

/** Hydrates link nodes with NIP-92 file metadata from matching `imeta` tags on the event */
export function imetaLinks(): Transformer<Root> {
  return (tree) => {
    const event = tree.event;
    if (!event || !event.tags || event.tags.length === 0) return;

    const attachments = getMediaAttachments(event as NostrEvent);
    if (attachments.length === 0) return;

    // Build a normalized URL -> metadata map so lookups match `link.href` exactly
    const byUrl = new Map<string, FileMetadataFields>();
    for (const attachment of attachments) {
      if (!attachment.url) continue;
      try {
        byUrl.set(new URL(attachment.url).toString(), attachment);
      } catch {
        // ignore invalid URLs
      }
    }

    if (byUrl.size === 0) return;

    for (const node of tree.children) {
      if (node.type !== "link") continue;
      const metadata = byUrl.get(node.href);
      if (metadata) node.metadata = metadata;
    }
  };
}

// Register the imeta transformer in the default text-note pipeline as a side
// effect of importing this module. Consumers opt-in to imeta link hydration
// by importing `applesauce-content/text/imeta`.
if (!textNoteTransformers.includes(imetaLinks)) {
  textNoteTransformers.push(imetaLinks);
}
