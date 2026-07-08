import { EventOperation } from "applesauce-core/factories";
import { setSingletonTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";

/** Sets the NIP-7D `title` tag on a forum thread (kind 11) */
export function setTitle(title: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["title", title]));
}
