import { EventOperation } from "applesauce-core/event-factory";
import { removeSingletonTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";

/** Sets or removes the "title" tag on a NIP-51 list */
export function setTitle(title: string | null): EventOperation {
  return modifyPublicTags(title === null ? removeSingletonTag("title") : setSingletonTag(["title", title], true));
}

/** Sets or removes the "image" tag on a NIP-51 list */
export function setImage(image: string | null): EventOperation {
  return modifyPublicTags(image === null ? removeSingletonTag("image") : setSingletonTag(["image", image], true));
}

/** Sets or removes the "description" tag on a NIP-51 list */
export function setDescription(description: string | null): EventOperation {
  return modifyPublicTags(
    description === null ? removeSingletonTag("description") : setSingletonTag(["description", description], true),
  );
}
