// Chat Plane edit rumor operation (CORD-03 §3). A kind 3302 edit replaces a
// message's content and points at the message it replaces with an `e` tag.
//
// This is a composable EventOperation that mutates a draft's public tags via
// applesauce's tag operations; the EditFactory in ../factories/edit.js chains it
// onto a blank rumor template.

import type { EventOperation } from "applesauce-core/factories";
import { modifyPublicTags } from "applesauce-core/operations";
import { addEventPointerTag } from "applesauce-core/operations/tag/common";

/** Add the `e` tag pointing an edit at the message it replaces. */
export function includeEditTarget(id: string): EventOperation {
  return modifyPublicTags(addEventPointerTag(id, undefined, false));
}
