import { Model } from "applesauce-core/event-store";
import { getReplaceableAddress, NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { isAddressableKind } from "nostr-tools/kinds";

import { COMMENT_KIND } from "../helpers/comment.js";

/** A model that returns all NIP-22 comment replies for the event */
export function CommentsModel(parent: NostrEvent): Model<NostrEvent[]> {
  return (events) => {
    const filters: Filter[] = [{ kinds: [COMMENT_KIND], "#e": [parent.id] }];
    if (isAddressableKind(parent.kind)) filters.push({ kinds: [COMMENT_KIND], "#a": [getReplaceableAddress(parent)] });

    return events.timeline(filters);
  };
}
