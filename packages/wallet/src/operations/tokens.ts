import { type ProofLike } from "@cashu/cashu-ts";
import { EventOperation } from "applesauce-core";
import { EventContentEncryptionMethod } from "applesauce-core/helpers";
import { setEncryptedContent } from "applesauce-core/operations/encrypted-content";

import { toStoredProofs } from "../helpers/cashu.js";
import { TokenContent } from "../helpers/tokens.js";

/** A token whose proofs may have either numeric or {@link Amount} amounts */
export type TokenInput = { mint: string; proofs: ProofLike[]; unit?: string; memo?: string };

/** Sets the content of a 7375 token event */
export function setToken(
  token: TokenInput,
  del: string[] = [],
  signer?: import("applesauce-core/factories").EventSigner,
): EventOperation {
  return async (draft) => {
    if (!signer) throw new Error(`Missing signer`);
    const pubkey = await signer.getPublicKey();
    const method = EventContentEncryptionMethod[draft.kind];
    if (!method) throw new Error("Failed to find encryption method");

    if (!token.mint) throw new Error("Token mint is required");
    if (!token.proofs || token.proofs.length === 0) throw new Error("Token proofs are required");

    const content: TokenContent = {
      mint: token.mint,
      // Normalize cashu Amount proofs to numeric amounts for NIP-60 storage
      proofs: toStoredProofs(token.proofs),
      unit: token.unit,
      del,
    };

    return await setEncryptedContent(pubkey, JSON.stringify(content), signer, method)(draft);
  };
}
