import { Transformer } from "unified";
import { Link, Nodes } from "mdast";

import { findAndReplace } from "mdast-util-find-and-replace";
import { decode, DecodeResult } from "nostr-tools/nip19";
import Expressions from "../helpers/regexp.js";

export interface NostrMention extends Link {
  type: "link";
  data: DecodeResult;
}

export function remarkNostrMentions(): Transformer<Nodes> {
  return (tree) => {
    findAndReplace(tree, [
      Expressions.nostrLink,
      (_: string, $1: string) => {
        try {
          return {
            type: "link",
            data: decode($1),
            children: [],
            url: "nostr:" + $1,
          } satisfies NostrMention;
        } catch (error) {}
        return false;
      },
    ]);
  };
}