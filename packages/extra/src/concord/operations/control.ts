// CORD-04 Control-Plane rumor operations: editions and the dissolution
// tombstone. Composed into kind 3308 rumor templates by ../factories/control.js.

import type { EventOperation } from "applesauce-core/factories";
import { modifyPublicTags, TagOperations } from "applesauce-core/operations";
import type { EditionInput } from "../helpers/editions.js";

const { addNameValueTag, setSingletonTag } = TagOperations;

/** Fill an edition rumor's content + edition-machinery tags (CORD-04). */
export function includeEdition(input: EditionInput): EventOperation {
  const tags = modifyPublicTags(
    setSingletonTag(["vsk", String(input.vsk)]),
    setSingletonTag(["eid", input.eid]),
    setSingletonTag(["ev", String(input.version)]),
    input.prevHash ? setSingletonTag(["ep", input.prevHash]) : undefined,
    input.vac ? addNameValueTag(["vac", ...input.vac], false) : undefined,
  );
  return async (draft) => ({ ...(await tags(draft)), content: input.content });
}

/** The chainless dissolution tombstone (vsk 10), published at dissolved_pk. */
export function setDissolution(): EventOperation {
  const tags = modifyPublicTags(setSingletonTag(["vsk", "10"]), setSingletonTag(["eid", "00".repeat(32)]));
  return async (draft) => ({ ...(await tags(draft)), content: "" });
}
