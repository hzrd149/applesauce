import { blueprint } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { GROUP_MESSAGE_KIND, GroupPointer } from "../helpers/groups.js";
import { addPreviousRefs, setGroupPointer } from "../operations/group.js";

export type GroupMessageBlueprintOptions = { previous: NostrEvent[] } & TextContentOptions & MetaTagOptions;

/** A blueprint for a NIP-29 group message */
export function GroupMessageBlueprint(group: GroupPointer, content: string, options?: GroupMessageBlueprintOptions) {
  return blueprint(
    GROUP_MESSAGE_KIND,
    // include group id "h" tag
    setGroupPointer(group),
    // include "previous" events tags
    options?.previous && addPreviousRefs(options.previous),
    // Set text content
    setShortTextContent(content, options),
    // Add common meta tags
    setMetaTags(options),
  );
}
