import { EventOperation } from "../event-factory/types.js";
import { EncryptionMethod } from "../helpers/encrypted-content.js";
import { setEncryptedContent } from "./encrypted-content.js";

/** Sets the hidden content on an event */
export function setHiddenContent(content: string, override?: EncryptionMethod): EventOperation {
  return async (draft, ctx) => {
    if (!ctx?.signer) throw new Error("Signer required for encrypted content");

    const pubkey = await ctx.signer.getPublicKey();
    return setEncryptedContent(pubkey, content, override)(draft, ctx);
  };
}
