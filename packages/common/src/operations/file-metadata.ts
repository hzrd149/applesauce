import { EventOperation } from "applesauce-core/event-factory";
import { ensureSingletonTag } from "applesauce-core/helpers";
import { createFileMetadataTags } from "../helpers/file-metadata.js";
import { FileMetadata } from "../helpers/file-metadata.js";

/** Sets all NIP-94 tags for {@link FileMetadata} */
export function setFileMetadata(metadata: FileMetadata): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    const fileTags = createFileMetadataTags(metadata);
    for (const tag of fileTags) {
      switch (tag[0]) {
        case "fallback":
          // support multiple fallback tags
          tags.push(tag);
          break;

        default:
          tags = ensureSingletonTag(tags, tag);
          break;
      }
    }

    return { ...draft, tags };
  };
}
