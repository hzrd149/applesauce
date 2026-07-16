import type { EventOperation } from "../factories/types.js";
import { setCachedValue } from "../helpers/cache.js";
import {
  EncryptedContentSymbol,
  EncryptionMethod,
  getEncryptedContentEncryptionMethods,
} from "../helpers/encrypted-content.js";

/**
 * Sets the content to be encrypted to the pubkey with optional override method
 * @param pubkey - Pubkey to encrypt the content for
 * @param content - Plaintext content to encrypt
 * @param signer - EventSigner for encryption
 * @param override - Optional encryption method override
 */
export function setEncryptedContent(
  pubkey: string,
  content: string,
  signer?: import("../factories/types.js").EventSigner,
  override?: EncryptionMethod,
): EventOperation {
  return async (draft) => {
    if (!signer) throw new Error("Signer required for encrypted content");

    // Set method based on kind if not provided
    const methods = getEncryptedContentEncryptionMethods(draft.kind, signer, override);

    // carry-forward payload (see cache.ts one-rule doc block): construct the object first, then
    // write EncryptedContentSymbol non-enumerably via setCachedValue — it survives downstream
    // pipe steps' own spreads via pipeFromAsyncArray's carry-forward loop (helpers/pipeline.ts),
    // not because this write happens to be enumerable.
    const encrypted = await methods.encrypt(pubkey, content);
    const result = { ...draft, content: encrypted };
    setCachedValue(result, EncryptedContentSymbol, content);
    return result;
  };
}
