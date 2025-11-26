import { getEmojiTag } from "applesauce-common/helpers/emoji";
import { Tokens } from "applesauce-core/helpers/regexp";
import { type Transformer } from "unified";
import { findAndReplace } from "../nast/find-and-replace.js";
import { Emoji, Root } from "../nast/types.js";

/** Finds and creates emoji nodes in the tree */
export function emojis(): Transformer<Root> {
  return (tree) => {
    const event = tree.event;
    if (!event) return;

    findAndReplace(tree, [
      [
        Tokens.emoji,
        (full: string, $1: string) => {
          try {
            const tag = getEmojiTag(event, $1);
            if (!tag) return false;

            return {
              type: "emoji",
              tag,
              raw: full,
              code: tag[1].toLowerCase(),
              url: tag[2],
            } satisfies Emoji;
          } catch (error) {}

          return false;
        },
      ],
    ]);
  };
}
