import { parseBolt11 } from "applesauce-common/helpers/bolt11";
import { Tokens } from "applesauce-core/helpers/regexp";
import { type Transformer } from "unified";
import { findAndReplace } from "../nast/find-and-replace.js";
import { LightningInvoice, Root } from "../nast/types.js";

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
