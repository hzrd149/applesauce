import { parseBolt11, type ParsedInvoice } from "applesauce-common/helpers/bolt11";
import { Tokens } from "applesauce-core/helpers/regexp";
import { type Transformer } from "unified";

import { findAndReplace } from "../nast/find-and-replace.js";
import { Node, Root } from "../nast/types.js";
import { textNoteTransformers } from "./content.js";

export interface LightningInvoice extends Node {
  type: "lightning";
  invoice: string;
  parsed: ParsedInvoice;
}

declare module "../nast/types.js" {
  interface ContentMap {
    lightning: LightningInvoice;
  }
}

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

// Register the lightning transformer in the default text-note pipeline as a
// side effect of importing this module. Consumers opt-in to lightning invoice
// parsing by importing `applesauce-content/text/lightning`.
if (!textNoteTransformers.includes(lightningInvoices)) {
  textNoteTransformers.push(lightningInvoices);
}
