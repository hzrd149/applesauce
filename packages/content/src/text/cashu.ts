import { getDecodedToken, type Token } from "@cashu/cashu-ts";
import { Tokens } from "applesauce-core/helpers/regexp";
import { Transformer } from "unified";

import { findAndReplace } from "../nast/find-and-replace.js";
import { Node, Root } from "../nast/types.js";
import { textNoteTransformers } from "./content.js";

export interface CashuToken extends Node {
  type: "cashu";
  token: Token;
  raw: string;
}

declare module "../nast/types.js" {
  interface ContentMap {
    cashu: CashuToken;
  }
}

/** Parse cashu tokens from an ATS tree */
export function cashuTokens(): Transformer<Root> {
  return (tree) => {
    findAndReplace(tree, [
      [
        Tokens.cashu,
        (_: string, $1: string) => {
          try {
            const token = getDecodedToken($1);

            return {
              type: "cashu",
              token,
              raw: $1,
            };
          } catch (error) {}

          return false;
        },
      ],
    ]);
  };
}

// Register the cashu transformer in the default text-note pipeline as a side
// effect of importing this module. Consumers opt-in to cashu support by
// importing `applesauce-content/text/cashu`.
if (!textNoteTransformers.includes(cashuTokens)) {
  textNoteTransformers.push(cashuTokens);
}
