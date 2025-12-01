import { DecodeResult } from "applesauce-core/helpers";
import { decodePointer } from "applesauce-core/helpers/pointers";
import { Tokens } from "applesauce-core/helpers/regexp";
import { Link, Nodes } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { Transformer } from "unified";

export interface NostrMention extends Link {
  type: "link";
  data: DecodeResult;
}

export function remarkNostrMentions(): Transformer<Nodes> {
  return (tree) => {
    findAndReplace(tree, [
      Tokens.nostrLink,
      (_: string, $1: string) => {
        try {
          return {
            type: "link",
            data: decodePointer($1),
            children: [],
            url: "nostr:" + $1,
          } satisfies NostrMention;
        } catch (error) {}
        return false;
      },
    ]);
  };
}
