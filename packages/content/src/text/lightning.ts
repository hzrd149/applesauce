import { type Transformer } from "unified";
import { parseBolt11 } from "applesauce-common/helpers/bolt11";

import { LightningInvoice, Root } from "../nast/types.js";
import { Tokens } from "../helpers/regexp.js";
import { findAndReplace } from "../nast/find-and-replace.js";

/** Finds and creates lightning invoice nodes in the tree */
export function lightningInvoices(): Transformer<Root> {
  return (tree) => {
    findAndReplace(tree, [
      [
        Tokens.lightning,
        (_: string, $1: string) => {
          try {
            const invoice = $1;
            const parsed = parseBolt11(invoice);

            return {
              type: "lightning",
              invoice,
              parsed,
            } satisfies LightningInvoice;
          } catch (error) {}

          return false;
        },
      ],
    ]);
  };
}
