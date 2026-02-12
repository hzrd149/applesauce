import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent, pipeFromAsyncArray, skip } from "applesauce-core/helpers";
import { includeEmojis } from "applesauce-core/operations/content";
import { setReaction, setReactionParent } from "../operations/reaction.js";
import { Emoji } from "../helpers/emoji.js";

export type ReactionTemplate = KnownEventTemplate<kinds.Reaction>;

/** A factory class for building kind 7 reaction events */
export class ReactionFactory extends EventFactory<kinds.Reaction, ReactionTemplate> {
  /**
   * Creates a new reaction factory for an event
   * @param event - The event being reacted to
   * @param emoji - The emoji to react with (default: "+")
   * @returns A new reaction factory
   */
  static create(event: NostrEvent, emoji: string | Emoji = "+"): ReactionFactory {
    return new ReactionFactory((res) => res(blankEventTemplate(kinds.Reaction))).reactTo(event).reaction(emoji);
  }

  /** Sets the parent event being reacted to */
  reactTo(event: NostrEvent) {
    return this.chain(setReactionParent(event, undefined, undefined));
  }

  /** Sets the reaction emoji */
  reaction(emoji: "+" | "-" | string | Emoji) {
    return this.chain(
      pipeFromAsyncArray([
        // Set the event content
        setReaction(emoji),
        // If custom emoji, include emoji tag
        typeof emoji !== "string" ? includeEmojis([emoji]) : skip(),
      ]),
    );
  }
}
