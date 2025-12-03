import { EventOperation } from "applesauce-core/event-factory";
import { ensureNamedValueTag } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { includeSingletonTag, modifyPublicTags } from "applesauce-core/operations/tags";
import { createGroupHTagFromGroupPointer, createGroupTagFromGroupPointer } from "../helpers/groups-helper.js";
import { GroupPointer } from "../helpers/groups.js";

/** Adds a "group" tag to a list */
export function addGroupTag(group: GroupPointer): EventOperation {
  return modifyPublicTags((tags) => {
    // remove existing tag
    tags = tags.filter((t) => !(t[0] === "group" && t[1] === group.id && t[2] === group.relay));

    return [...tags, createGroupTagFromGroupPointer(group)];
  });
}

/** Removes a "group" tag from a list */
export function removeGroupTag(group: GroupPointer): EventOperation {
  return modifyPublicTags((tags) =>
    tags.filter((tag) => tag[0] === "group" && tag[1] === group.id && tag[2] === group.relay),
  );
}

/** Sets the "h" tag for NIP-29 group messages or other events */
export function setGroupPointer(group: GroupPointer): EventOperation {
  return includeSingletonTag(createGroupHTagFromGroupPointer(group), true);
}

/** Adds "previous" tags for group messages */
export function addPreviousRefs(previous: NostrEvent[], count = 6): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    // sort previous events by date and limit to 50
    const sorted = previous.sort((a, b) => b.created_at - a.created_at).slice(0, 50);

    for (let i = 0; i < count; i++) {
      const index = Math.round(Math.random() * (sorted.length - 1));
      const event = sorted.splice(index, 1)[0];

      if (event) tags = ensureNamedValueTag(tags, ["previous", event.id.slice(0, 8)]);
    }

    return { ...draft, tags };
  };
}
