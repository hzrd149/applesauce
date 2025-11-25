import { GroupPointer } from "applesauce-common/helpers/groups";
import { ensureWebSocketURL, NameValueTag } from "applesauce-core/helpers";

import { fillAndTrimTag } from "./tag.js";

/** Creates a "h" tag for chat messages from a {@link GroupPointer} */
export function createGroupHTagFromGroupPointer(group: GroupPointer): NameValueTag {
  return fillAndTrimTag(["h", group.id, ensureWebSocketURL(group.relay)]) as NameValueTag;
}

/** Creates a "group" tag from a {@link GroupPointer} */
export function createGroupTagFromGroupPointer(group: GroupPointer): NameValueTag {
  return fillAndTrimTag(["group", group.id, ensureWebSocketURL(group.relay), group.name], 3) as NameValueTag;
}
