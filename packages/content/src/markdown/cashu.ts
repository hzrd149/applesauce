import { getDecodedToken, type Token } from "@cashu/cashu-ts";
import { Tokens } from "applesauce-core/helpers/regexp";
import { Link, Nodes } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { Transformer } from "unified";

export interface CashuMdastLink extends Link {
  type: "link";
  data: {
    token: Token;
    raw: string;
  };
}

/** Finds cashu tokens in a mdast tree and replaces them with link nodes carrying the decoded token */
export function remarkCashuTokens(): Transformer<Nodes> {
  return (tree) => {
    findAndReplace(tree, [
      Tokens.cashu,
      (_: string, $1: string) => {
        try {
          const token = getDecodedToken($1);

          return {
            type: "link",
            data: { token, raw: $1 },
            url: "cashu:" + $1,
            children: [{ type: "text", value: $1 }],
          } satisfies CashuMdastLink;
        } catch (error) {}

        return false;
      },
    ]);
  };
}
