import { Emoji } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "nostr-tools";

import { blueprint } from "../event-factory.js";
import { includeEmojis } from "../operations/content.js";
import { setReactionParent, setReaction } from "../operations/reaction.js";

/** blueprint for kind 7 reaction event */
export function ReactionBlueprint(event: NostrEvent, emoji: string | Emoji = "+") {
  return blueprint(
    kinds.Reaction,
    setReaction(emoji),
    setReactionParent(event),
    typeof emoji !== "string" ? includeEmojis([emoji]) : undefined,
  );
}
