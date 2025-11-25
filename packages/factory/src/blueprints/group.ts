import { GROUP_MESSAGE_KIND, GroupPointer } from "applesauce-common/helpers/groups";
import { NostrEvent } from "applesauce-core/helpers/event";

import { blueprint } from "../event-factory.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";
import { setShortTextContent, TextContentOptions } from "../operations/content.js";
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
