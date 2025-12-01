import { decodePointer } from "applesauce-core/helpers/pointers";
import { Tokens } from "applesauce-core/helpers/regexp";
import { Transformer } from "unified";
import { findAndReplace } from "../nast/find-and-replace.js";
import { Root } from "../nast/types.js";

/** Finds and creates NIP-19 nostr mentions in the tree */
export function nostrMentions(): Transformer<Root> {
  return (tree) => {
    findAndReplace(tree, [
      [
        Tokens.nostrLink,
        (_: string, $1: string) => {
          try {
            return {
              type: "mention",
              decoded: decodePointer($1),
              encoded: $1,
            };
          } catch (error) {}

          return false;
        },
      ],
    ]);
  };
}
