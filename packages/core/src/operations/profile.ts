import type { EventOperation } from "../factories/types.js";
import { ProfileContent, safeParse } from "../helpers/index.js";
import { setContent } from "./content.js";

/** Sets the content of a kind 0 metadata event */
export function setProfile(content: ProfileContent): EventOperation {
  return setContent(JSON.stringify(content));
}

/** Updates the content of a kind 0 metadata event */
export function updateProfile(content: Partial<ProfileContent>): EventOperation {
  return (draft) => {
    const existing = safeParse<ProfileContent>(draft.content) || {};
    return { ...draft, content: JSON.stringify({ ...existing, ...content }) };
  };
}
