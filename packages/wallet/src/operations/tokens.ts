import { Token } from "@cashu/cashu-ts";
import { EventContentEncryptionMethod } from "applesauce-core/helpers";
import { EventOperation } from "applesauce-core";
import { setEncryptedContent } from "applesauce-factory/operations/content";

import { TokenContent } from "../helpers/tokens.js";

/** Sets the content of a 7375 token event */
export function setToken(token: Token, del: string[] = []): EventOperation {
  return async (draft, ctx) => {
    if (!ctx.signer) throw new Error(`Missing signer`);
    const pubkey = await ctx.signer.getPublicKey();
    const method = EventContentEncryptionMethod[draft.kind];
    if (!method) throw new Error("Failed to find encryption method");

    if (!token.mint) throw new Error("Token mint is required");
    if (!token.proofs || token.proofs.length === 0) throw new Error("Token proofs are required");

    const content: TokenContent = {
      mint: token.mint,
      proofs: token.proofs,
      unit: token.unit,
      del,
    };

    return await setEncryptedContent(pubkey, JSON.stringify(content), method)(draft, ctx);
  };
}
