import { EventOperation } from "applesauce-core/event-factory";
import { ensureNamedValueTag } from "applesauce-core/helpers/tags";
import { MediaAttachment } from "../helpers/file-metadata.js";

/** Includes the "x" and "m" tags for kind 20 picture posts */
export function setImageMetadata(pictures: MediaAttachment[]): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    for (const image of pictures) {
      if (image.sha256) tags = ensureNamedValueTag(tags, ["x", image.sha256]);
      if (image.type) tags = ensureNamedValueTag(tags, ["m", image.type]);
    }

    return { ...draft, tags };
  };
}
