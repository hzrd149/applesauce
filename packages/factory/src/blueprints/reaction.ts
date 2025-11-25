import { Emoji } from "applesauce-common/helpers/emoji";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";

import { blueprint } from "../event-factory.js";
import { includeEmojis } from "../operations/content.js";
import { setReaction, setReactionParent } from "../operations/reaction.js";

/** blueprint for kind 7 reaction event */
export function ReactionBlueprint(event: NostrEvent, emoji: string | Emoji = "+") {
  return blueprint(
    kinds.Reaction,
    setReaction(emoji),
    setReactionParent(event),
    typeof emoji !== "string" ? includeEmojis([emoji]) : undefined,
  );
}
