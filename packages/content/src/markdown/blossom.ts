import { ParsedBlossomURI, parseBlossomURI } from "applesauce-common/helpers/blossom";
import { Tokens } from "applesauce-core/helpers/regexp";
import { Link, Nodes } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { Transformer } from "unified";

export interface BlossomMdastLink extends Link {
  type: "link";
  data: ParsedBlossomURI;
}

/** Finds and creates BUD-10 `blossom:` URI links in a mdast tree */
export function remarkBlossomURIs(): Transformer<Nodes> {
  return (tree) => {
    findAndReplace(tree, [
      Tokens.blossom,
      (raw: string) => {
        const parsed = parseBlossomURI(raw);
        if (!parsed) return false;

        return {
          type: "link",
          data: parsed,
          url: raw,
          children: [{ type: "text", value: raw }],
        } satisfies BlossomMdastLink;
      },
    ]);
  };
}
