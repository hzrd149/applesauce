import { serializeURL } from "applesauce-core/helpers/url";
import { Tokens } from "applesauce-core/helpers";
import { Transformer } from "unified";
import { findAndReplace } from "../nast/find-and-replace.js";
import { Link, Root } from "../nast/types.js";

/** Finds and creates web links in the tree */
export function links(): Transformer<Root> {
  return (tree) => {
    findAndReplace(tree, [
      [
        Tokens.link,
        (_: string) => {
          try {
            return {
              type: "link",
              href: serializeURL(_),
              value: _,
            } satisfies Link;
          } catch (error) {}

          return false;
        },
      ],
    ]);
  };
}
