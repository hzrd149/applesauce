import { getDecodedToken } from "@cashu/cashu-ts";
import { Tokens } from "applesauce-core/helpers/regexp";
import { Transformer } from "unified";
import { findAndReplace } from "../nast/find-and-replace.js";
import { Root } from "../nast/types.js";

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
