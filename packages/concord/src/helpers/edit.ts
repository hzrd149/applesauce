// CORD-03 Chat Plane — message edits.
//
// An edit is a kind 3302 rumor that supersedes the prior chat message it
// targets. Sealing/wrapping is handled by ../stream.js.
//
// These helpers read the edit-specific fields straight off a decoded rumor;
// they never build a parsed object, so callers pull only the field they need
// (the channel/epoch binding and `ms` ordering are read with `checkChatBinding`
// and `rumorMs`).

import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { EventPointer, getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { isETag } from "applesauce-core/helpers/tags";
import type { Rumor } from "../types.js";

/** Concord chat message edit kind (CORD-03). */
export const EDIT_KIND = 3302;

/** A rumor validated as a Concord chat edit (kind 3302). */
export type EditRumor = Omit<Rumor, "kind"> & { kind: typeof EDIT_KIND };

export const EditTargetPointerSymbol = Symbol.for("concord-edit-target-pointer");

/**
 * Returns true if the rumor is a valid Concord chat edit: kind 3302 with an `e`
 * tag naming the message it replaces (CORD-03 §3).
 */
export function isValidEdit(rumor?: Rumor): rumor is EditRumor {
  if (!rumor || rumor.kind !== EDIT_KIND) return false;
  return !!rumor.tags.find(isETag);
}

/** Returns the {@link EventPointer} for the message an edit replaces (its `e` tag). */
export function getEditTarget(rumor: EditRumor): EventPointer;
export function getEditTarget(rumor?: Rumor): EventPointer | undefined;
export function getEditTarget(rumor?: Rumor): EventPointer | undefined {
  if (!isValidEdit(rumor)) return undefined;

  return getOrComputeCachedValue(rumor, EditTargetPointerSymbol, () => {
    const eTag = rumor.tags.find(isETag);
    return eTag ? (getEventPointerFromETag(eTag) ?? undefined) : undefined;
  });
}

/** Returns the replacement text an edit carries in its `content` (CORD-03 §3). */
export function getEditText(rumor: Pick<Rumor, "content">): string {
  return rumor.content;
}
