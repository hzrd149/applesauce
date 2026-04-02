import type { EventOperation } from "../factories/types.js";
import { EncryptionMethod } from "../helpers/encrypted-content.js";
import { setEncryptedContent } from "./encrypted-content.js";

/**
 * Sets the hidden content on an event
 * @param content - Plaintext content to encrypt
 * @param signer - EventSigner for encryption
 * @param override - Optional encryption method override
 */
export function setHiddenContent(
  content: string,
  signer?: import("../factories/types.js").EventSigner,
  override?: EncryptionMethod,
): EventOperation {
  return async (draft) => {
    if (!signer) throw new Error("Signer required for encrypted content");

    const pubkey = await signer.getPublicKey();
    return setEncryptedContent(pubkey, content, signer, override)(draft);
  };
}
