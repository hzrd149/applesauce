import { blueprint, Emoji } from "applesauce-core/event-factory";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { includeEmojis } from "applesauce-core/operations/content";
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
