import { Transformer } from "unified";
import { getHashtagTag } from "applesauce-common/helpers/hashtag";

import { Hashtag, Root } from "../nast/types.js";
import { Tokens } from "../helpers/regexp.js";
import { findAndReplace } from "../nast/find-and-replace.js";

/** Find and create hashtag notes in provided tree */
export function hashtags(): Transformer<Root> {
  return (tree) => {
    const event = tree.event;

    findAndReplace(tree, [
      [
        Tokens.hashtag,
        (_: string, $1: string) => {
          try {
            const tag = event && getHashtagTag(event, $1);

            // Skip if the match if no tag was found in the event
            if (!tag && event) return false;

            return {
              type: "hashtag",
              tag,
              name: $1,
              hashtag: tag?.[1].toLowerCase() || $1.toLowerCase(),
            } satisfies Hashtag;
          } catch (error) {}

          return false;
        },
      ],
    ]);
  };
}
