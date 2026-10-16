import { EventOperation } from "applesauce-core/factories";
import {
  addAddressPointerTag,
  addEventPointerTag,
  addProfilePointerTag,
  setSingletonTag,
} from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { UserStatusPointer, UserStatusType } from "../helpers/user-status.js";

const LINK_TAGS = ["r", "p", "e", "a"];
const removeLinkTags = (tags: string[][]) => tags.filter((t) => !LINK_TAGS.includes(t[0]));

/** Sets the status type ("d" tag) of a user status */
export function setStatusType(type: UserStatusType): EventOperation {
  return modifyPublicTags(setSingletonTag(["d", type], true));
}

/**
 * Sets the single URL, profile, event, or address the status links to
 * @param link a URL string or a {@link UserStatusPointer}
 */
export function setStatusLink(link: string | UserStatusPointer): EventOperation {
  const pointer: UserStatusPointer = typeof link === "string" ? { type: "url", data: link } : link;

  switch (pointer.type) {
    case "url":
      return modifyPublicTags(removeLinkTags, (tags) => [...tags, ["r", pointer.data]]);
    case "nprofile":
      return modifyPublicTags(removeLinkTags, addProfilePointerTag(pointer.data));
    case "nevent":
      return modifyPublicTags(removeLinkTags, addEventPointerTag(pointer.data));
    case "naddr":
      return modifyPublicTags(removeLinkTags, addAddressPointerTag(pointer.data));
  }
}

/** Removes any "r", "p", "e", or "a" link tags from the status */
export function clearStatusLink(): EventOperation {
  return modifyPublicTags(removeLinkTags);
}
