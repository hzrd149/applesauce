import { EventOperation } from "../event-factory/types.js";
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
  signer?: import("../event-factory/types.js").EventSigner,
  override?: EncryptionMethod,
): EventOperation {
  return async (draft) => {
    if (!signer) throw new Error("Signer required for encrypted content");

    // Set method based on kind if not provided
    const methods = getEncryptedContentEncryptionMethods(draft.kind, signer, override);

    // add the plaintext content on the draft so it can be carried forward
    const encrypted = await methods.encrypt(pubkey, content);
    return { ...draft, content: encrypted, [EncryptedContentSymbol]: content };
  };
}
