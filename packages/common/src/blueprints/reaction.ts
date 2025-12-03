import { blueprint, Emoji } from "applesauce-core/event-factory";
import { EventTemplate, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { includeEmojis } from "applesauce-core/operations/content";
import { setReaction, setReactionParent } from "../operations/reaction.js";

// Import EventFactory as a value (class) to modify its prototype
import { EventFactory } from "applesauce-core/event-factory";

/** blueprint for kind 7 reaction event */
export function ReactionBlueprint(event: NostrEvent, emoji: string | Emoji = "+") {
  return blueprint(
    kinds.Reaction,
    setReaction(emoji),
    setReactionParent(event),
    typeof emoji !== "string" ? includeEmojis([emoji]) : undefined,
  );
}

// Register this blueprint with EventFactory
EventFactory.prototype.reaction = function (event: NostrEvent, emoji: string | Emoji = "+") {
  return this.create(ReactionBlueprint, event, emoji);
};

// Type augmentation for EventFactory
declare module "applesauce-core/event-factory" {
  interface EventFactory {
    /** Create a kind 7 reaction event */
    reaction(event: NostrEvent, emoji?: string | Emoji): Promise<EventTemplate>;
  }
}
