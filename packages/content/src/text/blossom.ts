import { parseBlossomURI } from "applesauce-common/helpers/blossom";
import { Tokens } from "applesauce-core/helpers/regexp";
import { Transformer } from "unified";

import { findAndReplace } from "../nast/find-and-replace.js";
import { BlossomURI, Root } from "../nast/types.js";

/** Finds and creates BUD-10 blossom URI nodes in the tree */
export function blossomURIs(): Transformer<Root> {
  return (tree) => {
    findAndReplace(tree, [
      [
        Tokens.blossom,
        (raw: string) => {
          const parsed = parseBlossomURI(raw);
          if (!parsed) return false;

          return {
            type: "blossom",
            raw,
            ...parsed,
          } satisfies BlossomURI;
        },
      ],
    ]);
  };
}
